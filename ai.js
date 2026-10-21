'use strict';
/* ============================================================
 * PicFlow 本地 NSFW 检测模块 v3.0
 *
 * v3.0（PicFlow 1.4）变更：
 *   本地 AI 识别模型（MobileNetV2 / WD14）已全部移除 —— 角色识别
 *   交给用户自己的多模态大模型 API（见 cloudai.js）。
 *   本模块只保留一件事：**本地 NSFW 检测（nsfwjs）**。
 *
 * 为什么保留本地 NSFW：
 *   云端识别的安全前提是"NSFW 图片绝不上网"。上传前先用本地模型
 *   判定，命中 NSFW 的图直接跳过云端，只在本地打标记。
 *
 * 模型：nsfwjs（drawings/hentai/porn/sexy/neutral 五类），
 *   首次使用时从 CDN 下载约 5MB，之后复用浏览器缓存。
 * ============================================================ */

let nsfwModel = null;
let nsfwAvailable = false;
let nsfwError = null;

/* ---------- NSFW 模型初始化（失败不阻塞主流程） ---------- */
async function ensureNsfw() {
  if (nsfwAvailable || nsfwError) return nsfwAvailable;
  try {
    require('@tensorflow/tfjs');
    const nsfwjs = require('nsfwjs');
    nsfwModel = await nsfwjs.load();
    nsfwAvailable = true;
    console.log('[NSFW] nsfwjs 模型加载成功');
  } catch (e) {
    nsfwError = e.message;
    console.warn('[NSFW] 模型不可用:', e.message);
  }
  return nsfwAvailable;
}

/* ---------- NSFW 检测：输入 nativeImage，返回 5 类分数 ---------- */
async function detectNsfw(img) {
  if (!nsfwAvailable) return null;
  try {
    const tf = require('@tensorflow/tfjs');
    const resized = img.resize({ width: 224, height: 224 });
    const buf = resized.toBitmap(); // BGRA
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
    console.warn('[NSFW] 检测失败:', e.message);
    return null;
  }
}

module.exports = {
  ensureNsfw,
  detectNsfw,
  nsfwAvailable: () => nsfwAvailable,
  nsfwError: () => nsfwError
};
