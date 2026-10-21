'use strict';
/* ============================================================
 * PicFlow AI 引擎 v2.0 —— 自动聚类 + NSFW 本地检测
 *
 * 核心改变（v2.0）：
 *   1. 不再预设固定类别 —— AI 根据图片内容自动聚类归组
 *   2. 截图/美食误判修复 —— 相似内容自动聚到一起，不再靠关键词瞎猜
 *   3. NSFW 自动识别 —— nsfwjs 本地推理（模型运行时从 CDN 下载）
 *      NSFW 图片绝不上传，完全本地处理
 *
 * 技术方案：
 *   - 特征提取：MobileNetV2 int8 → top-15 标签概率分布（稀疏签名）
 *   - 聚类算法：K-means（余弦相似度）on 稀疏概率向量
 *   - 自动命名：取每个簇内最高频 top-3 标签生成组名
 *   - NSFW：nsfwjs 5 类（drawings/hentai/porn/sexy/neutral）本地推理
 * ============================================================ */
const path = require('path');
const fs = require('fs');

let ort = null;
let session = null;
let labels = null;
let _modelDir = null; // 供 WD14 复用（ensure 时记录）

// nsfwjs 动态加载（运行时从 npm 包加载，模型从 CDN 下载）
let nsfwModel = null;
let nsfwAvailable = false;
let nsfwError = null;

/* ---------- MobileNetV2 初始化 ---------- */
async function ensure(modelDir) {
  if (session) return true;
  _modelDir = modelDir;
  if (!ort) ort = require('onnxruntime-node');
  const mp = path.join(modelDir, 'mobilenetv2-12-int8.onnx');
  const lp = path.join(modelDir, 'labels.txt');
  if (!fs.existsSync(mp)) throw new Error('模型文件缺失: ' + mp);
  if (!fs.existsSync(lp)) throw new Error('标签文件缺失: ' + lp);
  if (!labels) {
    labels = fs.readFileSync(lp, 'utf8').split('\n')
      .map(s => s.trim()).filter(Boolean)
      .map(line => { const parts = line.split(','); return (parts[1] || parts[0] || '').trim(); });
  }
  session = await ort.InferenceSession.create(mp, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  });
  return true;
}

/* ---------- NSFW 模型初始化（可选，失败不阻塞主流程） ---------- */
async function ensureNsfw() {
  if (nsfwAvailable || nsfwError) return nsfwAvailable;
  try {
    const tf = require('@tensorflow/tfjs');
    const nsfwjs = require('nsfwjs');
    // 模型从 GitHub CDN 下载（~5MB），用户机器有 GitHub 访问能力
    nsfwModel = await nsfwjs.load();
    nsfwAvailable = true;
    console.log('[AI] nsfwjs 模型加载成功');
  } catch (e) {
    nsfwError = e.message;
    console.warn('[AI] nsfwjs 不可用（模型可能未能下载）:', e.message);
  }
  return nsfwAvailable;
}

/* ---------- 预处理：图片 → 1x3x224x224 归一化张量 ---------- */
function preprocess(nativeImage) {
  let img = nativeImage;
  if (img.isEmpty()) return null;
  const sz = img.getSize();
  if (sz.width < 8 || sz.height < 8) return null;
  img = img.resize({ width: 224, height: 224, quality: 'good' });
  const buf = img.toBitmap(); // BGRA
  const n = 224 * 224;
  const data = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    const si = i * 4, di = i;
    data[di] = (buf[si + 2] / 255 - mean[0]) / std[0];
    data[n + di] = (buf[si + 1] / 255 - mean[1]) / std[1];
    data[2 * n + di] = (buf[si] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', data, [1, 3, 224, 224]);
}

/* ---------- 提取图片特征签名 ----------
 * v2.1 关键改进：MobileNetV2 概率 + 颜色直方图 + 边缘密度 + 灰色比例 + 饱和度
 *
 * 为什么加颜色/纹理：MobileNetV2 训练在 ImageNet 1000 类（猫狗汽车食物），
 * 对游戏截图、二次元立绘、抽卡界面这类 OOD 内容会输出高度相似的"兜底"概率分布，
 * 单靠它做余弦相似度聚类会把不相关的图都聚成一类（用户反馈"只分了两大类"）。
 *
 * 补充特征的作用：
 *   - 颜色直方图(24维)：同一游戏/UI 截图色调一致 → 聚到一起；不同游戏色调拉开
 *   - 边缘密度：截图有大量文字/UI 线条（高频）vs 插画相对平滑 → 区分截图与插画
 *   - 灰色比例：白底黑字截图灰像素多 vs 彩色立绘 → 区分截图与照片/插画
 *   - 饱和度：二次元立绘高饱和 vs 截图低饱和 → 区分立绘与截图
 *
 * 实现技巧：把颜色/纹理特征映射到虚拟 idx(1000+)，追加到稀疏 probs 数组，
 * cosineSim 和 kmeans 无需改动即可处理混合特征。
 */
async function extractSignature(img) {
  if (!session) throw new Error('模型尚未初始化');
  const t = preprocess(img);
  if (!t) return null;
  const out = await session.run({ [session.inputNames[0]]: t });
  const logits = out[session.outputNames[0]].data;
  // softmax → 概率分布
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exps[i] = Math.exp(logits[i] - max); sum += exps[i]; }
  const probs = exps.map(e => e / sum);
  // 取 top-15 作为稀疏签名（够区分又紧凑）
  const idx = [];
  for (let i = 0; i < probs.length; i++) idx.push([probs[i], i]);
  idx.sort((a, b) => b[0] - a[0]);
  const top = idx.slice(0, 15).map(([p, i]) => ({
    label: (labels[i] || ('class' + i)).toLowerCase(),
    prob: p
  }));

  // === 颜色 + 纹理特征（32x32 缩略图计算，开销极小）===
  const small = img.resize({ width: 32, height: 32, quality: 'good' });
  const sbuf = small.toBitmap(); // BGRA
  const n2 = 32 * 32;
  const hist = new Array(24).fill(0); // R8 G8 B8 bins（每通道 8 段）
  let grayCount = 0, satSum = 0;
  for (let i = 0; i < n2; i++) {
    const b = sbuf[i * 4], g = sbuf[i * 4 + 1], r = sbuf[i * 4 + 2];
    hist[Math.min(7, r >> 5)] += 1;
    hist[8 + Math.min(7, g >> 5)] += 1;
    hist[16 + Math.min(7, b >> 5)] += 1;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 15) grayCount++;
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
  }
  for (let i = 0; i < 24; i++) hist[i] /= n2;
  const grayRatio = grayCount / n2;
  const satMean = satSum / n2;
  // 简单 Sobel 边缘密度（归一化到 0-1 量级）
  let edgeSum = 0;
  const lum = a => 0.299 * sbuf[a + 2] + 0.587 * sbuf[a + 1] + 0.114 * sbuf[a];
  for (let y = 1; y < 31; y++) {
    for (let x = 1; x < 31; x++) {
      const i = (y * 32 + x) * 4;
      const gx = lum(i + 4) - lum(i - 4);
      const gy = lum(i + 32 * 4) - lum(i - 32 * 4);
      edgeSum += Math.abs(gx) + Math.abs(gy);
    }
  }
  const edgeDensity = Math.min(1, edgeSum / (30 * 30 * 2 * 200)); // 截图通常 >0.15，插画 <0.08

  // 拼接混合特征向量：MobileNet top-15 + 颜色 24 维 + 灰色比 + 饱和度 + 边缘密度
  // 虚拟 idx 从 1000 起，避开 ImageNet 0-999
  const probsMix = idx.slice(0, 15).map(([p, i]) => [i, p]);
  for (let i = 0; i < 24; i++) probsMix.push([1000 + i, hist[i] * 1.3]); // 颜色权重略提
  probsMix.push([1024, grayRatio * 1.6]);    // 灰色比：截图白底黑字多
  probsMix.push([1025, satMean * 1.6]);      // 饱和度：立绘彩色 vs 截图低饱和
  probsMix.push([1026, edgeDensity * 3.5]);  // 边缘密度：截图文字密集，权重最高

  return { top, probs: probsMix, hist, grayRatio, satMean, edgeDensity };
}

/* ---------- NSFW 检测：返回 5 类分数 ---------- */
async function detectNsfw(img) {
  if (!nsfwAvailable) return null;
  try {
    const tf = require('@tensorflow/tfjs');
    const resized = img.resize({ width: 224, height: 224 });
    const buf = resized.toBitmap(); // BGRA → RGBA
    const n = 224 * 224;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = buf[i * 4 + 2];     // R
      rgba[i * 4 + 1] = buf[i * 4 + 1]; // G
      rgba[i * 4 + 2] = buf[i * 4];     // B
      rgba[i * 4 + 3] = 255;            // A
    }
    const tensor = tf.tensor3d(rgba, [224, 224, 4]);
    const rgb = tensor.slice([0, 0, 0], [224, 224, 3]);
    const predictions = await nsfwModel.classify(rgb);
    tensor.dispose(); rgb.dispose();
    // predictions: [{className: 'Porn', probability: 0.12}, ...]
    const result = {};
    let isNsfw = false;
    for (const p of predictions) {
      result[p.className.toLowerCase()] = p.probability;
      if (['porn', 'hentai', 'sexy'].includes(p.className.toLowerCase()) && p.probability > 0.3) {
        isNsfw = true;
      }
    }
    return { scores: result, isNsfw, threshold: 0.3 };
  } catch (e) {
    console.warn('[AI] NSFW 检测失败:', e.message);
    return null;
  }
}

/* ============================================================
 * WD14 输入准备（推理本身在 wd14-worker.js 独立进程执行）
 *
 * 为什么搬进程：WD14 单张 CPU 推理数秒~数十秒，在主进程执行会
 * 完全冻结 UI（点击无响应）。独立进程隔离后主进程只做图片
 * 预处理（原生解码，毫秒级），界面永不卡死，取消=kill 进程。
 * ============================================================ */

/**
 * 准备 WD14 输入：把原图缩到 ≤1008（保持比例），返回 BGRA buffer。
 * 不放大（小图保持原尺寸），letterbox 黑边补齐与归一化在 worker 内完成。
 * @returns { width, height, bgra: ArrayBuffer } | null
 */
function prepareWd14Input(nativeImage) {
  if (!nativeImage || nativeImage.isEmpty()) return null;
  const sz = nativeImage.getSize();
  if (sz.width < 8 || sz.height < 8) return null;
  const TARGET = 1008;
  const scale = Math.min(TARGET / sz.width, TARGET / sz.height, 1);
  const nw = Math.max(1, Math.round(sz.width * scale));
  const nh = Math.max(1, Math.round(sz.height * scale));
  const resized = nativeImage.resize({ width: nw, height: nh, quality: 'good' });
  const bmp = resized.toBitmap(); // BGRA
  // 拷贝一份独立 ArrayBuffer（远离 Node Buffer 池，跨进程 structured clone 安全）
  const out = new ArrayBuffer(bmp.length);
  new Uint8Array(out).set(bmp);
  return { width: nw, height: nh, bgra: out };
}

/* ============================================================
 * K-means 聚类（余弦相似度）on 稀疏概率向量
 * ============================================================ */

// 计算两个稀疏向量的余弦相似度
// sig = [[labelIdx, prob], ...]
function cosineSim(a, b) {
  const map = new Map(a);
  let dot = 0, na = 0, nb = 0;
  for (const [idx, pa] of a) {
    na += pa * pa;
    const pb = map.get(idx) || 0; // not used, b has its own
  }
  // 重新计算，上面有误
  dot = 0; na = 0; nb = 0;
  const bm = new Map(b);
  for (const [idx, pa] of a) {
    na += pa * pa;
    const pb = bm.get(idx);
    if (pb) dot += pa * pb;
  }
  for (const [, pb] of b) nb += pb * pb;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 自动确定 K：v2.1 增大聚类粒度，避免"只分两大类"
// 100 张图约 14 类，30 张约 8 类，至少 4 类
function autoK(items, maxK = 20) {
  const n = items.length;
  if (n <= 5) return Math.min(n, 4);
  return Math.min(maxK, Math.max(4, Math.ceil(Math.sqrt(n) * 1.4)));
}

// K-means 主流程
function kmeans(items, k, maxIter = 20) {
  if (!items.length) return [];
  k = Math.min(k, items.length);
  // 随机选 K 个初始中心（用均匀间隔采样代替纯随机，结果更稳定）
  const centers = [];
  const step = Math.floor(items.length / k);
  for (let i = 0; i < k; i++) {
    centers.push(items[i * step].sig.probs);
  }
  let assignments = new Array(items.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // 分配
    for (let i = 0; i < items.length; i++) {
      let bestC = 0, bestSim = -1;
      for (let c = 0; c < centers.length; c++) {
        const sim = cosineSim(items[i].sig.probs, centers[c]);
        if (sim > bestSim) { bestSim = sim; bestC = c; }
      }
      if (assignments[i] !== bestC) { assignments[i] = bestC; changed = true; }
    }
    if (!changed && iter > 0) break;
    // 更新中心（取簇内均值）
    for (let c = 0; c < centers.length; c++) {
      const members = items.filter((_, i) => assignments[i] === c);
      if (!members.length) continue;
      // 合并所有成员的稀疏向量，取均值
      const acc = new Map();
      for (const m of members) {
        for (const [idx, p] of m.sig.probs) {
          acc.set(idx, (acc.get(idx) || 0) + p);
        }
      }
      centers[c] = [...acc.entries()].map(([idx, s]) => [idx, s / members.length]);
    }
  }
  // 合并过相似的簇：v2.1 阈值 0.9→0.97，基本不合并，避免不相关的图被合成大类
  const merged = mergeClusters(centers, assignments, 0.97);
  return merged;
}

// 合并相似簇
function mergeClusters(centers, assignments, threshold) {
  const k = centers.length;
  const mergeTo = Array.from({ length: k }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (mergeTo[j] !== j) continue;
      if (cosineSim(centers[i], centers[j]) > threshold) {
        mergeTo[j] = mergeTo[i];
        // 合并中心
        const acc = new Map(centers[i]);
        for (const [idx, p] of centers[j]) {
          acc.set(idx, (acc.get(idx) || 0) + p);
        }
        centers[mergeTo[i]] = [...acc.entries()].map(([idx, s]) => [idx, s / 2]);
      }
    }
  }
  // 重新编号
  const unique = [...new Set(mergeTo)];
  const remap = new Map();
  unique.forEach((orig, i) => remap.set(orig, i));
  return assignments.map(a => remap.get(mergeTo[a]));
}

/* ============================================================
 * 组名汉化：英文 ImageNet 标签 → 中文
 *
 * 策略：
 *   1. 语义桶归并 —— 同一类别的多个英文词合并为一个中文桶名
 *      （例：website / monitor / screen / manual → 「截图」）
 *   2. EN2ZH 精简映射 —— 覆盖常见 ~250 词的直译
 *   3. 兜底 —— 无映射的词用「图片组 N」（N 由调用方编号，避免英文乱码）
 * ============================================================ */

// 语义桶：键=桶中文名，值=该桶包含的英文标签集合
// 命中优先级最高 —— 簇内累计权重占比 > 45% 即用桶名
const SEMANTIC_BUCKETS = [
  { name: '截图', words: ['web site', 'website', 'monitor', 'screen', 'crt screen', 'menu', 'book cover', 'book jacket', 'manual', 'binder', 'ring-binder', 'notebook', 'spiral', 'file', 'envelope', 'letter', 'comic book', 'jigsaw puzzle', 'crossword puzzle', 'webpage', 'web page', 'keyboard', 'computer keyboard', 'space bar', 'typewriter keyboard', 'menu board', 'scoreboard', 'digital clock', 'quilt', 'handkerchief', 'paper towel'] },
  { name: '文字文档', words: ['newspaper', 'magazine', 'tabloid', 'web site', 'menu', 'menu card', 'book jacket', 'comic book', 'crossword puzzle', 'jigsaw puzzle', 'notebook', 'binder', 'letter', 'envelope', 'file', 'rule', 'ruler', 'bookcase', 'bookshop', 'library', 'spine', 'folder', 'menu board', 'menu card'] },
  { name: '人物', words: ['suit', 'suit of clothes', 'bow tie', 'bowtie', 'bolo tie', 'bolo', 'cowboy hat', 'sombrero', 'bonnet', 'mortarboard', 'academic gown', 'military uniform', 'gown', 'lab coat', 'feather boa', 'boa', 'miniskirt', 'bikini', 'maillot', 'tank suit', 'brassiere', 'bra', 'pajama', 'pyjama', 'sweatshirt', 't-shirt', 'jersey', 'cardigan', 'fur coat', 'trench coat', 'labcoat', 'lab coat', 'sunglasses', 'sunglass', 'wig', 'mask', 'gasmask', 'gas mask', 'balaclava', 'helmet', 'crash helmet', 'football helmet', 'bonnet', 'hair spray', 'hair slide', 'maillot', 'bearskin', 'pillow', 'sleeping bag'] },
  { name: '猫', words: ['tabby', 'tiger cat', 'persian cat', 'siamese cat', 'egyptian cat', 'lynx', 'cougar', 'puma', 'catamount', 'mountain lion', 'panther', 'jaguar', 'leopard', 'snow leopard', 'cheetah', 'lion', 'sphynx', 'tabby cat'] },
  { name: '狗', words: ['dalmatian', 'great pyrenees', 'pembroke', 'corgi', 'boxer', 'afghan hound', 'afghan', 'basset', 'basset hound', 'bloodhound', 'saint bernard', 'st bernard', 'chow', 'chow chow', 'rottweiler', 'german shepherd', 'german shepherd dog', 'german police dog', 'doberman', 'doberman pinscher', 'miniature pinscher', 'miniature poodle', 'standard poodle', 'toy poodle', 'standard schnauzer', 'giant schnauzer', 'kerry blue terrier', 'soft-coated wheaten terrier', 'wheaten terrier', 'scotch terrier', 'scottish terrier', 'yorkshire terrier', 'wire-haired fox terrier', 'lakeland terrier', 'silky terrier', 'norwich terrier', 'cairn', 'cairn terrier', 'australian terrier', 'border terrier', 'staffordshire bullterrier', 'staffordshire bull terrier', 'irish terrier', 'welsh terrier', 'norfolk terrier', 'sealyham terrier', 'dandie dinmont', 'dandie dinmont terrier', 'skye terrier', 'boston bull', 'boston terrier', 'kelpie', 'australian kelpie', 'siberian husky', 'husky', 'malamute', 'mackenzie river husky', 'keeshond', 'pomeranian', 'leonberg', 'schipperke', 'miniature schnauzer', 'bouvier des flandres', 'bouvier des flandres', 'tibetan terrier', 'tibetan mastiff', 'old english sheepdog', 'shetland sheepdog', 'sheltie', 'collie', 'border collie', 'curly-coated retriever', 'flat-coated retriever', 'golden retriever', 'labrador retriever', 'chesapeake bay retriever', 'german short-haired pointer', 'vizsla', 'hungarian pointer', 'english setter', 'irish setter', 'irish red setter', 'gordon setter', 'brittany spaniel', 'clumber spaniel', 'english springer', 'english springer spaniel', 'welsh springer spaniel', 'cocker spaniel', 'sussex spaniel', 'irish water spaniel', 'kuvasz', 'leonberg', 'groenendael', 'malinois', 'brittany', 'entlebucher', 'appenzeller', 'greater swiss mountain dog', 'bernese mountain dog', 'doberman', 'weimaraner', 'otterhound', 'irish wolfhound', 'saluki', 'gazelle hound', 'scottish deerhound', 'deerhound', 'borzoi', 'russian wolfhound', 'whippet', 'italian greyhound', 'afghan hound', 'basenji', 'pug', 'pug-dog', 'miniature pinscher', 'toy terrier', 'chihuahua', 'japanese spaniel', 'pekingese', 'papillon', 'maltese', 'maltese dog', 'shih-tzu', 'blenheim spaniel', 'toy spaniel', 'lhasa', 'lhasa apso', 'timber wolf', 'grey wolf', 'gray wolf', 'white wolf', 'red wolf', 'coyote', 'dingo', 'hyena', 'hyaena', 'african hunting dog', 'hyena-like', 'cape hunting dog', 'wild dog'] },
  { name: '鸟', words: ['cock', 'hen', 'ostrich', 'brambling', 'goldfinch', 'house finch', 'junco', 'dark-eyed junco', 'indigo bunting', 'indigo finch', 'indigo bird', 'robin', 'american robin', 'bulbul', 'magpie', 'chickadee', 'black-capped chickadee', 'water ouzel', 'dipper', 'kite', 'bald eagle', 'american eagle', 'vulture', 'eagle', 'red-breasted merganser', 'merganser', 'goose', 'black stork', 'white stork', 'black swan', 'trumpeter swan', 'tusker swan', 'pelican', 'quail', 'partridge', 'grey partridge', 'ruffed grouse', 'prairie chicken', 'prairie grouse', 'peacock', 'peafowl', 'grouse', 'ptarmigan', 'ptarmigan-like', 'quail-like', 'toucan', 'hornbill', 'hoopoe', 'commonHoopoe', 'macaw', 'sulphur-crested cockatoo', 'cockatoo', 'lorikeet', 'coucal', 'bee eater', 'jacamar', 'hammerhead', 'hammerhead shark', 'white stork', 'flamingo', 'flamingo-like', 'great grey owl', 'great gray owl', 'grey owl', 'european gallinule', 'quail-like', 'night bird', 'bee eater', 'raven', 'frilled lizard', 'alligator lizard', 'agate', 'bittern', 'bittern-like', 'osprey', 'osprey-like', 'pelican', 'sandpiper', 'killdeer', 'eurasian wigeon', 'wigeon', 'teal', 'bluewinged teal', 'green-winged teal', 'greenwinged teal', 'garganey', 'smew', 'red-breasted merganser', 'redbreasted merganser', 'crane', 'demoiselle', 'demoiselle crane', 'white stork', 'whooper swan', 'great white heron', 'great blue heron', 'great white heron-like', 'black swan', 'sulphur-crested cockatoo'] },
  { name: '风景', words: ['seashore', 'coast', 'coastline', 'seacoast', 'sea-coast', 'sandbar', 'sand bar', 'beach', 'lakeside', 'lakeshore', 'ocean', 'ocean floor', 'underwater', 'sea', 'cliff', 'drop-off', 'dropoff', 'valley', 'vale', 'alp', 'mountain', 'mountain range', 'volcano', 'volcanic crater', 'crater', 'volcano-like', 'plateau', 'promontory', 'headland', 'headland-like', 'point', 'points', 'sand dune', 'mound', 'hill', 'slope', 'hillside', 'hill-like', 'waterfall', 'waterfall-like', 'canyon', 'valley', 'valley-like', 'lagoon', 'beach-wear', 'beachwear', 'shore', 'lakeside', 'undersea', 'coral reef', 'coral-reef-like', 'shore bird', 'wading bird', 'wader', 'coast', 'seaside', 'boardwalk', 'promenade', 'esplanade'] },
  { name: '食物', words: ['pizza', 'pizza pie', 'pizza-like', 'hamburger', 'beefburger', 'cheeseburger', 'hotdog', 'hot dog', 'frankfurter', 'hotdog bun', 'frankfurter bun', 'bagel', 'beigel', 'pretzel', 'mashed potato', 'mash potato', 'carbonara', 'carbonara-like', 'pasta', 'spaghetti', 'ravioli', 'ravioli-like', 'macaroni', 'gnocchi', 'gnocchi-like', 'lasagne', 'lasagna', 'ramen', 'noodle', 'noodles', 'pho', 'soba', 'udon', 'lo mein', 'chow mein', 'pad thai', 'fried rice', 'pilaf', 'pilaff', 'pilaw', 'pilau', 'risotto', 'risotto-like', 'paella', 'sushi', 'sashimi', 'nigiri', 'maki', 'tempura', 'tempura-like', 'dim sum', 'wonton', 'egg roll', 'spring roll', 'dumpling', 'dumpling-like', 'steak', 'beef', 'pork', 'pork chop', 'pork roast', 'roast beef', 'roast beef-like', 'veal', 'veal orlov', 'veal orloff', 'trifle', 'trifle-like', 'ice cream', 'icecream', 'ice cream cone', 'icecream cone', 'ice lolly', 'lolly', 'popsicle', 'sorbet', 'sherbet', 'sherbert', 'creme brulee', 'creme caramel', 'flan', 'pancake', 'pancakes', 'waffle', 'waffles', 'muffin', 'cupcake', 'cupcake-like', 'baguette', 'french loaf', 'croissant', 'pain au chocolat', 'doughnut', 'donut', 'bagel', 'cornet', 'ice cream cornet', 'icecream cornet', 'cracker', 'biscuit', 'cookie', 'cookie-like', 'cake', 'cake-like', 'red wine', 'white wine', 'sparkling wine', 'champagne', 'wine', 'beer', 'ale', 'cocktail', 'cocktail shaker', 'espresso', 'coffee', 'cup', 'cup of coffee', 'coffee mug', 'teacup', 'tea', 'teapot', 'guacamole', 'guacamole-like', 'mushroom', 'mushrooms', 'plate', 'plate of food', 'soup', 'soup bowl', 'consomme', 'broth', 'broth-like', 'potpie', 'potpie-like', 'tray', 'dining table', 'kitchen table', 'restaurant', 'cafeteria', 'diner', 'diner-like', 'menu', 'menu card', 'menu board', 'plate rack', 'place mat', 'placemat', 'table', 'table-top', 'tray', 'tray-like', 'wine bottle', 'beer bottle', 'pop bottle', 'soda bottle', 'water bottle', 'carafe', 'water jug', 'pitcher', 'ewer', 'caldron', 'crock pot', 'crockpot', 'slow cooker', 'casserole', 'casserole dish', 'soup plate', 'soup tureen', 'tureen'] },
  { name: '花卉植物', words: ['pot', 'flowerpot', 'flowerpot-like', 'window box', 'windowbox', 'planter', 'planter-like', 'hip', 'rose hip', 'rose', 'rose-like', 'orchid', 'orchidaceae', 'wild orchid', 'orchid-like', 'daisy', 'daisy-like', 'coral plant', 'coral plant-like', 'wood sorrel', 'oxalis', 'yellow oxalis', 'yellow woodsorrel', 'european cranberry', 'cowberry', 'foxberry', 'mountain cranberry', 'corn poppy', 'poppy', 'field poppy', 'papaver rhoeas', 'papaver', 'prickly poppy', 'prickly poppy-like', 'hollyhock', 'hollyhock-like', 'cornflower', 'bachelor button', "bachelor's button", 'cotton', 'cotton plant', 'gossypium', 'snakeroot', 'snakeroot-like', 'blackberry lily', 'leopard lily', 'lily', 'lily-like', 'bellflower', 'campanula', 'yellowbell', 'mermaid', "mermaid's wineglass", 'yellow bell', 'calabura', 'syringa', 'lilac', 'spiraea', 'steeple', 'steeple bush', 'steeplebush', 'spirea', 'bridal wreath', 'bridal wreath spirea', 'meadowsweet', 'meadowsweet-like', 'potentilla', 'potentilla-like', 'cinquefoil', 'marsh cinquefoil', 'purple cinquefoil', 'silverweed', 'silverweed-like', 'silverweed-like', 'wildflower', 'wildflower-like', 'water lily', 'pond lily', 'lotus', 'lotus lily', 'nelumbo', 'nelumbium', 'nymphaea', 'nardoo', 'azalea', 'rhododendron', 'mountain laurel', 'kalmia', 'kalmia latifolia', 'mountain laurel-like', 'trillium', 'wood lily', 'wake robin', 'trillium-like', 'daffodil', 'daffodil-like', 'narcissus', 'jonquil', 'narcissus pseudonarcissus', 'tulip', 'tulip-like', 'tulip tree', 'carnation', 'clove pink', 'clove pink-like', 'gillyflower', 'begonia', 'begonia-like', 'geranium', 'pelargonium', 'pelargonium-like', 'snapdragon', 'antirrhinum', 'fig-marigold', 'figmarigold', 'mesembryanthemum', 'ice plant', 'goldenrod', 'goldenrod-like', 'goldenrod-like', 'aster', 'wood aster', 'michigan daisy', 'aster-like', 'sunflower', 'helianthus', 'helianthus-like', 'purple-fringed orchis', 'purple-fringed orchid', 'platanthera psycodes', 'orchid-like', 'calopogon', 'calopogon pulchellus', 'grass pink', 'grass-pink', 'grasspink', 'ladys slipper', 'ladyslipper', 'cypripedium', 'moccasin flower', 'cypripedium calceolus', 'cypripedium calceolus-like', 'yellow ladys slipper', 'yellow ladyslipper', 'cypripedium parviflorum', 'cypripedium reginae', 'showy ladys slipper', 'showy ladyslipper', 'cypripedium acaule', 'pink ladys slipper', 'pink ladyslipper', 'cypripedium acaule-like', 'ladys slipper', 'ladyslipper', 'moccasin flower-like'] },
  { name: '交通工具', words: ['car', 'auto', 'automobile', 'sports car', 'sport car', 'racer', 'racing car', 'racing car-like', 'convertible', 'jeep', 'landrover', 'land rover', 'limo', 'limousine', 'beach wagon', 'station wagon', 'wagon', 'estate car', 'beach wagon-like', 'wagon', 'cab', 'hack', 'taxi', 'taxicab', 'minivan', 'bus', 'omnibus', 'autobus', 'coach', 'charabanc', 'motor coach', 'streetcar', 'tram', 'tramcar', 'trolley car', 'trolley coach', 'trolley bus', 'trackless trolley', 'school bus', 'ambulance', 'snowplow', 'snowplough', 'tow truck', 'tow car', 'wrecker', 'garbage truck', 'dustcart', 'fire engine', 'fire truck', 'fire engine-like', 'half track', 'tank', 'armored combat vehicle', 'armoured combat vehicle', 'armored car', 'armoured car', 'armored personnel carrier', 'armoured personnel carrier', 'tracked vehicle', 'forklift', 'forklift truck', 'trailer truck', 'tractor trailer', 'trucking rig', 'rig', 'semi', 'semitrailer', 'semitrailer truck', 'lorry', 'articulated lorry', 'artic', 'motor scooter', 'scooter', 'moped', 'motorcycle', 'bike', 'minibike', 'minicycle', 'motorbike', 'trail bike', 'trail bike-like', 'dirt bike', 'dirt bike-like', 'cross bike', 'crossbike', 'bicycle', 'bike', 'wheel', 'bicycle-built-for-two', 'mountain bike', 'off-roader', 'all-terrain bike', 'atb', 'all-terrain vehicle', 'atv', 'tandem bicycle', 'tandem bike', 'tricycle', 'trike', 'cycle', 'cycle-rickshaw', 'rickshaw', 'jinrikisha', 'jinricksha', 'mobility scooter', 'shopping cart', 'shopping cart-like', 'grocery cart', 'shopping basket', 'carriage', 'baby buggy', 'baby carriage', 'pram', 'perambulator', 'go-kart', 'go cart', 'handcart', 'pushcart', 'cart', 'wagon', 'waggon', 'barrow', 'garden cart', 'lawn cart', 'buckboard', 'buckboard-like', 'hay wagon', 'hay wagon-like', 'oxcart', 'bullock cart', 'bullock cart-like', 'horse cart', 'horse-cart', 'mule cart', 'mule-cart', 'donkey cart', 'donkey cart-like', 'jinrikisha', 'dogcart', 'dog-cart', 'dogcart-like', 'pony cart', 'pony-cart', 'poney cart', 'poney-cart'] },
];

// 精简 EN2ZH 直译表（覆盖常见 ImageNet 标签，未覆盖的走兜底）
const EN2ZH = {
  // 截图/文档类
  'web site': '网页', 'website': '网页', 'monitor': '显示器', 'screen': '屏幕', 'crt screen': '显示器',
  'menu': '菜单', 'book jacket': '书封', 'book cover': '书封', 'comic book': '漫画', 'jigsaw puzzle': '拼图',
  'crossword puzzle': '填字游戏', 'notebook': '笔记本', 'binder': '文件夹', 'ring-binder': '活页夹',
  'file': '文件', 'envelope': '信封', 'letter': '信件', 'newspaper': '报纸', 'magazine': '杂志',
  'tabloid': '小报', 'menu board': '菜单板', 'menu card': '菜单', 'keyboard': '键盘',
  'computer keyboard': '电脑键盘', 'space bar': '空格键', 'typewriter keyboard': '打字机键盘',
  'scoreboard': '计分板', 'digital clock': '电子钟', 'quilt': '被子', 'handkerchief': '手帕',
  'paper towel': '纸巾', 'rule': '尺子', 'ruler': '尺子', 'bookcase': '书架', 'bookshop': '书店',
  'library': '图书馆', 'spine': '书脊', 'folder': '文件夹',
  // 动物
  'tabby': '虎斑猫', 'tiger cat': '虎斑猫', 'persian cat': '波斯猫', 'siamese cat': '暹罗猫',
  'egyptian cat': '埃及猫', 'lynx': '猞猁', 'cougar': '美洲狮', 'puma': '美洲狮', 'catamount': '美洲狮',
  'mountain lion': '美洲狮', 'panther': '黑豹', 'jaguar': '美洲豹', 'leopard': '豹', 'snow leopard': '雪豹',
  'cheetah': '猎豹', 'lion': '狮', 'sphynx': '斯芬克斯猫',
  'wolf': '狼', 'timber wolf': '灰狼', 'grey wolf': '灰狼', 'gray wolf': '灰狼', 'white wolf': '白狼',
  'red wolf': '红狼', 'coyote': '郊狼', 'dingo': '澳洲野犬', 'hyena': '鬣狗', 'hyaena': '鬣狗',
  'fox squirrel': '狐松鼠', 'chipmunk': '花栗鼠', 'marmot': '土拨鼠', 'beaver': '海狸',
  'guinea pig': '豚鼠', 'cavy': '豚鼠', 'hamster': '仓鼠', 'porcupine': '豪猪', 'hedgehog': '刺猬',
  'rabbit': '兔', 'hare': '野兔', 'wood rabbit': '木兔', 'cottontail': '棉尾兔', 'angora': '安哥拉兔',
  'indian elephant': '印度象', 'african elephant': '非洲象', 'tusker': '大象', 'ivory': '象牙',
  'masai': '马赛', 'hippopotamus': '河马', 'hippo': '河马', 'rhinoceros': '犀牛',
  'black rhinoceros': '黑犀牛', 'white rhinoceros': '白犀牛', 'indian rhinoceros': '印度犀牛',
  'javan rhinoceros': '爪哇犀牛', 'sumatran rhinoceros': '苏门答腊犀牛', 'tapir': '貘',
  'horse': '马', 'sorghum': '高粱', 'zebra': '斑马', 'donkey': '驴', 'burro': '小驴',
  'mule': '骡子', 'ox': '公牛', 'cow': '牛', 'cattle': '牛', 'bull': '公牛', 'milk can': '奶桶',
  'water buffalo': '水牛', 'bison': '野牛', 'american bison': '美洲野牛', 'european bison': '欧洲野牛',
  'ram': '公羊', 'ibex': '山羊', 'mountain goat': '山羊', 'gazelle': '羚羊', 'impala': '黑斑羚',
  'hartebeest': '大羚羊', 'liger': '狮虎兽', 'llama': '羊驼', 'guanaco': '原驼',
  'alpaca': '羊驼', 'vicuna': '小羊驼', 'vicuña': '小羊驼',
  'orangutan': '猩猩', 'gorilla': '大猩猩', 'chimpanzee': '黑猩猩', 'chimp': '黑猩猩',
  'siamang': '合趾猿', 'gibbon': '长臂猿', 'squirrel monkey': '松鼠猴', 'spider monkey': '蛛猴',
  'baboon': '狒狒', 'macaque': '猕猴', 'colobus': '疣猴', 'guenon': '长尾猴', 'langur': '叶猴',
  'golden retriever': '金毛', 'labrador retriever': '拉布拉多', 'german shepherd': '德牧',
  'poodle': '贵宾', 'chihuahua': '吉娃娃', 'pug': '巴哥', 'pug-dog': '巴哥',
  'shih-tzu': '西施', 'maltese': '马尔济斯', 'pekinese': '北京犬', 'pekingese': '北京犬',
  'siberian husky': '哈士奇', 'husky': '哈士奇', 'akita': '秋田',
  'cock': '公鸡', 'hen': '母鸡', 'ostrich': '鸵鸟', 'rooster': '公鸡', 'peacock': '孔雀',
  'parrot': '鹦鹉', 'macaw': '金刚鹦鹉', 'cockatoo': '葵花鹦鹉', 'lorikeet': '吸蜜鹦鹉',
  'flamingo': '火烈鸟', 'eagle': '鹰', 'bald eagle': '白头海雕', 'vulture': '秃鹫', 'hawk': '鹰',
  'owl': '猫头鹰', 'great grey owl': '大灰猫头鹰', 'great gray owl': '大灰猫头鹰',
  'goose': '鹅', 'swan': '天鹅', 'duck': '鸭', 'pelican': '鹈鹕', 'crane': '鹤',
  'stork': '鹳', 'heron': '鹭', 'penguin': '企鹅', 'seagull': '海鸥',
  'robin': '知更鸟', 'magpie': '喜鹊', 'sparrow': '麻雀', 'finch': '雀', 'goldfinch': '金翅雀',
  'junco': '灯心草雀', 'bunting': '鹀', 'bulbul': '鹎', 'chickadee': '山雀', 'nightingale': '夜莺',
  'crow': '乌鸦', 'raven': '渡鸦', 'toucan': '巨嘴鸟', 'hornbill': '犀鸟',
  'fish': '鱼', 'goldfish': '金鱼', 'eel': '鳗鱼', 'shark': '鲨鱼', 'great white shark': '大白鲨',
  'tiger shark': '虎鲨', 'hammerhead': '双髻鲨', 'stingray': '魟鱼', 'jellyfish': '水母',
  'starfish': '海星', 'sea urchin': '海胆', 'sea cucumber': '海参', 'coral reef': '珊瑚礁',
  'conch': '海螺', 'snail': '蜗牛', 'slug': '蛞蝓', 'chiton': '石鳖', 'chambered nautilus': '鹦鹉螺',
  'nautilus': '鹦鹉螺', 'sea slug': '海蛞蝓',
  'frog': '蛙', 'tree frog': '树蛙', 'tailed frog': '尾蛙', 'bullfrog': '牛蛙',
  'salamander': '蝾螈', 'newt': '蝾螈', 'eft': '水蜥', 'axolotl': '六角恐龙',
  'iguana': '鬣蜥', 'lizard': '蜥蜴', 'alligator lizard': '鳄蜥', 'komodo dragon': '科莫多巨蜥',
  'dragon lizard': '飞蜥', 'frilled lizard': '伞蜥', 'chameleon': '变色龙', 'gecko': '壁虎',
  'crocodile': '鳄鱼', 'american alligator': '美洲鳄', 'gavial': '长吻鳄', 'alligator': '短吻鳄',
  'turtle': '龟', 'sea turtle': '海龟', 'mud turtle': '泥龟', 'terrapin': '水龟', 'box turtle': '箱龟',
  'snake': '蛇', 'boa constrictor': '蟒蛇', 'king snake': '王蛇', 'garter snake': '束带蛇',
  'water snake': '水蛇', 'vine snake': '藤蛇', 'green snake': '绿蛇', 'night snake': '夜蛇',
  'python': '蟒蛇', 'cobra': '眼镜蛇', 'sidewinder': '响尾蛇', 'horned viper': '角蝰', 'viper': '蝰蛇',
  'adder': '蝰蛇', 'copperhead': '铜头蝮', 'cottonmouth': '水蝮蛇', 'pygmy rattlesnake': '侏响尾蛇',
  'rattlesnake': '响尾蛇', 'sea snake': '海蛇', 'moray eel': '海鳗',
  // 风景
  'seashore': '海滩', 'coast': '海岸', 'coastline': '海岸线', 'seacoast': '海岸', 'sea-coast': '海岸',
  'sandbar': '沙洲', 'sand bar': '沙洲', 'beach': '海滩', 'lakeside': '湖滨', 'lakeshore': '湖岸',
  'ocean': '海洋', 'ocean floor': '海底', 'underwater': '水下', 'sea': '海',
  'cliff': '悬崖', 'drop-off': '悬崖', 'dropoff': '悬崖', 'valley': '山谷', 'vale': '谷地',
  'alp': '高山', 'mountain': '山', 'mountain range': '山脉', 'volcano': '火山',
  'volcanic crater': '火山口', 'crater': '火山口', 'plateau': '高原', 'promontory': '海角',
  'headland': '岬角', 'sand dune': '沙丘', 'mound': '土丘', 'hill': '小山', 'slope': '斜坡',
  'hillside': '山坡', 'waterfall': '瀑布', 'canyon': '峡谷', 'lagoon': '潟湖',
  'shore': '岸', 'lakeside': '湖滨', 'undersea': '海底', 'coral reef': '珊瑚礁',
  'boardwalk': '木栈道', 'promenade': '滨海步道', 'esplanade': '滨海大道',
  // 食物
  'pizza': '披萨', 'hamburger': '汉堡', 'beefburger': '汉堡', 'cheeseburger': '芝士汉堡',
  'hotdog': '热狗', 'hot dog': '热狗', 'frankfurter': '法兰克福香肠', 'bagel': '贝果', 'beigel': '贝果',
  'pretzel': '椒盐卷饼', 'mashed potato': '土豆泥', 'carbonara': '奶油培根意面', 'pasta': '意面',
  'spaghetti': '意面', 'ravioli': '意大利饺', 'macaroni': '通心粉', 'gnocchi': '土豆团子',
  'lasagne': '千层面', 'lasagna': '千层面', 'ramen': '拉面', 'noodle': '面', 'noodles': '面',
  'pho': '越南粉', 'soba': '荞麦面', 'udon': '乌冬面', 'fried rice': '炒饭', 'risotto': '烩饭',
  'paella': '西班牙海鲜饭', 'sushi': '寿司', 'sashimi': '刺身', 'tempura': '天妇罗',
  'dim sum': '点心', 'wonton': '馄饨', 'dumpling': '饺子', 'steak': '牛排', 'beef': '牛肉',
  'pork': '猪肉', 'trifle': '英式甜点', 'ice cream': '冰淇淋', 'icecream': '冰淇淋',
  'ice lolly': '冰棍', 'lolly': '棒糖', 'popsicle': '冰棒', 'sorbet': '雪葩', 'sherbet': '果子露',
  'creme brulee': '焦糖布丁', 'pancake': '煎饼', 'waffle': '华夫饼', 'muffin': '玛芬',
  'cupcake': '纸杯蛋糕', 'baguette': '法棍', 'croissant': '可颂', 'doughnut': '甜甜圈', 'donut': '甜甜圈',
  'cookie': '曲奇', 'cake': '蛋糕', 'red wine': '红酒', 'white wine': '白酒', 'champagne': '香槟',
  'wine': '酒', 'beer': '啤酒', 'ale': '麦酒', 'espresso': '浓缩咖啡', 'coffee': '咖啡',
  'cup': '杯子', 'teacup': '茶杯', 'teapot': '茶壶', 'guacamole': '牛油果酱',
  // 人物服饰
  'suit': '西装', 'suit of clothes': '西装', 'bow tie': '领结', 'bowtie': '领结', 'bolo tie': '波洛领带',
  'cowboy hat': '牛仔帽', 'sombrero': '墨西哥宽檐帽', 'mortarboard': '学位帽',
  'military uniform': '军装', 'gown': '长袍', 'lab coat': '白大褂', 'labcoat': '白大褂',
  'feather boa': '羽毛披肩', 'boa': '羽毛披肩', 'miniskirt': '迷你裙', 'bikini': '比基尼',
  'maillot': '连体泳衣', 'brassiere': '胸罩', 'bra': '胸罩', 'pajama': '睡衣', 'pyjama': '睡衣',
  'sweatshirt': '运动衫', 't-shirt': 'T恤', 'jersey': '运动衫', 'cardigan': '开衫',
  'fur coat': '皮草', 'trench coat': '风衣', 'sunglasses': '太阳镜', 'sunglass': '太阳镜',
  'wig': '假发', 'mask': '面具', 'gasmask': '防毒面具', 'gas mask': '防毒面具',
  'balaclava': '头套', 'helmet': '头盔', 'crash helmet': '头盔', 'football helmet': '橄榄球头盔',
  // 交通
  'car': '汽车', 'auto': '汽车', 'automobile': '汽车', 'sports car': '跑车', 'sport car': '跑车',
  'racer': '赛车', 'racing car': '赛车', 'convertible': '敞篷车', 'jeep': '吉普', 'limousine': '豪华轿车',
  'station wagon': '旅行车', 'taxi': '出租车', 'taxicab': '出租车', 'minivan': '小型货车', 'bus': '公交车',
  'ambulance': '救护车', 'fire engine': '消防车', 'fire truck': '消防车', 'tank': '坦克',
  'forklift': '叉车', 'trailer truck': '卡车', 'motorcycle': '摩托车', 'bike': '摩托车',
  'bicycle': '自行车', 'tricycle': '三轮车', 'trike': '三轮车', 'carriage': '马车',
  'baby buggy': '婴儿车', 'baby carriage': '婴儿车', 'pram': '婴儿车',
  // 物品/其他
  'clock': '钟', 'analog clock': '指针钟', 'digital clock': '电子钟', 'hourglass': '沙漏',
  'wall clock': '挂钟', 'grandfather clock': '落地钟', 'pendulum': '钟摆', 'watch': '手表',
  'electric fan': '电风扇', 'blow dryer': '吹风机', 'space heater': '暖风机', 'electric heater': '电暖器',
  'vacuum': '吸尘器', 'vacuum cleaner': '吸尘器', 'dishwasher': '洗碗机', 'washing machine': '洗衣机',
  'dryer': '烘干机', 'electric iron': '电熨斗', 'iron': '熨斗', 'toaster': '烤面包机',
  'microwave': '微波炉', 'refrigerator': '冰箱', 'fridge': '冰箱', 'icebox': '冰箱',
  'stove': '炉子', 'kitchen range': '灶台', 'kitchen stove': '灶台', 'gas stove': '燃气灶',
  'electric stove': '电炉', 'slow cooker': '慢炖锅', 'crock pot': '慢炖锅', 'crockpot': '慢炖锅',
  'espresso maker': '咖啡机', 'coffee maker': '咖啡机', 'waffle iron': '华夫饼机',
  'hair drier': '吹风机', 'hair dryer': '吹风机', 'electric razor': '电动剃须刀',
  'electric toothbrush': '电动牙刷', 'razor': '剃须刀', 'sewing machine': '缝纫机',
  'electric guitar': '电吉他', 'acoustic guitar': '木吉他', 'guitar': '吉他', 'banjo': '班卓琴',
  'cello': '大提琴', 'violin': '小提琴', 'fiddle': '小提琴', 'harp': '竖琴', 'piano': '钢琴',
  'grand piano': '三角钢琴', 'upright': '立式钢琴', 'upright piano': '立式钢琴', 'organ': '管风琴',
  'harpsichord': '羽管键琴', 'accordion': '手风琴', 'piano accordion': '手风琴', 'drum': '鼓',
  'drums': '鼓', 'snare drum': '小军鼓', 'bass drum': '低音鼓', 'drumstick': '鼓槌',
  'maraca': '沙锤', 'gong': '锣', 'cymbal': '镲片', 'triangle': '三角铁', 'xylophone': '木琴',
  'marimba': '马林巴琴', 'steel drum': '钢鼓', 'harmonica': '口琴', 'ocarina': '陶笛',
  'flute': '长笛', 'panpipe': '排箫', 'saxophone': '萨克斯', 'sax': '萨克斯',
  'trumpet': '小号', 'cornet': '短号', 'trombone': '长号', 'French horn': '法国号', 'horn': '圆号',
  'tuba': '大号', 'bugle': '军号', 'didgeridoo': '迪吉里杜管', 'theremin': '特雷门琴',
  // 其他常见
  'analog clock': '指针钟', 'gown': '长袍', 'academic gown': '学位袍',
  'pot': '花盆', 'flowerpot': '花盆', 'window box': '窗台花箱', 'planter': '花盆',
  'comic book': '漫画书', 'jigsaw puzzle': '拼图', 'crossword puzzle': '填字游戏',
  'crossword': '填字游戏', 'sudoku': '数独', 'book jacket': '书封',
  // 屏幕截图相关（兜底归并）
  'menu': '菜单', 'menu card': '菜单', 'menu board': '菜单板', 'scoreboard': '计分板',
  'computer keyboard': '电脑键盘', 'space bar': '空格键', 'typewriter keyboard': '打字机键盘',
  'crossword puzzle': '填字游戏', 'digital clock': '电子钟', 'cracker': '梳打饼',
  'biscuit': '饼干', 'cookie': '曲奇', 'pretzel': '椒盐卷饼', 'bagel': '贝果', 'beigel': '贝果',
  'muffin': '玛芬', 'cupcake': '纸杯蛋糕', 'doughnut': '甜甜圈', 'donut': '甜甜圈',
  'guinea pig': '豚鼠', 'cavy': '豚鼠', 'porcupine': '豪猪', 'hedgehog': '刺猬',
};

// 翻译兜底：未在表中、未命中桶的词返回 null
function translateLabel(label) {
  const k = (label || '').toLowerCase().trim();
  if (!k) return null;
  if (EN2ZH[k]) return EN2ZH[k];
  // 去掉复数 s 重试
  if (k.endsWith('s') && EN2ZH[k.slice(0, -1)]) return EN2ZH[k.slice(0, -1)];
  return null;
}

/* ---------- 自动命名 ----------
 * v2.1 新增：基于图像统计的截图检测（优先于语义桶）
 *   - 截图判定：灰色比>0.35 且 边缘密度>0.12 且 饱和度<0.25
 *     （白底黑字 / 代码 / 网页 / 游戏 UI 都符合：灰像素多、文字边缘密集、低饱和）
 *   - 命名：按主色调细分（深色/浅色/暖色/冷色截图），同色调的会聚到一起
 *   - 立绘/插画/照片：走原有语义桶 + top-1 翻译
 */
function nameCluster(members, fallbackIdx) {
  // 统计簇内每个标签的累计权重（按 prob 加权，更能反映主导词）
  const labelWeight = new Map();
  const labelCount = new Map();
  for (const m of members) {
    for (const t of m.sig.top.slice(0, 10)) {
      labelWeight.set(t.label, (labelWeight.get(t.label) || 0) + t.prob);
      labelCount.set(t.label, (labelCount.get(t.label) || 0) + 1);
    }
  }
  const total = members.length;

  // === 阶段 0：基于图像统计的截图检测（优先级最高）===
  // MobileNet 对游戏截图/代码截图会误判为 comic/book，语义桶命中不可靠
  let grayAvg = 0, edgeAvg = 0, satAvg = 0;
  for (const m of members) {
    grayAvg += m.sig.grayRatio || 0;
    edgeAvg += m.sig.edgeDensity || 0;
    satAvg += m.sig.satMean || 0;
  }
  grayAvg /= total; edgeAvg /= total; satAvg /= total;
  const isScreenshot = grayAvg > 0.35 && edgeAvg > 0.12 && satAvg < 0.28;
  if (isScreenshot) {
    // 按主色调命名：取 hist 三个亮 bin(R7/G7/B7) 和 与 三个暗 bin(R0/G0/B0) 和 比较
    const hist = members[0].sig.hist || new Array(24).fill(0);
    // 取簇内 hist 均值
    const avgHist = new Array(24).fill(0);
    for (const m of members) for (let i = 0; i < 24; i++) avgHist[i] += (m.sig.hist || hist)[i] / total;
    const brightSum = avgHist[7] + avgHist[15] + avgHist[23];   // 最亮 bin
    const darkSum = avgHist[0] + avgHist[8] + avgHist[16];       // 最暗 bin
    const rSum = avgHist.slice(0, 8).reduce((a, b) => a + b, 0);
    const gSum = avgHist.slice(8, 16).reduce((a, b) => a + b, 0);
    const bSum = avgHist.slice(16, 24).reduce((a, b) => a + b, 0);
    if (brightSum > 0.35) return '浅色截图';
    if (darkSum > 0.40) return '深色截图';
    if (rSum > gSum && rSum > bSum) return '暖色截图';
    if (bSum > rSum && bSum > gSum) return '冷色截图';
    return '彩色截图';
  }

  // 阶段 1：语义桶归并 —— 若某桶内标签累计出现次数占总标签计数 > 45%，用桶名
  for (const bucket of SEMANTIC_BUCKETS) {
    const ws = new Set(bucket.words);
    let hitCount = 0, hitWeight = 0, totalWeight = 0;
    for (const [label, cnt] of labelCount) {
      totalWeight += labelWeight.get(label) || 0;
      if (ws.has(label)) { hitCount += cnt; hitWeight += labelWeight.get(label) || 0; }
    }
    // 出现次数占比 > 45%，或权重占比 > 50%
    if (hitCount / total > 0.45 || (totalWeight > 0 && hitWeight / totalWeight > 0.5)) {
      return bucket.name;
    }
  }

  // 阶段 2：top-1 中文翻译 —— 取累计权重最高且能翻译的标签
  const sorted = [...labelWeight.entries()].sort((a, b) => b[1] - a[1]);
  for (const [label] of sorted) {
    const zh = translateLabel(label);
    if (zh) return zh;
  }

  // 阶段 3：兜底 —— 不再输出英文，用「图片组 N」
  return '图片组 ' + (fallbackIdx + 1);
}

/* ---------- 批量分类调度已迁至 main.js ----------
 * v4.0 架构：WD14 推理在 wd14-worker.js（utilityProcess），
 * main.js 逐张调度并写库；本模块负责：
 *   1. prepareWd14Input —— 主进程侧图片预处理（原生解码+缩放）
 *   2. mnCluster —— WD14 未识别图的 MobileNetV2 特征聚类
 *   3. ensureNsfw / detectNsfw —— NSFW 本地检测（轻量，留主进程）
 */

/* MobileNetV2 聚类（WD14 不可用，或 WD14 没认出角色的图走这里）*/
async function mnCluster(paths, loadImage, onProgress) {
  // paths: 图片绝对路径数组；loadImage(path) → nativeImage | null（逐张加载，用完即弃）
  onProgress({ phase: 'extract', done: 0, total: paths.length });
  const features = [];
  for (let i = 0; i < paths.length; i++) {
    try {
      const img = await loadImage(paths[i]);
      if (img && !img.isEmpty()) {
        const sig = await extractSignature(img);
        if (sig) features.push({ path: paths[i], sig });
      }
    } catch (e) { console.warn('[AI] 特征提取失败:', paths[i], e.message); }
    onProgress({ phase: 'extract', done: i + 1, total: paths.length });
  }
  if (!features.length) return [];

  onProgress({ phase: 'cluster', done: 0, total: 1 });
  const k = autoK(features);
  const assignments = kmeans(features, k);
  const clusters = {};
  for (let i = 0; i < features.length; i++) {
    const c = assignments[i];
    if (!clusters[c]) clusters[c] = [];
    clusters[c].push(features[i]);
  }
  const clusterNames = {};
  let groupFallback = 0;
  for (const [c, members] of Object.entries(clusters)) {
    clusterNames[c] = nameCluster(members, groupFallback++);
  }
  onProgress({ phase: 'cluster', done: 1, total: 1 });

  return features.map((f, i) => ({
    path: f.path,
    cluster: assignments[i],
    clusterName: clusterNames[assignments[i]],
    top: f.sig.top.slice(0, 5).map(t => t.label),
    nsfw: null
  }));
}

/* ---------- 单张分类（兼容旧接口，返回 top 标签） ---------- */
async function classifyImage(img) {
  const sig = await extractSignature(img);
  if (!sig) return null;
  return {
    category: sig.top[0] ? sig.top[0].label : 'unknown',
    conf: sig.top[0] ? sig.top[0].prob : 0,
    top: sig.top
  };
}

module.exports = {
  ensure,
  ensureNsfw,
  prepareWd14Input,   // WD14 输入准备（推理在 wd14-worker.js）
  mnCluster,          // WD14 未识别图的 MobileNetV2 聚类
  detectNsfw,         // 单独 NSFW 检测
  nsfwAvailable: () => nsfwAvailable,
  nsfwError: () => nsfwError
};
