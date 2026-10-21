/* 集成测试：utilityProcess + wd14-worker 整链路（非 GUI）
 * 用法：electron test-pipeline.js <测试图路径>
 */
const { app, utilityProcess, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST_IMG = process.argv[process.argv.length - 1];
const WAIT = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    console.log('[测试] electron 已就绪');
    if (!TEST_IMG || !fs.existsSync(TEST_IMG)) {
      console.error('✗ 测试图不存在:', TEST_IMG);
      app.exit(1); return;
    }
    const modelDir = path.join(__dirname, 'model');

    // === 1. 启动 worker ===
    console.log('[1] 启动 WD14 子进程');
    const t0 = Date.now();
    const worker = utilityProcess.fork(path.join(__dirname, 'wd14-worker.js'));
    const ready = await new Promise(resolve => {
      worker.on('message', msg => {
        if (!msg) return;
        if (msg.type === 'ready') resolve({ ok: true, ep: msg.ep, loadMs: msg.loadMs });
        if (msg.type === 'init-error') resolve({ ok: false, error: msg.error });
      });
      worker.on('exit', code => resolve({ ok: false, error: 'worker exited ' + code }));
      worker.postMessage({ type: 'init', modelDir });
      setTimeout(() => resolve({ ok: false, error: 'load timeout' }), 180000);
    });
    console.log('   加载结果:', JSON.stringify(ready), '| 外部计时', (Date.now() - t0) + 'ms');
    if (!ready.ok) { app.exit(1); return; }

    // === 2. 预处理 ===
    console.log('[2] 预处理:', TEST_IMG);
    const AI = require('./ai');
    let img = null;
    try { img = await nativeImage.createThumbnailFromPath(TEST_IMG, { width: 1024, height: 1024 }); }
    catch (e) { console.log('   createThumbnailFromPath 不可用:', e.message); }
    if (!img || img.isEmpty()) img = nativeImage.createFromPath(TEST_IMG);
    const input = AI.prepareWd14Input(img);
    if (!input) { console.error('✗ 预处理失败'); app.exit(1); return; }
    console.log('   输入:', input.width + 'x' + input.height, '| BGRA', input.bgra.byteLength, 'bytes');

    // === 3. 推理 ===
    console.log('[3] 推理中（计时）...');
    const t1 = Date.now();
    const result = await new Promise(resolve => {
      worker.on('message', msg => {
        if (msg && msg.type === 'result' && msg.id === 1) resolve(msg);
      });
      worker.postMessage({ type: 'classify', id: 1, width: input.width, height: input.height, bgra: input.bgra });
      setTimeout(() => resolve({ ok: false, error: 'infer timeout 180s' }), 180000);
    });
    const dt = Date.now() - t1;
    if (result.ok) {
      console.log('   ✓ 推理成功 | 耗时', dt + 'ms');
      console.log('   category:', JSON.stringify(result.data.category));
      console.log('   character:', JSON.stringify(result.data.character), 'p=', result.data.charProb);
      console.log('   copyright:', JSON.stringify(result.data.copyright), 'p=', result.data.copyProb);
      console.log('   top general:', JSON.stringify(result.data.top));
    } else {
      console.log('   ✗ 推理失败:', result.error, '| 耗时', dt + 'ms');
    }

    // === 4. 连续 3 张测内存/速度稳定性 ===
    console.log('[4] 连续推理 x3 测稳定性');
    for (let k = 0; k < 3; k++) {
      const t2 = Date.now();
      const r = await new Promise(resolve => {
        worker.on('message', msg => {
          if (msg && msg.type === 'result' && msg.id === 100 + k) resolve(msg);
        });
        worker.postMessage({ type: 'classify', id: 100 + k, width: input.width, height: input.height, bgra: input.bgra });
        setTimeout(() => resolve({ ok: false, error: 'timeout' }), 120000);
      });
      console.log(`   第 ${k + 1} 次:`, r.ok ? ('OK ' + (Date.now() - t2) + 'ms, cat=' + JSON.stringify(r.data.category)) : ('FAIL ' + r.error));
    }

    worker.postMessage({ type: 'shutdown' });
    await WAIT(600);
    console.log('[完成] 全部测试结束');
    app.exit(0);
  } catch (e) {
    console.error('✗ 测试异常:', e);
    app.exit(1);
  }
});
