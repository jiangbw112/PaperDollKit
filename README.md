# PaperDollKit v2

面向 **暗黑风格俯视（Isometric 2.5D）高清 2D 角色** 的模块化换装装配工坊与多引擎导出套件，支持同时导出至 **Godot 4.x** 与 **Cocos Creator 3.x**（烘焙序列帧 + 模块化实时换装双模式）。

> 架构与 Shader/导出协议详见 [docs/architecture.md](./docs/architecture.md)。
> v1.0 零依赖像素研究原型已归档在 [legacy/v1/](./legacy/v1/)（对应 tag `v1.0.0-prototype`）。

## 当前工作区状态

- **`@paperdollkit/core`**（已完成 M1）：
  - 规范化 `v2.0.0` 高清 2D 纸娃娃 IR（`AssetPackManifest` / `CharacterConfig` + 运行时严格校验）
  - 暗黑 8 向 / 4 向 / 2 向朝向表与自动镜像反射（8 向仅需绘制 `S/SE/E/NE/N` 5 向，`W/SW/NW` 自动对称映射）
  - **混合动画求值器**：同时支持层级剪纸骨骼关键帧（`step / linear / easeInOut`）与逐帧序列帧 + 帧级挂点（Socket）跟随
  - **Mask + Gradient Ramp LUT 换色引擎**：统一 `256×4` RGBA8 LUT 纹理（主色 / 辅色 / 肤色通道 / 金属）与 CPU 参考实现，保证 WebGL2、Godot `.gdshader`、Cocos `.effect` 渲染 1:1 一致
  - 保留 `handColorBugMode` 诊断开关，用于直观验证手臂图层肤色通道同步

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm build          # 编译所有 packages（含 .d.ts）
pnpm typecheck      # 严格类型检查
pnpm test           # 运行 Vitest 单元测试
pnpm test:legacy    # 验证归档的 v1.0 原型测试
```
