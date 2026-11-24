# PaperDollKit v2 · 游戏引擎开箱即用示例工程

本目录提供 **Godot 4.x** 与 **Cocos Creator 3.x** 的最小可运行 Demo 模板，演示如何将 Studio 或 CLI 导出的 **Mode B 模块化实时换装资源包** 快速接入实际游戏场景。

## 1. 先导出 Mode B 模块化资源包

在仓库根目录执行（或在 Studio 点击「导出 Godot/Cocos → Mode B 模块化实时换装」）：

```bash
pnpm build
pnpm cli export --mode modular --engine dual --name hero_kit --seed knight-01 --archetype knight --out ./out/demo_kit
```

## 2. Godot 4.x 示例 (`examples/godot4-demo/`)

1. 将导出的 `godot4/hero_kit/` 解压至 `examples/godot4-demo/characters/hero_kit/`。
2. 用 Godot 4.3+ 打开 `examples/godot4-demo/project.godot`。
3. 打开 `scenes/Main.tscn`，将 `characters/hero_kit/hero_kit_modular.tscn` 拖入 `Main` 节点下并命名为 `PaperDollModular`（放置在 `(640, 360)`）。
4. 按 `F5` 运行：
   - `WASD` / 方向键：等距 8 向行走与自动朝向切换
   - `Space` / `J`：挥击（控制台打印 `animation_event` 回调）
   - `K`：施法
   - `1` / `2` / `3`：实时切换护甲主色（零换图，GPU 256×4 LUT 染色）
   - `H`：触发受击闪白 Shader
   - `L`：开关跟随鼠标的 `PointLight2D` 2D 法线光照

## 3. Cocos Creator 3.x 示例 (`examples/cocos3-demo/`)

1. 用 Cocos Creator 3.8+ 新建或打开项目，将 `examples/cocos3-demo/assets/scripts/PaperDollDemoController.ts` 复制到 `assets/scripts/`。
2. 将导出的 `cocos3/hero_kit/` 解压至 `assets/resources/hero_kit/`。
3. 在场景中创建一个带 `PaperDollModular` 组件的节点，将 `PaperDollDemoController` 挂载到 `Canvas` 并绑定 `dollNode`。
4. 运行后支持 `WASD` 移动、`Space/J` 挥击、`K` 施法、`C` 实时切换调色板、`H` 触发受击闪白。
