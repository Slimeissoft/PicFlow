'use strict';
// 必须在最早期设置：主进程 I/O 线程池太小会让批量缩略图读盘排队（默认 4）
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, clipboard, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const cp = require('child_process');
const crypto = require('crypto');
const { walkImages, extractExifDate, computePhash } = require('./scanner');
const DB = require('./db');
const AI = require('./ai');
const CloudAI = require('./cloudai');

/* ============================================================
 * 安全边界（2026-11-06 审计后加固）
 *
 * 1) 只信任本地页面发来的 IPC：preload 在每次导航时都会重新注入，
 *    若窗口被导航到远程页面，那个页面也会拿到 window.api。
 *    所以所有 handler 一律校验 senderFrame.url 必须是 file://。
 * 2) 文件类操作只接受图库内的路径：防止渲染层被攻陷后被拿来
 *    读写/删除/执行任意文件。
 * ============================================================ */
function assertLocalSender(e) {
  const url = (e && e.senderFrame && e.senderFrame.url) || '';
  if (!url.startsWith('file://')) throw new Error('unauthorized: non-local sender');
}

/* 所有 IPC 统一走这里，天然带上发送方校验 */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    assertLocalSender(e);
    return fn(e, ...args);
  });
}

/* 路径必须属于图库：数据库里有记录，或位于已扫描的文件夹内 */
function assertLibraryPath(p) {
  const s = String(p || '');
  if (!s) throw new Error('bad path');
  if (DB.getImage(s)) return s;
  const norm = path.resolve(s).toLowerCase();
  const roots = DB.getFolders().map(f => path.resolve(f).toLowerCase());
  if (roots.some(r => norm === r || norm.startsWith(r + path.sep))) return s;
  throw new Error('path not in library: ' + s);
}

/* 过滤文件名里的非法/穿越字符，只允许「纯名字」 */
function safeBaseName(name) {
  return String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
}

/* ---------- API Key：用系统凭据加密后再落盘 ---------- */
function decryptApiKey(cfg) {
  if (!cfg) return '';
  if (cfg.apiKeyEnc) {
    try { return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64')); } catch { return ''; }
  }
  return cfg.apiKey || '';   // 兼容 1.6.1 及更早的明文数据
}
function encryptApiKey(key) {
  const s = String(key || '');
  if (!s) return {};
  if (safeStorage.isEncryptionAvailable()) {
    return { apiKeyEnc: safeStorage.encryptString(s).toString('base64') };
  }
  return { apiKey: s };   // 系统不支持加密时的兜底
}
/* 主进程内部用：拿到带明文 key 的可用配置 */
function cloudConfigResolved() {
  const cfg = DB.getFlags().cloudAI || {};
  return { ...cfg, apiKey: decryptApiKey(cfg) };
}

/* ============================================================
 * 旧数据目录迁移（产品名从「PicFlow 图片管家」改为 PicFlow）
 *
 * Electron 的 userData 目录名取自应用名，改名后会从
 *   %APPDATA%\PicFlow 图片管家   →   %APPDATA%\PicFlow
 * 老用户的 library.json / thumbs 都躺在旧目录里。这段必须在任何
 * 读写之前跑完（模块加载期），否则升级后打开就是空图库。
 *
 * 策略：只搬「真的属于用户」的东西（索引 + 缩略图），
 * Chromium 自己的缓存让它在新目录重建。搬不动就把 userData
 * 指回旧目录 —— 宁可目录名难看，也不能让人看不到图。
 * ============================================================ */
(function migrateLegacyUserData() {
  if (!app.isPackaged) return;                      // 开发模式不碰
  const appData = app.getPath('appData');
  const legacy = path.join(appData, 'PicFlow 图片管家');
  const current = app.getPath('userData');
  if (path.resolve(legacy) === path.resolve(current)) return;

  const libOf = d => path.join(d, 'library.json');
  const mark = path.join(current, '.migrated-from-legacy');
  const countImages = f => {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      return Array.isArray(j.images) ? j.images.length : 0;
    } catch { return 0; }
  };

  try {
    if (!fs.existsSync(libOf(legacy))) return;      // 全新安装，没有旧数据
    if (fs.existsSync(mark)) return;                // 已经处理过
    if (countImages(libOf(current)) > 0) {          // 新目录已有真图库，绝不覆盖
      fs.writeFileSync(mark, new Date().toISOString());
      return;
    }
    fs.mkdirSync(current, { recursive: true });
    // current 里有空库（例如开发模式跑过一次）先留个备份，再整份换成旧图库
    if (fs.existsSync(libOf(current))) {
      fs.copyFileSync(libOf(current), libOf(current) + '.bak-before-migrate');
    }
    const tmp = libOf(current) + '.migrating';
    fs.copyFileSync(libOf(legacy), tmp);
    fs.renameSync(tmp, libOf(current));             // 原子落位，避免半截 JSON
    // thumbs = 缩略图缓存；Local Storage 里放着语言、侧栏折叠等界面偏好
    const isEmptyDir = d => fs.existsSync(d) && fs.statSync(d).isDirectory() && fs.readdirSync(d).length === 0;
    for (const sub of ['thumbs', 'Local Storage']) {
      const from = path.join(legacy, sub);
      const to = path.join(current, sub);
      if (!fs.existsSync(from)) continue;
      if (fs.existsSync(to) && !isEmptyDir(to)) continue;   // 新目录里已经有内容，不覆盖
      fs.cpSync(from, to, { recursive: true, force: true });
    }
    fs.writeFileSync(mark, new Date().toISOString());
    console.log('[migrate] 已从旧数据目录导入图库：', legacy, '→', current);
  } catch (e) {
    console.error('[migrate] 迁移失败，继续使用旧目录：', e.message);
    try { app.setPath('userData', legacy); } catch (e2) { console.error('[migrate]', e2.message); }
  }
})();

// 自定义协议：缩略图直接由 Chromium 加载（不经 IPC + base64，启动/浏览快数倍）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'picflow-thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

let win = null;
let scanning = false;
let aiRunning = false;
let aiCancel = false;

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'
};

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#f6f7f8',
    autoHideMenuBar: true,
    show: false,
    title: 'PicFlow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // 安全：只允许停留在本地页面，禁止被导航到远程站点
  // （preload 每次导航都会重新注入，导航出去等于把 window.api 交给对方）
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      console.warn('[security] blocked navigation:', url);
    }
  });
  // 安全：禁止 window.open 在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn('[security] blocked window.open:', url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // 缩略图协议：picflow-thumb://thumb/<md5>.jpg → userData/thumbs/<md5>.jpg
  // 让渲染进程的 <img src> 直接由 Chromium 读盘，省掉 IPC + base64 编解码
  protocol.handle('picflow-thumb', async request => {
    try {
      const u = new URL(request.url);
      const raw = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/\.jpg$/i, '');
      if (!/^[a-f0-9]{32}$/i.test(raw)) return new Response('bad request', { status: 400 });
      const buf = await fsp.readFile(path.join(thumbDir(), raw + '.jpg'));
      return new Response(buf, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  // macOS：应用菜单（Cmd+Q / Cmd+W / 编辑菜单的复制粘贴都靠它）。
  // 用 role 让系统按语言自动本地化；Windows 保持无菜单栏。
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ]));
  }
  createWindow();
  setupAutoUpdater();
  // 文件夹自动同步：启动后 8 秒（避开首屏加载的磁盘/IO 竞争），之后每 5 分钟静默重扫
  setTimeout(autoSyncFolders, 8000);
  setInterval(autoSyncFolders, 5 * 60 * 1000);
});
// macOS：关掉窗口不退出进程（Dock 里点回来重新开窗），符合平台习惯
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', () => DB.flushSync());

/* ---------------- helpers ---------------- */

const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');

async function thumbPathFor(f, st) {
  const key = crypto.createHash('md5').update(`${f}|${st.mtimeMs}|${st.size}`).digest('hex');
  return path.join(thumbDir(), key + '.jpg');
}

async function ensureThumb(f, img, st) {
  const tp = await thumbPathFor(f, st);
  try { await fsp.access(tp); return tp; } catch { /* need create */ }
  if (!img || img.isEmpty()) return null;
  try {
    await fsp.mkdir(thumbDir(), { recursive: true });
    await fsp.writeFile(tp, img.resize({ width: 440 }).toJPEG(82));
    return tp;
  } catch (e) { console.error('thumb error:', f, e.message); return null; }
}

function imgDateOf(i) {
  if (i.exifDate) return i.exifDate;
  const d = new Date(i.mtime);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 处理单个文件：快速哈希 + EXIF + 感知哈希 + 缩略图；内容未变时返回 null */
async function processFile(f) {
  // 被用户"清除记录"的文件不再被自动同步加回（除非用户主动取消忽略）
  if (DB.isIgnored(f)) return null;
  const st = await fsp.stat(f);
  const existing = DB.getImage(f);
  if (existing && existing.phash && existing.mtime === st.mtimeMs && existing.size === st.size) {
    // 文件回来了只解除 missing；软删除（trashed）保持不动，同步不得复活已删除图片
    if (existing.missing && !existing.trashed) DB.revive(f);
    return null;
  }
  const fh = await fsp.open(f, 'r');
  const head = Buffer.alloc(Math.min(262144, st.size));
  const { bytesRead } = await fh.read(head, 0, head.length, 0);
  let tail = Buffer.alloc(0);
  const tailLen = st.size - bytesRead;
  if (tailLen > 0) {
    const tb = Buffer.alloc(Math.min(65536, tailLen));
    await fh.read(tb, 0, tb.length, st.size - tb.length);
    tail = tb;
  }
  await fh.close();
  const headBuf = head.subarray(0, bytesRead);
  const quickHash = crypto.createHash('md5')
    .update(headBuf).update(tail).update(Buffer.from('|' + st.size)).digest('hex');
  const exifDate = extractExifDate(headBuf);
  const img = nativeImage.createFromPath(f);
  const phash = img.isEmpty() ? null : computePhash(img);
  await ensureThumb(f, img, st);
  return {
    path: f, quickHash, phash, exifDate,
    mtime: st.mtimeMs, size: st.size,
    type: (path.extname(f).slice(1) || 'IMG').toUpperCase(),
    tags: (existing && existing.tags) || [],
    note: (existing && existing.note) || '',
    starred: (existing && existing.starred) || false,
    nsfw: (existing && existing.nsfw) || false,
    aiCategory: (existing && existing.aiCategory) || null,
    addedAt: (existing && existing.addedAt) || Date.now(),
    trashed: !!(existing && existing.trashed), missing: false
  };
}

/* ---------------- IPC ---------------- */

handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('pick-move-dest', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/* 扫描核心：手动扫描（带进度事件）与自动同步（静默）共用 */
async function scanFolderCore(folder, opts = {}) {
  const silent = !!opts.silent;
  if (scanning) return { busy: true };
  scanning = true;
  if (!silent) send('scan:start', { folder });
  try {
    const files = walkImages(folder);
    if (!silent) send('scan:total', { total: files.length });
    let done = 0, added = 0;
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const rec = await processFile(f);
          if (rec) { DB.upsertImage(rec); if (!rec.trashed) added++; if (!silent) send('scan:item', rec); }
        } catch (err) { console.error('process failed:', f, err.message); }
        done++;
        if (!silent && (done % 3 === 0 || done === files.length)) send('scan:progress', { done, total: files.length });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // 标记已消失的文件（被外部移动/删除）
    const present = new Set(files.map(f => path.normalize(f).toLowerCase()));
    let missingCount = 0;
    const fl = folder.toLowerCase();
    for (const img of DB.getImages()) {
      const np = path.normalize(img.path).toLowerCase();
      if (!img.missing && np.startsWith(fl) && !present.has(np)) {
        DB.updateImage(img.path, { missing: true });
        missingCount++;
      }
    }
    DB.addFolder(folder);
    DB.flushSync();
    if (!silent) send('scan:done', { folder, total: files.length, missing: missingCount });
    return { ok: true, total: files.length, added, missing: missingCount };
  } finally { scanning = false; }
}

handle('scan-folder', async (e, folder) => scanFolderCore(folder));

/* 自动同步：静默重扫所有已登记文件夹，内容有变化才通知前端刷新，不打扰浏览 */
async function autoSyncFolders() {
  if (scanning || aiRunning) return;
  const folders = DB.getFolders();
  if (!folders.length) return;
  let added = 0, changed = 0;
  for (const f of folders) {
    if (scanning) break;
    try {
      const r = await scanFolderCore(f, { silent: true });
      added += r.added || 0;
      changed += r.missing || 0;
    } catch (err) { console.error('auto sync failed:', f, err.message); }
  }
  if (added > 0 || changed > 0) send('sync:done', { added, missing: changed });
}

handle('get-library', async () => {
  // 给每条记录附上缩略图 URL（hash 算法与 thumbPathFor 一致：md5(path|mtime|size)）
  // 渲染端 <img src=thumbUrl> 直接由自定义协议加载，避免 300+ 次 IPC + base64
  const images = DB.getImages().map(i => {
    let thumbUrl = null;
    try {
      if (i.mtime != null && i.size != null) {
        const key = crypto.createHash('md5').update(`${i.path}|${i.mtime}|${i.size}`).digest('hex');
        thumbUrl = `picflow-thumb://thumb/${key}.jpg`;
      }
    } catch {}
    return { ...i, thumbUrl };
  });
  return {
    images,
    albums: DB.getAlbums(),
    folders: DB.getFolders(),
    // flags 里含 AI 配置：必须剥掉密钥，只保留「有没有配」的状态
    flags: (() => {
      const f = { ...DB.getFlags() };
      if (f.cloudAI) {
        const key = decryptApiKey(f.cloudAI);
        const { apiKey, apiKeyEnc, ...rest } = f.cloudAI;
        f.cloudAI = { ...rest, hasKey: !!key, keyMask: key ? key.slice(0, 3) + '…' + key.slice(-4) : '' };
      }
      return f;
    })()
  };
});

handle('get-thumb', async (e, f) => {
  try {
    const st = await fsp.stat(f);
    let tp = await thumbPathFor(f, st);
    try { await fsp.access(tp); } catch {
      const img = nativeImage.createFromPath(f);
      tp = await ensureThumb(f, img, st);
      if (!tp) return null;
    }
    const buf = await fsp.readFile(tp);
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch { return null; }
});

handle('read-image', async (e, f) => {
  try {
    assertLibraryPath(f);
    const st = await fsp.stat(f);
    const buf = await fsp.readFile(f);
    const mime = MIME[path.extname(f).toLowerCase()] || 'image/png';
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: st.size, mtime: st.mtimeMs };
  } catch { return null; }
});

handle('update-image', async (e, p, patch) => {
  const allowed = {};
  if (Array.isArray(patch.tags)) allowed.tags = patch.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
  if (typeof patch.note === 'string') allowed.note = patch.note;
  if (typeof patch.starred === 'boolean') allowed.starred = patch.starred;
  if (typeof patch.nsfw === 'boolean') allowed.nsfw = patch.nsfw;
  // 手动改分类：标记 aiManual=true，重新跑 AI 时跳过，避免覆盖用户纠正
  // 传空字符串 = 清除分类（恢复未分类）
  if (typeof patch.aiCategory === 'string') {
    const v = patch.aiCategory.trim();
    if (v) {
      allowed.aiCategory = v;
      // 分组视图按 aiClusterName 过滤，必须与 aiCategory 同步，否则改了分类图还在旧组里
      allowed.aiClusterName = v;
      allowed.aiManual = true;
      allowed.aiConf = null;
    } else {
      allowed.aiCategory = null;
      allowed.aiClusterName = null;
      allowed.aiManual = false;
      allowed.aiConf = null;
    }
  }
  DB.updateImage(p, allowed);
  DB.flushSync();
  return { ok: true };
});

function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

handle('get-duplicates', async () => {
  const imgs = DB.getImages().filter(i => !i.trashed && !i.missing);
  const lite = i => ({ path: i.path, type: i.type, size: i.size, date: imgDateOf(i), mtime: i.mtime, quickHash: i.quickHash, phash: i.phash });
  // 完全重复（快速哈希相同）
  const byHash = new Map();
  for (const i of imgs) {
    if (!i.quickHash) continue;
    if (!byHash.has(i.quickHash)) byHash.set(i.quickHash, []);
    byHash.get(i.quickHash).push(i);
  }
  const exact = [...byHash.values()].filter(g => g.length > 1).map(g => g.map(lite));
  const inExact = new Set(exact.flat().map(i => i.path));
  // 相似（dHash 汉明距离 <= 8，并集分组）
  const rest = imgs.filter(i => i.phash && !inExact.has(i.path));
  const parent = new Map(rest.map((_, idx) => [idx, idx]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[i], b = rest[j];
      const mx = Math.max(a.size, b.size);
      if (mx > 0 && Math.abs(a.size - b.size) / mx > 0.25) continue; // 尺寸差异过大，跳过
      if (hamming(a.phash, b.phash) <= 8) union(i, j);
    }
  }
  const groups = new Map();
  rest.forEach((img, idx) => {
    const r = find(idx);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(img);
  });
  const similar = [...groups.values()].filter(g => g.length > 1).map(g => g.map(lite));
  return { exact, similar };
});

handle('rename-files', async (e, pairs) => {
  const results = [];
  for (const { path: p, newName } of pairs) {
    try {
      assertLibraryPath(p);
      const dir = path.dirname(p);
      const ext = path.extname(p);
      const clean = safeBaseName(newName);
      if (!clean) throw new Error('文件名不能为空');
      let target = path.join(dir, clean + ext);
      // 双保险：目标必须和原文件同目录，杜绝 ../ 穿越
      if (path.dirname(path.resolve(target)).toLowerCase() !== path.resolve(dir).toLowerCase()) {
        throw new Error('非法文件名');
      }
      let k = 1;
      while (path.normalize(target).toLowerCase() !== path.normalize(p).toLowerCase() && fs.existsSync(target)) {
        target = path.join(dir, `${newName}_${k}${ext}`);
        k++;
      }
      await fsp.rename(p, target);
      DB.updatePath(p, target);
      results.push({ from: p, to: target, ok: true });
    } catch (err) { results.push({ from: p, ok: false, error: String(err) }); }
  }
  DB.flushSync();
  return results;
});

handle('move-files', async (e, paths, dest) => {
  const results = [];
  for (const p of paths) {
    try {
      assertLibraryPath(p);
      let target = path.join(dest, path.basename(p));
      const ext = path.extname(p);
      const base = path.basename(p, ext);
      let k = 1;
      while (fs.existsSync(target) && path.normalize(target).toLowerCase() !== path.normalize(p).toLowerCase()) {
        target = path.join(dest, `${base}(${k})${ext}`);
        k++;
      }
      if (path.normalize(target).toLowerCase() !== path.normalize(p).toLowerCase()) {
        try { await fsp.rename(p, target); }
        catch (err) {
          if (err.code === 'EXDEV') { await fsp.copyFile(p, target); await fsp.unlink(p); }
          else throw err;
        }
        DB.updatePath(p, target);
      }
      results.push({ from: p, to: target, ok: true });
    } catch (err) { results.push({ from: p, ok: false, error: String(err) }); }
  }
  DB.flushSync();
  return results;
});

/* 把单个文件送入系统回收站（可还原）。
 * 优先用 Electron 的 shell.trashItem；失败时用 PowerShell 的
 * Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(SendToRecycleBin) 兜底。
 * 关键修复：
 * 1) shell.trashItem 对含 # 等特殊字符的路径会 "Failed to parse path" → 走兜底
 * 2) spawnSync('powershell.exe') 在 Electron --no-sandbox 下 PATH 被截断 → 用完整绝对路径
 * 3) 用完整枚举类型名确保送入回收站而非永久删除 */
function logTrash(msg) {
  try {
    const logPath = path.join(app.getPath('userData'), 'trash-debug.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

/** 获取 PowerShell 可执行文件绝对路径（不依赖 PATH 环境变量） */
function findPowerShell() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  // Windows PowerShell 5.1（Win7+ 标配）
  const ps51 = path.join(root, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  if (fs.existsSync(ps51)) return ps51;
  // 极端兜底
  return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

async function trashToRecycleBin(filePath) {
  logTrash('trashToRecycleBin start: ' + filePath);

  // === 关键检查 0：文件是否已不存在？===
  // 之前的删除可能已经把文件删掉了，但 shell.trashItem 报错导致没更新索引。
  // 这种情况下文件物理上已经没了，直接算删除成功，更新索引让 UI 不再显示灰图。
  try {
    if (!fs.existsSync(filePath)) {
      logTrash('文件已不存在（ENOENT）→ 直接标记为已删除');
      return { ok: true, method: 'already-deleted', note: '文件已不存在' };
    }
  } catch (eCheck) {
    logTrash('existsSync 异常: ' + eCheck.message + ' → 继续尝试删除');
  }

  let err1 = '', err2 = '', err3 = '';
  // 方式1：Electron shell.trashItem
  try {
    await shell.trashItem(filePath);
    logTrash('shell.trashItem OK');
    return { ok: true, method: 'shell.trashItem' };
  } catch (e1) {
    err1 = e1.message;
    logTrash('shell.trashItem FAILED: ' + err1);
  }

  // === 关键检查 1：trashItem 报错后再次确认文件是否还在 ===
  // 经验：shell.trashItem 在沙箱 + 特殊字符路径下可能报错但实际已删除
  try {
    if (!fs.existsSync(filePath)) {
      logTrash('trashItem 报错但文件已消失 → 标记为已删除');
      return { ok: true, method: 'trashItem-silent', note: '文件已不在' };
    }
  } catch {}
  // 方式1b：如果路径含特殊字符（# 等）导致 trashItem 解析失败，
  // 先 rename 到临时路径（纯字母数字）再 trashItem，绕过路径解析问题
  if (err1.includes('parse path') || err1.includes('path')) {
    try {
      const tmpDir = path.join(app.getPath('temp'), 'picflow-trash');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpPath = path.join(tmpDir, 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + path.extname(filePath));
      fs.renameSync(filePath, tmpPath);
      logTrash('moved to temp: ' + tmpPath);
      try {
        await shell.trashItem(tmpPath);
        logTrash('shell.trashItem(tmp) OK');
        return { ok: true, method: 'shell.trashItem.tmp' };
      } catch (e1b) {
        // 临时路径 trashItem 也失败，把文件移回原位
        try { fs.renameSync(tmpPath, filePath); } catch {}
        logTrash('shell.trashItem(tmp) FAILED: ' + e1b.message);
      }
    } catch (e1c) {
      logTrash('move-to-temp FAILED: ' + e1c.message);
    }
  }

  // === macOS：到此为止都是 shell.trashItem 的变体，再往下全是 Windows 专用兜底 ===
  // PowerShell / cmd.exe 在 mac 上必然失败，最后会落到 unlink 永久删除 —— 必须在这里拦住。
  // 先用 Finder 的废纸篓（~/.Trash）作为第二条通道，失败就如实报错，绝不静默永久删除。
  if (process.platform === 'darwin') {
    try {
      const trashDir = path.join(app.getPath('home'), '.Trash');
      const ext = path.extname(filePath);
      let dest = path.join(trashDir, path.basename(filePath));
      if (fs.existsSync(dest)) {
        dest = path.join(trashDir, `${path.basename(filePath, ext)}-${Date.now()}${ext}`);
      }
      fs.renameSync(filePath, dest);
      logTrash('macOS: moved to ~/.Trash → ' + dest);
      return { ok: true, method: 'macos.trash' };
    } catch (eMac) {
      logTrash('macOS ~/.Trash FAILED: ' + eMac.message);
      throw new Error(`移入废纸篓失败：${err1} / ${eMac.message}`);
    }
  }

  // 方式2：PowerShell VisualBasic FileIO（用完整枚举类型名 + 绝对路径调用）
  try {
    const psExe = findPowerShell();
    logTrash('powershell exe: ' + psExe + ' exists=' + fs.existsSync(psExe));
    const safePath = filePath.replace(/'/g, "''");
    const ps =
      `try { ` +
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(` +
      `'${safePath}', ` +
      `[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, ` +
      `[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin) ` +
      `; Write-Output 'OK' } ` +
      `catch { Write-Output ('ERR:' + $_.Exception.Message); exit 1 }`;
    const r = cp.spawnSync(psExe,
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 15000 });
    const out = (r.stdout || '').toString().trim();
    const err = (r.stderr || '').toString().trim();
    const spawnErr = r.error ? r.error.message : '';
    logTrash(`powershell status=${r.status} signal=${r.signal} out="${out}" err="${err.slice(0, 200)}" spawnErr="${spawnErr}"`);
    if (r.status === 0 && out.includes('OK')) {
      return { ok: true, method: 'powershell.visualbasic' };
    }
    err2 = `PowerShell status=${r.status} out=${out} err=${err.slice(0, 150)} spawnErr=${spawnErr}`;
    throw new Error(err2);
  } catch (e2) {
    if (!err2) err2 = e2.message;
    logTrash('powershell FAILED: ' + err2);
    // 方式3：用 cmd.exe 调用 PowerShell（最后兜底）
    try {
      const cmdExe = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32\\cmd.exe');
      const safePath = filePath.replace(/'/g, "''");
      const psCmd = `powershell -NoProfile -Command "try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${safePath}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin) } catch { exit 1 }"`;
      const r2 = cp.spawnSync(cmdExe, ['/c', psCmd], { windowsHide: true, timeout: 15000 });
      logTrash(`cmd.exe status=${r2.status} error=${r2.error ? r2.error.message : 'none'}`);
      if (r2.status === 0) return { ok: true, method: 'cmd.powershell' };
      err3 = `cmd.exe status=${r2.status} error=${r2.error ? r2.error.message : 'none'}`;
      throw new Error(err3);
    } catch (e3) {
      if (!err3) err3 = e3.message;
      logTrash('cmd FAILED: ' + err3);
      // === 最终兜底：永久删除 ===
      // 所有回收站方案都失败（沙箱禁用 spawn、shell.trashItem 在特殊字符路径下解析失败），
      // 用户已明确要删除——直接 fs.unlink 永久删除，让删除操作能完成。
      // 注：正常双击启动的安装版会走 shell.trashItem 进回收站，不会走到这里。
      try {
        fs.unlinkSync(filePath);
        logTrash('unlink(原路径) OK（永久删除兜底）');
        return { ok: true, method: 'unlink.fallback', note: '回收站不可用，已永久删除' };
      } catch (eUnlink) {
        // unlink 也失败，再检查一次文件是否还在
        try {
          if (!fs.existsSync(filePath)) {
            logTrash('unlink 失败但文件已消失 → 标记已删除');
            return { ok: true, method: 'already-deleted', note: '文件已不存在' };
          }
        } catch {}
        logTrash('unlink 兜底也失败: ' + eUnlink.message);
        throw new Error(`trashItem[${err1}] + ps[${err2}] + cmd[${err3}] + unlink[${eUnlink.message}]`);
      }
    }
  }
}

handle('trash-files', async (e, paths) => {
  // 软删除：只把图片在数据库里标记为 trashed，不碰物理文件，不进系统回收站。
  // 主视图通过 live() 过滤 trashed 的图片，所以会立即从界面消失；
  // 用户可在左侧"回收站"视图查看这些图片，需要时还能恢复（untrash）。
  const results = [];
  for (const p of paths) {
    try {
      DB.markTrashed(p);
      results.push({ path: p, ok: true, method: 'soft-trash' });
    } catch (err) {
      logTrash('软删除失败: ' + p + ' -> ' + err.message);
      results.push({ path: p, ok: false, error: String(err.message) });
    }
  }
  DB.flushSync();
  return results;
});

/* 彻底删除：把物理文件送到 Windows 系统回收站（可还原），并清除 PicFlow 记录。
 * 与 trash-files（软删，只改 DB 不碰文件）互补：用户要"真正删除文件"时用这个。
 * trashToRecycleBin 已实现多重兜底（shell.trashItem → PowerShell → cmd → unlink），
 * NSFW 图片同样走本地路径，绝不上传。 */
handle('purge-files', async (e, paths) => {
  const results = [];
  for (const p of paths) {
    try {
      assertLibraryPath(p);
      const r = await trashToRecycleBin(p);
      if (r && r.ok) {
        DB.removeImages([p]); // 物理文件已进回收站，DB 记录也清掉
        results.push({ path: p, ok: true, method: r.method || 'recycle-bin', note: r.note || '' });
      } else {
        results.push({ path: p, ok: false, error: '删除失败' });
      }
    } catch (err) {
      logTrash('purge-files 失败: ' + p + ' -> ' + err.message);
      // 即使送回收站失败，也尝试把 DB 记录清掉，避免文件已删但记录残留的灰图
      try {
        if (!fs.existsSync(p)) { DB.removeImages([p]); results.push({ path: p, ok: true, method: 'already-gone' }); }
        else results.push({ path: p, ok: false, error: String(err.message).slice(0, 120) });
      } catch {
        results.push({ path: p, ok: false, error: String(err.message).slice(0, 120) });
      }
    }
  }
  DB.flushSync();
  return results;
});

handle('remove-records', async (e, paths) => {
  for (const p of paths) assertLibraryPath(p);
  DB.removeImages(paths);
  DB.flushSync();
  return { ok: true };
});

handle('revive-files', async (e, paths) => {
  // 从软件回收站恢复：把 trashed/missing 改回 false，图片重新出现在主视图
  for (const p of paths) { assertLibraryPath(p); DB.revive(p); }
  DB.flushSync();
  return { ok: true, count: paths.length };
});

/* 相册 */
handle('create-album', (e, name) => DB.createAlbum(String(name).trim() || '未命名相册'));
handle('delete-album', (e, id) => { DB.deleteAlbum(id); DB.flushSync(); return { ok: true }; });
handle('rename-album', (e, id, name) => { DB.renameAlbum(id, String(name).trim()); DB.flushSync(); return { ok: true }; });
handle('add-to-album', (e, id, paths) => { DB.addToAlbum(id, paths); DB.flushSync(); return { ok: true }; });
// 独占式加入：一张图只属一个相册，加入时自动从其他相册移除
handle('assign-album', (e, id, paths) => { DB.assignAlbum(id, paths); DB.flushSync(); return { ok: true }; });
handle('remove-from-album', (e, id, paths) => { DB.removeFromAlbum(id, paths); DB.flushSync(); return { ok: true }; });

handle('open-in-folder', (e, p) => {
  assertLibraryPath(p);
  shell.showItemInFolder(p);
  return { ok: true };
});
// 只允许这几个纯 UI 偏好的键，防止被拿来绕过 cloud-config 的加密写入
const FLAG_ALLOWLIST = new Set(['thumbSize', 'guided', 'nsfwMode', 'autoUpdateCheck', 'lang']);
handle('set-flag', (e, k, v) => {
  if (!FLAG_ALLOWLIST.has(String(k))) return { ok: false, error: 'flag not allowed' };
  DB.setFlag(k, v);
  return { ok: true };
});

/* 右键菜单用到的系统能力 */
// 复制图片本体到剪贴板：nativeImage 支持 png/jpg/bmp，webp/gif 返回空图要告诉用户
handle('copy-image', (e, p) => {
  try {
    assertLibraryPath(p);
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return { ok: false, error: '该格式无法复制为图片' };
    clipboard.writeImage(img);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
handle('copy-text', (e, t) => { clipboard.writeText(String(t == null ? '' : t)); return { ok: true }; });
handle('open-path', async (e, p) => {
  try {
    assertLibraryPath(p);
    const err = await shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
// 输入框里右键：走系统原生编辑菜单（撤销/剪切/复制/粘贴/全选），
// Electron 默认不提供，不补的话搜索框里没法右键粘贴。
handle('show-edit-menu', (e, labels = {}) => {
  const menu = Menu.buildFromTemplate([
    { role: 'undo', label: labels.undo || 'Undo' },
    { role: 'redo', label: labels.redo || 'Redo' },
    { type: 'separator' },
    { role: 'cut', label: labels.cut || 'Cut' },
    { role: 'copy', label: labels.copy || 'Copy' },
    { role: 'paste', label: labels.paste || 'Paste' },
    { type: 'separator' },
    { role: 'selectAll', label: labels.selectAll || 'Select all' }
  ]);
  const w = BrowserWindow.fromWebContents(e.sender);
  menu.popup(w ? { window: w } : {});
  return { ok: true };
});

/* ---------------- AI 智能分类（云端多模态大模型） ----------------
 * v1.4 起本地识别模型（MobileNetV2 / WD14）全部移除：
 *   角色/作品识别改由用户自己的多模态大模型 API 完成（见 cloudai.js）。
 * 隐私：每张图先用本地 nsfwjs 判定，命中 NSFW 的绝不上传，只在本地打标记。
 */

/** 获取一张图的缩略图 nativeImage（优先复用磁盘缓存） */
async function thumbImageOf(im) {
  let tp = null;
  try {
    const st = await fsp.stat(im.path);
    tp = await thumbPathFor(im, st);
    try { await fsp.access(tp); } catch {
      const img = nativeImage.createFromPath(im.path);
      tp = await ensureThumb(im.path, img, st);
    }
  } catch { return null; }
  if (!tp) return null;
  try { return nativeImage.createFromPath(tp); } catch { return null; }
}

/** 图片 → 云端 dataURL：缩到长边 1024 的 JPEG（平衡识别质量与传输成本） */
async function imageDataUrlForCloud(im, maxSide = 1024, quality = 85) {
  let img = null;
  try {
    img = await nativeImage.createThumbnailFromPath(im.path, { width: maxSide, height: maxSide });
  } catch {}
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(im.path);
  if (!img || img.isEmpty()) return null;
  const sz = img.getSize();
  const scale = Math.min(maxSide / sz.width, maxSide / sz.height, 1);
  if (scale < 1) {
    img = img.resize({
      width: Math.max(1, Math.round(sz.width * scale)),
      height: Math.max(1, Math.round(sz.height * scale)),
      quality: 'good'
    });
  }
  const jpeg = img.toJPEG(quality);
  return 'data:image/jpeg;base64,' + jpeg.toString('base64');
}

handle('ai-status', async () => ({ running: aiRunning }));

handle('ai-classify-all', async (e, opts) => {
  if (aiRunning) return { busy: true };
  const redo = !!(opts && opts.redo);
  const runNsfw = !opts || opts.nsfw !== false;
  const cfg = cloudConfigResolved();
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    return { ok: false, error: '还没有配置 AI 接口：点侧栏「设置 → AI 识别」填入服务商、API 地址、Key 和模型名' };
  }

  aiRunning = true; aiCancel = false;
  send('ai:start', { cloud: true });
  const t0 = Date.now();
  try {
    // 增量优先：默认只处理"还没有云端分类结果"的图；redo 才全量重跑
    let targets = DB.getImages().filter(i => !i.trashed && !i.missing && !i.aiManual);
    if (!redo) targets = targets.filter(i => !(i.aiCategory && i.aiCloud));
    const total = targets.length;
    send('ai:total', { total, cloud: true });
    if (!total) {
      send('ai:done', { done: 0, ok: 0, canceled: false });
      return { ok: true, done: 0 };
    }

    // NSFW 模型按需加载（已有检测结果的图不重复跑）
    const needNsfw = runNsfw && targets.some(t => !t.nsfwScore);
    if (needNsfw) { try { await AI.ensureNsfw(); } catch {} }

    const results = [];
    let doneN = 0;
    const queue = targets.slice();
    const CONCURRENCY = Math.max(1, Math.min(5, Number(cfg.concurrency) || 3));

    const work = async () => {
      while (queue.length && !aiCancel) {
        const t = queue.shift();
        if (!t) break;
        let nsfwRes = null;
        try {
          // 1) 本地 NSFW 判定（已有结果直接复用）
          if (runNsfw) {
            if (t.nsfwScore) nsfwRes = { scores: t.nsfwScore, isNsfw: !!t.nsfw };
            else if (AI.nsfwAvailable()) {
              try {
                const timg = await thumbImageOf(t);
                if (timg && !timg.isEmpty()) nsfwRes = await AI.detectNsfw(timg);
              } catch {}
            }
          }
          // 2) NSFW 图绝不上网
          if (nsfwRes && nsfwRes.isNsfw) {
            results.push({ path: t.path, nsfw: nsfwRes, skipped: 'nsfw' });
          } else {
            const dataUrl = await imageDataUrlForCloud(t);
            if (!dataUrl) {
              results.push({ path: t.path, error: '图片读取失败', nsfw: nsfwRes });
            } else {
              const cloudRes = await CloudAI.classifyImageCloud({ imageDataUrl: dataUrl, config: cfg });
              results.push({ path: t.path, cloud: cloudRes, nsfw: nsfwRes });
            }
          }
        } catch (err2) {
          results.push({ path: t.path, error: err2.message || String(err2), nsfw: nsfwRes });
        }
        doneN++;
        send('ai:progress', { done: doneN, total, phase: 'cloud' });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => work()));

    // 3) 写库
    let okN = 0, nsfwN = 0, failN = 0;
    for (const r of results) {
      if (r.error) { failN++; continue; }
      if (r.skipped === 'nsfw') {
        nsfwN++;
        DB.updateImage(r.path, { nsfw: true, nsfwScore: r.nsfw.scores });
        continue;
      }
      if (r.cloud) {
        okN++;
        DB.updateImage(r.path, {
          aiCategory: r.cloud.category,
          aiClusterName: r.cloud.category,
          aiCluster: null,
          aiCloud: true,
          aiConf: null,
          aiTop: r.cloud.tags || [],
          aiDesc: r.cloud.desc || ''
        });
      }
      if (r.nsfw && r.nsfw.isNsfw) DB.updateImage(r.path, { nsfw: true, nsfwScore: r.nsfw.scores });
    }
    DB.flushSync();
    send('ai:done', {
      done: results.length,
      ok: okN,
      nsfwSkipped: nsfwN,
      failed: failN,
      canceled: aiCancel,
      clusters: new Set(results.filter(r => r.cloud).map(r => r.cloud.category)).size,
      elapsedMs: Date.now() - t0
    });
    return { ok: true, done: results.length, okN, nsfwN, failN };
  } catch (err) {
    console.error('ai classify error:', err);
    send('ai:done', { error: err.message });
    return { ok: false, error: err.message };
  } finally {
    aiRunning = false;
  }
});

handle('ai-stop', async () => { aiCancel = true; return { ok: true }; });

/* ---------------- 云端配置 ---------------- */
handle('cloud-config-get', async () => {
  // 只回「有没有 key」和掩码，明文 key 永远不进渲染进程
  const cfg = DB.getFlags().cloudAI || {};
  const key = decryptApiKey(cfg);
  const { apiKey, apiKeyEnc, ...rest } = cfg;
  return {
    ...rest,
    hasKey: !!key,
    keyMask: key ? key.slice(0, 3) + '…' + key.slice(-4) : ''
  };
});
handle('cloud-config-set', async (e, cfg) => {
  const old = DB.getFlags().cloudAI || {};
  const src = cfg || {};
  const next = { ...src };
  delete next.apiKey; delete next.apiKeyEnc; delete next.hasKey; delete next.keyMask;
  const incoming = String(src.apiKey || '').trim();
  if (incoming) {
    Object.assign(next, encryptApiKey(incoming));          // 换了新 key
  } else if (old.apiKeyEnc) {
    next.apiKeyEnc = old.apiKeyEnc;                        // 留空 = 保持不变
  } else if (old.apiKey) {
    next.apiKey = old.apiKey;
  }
  DB.setFlag('cloudAI', next);
  DB.flushSync();
  return { ok: true, hasKey: !!(next.apiKeyEnc || next.apiKey) };
});
handle('cloud-config-test', async (e, cfg) => {
  const c = { ...(cfg || {}) };
  if (!c.apiKey) c.apiKey = decryptApiKey(DB.getFlags().cloudAI || {});   // 用已保存的 key 测试
  return CloudAI.testConfig(c);
});
handle('cloud-providers', async () => CloudAI.PROVIDERS);

/* ---------------- 批量标注分类 ----------------
 * 用户像数据标注一样手动给图片指定分类（aiManual=true，AI 不再覆盖）。
 * 传空 category 表示清除手动分类标记。
 */
handle('batch-set-category', async (e, paths, category) => {
  const list = Array.isArray(paths) ? paths : [];
  const v = String(category || '').trim();
  for (const p of list) {
    if (v) {
      DB.updateImage(p, { aiCategory: v, aiClusterName: v, aiManual: true, aiConf: null });
    } else {
      DB.updateImage(p, { aiCategory: '', aiClusterName: '', aiManual: false, aiConf: null });
    }
  }
  DB.flushSync();
  return { ok: true, count: list.length };
});

/* ---------------- 重命名 AI 分类 ----------------
 * AI 分出来的组名（= 相册名）可以改。改名会同步该组下所有图片，
 * 并标记 aiManual，保证重新识别时不会把名字改回去。
 * 若目标名已存在，等同于把两组并到一起。
 */
handle('rename-category', async (e, from, to) => {
  const f = String(from || '').trim();
  const t = String(to || '').trim();
  if (!f) return { ok: false, error: '原分类名为空' };
  if (!t) return { ok: false, error: '新分类名不能为空' };
  if (f === t) return { ok: true, count: 0 };
  let count = 0;
  for (const im of DB.getImages()) {
    if (im.aiClusterName === f || (!im.aiClusterName && im.aiCategory === f)) {
      DB.updateImage(im.path, {
        aiClusterName: t,
        aiCategory: t,
        aiManual: true,
        aiConf: null
      });
      count++;
    }
  }
  DB.flushSync();
  return { ok: true, count };
});

/* ---------------- 自动更新（GitHub Releases） ----------------
 * electron-updater 读取 Release 中的 latest.yml 判断新版本，
 * 下载 NSIS 更新包，重启后自动安装。
 * 仅打包版生效（dev 模式不检查）。
 */
const { autoUpdater } = require('electron-updater');

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  // macOS 版目前是 ad-hoc 签名（没有 Apple 开发者证书），Squirrel.Mac 会校验签名，
  // 自动更新必然失败。这里直接不启用，mac 用户从 Releases 手动下载新版。
  if (process.platform === 'darwin') return;
  autoUpdater.autoDownload = false;          // 先提示，用户点下载才下（避免偷跑流量）
  autoUpdater.autoInstallOnAppQuit = true;   // 下载完成后退出时自动装
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', info => send('update:status', {
    state: 'available',
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 2000) : '',
    releaseDate: info.releaseDate || ''
  }));
  autoUpdater.on('update-not-available', info => send('update:status', {
    state: 'latest',
    version: (info && info.version) || app.getVersion()
  }));
  autoUpdater.on('download-progress', p => send('update:progress', {
    percent: Math.round(p.percent || 0),
    transferred: p.transferred || 0,
    total: p.total || 0,
    bytesPerSecond: p.bytesPerSecond || 0
  }));
  autoUpdater.on('update-downloaded', info => send('update:status', {
    state: 'downloaded',
    version: info.version
  }));
  autoUpdater.on('error', err => send('update:status', {
    state: 'error',
    error: String((err && err.message) || err).slice(0, 200)
  }));

  // 启动 8 秒后静默检查一次（等首屏加载完）；用户可在设置里关掉「启动检查更新」
  setTimeout(() => {
    if (DB.getFlags().autoUpdateCheck === false) return;
    autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);
}

handle('update-check', async () => {
  if (!app.isPackaged) return { ok: false, error: '开发模式下不检查更新' };
  if (process.platform === 'darwin') {
    return { ok: false, error: 'macOS 版暂不支持应用内更新，请到 GitHub Releases 下载新版', external: true };
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
handle('update-download', async () => {
  if (process.platform === 'darwin') return { ok: false, error: 'macOS 版请手动下载', external: true };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});
handle('update-install', async () => {
  if (process.platform === 'darwin') return { ok: false, error: 'macOS 版请手动安装', external: true };
  setImmediate(() => { try { autoUpdater.quitAndInstall(); } catch (e) { console.error('install err', e); } });
  return { ok: true };
});
handle('app-version', async () => app.getVersion());

/* 设置面板用：版本 / 数据目录 / 平台信息 */
handle('app-info', async () => ({
  version: app.getVersion(),
  dataDir: app.getPath('userData'),
  isPackaged: app.isPackaged,
  platform: process.platform
}));

handle('open-data-dir', async () => {
  try { await shell.openPath(app.getPath('userData')); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
});

