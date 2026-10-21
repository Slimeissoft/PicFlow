'use strict';
/* ============================================================
 * PicFlow WD14 推理工作进程（utilityProcess）
 *
 * 为什么独立进程：
 *   WD14 单张 CPU 推理要几秒到几十秒，如果在主进程跑，
 *   整个 UI 会完全卡死（用户反馈"点都点不进去，只能取消"）。
 *   放到独立进程后：
 *     1. 主进程只负责收发消息 + 读写图片，界面永不卡死
 *     2. 内存独立核算，配合 session 选项（关 arena/memPattern）不疯涨
 *     3. 线程数限制 + 进程优先级降级，系统整体不卡顿
 *     4. 取消 = kill 本进程，立即生效
 *
 * 协议（postMessage）：
 *   主进程 → worker:
 *     { type:'init', modelDir }                         初始化并加载模型
 *     { type:'classify', id, width, height, bgra }      推理一张（bgra 为 ArrayBuffer）
 *     { type:'shutdown' }                               退出
 *   worker → 主进程:
 *     { type:'ready', ep, loadMs }                      模型加载完成（ep: 'dml'|'cpu'）
 *     { type:'init-error', error }
 *     { type:'result', id, ok, data | error, inferMs }
 * ============================================================ */

const path = require('path');
const fs = require('fs');
const os = require('os');

/* 降低进程优先级：让系统和其他程序优先，避免"电脑卡顿" */
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch (e) { /* ignore */ }

const TARGET = 1008;
const TH = {
  general: 0.40,   // general 标签阈值
  character: 0.50, // 角色阈值
  copyright: 0.60, // 作品阈值
  style: 0.25
};

let ort = null;
let session = null;
let tagGroups = null;   // { general:[{id,name}], character:[...], copyright:[...] }
let modelKind = 'fp16'; // 'int8' | 'fp16'
let curEp = 'cpu';

/* ---------- 中文映射（角色/作品常见词） ---------- */
const CHAR_ZH = {
  'raiden_shogun': '雷电将军', 'hu_tao': '胡桃', 'ganyu': '甘雨', 'xiao_(genshin_impact)': '魈',
  'kamisato_ayaka': '神里绫华', 'kamisato_ayato': '神里绫人', 'yae_miko': '八重神子',
  'nahida': '纳西妲', 'nilou': '妮露', 'furina': '芙宁娜', 'yoimiya': '宵宫',
  'kaedehara_kazuha': '枫原万叶', 'venti_(genshin_impact)': '温迪', 'zhongli': '钟离', 'klee_(genshin_impact)': '可莉',
  'fischl_(genshin_impact)': '菲谢尔', 'mona_(genshin_impact)': '莫娜', 'diluc_(genshin_impact)': '迪卢克',
  'keqing': '刻晴', 'ningguang': '凝光', 'shenhe_(genshin_impact)': '申鹤', 'albedo_(genshin_impact)': '阿贝多',
  'sangonomiya_kokomi': '珊瑚宫心海', 'arataki_itto': '荒泷一斗', 'raiden_mei': '雷电芽衣',
  'kafka_(honkai:_star_rail)': '卡芙卡', 'silver_wolf_(honkai:_star_rail)': '银狼', 'seele_(honkai:_star_rail)': '希儿',
  'himeko_(honkai:_star_rail)': '姬子', 'march_7th': '三月七', 'dan_heng': '丹恒',
  'firefly_(honkai:_star_rail)': '流萤', 'acheron_(honkai:_star_rail)': '黄泉',
  'artoria_pendragon_(fate)': '阿尔托莉雅', 'jeanne_d\'arc_(fate)': '贞德', 'saber_(fate)': 'Saber',
  'hatsune_miku': '初音未来', 'kagamine_rin': '镜音铃', 'kagamine_len': '镜音连',
  'ama_shikanoko': '鹿乃子', 'frieren': '芙莉莲', 'fern_(sousou_no_frieren)': '菲伦',
  'anya_forger': '阿尼亚', 'yor_forger': '约尔',
  'marin_kitagawa': '北川海梦', 'yuki_suou': '周防有希',
  'nahida_(genshin_impact)': '纳西妲', 'furina_(genshin_impact)': '芙宁娜',
};
const COPY_ZH = {
  'genshin_impact': '原神', 'honkai:_star_rail': '崩坏星穹铁道', 'honkai_impact_3rd': '崩坏3',
  'fate/grand_order': 'FGO', 'fate_(series)': 'Fate', 'azur_lane': '碧蓝航线',
  'girls\'_frontline': '少女前线', 'arknights': '明日方舟', 'blue_archive': '蔚蓝档案',
  'kantai_collection': '舰C', 'uma_musume:_pretty_derby': '赛马娘', 'the_idolmaster': '偶像大师',
  'vocaloid': 'Vocaloid', 'touhou': '东方Project', 'pokemon': '宝可梦',
  'sousou_no_frieren': '葬送的芙莉莲', 'spy_x_family': '间谍过家家',
  'sono_bisque_doll_wa_koi_wo_suru': '更衣人偶坠入爱河',
  'wuthering_waves': '鸣潮', 'zenless_zone_zero': '绝区零',
  'nikke': '胜利女神', 'path_to_nowhere': '无期迷途',
};
function labelZh(label, isChar) {
  if (!label) return '';
  const map = isChar ? CHAR_ZH : COPY_ZH;
  if (map[label]) return map[label];
  return label.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ---------- 模型加载 ----------
 * 优先 INT8（523MB，CPU 上有 VNNI 指令级加速、内存约为 FP16 的一半），
 * 缺失时 fallback FP16（947MB，CPU 上慢，仅兼容旧安装）。
 * 注：DirectML 实测对 fp16（初始化失败）与 int8（MatMulIntegerToFloat 不支持）都不可用，
 * 统一走 CPU。
 *
 * session 选项刻意保守，避免内存疯涨：
 *   enableCpuMemArena: false  → 不预留大块内存池
 *   enableMemPattern: false   → 逐节点分配，峰值内存低
 *   intraOpNumThreads 限 12   → 留 CPU 给系统和界面
 *   executionMode: 'sequential' → 内存更稳
 */
/* ---------- 标签解析 ----------
 * 两个模型来源的标签格式不同：
 *   int8（Mexes 导出）：selected_tags.csv  "tag_id,name,category,count"
 *     category: 0=general, 1=artist(style), 3=copyright, 4=character, 5=meta, 9=rating
 *   fp16（A1yCE 导出）：tags.json  { categories:[{name,offset,count,tags}] }
 * 注意：两者标签顺序有细微差异（int8 版少 2 个标签、character 段错位 1 位），
 * 必须各自用自己文件里的映射，不能混用！
 */
function parseCsvTags(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const groups = { general: [], character: [], copyright: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const firstComma = line.indexOf(',');
    if (firstComma < 0) continue;
    const id = Number(line.slice(0, firstComma));
    if (!Number.isFinite(id)) continue;
    const parts = line.slice(firstComma + 1).split(',');
    parts.pop(); // count
    const catNum = Number(parts.pop());
    const name = parts.join(',');
    if (catNum === 0) groups.general.push({ id, name });
    else if (catNum === 4) groups.character.push({ id, name });
    else if (catNum === 3) groups.copyright.push({ id, name });
  }
  return groups;
}

function parseJsonTags(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups = { general: [], character: [], copyright: [] };
  for (const c of j.categories) {
    const target = c.name === 'general' ? groups.general
      : c.name === 'character' ? groups.character
      : c.name === 'copyright' ? groups.copyright : null;
    if (!target) continue;
    for (let i = 0; i < c.count; i++) target.push({ id: c.offset + i, name: c.tags[i] });
  }
  return groups;
}

/* ---------- 模型加载 ----------
 * 优先 INT8（523MB，CPU 上有 VNNI 加速、内存约为 FP16 的一半，识别质量几乎不变），
 * 缺失时 fallback FP16（947MB，CPU 上慢，兼容旧安装）。
 *
 * session 选项刻意保守，避免内存疯涨：
 *   enableCpuMemArena: false  → 不预留大块内存池
 *   enableMemPattern: false   → 逐节点分配，峰值内存低
 *   intraOpNumThreads 限 12   → 留 CPU 给系统和界面
 *   executionMode: 'sequential' → 内存更稳
 */
async function loadModel(modelDir) {
  ort = require('onnxruntime-node');

  const int8Model = path.join(modelDir, 'pixai-tagger-int8', 'model_int8.onnx');
  const int8Tags = path.join(modelDir, 'pixai-tagger-int8', 'selected_tags.csv');
  const fp16Model = path.join(modelDir, 'pixai-tagger', 'model.onnx');
  const fp16Tags = path.join(modelDir, 'pixai-tagger', 'tags.json');

  let modelPath = null;
  if (fs.existsSync(int8Model) && fs.existsSync(int8Tags)) {
    modelPath = int8Model;
    modelKind = 'int8';
    tagGroups = parseCsvTags(int8Tags);
  } else if (fs.existsSync(fp16Model) && fs.existsSync(fp16Tags)) {
    modelPath = fp16Model;
    modelKind = 'fp16';
    tagGroups = parseJsonTags(fp16Tags);
  } else {
    throw new Error('WD14 模型文件缺失（int8/fp16 均未找到）');
  }

  const baseOpts = {
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    intraOpNumThreads: Math.max(4, Math.min(12, (os.cpus().length || 8) - 4)),
    interOpNumThreads: 1,
    enableCpuMemArena: false,
    enableMemPattern: false
  };

  const t0 = Date.now();

  /* 实测结论（onnxruntime-node 1.20.1 + 本机 Intel Arc）：
   *   FP16 + DML → session 初始化即失败（CPU EP 对 fp16 也不友好）
   *   INT8 + DML → session 能建，但推理时 MatMulIntegerToFloat 不支持 → 崩溃
   * 因此两种模型都走 CPU。INT8 在支持 VNNI 的 CPU 上有指令级加速，
   * 内存也约为 FP16 的一半，是目前最优选择。
   * （未来若接入 FP32 模型，可再按模型类型尝试 DML）
   */
  session = await ort.InferenceSession.create(modelPath, {
    ...baseOpts,
    executionProviders: ['cpu']
  });
  curEp = 'cpu';
  return { ep: 'cpu', kind: modelKind, loadMs: Date.now() - t0 };
}

/* ---------- 预处理：BGRA → letterbox 1008×1008 CHW float32 [-1,1] ---------- */
function preprocess(bgra, w, h) {
  const data = new Float32Array(3 * TARGET * TARGET);
  data.fill(-1); // 黑边 -1
  const offX = Math.floor((TARGET - w) / 2);
  const offY = Math.floor((TARGET - h) / 2);
  const n = TARGET * TARGET;
  const src = new Uint8Array(bgra);
  for (let y = 0; y < h; y++) {
    const rowBase = y * w * 4;
    const dstRow = (offY + y) * TARGET + offX;
    for (let x = 0; x < w; x++) {
      const si = rowBase + x * 4;
      let b = src[si], g = src[si + 1], r = src[si + 2];
      const a = src[si + 3];
      if (a < 255) { // 透明 over white
        const af = a / 255;
        r = r * af + 255 * (1 - af);
        g = g * af + 255 * (1 - af);
        b = b * af + 255 * (1 - af);
      }
      const di = dstRow + x;
      data[di] = r / 127.5 - 1;
      data[n + di] = g / 127.5 - 1;
      data[2 * n + di] = b / 127.5 - 1;
    }
  }
  return new ort.Tensor('float32', data, [1, 3, TARGET, TARGET]);
}

/* ---------- 推理一张 ---------- */
async function classify(bgra, w, h) {
  if (!session) throw new Error('模型未加载');
  const t = preprocess(bgra, w, h);
  const out = await session.run({ [session.inputNames[0]]: t });
  const logits = out[session.outputNames[0]].data;

  // 不同导出版本输出不同：有的输出 logits（需 sigmoid），有的已在图内做 sigmoid。
  // 判定：若所有值都落在 [0,1] → 已是概率，不再转换。（避免二次 sigmoid 压扁高置信度）
  let alreadyProb = true;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (v < 0 || v > 1.0001) { alreadyProb = false; break; }
  }
  let probs;
  if (alreadyProb) {
    probs = logits;
  } else {
    probs = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) probs[i] = 1 / (1 + Math.exp(-logits[i]));
  }

  let bestChar = null, bestCharP = TH.character;
  let bestCopy = null, bestCopyP = TH.copyright;
  for (const item of tagGroups.character) {
    const p = probs[item.id];
    if (p > bestCharP) { bestCharP = p; bestChar = item.name; }
  }
  for (const item of tagGroups.copyright) {
    const p = probs[item.id];
    if (p > bestCopyP) { bestCopyP = p; bestCopy = item.name; }
  }
  // general 取 top（列表 15000 个，取前 10 高于阈值）
  const gen = new Array(tagGroups.general.length);
  for (let i = 0; i < tagGroups.general.length; i++) {
    const g = tagGroups.general[i];
    gen[i] = [g.name, probs[g.id]];
  }
  gen.sort((a, b) => b[1] - a[1]);
  let topGeneral = gen.slice(0, 10).filter(([, p]) => p >= TH.general).map(([t]) => t);
  if (!topGeneral.length) topGeneral = gen.slice(0, 5).map(([t]) => t);

  // 组装分类名：作品·角色 优先
  let category = null;
  let reason = '';
  if (bestChar && bestCopy) { category = labelZh(bestCopy, false) + '·' + labelZh(bestChar, true); reason = 'char+copy'; }
  else if (bestChar) { category = labelZh(bestChar, true); reason = 'char'; }
  else if (bestCopy) { category = labelZh(bestCopy, false); reason = 'copy'; }
  return { category, character: bestChar, copyright: bestCopy, top: topGeneral, charProb: bestCharP, copyProb: bestCopyP, reason, sigmoidApplied: !alreadyProb };
}

/* ---------- 消息循环 ---------- */
process.parentPort.on('message', async e => {
  const msg = e && e.data;
  if (!msg) return;
  if (msg.type === 'init') {
    try {
      const r = await loadModel(msg.modelDir);
      process.parentPort.postMessage({ type: 'ready', ep: r.ep, kind: r.kind, loadMs: r.loadMs });
    } catch (err) {
      process.parentPort.postMessage({ type: 'init-error', error: String(err.message || err) });
    }
  } else if (msg.type === 'classify') {
    const t0 = Date.now();
    try {
      const data = await classify(msg.bgra, msg.width, msg.height);
      const mu = process.memoryUsage();
      process.parentPort.postMessage({
        type: 'result', id: msg.id, ok: true, data, inferMs: Date.now() - t0,
        mem: { rss: mu.rss, heap: mu.heapUsed, external: mu.external, arrayBuffers: mu.arrayBuffers }
      });
    } catch (err) {
      process.parentPort.postMessage({ type: 'result', id: msg.id, ok: false, error: String(err.message || err), inferMs: Date.now() - t0 });
    }
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});
