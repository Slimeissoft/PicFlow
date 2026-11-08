# Security Policy

PicFlow is a local-first Windows desktop app built with Electron. It reads and writes files on your
machine, talks to the model API **you** configure, and ships its own auto-updater — so security
reports are taken seriously.

## Supported Versions

| Version | Supported | Notes |
| --- | --- | --- |
| 1.6.2 – 1.6.4 | :white_check_mark: | Current releases, include the security hardening below |
| 1.6.0 – 1.6.1 | :warning: | Upgrade recommended — navigation isolation, IPC validation, path allowlisting and API-key encryption are missing |
| ≤ 1.5.0 | :x: | Not supported |

Only the latest release receives security fixes. The app updates itself from GitHub Releases, so
upgrading is one click.

## Reporting a Vulnerability

**Please do not open a public issue for an unfixed vulnerability.**

- **Preferred** — GitHub private advisory:
  <https://github.com/Slimeissoft/PicFlow/security/advisories/new>
- **Email** — [lalouuie@gmail.com](mailto:lalouuie@gmail.com) with the subject prefix `[PicFlow Security]`

A useful report includes:

1. PicFlow version (Settings → About) and Windows version
2. What an attacker can do, and what they need to start with
3. Reproduction steps, or a proof-of-concept
4. Any relevant logs, screenshots, or a crashing input file

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | within 48 hours |
| Triage and severity assessment | within 7 days |
| Fix for high / critical issues | in the next patch release |
| Public disclosure | after a fix ships, coordinated with you |

You will be credited in the release notes unless you ask to stay anonymous. Please give me a
reasonable window to ship a fix before publishing details — 90 days, or sooner if a patch is out.

## Scope

**In scope**

- Sandbox / isolation escape in the renderer (XSS that reaches Node or the main process)
- IPC privilege issues: a page or frame that is not the local app calling privileged handlers
- Path traversal, or reading / writing / deleting files outside the scanned library
- Leakage of the stored API key, library metadata, or file contents to a third party
- Navigation or `window.open` escapes that hand `window.api` to a remote page
- Weaknesses in the update path (signature / integrity / redirect handling)
- Denial of service that corrupts or destroys the local library

**Out of scope**

- Attacks that require physical access, an already-compromised machine, or administrator rights
- Behaviour of third-party model providers, or data you choose to send to them
- Exposure caused by sharing your own `library.json` or API key
- Missing code signing / SmartScreen warnings (known; tracked separately)
- Vulnerabilities in Electron itself that have no practical exploit path in this app

## Security Design (as of 1.6.4)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; the preload exposes a fixed,
  small API through `contextBridge`
- All IPC handlers verify the sender frame is a local `file://` page
- File operations are restricted to paths recorded in the database or under a scanned folder
- Rename sanitises path separators and control characters and forces the target into the source directory
- The API key is encrypted with the OS credential store (`safeStorage`) and never sent back to the renderer —
  only `hasKey` and a mask
- Navigation to non-`file://` URLs is blocked; `window.open` and webviews are denied
- Strict CSP; the custom `picflow-thumb://` protocol has no CSP bypass
- NSFW detection runs locally (nsfwjs); flagged images are never uploaded

## 安全策略（中文）

PicFlow 是一款本地优先的 Windows 桌面应用（Electron）。它会读写你机器上的文件、调用**你自己**
配置的模型 API，并自带自动更新——所以安全问题会被认真对待。

### 支持的版本

| 版本 | 支持 | 说明 |
| --- | --- | --- |
| 1.6.2 – 1.6.4 | :white_check_mark: | 当前版本，包含下述安全加固 |
| 1.6.0 – 1.6.1 | :warning: | 建议升级——缺少导航隔离、IPC 校验、路径白名单与 API Key 加密 |
| ≤ 1.5.0 | :x: | 不再支持 |

只有最新版本会收到安全修复。应用会从 GitHub Releases 自动更新，升级只需一次点击。

### 报告漏洞

**请不要为未修复的漏洞开公开 issue。**

- **推荐**：GitHub 私密安全公告
  <https://github.com/Slimeissoft/PicFlow/security/advisories/new>
- **邮件**：[lalouuie@gmail.com](mailto:lalouuie@gmail.com)，主题加前缀 `[PicFlow Security]`

一份有用的报告包含：

1. PicFlow 版本（设置 → 关于）与 Windows 版本
2. 攻击者能做什么、需要什么前提
3. 复现步骤或 PoC
4. 相关日志、截图，或能触发问题的文件

### 处理节奏

| 阶段 | 目标 |
| --- | --- |
| 确认收到 | 48 小时内 |
| 定级与影响评估 | 7 天内 |
| 高 / 严重问题的修复 | 随下一个补丁版发布 |
| 公开披露 | 修复发布后，与你协商时间 |

除非你要求匿名，否则会在更新记录里署名致谢。公开细节前请给一个合理的修复窗口——
默认 90 天，若补丁已发布则可提前。

### 范围

**接收**

- 渲染进程沙箱 / 隔离逃逸（能触达 Node 或主进程的 XSS）
- IPC 越权：非本地页面或非主窗口的帧调用到特权处理器
- 目录穿越，或读写 / 删除扫描目录之外的文件
- 加密保存的 API Key、图库元数据、文件内容泄漏给第三方
- 导航或 `window.open` 逃逸，把 `window.api` 交给远程页面
- 更新链路问题（签名 / 完整性 / 跳转处理）
- 导致本地图库损坏或丢失的拒绝服务

**不接收**

- 需要物理接触、机器已被攻陷、或管理员权限的攻击
- 第三方模型服务商的行为，或你主动发送给它们的数据
- 你自己分享 `library.json` 或 API Key 导致的泄漏
- 缺少代码签名 / SmartScreen 拦截提示（已知，另行处理）
- Electron 上游漏洞，但在此应用中无可利用路径

### 安全设计（截至 1.6.4）

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；preload 通过
  `contextBridge` 只暴露一组固定的少量接口
- 所有 IPC 处理器校验发送方是本地 `file://` 页面
- 文件操作只接受数据库记录内、或已扫描目录下的路径
- 重命名清洗路径分隔符与控制字符，并强制目标留在原目录
- API Key 用系统凭据（`safeStorage`）加密，明文不回传渲染层——只给 `hasKey` 与掩码
- 禁止导航到非 `file://` 地址；`window.open` 与 webview 一律拒绝
- 严格 CSP；自定义 `picflow-thumb://` 协议不带 CSP 绕过
- NSFW 检测在本地（nsfwjs）完成，命中的图片绝不上传
