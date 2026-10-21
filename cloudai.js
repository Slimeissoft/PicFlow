'use strict';
/* ============================================================
 * PicFlow 云端 AI 识别 v2.0
 *
 * 设计变化（v2.0 / PicFlow 1.4）：
 *   放弃了本地 WD14 模型 —— 角色识别准确率不达预期、占用数百 MB 内存、
 *   CPU 推理每张 20-30 秒。改为完全由用户自己的多模态大模型 API 识别。
 *
 * 支持两类接口：
 *   1) OpenAI 兼容（/chat/completions + image_url）
 *      OpenAI / DeepSeek / 通义千问 / Kimi / 豆包 / 硅基流动 / 任何兼容服务
 *   2) Anthropic Messages（/v1/messages + base64 image）
 *      Claude 全系列
 *
 * 隐私策略：NSFW 图绝不上网。
 *   调用方（main.js cloud-classify）先用本地 nsfwjs 检测，
 *   判定为 NSFW 的图片跳过云端，保持本地判定结果。
 * ============================================================ */
const https = require('https');
const http = require('http');
const { URL } = require('url');

/* ---------- 服务商预设：选一个自动填好 baseURL + 推荐模型 ---------- */
const PROVIDERS = {
  openai: {
    label: 'OpenAI (GPT-4o / GPT-5)',
    api: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需支持图片输入的多模态模型'
  },
  claude: {
    label: 'Anthropic Claude',
    api: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    hint: 'Claude 全系列都支持图片输入'
  },
  deepseek: {
    label: 'DeepSeek',
    api: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '需使用 DeepSeek 支持视觉的模型（如无视觉模型，请换其他服务商）'
  },
  qwen: {
    label: '通义千问（阿里云）',
    api: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max',
    hint: 'qwen-vl-max / qwen-vl-plus 支持图片'
  },
  kimi: {
    label: 'Kimi（月之暗面）',
    api: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k-vision-preview',
    hint: '需使用带 vision 的模型'
  },
  doubao: {
    label: '豆包（火山方舟）',
    api: 'openai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-vision-pro-32k-250115',
    hint: 'model 填方舟控制台的推理接入点 ID 或模型名'
  },
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    api: 'openai',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    hint: '聚合平台，可选多种视觉模型'
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    api: 'openai',
    baseURL: '',
    model: '',
    hint: '填任意 OpenAI 兼容服务的地址'
  }
};

function httpPost(urlStr, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('baseURL 无效: ' + urlStr)); }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 90000, () => { req.destroy(); reject(new Error('云端请求超时')); });
    req.write(bodyStr);
    req.end();
  });
}

/* ---------- URL 归一化（兼容用户填不填 /v1） ---------- */
function openaiEndpoint(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未填写 API 地址');
  if (b.endsWith('/chat/completions')) return b;
  return b + '/chat/completions';
}
function anthropicEndpoint(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未填写 API 地址');
  if (b.endsWith('/messages')) return b;
  if (b.endsWith('/v1')) return b + '/messages';
  return b + '/v1/messages';
}

/* ---------- 图片 dataURL 拆分（Anthropic 需要） ---------- */
function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error('图片数据格式无效');
  return { mediaType: m[1], data: m[2] };
}

/* ---------- 识别 Prompt ---------- */
const PROMPT = `你是一个图片分类与内容识别专家。请识别这张图片，严格输出 JSON（不要 markdown 代码块，不要任何额外文字）：
{
  "type": "角色立绘" 或 "游戏场景" 或 "抽卡界面" 或 "游戏截图" 或 "代码截图" 或 "浏览器截图" 或 "照片" 或 "插画" 或 "表情包" 或 "其他",
  "game": "作品/游戏名（中文优先，如 原神/崩坏星穹铁道/明日方舟/FGO；非游戏图填空字符串）",
  "character": "角色名（中文优先；多人或不确定填空字符串）",
  "tags": ["3-6 个内容关键词"],
  "desc": "一句话描述"
}
判断要点：
- 抽卡界面：十连/单抽结果、抽卡按钮、角色立绘排列
- 游戏截图：游戏内实机画面（战斗/地图/菜单/UI）
- 角色立绘：单角色官方美术（半身/全身、纯背景）
- 游戏场景：游戏内风景/场景
- 代码截图：含编程代码（IDE/编辑器/终端）
- 浏览器截图：网页内容（地址栏/正文）
识别不出游戏名或角色名就留空字符串，不要猜测。`;

/* ---------- 统一解析模型返回 ---------- */
function parseResult(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型未返回有效 JSON: ' + String(text || '').slice(0, 120));
  let r;
  try { r = JSON.parse(m[0]); } catch (e) { throw new Error('JSON 解析失败: ' + m[0].slice(0, 120)); }
  let category = String(r.type || '其他').trim() || '其他';
  const game = String(r.game || '').trim();
  const character = String(r.character || '').trim();
  if (game && character) category = game + '·' + character;
  else if (game) category = game;
  else if (character) category = character;
  return {
    category,
    type: String(r.type || '').trim(),
    game,
    character,
    tags: Array.isArray(r.tags) ? r.tags.filter(t => typeof t === 'string').slice(0, 8) : [],
    desc: String(r.desc || '').trim(),
    raw: String(text || '')
  };
}

/* ---------- OpenAI 兼容调用 ---------- */
async function callOpenAI({ imageDataUrl, config }) {
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) throw new Error('未填写 API Key');
  const url = openaiEndpoint(config.baseURL);
  const body = JSON.stringify({
    model: String(config.model || '').trim() || 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }],
    max_tokens: 500,
    temperature: 0.1
  });
  const { status, data } = await httpPost(url, { 'Authorization': 'Bearer ' + apiKey }, body, 90000);
  if (status !== 200) {
    let detail = String(data).slice(0, 200);
    try { const j = JSON.parse(data); detail = (j.error && (j.error.message || j.error.code)) || detail; } catch (e) {}
    throw new Error('HTTP ' + status + '：' + detail);
  }
  let j;
  try { j = JSON.parse(data); } catch (e) { throw new Error('返回非 JSON: ' + String(data).slice(0, 120)); }
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  return parseResult(text);
}

/* ---------- Anthropic (Claude) 调用 ---------- */
async function callAnthropic({ imageDataUrl, config }) {
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) throw new Error('未填写 API Key');
  const url = anthropicEndpoint(config.baseURL);
  const img = splitDataUrl(imageDataUrl);
  const body = JSON.stringify({
    model: String(config.model || '').trim() || 'claude-sonnet-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: PROMPT }
      ]
    }]
  });
  const { status, data } = await httpPost(url, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }, body, 90000);
  if (status !== 200) {
    let detail = String(data).slice(0, 200);
    try { const j = JSON.parse(data); detail = (j.error && (j.error.message || j.error.type)) || detail; } catch (e) {}
    throw new Error('HTTP ' + status + '：' + detail);
  }
  let j;
  try { j = JSON.parse(data); } catch (e) { throw new Error('返回非 JSON: ' + String(data).slice(0, 120)); }
  const block = (j.content || []).find(b => b && b.type === 'text');
  return parseResult(block ? block.text : '');
}

/* ---------- 识别单张图片 ----------
 * config: { provider, api, baseURL, apiKey, model }
 * 返回 { category, type, game, character, tags, desc, raw }
 */
async function classifyImageCloud({ imageDataUrl, config }) {
  const api = (config && config.api) || 'openai';
  if (api === 'anthropic') return callAnthropic({ imageDataUrl, config });
  return callOpenAI({ imageDataUrl, config });
}

/* ---------- 测试配置 ---------- */
async function testConfig(config) {
  const { baseURL, apiKey, model, api } = config || {};
  if (!baseURL || !apiKey) return { ok: false, error: '请填写 API 地址和 API Key' };
  try {
    if (api === 'anthropic') {
      const url = anthropicEndpoint(baseURL);
      const body = JSON.stringify({
        model: String(model || '').trim() || 'claude-sonnet-4-5',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }]
      });
      const { status, data } = await httpPost(url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body, 30000);
      if (status === 200) return { ok: true };
      if (status === 401 || status === 403) return { ok: false, error: 'API Key 无效（' + status + '）' };
      if (status === 404) return { ok: false, error: '地址或模型名不对（404）' };
      return { ok: false, error: 'HTTP ' + status + '：' + String(data).slice(0, 120) };
    }
    const url = openaiEndpoint(baseURL);
    const body = JSON.stringify({
      model: String(model || '').trim() || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5
    });
    const { status, data } = await httpPost(url, { 'Authorization': 'Bearer ' + apiKey }, body, 30000);
    if (status === 200) return { ok: true };
    if (status === 401 || status === 403) return { ok: false, error: 'API Key 无效（' + status + '）' };
    if (status === 404) return { ok: false, error: '地址或模型名不对（404）' };
    return { ok: false, error: 'HTTP ' + status + '：' + String(data).slice(0, 120) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { classifyImageCloud, testConfig, PROVIDERS };
