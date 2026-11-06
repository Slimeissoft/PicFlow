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
/* macOS 上把 Ctrl 系快捷键写成 ⌘ 系（Ctrl+C → ⌘C，Ctrl+Shift+C → ⌘⇧C，Del → ⌫） */
const IS_MAC = /Macintosh|Mac OS X/i.test(navigator.userAgent);
const macKeys = s => {
  if (!IS_MAC || typeof s !== 'string') return s;
  return s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/\bDel\b/g, '⌫').replace(/\bCtrl\b/g, '⌘');
};
let LANG = 'zh-CN';
function tr(zh) {
  if (LANG === 'zh-CN') return macKeys(zh);
  const d = I18N_DICT[LANG];
  return macKeys((d && d[zh]) || zh);
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
      : tr('单击 预览 · 右键 更多操作 · 开启右上「多选」后点击图片直接选中 · Ctrl+A 全选 · Del 移出');
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
  lbPath: null,   // 灯箱跟着「路径」走：网格重排后 index 会失效，标记完 NSFW 再按 N 会切错图
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
  /* 对象已整批换新，灯箱面板若开着必须跟着换，否则会停在旧对象的显示状态 */
  lbPanelRefresh();
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

/* ================= 右键菜单 =================
 * 自绘菜单而不是 Electron 原生 Menu：能跟主题走、能直接用 i18n、菜单头还能带缩略图。
 * 所有动作复用现有的批量函数，只是把作用对象从 state.selected 换成右键点中的这批图片。
 */
const CTX_ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-6.4 10-6.4S22 12 22 12s-3.6 6.4-10 6.4S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-4.4 4.5 3.4L17 12l4 4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9.5 14.5 14.5 9.5"/><path d="M7 12l-1.4 1.4a3.5 3.5 0 0 0 5 5L12 17"/><path d="M12 7l1.4-1.4a3.5 3.5 0 0 1 5 5L17 12"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3 2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8z"/></svg>',
  nsfw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 4 6v6c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V6z"/><path d="M9 15V9m0 3h2a1.5 1.5 0 0 0 0-3H9"/><path d="M15 9v6"/></svg>',
  tag: ICONS.tag,
  album: ICONS.album,
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8L17.3 5.5a2 2 0 0 0-2.8 0L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v18M3 12h18"/><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8 3 12l4 4M17 8l4 4-4 4"/></svg>',
  trash: ICONS.trash,
  purge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 9a8 8 0 1 1 1.6 6.6"/><path d="M3 4v5h5"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m7 17.5-3-3a2 2 0 0 1 0-2.9l8-8a2 2 0 0 1 2.9 0l3.5 3.5a2 2 0 0 1 0 2.9l-7.1 7.5z"/><path d="M9 20h11"/></svg>'
};

const ctx = { el: null, sub: null, items: [], active: -1 };

function ctxCloseSub() {
  // 兜底清掉所有子菜单：即使 ctx.sub 引用丢了（页面被局部重绘等），也不会留残影
  $$('.ctx-sub').forEach(el => el.remove());
  ctx.sub = null;
  if (ctx.el) ctx.el.querySelectorAll('.ctx-item.open').forEach(r => r.classList.remove('open'));
}

function ctxClose() {
  ctxCloseSub();
  // 幂等：只清 ctx.el 会漏掉异常路径下产生的孤儿节点，直接按类名全清
  $$('.ctx-menu').forEach(el => el.remove());
  ctx.el = null;
  ctx.items = [];
  ctx.active = -1;
  $$('.card.ctx-target').forEach(c => c.classList.remove('ctx-target'));
  document.removeEventListener('pointerdown', ctxOutside, true);
  document.removeEventListener('keydown', ctxKey, true);
  document.removeEventListener('scroll', ctxOnScroll, true);
  window.removeEventListener('resize', ctxClose);
  window.removeEventListener('blur', ctxClose);
}

function ctxOutside(e) {
  if (e.target && e.target.closest && e.target.closest('.ctx-menu')) return;
  ctxClose();
}
function ctxOnScroll(e) {
  if (e.target && e.target.closest && e.target.closest('.ctx-menu')) return;
  ctxClose();
}

function ctxItemHtml(it, i) {
  if (it.sep) return '<div class="ctx-sep"></div>';
  if (it.head) {
    return `<div class="ctx-head">${it.head.thumb
      ? `<img class="ctx-thumb" src="${esc(it.head.thumb)}" alt="">`
      : '<span class="ctx-thumb ctx-thumb-blank"></span>'}<div class="ctx-meta"><b>${esc(it.head.title)}</b><span>${esc(it.head.sub)}</span></div></div>`;
  }
  const ico = `<span class="ctx-ico">${it.icon ? (CTX_ICON[it.icon] || '') : ''}</span>`;
  const check = it.checked ? '<span class="ctx-check">✓</span>' : '';
  const hint = it.hint ? `<span class="ctx-hint">${esc(it.hint)}</span>` : '';
  const arrow = it.submenu ? '<span class="ctx-arrow"></span>' : '';
  return `<div class="ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}" data-i="${i}" role="menuitem">${ico}<span class="ctx-label">${esc(it.label)}</span>${check}${hint}${arrow}</div>`;
}

function ctxRender(items, x, y, targets = []) {
  ctxClose();
  const el = document.createElement('div');
  el.className = 'ctx-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map(ctxItemHtml).join('');
  document.body.append(el);
  ctx.el = el; ctx.items = items;
  // 先上屏量尺寸，再夹进视口，靠近右/下边自动翻转
  const pad = 8;
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(pad, Math.min(x, innerWidth - w - pad)) + 'px';
  el.style.top = Math.max(pad, Math.min(y, innerHeight - h - pad)) + 'px';
  el.querySelectorAll('.ctx-item').forEach(row => {
    const it = items[+row.dataset.i];
    if (!it || it.disabled) return;
    row.addEventListener('mouseenter', () => { if (it.submenu) ctxOpenSub(row, it); else ctxCloseSub(); });
    row.addEventListener('click', ev => {
      ev.stopPropagation();
      if (it.submenu) { ctxOpenSub(row, it); return; }
      ctxClose();
      if (it.action) it.action();
    });
  });
  targets.forEach(c => c.classList.add('ctx-target'));
  document.addEventListener('pointerdown', ctxOutside, true);
  document.addEventListener('keydown', ctxKey, true);
  document.addEventListener('scroll', ctxOnScroll, true);
  window.addEventListener('resize', ctxClose);
  window.addEventListener('blur', ctxClose);
}

function ctxOpenSub(rowEl, item) {
  if (ctx.sub && ctx.sub._owner === rowEl) return;
  ctxCloseSub();
  const sub = document.createElement('div');
  sub.className = 'ctx-menu ctx-sub';
  sub.innerHTML = item.submenu.map(ctxItemHtml).join('');
  document.body.append(sub);
  const r = rowEl.getBoundingClientRect();
  const pad = 8;
  const w = sub.offsetWidth, h = sub.offsetHeight;
  let left = r.right + 2;
  if (left + w > innerWidth - pad) left = Math.max(pad, r.left - w - 2);
  let top = r.top - 5;
  if (top + h > innerHeight - pad) top = Math.max(pad, innerHeight - h - pad);
  sub.style.left = left + 'px';
  sub.style.top = top + 'px';
  sub._owner = rowEl;
  ctx.sub = sub;
  rowEl.classList.add('open');
  sub.querySelectorAll('.ctx-item').forEach(row => {
    const it = item.submenu[+row.dataset.i];
    if (!it || it.disabled) return;
    row.addEventListener('click', ev => { ev.stopPropagation(); ctxClose(); if (it.action) it.action(); });
  });
}

function ctxKey(e) {
  if (!ctx.el) return;
  const rows = [...ctx.el.querySelectorAll('.ctx-item')].filter(r => !r.classList.contains('disabled'));
  if (!rows.length) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ctxClose(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    ctx.active = ctx.active < 0 ? 0 : (ctx.active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('active', i === ctx.active));
    const it = ctx.items[+rows[ctx.active].dataset.i];
    if (it && it.submenu) ctxOpenSub(rows[ctx.active], it); else ctxCloseSub();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    const row = rows[ctx.active] || rows[0];
    const it = ctx.items[+row.dataset.i];
    if (!it) return;
    if (it.submenu) { ctxOpenSub(row, it); return; }
    ctxClose();
    if (it.action) it.action();
  }
}

/* —— 菜单动作 —— */
async function ctxCopyImage(p) {
  const r = await api.copyImage(p);
  toast(r && r.ok ? tr('已复制图片到剪贴板') : `复制失败：${(r && r.error) || '格式不支持'}`);
}
async function ctxCopyText(paths) {
  await api.copyText(paths.length === 1 ? paths[0] : paths.join('\n'));
  toast(paths.length === 1 ? tr('已复制文件路径') : `${tr('已复制文件路径')} × ${paths.length}`);
}
async function ctxSetFlag(paths, key) {
  const recs = paths.map(p => byPath.get(p)).filter(Boolean);
  if (!recs.length) return;
  const target = !recs.every(r => !!r[key]);
  recs.forEach(r => { r[key] = target; });          // 先给界面反馈
  try {
    for (const r of recs) await api.updateImage(r.path, { [key]: target });
  } catch (err) {
    paths.forEach(p => { const r = byPath.get(p); if (r) r[key] = !target; });
    renderSidebar(); renderContent(); lbPanelRefresh();
    toast(`${key === 'nsfw' ? 'NSFW ' : ''}写入失败：${(err && err.message) || '请重试'}`);
    return;
  }
  paths.forEach(p => { const r = byPath.get(p); if (r) r[key] = target; }); // 防 await 期间换新对象
  renderSidebar(); renderContent(); lbPanelRefresh();
  const what = key === 'nsfw' ? 'NSFW 标记' : '星标';
  toast(target ? `已为 ${paths.length} 张加上${what}` : `已取消 ${paths.length} 张的${what}`);
}

function ctxAlbumMenu(paths) {
  const subs = state.albums.map(a => ({
    label: a.name,
    icon: 'album',
    checked: paths.every(p => (a.paths || []).includes(p)),
    action: async () => {
      await api.assignAlbum(a.id, paths);
      await refreshLibrary();
      toast(`已将 ${paths.length} 张加入「${a.name}」`);
    }
  }));
  if (subs.length) subs.push({ sep: true });
  subs.push({ label: tr('新建相册') + '…', icon: 'plus', action: () => ctxNewAlbum(paths) });
  return subs;
}

function ctxNewAlbum(paths) {
  const ov = showModal(`<h3>${esc(tr('新建相册'))}</h3>
    <div class="row"><label class="f-label">${esc(tr('相册名称'))}</label><input type="text" id="cna-name" placeholder="例如：旅行精选"></div>
    <div class="modal-foot"><button class="chip" id="cna-cancel">${esc(tr('取消'))}</button><button class="btn-primary" id="cna-ok">${esc(tr('创建'))}</button></div>`);
  const input = ov.querySelector('#cna-name');
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) return;
    const a = await api.createAlbum(name);
    await api.assignAlbum(a.id, paths);
    ov.remove();
    await refreshLibrary();
    toast(`已新建相册「${name}」并加入 ${paths.length} 张`);
  };
  ov.querySelector('#cna-cancel').onclick = () => ov.remove();
  ov.querySelector('#cna-ok').onclick = go;
  input.onkeydown = e => { if (e.key === 'Enter') go(); };
}

function ctxHeadFor(recs) {
  if (recs.length === 1) {
    const it = recs[0];
    return { head: { thumb: it.thumbUrl || '', title: baseName(it.path), sub: `${imgDate(it).slice(0, 10)} · ${String(it.type || '').toUpperCase()} · ${fmtSize(it.size)}` } };
  }
  const sum = recs.reduce((s, i) => s + (i.size || 0), 0);
  return { head: { thumb: (recs[0] && recs[0].thumbUrl) || '', title: `${tr('已选')} ${recs.length} ${tr('张图片')}`, sub: `${tr('合计')} ${fmtSize(sum)}` } };
}

function ctxImageItems(paths, opts = {}) {
  const recs = paths.map(p => byPath.get(p)).filter(Boolean);
  if (!recs.length) return null;
  const one = recs.length === 1 ? recs[0] : null;
  const inTrash = state.view.type === 'trash';
  const head = ctxHeadFor(recs);
  const openPreview = () => {
    const idx = state.items.findIndex(i => i.path === paths[0]);
    if (idx >= 0) openLightbox(idx);
  };
  // 快捷键提示只在真的能按的地方显示：S/N 仅灯箱、F2 仅网格
  const lb = !!opts.lb;

  if (inTrash) {
    return [
      head,
      { label: tr('打开预览'), icon: 'eye', disabled: !one || !!one.missing, action: openPreview },
      { label: tr('在文件夹中显示'), icon: 'folder', disabled: !one || !!one.missing, action: () => api.openInFolder(paths[0]) },
      { sep: true },
      { label: tr('恢复到图库'), icon: 'restore', action: () => reviveSelected(paths) },
      { label: tr('清除记录'), icon: 'eraser', action: () => clearRecords(paths) },
      { sep: true },
      { label: tr('彻底删除'), icon: 'purge', danger: true, action: () => purgeSelected(paths) }
    ];
  }

  const items = [
    head,
    { label: tr('打开预览'), icon: 'eye', disabled: !one, action: openPreview },
    { label: tr('用默认程序打开'), icon: 'external', disabled: !one, action: async () => {
      const r = await api.openPath(paths[0]);
      if (r && r.ok === false) toast(`无法打开：${r.error || '未知错误'}`);
    } },
    { label: tr('在文件夹中显示'), icon: 'folder', disabled: !one, action: () => api.openInFolder(paths[0]) },
    { sep: true },
    { label: tr('复制图片'), icon: 'image', hint: IS_MAC ? '⌘C' : 'Ctrl+C', disabled: !one, action: () => ctxCopyImage(paths[0]) },
    { label: tr('复制文件路径'), icon: 'link', hint: IS_MAC ? '⌘⇧C' : 'Ctrl+Shift+C', action: () => ctxCopyText(paths) },
    { sep: true },
    { label: one && one.starred ? tr('取消星标') : tr('加星标'), icon: 'star', hint: lb ? 'S' : '', action: () => ctxSetFlag(paths, 'starred') },
    { label: one && one.nsfw ? tr('取消 NSFW 标记') : tr('标记为 NSFW'), icon: 'nsfw', hint: lb ? 'N' : '', action: () => ctxSetFlag(paths, 'nsfw') },
    { label: tr('标注分类…'), icon: 'tag', action: () => labelModal(paths, () => { lbPanelRefresh(); renderSidebar(); renderContent(); }) },
    { label: tr('加入相册'), icon: 'album', submenu: ctxAlbumMenu(paths) }
  ];
  if (state.view.type === 'album') {
    items.push({ label: tr('从当前相册移出'), icon: 'eraser', action: () => removeFromCurrentAlbum(paths) });
  }
  items.push(
    { sep: true },
    { label: tr('重命名') + '…', icon: 'edit', hint: lb ? '' : 'F2', action: () => renameModal(paths) },
    { label: tr('移动到文件夹…'), icon: 'move', action: () => moveSelected(paths) },
    { sep: true },
    { label: tr('移入软件回收站'), icon: 'trash', danger: true, action: () => trashSelected(paths) },
    { label: tr('彻底删除'), icon: 'purge', danger: true, action: () => purgeSelected(paths) }
  );
  return items;
}

function ctxStackItems(key) {
  const recs = state.images.filter(i => i.aiClusterName === key && liveVisible(i));
  return [
    { head: { thumb: (recs[0] && recs[0].thumbUrl) || '', title: key, sub: pc(recs.length) } },
    { label: tr('打开分组'), icon: 'folder', action: () => {
      state.view = { type: 'aicat', key };
      renderSidebar(); renderContent();
      const content = $('#content');
      if (content) content.scrollTop = 0;
    } },
    { label: tr('重命名分类') + '…', icon: 'edit', action: () => renameCategoryModal(key) }
  ];
}

/* 点中已选中的卡片 → 作用于整个多选；否则只作用于这一张（不打扰现有选择） */
function ctxPathsFor(p) {
  if (state.selected.has(p) && state.selected.size > 1) return [...state.selected];
  return [p];
}

document.addEventListener('contextmenu', e => {
  // 输入框：给系统原生编辑菜单，否则 Search 框里右键既没菜单也粘贴不了
  const editable = e.target.closest('input, textarea, [contenteditable="true"]');
  if (editable) {
    e.preventDefault();
    api.editMenu({ undo: tr('撤销'), redo: tr('重做'), cut: tr('剪切'), copy: tr('复制'), paste: tr('粘贴'), selectAll: tr('全选') });
    return;
  }
  const card = e.target.closest('#grid .card, #dup-root .card');
  const stack = e.target.closest('#ai-overview-root .stack-card[data-key]');
  const lbImg = e.target.closest('#lb-img');
  if (!card && !stack && !lbImg) return;
  e.preventDefault();

  if (card) {
    const p = card.dataset.path;
    if (!p) return;
    const paths = ctxPathsFor(p);
    const items = ctxImageItems(paths);
    if (!items) return;
    const targets = paths.length > 1
      ? $$('#grid .card, #dup-root .card').filter(c => paths.includes(c.dataset.path))
      : [card];
    return ctxRender(items, e.clientX, e.clientY, targets);
  }
  if (stack) {
    return ctxRender(ctxStackItems(stack.dataset.key), e.clientX, e.clientY, [stack]);
  }
  const cur = lbCurrent();
  if (!cur) return;
  const items = ctxImageItems(ctxPathsFor(cur.path), { lb: true });
  if (items) ctxRender(items, e.clientX, e.clientY);
});

/* 灯箱开着时重画右侧面板（关着就什么都不做） */
function lbPanelRefresh() {
  const lb = $('#lightbox');
  if (!lb || lb.classList.contains('hidden')) return;
  const cur = lbCurrent();
  if (cur) renderLbPanel(cur);
}

/* 只改卡片上的星标，不整页重绘 */
function paintStar(p, on) {
  $$('#grid .card, #dup-root .card').forEach(c => {
    if (c.dataset.path === p) {
      const b = c.querySelector('.star');
      if (b) b.classList.toggle('on', !!on);
    }
  });
}

async function toggleStar(p) {
  const it = byPath.get(p);
  if (!it) return;
  const target = !it.starred;
  it.starred = target;              /* 先给界面反馈，写盘失败再回滚 */
  paintStar(p, target);
  lbPanelRefresh();
  try {
    await api.updateImage(p, { starred: target });
  } catch (e) {
    const back = byPath.get(p);
    if (back) back.starred = !target;
    paintStar(p, !target);
    lbPanelRefresh();
    renderContent();
    toast('星标写入失败：' + (e && e.message ? e.message : '请重试'));
    return;
  }
  /* 写盘期间若发生 refreshLibrary()，对象已被整批替换 → 把结果补写到新对象上 */
  const after = byPath.get(p);
  if (after) after.starred = target;
  paintStar(p, target);
  renderSidebar();
  lbPanelRefresh();
}
async function toggleNsfw(p) {
  const it = byPath.get(p);
  if (!it) return;
  const target = !it.nsfw;
  it.nsfw = target;                 /* 先给界面反馈，写盘失败再回滚 */
  lbPanelRefresh();
  try {
    await api.updateImage(p, { nsfw: target });
  } catch (e) {
    const back = byPath.get(p);
    if (back) back.nsfw = !target;
    lbPanelRefresh();
    renderContent();
    toast('NSFW 标记写入失败：' + (e && e.message ? e.message : '请重试'));
    return;
  }
  const after = byPath.get(p);
  if (after) after.nsfw = target;
  renderSidebar();
  renderContent();
  lbPanelRefresh();
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
  state.lbPath = it.path;
  lbResetZoom();
  $('#lightbox').classList.remove('hidden');
  const cached = thumbCache.get(it.path);
  $('#lb-img').src = cached || '';
  const full = await api.readImage(it.path);
  if (full && state.lbPath === it.path) $('#lb-img').src = full.dataUrl;
  renderLbPanel(it);
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lightbox').classList.remove('fullscreen');
  lbResetZoom();
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
  $('#lb-img').src = '';
  state.lbIndex = -1;
  state.lbPath = null;
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
  const at = state.items.findIndex(i => i.path === state.lbPath);
  openLightbox(((at < 0 ? state.lbIndex : at) + d + n) % n);
}
/* 灯箱当前图片：优先按路径找，index 只是兜底 */
function lbCurrent() {
  return (state.lbPath && byPath.get(state.lbPath)) || state.items[state.lbIndex] || null;
}
function renderLbPanel(it) {
  /* 一律用索引里的最新对象渲染。refreshLibrary()（自动同步/AI 完成后）会把
     state.images 整批换成新对象，面板若还抓着旧对象，就会出现
     「已写入图库但按钮没变红」的假死状态 */
  const fresh = (it && it.path && byPath.get(it.path)) || it || lbCurrent();
  if (!fresh) return;
  it = fresh;
  if (!$('#lb-panel')) return;
  const albums = state.albums.filter(a => (a.paths || []).includes(it.path));
  $('#lb-panel').innerHTML = `
    <div class="lb-name" title="${esc(it.path)}">${esc(baseName(it.path))}</div>
    <div class="lb-tools">
      <button id="lb-star" class="${it.starred ? 'on star-on' : ''}">${it.starred ? '★ ' + tr('已星标') : '☆ ' + tr('加星标')}</button>
      <button id="lb-nsfw" class="${it.nsfw ? 'on nsfw-on' : ''}">${it.nsfw ? '🔞 NSFW' : tr('🔞 标记 NSFW')}</button>
    </div>
    <div class="lb-aicat">
      <span class="lb-aicat-lbl">${tr('AI 分类')}</span>
      <button class="lb-cat-chip${it.aiClusterName ? '' : ' empty'}" id="lb-cat-chip" title="${tr('点击标注这张图的分类')}">${it.aiClusterName ? esc(it.aiClusterName) : tr('未分类')}</button>
      ${it.aiManual ? `<span class="lb-manual" title="${tr('已手动标注，重新跑 AI 不会覆盖')}">${tr('手动')}</span>` : ''}
      <button class="chip lb-cat-btn" id="lb-label">✎ ${tr('标注')}</button>
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
  /* 手动标注分类：像数据标注一样把这图归到某个 AI 分类（aiManual=true，AI 不再覆盖） */
  const openLabel = () => labelModal([it.path], () => {
    renderLbPanel(it);
    renderSidebar();
    renderContent();
  });
  $('#lb-cat-chip').onclick = openLabel;
  $('#lb-label').onclick = openLabel;
  $('#lb-folder').onclick = () => api.openInFolder(it.path);
  $('#lb-star').onclick = () => { toggleStar(it.path); };
  $('#lb-nsfw').onclick = () => { toggleNsfw(it.path); };
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
function tagModal(paths = [...state.selected]) {
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
function albumModal(paths = [...state.selected]) {
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
    paths.forEach(p => state.selected.delete(p));
    syncSelectionUI();
    await refreshLibrary();
    toast(`已将 ${paths.length} 张图片加入相册`);
  };
}
async function removeFromCurrentAlbum(paths = [...state.selected]) {
  const a = state.albums.find(x => x.id === state.view.key);
  if (!a) return;
  await api.removeFromAlbum(a.id, paths);
  await refreshLibrary();
  toast(`已从「${a.name}」移出`);
}

/* 移动 */
async function moveSelected(paths = [...state.selected]) {
  if (!paths.length) return;
  const dest = await api.pickMoveDest();
  if (!dest) return;
  const res = await api.moveFiles(paths, dest);
  const ok = res.filter(r => r.ok).length;
  paths.forEach(p => state.selected.delete(p));
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
function renameModal(paths = [...state.selected]) {
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
      state.selected.delete(it.path);
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
    paths.forEach(p => state.selected.delete(p));
    await refreshLibrary();
    toast(`重命名完成：${ok}/${pairs.length}`);
  };
}

/* 删除 / 清理 */
async function trashSelected(paths = [...state.selected]) {
  if (!paths.length) return;
  const ok = await confirmModal('移出图片',
    `将选中的 ${paths.length} 张图片从图库移除？\n文件不会被删除，可在左侧「回收站」中恢复。`,
    '移入软件回收站', true);
  if (!ok) return;
  const res = await api.trashFiles(paths);
  const okN = res.filter(r => r.ok).length;
  const failN = res.length - okN;
  paths.forEach(p => state.selected.delete(p));
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
async function reviveSelected(paths = [...state.selected]) {
  if (!paths.length) return;
  await api.reviveFiles(paths);
  paths.forEach(p => state.selected.delete(p));
  await refreshLibrary();
  toast(`已恢复 ${paths.length} 张图片到图库`);
}

/* 彻底删除：把物理文件送到 Windows 系统回收站（可从系统回收站还原），
 * 并清除 PicFlow 记录。与"清除记录"不同：那个只删记录不碰文件，
 * 这个真正删除文件。NSFW 图片同样走本地路径，绝不上传。 */
async function purgeSelected(paths = [...state.selected]) {
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
  paths.forEach(p => state.selected.delete(p));
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
    <div class="g-step"><span class="g-num">2</span><div><b>浏览与 AI 分类</b>
      <p>图片按拍摄日期（优先 EXIF）与文件类型自动归类。先在 <b>设置 → AI 识别</b> 填好自己的多模态大模型 API（OpenAI / Claude / DeepSeek / 通义 / Kimi / 豆包等），再点左侧 <b>AI 分类</b> 运行识别，图片会按内容自动归入一批分类相册。分类名可在总览卡片右上角 <b>✎</b> 修改，也能合并到已有分类。顶部搜索框支持文件名、标签、备注关键词。</p></div></div>
    <div class="g-step"><span class="g-num">3</span><div><b>星标与 NSFW</b>
      <p>悬停缩略图点右上角 <b>★</b> 加星标；NSFW 图片可手动标记（缩略图右下角红角标）。顶部 <b>NSFW 已隐藏</b> 开关一键隐藏/显示所有 NSFW 图片；敏感图只在本地判定，不会被发到云端 API。</p></div></div>
    <div class="g-step"><span class="g-num">4</span><div><b>整理与看图</b>
      <p>左上角圆圈选中（Ctrl 多选 / Shift 范围选），底部工具条批量打标签、星标、相册、移动、重命名、移出（进软件回收站可恢复）。<b>右键任意图片</b>可快速预览、复制图片/路径、标注分类、加入相册或删除；多选后右键对整批生效。单击图片打开灯箱：<b>滚轮缩放</b>、<b>双击进全屏</b>、全屏下<b>单击放大</b>看细节、<b>Esc</b> 退出。「重复 / 相似」视图可一键清理重复图片。</p></div></div>
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
    const lit = lbCurrent();
    if (lit) {
      const it = lit;
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleStar(it.path); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); toggleNsfw(it.path); }
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); labelModal([it.path], () => { lbPanelRefresh(); renderSidebar(); renderContent(); }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (e.shiftKey) ctxCopyText([it.path]); else ctxCopyImage(it.path);
      }
    }
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && state.selected.size) {
    e.preventDefault();
    if (e.shiftKey) ctxCopyText([...state.selected]);
    else if (state.selected.size === 1) ctxCopyImage([...state.selected][0]);
    else toast('一次只能复制一张图片，多选时请用「复制文件路径」');
    return;
  }
  if (e.key === 'F2' && state.selected.size && state.view.type !== 'trash') {
    e.preventDefault(); renameModal([...state.selected]); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault(); selectAll(); return;
  }
  // macOS 笔记本键盘没有独立的 Delete 键，Backspace 才是「删除」
  if ((e.key === 'Delete' || (IS_MAC && e.key === 'Backspace')) && state.selected.size && state.view.type !== 'trash') { trashSelected(); return; }
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
    : tr('单击 预览 · 右键 更多操作 · 开启右上「多选」后点击图片直接选中 · Ctrl+A 全选 · Del 移出');
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
  if (!cfg.baseURL || !cfg.hasKey || !cfg.model) {
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
            <input type="password" id="st-key" autocomplete="off" placeholder="${cfg.hasKey ? esc(cfg.keyMask || '已保存') : 'sk-...'}" value="">
            <div class="hint">${cfg.hasKey ? tr('已加密保存在本机；留空则保持当前 Key 不变') : tr('只保存在本机 library.json，不会上传到任何服务器')}</div>
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
    if (!c.baseURL || (!c.apiKey && !cfg.hasKey)) { toast('请先填 API 地址和 Key'); return; }
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
    if (filled && (!c.baseURL || (!c.apiKey && !cfg.hasKey) || !c.model)) {
      toast('AI 配置不完整：API 地址、Key、模型名都要填');
      return;
    }
    const saved = await api.cloudConfigSet(c);
    state.flags.cloudAI = { ...c, apiKey: '', hasKey: !!(saved && saved.hasKey) };
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
/* ================= 手动标注 AI 分类（数据标注式） =================
 * 给一张或多张图手动指定「AI 分类」里的某个文件夹，写 aiManual=true，
 * 之后重跑 AI 识别会跳过这些图，不会覆盖人的判断。
 */
function labelModal(paths, after) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  const imgs = list.map(p => byPath.get(p)).filter(Boolean);
  const single = list.length === 1 ? imgs[0] : null;

  const counts = new Map();
  for (const i of state.images) if (i.aiClusterName) counts.set(i.aiClusterName, (counts.get(i.aiClusterName) || 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  const uniq = new Set(imgs.map(i => i.aiClusterName || ''));
  let picked = uniq.size === 1 ? [...uniq][0] : null; // null = 多张且分类不一致
  let pickedIsNew = false;

  const ov = showModal(`
    <h3>${single ? tr('标注分类') : `${tr('批量标注')} · ${list.length} ${tr('张')}`}</h3>
    <p class="hint" style="margin-bottom:12px">${tr('手动标注后重新跑 AI 识别也不会被覆盖。')}</p>
    ${single ? `<div class="label-preview">
      <img src="${esc(single.thumbUrl || '')}" alt="">
      <div class="lp-meta">
        <div class="lp-name">${esc(baseName(single.path))}</div>
        <div class="lp-cur">${tr('当前')}：<b>${single.aiClusterName ? esc(single.aiClusterName) : tr('未分类')}</b></div>
      </div>
    </div>` : ''}
    <input id="label-q" class="label-search" type="text" autocomplete="off" spellcheck="false"
      placeholder="${tr('搜索分类，直接输入可新建…')}">
    <div class="label-list" id="label-list"></div>
    <div class="modal-foot">
      <button class="chip danger" id="label-clear">${tr('清除标注')}</button>
      <button class="chip" id="label-cancel">${tr('取消')}</button>
      <button class="btn-primary" id="label-ok">${tr('应用')}</button>
    </div>`);

  const q = ov.querySelector('#label-q');
  const listEl = ov.querySelector('#label-list');

  const rowsHtml = () => {
    const kw = q.value.trim();
    const hit = kw ? cats.filter(c => c.toLowerCase().includes(kw.toLowerCase())) : cats;
    let h = '';
    if (!kw) h += `<button class="label-row${picked === '' && !pickedIsNew ? ' sel' : ''}" data-cat=""><span class="lr-name muted">${tr('未分类 / 清除')}</span></button>`;
    for (const c of hit) {
      h += `<button class="label-row${!pickedIsNew && picked === c ? ' sel' : ''}" data-cat="${esc(c)}">
        <span class="lr-name">${esc(c)}</span><span class="lr-cnt">${counts.get(c) || 0}</span></button>`;
    }
    if (kw && !cats.includes(kw)) {
      h += `<button class="label-row new${pickedIsNew ? ' sel' : ''}" data-new="1">
        ＋ ${tr('新建分类')}「${esc(kw)}」</button>`;
    }
    if (!hit.length && !kw) h += `<div class="hint" style="padding:10px 2px">${tr('还没有分类，直接输入名字新建')}</div>`;
    return h;
  };
  const paint = () => { listEl.innerHTML = rowsHtml(); };
  paint();

  q.oninput = () => { pickedIsNew = false; paint(); };
  q.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const kw = q.value.trim();
      if (kw && !cats.includes(kw)) { apply(kw); return; }
      apply(picked);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...listEl.querySelectorAll('.label-row')];
      if (!all.length) return;
      const at = all.findIndex(el => el.classList.contains('sel'));
      const next = e.key === 'ArrowDown' ? Math.min(all.length - 1, at + 1) : Math.max(0, at - 1);
      all[next].click();
      all[next].scrollIntoView({ block: 'nearest' });
    }
  };

  listEl.onclick = e => {
    const row = e.target.closest('.label-row');
    if (!row) return;
    if (row.dataset.new) { pickedIsNew = true; picked = q.value.trim(); }
    else { pickedIsNew = false; picked = row.dataset.cat || ''; }
    paint();
    q.focus();
  };
  listEl.ondblclick = e => {
    const row = e.target.closest('.label-row');
    if (!row) return;
    if (row.dataset.new) apply(q.value.trim()); else apply(row.dataset.cat || '');
  };

  ov.querySelector('#label-cancel').onclick = () => ov.remove();
  ov.querySelector('#label-clear').onclick = () => apply('');

  async function apply(target) {
    if (target === null) { toast(tr('请先选一个分类')); return; }
    await api.batchSetCategory(list, target);
    for (const p of list) {
      const it = byPath.get(p);
      if (!it) continue;
      it.aiClusterName = target || '';
      it.aiCategory = target || '';
      it.aiManual = !!target;
      it.aiConf = null;
    }
    ov.remove();
    if (after) after(target);
    toast(target ? `${tr('已标注为')}「${target}」` : tr('已清除分类标注'));
  }

  ov.querySelector('#label-ok').onclick = () => {
    const kw = q.value.trim();
    if (pickedIsNew || (kw && !cats.includes(kw) && kw)) { apply(kw); return; }
    apply(picked);
  };
  setTimeout(() => q.focus(), 40);
}

async function categoryModal(paths = [...state.selected]) {
  if (!paths.length) return;
  labelModal(paths, async () => {
    paths.forEach(p => state.selected.delete(p));
    await refreshLibrary();
  });
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
