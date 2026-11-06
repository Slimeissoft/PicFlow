'use strict';
/* ============================================================
 * electron-builder afterPack 钩子
 *
 * 只在 macOS 上做事：给 .app 补一个 ad-hoc 签名。
 *
 * 为什么要：
 *   这个项目没有 Apple 开发者证书（mac.identity = null），electron-builder
 *   会跳过签名。但 Apple Silicon 要求所有可执行文件至少带 ad-hoc 签名，
 *   否则直接报 “app is damaged and can’t be opened”。
 *   codesign --sign - 就是那个「至少」。
 *
 * 注意：ad-hoc 签名不等于公证。用户第一次打开仍需右键 →「打开」，
 * 或者执行 xattr -cr "/Applications/PicFlow 图片管家.app"。
 * ============================================================ */
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit'
    });
    console.log(`[afterPack] ad-hoc signed: ${appPath}`);
  } catch (e) {
    // 签名失败就让构建失败 —— 产出一个跑不起来的 .app 没有意义
    throw new Error(`ad-hoc codesign failed: ${e.message}`);
  }
};
