# PaperDollKit v2 · 2.5D 等距俯视纸娃娃工坊

面向 **2.5D 等距俯视（Isometric 2.5D）2D 角色** 的模块化换装装配工坊、多人同屏沙盘、无头 CLI 批量管线与多引擎导出套件，支持同时导出至 **Godot 4.x** 与 **Cocos Creator 3.x**（Mode A 烘焙序列帧 + Mode B 模块化实时换装双模式）。

> 架构与 Shader/导出协议详见 [docs/architecture.md](./docs/architecture.md)。
> 装备与部件美术/技术制作规范详见 [docs/asset-spec.md](./docs/asset-spec.md)。
> v1.0 零依赖像素研究原型已归档在 [legacy/v1/](./legacy/v1/)（对应 tag `v1.0.0-prototype`）。

## 当前工作区状态（M0 ~ M5 已完成）

- **`@paperdollkit/core`**（M1 / M4 / M5）：
  - 规范化 `v2.0.0` 高清 2D 纸娃娃 IR（`AssetPackManifest` / `CharacterConfig` + 严格校验 + `auditAssetPack` 自动资产质检）
  - 等距 8 向 / 4 向 / 2 向朝向表与 5+3 自动镜像（仅需绘制 `S/SE/E/NE/N`，`W/SW/NW` 自动对称映射）
  - **混合动画求值器**：层级剪纸骨骼关键帧（`step / linear / easeInOut`）+ 逐帧序列帧 + 帧级挂点（Socket）+ 动画事件（`footstep` / `hit` / `cast_release` / `hit_impact`）
  - **部件互斥 / 遮挡规则（`PartRules`）**：`hidesSlots`（头盔隐藏发型、双手弓禁副手）与 `overrideSlots`（兜帽收束短发），无损不破坏底层选装
  - **Mask + Gradient Ramp LUT 换色引擎**：统一 `256×4` RGBA8 LUT 纹理（主色 / 辅色 / 肤色通道）与受击闪白 / 描边跨引擎 Shader 契约
  - **确定性种子随机 + 职业模板生成器**：6 套职业风格模板 + 和谐配色表，同 `seed` 永远生成同一角色
- **`@paperdollkit/importers`**（M2）：
  - **分层 `.psd` 直导**（基于 `ag-psd`，浏览器与 Node 无头通用）与 **PNG / `_mask.png` 批量导入**（中英文槽位自动映射、自动裁边）
- **`@paperdollkit/renderer-webgl2`**（M2）：
  - 轻量自研 WebGL2 渲染器（GLSL ES 3.00，1:1 实现跨引擎 Mask+Ramp LUT 协议）+ 多角色单画布合批渲染 + Canvas 2D 软件回退
- **`@paperdollkit/exporters`**（M3 / M4 / M5）：
  - **Mode A 烘焙序列帧（M3）**：MaxRects BSSF 紧密合图 + Godot 4（`.tres` + `.tscn` + `.gd`）& Cocos 3.x（`.plist` + `.anim` + `PaperDollBakedPlayer.ts`）
  - **Mode B 模块化实时换装（M4）**：导出源贴图 + Mask + `paperdoll_manifest.json` + 跨引擎 LUT 着色器（含受击闪白与 8 向描边）+ `PaperDollModular.gd` / `PaperDollModular.ts` 开箱即用实时换装组件（支持 `PartRules`、动画事件、动态生成 LUT）
  - **署名清单（M5）**：自动生成 `CREDITS.csv` / `CREDITS.txt`
- **`@paperdollkit/cli`**（M5）：
  - 零浏览器依赖的无头命令行工具：支持资产质检（`audit`）、单角色 Mode A / Mode B 导出（`export`）、确定性批量生成 NPC（`batch`，输出总览接触图 `index.png` + `manifest.json` + `CREDITS.csv/txt`）
- **`@paperdollkit/studio`**（M2 ~ M5）：
  - Vite + React 19 + Tailwind CSS v4 **2.5D 等距俯视纸娃娃工坊**：内置超 Q 贴纸风 **1 原木木头人 + 16 角色预设墙**、等距 8 向罗盘、骨架 Gizmo、Mask 调试视图、**撤销/重做**、**自动保存 + 本地角色库 + JSON 项目存档读写**、**多人同屏 Playground**，以及 **Mode A / Mode B 双模式一键导出向导**

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev:studio     # 启动高清装配工坊开发服务 (http://localhost:5173)
pnpm build          # 编译所有 packages（含 .d.ts 与 Studio 生产包）
pnpm typecheck      # 全工作区严格类型检查
pnpm test           # 运行全部 Vitest 单元测试
pnpm test:legacy    # 验证归档的 v1.0 原型测试

# 无头 CLI 示例（先执行 pnpm build）
pnpm cli audit
pnpm cli export --mode modular --engine dual --name knight_kit --out ./out/kit
pnpm cli batch --count 8 --seed riverford --out ./out/village
```
