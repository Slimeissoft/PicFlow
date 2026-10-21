/* INT8 vs FP16 模型对比测试：内存 + 速度 + 识别质量
 * 用法：env -u ELECTRON_RUN_AS_NODE electron.exe --disable-gpu --no-sandbox test-int8.js
 */
const { app, utilityProcess, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const IMG1 = 'D:\\Users_Lenovo\\Pictures\\ENDFIELD\\ENDFIELD_SHARE_1769054512.png';
const IMG2 = 'D:\\#3DO\\异环\\26_02_08_10_20_34.png';

const mb = n => (n / 1024 / 1024).toFixed(0) + 'MB';

async function prepare(imgPath) {
  let img = null;
  try { img = await nativeImage.createThumbnailFromPath(imgPath, { width: 1024, height: 1024 }); } catch {}
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(imgPath);
  const sz = img.getSize();
  const scale = Math.min(1008 / sz.width, 1008 / sz.height, 1);
  const nw = Math.round(sz.width * scale), nh = Math.round(sz.height * scale);
  const bmp = img.resize({ width: nw, height: nh, quality: 'good' }).toBitmap();
  const ab = new ArrayBuffer(bmp.length);
  new Uint8Array(ab).set(bmp);
  return { width: nw, height: nh, bgra: ab };
}

async function runWorker(workerPath, modelDir, label) {
  console.log('\n========== ' + label + ' ==========');
  const worker = utilityProcess.fork(workerPath, [], { execArgv: ['--max-old-space-size=512'] });
  const ready = await new Promise(resolve => {
    worker.on('message', msg => {
      if (!msg) return;
      if (msg.type === 'ready') resolve({ ok: true, ...msg });
      if (msg.type === 'init-error') resolve({ ok: false, error: msg.error });
    });
    worker.on('exit', c => resolve({ ok: false, error: 'exit ' + c }));
    worker.postMessage({ type: 'init', modelDir });
    setTimeout(() => resolve({ ok: false, error: 'load timeout' }), 180000);
  });
  console.log('加载:', JSON.stringify(ready));
  if (!ready.ok) { try { worker.kill(); } catch {} return; }

  for (const [i, imgPath] of [IMG1, IMG2].entries()) {
    const input = await prepare(imgPath);
    const t1 = Date.now();
    const r = await new Promise(resolve => {
      worker.on('message', msg => { if (msg && msg.type === 'result' && msg.id === i + 1) resolve(msg); });
      worker.postMessage({ type: 'classify', id: i + 1, width: input.width, height: input.height, bgra: input.bgra });
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 180000);
    });
    if (r.ok) {
      console.log(`第${i + 1}张 ${(Date.now() - t1)}ms | ${r.data.category} | char p=${r.data.charProb?.toFixed(3)} | sigmoid=${r.data.sigmoidApplied}`);
      console.log(`       worker内存: RSS ${mb(r.mem.rss)} | heap ${mb(r.mem.heap)} | external ${mb(r.mem.external)}`);
      console.log(`       标签: ${JSON.stringify((r.data.top || []).slice(0, 6))}`);
    } else {
      console.log(`第${i + 1}张 失败:`, r.error);
    }
  }
  try { worker.postMessage({ type: 'shutdown' }); } catch {}
  await new Promise(r => setTimeout(r, 800));
}

app.whenReady().then(async () => {
  try {
    console.log('主进程内存(起): RSS', mb(process.memoryUsage().rss));
    const modelDir = path.join(__dirname, 'model');
    // 用同一份 worker 代码（它会自行选择 int8 优先）
    await runWorker(path.join(__dirname, 'wd14-worker.js'), modelDir, '当前配置（int8 优先）');
    console.log('\n主进程内存(终): RSS', mb(process.memoryUsage().rss));
    app.exit(0);
  } catch (e) {
    console.error('✗', e);
    app.exit(1);
  }
});
