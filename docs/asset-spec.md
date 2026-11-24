# PaperDollKit v2 装备与部件制作规范

无论资产由美术绘制（Photoshop / Aseprite）、程序化脚本生成，还是由 AI 生图后处理入库，只要满足以下 6 条约束，即可通过 `auditAssetPack()` 质检并在 WebGL2 / Godot 4 / Cocos Creator 3.x 三端 1:1 正常渲染与换色。

## 1. 画布、比例与脚底原点
- **标准画布**：`256 × 256` px（也可等比放大至 `512 × 512`）。
- **脚底原点（Foot Origin）**：`(width * 0.5, height * 0.875)`，即 `256×256` 下的 `(128, 224)`。所有角色 Y-Sort 深度排序以此点为准。
- **内置超 Q 贴纸包头身比**：约 `1.75` 头身，导出自同一基准骨架时可直接混搭。

## 2. 8 向朝向与 5+3 镜像约定
- 只需绘制 **5 个标准朝向**：`S`（正南）、`SE`（东南）、`E`（正东）、`NE`（东北）、`N`（正北）。
- `SW / W / NW` 由运行时自动水平镜像 `SE / E / NE`，**无需重复绘制**。
- 武器、盾牌、背饰等对称或挂点件可使用单张共享帧。

## 3. 17 槽位、Pivot 与武器朝向
- **主手武器（`main_hand`）**：挂接在 `+X` 前手 `hand_main` Socket，握柄对齐 Pivot `(0.35, 0.71)`，**武器尖端朝向斜前方**。
- **副手装备（`off_hand`）**：挂接在 `-X` 后手 `hand_off` Socket。
- **腿部与鞋子（`legs_bottom` / `feet_shoes`）**：若参与行走动画，需提供 6 帧同步迈步序列帧（`walk_0` ~ `walk_5`，8 FPS）。

## 4. Albedo + Semantic Mask 双图协议（换色核心）
- **Albedo PNG**：用中性灰度明暗表现立体光影；线稿、眼睛、银色金属高光等不希望随调色板变色的像素直接保留原色。
- **Mask PNG（`_mask.png`）**：与 Albedo 同尺寸、同像素对齐：
  - `R` = 主色权重（采样 LUT Row 0）
  - `G` = 辅色权重（采样 LUT Row 1）
  - `B` = 肤色权重（采样 LUT Row 2 — **手臂/手套的手掌部分必须画在 B 通道，才能与角色肤色自动同步**）
  - **`A = 255`（必须完全不透明！）**：禁止将 Mask 存成半透明，否则 Photoshop / PNG / Canvas2D 预乘会破坏 RGB 权重。
  - `R = G = B = 0`（纯黑不透明）的像素保留 Albedo 原色。

## 5. 文件命名与 PSD 图层自动映射
- **PSD 直导**：图层名或图层组名支持中英文（如 `head_hat` / `帽子`、`torso_top` / `上衣`、`main_hand` / `武器`）。
- **PNG 批量导入**：推荐 `<slotId>/<partId>_<dir>.png` 与 `<slotId>/<partId>_<dir>_mask.png`。

## 6. 互斥规则与风格标签
- **互斥 / 遮挡规则（`PartRules`）**：
  - 全覆头盔声明 `rules: { hidesSlots: ['hair_style'] }`
  - 兜帽声明 `rules: { overrideSlots: { hair_style: 'short' } }`
  - 双手武器（如长弓）声明 `rules: { hidesSlots: ['off_hand'] }`
- **风格标签（`tags`）**：为新部件打上 `heavy / magic / ranged / stealth / noble / civilian / melee / light` 等标签，即可自动参与种子随机与职业模板生成。

## 7. 自动质检（`auditAssetPack`）
导入 Studio 或运行 CLI 时，自动检查：
1. 5 个标准朝向是否齐全（缺失触发 `MISSING_DIRECTION` 提示）；
2. `sourceRect` / `maskRect` 是否越界或宽高为 0；
3. Mask PNG 是否存在 `A < 250` 的非零 RGB 权重像素（触发 `MASK_ALPHA_NOT_OPAQUE` 错误）；
4. `PartRules` 目标槽位与替换部件是否有效。
