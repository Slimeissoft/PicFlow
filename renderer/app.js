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
const AI_CATS = ['角色图', '风景图', '插画·CG', '动物·萌宠', '物品·道具', '美食', '截图', '其他'];
const byPath = new Map();
const thumbCache = new Map();
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
  if (thumbCache.has(p)) { imgEl.src = thumbCache.get(p); return; }
  const url = await api.getThumb(p);
  if (url && imgEl.isConnected) { thumbCache.set(p, url); imgEl.src = url; }
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
  else if (v.type === 'aicat') list = state.images.filter(i => base(i) && i.aiCategory === v.key);
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

/* ================= 侧边栏 ================= */
function renderSidebar() {
  const items = state.images.filter(live);
  const v = state.view;
  const act = (t, k) => (v.type === t && (v.key || null) === (k || null)) ? ' active' : '';
  const cnt = n => `<span class="cnt">${n}</span>`;

  const starN = items.filter(i => i.starred).length;
  const nsfwN = items.filter(i => i.nsfw).length;

  const dateMap = new Map();
  for (const i of items) { const k = monthOf(i); dateMap.set(k, (dateMap.get(k) || 0) + 1); }
  const dates = [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const typeMap = new Map();
  for (const i of items) typeMap.set(i.type, (typeMap.get(i.type) || 0) + 1);
  const types = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);

  const tagMap = new Map();
  for (const i of items) for (const t of (i.tags || [])) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]);

  const aiMap = new Map();
  for (const i of items) if (i.aiCategory) aiMap.set(i.aiCategory, (aiMap.get(i.aiCategory) || 0) + 1);
  const classified = [...aiMap.values()].reduce((s, n) => s + n, 0);
  const trashN = state.images.filter(i => i.trashed || i.missing).length;

  let h = '';
  h += `<div class="nav-sec">图库</div>`;
  h += `<div class="nav-item${act('all', null)}" data-type="all">${ICONS.grid}<span class="lbl">全部图片</span>${cnt(items.length)}</div>`;
  h += `<div class="nav-item${act('star', null)}" data-type="star">${ICONS.star}<span class="lbl">星标</span>${starN ? cnt(starN) : ''}</div>`;
  h += `<div class="nav-item${act('nsfw', null)}" data-type="nsfw"><span class="nav-emoji">🔞</span><span class="lbl">NSFW 专区</span>${nsfwN ? cnt(nsfwN) : ''}</div>`;

  h += `<div class="nav-sec">分类</div>`;
  // 三个区块整体可折叠：点区块标题行收起/展开，默认全部收起
  if (!state.collapsedSections) state.collapsedSections = new Set(['date', 'ftype', 'aicat']);
  const secOpen = s => !state.collapsedSections.has(s);
  const tri = o => `<span class="tri">${o ? '▾' : '▸'}</span>`;
  h += `<div class="nav-group">
    <div class="nav-item head sec-toggle${secOpen('date') ? ' open' : ''}" data-sec="date">${ICONS.calendar}<span class="lbl">${tri(secOpen('date'))} 拍摄日期</span></div>`;
  if (secOpen('date')) {
    // 按年分组可折叠：首次只展开最新一年，点年份行折叠/展开
    const byYear = new Map();
    for (const [k, n] of dates) {
      const y = k.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push([k, n]);
    }
    if (!state.collapsedYears) {
      state.collapsedYears = new Set();
      const ys = [...byYear.keys()];
      for (const y of ys.slice(1)) state.collapsedYears.add(y); // 除最新年外默认折叠
    }
    if (dates.length) {
      for (const [y, months] of byYear) {
        const collapsed = state.collapsedYears.has(y);
        const yN = months.reduce((s, [, n]) => s + n, 0);
        h += `<div class="nav-sub year-toggle${collapsed ? '' : ' open'}" data-year="${y}"><span class="lbl"><span class="tri">${collapsed ? '▸' : '▾'}</span> ${y}年</span>${cnt(yN)}</div>`;
        if (!collapsed) h += months.map(([k, n]) =>
          `<div class="nav-sub${act('date', k)}" data-type="date" data-key="${k}"><span class="lbl">${+k.slice(5, 7)}月</span>${cnt(n)}</div>`).join('');
      }
    } else h += '<div class="nav-sub empty">暂无数据</div>';
  }
  h += `</div>`;
  h += `<div class="nav-group">
    <div class="nav-item head sec-toggle${secOpen('ftype') ? ' open' : ''}" data-sec="ftype">${ICONS.file}<span class="lbl">${tri(secOpen('ftype'))} 文件类型</span></div>
    ${secOpen('ftype') ? (types.length ? types.map(([k, n]) =>
      `<div class="nav-sub${act('ftype', k)}" data-type="ftype" data-key="${esc(k)}"><span class="lbl">${esc(k)}</span>${cnt(n)}</div>`).join('')
      : '<div class="nav-sub empty">暂无数据</div>') : ''}
  </div>`;
  h += `<div class="nav-group">
    <div class="nav-item head sec-toggle${secOpen('aicat') ? ' open' : ''}" data-sec="aicat">${ICONS.ai}<span class="lbl">${tri(secOpen('aicat'))} 智能分类</span></div>
    ${secOpen('aicat') ? ((classified ? AI_CATS.filter(c => aiMap.has(c)).map(c => {
        const n = aiMap.get(c);
        return `<div class="nav-sub${act('aicat', c)}" data-type="aicat" data-key="${esc(c)}"><span class="lbl">${esc(c)}</span>${cnt(n)}</div>`;
      }).join('')
      : '<div class="nav-sub empty">尚未分类</div>') + `
    <div class="nav-sub ai-run${state.aiRunning ? ' busy' : ''}" id="ai-run">${ICONS.play}<span class="lbl">${state.aiRunning ? `分类中 ${state.aiDone}/${state.aiTotal}` : '运行 AI 分类'}</span></div>
    ${state.aiError ? `<div class="nav-sub empty" title="${esc(state.aiError)}">${esc(state.aiError)}</div>` : ''}`) : ''}
  </div>`;

  h += `<div class="nav-sec">相册 <button id="btn-new-album" class="mini-btn" title="新建相册">＋</button></div>`;
  h += state.albums.length
    ? state.albums.map(a => `<div class="nav-item${act('album', a.id)}" data-type="album" data-key="${a.id}">${ICONS.album}<span class="lbl">${esc(a.name)}</span>${cnt((a.paths || []).length)}</div>`).join('')
    : '<div class="nav-sub empty">还没有相册</div>';

  h += `<div class="nav-sec">标签</div>`;
  h += tags.length
    ? tags.slice(0, 20).map(([k, n]) => `<div class="nav-item${act('tag', k)}" data-type="tag" data-key="${esc(k)}">${ICONS.tag}<span class="lbl">${esc(k)}</span>${cnt(n)}</div>`).join('')
    : '<div class="nav-sub empty">在图片上添加标签</div>';

  h += `<div class="nav-sec">整理</div>`;
  h += `<div class="nav-item${act('dup', null)}" data-type="dup">${ICONS.copy}<span class="lbl">重复 / 相似</span></div>`;
  h += `<div class="nav-item${act('trash', null)}" data-type="trash">${ICONS.trash}<span class="lbl">回收站</span>${trashN ? cnt(trashN) : ''}</div>`;

  $('#nav').innerHTML = h;
}

$('#nav').addEventListener('click', e => {
  if (e.target.closest('#btn-new-album')) { newAlbumModal(); return; }
  if (e.target.closest('#ai-run')) { runAiClassify(); return; }
  const sec = e.target.closest('.sec-toggle');
  if (sec) {
    const s = sec.dataset.sec;
    if (state.collapsedSections.has(s)) state.collapsedSections.delete(s);
    else state.collapsedSections.add(s);
    renderSidebar();
    return;
  }
  const yr = e.target.closest('.year-toggle');
  if (yr) {
    const y = yr.dataset.year;
    if (state.collapsedYears.has(y)) state.collapsedYears.delete(y);
    else state.collapsedYears.add(y);
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
  if (v.type === 'all') return '全部图片';
  if (v.type === 'star') return '星标';
  if (v.type === 'nsfw') return 'NSFW 专区';
  if (v.type === 'date') return `${v.key.slice(0, 4)}年${+v.key.slice(5, 7)}月`;
  if (v.type === 'ftype') return `${v.key} 图片`;
  if (v.type === 'aicat') return v.key;
  if (v.type === 'tag') return `# ${v.key}`;
  if (v.type === 'album') {
    const a = state.albums.find(x => x.id === v.key);
    return a ? a.name : '相册';
  }
  if (v.type === 'trash') return '回收站';
  return '图库';
}

function renderContent() {
  const v = state.view;
  if (v.type === 'dup') { renderDuplicates(); return; }
  $('#dup-root').classList.add('hidden');
  $('#grid').classList.remove('hidden');

  const items = state.items = currentItems();
  const sum = items.reduce((s, i) => s + (i.size || 0), 0);
  const title = viewTitle();
  $('#crumb').textContent = `图库 / ${title}`;

  let sub = `${items.length} 张 · 合计 ${fmtSize(sum)}`;
  if (v.type === 'trash') sub += ' · 已删除文件在系统回收站中，可随时还原';
  let head = `<div><div class="view-title">${esc(title)}</div><div class="view-sub">${sub}</div></div>`;
  head += `<div class="head-actions">`;
  if (v.type === 'album') head += `<button class="chip" id="btn-album-rename">重命名</button><button class="chip danger" id="btn-album-del">删除相册</button>`;
  if (v.type === 'trash') head += `<button class="chip danger" id="btn-clear-rec">清除全部记录</button>`;
  if (v.type !== 'trash' && v.type !== 'dup') head += `<button class="chip" id="btn-ai-head" title="用本地 AI 模型自动归类">⚡ AI 分类</button>`;
  head += `<button class="chip" id="btn-selall">全选</button>
    <div class="slider-wrap">${ICONS.zoomOut}<input id="thumb-size" type="range" min="110" max="300" value="${state.size}" title="缩略图大小">${ICONS.zoomIn}</div>
  </div>`;
  $('#view-head').innerHTML = head;

  $('#btn-selall').onclick = selectAll;
  const aiHead = $('#btn-ai-head');
  if (aiHead) aiHead.onclick = runAiClassify;
  $('#thumb-size').oninput = e => {
    state.size = +e.target.value;
    document.documentElement.style.setProperty('--cell', state.size + 'px');
  };
  const alBtn = $('#btn-album-del');
  if (alBtn) alBtn.onclick = deleteCurrentAlbum;
  const alRen = $('#btn-album-rename');
  if (alRen) alRen.onclick = renameCurrentAlbum;
  const clr = $('#btn-clear-rec');
  if (clr) clr.onclick = () => clearRecords(state.images.filter(i => i.trashed || i.missing).map(i => i.path));

  renderGrid();
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
      <h2>欢迎使用 PicFlow 图片管家</h2>
      <p>三步开始整理你的本地图片：</p>
      <ol>
        <li><b>导入</b> — 点击「扫描文件夹」，选择存放图片的目录（自动包含子文件夹）</li>
        <li><b>浏览</b> — 图片按拍摄日期、文件类型自动分类，左侧栏切换视图</li>
        <li><b>整理</b> — 单击看大图；点右上「多选」后点击图片直接选中，可批量打标签、建相册、重命名、移动、删除</li>
      </ol>
      <p class="muted">「重复 / 相似」视图可一键清理重复图片；搜索框支持文件名、标签与备注。</p>
      <div class="empty-actions">
        <button class="btn-primary" id="empty-scan">扫描文件夹</button>
        <button class="chip" id="empty-guide">查看使用引导</button>
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
  $('#sb-count').innerHTML = `已选 <b>${n}</b> 张`;
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
  set('clearrec', v.type === 'trash');
}

$('#selbar').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) {
    const act = b.dataset.act;
    if (act === 'star') batchStar();
    else if (act === 'nsfw') batchNsfw();
    else if (act === 'tag') tagModal();
    else if (act === 'aicat') aicatModal();
    else if (act === 'album') albumModal();
    else if (act === 'move') moveSelected();
    else if (act === 'rename') renameModal();
    else if (act === 'trash') trashSelected();
    else if (act === 'revive') reviveSelected();
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
async function openLightbox(idx) {
  const it = state.items[idx];
  if (!it) return;
  state.lbIndex = idx;
  $('#lightbox').classList.remove('hidden');
  const cached = thumbCache.get(it.path);
  $('#lb-img').src = cached || '';
  const full = await api.readImage(it.path);
  if (full && state.lbIndex === idx) $('#lb-img').src = full.dataUrl;
  renderLbPanel(it);
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lb-img').src = '';
  state.lbIndex = -1;
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
      <button id="lb-star"${starCls}>${it.starred ? '★ 已星标' : '☆ 加星标'}</button>
      <button id="lb-nsfw"${nsfwCls}>${it.nsfw ? '🔞 NSFW' : '🔞 标记 NSFW'}</button>
    </div>
    <div class="lb-aicat">
      <span class="lb-aicat-lbl">AI 分类</span>
      <select id="lb-aicat-sel" class="lb-select">
        <option value="">未分类</option>
        ${AI_CATS.map(c => `<option value="${esc(c)}"${it.aiCategory === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      ${it.aiManual ? '<span class="lb-manual" title="已手动纠正，重新跑 AI 不会覆盖">手动</span>' : ''}
    </div>
    <div class="lb-info">
      <div><span>拍摄时间</span><b>${it.exifDate ? fmtDate(it.exifDate) : '未记录'}</b></div>
      <div><span>修改时间</span><b>${fmtDate(it.mtime)}</b></div>
      <div><span>类型</span><b>${esc(it.type)}</b></div>
      <div><span>大小</span><b>${fmtSize(it.size)}</b></div>
    </div>
    <div class="lb-sec">标签</div>
    <div class="tag-editor" id="lb-tags">
      ${(it.tags || []).map(t => `<span class="tag">${esc(t)}<i data-tag="${esc(t)}">✕</i></span>`).join('')}
      <input id="lb-tag-in" placeholder="回车添加">
    </div>
    <div class="lb-sec">备注</div>
    <textarea id="lb-note" rows="3" placeholder="添加备注…">${esc(it.note || '')}</textarea>
    <div class="lb-sec">所属相册</div>
    <div>${albums.length ? albums.map(a => `<span class="tag">${esc(a.name)}</span>`).join('') : '<span class="muted">无</span>'}</div>
    <div class="lb-actions">
      <button class="chip" id="lb-folder">在文件夹中显示</button>
      <button class="chip danger" id="lb-del">删除</button>
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
    it.aiCategory = v || null;
    it.aiManual = !!v;
    it.aiConf = null;
    await api.updateImage(it.path, { aiCategory: v });
    renderLbPanel(it);
    renderSidebar();
    renderGrid();
    toast(v ? `已改为「${v}」` : '已清除分类');
  };
  $('#lb-folder').onclick = () => api.openInFolder(it.path);
  $('#lb-star').onclick = async () => { await toggleStar(it.path); renderLbPanel(it); };
  $('#lb-nsfw').onclick = async () => { await toggleNsfw(it.path); renderLbPanel(it); };
  $('#lb-del').onclick = async () => {
    if (!(await confirmModal('移出图片', `将「${baseName(it.path)}」从图库移除？\\n文件不会被删除，可在左侧「回收站」中恢复。`, '移出', true))) return;
    const res = await api.trashFiles([it.path]);
    if (res[0] && res[0].ok) {
      closeLightbox();
      await refreshLibrary();
      toast('已移入软件回收站');
    } else {
      toast('移出失败：' + ((res[0] && res[0].error) || '未知错误').slice(0, 60));
    }
  };
}
$('#lb-prev').onclick = () => lbNav(-1);
$('#lb-next').onclick = () => lbNav(1);
$('#lb-close').onclick = closeLightbox;
/* 点击图片以外的空白处关闭灯箱 */
$('#lightbox').addEventListener('mousedown', e => {
  if (e.target === $('#lightbox') || e.target.classList.contains('lb-stage') || e.target.id === 'lb-hint') closeLightbox();
});

/* ================= 弹窗 ================= */
function showModal(html) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal">${html}</div>`;
  $('#modal-root').append(ov);
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
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

/* 批量改分类 */
function aicatModal() {
  const paths = [...state.selected];
  if (!paths.length) return;
  const ov = showModal(`<h3>批量改分类（${paths.length} 张）</h3>
    <div class="row"><label class="f-label">选择分类</label>
      <select id="ac-sel" class="lb-select">
        <option value="">未分类（清除）</option>
        ${AI_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select></div>
    <div class="modal-foot"><button class="chip" id="ac-cancel">取消</button>
    <button class="btn-primary" id="ac-ok">应用</button></div>`);
  ov.querySelector('#ac-cancel').onclick = () => ov.remove();
  ov.querySelector('#ac-ok').onclick = async () => {
    const v = ov.querySelector('#ac-sel').value;
    ov.remove();
    for (const p of paths) {
      const im = byPath.get(p);
      if (im) { im.aiCategory = v || null; im.aiManual = !!v; im.aiConf = null; }
      await api.updateImage(p, { aiCategory: v });
    }
    state.selected.clear();
    syncSelectionUI();
    renderGrid();
    renderSidebar();
    toast(v ? `已将 ${paths.length} 张改为「${v}」` : `已清除 ${paths.length} 张的分类`);
  };
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
    el.textContent = `扫描中 ${state.scanDone}/${state.scanTotal}`;
  } else {
    el.className = 'pill green';
    el.textContent = `已收录 ${state.images.filter(live).length} 张`;
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
    if (!$('#lightbox').classList.contains('hidden')) closeLightbox();
    return;
  }
  if (!$('#lightbox').classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') lbNav(-1);
    if (e.key === 'ArrowRight') lbNav(1);
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
$('#btn-menu').onclick = () => $('#sidebar').classList.toggle('collapsed');
/* 多选模式开关：开启后点图即选中，圆圈显示；退出时清空选择 */
$('#btn-multi').onclick = () => {
  state.multi = !state.multi;
  const btn = $('#btn-multi');
  btn.classList.toggle('on', state.multi);
  btn.textContent = state.multi ? '✓ 完成选择' : '☑ 多选';
  $('#grid').classList.toggle('multi', state.multi);
  $('#hint-bar').textContent = state.multi
    ? '点击图片 选中/取消 · Shift+点击 范围选择 · 选好后用底部操作条批量处理 · 点「完成选择」退出'
    : '单击 预览 · 开启右上「多选」后点击图片直接选中 · Ctrl+A 全选 · Del 移出';
  if (!state.multi) { state.selected.clear(); syncSelectionUI(); }
};
$('#btn-nsfw').onclick = () => {
  // 三态循环：隐藏 → 显示全部 → 仅看 NSFW
  const cur = state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
  const next = cur === 'hidden' ? 'shown' : (cur === 'shown' ? 'only' : 'hidden');
  state.flags.nsfwMode = next;
  api.setFlag('nsfwMode', next);
  syncNsfwButton();
  renderSidebar();
  renderContent();
};
function syncNsfwButton() {
  const mode = state.flags.nsfwMode || (state.flags.nsfwHidden === false ? 'shown' : 'hidden');
  const btn = $('#btn-nsfw');
  btn.classList.toggle('show', mode !== 'hidden');
  btn.innerHTML = mode === 'hidden' ? '● NSFW 已隐藏'
    : mode === 'shown' ? '● NSFW 显示中'
    : '🔞 仅看 NSFW';
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

/* ================= AI 智能分类 ================= */
async function runAiClassify() {
  if (state.aiRunning) return;
  state.aiRunning = true; state.aiDone = 0; state.aiError = '';
  renderSidebar();
  try {
    const r = await api.aiClassifyAll({ redo: true });
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

/* ================= 初始化 ================= */
(async function init() {
  const lib = await api.getLibrary();
  state.images = lib.images;
  state.albums = lib.albums;
  state.folders = lib.folders;
  state.flags = lib.flags;
  rebuildIndex();
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

  api.on('ai:start', () => { state.aiRunning = true; state.aiDone = 0; renderSidebar(); });
  api.on('ai:total', d => { state.aiTotal = d.total; renderSidebar(); });
  api.on('ai:progress', d => { state.aiDone = d.done; renderSidebar(); });
  api.on('ai:item', d => {
    const it = byPath.get(d.path);
    if (it) it.aiCategory = d.category;
    if (gridTimer) return;
    gridTimer = setTimeout(() => { gridTimer = null; renderSidebar(); if (state.view.type === 'aicat') renderContent(); }, 500);
  });
  api.on('ai:done', async d => {
    state.aiRunning = false;
    if (d && d.error) { state.aiError = d.error; toast('AI 分类失败：' + d.error); }
    else { toast(`AI 分类完成：成功 ${d.ok || 0} / ${d.done || 0} 张`); }
    await refreshLibrary();
  });
})();
