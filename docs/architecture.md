# PaperDollKit v2.0 技术架构文档

> 目标定位：面向 **暗黑风格俯视（Diablo-style Isometric 2.5D）高清 2D 角色** 的模块化换装装配与资产导出工坊，支持 **烘焙序列帧（Mode A）** 与 **模块化实时换装（Mode B）** 双模式导出至 **Godot 4.x** 与 **Cocos Creator 3.x**。

---

## 1. 动画架构选型结论：为什么采用「混合驱动 + 双模导出」？

在暗黑类俯视 ARPG（8 方向 / 4 方向，同屏大量怪物 + 主角实时换装）中，纯剪纸骨骼和纯逐帧序列各有明显短板：

| 方案 | 显存占用 | 同屏 DrawCall / CPU 性能 | 暗黑俯视 8 方向美术表现 | 引擎适配性（Godot 4 / Cocos 3.x） |
| :--- | :--- | :--- | :--- | :--- |
| **纯剪纸骨骼（Cutout Rig）** | 极低（每部件 1 张图） | 中（17 节点 × 50 怪 = 850 节点更新） | 弱：俯视斜角下 2D 平面旋转手臂/长剑容易出现**透视穿帮**（缺少近大远小与纵深透视） | 极好（原生 `Node2D` / `Node` 树） |
| **纯逐帧序列（Frame Sequence）** | 极高（高清图 × 8 向 × 20 帧 × 17 槽位显存爆炸） | **烘焙合图后极高**（1 怪 = 1 个 Sprite） | **最好**（暗黑 2 经典做法，动作透视完全准确） | 极好（`SpriteFrames` / `AnimationClip`） |
| **混合方案（本项目采用）** | **可控**（躯干/腿部 4~6 关键帧，装备/武器/头饰挂点复用单图） | **分场景最优**：怪物用烘焙单图，主角用模块化实时换装 | **兼顾透视与工作量**：8 方向仅画 5 向（`S/SE/E/NE/N`），`W/SW/NW` 自动镜像 | **双模式 100% 引擎原生，零第三方 C++ 插件** |

### 运行时分层落地策略
1. **怪物 / NPC / 批量单位 → 导出模式 A（Baked SpriteSheet）**：工坊通过 WebGL2 离屏烘焙出已换好色的精灵表，在 Godot/Cocos 里每个单位仅占 **1 个 Sprite 节点**，轻松支撑同屏上百单位合批渲染。
2. **主角 / 可换装英雄 → 导出模式 B（Modular Runtime Kit）**：导出 MaxRects 紧密合图（Albedo + Mask + 256×4 LUT）+ 原生层级节点与 Shader，在引擎内实时换装/换色/换肤；同屏 1~8 个主角开销极低，且完全兼容运行时 RenderTexture 缓存。

---

## 2. 高清换色与手部肤色同步：Mask + Gradient Ramp LUT 协议

高清 2D 图包含柔光阴影、线稿与抗锯齿边缘，不能直接用像素风的离散色号索引。v2.0 将其升级为跨 WebGL2 / Godot 4 / Cocos 3.x **数学完全等价** 的着色器协议（定义见 `packages/core/src/shader/contract.ts`）：

### 纹理约定
- **Albedo 图（RGBA8）**：携带完整高清明暗光影、线稿与透明度（可为灰度底图或带固定色细节的彩图）。
- **Semantic Mask 图（RGBA8，强制不透明 `A = 255`，与 Albedo UV 对齐）**：
  - `R` = 主服装色权重（采样 LUT 第 0 行）
  - `G` = 辅服装色权重（采样 LUT 第 1 行）
  - `B` = **肤色语义通道权重**（采样 LUT 第 2 行——手臂图层中袖子画在 `R`，手掌画在 `B`，完美保留抗锯齿交界并彻底解决“换肤色手不跟着变色”）
  - `A = 255`（固定不透明，避免 Photoshop/PNG/Canvas 2D 预乘 Alpha 把低透明像素的 RGB 通道抹零）
  - `1 - (R + G + B)` = 保留 Albedo 原色（线稿、眼白、手绘银甲高光不受染色影响）
- **LUT 纹理（`256 × 4` RGBA8，LINEAR 采样，CLAMP_TO_EDGE）**：
  - Row 0 (`v = 0.125`): Primary 渐变色带
  - Row 1 (`v = 0.375`): Secondary 渐变色带
  - Row 2 (`v = 0.625`): Skin 渐变色带
  - Row 3 (`v = 0.875`): 预留扩展色带

### 核心采样公式（WebGL2 / `.gdshader` / `.effect` 统一）
```glsl
float lum = dot(albedo.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 cPrimary   = texture(u_lut_tex, vec2(lum, 0.125)).rgb;
vec3 cSecondary = texture(u_lut_tex, vec2(lum, 0.375)).rgb;
vec3 cSkin      = texture(u_lut_tex, vec2(lum, 0.625)).rgb;

vec3 w = mask.rgb;
float wSum = w.r + w.g + w.b;
if (wSum > 1.0) w /= wSum;
float wOrig = max(0.0, 1.0 - (w.r + w.g + w.b));

vec3 finalRgb = albedo.rgb * wOrig
              + cPrimary * w.r
              + cSecondary * w.g
              + cSkin * w.b;
```

---

## 3. Monorepo 分包规划与演进路线

```text
PaperDollKit/
├── packages/
│   ├── core/            # [M1 已完成] 纯 TS 核心 IR、层级/混合动画求值、Mask+Ramp LUT、运行时状态
│   ├── importers/       # [M2] 外部高清图导入（ag-psd 分层 PSD 直导 + PNG/图集导入 + 自动裁边）
│   ├── renderer-webgl2/ # [M2] 轻量 WebGL2 渲染器（1:1 实现上述 Shader 协议 + 离屏帧烘焙）
│   ├── studio/          # [M2-M5] Vite + React + Tailwind 可视化工坊
│   ├── exporters/       # [M3-M4] MaxRects 装箱 + Godot 4 (.tres/.tscn/.gdshader/.gd) + Cocos 3.x (.plist/.anim/.effect/.ts)
│   └── cli/             # [M5] 无头批量导出命令行
├── docs/                # 架构与协议文档
└── legacy/v1/           # v1.0 零依赖像素研究原型归档（git tag: v1.0.0-prototype）
```
