'use strict';
/* ============================================================
 * PicFlow 云端精确识别 v1.0
 *
 * 核心安全策略：NSFW 图绝不上网。
 *   调用方（main.js cloud-classify）必须先用本地 nsfwjs 检测，
 *   判定为非 NSFW 的图才会发到云端大模型。
 *
 * 支持接口：OpenAI 兼容（/v1/chat/completions，content 带 image_url）
 *   覆盖：OpenAI gpt-4o、国内豆包/通义/Kimi/DeepSeek 等兼容服务
 *   只需配置 baseURL + apiKey + model
 *
 * 能力：识别具体游戏名（原神/星铁/明日方舟…）+ 角色名（雷电将军/可莉…）
 *   + 图片类型（角色立绘/游戏场景/抽卡界面/代码截图/浏览器截图/照片/插画）
 *   本地 MobileNetV2 做不到的"按游戏→角色"分类，云端可以精确到。
 * ============================================================ */
const https = require('https');
const http = require('http');
const { URL } = require('url');

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
    req.setTimeout(timeoutMs || 60000, () => { req.destroy(); reject(new Error('云端请求超时')); });
    req.write(bodyStr);
    req.end();
  });
}

const PROMPT = `你是一个游戏图片分类专家。识别这张图片，严格用 JSON 回答（只输出 JSON，不要任何额外文字、不要代码块标记）：
{
  "type": "角色立绘" 或 "游戏场景" 或 "抽卡界面" 或 "游戏截图" 或 "代码截图" 或 "浏览器截图" 或 "照片" 或 "插画" 或 "其他",
  "game": "游戏名（中文，如 原神/崩坏星穹铁道/明日方舟/FGO/碧蓝航线/阴阳师；无法确定或非游戏图填空字符串）",
  "character": "角色名（中文，如 雷电将军/可莉/符华；多人或多角色无法确定填空字符串；非角色图填空字符串）",
  "desc": "一句话描述图片内容"
}
判断要点：
- 抽卡界面：含十连/单抽结果展示、抽卡按钮、角色立绘排列的界面截图
- 游戏截图：游戏内实机画面（战斗/地图/菜单/UI）
- 角色立绘：单个角色的官方美术立绘（半身/全身，纯背景）
- 游戏场景：游戏内风景/场景画面
- 代码截图：含编程代码文本的截图（IDE/编辑器/终端）
- 浏览器截图：网页内容截图（地址栏/网页正文）
game 字段：如果能认出是哪个游戏就填具体名，认不出填空字符串。`;

/* 识别单张图片
 * 参数：{ imageDataUrl, config: { baseURL, apiKey, model } }
 * 返回：{ category, type, game, character, desc, raw }
 *   category = 组装好的分类名（用于侧边栏显示）：
 *     有游戏+角色 → "原神·雷电将军"
 *     有游戏无角色 → "原神"
 *     无游戏 → type（如"抽卡界面"）
 */
async function classifyImageCloud({ imageDataUrl, config }) {
  const { baseURL, apiKey, model } = config || {};
  if (!baseURL || !apiKey) throw new Error('未配置云端 API（baseURL/apiKey）');
  const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({
    model: model || 'gpt-4o',
    messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPT },
      { type: 'image_url', image_url: { url: imageDataUrl } }
    ]}],
    max_tokens: 200,
    temperature: 0.1
  });
  const { status, data } = await httpPost(url, { 'Authorization': 'Bearer ' + apiKey }, body, 60000);
  if (status !== 200) {
    throw new Error('云端 HTTP ' + status + ': ' + String(data).slice(0, 180));
  }
  let j;
  try { j = JSON.parse(data); } catch (e) { throw new Error('云端返回非 JSON: ' + String(data).slice(0, 120)); }
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('云端未返回有效 JSON: ' + text.slice(0, 120));
  let r;
  try { r = JSON.parse(m[0]); } catch (e) { throw new Error('云端 JSON 解析失败: ' + m[0].slice(0, 120)); }

  // 组装分类名
  let category = r.type || '其他';
  if (r.game && r.character && r.character.trim()) category = r.game + '·' + r.character;
  else if (r.game && r.game.trim()) category = r.game;

  return { category, type: r.type || '', game: r.game || '', character: r.character || '', desc: r.desc || '', raw: text };
}

/* 测试配置是否可用（发一个极简请求验证 key） */
async function testConfig(config) {
  const { baseURL, apiKey, model } = config || {};
  if (!baseURL || !apiKey) return { ok: false, error: '请填写 baseURL 和 apiKey' };
  try {
    const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
    const body = JSON.stringify({
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5
    });
    const { status } = await httpPost(url, { 'Authorization': 'Bearer ' + apiKey }, body, 15000);
    if (status === 200) return { ok: true };
    if (status === 401) return { ok: false, error: 'apiKey 无效（401）' };
    if (status === 404) return { ok: false, error: 'baseURL 或 model 不对（404）' };
    return { ok: false, error: 'HTTP ' + status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { classifyImageCloud, testConfig };
