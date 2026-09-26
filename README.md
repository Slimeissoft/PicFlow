# PicFlow 图片管家

一款 Windows 桌面图片整理与管理应用（基于 Electron），界面参考「Illustration Library」风格：左侧分类侧边栏 + 缩略图网格 + 底部批量操作条，浅色简洁设计。

## 启动方式

方式一：双击 `启动PicFlow.bat`（首次请先完成下方依赖安装）。

方式二：命令行

```bash
npm install        # 首次安装依赖（已配置国内镜像时更快）
npm start
```

## 功能一览

- **文件夹扫描导入**：递归扫描所选目录，支持 JPG / PNG / WebP / GIF / BMP，缩略图磁盘缓存，二次扫描秒级增量完成
- **缩略图网格浏览**：自适应分辨率，缩略图大小可调（110–300px），悬停显示文件名与信息，单击打开大图预览（左右方向键切换、Space 快速查看）
- **自动分类**：按拍摄日期（优先 EXIF DateTimeOriginal，其次文件修改时间）与文件类型自动归档，左侧栏按年月 / 类型切换
- **AI 智能分类（离线）**：内置轻量 MobileNet 模型（约 4 MB，完全本地推理，无网络），点击「运行 AI 分类」后自动把图片归入 **角色图 / 风景图 / 插画·CG / 动物·萌宠 / 物品·道具 / 美食 / 其他** 七类（面向二次元图库优化），左侧栏可按类目筛选
- **星标**：悬停缩略图点右上角 ★ 加星标，左侧栏「星标」视图快速收藏
- **NSFW 模式**：可手动标记 NSFW 图片（缩略图红角标），顶部「NSFW 已隐藏 / 显示中」开关一键隐藏或显示全部 NSFW 图片
- **相册 / 标签 / 备注**：自定义相册、多标签、图片备注，均持久化保存在本机
- **搜索与筛选**：顶部搜索框支持文件名、标签、备注关键词，可与任意分类视图叠加
- **重复检测**：完全重复（快速哈希）+ 相似图片（64 位 dHash 感知哈希，差异 ≤ 8），支持"保留第 1 张，删除其余"一键清理
- **批量操作**：勾选（Ctrl 多选 / Shift 范围选）后可批量打标签、星标、标记 NSFW、加入相册、移动、模板重命名（{原名} {日期} {序号} {类型}）、移出
- **软件内回收站（软删除）**：点「移出」只是从图库视图移除（不碰物理文件，不进系统回收站），可在左侧「回收站」视图恢复到图库；「清除记录」才会从索引中彻底删除（仍不删物理文件）
- **清晰引导**：右下角常驻操作提示，预览大图右上角醒目红色关闭按钮 + 底部 Esc 提示

## 数据与隐私

- 图库索引保存于 `%APPDATA%/picflow/library.json`，缩略图缓存在 `%APPDATA%/picflow/thumbs/`
- AI 分类模型打包在应用 `resources/model/` 内，推理完全在本地 CPU 进行，无任何网络请求，不上传任何数据

## 快捷键

| 按键 | 功能 |
|---|---|
| Ctrl+A | 全选当前视图 |
| Shift+点击 | 范围选择 |
| Ctrl+点击 | 多选 |
| Space | 查看大图 |
| ← / → | 大图切换 |
| S | 大图中切换星标 |
| N | 大图中切换 NSFW 标记 |
| Delete | 移出选中（进软件回收站，可恢复） |
| Esc | 关闭弹窗 / 大图（或点右上角红色 ✕） |

## 开发与构建

```bash
npm install              # 安装依赖
npm start                # 开发模式启动
npm run dist             # 生成 Windows NSIS 安装包到 release/
```

详细打包说明（含 winCodeSign 缓存陷阱处理）见项目 `.workbuddy/memory/MEMORY.md`。

## 开源许可

本项目代码采用 **MIT License** 开源，详见 [LICENSE](./LICENSE)。

### 第三方组件与模型

| 组件 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| Electron | 33.x | MIT | https://www.electronjs.org/ |
| electron-builder | 25.x | MIT | https://www.electron.build/ |
| onnxruntime-node | 1.20.x | MIT | https://onnxruntime.ai/ |
| MobileNetV2 int8 模型 | - | Apache 2.0 | https://github.com/onnx/models/tree/main/validated/vision/classification/mobilenet |
| ImageNet 1000 类标签 | - | 公开数据集 | https://github.com/pytorch/hub |

模型文件（`model/mobilenetv2-12-int8.onnx` 约 3.65 MB，`model/labels.txt`）随仓库分发，使用者需遵守各自许可证。

## 下载安装

- **最新版本安装包**：见 [Releases](../../releases) 页面，下载 `PicFlow 图片管家 Setup X.Y.Z.exe` 双击安装
- **源码运行**：克隆仓库后 `npm install && npm start`

