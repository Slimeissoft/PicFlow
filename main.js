'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const cp = require('child_process');
const crypto = require('crypto');
const { walkImages, extractExifDate, computePhash } = require('./scanner');
const DB = require('./db');
const AI = require('./ai');

let win = null;
let scanning = false;
let aiRunning = false;
let aiCancel = false;

const modelDir = () => app.isPackaged
  ? path.join(process.resourcesPath, 'model')
  : path.join(__dirname, 'model');

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
    title: 'PicFlow 图片管家',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
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
  const st = await fsp.stat(f);
  const existing = DB.getImage(f);
  if (existing && existing.phash && existing.mtime === st.mtimeMs && existing.size === st.size) {
    if (existing.trashed || existing.missing) DB.revive(f);
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
    trashed: false, missing: false
  };
}

/* ---------------- IPC ---------------- */

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-move-dest', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('scan-folder', async (e, folder) => {
  if (scanning) return { busy: true };
  scanning = true;
  send('scan:start', { folder });
  try {
    const files = walkImages(folder);
    send('scan:total', { total: files.length });
    let done = 0;
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const rec = await processFile(f);
          if (rec) { DB.upsertImage(rec); send('scan:item', rec); }
        } catch (err) { console.error('process failed:', f, err.message); }
        done++;
        if (done % 3 === 0 || done === files.length) send('scan:progress', { done, total: files.length });
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
    send('scan:done', { folder, total: files.length, missing: missingCount });
    return { ok: true, total: files.length };
  } finally { scanning = false; }
});

ipcMain.handle('get-library', async () => ({
  images: DB.getImages(),
  albums: DB.getAlbums(),
  folders: DB.getFolders(),
  flags: DB.getFlags()
}));

ipcMain.handle('get-thumb', async (e, f) => {
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

ipcMain.handle('read-image', async (e, f) => {
  try {
    const st = await fsp.stat(f);
    const buf = await fsp.readFile(f);
    const mime = MIME[path.extname(f).toLowerCase()] || 'image/png';
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: st.size, mtime: st.mtimeMs };
  } catch { return null; }
});

ipcMain.handle('update-image', async (e, p, patch) => {
  const allowed = {};
  if (Array.isArray(patch.tags)) allowed.tags = patch.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
  if (typeof patch.note === 'string') allowed.note = patch.note;
  if (typeof patch.starred === 'boolean') allowed.starred = patch.starred;
  if (typeof patch.nsfw === 'boolean') allowed.nsfw = patch.nsfw;
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

ipcMain.handle('get-duplicates', async () => {
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

ipcMain.handle('rename-files', async (e, pairs) => {
  const results = [];
  for (const { path: p, newName } of pairs) {
    try {
      const dir = path.dirname(p);
      const ext = path.extname(p);
      let target = path.join(dir, newName + ext);
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

ipcMain.handle('move-files', async (e, paths, dest) => {
  const results = [];
  for (const p of paths) {
    try {
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

ipcMain.handle('trash-files', async (e, paths) => {
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

ipcMain.handle('remove-records', async (e, paths) => {
  DB.removeImages(paths);
  DB.flushSync();
  return { ok: true };
});

ipcMain.handle('revive-files', async (e, paths) => {
  // 从软件回收站恢复：把 trashed/missing 改回 false，图片重新出现在主视图
  for (const p of paths) DB.revive(p);
  DB.flushSync();
  return { ok: true, count: paths.length };
});

/* 相册 */
ipcMain.handle('create-album', (e, name) => DB.createAlbum(String(name).trim() || '未命名相册'));
ipcMain.handle('delete-album', (e, id) => { DB.deleteAlbum(id); DB.flushSync(); return { ok: true }; });
ipcMain.handle('rename-album', (e, id, name) => { DB.renameAlbum(id, String(name).trim()); DB.flushSync(); return { ok: true }; });
ipcMain.handle('add-to-album', (e, id, paths) => { DB.addToAlbum(id, paths); DB.flushSync(); return { ok: true }; });
ipcMain.handle('remove-from-album', (e, id, paths) => { DB.removeFromAlbum(id, paths); DB.flushSync(); return { ok: true }; });

ipcMain.handle('open-in-folder', (e, p) => { shell.showItemInFolder(p); return { ok: true }; });
ipcMain.handle('set-flag', (e, k, v) => { DB.setFlag(k, v); return { ok: true }; });

/* ---------------- AI 智能分类（本地离线推理） ---------------- */

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

ipcMain.handle('ai-status', async () => ({ running: aiRunning, modelDir: modelDir() }));

ipcMain.handle('ai-classify-all', async (e, opts) => {
  if (aiRunning) return { busy: true };
  const redo = opts && opts.redo;
  aiRunning = true; aiCancel = false;
  send('ai:start', {});
  try {
    await AI.ensure(modelDir());
    const targets = DB.getImages().filter(i => !i.trashed && !i.missing && (redo || !i.aiCategory || !AI.CATEGORIES.includes(i.aiCategory)));
    const total = targets.length;
    send('ai:total', { total });
    let done = 0, okN = 0;
    for (const im of targets) {
      if (aiCancel) break;
      try {
        const img = await thumbImageOf(im);
        if (img && !img.isEmpty()) {
          const r = await AI.classifyImage(img);
          if (r) {
            DB.updateImage(im.path, { aiCategory: r.category, aiConf: Math.round(r.conf * 100) });
            send('ai:item', { path: im.path, category: r.category });
            okN++;
          }
        }
      } catch (err) { console.error('ai classify failed:', im.path, err.message); }
      done++;
      if (done % 3 === 0 || done === total) send('ai:progress', { done, total });
    }
    DB.flushSync();
    send('ai:done', { done, ok: okN, canceled: aiCancel });
    return { ok: true, done, okN };
  } catch (err) {
    send('ai:done', { error: err.message });
    return { ok: false, error: err.message };
  } finally { aiRunning = false; }
});

ipcMain.handle('ai-stop', async () => { aiCancel = true; return { ok: true }; });
