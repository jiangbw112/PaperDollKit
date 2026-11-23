import assert from 'node:assert/strict';
import kit from './paperdoll.js';

const {
  SLOTS,
  DIRECTIONS,
  ACTIONS,
  PALETTES,
  SKINS,
  PRESETS_16,
  getRenderOrder,
  resolvePaletteColor,
  PaperDollCharacter,
} = kit;

// 1. 规格完整性校验
assert.equal(SLOTS.length, 17, '必须包含 17 个槽位');
assert.equal(DIRECTIONS.length, 8, '必须包含 8 个方向');
assert.equal(ACTIONS.length, 4, '必须包含 4 种动作');
assert.equal(Object.keys(PALETTES).length, 10, '必须包含 10 套调色板');
assert.equal(PRESETS_16.length, 16, '必须包含 16 个角色预设');

// 2. 8 方向 Z-Order 动态排序校验
const frontOrder = getRenderOrder('S');
const backOrder = getRenderOrder('N');
assert.ok(frontOrder.indexOf('back_cape') < frontOrder.indexOf('torso_top'), '正面时披风应在躯干后');
assert.ok(backOrder.indexOf('back_cape') > backOrder.indexOf('torso_top'), '背面时披风应在躯干前');

// 3. 16 个预设全部可正常合成 8 方向 × 4 动作
for (const preset of PRESETS_16) {
  const ch = new PaperDollCharacter({ preset: preset.id });
  assert.ok(ch.getActiveLayerCount() >= 8, `预设 ${preset.id} 应有足够活跃槽位`);
  for (const dir of DIRECTIONS) {
    ch.setDirection(dir.id);
    for (const act of ACTIONS) {
      ch.setAction(act.id);
      const composed = ch.composeFrame(0);
      assert.ok(composed.layers.length > 0, `${preset.id}/${dir.id}/${act.id} 渲染图层为空`);
    }
  }
}

// 4. 调色板 LUT 换色与「手没跟着变色」坑复现/修复校验
const ch = new PaperDollCharacter({ preset: 'knight' });
ch.setSkin('deep');
const deepSkinHex = SKINS.deep.ramp[2];
const woodSkinHex = SKINS.wood.ramp[2];

// 正常模式：手臂的肤色通道(11)应映射为深棕肤色
const fixedHandColor = resolvePaletteColor(11, 'front_arm', PALETTES.crimson, SKINS.deep, 'none');
assert.equal(fixedHandColor, deepSkinHex, '修复模式下手部应同步为当前肤色');

// 坑模式 baked_wood：手臂的肤色通道(11)写死为原木色
const bugWoodHandColor = resolvePaletteColor(11, 'front_arm', PALETTES.crimson, SKINS.deep, 'baked_wood');
assert.equal(bugWoodHandColor, woodSkinHex, 'baked_wood 坑模式下手部停留在原木色');

// 坑模式 dyed_sleeve：手臂像素被染成衣服主色
ch.setHandColorBugMode('dyed_sleeve');
const composedBug = ch.composeFrame(0);
const frontArmLayer = composedBug.layers.find(l => l.slotId === 'front_arm');
assert.ok(frontArmLayer, '应包含 front_arm 图层');
assert.equal(frontArmLayer.grid.includes(11), false, 'dyed_sleeve 模式下手部像素不再走肤色通道 11');

// 5. JSON 序列化往返校验
ch.setHandColorBugMode('none').setPalette('torso_top', 'sakura');
const json = ch.toJSON();
const restored = PaperDollCharacter.fromJSON(json);
assert.deepEqual(restored.toJSON(), json, 'JSON 序列化与反序列化应完全一致');

console.log('ALL TESTS PASSED:', {
  slots: SLOTS.length,
  directions: DIRECTIONS.length,
  actions: ACTIONS.length,
  palettes: Object.keys(PALETTES).length,
  presets: PRESETS_16.length,
});
