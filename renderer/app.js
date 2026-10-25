'use strict';

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseName = p => String(p).replace(/\\/g, '/').split('/').pop();
const pad2 = n => String(n).padStart(2, '0');
const extRe = /\.[^.]+$/;

function fmtSize(n) {
  if (n == null) return '—';
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function imgDate(i) {
  if (i.exifDate) return i.exifDate;
  const d = new Date(i.mtime);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
const monthOf = i => imgDate(i).slice(0, 7);
const live = i => !i.trashed && !i.missing;
/* 带 NSFW 模式过滤的 live：AI 总览/pill/侧栏统计都要用这个，
 * 避免隐藏 NSFW 时 AI 分类视图还显示 NSFW 图 */
const nsfwModeOf = () => state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
function liveVisible(i) {
  if (!live(i)) return false;
  const m = nsfwModeOf();
  if (m === 'hidden') return !i.nsfw;
  if (m === 'only') return !!i.nsfw;
  return true;
}

/* ================= 多语言 =================
 * 词表在 i18n.js（以简体中文原文为 key），未翻译的文案自动回退中文。
 */
const LANGS = (window.PF_I18N && window.PF_I18N.langs) || [{ id: 'zh-CN', label: '简体中文' }];
const I18N_DICT = (window.PF_I18N && window.PF_I18N.dict) || {};
let LANG = 'zh-CN';
function tr(zh) {
  if (LANG === 'zh-CN') return zh;
  const d = I18N_DICT[LANG];
  return (d && d[zh]) || zh;
}
/* 数量：3 photos / 3枚 / 3 张 */
function pc(n) {
  n = Number(n) || 0;
  if (LANG === 'en') return `${n} photo${n === 1 ? '' : 's'}`;
  if (LANG === 'ja') return `${n}枚`;
  return `${n} ${LANG === 'zh-TW' ? '張' : '张'}`;
}
/* 月份标题：中文/日文用 2026年10月，英文用 2026-10 */
function fmtMonth(key) {
  if (LANG === 'en') return key;
  return `${key.slice(0, 4)}年${+key.slice(5, 7)}月`;
}

/* 刷新写死在 HTML 里的静态文案（启动 / 切换语言时调用） */
function applyLangUI() {
  document.documentElement.lang = LANG === 'zh-TW' ? 'zh-Hant' : LANG;
  const s = $('#search');
  if (s) s.placeholder = tr('搜索文件名、标签、备注…');
  const scan = $('#btn-scan');
  if (scan) scan.textContent = tr('扫描文件夹');
  const guide = $('#btn-guide');
  if (guide) { const l = guide.querySelector('.lbl'); if (l) l.textContent = tr('引导'); }
  const setBtn = $('#btn-cloud-set');
  if (setBtn) {
    const l = setBtn.querySelector('.lbl');
    if (l) l.textContent = tr('设置');
    setBtn.title = tr('设置');
  }
  const multi = $('#btn-multi');
  if (multi) multi.textContent = state.multi ? tr('✓ 完成选择') : tr('☑ 多选');
  if (typeof syncNsfwButton === 'function') syncNsfwButton();
  /* 底部批量操作条 */
  const sbLabels = {
    star: tr('★ 星标'), nsfw: tr('🔞 标记 NSFW'), tag: tr('标签'),
    aicat: tr('标注分类…'), album: tr('相册'), move: tr('移动…'),
    rename: tr('重命名'), trash: tr('移出'), unalbum: tr('移出相册'),
    revive: tr('恢复到图库'), purge: tr('彻底删除'), clearrec: tr('清除记录')
  };
  for (const act of Object.keys(sbLabels)) {
    const b = document.querySelector(`#selbar [data-act="${act}"]`);
    if (b) b.textContent = sbLabels[act];
  }
  const sbx = $('#sb-clear');
  if (sbx) sbx.title = tr('取消选择');
  /* 灯箱 */
  const hint = $('#lb-hint');
  if (hint) hint.textContent = tr('滚轮缩放 · 双击全屏 · 全屏下单击放大 · 拖动查看细节 · ← → 切换 · Esc 退出');
  const lbPrev = $('#lb-prev'), lbNext = $('#lb-next'), lbFull = $('#lb-full'), lbClose = $('#lb-close');
  if (lbPrev) lbPrev.title = tr('上一张 (←)');
  if (lbNext) lbNext.title = tr('下一张 (→)');
  if (lbFull) lbFull.title = $('#lightbox').classList.contains('fullscreen') ? tr('退出全屏 (F)') : tr('全屏显示 (F)');
  if (lbClose) lbClose.title = tr('关闭 (Esc)');
  /* 底部快捷键提示 */
  const hb = $('#hint-bar');
  if (hb) {
    hb.textContent = state.multi
      ? tr('点击图片 选中/取消 · Shift+点击 范围选择 · 选好后用底部操作条批量处理 · 点「完成选择」退出')
      : tr('单击 预览 · 开启右上「多选」后点击图片直接选中 · Ctrl+A 全选 · Del 移出');
  }
}

const ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  album: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.6 13.4 12.6 21.4a2 2 0 0 1-2.8 0L3 14.6V3h11.6l6 6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M11 8v6M8 11h6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8z"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M8 12h8M12 8v8"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
};

/* ================= 状态 ================= */
const state = {
  images: [], albums: [], folders: [], flags: {},
  view: { type: 'all', key: null },
  search: '',
  selected: new Set(),
  multi: false,
  collapsedYears: null, // Set：已折叠的年份；首次渲染只展开最新一年
  collapsedSections: null, // Set：已折叠的区块（date/ftype/aicat）；默认全部收起
  albumsCollapsed: localStorage.getItem('pf.albumsCollapsed') === '1', // 侧栏「整理」相册区是否收起
  size: 168,
  items: [],
  lbIndex: -1,
  lastIdx: -1,
  scanning: false,
  scanDone: 0, scanTotal: 0,
  dupData: null,
  dupStale: true,
  aiRunning: false, aiDone: 0, aiTotal: 0, aiError: ''
};
const byPath = new Map();
function dynamicCats() {
  const s = new Set();
  for (const i of state.images) if (i.aiClusterName) s.add(i.aiClusterName);
  return [...s].sort();
}
const thumbCache = new Map();
const THUMB_CACHE_MAX = 400; // 上限 400 条（约 15-20MB），防止浏览上千张图后无限膨胀
function cacheThumb(p, url) {
  if (thumbCache.size >= THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest !== undefined) thumbCache.delete(oldest);
  }
  thumbCache.set(p, url);
}
const io = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (en.isIntersecting) {
      io.unobserve(en.target);
      loadThumb(en.target.dataset.path, en.target.querySelector('img'));
    }
  }
}, { root: $('#content'), rootMargin: '400px' });

function rebuildIndex() { byPath.clear(); for (const i of state.images) byPath.set(i.path, i); }
function upsert(rec) {
  const ex = byPath.get(rec.path);
  if (ex) Object.assign(ex, rec);
  else { state.images.push(rec); byPath.set(rec.path, rec); }
}
async function refreshLibrary() {
  const lib = await api.getLibrary();
  state.images = lib.images;
  state.albums = lib.albums;
  state.folders = lib.folders;
  state.flags = lib.flags;
  rebuildIndex();
  state.dupStale = true;
  renderSidebar(); renderContent();
}
async function loadThumb(p, imgEl) {
  if (!imgEl) return;
  // 1) 优先走自定义协议：Chromium 直接读缩略图文件（无 IPC、无 base64）
  const it = byPath.get(p);
  if (it && it.thumbUrl) {
    imgEl.onerror = async () => {
      // 缩略图文件缺失（新导入/被清理）→ 回退 IPC 触发重建
      imgEl.onerror = null;
      try {
        const url = await api.getThumb(p);
        if (url && imgEl.isConnected) { imgEl.src = url; return; }
      } catch (e) { /* fallthrough */ }
      const card = imgEl.closest('.card');
      if (card) card.classList.add('file-missing');
    };
    imgEl.src = it.thumbUrl;
    return;
  }
  // 2) 兜底：扫描过程中新记录尚无 thumbUrl，走 IPC（会顺带生成缩略图）
  if (thumbCache.has(p)) { imgEl.src = thumbCache.get(p); return; }
  try {
    const url = await api.getThumb(p);
    if (url && imgEl.isConnected) { cacheThumb(p, url); imgEl.src = url; return; }
  } catch (e) { /* fallthrough */ }
  if (imgEl.isConnected) {
    const card = imgEl.closest('.card');
    if (card) card.classList.add('file-missing');
  }
}

/* ================= 数据视图 ================= */
function currentItems() {
  const v = state.view;
  const nsfwMode = state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
  const base = i => !i.trashed && !i.missing;
  let list;
  if (v.type === 'all') list = state.images.filter(i => base(i));
  else if (v.type === 'star') list = state.images.filter(i => base(i) && i.starred);
  else if (v.type === 'nsfw') list = state.images.filter(i => base(i) && i.nsfw);
  else if (v.type === 'date') list = state.images.filter(i => base(i) && monthOf(i) === v.key);
  else if (v.type === 'ftype') list = state.images.filter(i => base(i) && i.type === v.key);
  else if (v.type === 'aicat') list = state.images.filter(i => base(i) && i.aiClusterName === v.key);
  else if (v.type === 'tag') list = state.images.filter(i => base(i) && (i.tags || []).includes(v.key));
  else if (v.type === 'album') {
    const a = state.albums.find(x => x.id === v.key);
    list = a ? (a.paths || []).map(p => byPath.get(p)).filter(i => i && base(i)) : [];
  } else if (v.type === 'trash') list = state.images.filter(i => i.trashed || i.missing);
  else list = [];

  // NSFW 模式：hidden 隐藏 / shown 全部显示 / only 仅看 NSFW（回收站与 NSFW 专区视图不受影响）
  if (v.type !== 'trash' && v.type !== 'nsfw') {
    if (nsfwMode === 'hidden') list = list.filter(i => !i.nsfw);
    else if (nsfwMode === 'only') list = list.filter(i => i.nsfw);
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(i =>
      i.path.toLowerCase().includes(q) ||
      baseName(i.path).toLowerCase().includes(q) ||
      (i.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (i.note || '').toLowerCase().includes(q));
  }
  if (v.type !== 'trash') list = list.slice().sort((a, b) => imgDate(b).localeCompare(imgDate(a)));
  return list;
}

/* ================= 侧边栏（76px 窄图标栏 Illustash 风格） ================= */
function renderSidebar() {
  const items = state.images.filter(live);
  const v = state.view;
  const act = (t, k) => (v.type === t && (v.key || null) === (k || null)) ? ' active' : '';
  const cnt = n => n ? `<span class="cnt">${n}</span>` : '';

  const starN = items.filter(i => i.starred).length;
  const nsfwN = items.filter(i => i.nsfw).length;
  const trashN = state.images.filter(i => i.trashed || i.missing).length;
  // 待识别：有图还没分类结果（增量模式下点一下只跑这些）
  const pendingAiN = items.filter(i => !i.aiManual && !i.aiCluster).length;
  const nsfwMode = nsfwModeOf();

  // AI 聚类组（动态，用于判断 ai 视图是否可用）
  const aiMap = new Map();
  for (const i of items) if (i.aiClusterName) aiMap.set(i.aiClusterName, (aiMap.get(i.aiClusterName) || 0) + 1);
  const aiGroupN = aiMap.size;
  const classifiedN = [...aiMap.values()].reduce((s, n) => s + n, 0);

  let h = '';
  // 主导航
  h += `<div class="nav-item${act('all', null)}" data-type="all">${ICONS.grid}<span class="lbl">${tr('图库')}</span>${cnt(items.length)}</div>`;
  h += `<div class="nav-item${v.type === 'aicat' && !v.key ? ' active' : act('aicat', v.key)}" data-type="aicat" data-key="">${ICONS.ai}<span class="lbl">${tr('AI 分类')}</span>${cnt(classifiedN)}</div>`;
  h += `<div class="nav-item${act('star', null)}" data-type="star">${ICONS.star}<span class="lbl">${tr('星标')}</span>${cnt(starN)}</div>`;
  // NSFW 专区入口：隐藏模式下不显示（用户要求"点隐藏就把 NSFW 和专区一块藏起来"），
  // 切到"显示全部"或"仅看 NSFW"时才出现
  if (nsfwMode !== 'hidden') {
    h += `<div class="nav-item${act('nsfw', null)}" data-type="nsfw"><span class="nav-emoji">🔞</span><span class="lbl">NSFW</span>${cnt(nsfwN)}</div>`;
  }

  // 「整理」：可点击折叠，相册多的时候一键收进抽屉
  const albumsCollapsed = !!state.albumsCollapsed;
  h += `<div class="nav-sec toggle${albumsCollapsed ? ' collapsed' : ''}" id="sec-albums"
    title="${albumsCollapsed ? tr('展开相册') : tr('收起相册')}" role="button" aria-expanded="${!albumsCollapsed}">
    <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg>
    <span>${tr('整理')}</span>${albumsCollapsed && state.albums.length ? `<span class="sec-n">${state.albums.length}</span>` : ''}
  </div>`;
  if (!albumsCollapsed) {
    // 相册区域：包进滚动容器，避免十几个相册把侧栏塞满
    h += `<div class="nav-albums">`;
    if (state.albums.length) {
      h += state.albums.map(a => `<div class="nav-item${act('album', a.id)}" data-type="album" data-key="${a.id}">${ICONS.album}<span class="lbl">${esc(a.name)}</span>${cnt((a.paths || []).length)}</div>`).join('');
    }
    h += `<div class="nav-item" id="btn-new-album" title="${tr('新建相册')}">${ICONS.album}<span class="lbl">${tr('＋相册')}</span></div>`;
    h += `</div>`;
  }

  // 标签（最多展示前 8 个，其余通过图库视图筛选栏访问）
  const tagMap = new Map();
  for (const i of items) for (const t of (i.tags || [])) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]);
  if (tags.length) {
    h += `<div class="nav-sec">${tr('标签')}</div>`;
    h += tags.slice(0, 8).map(([k, n]) => `<div class="nav-item${act('tag', k)}" data-type="tag" data-key="${esc(k)}" title="${esc(k)}">${ICONS.tag}<span class="lbl">${esc(k)}</span>${cnt(n)}</div>`).join('');
  }

  h += `<div class="nav-sec">${tr('工具')}</div>`;
  h += `<div class="nav-item${act('dup', null)}" data-type="dup">${ICONS.copy}<span class="lbl">${tr('重复')}</span></div>`;
  h += `<div class="nav-item${act('trash', null)}" data-type="trash">${ICONS.trash}<span class="lbl">${tr('回收站')}</span>${cnt(trashN)}</div>`;
  // AI 运行入口（窄栏底部，常驻可见）。未运行时若有待识别图，显示数量提示
  const aiLabel = state.aiRunning
    ? `${state.aiPhaseLabel ? esc(state.aiPhaseLabel) + ' ' : ''}${state.aiDone || 0}/${state.aiTotal || 0}`
    : (pendingAiN ? `AI ${pendingAiN > 999 ? '999+' : pendingAiN}` : 'AI');
  const aiTitle = state.aiRunning
    ? `${esc(state.aiPhaseLabel || 'AI 分析中')} ${state.aiDone || 0}/${state.aiTotal || 0}（点击取消）`
    : (pendingAiN ? `${pendingAiN} 张待识别（点击只处理这些，很快）` : '运行 AI 分析（全部已识别）');
  h += `<div class="nav-sub ai-run${state.aiRunning ? ' busy' : ''}" id="ai-run" title="${aiTitle}">${ICONS.play}<span class="lbl">${aiLabel}</span></div>`;
  if (state.aiError) h += `<div class="nav-sub empty" title="${esc(state.aiError)}">AI错</div>`;

  $('#nav').innerHTML = h;
}

$('#nav').addEventListener('click', e => {
  if (e.target.closest('#btn-new-album')) { newAlbumModal(); return; }
  if (e.target.closest('#ai-run')) { runAiClassify(); return; }
  // 「整理」折叠头：只切换抽屉，不切换视图
  if (e.target.closest('#sec-albums')) {
    state.albumsCollapsed = !state.albumsCollapsed;
    localStorage.setItem('pf.albumsCollapsed', state.albumsCollapsed ? '1' : '0');
    renderSidebar();
    return;
  }
  const el = e.target.closest('[data-type]');
  if (!el || el.classList.contains('head')) return;
  state.view = { type: el.dataset.type, key: el.dataset.key || null };
  state.selected.clear();
  state.lastIdx = -1;
  renderSidebar(); renderContent();
});

/* ================= 内容区 ================= */
function viewTitle() {
  const v = state.view;
  if (v.type === 'all') return tr('全部图片');
  if (v.type === 'star') return tr('星标');
  if (v.type === 'nsfw') return tr('NSFW 专区');
  if (v.type === 'date') return fmtMonth(v.key);
  if (v.type === 'ftype') return v.key;
  if (v.type === 'aicat') return v.key || tr('AI 分类');
  if (v.type === 'tag') return `# ${v.key}`;
  if (v.type === 'album') {
    const a = state.albums.find(x => x.id === v.key);
    return a ? a.name : tr('相册');
  }
  if (v.type === 'trash') return tr('回收站');
  return tr('图库');
}

function renderContent() {
  const v = state.view;
  // 统一清掉上一次内容区插入的附加容器（AI 总览卡片墙 / 筛选栏），
  // 否则从「AI 分类」切到相册或分组时，旧的卡片墙会一直压在内容区上面。
  const staleRoot = $('#ai-overview-root');
  if (staleRoot) staleRoot.remove();

  if (v.type === 'dup') { renderDuplicates(); return; }
  $('#dup-root').classList.add('hidden');
  $('#grid').classList.remove('hidden');
  $('#view-head').classList.remove('hidden');

  const items = state.items = currentItems();
  const sum = items.reduce((s, i) => s + (i.size || 0), 0);
  const title = viewTitle();
  $('#crumb').textContent = `${tr('图库')} / ${title}`;

  let sub;
  if (v.type === 'aicat' && !v.key) {
    // 总览：显示已分类图片数与分类数（网格本身是空的，不显示「0 张」）
    const m = new Map();
    for (const i of state.images.filter(liveVisible)) if (i.aiClusterName) m.set(i.aiClusterName, (m.get(i.aiClusterName) || 0) + 1);
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    sub = `${pc(n)} · ${m.size} ${tr('个分类')}`;
  } else {
    sub = LANG === 'en' ? `${pc(items.length)} · ${fmtSize(sum)}` : `${pc(items.length)} · 合计 ${fmtSize(sum)}`;
  }
  if (v.type === 'trash') {
    const lostN = items.filter(i => i.missing).length;
    sub += ' · 「移出」的图片文件未删除，可恢复';
    if (lostN) sub += ` · 其中 ${lostN} 张原文件已丢失，无法预览/恢复`;
  }
  let head = `<div><div class="view-title">${esc(title)}</div><div class="view-sub">${sub}</div></div>`;
  head += `<div class="head-actions">`;
  if (v.type === 'album') head += `<button class="chip" id="btn-album-rename">${tr('重命名')}</button><button class="chip danger" id="btn-album-del">${tr('删除相册')}</button>`;
  if (v.type === 'aicat' && v.key) head += `<button class="chip" id="btn-cat-rename" title="给这个 AI 分类改个名字">✎ ${tr('重命名分类')}</button>`;
  if (v.type === 'trash') head += `<button class="chip danger" id="btn-clear-rec">${tr('清除全部记录')}</button>`;
  if (v.type !== 'trash' && v.type !== 'dup' && v.type !== 'aicat') head += `<button class="chip" id="btn-ai-head" title="调用你配置的多模态大模型 API 识别图片">⚡ ${tr('AI 识别')}</button>`;
  // AI 总览没有具体图片，不显示「全选 / 缩略图大小」
  const showGridTools = !(v.type === 'aicat' && !v.key);
  if (showGridTools) {
    head += `<button class="chip" id="btn-selall">${tr('全选')}</button>
    <div class="slider-wrap">${ICONS.zoomOut}<input id="thumb-size" type="range" min="110" max="300" value="${state.size}" title="${tr('缩略图大小')}">${ICONS.zoomIn}</div>`;
  }
  head += `</div>`;
  $('#view-head').innerHTML = head;

  if (showGridTools) {
    $('#btn-selall').onclick = selectAll;
    $('#thumb-size').oninput = e => {
      state.size = +e.target.value;
      document.documentElement.style.setProperty('--cell', state.size + 'px');
    };
    $('#thumb-size').onchange = () => { api.setFlag('thumbSize', state.size); };
  }
  const aiHead = $('#btn-ai-head');
  if (aiHead) aiHead.onclick = runAiClassify;
  const catRen = $('#btn-cat-rename');
  if (catRen) catRen.onclick = () => renameCategoryModal(v.key);
  const alBtn = $('#btn-album-del');
  if (alBtn) alBtn.onclick = deleteCurrentAlbum;
  const alRen = $('#btn-album-rename');
  if (alRen) alRen.onclick = renameCurrentAlbum;
  const clr = $('#btn-clear-rec');
  if (clr) clr.onclick = () => clearRecords(state.images.filter(i => i.trashed || i.missing).map(i => i.path));

  // AI 视图：总览显示组卡片墙；选了组显示 pill 横条 + 网格
  if (v.type === 'aicat' && !v.key) {
    renderAiOverview();
    return;
  }
  // AI 视图选了组：上方 pill 横条
  if (v.type === 'aicat' && v.key) {
    renderAiPillBar();
  } else if (v.type === 'all' || v.type === 'star' || v.type === 'nsfw' || v.type === 'tag') {
    // 图库类视图：顶部筛选栏（日期/类型/标签）
    renderFilterBar();
  }

  renderGrid();
}

/* AI 总览：pill 横条（总览+各组）+ 堆叠卡片墙 */
function renderAiOverview() {
  const items = state.images.filter(liveVisible);
  const aiMap = new Map();
  for (const i of items) if (i.aiClusterName) aiMap.set(i.aiClusterName, (aiMap.get(i.aiClusterName) || 0) + 1);
  const aiGroups = [...aiMap.entries()].sort((a, b) => b[1] - a[1]);
  const classified = aiGroups.reduce((s, [, n]) => s + n, 0);

  // pill 横条
  let pills = `<div class="pill-bar">`;
  pills += `<div class="pill-tab active" data-type="aicat" data-key="">${tr('总览')}<span class="cnt">${classified}</span></div>`;
  pills += aiGroups.map(([name, n]) => `<div class="pill-tab" data-type="aicat" data-key="${esc(name)}" title="${esc(name)}">${esc(name)}<span class="cnt">${n}</span></div>`).join('');
  pills += `</div>`;

  // 卡片墙
  let wall = `<div class="stack-wall">`;
  if (!aiGroups.length) {
    wall += `<div class="stack-empty">${tr('尚未分类，点底部「AI」运行智能分析')}</div>`;
  } else {
    for (const [name, n] of aiGroups) {
      // 取该组前 3 张图作堆叠缩略图
      const groupItems = items.filter(i => i.aiClusterName === name).slice(0, 3);
      const thumbs = groupItems.map(it => `<img data-path="${esc(it.path)}" alt="">`).join('');
      const thumbHtml = thumbs
        ? `<div class="stack-thumb">${thumbs}</div>`
        : `<div class="stack-thumb-empty">🖼</div>`;
      wall += `<div class="stack-card" data-type="aicat" data-key="${esc(name)}">
        ${thumbHtml}
        <button class="stack-edit" data-rename="${esc(name)}" title="${tr('重命名分类')}">✎</button>
        <div class="stack-name">${esc(name)}</div>
        <div class="stack-sub">${pc(n)}</div>
      </div>`;
    }
  }
  wall += `</div>`;

  $('#grid').classList.add('hidden');
  const viewHead = $('#view-head');
  // 在 view-head 下方插入 pill+wall（用一个容器）
  let existing = $('#ai-overview-root');
  if (existing) existing.remove();
  const root = document.createElement('div');
  root.id = 'ai-overview-root';
  root.innerHTML = pills + wall;
  // 插到 view-head 之后、grid 之前
  viewHead.parentNode.insertBefore(root, viewHead.nextSibling);
  // 懒加载堆叠卡片里的 img（直接 loadThumb，因为 io 回调对 img 不兼容）
  root.querySelectorAll('.stack-thumb img').forEach(img => {
    if (img.dataset.path) loadThumb(img.dataset.path, img);
  });
  // pill 点击
  root.querySelectorAll('.pill-tab').forEach(p => {
    p.onclick = () => {
      state.view = { type: 'aicat', key: p.dataset.key || null };
      renderSidebar(); renderContent();
    };
  });
  // 卡片点击 → 进组（编辑按钮单独处理，不触发进入）
  root.querySelectorAll('.stack-edit').forEach(btn => {
    btn.onclick = ev => {
      ev.stopPropagation();
      renameCategoryModal(btn.dataset.rename || '');
    };
  });
  root.querySelectorAll('.stack-card[data-key]').forEach(c => {
    c.onclick = ev => {
      if (ev.target.closest('.stack-edit')) return;
      state.view = { type: 'aicat', key: c.dataset.key };
      renderSidebar(); renderContent();
      // 切到分组后回到顶部，避免沿用总览的滚动位置
      const content = $('#content');
      if (content) content.scrollTop = 0;
    };
  });
  // 总览视图里网格/空状态都不该出现，否则会在卡片墙下面露出空网格
  $('#grid').classList.add('hidden');
  $('#empty-state').classList.add('hidden');
  $('#view-head').classList.remove('hidden');
}

/* AI 视图选了组：pill 横条 */
function renderAiPillBar() {
  const items = state.images.filter(liveVisible);
  const aiMap = new Map();
  for (const i of items) if (i.aiClusterName) aiMap.set(i.aiClusterName, (aiMap.get(i.aiClusterName) || 0) + 1);
  const aiGroups = [...aiMap.entries()].sort((a, b) => b[1] - a[1]);
  const classified = aiGroups.reduce((s, [, n]) => s + n, 0);
  const v = state.view;
  let pills = `<div class="pill-bar">`;
  pills += `<div class="pill-tab${v.type === 'aicat' && !v.key ? ' active' : ''}" data-type="aicat" data-key="">${tr('总览')}<span class="cnt">${classified}</span></div>`;
  pills += aiGroups.map(([name, n]) => `<div class="pill-tab${v.type === 'aicat' && v.key === name ? ' active' : ''}" data-type="aicat" data-key="${esc(name)}" title="${esc(name)}">${esc(name)}<span class="cnt">${n}</span></div>`).join('');
  pills += `</div>`;
  let existing = $('#ai-overview-root');
  if (existing) existing.remove();
  const root = document.createElement('div');
  root.id = 'ai-overview-root';
  root.innerHTML = pills;
  $('#view-head').parentNode.insertBefore(root, $('#view-head').nextSibling);
  root.querySelectorAll('.pill-tab').forEach(p => {
    p.onclick = () => {
      state.view = { type: 'aicat', key: p.dataset.key || null };
      renderSidebar(); renderContent();
    };
  });
  $('#grid').classList.remove('hidden');
}

/* 图库视图筛选栏：日期/类型/标签下拉 */
function renderFilterBar() {
  const items = state.images.filter(live);
  const v = state.view;
  // 日期
  const dateMap = new Map();
  for (const i of items) { const k = monthOf(i); dateMap.set(k, (dateMap.get(k) || 0) + 1); }
  const dates = [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  // 类型
  const typeMap = new Map();
  for (const i of items) typeMap.set(i.type, (typeMap.get(i.type) || 0) + 1);
  const types = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  // 标签
  const tagMap = new Map();
  for (const i of items) for (const t of (i.tags || [])) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]);

  let bar = `<div class="filter-bar">`;
  bar += `<span class="filter-label">${tr('日期')}</span><select id="f-date"><option value="">${tr('全部')}</option>`;
  bar += dates.map(([k, n]) => `<option value="${k}"${v.type === 'date' && v.key === k ? ' selected' : ''}>${fmtMonth(k)} (${n})</option>`).join('');
  bar += `</select>`;
  bar += `<span class="filter-label">${tr('类型')}</span><select id="f-type"><option value="">${tr('全部')}</option>`;
  bar += types.map(([k, n]) => `<option value="${esc(k)}"${v.type === 'ftype' && v.key === k ? ' selected' : ''}>${esc(k)} (${n})</option>`).join('');
  bar += `</select>`;
  if (tags.length) {
    bar += `<span class="filter-label">${tr('标签')}</span><select id="f-tag"><option value="">${tr('全部')}</option>`;
    bar += tags.map(([k, n]) => `<option value="${esc(k)}"${v.type === 'tag' && v.key === k ? ' selected' : ''}>${esc(k)} (${n})</option>`).join('');
    bar += `</select>`;
  }
  bar += `</div>`;

  let existing = $('#ai-overview-root');
  if (existing) existing.remove();
  const root = document.createElement('div');
  root.id = 'ai-overview-root';
  root.innerHTML = bar;
  $('#view-head').parentNode.insertBefore(root, $('#view-head').nextSibling);

  const fd = $('#f-date');
  if (fd) fd.onchange = e => { const val = e.target.value; state.view = val ? { type: 'date', key: val } : { type: 'all', key: null }; renderSidebar(); renderContent(); };
  const ft = $('#f-type');
  if (ft) ft.onchange = e => { const val = e.target.value; state.view = val ? { type: 'ftype', key: val } : { type: 'all', key: null }; renderSidebar(); renderContent(); };
  const ftg = $('#f-tag');
  if (ftg) ftg.onchange = e => { const val = e.target.value; state.view = val ? { type: 'tag', key: val } : { type: 'all', key: null }; renderSidebar(); renderContent(); };
}

function renderGrid() {
  const items = state.items;
  const grid = $('#grid');
  document.documentElement.style.setProperty('--cell', state.size + 'px');
  grid.innerHTML = items.map((it, idx) => cardHtml(it, idx)).join('');
  grid.querySelectorAll('.card').forEach(c => io.observe(c));
  syncSelectionUI();
  updateEmptyState(items);
}

function cardHtml(it, idx) {
  const sel = state.selected.has(it.path);
  const d = imgDate(it).slice(0, 10);
  const starBtn = `<button class="star${it.starred ? ' on' : ''}" title="星标">★</button>`;
  const nsfw = it.nsfw ? `<span class="nsfw-badge">18+</span>` : '';
  const aicat = it.aiCategory ? `<span class="aicat-tag">${esc(it.aiCategory)}</span>` : '';
  return `<div class="card${sel ? ' selected' : ''}" data-path="${esc(it.path)}" data-idx="${idx}">
    <img data-path="${esc(it.path)}" alt="">
    <button class="check" title="选中">✓</button>
    ${starBtn}${nsfw}${aicat}
    <div class="hovermeta"><b>${esc(baseName(it.path))}</b><span>${d} · ${esc(it.type)} · ${fmtSize(it.size)}</span></div>
  </div>`;
}

function updateEmptyState(items) {
  const el = $('#empty-state');
  const empty = state.images.filter(live).length === 0 && state.view.type === 'all';
  if (empty) {
    el.classList.remove('hidden');
    $('#grid').classList.add('hidden');
    $('#view-head').classList.add('hidden');
    el.innerHTML = `<div class="empty-card">
      <div class="empty-logo">${ICONS.grid}</div>
      <h2>${tr('欢迎使用 PicFlow 图片管家')}</h2>
      <p>${tr('三步开始整理你的本地图片：')}</p>
      <ol>
        <li><b>${tr('导入')}</b> — ${tr('点击「扫描文件夹」，选择存放图片的目录（自动包含子文件夹）')}</li>
        <li><b>${tr('浏览')}</b> — ${tr('图片按拍摄日期、文件类型自动分类，左侧栏切换视图')}</li>
        <li><b>${tr('整理')}</b> — ${tr('单击看大图；点右上「多选」后点击图片直接选中，可批量打标签、建相册、重命名、移动、删除')}</li>
      </ol>
      <p class="muted">${tr('「重复 / 相似」视图可一键清理重复图片；搜索框支持文件名、标签与备注。')}</p>
      <div class="empty-actions">
        <button class="btn-primary" id="empty-scan">${tr('扫描文件夹')}</button>
        <button class="chip" id="empty-guide">${tr('查看使用引导')}</button>
      </div>
    </div>`;
    $('#empty-scan').onclick = startScan;
    $('#empty-guide').onclick = showGuide;
  } else if (items.length === 0) {
    el.classList.remove('hidden');
    $('#grid').classList.add('hidden');
    el.innerHTML = `<div class="empty-card"><h2>这里空空如也</h2><p>换一个分类视图，或点击右上角「扫描文件夹」导入更多图片。</p></div>`;
  } else {
    el.classList.add('hidden');
    $('#grid').classList.remove('hidden');
    $('#view-head').classList.remove('hidden');
  }
}

/* ================= 选择 ================= */
function toggleSelect(p) {
  if (state.selected.has(p)) state.selected.delete(p);
  else state.selected.add(p);
  syncSelectionUI();
}
function rangeSelect(a, b) {
  const [s, e] = a < b ? [a, b] : [b, a];
  for (let i = s; i <= e; i++) if (state.items[i]) state.selected.add(state.items[i].path);
  syncSelectionUI();
}
function selectAll() {
  const paths = state.items.map(i => i.path);
  const all = paths.every(p => state.selected.has(p));
  if (all) state.selected.clear();
  else paths.forEach(p => state.selected.add(p));
  syncSelectionUI();
}
function syncSelectionUI() {
  $$('#grid .card, #dup-root .card').forEach(c => c.classList.toggle('selected', state.selected.has(c.dataset.path)));
  updateSelbar();
}
function updateSelbar() {
  const bar = $('#selbar');
  const n = state.selected.size;
  if (!n) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#sb-count').innerHTML = `${tr('已选')} <b>${n}</b> ${tr('张图片')}`;
  const v = state.view;
  const set = (act, show) => bar.querySelector(`[data-act="${act}"]`).classList.toggle('hidden', !show);
  set('star', v.type !== 'trash');
  set('nsfw', v.type !== 'trash');
  set('tag', v.type !== 'trash');
  set('aicat', v.type !== 'trash');
  set('album', v.type !== 'trash');
  set('move', v.type !== 'trash');
  set('rename', v.type !== 'trash');
  set('trash', v.type !== 'trash');
  set('unalbum', v.type === 'album');
  set('revive', v.type === 'trash');
  set('purge', true); // 主视图/回收站视图都能彻底删除（送系统回收站）
  set('clearrec', v.type === 'trash');
}

$('#selbar').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) {
    const act = b.dataset.act;
    if (act === 'star') batchStar();
    else if (act === 'nsfw') batchNsfw();
    else if (act === 'tag') tagModal();
    else if (act === 'aicat') categoryModal();
    else if (act === 'album') albumModal();
    else if (act === 'move') moveSelected();
    else if (act === 'rename') renameModal();
    else if (act === 'trash') trashSelected();
    else if (act === 'revive') reviveSelected();
    else if (act === 'purge') purgeSelected();
    else if (act === 'unalbum') removeFromCurrentAlbum();
    else if (act === 'clearrec') clearRecords([...state.selected]);
    return;
  }
  if (e.target.closest('#sb-clear')) { state.selected.clear(); syncSelectionUI(); }
});

/* 网格点击 */
$('#grid').addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const idx = +card.dataset.idx;
  const p = card.dataset.path;
  if (e.target.closest('.star')) { toggleStar(p); return; }
  if (e.target.closest('.check')) { toggleSelect(p); state.lastIdx = idx; return; }
  /* 多选模式：点图即选中（Shift 范围选），不开预览 */
  if (state.multi) {
    if (e.shiftKey && state.lastIdx >= 0) { rangeSelect(state.lastIdx, idx); return; }
    toggleSelect(p); state.lastIdx = idx; return;
  }
  if (e.shiftKey && state.lastIdx >= 0) { rangeSelect(state.lastIdx, idx); return; }
  if (e.ctrlKey || e.metaKey) { toggleSelect(p); state.lastIdx = idx; return; }
  openLightbox(idx);
});

async function toggleStar(p) {
  const it = byPath.get(p);
  if (!it) return;
  it.starred = !it.starred;
  await api.updateImage(p, { starred: !!it.starred });
  $$('#grid .card, #dup-root .card').forEach(c => {
    if (c.dataset.path === p) {
      const b = c.querySelector('.star');
      if (b) b.classList.toggle('on', !!it.starred);
    }
  });
  renderSidebar();
}
async function toggleNsfw(p) {
  const it = byPath.get(p);
  if (!it) return;
  it.nsfw = !it.nsfw;
  await api.updateImage(p, { nsfw: !!it.nsfw });
  renderSidebar();
  renderContent();
}

/* 批量标星 / 批量标记 NSFW（按多数状态取反） */
async function batchStar() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const items = paths.map(p => byPath.get(p)).filter(Boolean);
  const allStarred = items.every(i => i.starred);
  for (const it of items) it.starred = !allStarred;
  await Promise.all(items.map(i => api.updateImage(i.path, { starred: !!i.starred })));
  syncSelectionUI();
  renderSidebar();
  toast(allStarred ? '已取消星标' : `已为 ${paths.length} 张加星标`);
}
async function batchNsfw() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const items = paths.map(p => byPath.get(p)).filter(Boolean);
  const allNsfw = items.every(i => i.nsfw);
  for (const it of items) it.nsfw = !allNsfw;
  await Promise.all(items.map(i => api.updateImage(i.path, { nsfw: !!i.nsfw })));
  state.selected.clear();
  renderSidebar();
  renderContent();
  toast(allNsfw ? '已取消 NSFW 标记' : `已标记 ${paths.length} 张为 NSFW`);
}

/* ================= 重复检测视图 ================= */
async function renderDuplicates() {
  const v = state.view;
  $('#crumb').textContent = '图库 / 重复 / 相似';
  $('#grid').classList.add('hidden');
  $('#empty-state').classList.add('hidden');
  const root = $('#dup-root');
  root.classList.remove('hidden');
  $('#view-head').classList.remove('hidden');
  $('#view-head').innerHTML = `<div>
    <div class="view-title">重复 / 相似检测</div>
    <div class="view-sub">完全重复基于快速哈希，相似图片基于感知哈希（dHash，差异 ≤ 8/64）</div>
  </div><div class="head-actions"><button class="chip" id="btn-redup">重新检测</button></div>`;
  $('#btn-redup').onclick = () => { state.dupStale = true; renderDuplicates(); };

  if (state.dupStale || !state.dupData) {
    root.innerHTML = `<div class="dup-loading">正在分析图片指纹，请稍候…</div>`;
    state.dupData = await api.getDuplicates();
    state.dupStale = false;
  }
  const { exact, similar } = state.dupData;

  // 平铺所有重复项供灯箱浏览
  const flat = [];
  for (const g of exact) flat.push(...g);
  for (const g of similar) flat.push(...g);
  state.items = flat;

  if (!exact.length && !similar.length) {
    root.innerHTML = `<div class="empty-card"><h2>没有发现重复或相似图片</h2><p>当前图库中的图片都是独一无二的。</p></div>`;
    return;
  }

  let h = '';
  if (exact.length) {
    const totalWaste = exact.reduce((s, g) => s + g.slice(1).reduce((x, i) => x + i.size, 0), 0);
    h += `<div class="dup-sec">
      <div class="dup-head"><b>完全重复 · ${exact.length} 组</b><span>可释放约 ${fmtSize(totalWaste)}</span></div>
      ${exact.map((g, gi) => `<div class="dup-sec">
        <div class="dup-head"><span>组 ${gi + 1} · ${g.length} 张 · 可释放 ${fmtSize(g.slice(1).reduce((x, i) => x + i.size, 0))}</span>
          <button class="chip" data-keep="${gi}">保留第 1 张，删除其余</button></div>
        <div class="dup-row">${g.map(i => cardHtml(i, flat.indexOf(i))).join('')}</div>
      </div>`).join('')}
    </div>`;
  }
  if (similar.length) {
    h += `<div class="dup-sec">
      <div class="dup-head"><b>相似图片 · ${similar.length} 组</b><span>画面高度相似，请人工确认</span></div>
      ${similar.map((g, gi) => `<div class="dup-sec">
        <div class="dup-head"><span>组 ${gi + 1} · ${g.length} 张</span></div>
        <div class="dup-row">${g.map(i => cardHtml(i, flat.indexOf(i))).join('')}</div>
      </div>`).join('')}
    </div>`;
  }
  root.innerHTML = h;

  root.querySelectorAll('.card').forEach(c => io.observe(c));
  root.querySelectorAll('[data-keep]').forEach(b => {
    b.onclick = () => {
      const g = exact[+b.dataset.keep];
      state.selected.clear();
      g.slice(1).forEach(i => state.selected.add(i.path));
      syncSelectionUI();
      trashSelected();
    };
  });
  root.onclick = e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const p = card.dataset.path;
    if (e.target.closest('.check')) { toggleSelect(p); return; }
    if (e.ctrlKey || e.metaKey) { toggleSelect(p); return; }
    const idx = flat.findIndex(i => i.path === p);
    openLightbox(idx);
  };
}

/* ================= 灯箱 ================= */
/* 缩放/平移状态：s=倍率，x/y=平移像素（相对居中位置） */
const lbZoom = { s: 1, x: 0, y: 0 };
let lbDrag = null;
let lbDragged = false;
let lbClickTimer = null;          // 全屏下单击要等一下，判断是不是双击
function lbClearClickTimer() {
  if (lbClickTimer) { clearTimeout(lbClickTimer); lbClickTimer = null; }
}

function lbApplyZoom() {
  const img = $('#lb-img');
  if (!img) return;
  const z = lbZoom;
  img.style.transform = (z.s === 1 && !z.x && !z.y) ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
  img.classList.toggle('zoomed', z.s > 1.001);
  $('#lightbox').classList.toggle('zoomed', z.s > 1.001);
  /* 右下角比例牌：x 倍 + 相对原图像素的百分比（100% = 1:1 原始像素） */
  const badge = $('#lb-zoom');
  if (badge) {
    const on = z.s > 1.001;
    badge.classList.toggle('hidden', !on);
    if (on) {
      const pct = lbNatPct();
      badge.textContent = `${z.s < 10 ? z.s.toFixed(1) : Math.round(z.s)}× · ${pct}%`;
      badge.classList.toggle('over', pct > 100);
      badge.title = pct > 100
        ? tr('已超过原图像素，再放大只是插值变糊 · 点击回到 1:1')
        : tr('仍在原图像素以内，细节完整 · 点击切到 1:1');
    }
  }
}
/* 当前显示宽度 / 原图宽度：0.19 表示只用到原图 19% 的像素 */
function lbNativeRatio() {
  const img = $('#lb-img');
  if (!img || !img.naturalWidth || !img.clientWidth) return 1;
  return img.clientWidth / img.naturalWidth;
}
function lbNatPct(s) {
  return Math.round(lbNativeRatio() * (s == null ? lbZoom.s : s) * 100);
}
/* 最大倍率：至少 8 倍；超大图放宽到能摸到原图 1:1（上限 20 倍） */
function lbMaxScale() {
  const r = lbNativeRatio();
  if (!r) return 8;
  return Math.max(8, Math.min(20, (1 / r) * 2));
}
/* 跳到原图 1:1（100% 像素），居中显示 */
function lbSnapNative() {
  const r = lbNativeRatio();
  if (!r) return;
  const s = Math.min(lbMaxScale(), Math.max(1, 1 / r));
  lbZoom.s = s; lbZoom.x = 0; lbZoom.y = 0;
  lbApplyZoom();
  toast(`${tr('原始像素 1:1')} · ${s < 10 ? s.toFixed(1) : Math.round(s)}×`);
}
function lbResetZoom() {
  lbZoom.s = 1; lbZoom.x = 0; lbZoom.y = 0;
  const img = $('#lb-img');
  if (img) img.classList.remove('dragging');
  lbApplyZoom();
}
/* 限制平移范围，别把图片拖出屏幕外 */
function lbClampPan() {
  const img = $('#lb-img');
  const stage = $('.lb-stage');
  if (!img || !stage) return;
  const iw = img.offsetWidth * lbZoom.s;
  const ih = img.offsetHeight * lbZoom.s;
  const maxX = Math.max(0, (iw - stage.clientWidth) / 2 + 30);
  const maxY = Math.max(0, (ih - stage.clientHeight) / 2 + 30);
  lbZoom.x = Math.min(maxX, Math.max(-maxX, lbZoom.x));
  lbZoom.y = Math.min(maxY, Math.max(-maxY, lbZoom.y));
}
/* 以 (clientX, clientY) 为锚点缩放到 scale：该点下的像素保持不动 */
function lbZoomTo(scale, clientX, clientY) {
  const img = $('#lb-img');
  if (!img || $('#lightbox').classList.contains('hidden')) return;
  const s2 = Math.min(lbMaxScale(), Math.max(1, scale));
  const rect = img.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const px = clientX == null ? cx : clientX;
  const py = clientY == null ? cy : clientY;
  const ratio = s2 / lbZoom.s;
  lbZoom.x = (px - cx) - (px - cx - lbZoom.x) * ratio;
  lbZoom.y = (py - cy) - (py - cy - lbZoom.y) * ratio;
  lbZoom.s = s2;
  if (s2 <= 1.001) { lbZoom.s = 1; lbZoom.x = 0; lbZoom.y = 0; }
  lbClampPan();
  lbApplyZoom();
}

async function openLightbox(idx) {
  const it = state.items[idx];
  if (!it) return;
  state.lbIndex = idx;
  lbResetZoom();
  $('#lightbox').classList.remove('hidden');
  const cached = thumbCache.get(it.path);
  $('#lb-img').src = cached || '';
  const full = await api.readImage(it.path);
  if (full && state.lbIndex === idx) $('#lb-img').src = full.dataUrl;
  renderLbPanel(it);
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lightbox').classList.remove('fullscreen');
  lbResetZoom();
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
  $('#lb-img').src = '';
  state.lbIndex = -1;
}
/* 全屏查看：图片铺满窗口（按钮 / F 键触发；单击图片是放大，不再用双击） */
function toggleLightboxFullscreen() {
  const lb = $('#lightbox');
  if (lb.classList.contains('hidden')) return;
  const on = lb.classList.toggle('fullscreen');
  lbResetZoom();
  lbClearClickTimer();
  const fb = $('#lb-full');
  if (fb) fb.title = on ? tr('退出全屏 (F)') : tr('全屏显示 (F)');
  if (on) {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    toast(tr('全屏查看 · 单击放大 · 双击退出'), 2000);
  } else {
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
  }
}
function lbNav(d) {
  const n = state.items.length;
  if (!n) return;
  openLightbox((state.lbIndex + d + n) % n);
}
function renderLbPanel(it) {
  const albums = state.albums.filter(a => (a.paths || []).includes(it.path));
  const starCls = it.starred ? ' on star-on' : '';
  const nsfwCls = it.nsfw ? ' on nsfw-on' : '';
  $('#lb-panel').innerHTML = `
    <div class="lb-name" title="${esc(it.path)}">${esc(baseName(it.path))}</div>
    <div class="lb-tools">
      <button id="lb-star"${starCls}>${it.starred ? '★ ' + tr('已星标') : '☆ ' + tr('加星标')}</button>
      <button id="lb-nsfw"${nsfwCls}>${it.nsfw ? '🔞 NSFW' : tr('🔞 标记 NSFW')}</button>
    </div>
    <div class="lb-aicat">
      <span class="lb-aicat-lbl">${tr('AI 分类')}</span>
      <select id="lb-aicat-sel" class="lb-select">
        <option value="">${tr('未分类')}</option>
        ${dynamicCats().map(c => `<option value="${esc(c)}"${it.aiClusterName === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      ${it.aiManual ? `<span class="lb-manual" title="已手动纠正，重新跑 AI 不会覆盖">${tr('手动')}</span>` : ''}
    </div>
    <div class="lb-info">
      <div><span>${tr('拍摄时间')}</span><b>${it.exifDate ? fmtDate(it.exifDate) : '—'}</b></div>
      <div><span>${tr('修改时间')}</span><b>${fmtDate(it.mtime)}</b></div>
      <div><span>${tr('类型')}</span><b>${esc(it.type)}</b></div>
      <div><span>${tr('大小')}</span><b>${fmtSize(it.size)}</b></div>
    </div>
    <div class="lb-sec">${tr('标签')}</div>
    <div class="tag-editor" id="lb-tags">
      ${(it.tags || []).map(t => `<span class="tag">${esc(t)}<i data-tag="${esc(t)}">✕</i></span>`).join('')}
      <input id="lb-tag-in" placeholder="回车添加">
    </div>
    <div class="lb-sec">${tr('备注')}</div>
    <textarea id="lb-note" rows="3" placeholder="…">${esc(it.note || '')}</textarea>
    <div class="lb-sec">${tr('所属相册')}</div>
    <div>${albums.length ? albums.map(a => `<span class="tag">${esc(a.name)}</span>`).join('') : `<span class="muted">${tr('无')}</span>`}</div>
    <div class="lb-actions">
      <button class="chip" id="lb-folder">${tr('在文件夹中显示')}</button>
      <button class="chip" id="lb-soft-del">${tr('移出图库')}</button>
      <button class="chip danger" id="lb-purge">${tr('彻底删除')}</button>
    </div>`;

  const tagIn = $('#lb-tag-in');
  tagIn.onkeydown = async e => {
    if (e.key === 'Enter' && tagIn.value.trim()) {
      it.tags = [...(it.tags || []), tagIn.value.trim()];
      await api.updateImage(it.path, { tags: it.tags });
      renderLbPanel(it);
      renderSidebar();
      toast(`已添加标签「${tagIn.value.trim()}」`);
    }
  };
  $('#lb-tags').addEventListener('click', async e => {
    const i = e.target.closest('i[data-tag]');
    if (!i) return;
    it.tags = (it.tags || []).filter(t => t !== i.dataset.tag);
    await api.updateImage(it.path, { tags: it.tags });
    renderLbPanel(it);
    renderSidebar();
  });
  $('#lb-note').onchange = async e => {
    it.note = e.target.value;
    await api.updateImage(it.path, { note: it.note });
    toast('备注已保存');
  };
  $('#lb-aicat-sel').onchange = async e => {
    const v = e.target.value;
    it.aiClusterName = v || null;
    it.aiCategory = v || null;
    it.aiManual = !!v;
    it.aiConf = null;
    await api.updateImage(it.path, { aiClusterName: v, aiCategory: v, aiManual: !!v });
    renderLbPanel(it);
    renderSidebar();
    renderGrid();
    toast(v ? `已改为「${v}」` : '已清除分类');
  };
  $('#lb-folder').onclick = () => api.openInFolder(it.path);
  $('#lb-star').onclick = async () => { await toggleStar(it.path); renderLbPanel(it); };
  $('#lb-nsfw').onclick = async () => { await toggleNsfw(it.path); renderLbPanel(it); };
  /* 移出图库（软删）：只改 DB，文件保留，可在回收站恢复 */
  $('#lb-soft-del').onclick = async () => {
    if (!(await confirmModal('移出图片', `将「${baseName(it.path)}」从图库移除？\n文件不会被删除，可在左侧「回收站」中恢复。`, '移出', true))) return;
    const res = await api.trashFiles([it.path]);
    if (res[0] && res[0].ok) {
      closeLightbox();
      await refreshLibrary();
      toast('已移入软件回收站');
    } else {
      toast('移出失败：' + ((res[0] && res[0].error) || '未知错误').slice(0, 60));
    }
  };
  /* 彻底删除：物理文件送系统回收站（可还原），同时清除 PicFlow 记录 */
  $('#lb-purge').onclick = async () => {
    const ok = await confirmModal('彻底删除',
      `将「${baseName(it.path)}」彻底删除？\n文件会被移到 Windows 系统回收站（可从回收站还原），并从 PicFlow 记录中清除。`,
      '彻底删除', true);
    if (!ok) return;
    const res = await api.purgeFiles([it.path]);
    if (res[0] && res[0].ok) {
      closeLightbox();
      await refreshLibrary();
      const m = res[0].method;
      toast(m === 'already-deleted' || m === 'already-gone' ? '文件已不存在，记录已清除'
        : m === 'unlink.fallback' ? '回收站不可用，已永久删除'
        : '已送入系统回收站');
    } else {
      toast('删除失败：' + ((res[0] && res[0].error) || '未知错误').slice(0, 60));
    }
  };
}
$('#lb-prev').onclick = () => lbNav(-1);
$('#lb-next').onclick = () => lbNav(1);
$('#lb-close').onclick = closeLightbox;
/* 全屏：按钮 / F 键 */
$('#lb-full').onclick = toggleLightboxFullscreen;
/* 比例牌：点击在「1:1 原始像素」与「2.6 倍」之间切换 */
$('#lb-zoom').onclick = e => {
  e.stopPropagation();
  if (Math.abs(lbNatPct() - 100) <= 6) { lbResetZoom(); lbZoomTo(2.6); }
  else lbSnapNative();
};
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) $('#lightbox').classList.remove('fullscreen');
});
/* 单击：非全屏不放大（放大靠滚轮，单击只负责还原）；全屏下切换放大/还原。
 * 全屏下延迟 200ms 再执行，好让双击「退出全屏」有机会取消它。 */
$('#lb-img').addEventListener('click', e => {
  if (lbDragged) { lbDragged = false; return; }
  const fs = $('#lightbox').classList.contains('fullscreen');
  if (!fs) {
    if (lbZoom.s > 1.001) lbResetZoom();
    return;
  }
  const cx = e.clientX, cy = e.clientY;
  lbClearClickTimer();
  lbClickTimer = setTimeout(() => {
    lbClickTimer = null;
    if ($('#lightbox').classList.contains('hidden')) return;
    if (lbZoom.s > 1.001) lbResetZoom();
    else lbZoomTo(2.6, cx, cy);
  }, 200);
});
/* 双击：非全屏进全屏，全屏退出全屏 */
$('#lb-img').addEventListener('dblclick', e => {
  e.preventDefault();
  lbClearClickTimer();
  toggleLightboxFullscreen();
});
/* 滚轮平滑缩放（只拦灯箱舞台，信息面板仍可正常滚动） */
$('#lightbox').addEventListener('wheel', e => {
  if ($('#lightbox').classList.contains('hidden')) return;
  if (!e.target.closest('.lb-stage')) return;
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0018);
  lbZoomTo(lbZoom.s * factor, e.clientX, e.clientY);
}, { passive: false });
/* 放大后拖动平移 */
$('#lb-img').addEventListener('pointerdown', e => {
  if (lbZoom.s <= 1.001) return;
  e.preventDefault();
  lbDrag = { x: e.clientX, y: e.clientY, ox: lbZoom.x, oy: lbZoom.y, moved: false };
  $('#lb-img').classList.add('dragging');
  try { $('#lb-img').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
$('#lb-img').addEventListener('pointermove', e => {
  if (!lbDrag) return;
  const dx = e.clientX - lbDrag.x;
  const dy = e.clientY - lbDrag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) lbDrag.moved = true;
  lbZoom.x = lbDrag.ox + dx;
  lbZoom.y = lbDrag.oy + dy;
  lbClampPan();
  lbApplyZoom();
});
const lbEndDrag = e => {
  if (!lbDrag) return;
  lbDragged = lbDrag.moved;
  lbDrag = null;
  $('#lb-img').classList.remove('dragging');
  try { $('#lb-img').releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
};
$('#lb-img').addEventListener('pointerup', lbEndDrag);
$('#lb-img').addEventListener('pointercancel', lbEndDrag);
/* 点击图片以外的空白处：放大时先还原，否则关闭灯箱 */
$('#lightbox').addEventListener('mousedown', e => {
  if (e.target === $('#lightbox') || e.target.classList.contains('lb-stage') || e.target.id === 'lb-hint') {
    if (lbZoom.s > 1.001) { lbResetZoom(); return; }
    closeLightbox();
  }
});

/* ================= 弹窗 ================= */
function showModal(html) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal">${html}</div>`;
  $('#modal-root').append(ov);
  // 用 click 而非 mousedown：避免与按钮 click 事件竞争导致"取消按钮按不动"
  // 只有真正点在遮罩空白处（e.target===ov）才关闭，点 modal 内部任何元素都不关
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  return ov;
}
function confirmModal(title, text, okLabel = '确定', danger = false) {
  return new Promise(resolve => {
    const ov = showModal(`<h3>${esc(title)}</h3><p style="color:#5b616b;line-height:1.7">${esc(text)}</p>
      <div class="modal-foot"><button class="chip" id="cm-cancel">取消</button>
      <button class="btn-primary ${danger ? 'btn-danger' : ''}" id="cm-ok" style="${danger ? 'background:var(--danger);border-color:var(--danger);color:#fff' : ''}">${esc(okLabel)}</button></div>`);
    ov.querySelector('#cm-cancel').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#cm-ok').onclick = () => { ov.remove(); resolve(true); };
  });
}
function newAlbumModal() {
  const ov = showModal(`<h3>新建相册</h3>
    <div class="row"><label class="f-label">相册名称</label><input type="text" id="al-name" placeholder="例如：旅行精选"></div>
    <div class="modal-foot"><button class="chip" id="al-cancel">取消</button><button class="btn-primary" id="al-ok">创建</button></div>`);
  const input = ov.querySelector('#al-name');
  input.focus();
  const create = async () => {
    const name = input.value.trim();
    if (!name) return;
    await api.createAlbum(name);
    ov.remove();
    await refreshLibrary();
    toast(`相册「${name}」已创建`);
  };
  ov.querySelector('#al-cancel').onclick = () => ov.remove();
  ov.querySelector('#al-ok').onclick = create;
  input.onkeydown = e => { if (e.key === 'Enter') create(); };
}
function deleteCurrentAlbum() {
  const a = state.albums.find(x => x.id === state.view.key);
  if (!a) return;
  confirmModal('删除相册', `删除相册「${a.name}」？图片文件本身不会被删除。`, '删除相册', true).then(async ok => {
    if (!ok) return;
    await api.deleteAlbum(a.id);
    state.view = { type: 'all', key: null };
    await refreshLibrary();
    toast('相册已删除');
  });
}
function renameCurrentAlbum() {
  const a = state.albums.find(x => x.id === state.view.key);
  if (!a) return;
  const ov = showModal(`<h3>重命名相册</h3>
    <div class="row"><input type="text" id="ar-name" value="${esc(a.name)}"></div>
    <div class="modal-foot"><button class="chip" id="ar-cancel">取消</button><button class="btn-primary" id="ar-ok">保存</button></div>`);
  const input = ov.querySelector('#ar-name');
  input.focus(); input.select();
  const save = async () => {
    const name = input.value.trim();
    if (!name) return;
    await api.renameAlbum(a.id, name);
    ov.remove();
    await refreshLibrary();
    toast('相册已重命名');
  };
  ov.querySelector('#ar-cancel').onclick = () => ov.remove();
  ov.querySelector('#ar-ok').onclick = save;
  input.onkeydown = e => { if (e.key === 'Enter') save(); };
}

/* 批量打标签 */
function tagModal() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const allTags = [...new Set(state.images.filter(live).flatMap(i => i.tags || []))];
  const ov = showModal(`<h3>为 ${paths.length} 张图片添加标签</h3>
    <div class="row"><label class="f-label">标签名称（回车确认，可多次添加）</label>
    <input type="text" id="tg-in" list="tg-list" placeholder="例如：风景、宠物、待整理">
    <datalist id="tg-list">${allTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
    ${allTags.length ? `<div class="row"><div class="hint">已有标签：${allTags.slice(0, 15).map(t => `<span class="tag" style="cursor:pointer;margin:2px" data-add="${esc(t)}">${esc(t)}</span>`).join('')}</div></div>` : ''}
    <div class="modal-foot"><button class="chip" id="tg-done">完成</button></div>`);
  const input = ov.querySelector('#tg-in');
  input.focus();
  const add = async name => {
    name = name.trim();
    if (!name) return;
    for (const p of paths) {
      const im = byPath.get(p);
      if (im && !(im.tags || []).includes(name)) {
        im.tags = [...(im.tags || []), name];
        await api.updateImage(p, { tags: im.tags });
      }
    }
    toast(`已为 ${paths.length} 张图片添加标签「${name}」`);
    renderSidebar();
  };
  input.onkeydown = e => { if (e.key === 'Enter') { add(input.value); input.value = ''; } };
  ov.querySelectorAll('[data-add]').forEach(el => { el.onclick = () => add(el.dataset.add); });
  ov.querySelector('#tg-done').onclick = () => { ov.remove(); refreshLibrary(); };
}


/* 加入相册（独占式：一张图只属一个相册） */
function albumModal() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const ov = showModal(`<h3>将 ${paths.length} 张图片加入相册</h3>
    <div class="row"><label class="f-label">选择目标相册</label>
    <div class="check-list">${state.albums.length
      ? state.albums.map(a => `<label><input type="radio" name="ab-target" value="${a.id}">${ICONS.album}<span>${esc(a.name)}</span><span class="cnt" style="margin-left:auto;color:var(--muted);font-size:11px">${(a.paths || []).length} 张</span></label>`).join('')
      : '<div class="hint">还没有相册，先在下方创建一个吧。</div>'}</div></div>
    <div class="row"><label class="f-label">或新建相册</label><input type="text" id="ab-new" placeholder="新相册名称"></div>
    <p class="hint" style="margin-top:8px">一张图片只属于一个相册：加入后，这些图片会自动从其他相册移出。</p>
    <div class="modal-foot"><button class="chip" id="ab-cancel">取消</button><button class="btn-primary" id="ab-ok">加入</button></div>`);
  ov.querySelector('#ab-cancel').onclick = () => ov.remove();
  ov.querySelector('#ab-ok').onclick = async () => {
    const picked = ov.querySelector('.check-list input:checked');
    const newName = ov.querySelector('#ab-new').value.trim();
    let targetId = null;
    if (newName) {
      const a = await api.createAlbum(newName);
      targetId = a.id;
    } else if (picked) {
      targetId = picked.value;
    }
    if (!targetId) { toast('请先勾选一个相册，或在下方新建'); return; }
    await api.assignAlbum(targetId, paths);
    ov.remove();
    state.selected.clear();
    syncSelectionUI();
    await refreshLibrary();
    toast(`已将 ${paths.length} 张图片加入相册`);
  };
}
async function removeFromCurrentAlbum() {
  const a = state.albums.find(x => x.id === state.view.key);
  if (!a) return;
  await api.removeFromAlbum(a.id, [...state.selected]);
  await refreshLibrary();
  toast(`已从「${a.name}」移出`);
}

/* 移动 */
async function moveSelected() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const dest = await api.pickMoveDest();
  if (!dest) return;
  const res = await api.moveFiles(paths, dest);
  const ok = res.filter(r => r.ok).length;
  state.selected.clear();
  await refreshLibrary();
  toast(`已移动 ${ok} 张到 ${baseName(dest)}`);
}

/* 批量重命名 */
function buildRenamePairs(items, pattern) {
  const counters = new Map();
  return items.map(it => {
    const d = imgDate(it).slice(0, 10).replace(/-/g, '');
    const dir = it.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const k = (counters.get(dir) || 0) + 1;
    counters.set(dir, k);
    const raw = baseName(it.path).replace(extRe, '');
    const name = pattern
      .replaceAll('{原名}', raw)
      .replaceAll('{日期}', d)
      .replaceAll('{序号}', String(k).padStart(3, '0'))
      .replaceAll('{类型}', (it.type || '').toLowerCase());
    return { path: it.path, newName: name || raw };
  });
}
function renameModal() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const items = paths.map(p => byPath.get(p)).filter(Boolean);

  if (items.length === 1) {
    const it = items[0];
    const cur = baseName(it.path).replace(extRe, '');
    const ov = showModal(`<h3>重命名</h3>
      <div class="row"><label class="f-label">新名称（不含扩展名）</label><input type="text" id="rn-name" value="${esc(cur)}"></div>
      <div class="modal-foot"><button class="chip" id="rn-cancel">取消</button><button class="btn-primary" id="rn-ok">重命名</button></div>`);
    const input = ov.querySelector('#rn-name');
    input.focus(); input.select();
    const go = async () => {
      const name = input.value.trim();
      if (!name || name === cur) { ov.remove(); return; }
      const res = await api.renameFiles([{ path: it.path, newName: name }]);
      ov.remove();
      state.selected.clear();
      await refreshLibrary();
      toast(res[0] && res[0].ok ? '重命名成功' : '重命名失败');
    };
    ov.querySelector('#rn-cancel').onclick = () => ov.remove();
    ov.querySelector('#rn-ok').onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    return;
  }

  const ov = showModal(`<h3>批量重命名 ${items.length} 张</h3>
    <div class="row"><label class="f-label">命名模板</label>
    <input type="text" id="rn-pat" value="{日期}_{序号}">
    <div class="hint">可用占位符：{原名} 原文件名 · {日期} 拍摄日期(YYYYMMDD) · {序号} 三位编号 · {类型} 扩展名</div></div>
    <div class="row"><label class="f-label">预览（前 5 项）</label><div class="rename-preview" id="rn-prev"></div></div>
    <div class="modal-foot"><button class="chip" id="rn-cancel">取消</button><button class="btn-primary" id="rn-ok">执行重命名</button></div>`);
  const pat = ov.querySelector('#rn-pat');
  const prev = ov.querySelector('#rn-prev');
  const upd = () => {
    const pairs = buildRenamePairs(items, pat.value.trim() || '{原名}');
    prev.innerHTML = pairs.slice(0, 5).map((p, i) => `${i + 1}. ${esc(baseName(p.path))} → <b>${esc(p.newName + (p.path.match(extRe) || [''])[0])}</b>`).join('<br>');
  };
  pat.oninput = upd; upd();
  ov.querySelector('#rn-cancel').onclick = () => ov.remove();
  ov.querySelector('#rn-ok').onclick = async () => {
    const pairs = buildRenamePairs(items, pat.value.trim() || '{原名}');
    ov.remove();
    const res = await api.renameFiles(pairs);
    const ok = res.filter(r => r.ok).length;
    state.selected.clear();
    await refreshLibrary();
    toast(`重命名完成：${ok}/${pairs.length}`);
  };
}

/* 删除 / 清理 */
async function trashSelected() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const ok = await confirmModal('移出图片',
    `将选中的 ${paths.length} 张图片从图库移除？\n文件不会被删除，可在左侧「回收站」中恢复。`,
    '移入软件回收站', true);
  if (!ok) return;
  const res = await api.trashFiles(paths);
  const okN = res.filter(r => r.ok).length;
  const failN = res.length - okN;
  state.selected.clear();
  state.dupStale = true;
  await refreshLibrary();
  if (failN === 0) {
    toast(`已将 ${okN} 张图片移入软件回收站`);
  } else {
    const errs = res.filter(r => !r.ok).map(r => baseName(r.path) + ': ' + (r.error || '未知错误').slice(0, 80));
    toast(`成功 ${okN} 张，失败 ${failN} 张`);
    setTimeout(() => confirmModal('删除失败', errs.join('\n'), '知道了'), 500);
  }
}
async function clearRecords(paths) {
  if (!paths || !paths.length) return;
  const ok = await confirmModal('清除记录', `清除 ${paths.length} 条失效/已删除记录？此操作只影响 PicFlow 的记录，不会删除任何文件。`, '清除记录', true);
  if (!ok) return;
  await api.removeRecords(paths);
  state.selected.clear();
  await refreshLibrary();
  toast('记录已清除');
}

/* 从软件回收站恢复图片到主视图（不碰物理文件） */
async function reviveSelected() {
  const paths = [...state.selected];
  if (!paths.length) return;
  await api.reviveFiles(paths);
  state.selected.clear();
  await refreshLibrary();
  toast(`已恢复 ${paths.length} 张图片到图库`);
}

/* 彻底删除：把物理文件送到 Windows 系统回收站（可从系统回收站还原），
 * 并清除 PicFlow 记录。与"清除记录"不同：那个只删记录不碰文件，
 * 这个真正删除文件。NSFW 图片同样走本地路径，绝不上传。 */
async function purgeSelected() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const ok = await confirmModal('彻底删除',
    `将选中的 ${paths.length} 张图片彻底删除？\n` +
    `文件会被移到 Windows 系统回收站（可从系统回收站还原），并从 PicFlow 记录中清除。\n` +
    `如果只想从软件移除但保留文件，请用「清除记录」。`,
    '彻底删除', true);
  if (!ok) return;
  const res = await api.purgeFiles(paths);
  const okN = res.filter(r => r.ok).length;
  const failN = res.length - okN;
  state.selected.clear();
  state.dupStale = true;
  await refreshLibrary();
  if (failN === 0) {
    toast(`已将 ${okN} 张图片送入系统回收站`);
  } else {
    const errs = res.filter(r => !r.ok).map(r => baseName(r.path) + ': ' + (r.error || '未知错误').slice(0, 80));
    toast(`成功 ${okN} 张，失败 ${failN} 张`);
    setTimeout(() => confirmModal('删除失败', errs.join('\n'), '知道了'), 500);
  }
}

/* ================= 扫描 ================= */
async function startScan() {
  const folder = await api.pickFolder();
  if (!folder) return;
  const r = await api.scanFolder(folder);
  if (r && r.busy) toast('正在扫描中，请稍候…');
}

/* ================= Toast / 状态 ================= */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toast-root').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2400);
}
function updatePill() {
  const el = $('#status-pill');
  if (state.scanning) {
    el.className = 'pill amber';
    el.textContent = `${tr('扫描中')} ${state.scanDone}/${state.scanTotal}`;
  } else {
    el.className = 'pill green';
    const n = state.images.filter(live).length;
    el.textContent = LANG === 'en' ? `${pc(n)} in library` : `${tr('已收录')} ${pc(n)}`;
  }
}

/* ================= 使用引导 ================= */
function showGuide() {
  const ov = showModal(`<h3>使用引导</h3>
    <div class="g-step"><span class="g-num">1</span><div><b>导入图片</b>
      <p>点击右上角「扫描文件夹」，选择存放图片的目录。PicFlow 会自动扫描所有子文件夹中的 JPG / PNG / WebP / GIF / BMP 图片，并生成缩略图缓存。</p></div></div>
    <div class="g-step"><span class="g-num">2</span><div><b>浏览与智能分类</b>
      <p>图片按拍摄日期（优先 EXIF）与文件类型自动归类。左侧「智能分类」可点击 <b>运行 AI 分类</b>，应用内置的轻量模型（MobileNet，完全离线）会把图片自动归入 <b>角色图 / 风景图 / 插画·CG / 动物·萌宠 / 物品·道具 / 美食 / 截图 / 其他</b>，分错的可在图片详情面板手动纠正。顶部搜索框支持文件名、标签、备注关键词；已扫描的文件夹有新图时会自动同步进图库。</p></div></div>
    <div class="g-step"><span class="g-num">3</span><div><b>星标与 NSFW</b>
      <p>悬停缩略图点右上角 <b>★</b> 加星标；NSFW 图片可手动标记（缩略图右下角红角标）。顶部 <b>NSFW 已隐藏</b> 开关一键隐藏/显示所有 NSFW 图片。</p></div></div>
    <div class="g-step"><span class="g-num">4</span><div><b>整理与预览</b>
      <p>左上角圆圈选中（Ctrl 多选 / Shift 范围选），底部工具条批量打标签、星标、相册、移动、重命名、移出（进软件回收站可恢复）。单击图片看大图，<b>右上角红色 ✕</b> 或 <b>Esc</b> 关闭预览。「重复 / 相似」视图可一键清理重复图片。</p></div></div>
    <div class="modal-foot"><button class="btn-primary" id="guide-ok">开始使用</button></div>`);
  ov.querySelector('#guide-ok').onclick = () => { ov.remove(); api.setFlag('guided', true); };
}

/* ================= 快捷键 ================= */
document.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === 'Escape') {
    if ($('#modal-root').children.length) { $('#modal-root').lastChild.remove(); return; }
    if (!$('#lightbox').classList.contains('hidden')) {
      // 放大状态下先还原，再按一次才关闭
      if (lbZoom.s > 1.001) { lbResetZoom(); return; }
      closeLightbox();
    }
    return;
  }
  if (!$('#lightbox').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleLightboxFullscreen(); }
    if (e.key === '1') { e.preventDefault(); lbSnapNative(); }
    if (state.lbIndex >= 0 && state.items[state.lbIndex]) {
      const it = state.items[state.lbIndex];
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleStar(it.path).then(() => renderLbPanel(it)); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); toggleNsfw(it.path).then(() => renderLbPanel(it)); }
    }
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault(); selectAll(); return;
  }
  if (e.key === 'Delete' && state.selected.size && state.view.type !== 'trash') { trashSelected(); return; }
  if (e.key === ' ' && state.lastIdx >= 0 && state.items[state.lastIdx]) {
    e.preventDefault(); openLightbox(state.lastIdx);
  }
});

/* ================= 顶栏 ================= */
$('#btn-scan').onclick = startScan;
$('#btn-guide').onclick = showGuide;
$('#btn-cloud-set').onclick = () => settingsModal('general');
$('#btn-menu').onclick = () => $('#sidebar').classList.toggle('collapsed');
/* 多选模式开关：开启后点图即选中，圆圈显示；退出时清空选择 */
$('#btn-multi').onclick = () => {
  state.multi = !state.multi;
  const btn = $('#btn-multi');
  btn.classList.toggle('on', state.multi);
  btn.textContent = state.multi ? tr('✓ 完成选择') : tr('☑ 多选');
  $('#grid').classList.toggle('multi', state.multi);
  $('#hint-bar').textContent = state.multi
    ? tr('点击图片 选中/取消 · Shift+点击 范围选择 · 选好后用底部操作条批量处理 · 点「完成选择」退出')
    : tr('单击 预览 · 开启右上「多选」后点击图片直接选中 · Ctrl+A 全选 · Del 移出');
  if (!state.multi) { state.selected.clear(); syncSelectionUI(); }
};
$('#btn-nsfw').onclick = () => {
  // 三态循环：隐藏 → 显示全部 → 仅看 NSFW
  const cur = state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
  const next = cur === 'hidden' ? 'shown' : (cur === 'shown' ? 'only' : 'hidden');
  state.flags.nsfwMode = next;
  api.setFlag('nsfwMode', next);
  syncNsfwButton();
  // 切换模式后立即重渲染：侧栏专区入口显隐 + AI 视图/图库重新按 NSFW 过滤
  renderSidebar();
  renderContent();
  renderSidebar();
  renderContent();
};
function syncNsfwButton() {
  const mode = state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
  const btn = $('#btn-nsfw');
  btn.classList.toggle('show', mode !== 'hidden');
  btn.innerHTML = mode === 'hidden' ? '● ' + tr('NSFW 已隐藏')
    : mode === 'shown' ? '● ' + tr('NSFW 显示中')
    : '🔞 ' + tr('仅看 NSFW');
}
let searchTimer = null;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    renderContent();
  }, 160);
});

/* ================= 扫描事件 ================= */
let gridTimer = null;
function scheduleGrid() {
  if (gridTimer) return;
  gridTimer = setTimeout(() => {
    gridTimer = null;
    renderSidebar();
    if (state.view.type !== 'dup') renderContent();
    updatePill();
  }, 400);
}

/* ================= AI 分类（云端多模态大模型） ================= */
async function runAiClassify() {
  if (state.aiRunning) return;
  const cfg = state.flags.cloudAI || {};
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    const go = await confirmModal(
      '需要先配置 AI 接口',
      'AI 识别使用你自己的多模态大模型 API（OpenAI / Claude / DeepSeek / 通义千问 / Kimi / 豆包 / 硅基流动等）。\n\n图片识别会产生少量 API 费用，由你的账号承担。\n\n现在去配置吗？',
      '去配置'
    );
    if (go) cloudConfigModal();
    return;
  }

  // 增量优先：只处理还没有分类结果的图；全部已分类才询问是否全量重跑
  const candidates = state.images.filter(i => !i.trashed && !i.missing && !i.aiManual);
  const pending = candidates.filter(i => !i.aiCategory).length;
  let redo = false;
  if (candidates.length && pending === 0) {
    const ok = await confirmModal(
      '全部重跑 AI 分类',
      `当前 ${candidates.length} 张图都已有分类结果，没有待识别的图。\n\n全部重跑会重新调用 API 识别所有图片（消耗额度）。如果只是想让新导入的图归类，点「取消」即可。`,
      '全部重跑', true
    );
    if (!ok) return;
    redo = true;
  }

  state.aiRunning = true; state.aiDone = 0; state.aiError = '';
  renderSidebar();
  try {
    const r = await api.aiClassifyAll({ redo, nsfw: true });
    if (r && r.busy) { toast('AI 分类正在进行中…'); return; }
    if (r && r.error) { state.aiError = r.error; toast('AI 分类失败：' + r.error); }
  } catch (e) {
    state.aiError = String(e.message || e);
    toast('AI 分类失败：' + state.aiError);
  } finally {
    state.aiRunning = false;
    renderSidebar();
  }
}

/* ================= 设置（语言 / AI / 外观 / 数据 / 关于） ================= */
let _providersCache = null;
let _appInfoCache = null;

/* 切换语言：立即刷新静态文案（侧栏/内容区由调用方重绘） */
function setLanguage(id) {
  LANG = LANGS.some(l => l.id === id) ? id : 'zh-CN';
  document.documentElement.lang = LANG === 'zh-TW' ? 'zh-Hant' : LANG;
  applyLangUI();
}

async function settingsModal(initialTab = 'general') {
  const cfg = state.flags.cloudAI || {};
  if (!_providersCache) {
    try { _providersCache = await api.cloudProviders(); } catch (e) { _providersCache = {}; }
  }
  if (!_appInfoCache) {
    try { _appInfoCache = await api.appInfo(); } catch (e) { _appInfoCache = {}; }
  }
  const providers = _providersCache;
  const info = _appInfoCache || {};
  const cur = cfg.provider && providers[cfg.provider] ? cfg.provider : 'openai';
  const autoCheck = state.flags.autoUpdateCheck !== false;
  const liveN = state.images.filter(i => !i.trashed && !i.missing).length;
  const catN = new Set(state.images.map(i => i.aiClusterName).filter(Boolean)).size;

  const tabDefs = [
    ['general', tr('常规')],
    ['ai', tr('AI 识别')],
    ['appearance', tr('外观')],
    ['data', tr('数据')],
    ['about', tr('关于')]
  ];

  const ov = showModal(`
    <div class="settings-modal">
      <h3>${tr('设置')}</h3>
      <div class="settings-tabs">
        ${tabDefs.map(([k, label]) => `<button class="settings-tab${k === initialTab ? ' active' : ''}" data-tab="${k}">${label}</button>`).join('')}
      </div>
      <div class="settings-body">
        <div class="settings-pane${initialTab === 'general' ? ' active' : ''}" data-pane="general">
          <div class="settings-row">
            <div><div class="sr-main">${tr('界面语言')}</div><div class="sr-sub">${tr('切换后界面文字立即生效')}</div></div>
            <select id="st-lang" class="lb-select">
              ${LANGS.map(l => `<option value="${l.id}"${l.id === LANG ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}
            </select>
          </div>
          <div class="settings-row">
            <div><div class="sr-main">${tr('启动时检查更新')}</div><div class="sr-sub">${tr('发现新版本会在底部提示，可一键下载')}</div></div>
            <button class="switch${autoCheck ? ' on' : ''}" id="st-auto" aria-pressed="${autoCheck}"></button>
          </div>
          <div class="settings-note" style="margin-top:16px">
            ${tr('所有数据都保存在本机，不上传云端。图片识别只把非 NSFW 图发给你自己配置的 API。')}
          </div>
        </div>

        <div class="settings-pane${initialTab === 'ai' ? ' active' : ''}" data-pane="ai">
          <div class="row">
            <label class="f-label">${tr('服务商')}</label>
            <select id="st-provider" class="lb-select" style="width:100%">
              ${Object.entries(providers).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
            </select>
            <div class="hint" id="st-provider-hint"></div>
          </div>
          <div class="row">
            <label class="f-label">${tr('API 地址')}</label>
            <input type="text" id="st-base" placeholder="https://api.openai.com/v1" value="${esc(cfg.baseURL || '')}">
          </div>
          <div class="row">
            <label class="f-label">API Key</label>
            <input type="password" id="st-key" placeholder="sk-..." value="${esc(cfg.apiKey || '')}">
            <div class="hint">${tr('只保存在本机 library.json，不会上传到任何服务器')}</div>
          </div>
          <div class="row">
            <label class="f-label">${tr('模型名')}</label>
            <input type="text" id="st-model" placeholder="gpt-4o-mini" value="${esc(cfg.model || '')}">
            <div class="hint">${tr('必须支持图片输入（多模态模型）')}</div>
          </div>
          <div class="row">
            <label class="f-label">${tr('并发数')}</label>
            <input type="number" id="st-conc" min="1" max="5" value="${esc(String(cfg.concurrency || 3))}">
            <div class="hint">${tr('同时识别几张，越高越快；遇到限流（429）就调低')}</div>
          </div>
          <div class="settings-note" style="margin-bottom:10px">
            <b>隐私：</b>每张图先在本地做 NSFW 检测，命中 NSFW 的图片绝不上传；只有正常图片才发到你配置的 API。
          </div>
          <button class="chip" id="st-test">${tr('测试连接')}</button>
        </div>

        <div class="settings-pane${initialTab === 'appearance' ? ' active' : ''}" data-pane="appearance">
          <div class="settings-row">
            <div><div class="sr-main">${tr('缩略图大小')}</div><div class="sr-sub"><span id="st-size-val">${state.size}</span> px</div></div>
            <input type="range" id="st-size" min="110" max="300" value="${state.size}">
          </div>
        </div>

        <div class="settings-pane${initialTab === 'data' ? ' active' : ''}" data-pane="data">
          <div class="kv-line"><span>${tr('数据目录')}</span><b>${esc(info.dataDir || '—')}</b></div>
          <div class="kv-line"><span>${tr('图库')}</span><b>${pc(liveN)} · ${catN} ${tr('个分类')}</b></div>
          <div class="kv-line"><span>${tr('相册')}</span><b>${state.albums.length}</b></div>
          <div class="settings-row" style="margin-top:8px">
            <div><div class="sr-main">${tr('打开目录')}</div><div class="sr-sub">${tr('library.json / 缩略图缓存都在这里')}</div></div>
            <button class="chip" id="st-opendir">${tr('打开目录')}</button>
          </div>
        </div>

        <div class="settings-pane${initialTab === 'about' ? ' active' : ''}" data-pane="about">
          <div class="settings-row">
            <div><div class="sr-main">PicFlow 图片管家</div><div class="sr-sub">${tr('版本')} v${esc(info.version || '—')}</div></div>
            <span class="pill" style="background:var(--accent-soft);color:var(--accent-dark)">Electron</span>
          </div>
          <div class="settings-row">
            <div><div class="sr-main">${tr('检查更新')}</div><div class="sr-sub">${tr('GitHub Releases 自动更新')}</div></div>
            <button class="chip" id="st-upd">${tr('检查更新')}</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="chip" id="st-cancel">${tr('取消')}</button>
        <button class="btn-primary" id="st-save">${tr('保存')}</button>
      </div>
    </div>`);

  /* 分区切换 */
  ov.querySelector('.modal').classList.add('modal-settings');
  ov.querySelectorAll('.settings-tab').forEach(b => {
    b.onclick = () => {
      ov.querySelectorAll('.settings-tab').forEach(x => x.classList.toggle('active', x === b));
      ov.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
    };
  });

  /* AI 配置 */
  const pSel = ov.querySelector('#st-provider');
  const baseIn = ov.querySelector('#st-base');
  const keyIn = ov.querySelector('#st-key');
  const modelIn = ov.querySelector('#st-model');
  const hintEl = ov.querySelector('#st-provider-hint');
  const applyProvider = (k, force) => {
    const p = providers[k];
    if (!p) return;
    if (hintEl) hintEl.textContent = p.hint || '';
    if (force) {
      if (p.baseURL) baseIn.value = p.baseURL;
      if (p.model) modelIn.value = p.model;
    }
  };
  if (!cfg.baseURL) applyProvider(cur, true);
  else if (hintEl) hintEl.textContent = (providers[cur] && providers[cur].hint) || '';
  pSel.onchange = () => applyProvider(pSel.value, true);

  const collectAI = () => ({
    provider: pSel.value,
    api: (providers[pSel.value] && providers[pSel.value].api) || 'openai',
    baseURL: baseIn.value.trim(),
    apiKey: keyIn.value.trim(),
    model: modelIn.value.trim(),
    concurrency: Math.max(1, Math.min(5, Number(ov.querySelector('#st-conc').value) || 3))
  });

  ov.querySelector('#st-test').onclick = async () => {
    const btn = ov.querySelector('#st-test');
    const c = collectAI();
    if (!c.baseURL || !c.apiKey) { toast('请先填 API 地址和 Key'); return; }
    btn.textContent = '测试中…'; btn.disabled = true;
    const r = await api.cloudConfigTest(c);
    btn.textContent = tr('测试连接'); btn.disabled = false;
    toast(r.ok ? '✓ 连接成功，可以开始识别' : '✗ ' + r.error, r.ok ? 2200 : 5000);
  };

  /* 外观 */
  const sizeRange = ov.querySelector('#st-size');
  const sizeVal = ov.querySelector('#st-size-val');
  sizeRange.oninput = () => {
    sizeVal.textContent = sizeRange.value;
    document.documentElement.style.setProperty('--cell', sizeRange.value + 'px');
  };

  /* 更新 */
  const autoBtn = ov.querySelector('#st-auto');
  autoBtn.onclick = () => {
    const on = !autoBtn.classList.contains('on');
    autoBtn.classList.toggle('on', on);
    autoBtn.setAttribute('aria-pressed', String(on));
  };
  const updBtn = ov.querySelector('#st-upd');
  if (updBtn) {
    updBtn.onclick = async () => {
      updBtn.disabled = true;
      updBtn.textContent = '检查中…';
      const r = await api.updateCheck();
      updBtn.disabled = false;
      updBtn.textContent = tr('检查更新');
      if (r && r.ok) {
        if (r.version && r.version !== String(info.version || '')) toast(`${tr('发现新版本')} v${r.version}`);
        else toast(tr('当前已是最新版本'));
      } else {
        toast('检查更新失败：' + ((r && r.error) || '未知错误'));
      }
    };
  }
  const openDir = ov.querySelector('#st-opendir');
  if (openDir) openDir.onclick = async () => { await api.openDataDir(); };

  /* 保存 */
  ov.querySelector('#st-cancel').onclick = () => {
    document.documentElement.style.setProperty('--cell', state.size + 'px');
    ov.remove();
  };
  ov.querySelector('#st-save').onclick = async () => {
    const c = collectAI();
    const filled = !!(c.baseURL || c.apiKey || c.model);
    if (filled && (!c.baseURL || !c.apiKey || !c.model)) {
      toast('AI 配置不完整：API 地址、Key、模型名都要填');
      return;
    }
    await api.cloudConfigSet(c);
    state.flags.cloudAI = c;
    const autoOn = autoBtn.classList.contains('on');
    await api.setFlag('autoUpdateCheck', autoOn);
    state.flags.autoUpdateCheck = autoOn;
    state.size = Math.max(110, Math.min(300, Number(sizeRange.value) || 168));
    await api.setFlag('thumbSize', state.size);
    const lang = ov.querySelector('#st-lang').value;
    await api.setFlag('lang', lang);
    state.flags.lang = lang;
    setLanguage(lang);
    renderSidebar();
    renderContent();
    syncSelectionUI();
    updatePill();
    ov.remove();
    toast(tr('设置已保存'));
  };
}

/* 兼容旧调用：需要直接打开 AI 配置的地方 */
function cloudConfigModal() { return settingsModal('ai'); }

/* ================= 批量标注分类（数据标注式） ================= */
async function categoryModal() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const cats = [...new Set(state.images.map(i => i.aiCategory).filter(Boolean))].sort();
  const ov = showModal(`<h3>标注分类（${paths.length} 张）</h3>
    <p class="hint" style="margin-bottom:10px">手动指定分类后，AI 识别不会覆盖你的标注。</p>
    <div class="row">
      <label class="f-label">选择已有分类</label>
      <div class="check-list">${cats.length
        ? cats.map(c => `<label><input type="radio" name="cat-target" value="${esc(c)}"><span>${esc(c)}</span></label>`).join('')
        : '<div class="hint">还没有分类，在下方输入新建一个</div>'}</div>
    </div>
    <div class="row">
      <label class="f-label">或输入新分类</label>
      <input type="text" id="cat-new" placeholder="例如：原神·雷电将军 / 代码截图">
    </div>
    <div class="modal-foot">
      <button class="chip" id="cat-cancel">取消</button>
      <button class="chip danger" id="cat-clear">清除标注</button>
      <button class="btn-primary" id="cat-ok">应用</button>
    </div>`);
  ov.querySelector('#cat-cancel').onclick = () => ov.remove();
  ov.querySelector('#cat-clear').onclick = async () => {
    await api.batchSetCategory(paths, '');
    ov.remove();
    state.selected.clear();
    await refreshLibrary();
    toast('已清除 ' + paths.length + ' 张的分类标注');
  };
  ov.querySelector('#cat-ok').onclick = async () => {
    const newVal = ov.querySelector('#cat-new').value.trim();
    const picked = ov.querySelector('.check-list input:checked');
    const target = newVal || (picked ? picked.value : '');
    if (!target) { toast('请选择分类或输入新分类名'); return; }
    await api.batchSetCategory(paths, target);
    ov.remove();
    state.selected.clear();
    await refreshLibrary();
    toast(`已把 ${paths.length} 张标注为「${target}」`);
  };
}


/* ================= 重命名 AI 分类（= 相册名） ================= */
function renameCategoryModal(from) {
  const groups = [...new Set(state.images.map(i => i.aiClusterName).filter(Boolean))].sort();
  const others = groups.filter(g => g !== from);
  const ov = showModal(`<h3>${tr('重命名分类')}</h3>
    <p class="hint" style="margin-bottom:10px">改名后该分类下所有图片会一起更新；重新跑 AI 也不会覆盖。</p>
    <div class="row">
      <label class="f-label">分类名称</label>
      <input type="text" id="rc-name" value="${esc(from || '')}" placeholder="例如：原神·雷电将军">
    </div>
    ${others.length ? `<div class="row">
      <label class="f-label">或合并到已有分类</label>
      <div class="check-list">${others.map(g => `<label><input type="radio" name="rc-target" value="${esc(g)}"><span>${esc(g)}</span></label>`).join('')}</div>
    </div>` : ''}
    <div class="modal-foot">
      <button class="chip" id="rc-cancel">${tr('取消')}</button>
      <button class="btn-primary" id="rc-ok">${tr('保存')}</button>
    </div>`);
  const input = ov.querySelector('#rc-name');
  input.focus();
  input.select();
  const save = async () => {
    const picked = ov.querySelector('input[name="rc-target"]:checked');
    const to = (input.value.trim() || (picked ? picked.value : '')).trim();
    if (!to) { toast('请输入新的分类名'); return; }
    if (to === from) { ov.remove(); return; }
    const r = await api.renameCategory(from, to);
    if (r && r.error) { toast('改名失败：' + r.error); return; }
    ov.remove();
    if (state.view.type === 'aicat' && state.view.key === from) {
      state.view = { type: 'aicat', key: to };
    }
    await refreshLibrary();
    toast(`已重命名为「${to}」，共 ${r.count || 0} 张`);
  };
  ov.querySelector('#rc-cancel').onclick = () => ov.remove();
  ov.querySelector('#rc-ok').onclick = save;
  input.onkeydown = e => { if (e.key === 'Enter') save(); };
}

/* ================= 初始化 ================= */
(async function init() {
  const lib = await api.getLibrary();
  state.images = lib.images;
  state.albums = lib.albums;
  state.folders = lib.folders;
  state.flags = lib.flags;
  rebuildIndex();
  // 语言：优先用设置里保存的，其次本地缓存
  const savedLang = lib.flags.lang || localStorage.getItem('pf.lang') || 'zh-CN';
  LANG = LANGS.some(l => l.id === savedLang) ? savedLang : 'zh-CN';
  if (lib.flags.thumbSize) state.size = Math.max(110, Math.min(300, Number(lib.flags.thumbSize) || 168));
  applyLangUI();
  syncNsfwButton();
  renderSidebar();
  renderContent();
  updatePill();
  if (!state.flags.guided && state.images.filter(live).length === 0) showGuide();

  /* 文件夹自动同步：后台静默扫描发现变化后通知 */
  api.on('sync:done', async d => {
    const parts = [];
    if (d.added) parts.push(`新增/更新 ${d.added} 张`);
    if (d.missing) parts.push(`${d.missing} 张已在外部移动或删除`);
    if (parts.length) toast(`图库已自动同步：${parts.join('，')}`);
    await refreshLibrary();
  });
  api.on('scan:start', d => { state.scanning = true; state.scanDone = 0; state.scanTotal = 0; updatePill(); });
  api.on('scan:total', d => { state.scanTotal = d.total; updatePill(); });
  api.on('scan:progress', d => {
    state.scanDone = d.done;
    $('#progress').classList.remove('hidden');
    $('#progress-bar').style.width = d.total ? Math.round(d.done / d.total * 100) + '%' : '0%';
    updatePill();
  });
  api.on('scan:item', rec => { upsert(rec); scheduleGrid(); });
  api.on('scan:done', async d => {
    state.scanning = false;
    state.dupStale = true;
    $('#progress').classList.add('hidden');
    $('#progress-bar').style.width = '0%';
    await refreshLibrary();
    updatePill();
    toast(`扫描完成：共 ${d.total} 张图片${d.missing ? `，${d.missing} 条记录已失效` : ''}`);
  });

  api.on('ai:start', () => { state.aiRunning = true; state.aiDone = 0; state.aiPhase = 'cloud'; renderSidebar(); });
  api.on('ai:total', d => { state.aiTotal = d.total; renderSidebar(); });
  api.on('ai:progress', d => {
    state.aiDone = d.done; state.aiTotal = d.total;
    state.aiPhase = d.phase || 'cloud';
    const labels = { cloud: '识别', nsfw: '检测', loading: '加载' };
    state.aiPhaseLabel = labels[state.aiPhase] || '识别';
    renderSidebar();
  });
  api.on('ai:done', async d => {
    state.aiRunning = false; state.aiPhase = null; state.aiPhaseLabel = null;
    if (d && d.error) { state.aiError = d.error; toast('AI 识别失败：' + d.error); }
    else {
      const parts = [];
      if (d.ok != null) parts.push(`成功 ${d.ok} 张`);
      if (d.nsfwSkipped) parts.push(`NSFW 跳过 ${d.nsfwSkipped} 张`);
      if (d.failed) parts.push(`失败 ${d.failed} 张`);
      if (d.elapsedMs) parts.push(`耗时 ${Math.round(d.elapsedMs / 1000)} 秒`);
      toast(`AI 识别完成：${d.done || 0} 张 · ${d.clusters || 0} 个分类${parts.length ? '（' + parts.join('，') + '）' : ''}`, 5000);
    }
    await refreshLibrary();
  });

  /* ---------- 自动更新提示条 ---------- */
  const ub = $('#update-bar');
  const ubText = $('#ub-text');
  const ubBtn = $('#ub-action');
  const ubProg = $('#ub-progress');
  const ubInner = $('#ub-progress-inner');
  let ubState = '';
  let ubVersion = '';
  api.on('update:status', d => {
    if (!d) return;
    ubState = d.state;
    if (d.state === 'available') {
      ubVersion = d.version || '';
      ubText.textContent = `${tr('发现新版本')} v${d.version}`;
      ubBtn.textContent = tr('下载更新');
      ubBtn.disabled = false;
      ubProg.classList.remove('on');
      ubInner.style.width = '0%';
      ub.classList.remove('hidden');
    } else if (d.state === 'downloaded') {
      ubText.textContent = `v${d.version} ${tr('已下载完成，重启即可安装')}`;
      ubBtn.textContent = tr('重启安装');
      ubBtn.disabled = false;
      ubProg.classList.remove('on');
      ub.classList.remove('hidden');
    } else if (d.state === 'latest') {
      if (!ub.classList.contains('hidden') && ubState !== 'checking') {
        ubText.textContent = tr('当前已是最新版本');
        ubBtn.textContent = tr('关闭');
        ubBtn.disabled = false;
        setTimeout(() => { if (ubState === 'latest') ub.classList.add('hidden'); }, 2600);
      }
    } else if (d.state === 'error') {
      ubText.textContent = tr('检查更新失败') + '：' + (d.error || '').slice(0, 40);
      ubBtn.textContent = tr('重试');
      ubBtn.disabled = false;
      ub.classList.remove('hidden');
    }
  });
  api.on('update:progress', d => {
    if (!d) return;
    ubState = 'downloading';
    ubProg.classList.add('on');
    ubInner.style.width = Math.max(0, Math.min(100, d.percent || 0)) + '%';
    const mb = n => (n / 1024 / 1024).toFixed(1);
    ubText.textContent = `${tr('正在下载')} v${ubVersion}… ${d.percent || 0}%（${mb(d.transferred || 0)}/${mb(d.total || 0)}MB）`;
    ubBtn.textContent = tr('下载中…');
    ubBtn.disabled = true;
  });
  $('#ub-close').onclick = () => ub.classList.add('hidden');
  ubBtn.onclick = async () => {
    if (ubState === 'available') {
      ubBtn.disabled = true;
      ubBtn.textContent = tr('准备下载…');
      ubProg.classList.add('on');
      const r = await api.updateDownload();
      if (r && r.error) toast('下载失败：' + r.error);
    } else if (ubState === 'downloaded') {
      await api.updateInstall();
    } else if (ubState === 'latest' || ubState === 'error') {
      ub.classList.add('hidden');
      if (ubState === 'error') api.updateCheck();
    }
  };
})();
