/* 验证 picflow-thumb 自定义协议 */
const { app, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'picflow-thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

const D = 'C:/Users/Lenovo/AppData/Roaming/PicFlow 图片管家';

app.whenReady().then(async () => {
  protocol.handle('picflow-thumb', async request => {
    try {
      const u = new URL(request.url);
      const raw = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/\.jpg$/i, '');
      if (!/^[a-f0-9]{32}$/i.test(raw)) return new Response('bad request', { status: 400 });
      const buf = await fs.promises.readFile(path.join(D, 'thumbs', raw + '.jpg'));
      return new Response(buf, { headers: { 'Content-Type': 'image/jpeg' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  try {
    const hash = '201827ef9180938810c7359eef03ae51';
    const t0 = Date.now();
    const r = await net.fetch(`picflow-thumb://thumb/${hash}.jpg`);
    const buf = Buffer.from(await r.arrayBuffer());
    console.log('成功请求 status:', r.status, '| type:', r.headers.get('content-type'), '| bytes:', buf.length, '|', (Date.now() - t0) + 'ms');
    console.log(buf[0] === 0xFF && buf[1] === 0xD8 ? '✓ 有效 JPEG' : '✗ 非 JPEG');

    // 测 404
    const r2 = await net.fetch('picflow-thumb://thumb/00000000000000000000000000000000.jpg');
    console.log('不存在文件 status:', r2.status, r2.status === 404 ? '✓' : '✗');

    // 测非法路径（防目录穿越）
    const r3 = await net.fetch('picflow-thumb://thumb/..%2F..%2Flibrary.json');
    console.log('非法路径 status:', r3.status, r3.status === 400 ? '✓ 已拦截' : '⚠ ' + r3.status);
  } catch (e) {
    console.error('✗ 异常:', e);
  }
  app.exit(0);
});
