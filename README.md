# PaperDollKit v2 · 2.5D 等距俯视纸娃娃工坊

面向 **2.5D 等距俯视（Isometric 2.5D）2D 角色** 的模块化换装装配工坊、多人同屏沙盘与多引擎导出套件，支持同时导出至 **Godot 4.x** 与 **Cocos Creator 3.x**（烘焙序列帧 + 模块化实时换装双模式）。

> 架构与 Shader/导出协议详见 [docs/architecture.md](./docs/architecture.md)。
> v1.0 零依赖像素研究原型已归档在 [legacy/v1/](./legacy/v1/)（对应 tag `v1.0.0-prototype`）。

## 当前工作区状态（M0 ~ M3 已完成）

- **`@paperdollkit/core`**（M1）：
  - 规范化 `v2.0.0` 高清 2D 纸娃娃 IR（`AssetPackManifest` / `CharacterConfig` + 运行时严格校验）
  - 等距 8 向 / 4 向 / 2 向朝向表与自动镜像反射（8 向仅需绘制 `S/SE/E/NE/N` 5 向，`W/SW/NW` 自动对称映射）
  - **混合动画求值器**：层级剪纸骨骼关键帧（`step / linear / easeInOut`）+ 逐帧序列帧 + 帧级挂点（Socket）跟随
  - **Mask + Gradient Ramp LUT 换色引擎**：统一 `256×4` RGBA8 LUT 纹理（主色 / 辅色 / 肤色通道）与 CPU 参考实现
- **`@paperdollkit/importers`**（M2）：
  - **分层 `.psd` 直导**（基于 `ag-psd`，浏览器与 Node 无头通用，自动保留文档画布坐标与 Pivot）
  - **外部 PNG / Albedo + `_mask.png` 导入**：支持中英文图层/路径自动映射到 17 槽位、透明边界自动裁边（trim）、单方向自动泛化
- **`@paperdollkit/renderer-webgl2`**（M2）：
  - 轻量自研 WebGL2 渲染器（GLSL ES 3.00，1:1 实现跨引擎 Mask+Ramp LUT 协议）+ 多角色单画布合批渲染 + 离屏像素回读 + Canvas 2D 软件回退
- **`@paperdollkit/exporters`**（M3）：
  - 纯 TS 无损 RGBA8 PNG 编码器 + `fflate` ZIP 打包 + **MaxRects BSSF 紧密合图装箱**（含自动透明裁边与偏移恢复）
  - 同构烘焙器：浏览器端走 WebGL2 GPU 离屏加速，Node 端内置纯 TS CPU 烘焙回退
  - **Godot 4.x 烘焙导出（Mode A）**：一键生成 `_atlas.png` + `.import` + `SpriteFrames (.tres format=3)` + `AnimatedSprite2D (.tscn)`（脚底锚点已对齐 Y-Sort）+ `_controller.gd`
  - **Cocos Creator 3.x 烘焙导出（Mode A）**：一键生成 `_atlas.png` + Format-2 `.plist`（SpriteAtlas）+ `_manifest.json` + `animations/*.anim` + `PaperDollBakedPlayer.ts` 开箱即用组件
- **`@paperdollkit/studio`**（M2 ~ M3）：
  - Vite + React 19 + Tailwind CSS v4 **2.5D 等距俯视纸娃娃工坊**，内置超 Q 纸片贴纸风格 **1 原木木头人 + 16 完整角色预设墙**（含 6 帧同步迈步、单图集秒开）、等距 8 向罗盘、骨架 Gizmo、Mask 调试视图、**多人同屏空白场景 Playground（Y-Sort 深度遮挡 / 拖拽走位 / AI 自由漫游）**，以及 **Godot 4 / Cocos 3.x 一键 GPU 烘焙导出向导**

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev:studio     # 启动高清装配工坊开发服务 (http://localhost:5173)
pnpm build          # 编译所有 packages（含 .d.ts 与 Studio 生产包）
pnpm typecheck      # 全工作区严格类型检查
pnpm test           # 运行 Vitest 单元测试
pnpm test:legacy    # 验证归档的 v1.0 原型测试
```
