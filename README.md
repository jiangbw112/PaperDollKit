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
- **`@paperdollkit/importers`**（M2 + P1）：
  - **分层 `.psd` 直导**（`ag-psd`）、**Aseprite `.ase` / `.aseprite` 二进制直导**（含 zlib 解压、图层组与标签）、**横条/网格序列帧切分（`sliceSpriteStrip`）** 与 **PNG / `_mask.png` 批量导入**
  - **普通 PNG 一键自动生成合规 Mask（`generateAutoMaskFromImage`）** 与 **Sobel 2D 法线贴图自动生成（`generateAutoNormalMap`）**
- **`@paperdollkit/renderer-webgl2`**（M2）：
  - 轻量自研 WebGL2 渲染器（GLSL ES 3.00，1:1 实现跨引擎 Mask+Ramp LUT 协议）+ 多角色单画布合批渲染 + Canvas 2D 软件回退
- **`@paperdollkit/exporters`**（M3 / M4 / M5 / P2）：
  - **Mode A 烘焙序列帧（M3）**：MaxRects BSSF 紧密合图 + Godot 4（`.tres` + `.tscn` + `.gd`）& Cocos 3.x（`.plist` + `.anim` + `PaperDollBakedPlayer.ts`）+ 通用多引擎格式（TexturePacker JSON Hash、Aseprite JSON、Unity 2D `.png.meta`）
  - **Mode B 模块化实时换装（M4 + P2）**：导出源贴图 + Mask + 可选 2D 法线贴图 + `paperdoll_manifest.json` + 跨引擎 LUT 着色器（含受击闪白、8 向描边与 **2D 法线光照 `NORMAL_MAP` / `normalTexture`**）+ `PaperDollModular.gd` / `PaperDollModular.ts` 开箱即用实时换装组件
  - **署名清单（M5）**：自动生成 `CREDITS.csv` / `CREDITS.txt`
- **`@paperdollkit/cli`**（M5 + P2）：
  - 零浏览器依赖的无头命令行工具：`audit`（资产质检）、`export`（Mode A/B 导出）、`batch`（确定性批量生成 NPC + `index.png` 接触图）、**`mcp`（stdio JSON-RPC 2.0 MCP Server，支持 AI Agent 自然语言设计角色 `design_character` 与一键导出）**
- **`@paperdollkit/studio`**（M2 ~ P2）：
  - Vite + React 19 + Tailwind CSS v4 **2.5D 等距俯视纸娃娃工坊**：内置超 Q 贴纸风 **75 部件 / 21 预设墙**、等距 8 向罗盘、骨架 Gizmo、**可视化动画事件轨编辑器**、**普通 PNG 自动生成 Mask**、**AI 骨架参考底图 PNG 导出**、撤销/重做、本地角色库与 JSON 存档读写
  - **多人同屏 Playground**：支持 **WASD/方向键实时操控 + Space/J 挥击判定与受击反应 + K 法术环特效**、Y 轴自动深度排序、自由漫游、`+25 极限压测` 与实时 FPS / 帧耗时 HUD

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev:studio     # 启动高清装配工坊开发服务 (http://localhost:5173)
pnpm build          # 编译所有 packages（含 .d.ts 与 Studio 生产包）
pnpm typecheck      # 全工作区严格类型检查
pnpm test           # 运行全部 Vitest 单元测试
pnpm test:legacy    # 验证归档的 v1.0 原型测试

# 无头 CLI 与 MCP Server 示例（先执行 pnpm build）
pnpm cli audit
pnpm cli export --mode modular --engine dual --name knight_kit --out ./out/kit
pnpm cli batch --count 8 --seed riverford --out ./out/village
pnpm cli mcp
```
