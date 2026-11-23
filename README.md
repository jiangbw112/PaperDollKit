# PaperDollKit v2

面向 **暗黑风格俯视（Isometric 2.5D）高清 2D 角色** 的模块化换装装配工坊与多引擎导出套件，支持同时导出至 **Godot 4.x** 与 **Cocos Creator 3.x**（烘焙序列帧 + 模块化实时换装双模式）。

> 架构与 Shader/导出协议详见 [docs/architecture.md](./docs/architecture.md)。
> v1.0 零依赖像素研究原型已归档在 [legacy/v1/](./legacy/v1/)（对应 tag `v1.0.0-prototype`）。

## 当前工作区状态（M0 ~ M2 已完成）

- **`@paperdollkit/core`**（M1）：
  - 规范化 `v2.0.0` 高清 2D 纸娃娃 IR（`AssetPackManifest` / `CharacterConfig` + 运行时严格校验）
  - 暗黑 8 向 / 4 向 / 2 向朝向表与自动镜像反射（8 向仅需绘制 `S/SE/E/NE/N` 5 向，`W/SW/NW` 自动对称映射）
  - **混合动画求值器**：层级剪纸骨骼关键帧（`step / linear / easeInOut`）+ 逐帧序列帧 + 帧级挂点（Socket）跟随
  - **Mask + Gradient Ramp LUT 换色引擎**：统一 `256×4` RGBA8 LUT 纹理（主色 / 辅色 / 肤色通道 / 金属）与 CPU 参考实现
- **`@paperdollkit/importers`**（M2）：
  - **分层 `.psd` 直导**（基于 `ag-psd`，浏览器与 Node 无头通用，自动保留文档画布坐标与 Pivot）
  - **外部 PNG / Albedo + `_mask.png` 导入**：支持中英文图层/路径自动映射到 17 槽位、透明边界自动裁边（trim）、单方向自动泛化
  - 内置 `256×256` 高清抗锯齿 SDF 示例包（含 4 预设与完整语义遮罩），开箱即可在工坊中体验高清换装与手部肤色同步
- **`@paperdollkit/renderer-webgl2`**（M2）：
  - 轻量自研 WebGL2 渲染器（GLSL ES 3.00，1:1 实现跨引擎 Mask+Ramp LUT 协议）+ 离屏像素回读 + Canvas 2D 软件回退
- **`@paperdollkit/studio`**（M2）：
  - Vite + React 19 + Tailwind CSS v4 高清暗黑俯视装配工坊：WebGL2 视口、等距菱形地格、可拖拽骨骼/轴心 Gizmo、Mask 通道调试视图、GPU `256×4` LUT 实时预览、手部肤色通道诊断，以及整包 PSD / 单槽位 PNG+Mask 拖放替换

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev:studio     # 启动高清装配工坊开发服务 (http://localhost:5173)
pnpm build          # 编译所有 packages（含 .d.ts 与 Studio 生产包）
pnpm typecheck      # 全工作区严格类型检查
pnpm test           # 运行 Vitest 单元测试
pnpm test:legacy    # 验证归档的 v1.0 原型测试
```
