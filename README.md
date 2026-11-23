# PaperDollKit — 零依赖 2D 分层纸片人核心库

参考 17 槽位贴纸式纸娃娃架构实现的轻量化 JS 核心库，支持 **17 个独立槽位**、**10 套调色板实时换色（LUT）**、**8 方向 × 4 动作动画状态机**，并内置**手部肤色同步开关**用于直观对比「手没跟着变色」的常见坑与修复方案。

## 快速上手

```html
<canvas id="stage" width="256" height="256"></canvas>
<script src="./paperdoll.js"></script>
<script>
  const { PaperDollCharacter } = window.PaperDollKit;

  const hero = new PaperDollCharacter({ preset: 'knight' });
  hero.setDirection('SE').setAction('walk');

  const ctx = document.getElementById('stage').getContext('2d');
  function loop(t) {
    ctx.clearRect(0, 0, 256, 256);
    hero.render(ctx, 32, 32, 6, t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
</script>
```

## 核心 API

- `new PaperDollCharacter(config)`：创建角色实例（可传入 `preset`、`skin`、`slots`、`palettes`、`direction`、`action`）。
- `char.setSlot(slotId, partId)`：替换指定槽位部件（17 个槽位见 `PaperDollKit.SLOTS`）。
- `char.setPalette(slotId, paletteId)` / `char.setAllClothingPalette(paletteId)`：为单个槽位或整套服装实时切换色板（10 套色板见 `PaperDollKit.PALETTES`）。
- `char.setSkin(skinId)`：切换 6 种肤色/原木素体色。
- `char.setDirection(dir)` / `char.setAction(action)`：切换 8 方向（`S/SW/W/NW/N/NE/E/SE`）与 4 动作（`idle/walk/attack/cheer`），自动按朝向重排 Z-Order。
- `char.setHandColorBugMode(mode)`：切换 `'none'`（正常肤色通道同步）、`'baked_wood'`（手部写死原木色）、`'dyed_sleeve'`（手部误用衣服主色）。
- `char.applyPreset(presetId)`：一键加载 `mannequin` 或 16 个角色预设（`PaperDollKit.PRESETS_16`）。
- `char.toJSON()` / `PaperDollCharacter.fromJSON(json)`：序列化与反序列化角色配置。
