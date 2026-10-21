/* 验证打包版：从 win-unpacked 的 app.asar.unpacked 里 fork worker（模拟安装后行为）
 * 用法：electron test-packed.js
 */
const { app, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, 'release', 'win-unpacked', 'resources');
const WORKER = path.join(ROOT, 'app.asar.unpacked', 'wd14-worker.js');
const MODEL_DIR = path.join(ROOT, 'model');
const TEST_IMG = 'D:\\Users_Lenovo\\Pictures\\ENDFIELD\\ENDFIELD_SHARE_1769054512.png';

app.whenReady().then(async () => {
  try {
    console.log('[打包版验证]');
    console.log('worker:', WORKER, fs.existsSync(WORKER) ? '✓' : '✗');
    console.log('model :', MODEL_DIR, fs.existsSync(path.join(MODEL_DIR, 'pixai-tagger', 'model.onnx')) ? '✓' : '✗');

    const worker = utilityProcess.fork(WORKER);
    const ready = await new Promise(resolve => {
      worker.on('message', msg => {
        if (!msg) return;
        if (msg.type === 'ready') resolve({ ok: true, ep: msg.ep, loadMs: msg.loadMs });
        if (msg.type === 'init-error') resolve({ ok: false, error: msg.error });
      });
      worker.on('exit', c => resolve({ ok: false, error: 'exited ' + c }));
      worker.postMessage({ type: 'init', modelDir: MODEL_DIR });
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 180000);
    });
    console.log('加载:', JSON.stringify(ready));
    if (!ready.ok) { app.exit(1); return; }

    // 用源码 electron 的 nativeImage 做预处理（打包版里这步由 main.js 做，逻辑一致）
    const { nativeImage } = require('electron');
    let img = null;
    try { img = await nativeImage.createThumbnailFromPath(TEST_IMG, { width: 1024, height: 1024 }); } catch {}
    if (!img || img.isEmpty()) img = nativeImage.createFromPath(TEST_IMG);
    const sz = img.getSize();
    const scale = Math.min(1008 / sz.width, 1008 / sz.height, 1);
    const nw = Math.round(sz.width * scale), nh = Math.round(sz.height * scale);
    const bmp = img.resize({ width: nw, height: nh, quality: 'good' }).toBitmap();
    const ab = new ArrayBuffer(bmp.length);
    new Uint8Array(ab).set(bmp);

    const t1 = Date.now();
    const r = await new Promise(resolve => {
      worker.on('message', msg => { if (msg && msg.type === 'result' && msg.id === 9) resolve(msg); });
      worker.postMessage({ type: 'classify', id: 9, width: nw, height: nh, bgra: ab });
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 180000);
    });
    console.log('推理:', r.ok ? `✓ ${Date.now() - t1}ms` : '✗ ' + r.error);
    if (r.ok) console.log('结果:', JSON.stringify(r.data.category), '| char p=', r.data.charProb?.toFixed(3));

    worker.postMessage({ type: 'shutdown' });
    setTimeout(() => app.exit(r.ok ? 0 : 1), 500);
  } catch (e) {
    console.error('✗ 异常:', e);
    app.exit(1);
  }
});
