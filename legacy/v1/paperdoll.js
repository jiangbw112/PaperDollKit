/**
 * PaperDollKit v1.0.0 — 零依赖 2D 分层纸片人核心库
 * 特性：
 * - 17 槽位贴纸式分层渲染，支持 8 方向动态 Z-Order 排序
 * - 索引色调色板映射（LUT），同一部件瞬间切换 10 套色板与 6 种肤色
 * - 8 方向 × 4 动作（idle / walk / attack / cheer）动画状态机
 * - 内置「手部未随肤色同步」经典坑复现与语义通道修复开关
 * - 1 个木头人素体组合出 16 个完整角色预设
 * - 支持直接传入 Canvas 2D 上下文渲染，也支持在 Node.js 中无头运行状态与数据逻辑
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaperDollKit = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // =========================================================================
  // 1. 常量定义：17 个槽位、8 方向、4 动作、10 色板、6 肤色
  // =========================================================================

  const SLOTS = [
    { id: 'shadow',      name: '脚底阴影', category: '基础', colorable: false, required: true },
    { id: 'back_cape',   name: '披风斗篷', category: '背饰', colorable: true,  required: false },
    { id: 'back_prop',   name: '背部挂件', category: '背饰', colorable: true,  required: false },
    { id: 'body_base',   name: '木头人素体', category: '基础', colorable: false, required: true },
    { id: 'legs_bottom', name: '下装裤裙', category: '服装', colorable: true,  required: false },
    { id: 'feet_shoes',  name: '鞋靴',     category: '服装', colorable: true,  required: false },
    { id: 'torso_top',   name: '上衣护甲', category: '服装', colorable: true,  required: false },
    { id: 'belt_waist',  name: '腰带饰带', category: '服装', colorable: true,  required: false },
    { id: 'back_arm',    name: '远侧手臂', category: '肢体', colorable: true,  required: true },
    { id: 'head_base',   name: '头部素体', category: '基础', colorable: false, required: true },
    { id: 'face_eyes',   name: '五官表情', category: '面部', colorable: false, required: false },
    { id: 'face_beard',  name: '胡须面饰', category: '面部', colorable: true,  required: false },
    { id: 'hair_style',  name: '发型',     category: '头部', colorable: true,  required: false },
    { id: 'head_hat',    name: '帽子头盔', category: '头部', colorable: true,  required: false },
    { id: 'front_arm',   name: '近侧手臂', category: '肢体', colorable: true,  required: true },
    { id: 'main_hand',   name: '主手装备', category: '装备', colorable: true,  required: false },
    { id: 'off_hand',    name: '副手装备', category: '装备', colorable: true,  required: false },
  ];

  const DIRECTIONS = [
    { id: 'S',  label: '正 (南)', angle: 0,   facingBack: false, flipX: false, side: 0 },
    { id: 'SW', label: '左前',    angle: 45,  facingBack: false, flipX: true,  side: -1 },
    { id: 'W',  label: '左 (西)', angle: 90,  facingBack: false, flipX: true,  side: -2 },
    { id: 'NW', label: '左后',    angle: 135, facingBack: true,  flipX: true,  side: -1 },
    { id: 'N',  label: '背 (北)', angle: 180, facingBack: true,  flipX: false, side: 0 },
    { id: 'NE', label: '右后',    angle: 225, facingBack: true,  flipX: false, side: 1 },
    { id: 'E',  label: '右 (东)', angle: 270, facingBack: false, flipX: false, side: 2 },
    { id: 'SE', label: '右前',    angle: 315, facingBack: false, flipX: false, side: 1 },
  ];

  const ACTIONS = [
    { id: 'idle',   label: '待机', frames: 4, fps: 4 },
    { id: 'walk',   label: '行走', frames: 6, fps: 8 },
    { id: 'attack', label: '挥击', frames: 4, fps: 8 },
    { id: 'cheer',  label: '欢呼', frames: 4, fps: 6 },
  ];

  // 10 套调色板：每套含主色 4 阶（描边/暗/基/亮）+ 辅色 4 阶（描边/暗/基/亮）
  const PALETTES = {
    crimson:  { id: 'crimson',  name: '绯红卫士', swatch: '#d63e47', primary: ['#4a1218', '#99222b', '#d63e47', '#f47b82'], secondary: ['#4a3412', '#9e7020', '#dfa638', '#fae08c'] },
    cobalt:   { id: 'cobalt',   name: '钴蓝骑士', swatch: '#2e6bd1', primary: ['#10224a', '#1d4694', '#2e6bd1', '#73a7f5'], secondary: ['#2c3645', '#64748b', '#94a3b8', '#e2e8f0'] },
    emerald:  { id: 'emerald',  name: '翡翠游侠', swatch: '#29965d', primary: ['#0e3823', '#1b6640', '#29965d', '#68cf96'], secondary: ['#3d2514', '#754927', '#a66b3c', '#d49d6a'] },
    amber:    { id: 'amber',    name: '琥珀商旅', swatch: '#d98a1e', primary: ['#4a2b08', '#995b10', '#d98a1e', '#f7c15e'], secondary: ['#263d3b', '#3f6965', '#5d9690', '#9fd1cb'] },
    violet:   { id: 'violet',   name: '紫罗兰法', swatch: '#7c47d6', primary: ['#26124a', '#522999', '#7c47d6', '#b791f7'], secondary: ['#4a3412', '#a67521', '#e8b343', '#fce49d'] },
    obsidian: { id: 'obsidian', name: '曜石暗影', swatch: '#394152', primary: ['#11141c', '#232836', '#394152', '#64708a'], secondary: ['#4a1220', '#8f223b', '#cf3c5e', '#f27995'] },
    ivory:    { id: 'ivory',    name: '象牙圣殿', swatch: '#d9d4c7', primary: ['#3d3a33', '#8c8679', '#d9d4c7', '#f7f5ee'], secondary: ['#1c3c6e', '#2e61ad', '#4c88e0', '#96c0fa'] },
    bronze:   { id: 'bronze',   name: '青铜工匠', swatch: '#a8653e', primary: ['#3b2012', '#734125', '#a8653e', '#d69974'], secondary: ['#262c36', '#4c5769', '#78859c', '#b4c0d4'] },
    sakura:   { id: 'sakura',   name: '樱粉庆典', swatch: '#e06b98', primary: ['#4d1a2f', '#a33e67', '#e06b98', '#faa7c7'], secondary: ['#3b3629', '#8c8369', '#e3d9be', '#fcf9f0'] },
    frost:    { id: 'frost',    name: '冰霜北境', swatch: '#3da8c4', primary: ['#103542', '#226f85', '#3da8c4', '#8fe0f5'], secondary: ['#293342', '#526582', '#8299ba', '#cfe0f7'] },
  };

  // 6 种肤色/木质素体色板（4 阶：描边/暗/基/亮）
  const SKINS = {
    wood:   { id: 'wood',   name: '原木木头人', swatch: '#cfa06b', ramp: ['#4f3319', '#996a3b', '#cfa06b', '#edd0a4'] },
    fair:   { id: 'fair',   name: '暖白肤色',   swatch: '#f2c6a0', ramp: ['#5c3824', '#c9906b', '#f2c6a0', '#ffe3c9'] },
    tan:    { id: 'tan',    name: '小麦肤色',   swatch: '#d69b6b', ramp: ['#4d2c16', '#a36b41', '#d69b6b', '#f0bf92'] },
    bronze: { id: 'bronze', name: '古铜肤色',   swatch: '#a66b46', ramp: ['#3b1f0f', '#78472a', '#a66b46', '#c98e67'] },
    deep:   { id: 'deep',   name: '深棕肤色',   swatch: '#6e422b', ramp: ['#261209', '#4d2b1a', '#6e422b', '#946146'] },
    elf:    { id: 'elf',    name: '月影精灵',   swatch: '#9eb8d6', ramp: ['#28364a', '#6c85a6', '#9eb8d6', '#cfe1f5'] },
  };

  // 部件库（17 个槽位对应的可选样式）
  const PARTS = {
    shadow:      [{ id: 'oval', name: '椭圆投影' }],
    back_cape:   [
      { id: 'none', name: '无' },
      { id: 'short_cape', name: '短披风' },
      { id: 'long_cloak', name: '长斗篷' },
      { id: 'scarf', name: '飘逸围巾' },
    ],
    back_prop:   [
      { id: 'none', name: '无' },
      { id: 'quiver', name: '箭袋' },
      { id: 'backpack', name: '行囊' },
      { id: 'wings', name: '羽翼' },
    ],
    body_base:   [{ id: 'mannequin', name: '标准木头人' }],
    legs_bottom: [
      { id: 'none', name: '无（素体）' },
      { id: 'pants', name: '长裤' },
      { id: 'greaves', name: '重甲护腿' },
      { id: 'robe_skirt', name: '法袍下摆' },
    ],
    feet_shoes:  [
      { id: 'none', name: '无（赤足）' },
      { id: 'boots', name: '皮靴' },
      { id: 'sabaton', name: '铁甲靴' },
      { id: 'sandals', name: '绑带凉鞋' },
    ],
    torso_top:   [
      { id: 'none', name: '无（木头人）' },
      { id: 'tunic', name: '布衣短衫' },
      { id: 'plate', name: '板甲胸铠' },
      { id: 'robe', name: '长袍外衣' },
      { id: 'vest', name: '皮甲马甲' },
    ],
    belt_waist:  [
      { id: 'none', name: '无' },
      { id: 'leather_belt', name: '扣带皮腰带' },
      { id: 'sash', name: '布艺束带' },
      { id: 'gold_belt', name: '圣徽腰带' },
    ],
    back_arm:    [
      { id: 'bare', name: '素体短袖' },
      { id: 'long_sleeve', name: '长袖上衣' },
      { id: 'armor_sleeve', name: '臂铠护腕' },
    ],
    head_base:   [{ id: 'mannequin_head', name: '标准头型' }],
    face_eyes:   [
      { id: 'none', name: '木头人无五官' },
      { id: 'dot', name: '豆豆眼' },
      { id: 'sharp', name: '坚毅目光' },
      { id: 'visor_glow', name: '发光战瞳' },
      { id: 'glasses', name: '学者眼镜' },
    ],
    face_beard:  [
      { id: 'none', name: '无' },
      { id: 'goatee', name: '山羊胡' },
      { id: 'full_beard', name: '络腮大胡' },
      { id: 'mask', name: '暗影面罩' },
    ],
    hair_style:  [
      { id: 'none', name: '无（光头）' },
      { id: 'short', name: '短碎发' },
      { id: 'spiky', name: '刺猬发' },
      { id: 'long', name: '披肩长发' },
      { id: 'ponytail', name: '高马尾' },
      { id: 'bun', name: '发髻' },
    ],
    head_hat:    [
      { id: 'none', name: '无' },
      { id: 'knight_helm', name: '骑士头盔' },
      { id: 'wizard_hat', name: '尖顶法师帽' },
      { id: 'hood', name: '游侠兜帽' },
      { id: 'pirate_hat', name: '海盗三角帽' },
      { id: 'crown', name: '黄金王冠' },
      { id: 'bandana', name: '头巾' },
    ],
    front_arm:   [
      { id: 'bare', name: '素体短袖' },
      { id: 'long_sleeve', name: '长袖上衣' },
      { id: 'armor_sleeve', name: '臂铠护腕' },
    ],
    main_hand:   [
      { id: 'none', name: '空手' },
      { id: 'sword', name: '骑士长剑' },
      { id: 'staff', name: '秘法长杖' },
      { id: 'bow', name: '猎手长弓' },
      { id: 'axe', name: '战斧' },
      { id: 'dagger', name: '短刃' },
      { id: 'hammer', name: '锻造铁锤' },
    ],
    off_hand:    [
      { id: 'none', name: '空手' },
      { id: 'shield', name: '纹章圆盾' },
      { id: 'book', name: '魔法典籍' },
      { id: 'lantern', name: '提灯' },
      { id: 'dagger_off', name: '副手短刃' },
    ],
  };

  // =========================================================================
  // 2. 1 个木头人 + 16 个角色预设
  // =========================================================================

  const MANNEQUIN_PRESET = {
    id: 'mannequin',
    name: '00 · 原木木头人',
    tag: '基础素体',
    skin: 'wood',
    slots: {
      shadow: 'oval', back_cape: 'none', back_prop: 'none', body_base: 'mannequin',
      legs_bottom: 'none', feet_shoes: 'none', torso_top: 'none', belt_waist: 'none',
      back_arm: 'bare', head_base: 'mannequin_head', face_eyes: 'none', face_beard: 'none',
      hair_style: 'none', head_hat: 'none', front_arm: 'bare', main_hand: 'none', off_hand: 'none',
    },
    palettes: {
      back_cape: 'crimson', back_prop: 'bronze', legs_bottom: 'obsidian', feet_shoes: 'bronze',
      torso_top: 'cobalt', belt_waist: 'amber', back_arm: 'cobalt', face_beard: 'bronze',
      hair_style: 'bronze', head_hat: 'cobalt', front_arm: 'cobalt', main_hand: 'cobalt', off_hand: 'cobalt',
    },
  };

  const PRESETS_16 = [
    {
      id: 'knight', name: '01 · 钴蓝骑士', tag: '重甲坦克', skin: 'fair',
      slots: { back_cape: 'short_cape', back_prop: 'none', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'gold_belt', back_arm: 'armor_sleeve', face_eyes: 'sharp', face_beard: 'none', hair_style: 'short', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'sword', off_hand: 'shield' },
      palettes: { back_cape: 'crimson', legs_bottom: 'cobalt', feet_shoes: 'cobalt', torso_top: 'cobalt', belt_waist: 'amber', back_arm: 'cobalt', hair_style: 'amber', head_hat: 'cobalt', front_arm: 'cobalt', main_hand: 'frost', off_hand: 'cobalt' },
    },
    {
      id: 'mage', name: '02 · 紫罗兰大法师', tag: '元素法术', skin: 'fair',
      slots: { back_cape: 'long_cloak', back_prop: 'none', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'visor_glow', face_beard: 'full_beard', hair_style: 'long', head_hat: 'wizard_hat', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'book' },
      palettes: { back_cape: 'violet', legs_bottom: 'violet', feet_shoes: 'obsidian', torso_top: 'violet', belt_waist: 'amber', back_arm: 'violet', face_beard: 'ivory', hair_style: 'ivory', head_hat: 'violet', front_arm: 'violet', main_hand: 'amber', off_hand: 'crimson' },
    },
    {
      id: 'ranger', name: '03 · 翡翠游侠', tag: '远程猎手', skin: 'tan',
      slots: { back_cape: 'short_cape', back_prop: 'quiver', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'none', hair_style: 'ponytail', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'bow', off_hand: 'none' },
      palettes: { back_cape: 'emerald', back_prop: 'bronze', legs_bottom: 'bronze', feet_shoes: 'bronze', torso_top: 'emerald', belt_waist: 'bronze', back_arm: 'emerald', hair_style: 'amber', head_hat: 'emerald', front_arm: 'emerald', main_hand: 'bronze' },
    },
    {
      id: 'paladin', name: '04 · 圣殿炽天使', tag: '圣光守护', skin: 'fair',
      slots: { back_cape: 'long_cloak', back_prop: 'wings', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'gold_belt', back_arm: 'armor_sleeve', face_eyes: 'dot', face_beard: 'none', hair_style: 'long', head_hat: 'crown', front_arm: 'armor_sleeve', main_hand: 'hammer', off_hand: 'shield' },
      palettes: { back_cape: 'ivory', back_prop: 'ivory', legs_bottom: 'ivory', feet_shoes: 'amber', torso_top: 'ivory', belt_waist: 'amber', back_arm: 'ivory', hair_style: 'amber', head_hat: 'amber', front_arm: 'ivory', main_hand: 'amber', off_hand: 'ivory' },
    },
    {
      id: 'assassin', name: '05 · 曜石刺客', tag: '潜行双刃', skin: 'tan',
      slots: { back_cape: 'scarf', back_prop: 'none', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'visor_glow', face_beard: 'mask', hair_style: 'spiky', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'dagger', off_hand: 'dagger_off' },
      palettes: { back_cape: 'crimson', legs_bottom: 'obsidian', feet_shoes: 'obsidian', torso_top: 'obsidian', belt_waist: 'crimson', back_arm: 'obsidian', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'obsidian', front_arm: 'obsidian', main_hand: 'frost', off_hand: 'frost' },
    },
    {
      id: 'pirate', name: '06 · 绯红海盗长', tag: '航海冒险', skin: 'bronze',
      slots: { back_cape: 'none', back_prop: 'none', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'goatee', hair_style: 'long', head_hat: 'pirate_hat', front_arm: 'long_sleeve', main_hand: 'sword', off_hand: 'lantern' },
      palettes: { legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'crimson', belt_waist: 'amber', back_arm: 'ivory', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'obsidian', front_arm: 'ivory', main_hand: 'cobalt', off_hand: 'amber' },
    },
    {
      id: 'blacksmith', name: '07 · 青铜锻造师', tag: '工坊大师', skin: 'deep',
      slots: { back_cape: 'none', back_prop: 'backpack', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'bare', face_eyes: 'sharp', face_beard: 'full_beard', hair_style: 'short', head_hat: 'bandana', front_arm: 'bare', main_hand: 'hammer', off_hand: 'none' },
      palettes: { back_prop: 'bronze', legs_bottom: 'obsidian', feet_shoes: 'bronze', torso_top: 'bronze', belt_waist: 'amber', back_arm: 'bronze', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'crimson', front_arm: 'bronze', main_hand: 'obsidian' },
    },
    {
      id: 'frostguard', name: '08 · 北境冰霜卫', tag: '极地重步', skin: 'elf',
      slots: { back_cape: 'long_cloak', back_prop: 'none', legs_bottom: 'greaves', feet_shoes: 'sabaton', torso_top: 'plate', belt_waist: 'leather_belt', back_arm: 'armor_sleeve', face_eyes: 'visor_glow', face_beard: 'none', hair_style: 'spiky', head_hat: 'knight_helm', front_arm: 'armor_sleeve', main_hand: 'axe', off_hand: 'shield' },
      palettes: { back_cape: 'frost', legs_bottom: 'frost', feet_shoes: 'cobalt', torso_top: 'frost', belt_waist: 'obsidian', back_arm: 'frost', hair_style: 'ivory', head_hat: 'frost', front_arm: 'frost', main_hand: 'frost', off_hand: 'cobalt' },
    },
    {
      id: 'scholar', name: '09 · 皇家炼金学者', tag: '典籍研习', skin: 'fair',
      slots: { back_cape: 'none', back_prop: 'backpack', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'glasses', face_beard: 'goatee', hair_style: 'short', head_hat: 'none', front_arm: 'long_sleeve', main_hand: 'lantern', off_hand: 'book' },
      palettes: { back_prop: 'amber', legs_bottom: 'amber', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'bronze', back_arm: 'ivory', face_beard: 'bronze', hair_style: 'bronze', front_arm: 'ivory', main_hand: 'amber', off_hand: 'emerald' },
    },
    {
      id: 'sakura_blade', name: '10 · 樱庭剑客', tag: '轻灵剑舞', skin: 'fair',
      slots: { back_cape: 'scarf', back_prop: 'none', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'dot', face_beard: 'none', hair_style: 'bun', head_hat: 'none', front_arm: 'long_sleeve', main_hand: 'sword', off_hand: 'none' },
      palettes: { back_cape: 'sakura', legs_bottom: 'obsidian', feet_shoes: 'ivory', torso_top: 'sakura', belt_waist: 'crimson', back_arm: 'sakura', hair_style: 'obsidian', front_arm: 'sakura', main_hand: 'sakura' },
    },
    {
      id: 'viking', name: '11 · 狂怒维京战斧', tag: '近战狂战', skin: 'tan',
      slots: { back_cape: 'short_cape', back_prop: 'none', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'bare', face_eyes: 'sharp', face_beard: 'full_beard', hair_style: 'spiky', head_hat: 'bandana', front_arm: 'bare', main_hand: 'axe', off_hand: 'shield' },
      palettes: { back_cape: 'bronze', legs_bottom: 'bronze', feet_shoes: 'obsidian', torso_top: 'crimson', belt_waist: 'bronze', back_arm: 'bronze', face_beard: 'amber', hair_style: 'amber', head_hat: 'crimson', front_arm: 'bronze', main_hand: 'obsidian', off_hand: 'crimson' },
    },
    {
      id: 'desert_nomad', name: '12 · 琥珀沙海行者', tag: '商路护卫', skin: 'bronze',
      slots: { back_cape: 'scarf', back_prop: 'quiver', legs_bottom: 'pants', feet_shoes: 'sandals', torso_top: 'tunic', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'mask', hair_style: 'none', head_hat: 'hood', front_arm: 'long_sleeve', main_hand: 'bow', off_hand: 'none' },
      palettes: { back_cape: 'amber', back_prop: 'bronze', legs_bottom: 'ivory', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'crimson', back_arm: 'ivory', face_beard: 'amber', head_hat: 'ivory', front_arm: 'ivory', main_hand: 'bronze' },
    },
    {
      id: 'elf_druid', name: '13 · 月影德鲁伊', tag: '自然召唤', skin: 'elf',
      slots: { back_cape: 'long_cloak', back_prop: 'wings', legs_bottom: 'robe_skirt', feet_shoes: 'sandals', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'dot', face_beard: 'none', hair_style: 'long', head_hat: 'crown', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'lantern' },
      palettes: { back_cape: 'emerald', back_prop: 'frost', legs_bottom: 'emerald', feet_shoes: 'bronze', torso_top: 'emerald', belt_waist: 'amber', back_arm: 'emerald', hair_style: 'frost', head_hat: 'emerald', front_arm: 'emerald', main_hand: 'emerald', off_hand: 'frost' },
    },
    {
      id: 'royal_prince', name: '14 · 绯红王储', tag: '王室仪仗', skin: 'deep',
      slots: { back_cape: 'long_cloak', back_prop: 'none', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'tunic', belt_waist: 'gold_belt', back_arm: 'long_sleeve', face_eyes: 'sharp', face_beard: 'goatee', hair_style: 'short', head_hat: 'crown', front_arm: 'long_sleeve', main_hand: 'sword', off_hand: 'none' },
      palettes: { back_cape: 'crimson', legs_bottom: 'ivory', feet_shoes: 'obsidian', torso_top: 'crimson', belt_waist: 'amber', back_arm: 'crimson', face_beard: 'obsidian', hair_style: 'obsidian', head_hat: 'amber', front_arm: 'crimson', main_hand: 'amber' },
    },
    {
      id: 'night_witch', name: '15 · 暮色星辰巫女', tag: '暗夜秘术', skin: 'fair',
      slots: { back_cape: 'short_cape', back_prop: 'none', legs_bottom: 'robe_skirt', feet_shoes: 'boots', torso_top: 'robe', belt_waist: 'sash', back_arm: 'long_sleeve', face_eyes: 'glasses', face_beard: 'none', hair_style: 'ponytail', head_hat: 'wizard_hat', front_arm: 'long_sleeve', main_hand: 'staff', off_hand: 'book' },
      palettes: { back_cape: 'obsidian', legs_bottom: 'obsidian', feet_shoes: 'sakura', torso_top: 'obsidian', belt_waist: 'sakura', back_arm: 'obsidian', hair_style: 'sakura', head_hat: 'obsidian', front_arm: 'obsidian', main_hand: 'sakura', off_hand: 'violet' },
    },
    {
      id: 'explorer', name: '16 · 极光探险家', tag: '遗迹寻宝', skin: 'tan',
      slots: { back_cape: 'scarf', back_prop: 'backpack', legs_bottom: 'pants', feet_shoes: 'boots', torso_top: 'vest', belt_waist: 'leather_belt', back_arm: 'long_sleeve', face_eyes: 'dot', face_beard: 'none', hair_style: 'spiky', head_hat: 'pirate_hat', front_arm: 'long_sleeve', main_hand: 'dagger', off_hand: 'lantern' },
      palettes: { back_cape: 'frost', back_prop: 'bronze', legs_bottom: 'cobalt', feet_shoes: 'bronze', torso_top: 'amber', belt_waist: 'bronze', back_arm: 'ivory', hair_style: 'bronze', head_hat: 'bronze', front_arm: 'ivory', main_hand: 'frost', off_hand: 'amber' },
    },
  ];

  // =========================================================================
  // 3. 动态 Z-Order 排序（随 8 方向切换渲染层级）
  // =========================================================================

  function getRenderOrder(directionId) {
    const dir = DIRECTIONS.find(d => d.id === directionId) || DIRECTIONS[0];
    if (dir.facingBack) {
      // 背面朝向：手和武器在前被身体遮挡，披风/背饰覆在最外层
      return [
        'shadow',
        'off_hand',
        'main_hand',
        'front_arm',
        'back_arm',
        'body_base',
        'legs_bottom',
        'feet_shoes',
        'torso_top',
        'belt_waist',
        'head_base',
        'hair_style',
        'head_hat',
        'back_cape',
        'back_prop',
      ];
    }
    if (Math.abs(dir.side) === 2) {
      // 纯侧身（东/西）：远侧手臂与副手在躯干后，近侧手臂与主手在最前
      return [
        'shadow',
        'back_prop',
        'back_cape',
        'off_hand',
        'back_arm',
        'body_base',
        'legs_bottom',
        'feet_shoes',
        'torso_top',
        'belt_waist',
        'head_base',
        'face_eyes',
        'face_beard',
        'hair_style',
        'head_hat',
        'front_arm',
        'main_hand',
      ];
    }
    // 正面及斜前（南/西南/东南）
    return [
      'shadow',
      'back_prop',
      'back_cape',
      'back_arm',
      'off_hand',
      'body_base',
      'legs_bottom',
      'feet_shoes',
      'torso_top',
      'belt_waist',
      'head_base',
      'face_eyes',
      'face_beard',
      'hair_style',
      'head_hat',
      'front_arm',
      'main_hand',
    ];
  }

  // =========================================================================
  // 4. 索引色像素绘图工具（32×32 虚拟像素网格）
  //    索引编码：
  //      0: 透明
  //      1..4: 主色阶 (outline, dark, base, light)
  //      5..8: 辅色阶 (outline, dark, base, light)
  //      9..12: 肤色阶 (outline, dark, base, light)  <-- 手部语义通道
  //      13..16: 金属/中性色阶 (outline, dark, base, light)
  //      17: 阴影半透明黑
  //      18: 纯白高光 / 眼白
  //      19: 深炭黑瞳孔
  // =========================================================================

  const GRID = 32;
  const METAL_RAMP = ['#1e2430', '#5a667a', '#9aa8bd', '#e2eaf5'];

  function createGrid() {
    return new Uint8Array(GRID * GRID);
  }

  function px(grid, x, y, c) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix >= 0 && ix < GRID && iy >= 0 && iy < GRID) {
      grid[iy * GRID + ix] = c;
    }
  }

  function rect(grid, x, y, w, h, c) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        px(grid, x + dx, y + dy, c);
      }
    }
  }

  function outlinedRect(grid, x, y, w, h, outline, dark, base, light) {
    rect(grid, x, y, w, h, outline);
    if (w > 2 && h > 2) {
      rect(grid, x + 1, y + 1, w - 2, h - 2, base);
      // 顶部高光与底部阴影
      rect(grid, x + 1, y + 1, w - 2, 1, light);
      rect(grid, x + 1, y + h - 2, w - 2, 1, dark);
    }
  }

  // 动作帧位姿计算（返回各部位像素级偏移）
  function computePose(actionId, frameIndex, dir) {
    const f = frameIndex;
    let bodyY = 0;
    let headY = 0;
    let leftLegY = 0, rightLegY = 0, leftLegX = 0, rightLegX = 0;
    let frontArmY = 0, frontArmX = 0, backArmY = 0, backArmX = 0;
    let weaponX = 0, weaponY = 0, weaponSwing = 0;
    let capeSway = 0;

    if (actionId === 'idle') {
      const bob = (f === 1 || f === 2) ? 1 : 0;
      bodyY = bob;
      headY = bob;
      frontArmY = bob;
      backArmY = bob;
      capeSway = (f === 2) ? 1 : 0;
    } else if (actionId === 'walk') {
      const cycle = [0, -1, 0, 0, -1, 0];
      bodyY = cycle[f % 6];
      headY = bodyY;
      const stride = [0, 1, 2, 0, -1, -2][f % 6];
      leftLegX = stride;
      rightLegX = -stride;
      leftLegY = stride > 0 ? -1 : 0;
      rightLegY = stride < 0 ? -1 : 0;
      frontArmX = -Math.sign(stride);
      backArmX = Math.sign(stride);
      frontArmY = bodyY;
      backArmY = bodyY;
      capeSway = (f % 3 === 1) ? 1 : (f % 3 === 2 ? -1 : 0);
    } else if (actionId === 'attack') {
      // 0: 蓄力, 1: 挥出, 2: 延伸, 3: 收招
      const armDx = [-1, 3, 2, 0][f % 4];
      const armDy = [-2, 0, 1, 0][f % 4];
      bodyY = (f === 1) ? 1 : 0;
      headY = bodyY;
      frontArmX = armDx;
      frontArmY = armDy + bodyY;
      backArmX = -Math.sign(armDx);
      backArmY = bodyY;
      weaponX = armDx + (f === 1 ? 2 : 0);
      weaponY = armDy;
      weaponSwing = f === 1 ? 1 : (f === 2 ? 2 : 0);
      capeSway = (f === 1 || f === 2) ? -1 : 0;
    } else if (actionId === 'cheer') {
      const jump = [0, -2, -3, -1][f % 4];
      bodyY = jump;
      headY = jump;
      leftLegY = jump < -1 ? -1 : 0;
      rightLegY = jump < -1 ? -1 : 0;
      frontArmY = jump - 3;
      backArmY = jump - 3;
      frontArmX = 1;
      backArmX = -1;
      weaponY = jump - 3;
      capeSway = (f % 2 === 0) ? 1 : -1;
    }

    // 侧身视角稍微收敛双腿横向错开
    if (Math.abs(dir.side) === 2) {
      leftLegX = Math.round(leftLegX * 1.1);
      rightLegX = Math.round(rightLegX * 1.1);
    }

    return {
      bodyY, headY, leftLegX, leftLegY, rightLegX, rightLegY,
      frontArmX, frontArmY, backArmX, backArmY, weaponX, weaponY, weaponSwing, capeSway,
    };
  }

  // 生成单个槽位在指定方向与动作帧的索引像素网格
  function rasterizeSlot(slotId, partId, dir, pose, options) {
    const g = createGrid();
    if (!partId || partId === 'none') return g;

    const isSide = Math.abs(dir.side) === 2;
    const isBack = dir.facingBack;
    const bodyW = isSide ? 8 : 10;
    const bodyX = isSide ? 12 : 11;
    const by = pose.bodyY;
    const hy = pose.headY;

    switch (slotId) {
      case 'shadow': {
        rect(g, 9, 28, 14, 3, 17);
        rect(g, 11, 27, 10, 1, 17);
        rect(g, 11, 31, 10, 1, 17);
        break;
      }

      case 'back_cape': {
        const sw = pose.capeSway;
        if (partId === 'short_cape') {
          outlinedRect(g, bodyX - 2 + sw, 14 + by, bodyW + 4, 8, 1, 2, 3, 4);
          rect(g, bodyX - 1 + sw, 20 + by, bodyW + 2, 1, 7);
        } else if (partId === 'long_cloak') {
          outlinedRect(g, bodyX - 3 + sw, 14 + by, bodyW + 6, 13, 1, 2, 3, 4);
          rect(g, bodyX - 2 + sw, 25 + by, bodyW + 4, 1, 7);
        } else if (partId === 'scarf') {
          outlinedRect(g, bodyX - 1, 13 + by, bodyW + 2, 3, 1, 2, 3, 4);
          outlinedRect(g, bodyX - 4 + sw, 15 + by, 5, 6, 1, 2, 3, 4);
          px(g, bodyX - 3 + sw, 20 + by, 7);
        }
        break;
      }

      case 'back_prop': {
        if (partId === 'quiver') {
          outlinedRect(g, bodyX + bodyW - 3, 10 + by, 4, 11, 1, 2, 3, 4);
          px(g, bodyX + bodyW - 2, 9 + by, 18);
          px(g, bodyX + bodyW, 9 + by, 18);
        } else if (partId === 'backpack') {
          outlinedRect(g, isSide ? 8 : 10, 14 + by, isSide ? 5 : 12, 8, 1, 2, 3, 4);
          rect(g, isSide ? 9 : 12, 16 + by, isSide ? 3 : 8, 2, 7);
        } else if (partId === 'wings') {
          // 左右羽翼
          outlinedRect(g, 4, 11 + by, 7, 9, 1, 2, 3, 4);
          outlinedRect(g, 21, 11 + by, 7, 9, 1, 2, 3, 4);
          rect(g, 5, 13 + by, 5, 2, 18);
          rect(g, 22, 13 + by, 5, 2, 18);
        }
        break;
      }

      case 'body_base': {
        // 素体躯干 + 双腿（使用肤色阶 9..12）
        outlinedRect(g, bodyX, 14 + by, bodyW, 9, 9, 10, 11, 12);
        // 脖子
        rect(g, 14, 12 + by, 4, 2, 10);
        // 左腿与右腿
        const lx = isSide ? 13 + pose.leftLegX : 11 + pose.leftLegX;
        const rx = isSide ? 15 + pose.rightLegX : 17 + pose.rightLegX;
        outlinedRect(g, lx, 22 + pose.leftLegY, 4, 7, 9, 10, 11, 12);
        outlinedRect(g, rx, 22 + pose.rightLegY, 4, 7, 9, 10, 11, 12);
        break;
      }

      case 'legs_bottom': {
        const lx = isSide ? 13 + pose.leftLegX : 11 + pose.leftLegX;
        const rx = isSide ? 15 + pose.rightLegX : 17 + pose.rightLegX;
        if (partId === 'pants') {
          outlinedRect(g, bodyX, 21 + by, bodyW, 3, 1, 2, 3, 4);
          outlinedRect(g, lx, 22 + pose.leftLegY, 4, 5, 1, 2, 3, 4);
          outlinedRect(g, rx, 22 + pose.rightLegY, 4, 5, 1, 2, 3, 4);
        } else if (partId === 'greaves') {
          outlinedRect(g, bodyX, 21 + by, bodyW, 3, 1, 2, 3, 4);
          outlinedRect(g, lx, 22 + pose.leftLegY, 4, 6, 1, 2, 3, 4);
          outlinedRect(g, rx, 22 + pose.rightLegY, 4, 6, 1, 2, 3, 4);
          px(g, lx + 1, 24 + pose.leftLegY, 8);
          px(g, rx + 1, 24 + pose.rightLegY, 8);
        } else if (partId === 'robe_skirt') {
          outlinedRect(g, bodyX - 1, 21 + by, bodyW + 2, 7, 1, 2, 3, 4);
          rect(g, bodyX, 26 + by, bodyW, 1, 7);
        }
        break;
      }

      case 'feet_shoes': {
        const lx = isSide ? 13 + pose.leftLegX : 11 + pose.leftLegX;
        const rx = isSide ? 15 + pose.rightLegX : 17 + pose.rightLegX;
        if (partId === 'boots') {
          outlinedRect(g, lx, 26 + pose.leftLegY, 4, 3, 1, 2, 3, 4);
          outlinedRect(g, rx, 26 + pose.rightLegY, 4, 3, 1, 2, 3, 4);
        } else if (partId === 'sabaton') {
          outlinedRect(g, lx, 25 + pose.leftLegY, 4, 4, 1, 2, 3, 4);
          outlinedRect(g, rx, 25 + pose.rightLegY, 4, 4, 1, 2, 3, 4);
          px(g, lx + 1, 26 + pose.leftLegY, 8);
          px(g, rx + 1, 26 + pose.rightLegY, 8);
        } else if (partId === 'sandals') {
          rect(g, lx, 28 + pose.leftLegY, 4, 1, 1);
          rect(g, rx, 28 + pose.rightLegY, 4, 1, 1);
          rect(g, lx + 1, 27 + pose.leftLegY, 2, 1, 7);
          rect(g, rx + 1, 27 + pose.rightLegY, 2, 1, 7);
        }
        break;
      }

      case 'torso_top': {
        if (partId === 'tunic') {
          outlinedRect(g, bodyX, 14 + by, bodyW, 8, 1, 2, 3, 4);
          rect(g, bodyX + Math.floor(bodyW / 2) - 1, 14 + by, 2, 3, 7);
        } else if (partId === 'plate') {
          outlinedRect(g, bodyX - 1, 14 + by, bodyW + 2, 8, 1, 2, 3, 4);
          rect(g, bodyX + 1, 16 + by, bodyW - 2, 2, 8);
          rect(g, bodyX + Math.floor(bodyW / 2) - 1, 15 + by, 2, 5, 7);
        } else if (partId === 'robe') {
          outlinedRect(g, bodyX, 14 + by, bodyW, 9, 1, 2, 3, 4);
          rect(g, bodyX + Math.floor(bodyW / 2) - 1, 14 + by, 2, 8, 7);
        } else if (partId === 'vest') {
          outlinedRect(g, bodyX, 14 + by, bodyW, 8, 1, 2, 3, 4);
          rect(g, bodyX + 2, 15 + by, bodyW - 4, 6, 7);
        }
        break;
      }

      case 'belt_waist': {
        if (partId === 'leather_belt') {
          rect(g, bodyX, 20 + by, bodyW, 2, 1);
          rect(g, bodyX + 1, 20 + by, bodyW - 2, 2, 3);
          rect(g, 15, 20 + by, 2, 2, 8);
        } else if (partId === 'sash') {
          rect(g, bodyX, 20 + by, bodyW, 2, 3);
          rect(g, bodyX + 1, 21 + by, 2, 3, 4);
        } else if (partId === 'gold_belt') {
          rect(g, bodyX, 20 + by, bodyW, 2, 5);
          rect(g, bodyX + 1, 20 + by, bodyW - 2, 2, 7);
          rect(g, 15, 19 + by, 2, 3, 8);
        }
        break;
      }

      case 'back_arm':
      case 'front_arm': {
        const isFront = slotId === 'front_arm';
        const ax = isFront
          ? (isSide ? 15 : bodyX + bodyW - 1) + pose.frontArmX
          : (isSide ? 12 : bodyX - 3) + pose.backArmX;
        const ay = 14 + (isFront ? pose.frontArmY : pose.backArmY);

        // 关键：手部颜色通道（演示「手没跟着变色」的坑与修复）
        // 正常修复：手部使用肤色通道 9..12（会随肤色 LUT 自动同步）
        // 坑模式 baked_wood：美术把原木色写死在手部（通过特殊标记在渲染阶段强制走原木色）
        // 坑模式 dyed_sleeve：美术把手画在袖子图层里，换衣服颜色时手也跟着染成衣服色 1..4
        const handBug = options && options.handColorBugMode ? options.handColorBugMode : 'none';
        const handOutline = handBug === 'dyed_sleeve' ? 1 : 9;
        const handDark    = handBug === 'dyed_sleeve' ? 2 : 10;
        const handBase    = handBug === 'dyed_sleeve' ? 3 : 11;
        const handLight   = handBug === 'dyed_sleeve' ? 4 : 12;

        if (partId === 'bare') {
          outlinedRect(g, ax, ay, 4, 5, handOutline, handDark, handBase, handLight);
          outlinedRect(g, ax, ay + 4, 4, 3, handOutline, handDark, handBase, handLight);
        } else if (partId === 'long_sleeve') {
          outlinedRect(g, ax, ay, 4, 5, 1, 2, 3, 4);
          // 露出手掌 4×3
          outlinedRect(g, ax, ay + 4, 4, 3, handOutline, handDark, handBase, handLight);
        } else if (partId === 'armor_sleeve') {
          outlinedRect(g, ax, ay, 4, 5, 1, 2, 3, 4);
          px(g, ax + 1, ay + 1, 8);
          // 露指护手（手掌部分）
          outlinedRect(g, ax, ay + 4, 4, 3, handOutline, handDark, handBase, handLight);
        }
        break;
      }

      case 'head_base': {
        outlinedRect(g, 11, 5 + hy, 10, 8, 9, 10, 11, 12);
        break;
      }

      case 'face_eyes': {
        if (isBack) break;
        const ex = isSide ? 16 : 13;
        const ex2 = isSide ? 19 : 18;
        if (partId === 'dot') {
          rect(g, ex, 8 + hy, 1, 2, 19);
          if (!isSide) rect(g, ex2, 8 + hy, 1, 2, 19);
        } else if (partId === 'sharp') {
          rect(g, ex - 1, 8 + hy, 2, 1, 19);
          px(g, ex, 9 + hy, 19);
          if (!isSide) {
            rect(g, ex2, 8 + hy, 2, 1, 19);
            px(g, ex2, 9 + hy, 19);
          }
        } else if (partId === 'visor_glow') {
          rect(g, ex, 8 + hy, 2, 2, 18);
          if (!isSide) rect(g, ex2 - 1, 8 + hy, 2, 2, 18);
        } else if (partId === 'glasses') {
          rect(g, ex - 1, 8 + hy, 3, 2, 13);
          px(g, ex, 8 + hy, 18);
          if (!isSide) {
            rect(g, ex + 2, 8 + hy, 2, 1, 13);
            rect(g, ex2 - 1, 8 + hy, 3, 2, 13);
            px(g, ex2, 8 + hy, 18);
          }
        }
        break;
      }

      case 'face_beard': {
        if (isBack) break;
        if (partId === 'goatee') {
          rect(g, 15, 11 + hy, 3, 2, 2);
          px(g, 16, 13 + hy, 1);
        } else if (partId === 'full_beard') {
          outlinedRect(g, 12, 10 + hy, 8, 5, 1, 2, 3, 4);
        } else if (partId === 'mask') {
          outlinedRect(g, 11, 10 + hy, 10, 3, 1, 2, 3, 4);
        }
        break;
      }

      case 'hair_style': {
        if (partId === 'short') {
          outlinedRect(g, 10, 4 + hy, 12, 4, 1, 2, 3, 4);
          if (isBack) outlinedRect(g, 11, 6 + hy, 10, 6, 1, 2, 3, 4);
        } else if (partId === 'spiky') {
          outlinedRect(g, 10, 4 + hy, 12, 4, 1, 2, 3, 4);
          rect(g, 11, 2 + hy, 2, 2, 3);
          rect(g, 15, 1 + hy, 2, 3, 4);
          rect(g, 19, 2 + hy, 2, 2, 3);
          if (isBack) outlinedRect(g, 11, 6 + hy, 10, 6, 1, 2, 3, 4);
        } else if (partId === 'long') {
          outlinedRect(g, 10, 4 + hy, 12, 4, 1, 2, 3, 4);
          outlinedRect(g, 9, 6 + hy, 3, 10, 1, 2, 3, 4);
          outlinedRect(g, 20, 6 + hy, 3, 10, 1, 2, 3, 4);
          if (isBack) outlinedRect(g, 10, 6 + hy, 12, 10, 1, 2, 3, 4);
        } else if (partId === 'ponytail') {
          outlinedRect(g, 10, 4 + hy, 12, 4, 1, 2, 3, 4);
          outlinedRect(g, isSide ? 7 : 18, 5 + hy, 4, 9, 1, 2, 3, 4);
          if (isBack) outlinedRect(g, 11, 6 + hy, 10, 6, 1, 2, 3, 4);
        } else if (partId === 'bun') {
          outlinedRect(g, 10, 4 + hy, 12, 4, 1, 2, 3, 4);
          outlinedRect(g, 13, 1 + hy, 6, 4, 1, 2, 3, 4);
          rect(g, 13, 4 + hy, 6, 1, 7);
        }
        break;
      }

      case 'head_hat': {
        if (partId === 'knight_helm') {
          outlinedRect(g, 10, 3 + hy, 12, 7, 1, 2, 3, 4);
          rect(g, 14, 1 + hy, 4, 2, 7);
          if (!isBack) rect(g, 12, 8 + hy, 8, 1, 13);
        } else if (partId === 'wizard_hat') {
          outlinedRect(g, 8, 5 + hy, 16, 2, 1, 2, 3, 4);
          outlinedRect(g, 11, 3 + hy, 10, 3, 1, 2, 3, 4);
          outlinedRect(g, 13, 1 + hy, 6, 3, 1, 2, 3, 4);
          rect(g, 11, 5 + hy, 10, 1, 7);
        } else if (partId === 'hood') {
          outlinedRect(g, 9, 3 + hy, 14, 10, 1, 2, 3, 4);
          if (!isBack) rect(g, 12, 7 + hy, 8, 5, 0);
        } else if (partId === 'pirate_hat') {
          outlinedRect(g, 7, 4 + hy, 18, 3, 1, 2, 3, 4);
          outlinedRect(g, 11, 2 + hy, 10, 3, 1, 2, 3, 4);
          rect(g, 15, 3 + hy, 2, 2, 18);
        } else if (partId === 'crown') {
          rect(g, 11, 4 + hy, 10, 2, 7);
          rect(g, 11, 2 + hy, 2, 2, 8);
          rect(g, 15, 1 + hy, 2, 3, 8);
          rect(g, 19, 2 + hy, 2, 2, 8);
          px(g, 15, 4 + hy, 3);
        } else if (partId === 'bandana') {
          outlinedRect(g, 10, 4 + hy, 12, 3, 1, 2, 3, 4);
          rect(g, 21, 5 + hy, 3, 3, 3);
        }
        break;
      }

      case 'main_hand': {
        const wx = (isSide ? 18 : 21) + pose.weaponX;
        const wy = 16 + pose.weaponY;
        const swing = pose.weaponSwing;
        if (partId === 'sword') {
          if (swing === 1) {
            rect(g, wx, wy + 1, 8, 2, 15);
            rect(g, wx, wy + 1, 8, 1, 16);
            rect(g, wx - 1, wy, 2, 4, 7);
          } else {
            rect(g, wx + 1, wy - 8, 2, 10, 15);
            rect(g, wx + 1, wy - 8, 1, 10, 16);
            rect(g, wx - 1, wy + 1, 6, 2, 7);
            rect(g, wx + 1, wy + 3, 2, 2, 2);
          }
        } else if (partId === 'staff') {
          rect(g, wx + 1, wy - 9, 2, 16, 2);
          outlinedRect(g, wx, wy - 11, 4, 4, 1, 2, 3, 4);
          px(g, wx + 1, wy - 10, 18);
        } else if (partId === 'bow') {
          rect(g, wx + 1, wy - 5, 2, 11, 2);
          px(g, wx, wy - 4, 3);
          px(g, wx, wy + 4, 3);
          rect(g, wx - 1, wy - 4, 1, 9, 18);
        } else if (partId === 'axe') {
          rect(g, wx + 1, wy - 6, 2, 11, 2);
          outlinedRect(g, wx + 2, wy - 6, 5, 5, 13, 14, 15, 16);
        } else if (partId === 'dagger') {
          rect(g, wx + 1, wy - 3, 2, 5, 15);
          rect(g, wx, wy + 1, 4, 1, 7);
        } else if (partId === 'hammer') {
          rect(g, wx + 1, wy - 6, 2, 11, 2);
          outlinedRect(g, wx - 1, wy - 7, 6, 4, 13, 14, 15, 16);
        }
        break;
      }

      case 'off_hand': {
        const ox = (isSide ? 11 : 7) + pose.backArmX;
        const oy = 17 + pose.backArmY;
        if (partId === 'shield') {
          outlinedRect(g, ox - 1, oy - 1, 6, 7, 1, 2, 3, 4);
          rect(g, ox + 1, oy + 1, 2, 3, 8);
        } else if (partId === 'book') {
          outlinedRect(g, ox, oy, 5, 6, 1, 2, 3, 4);
          rect(g, ox + 1, oy + 1, 1, 4, 18);
        } else if (partId === 'lantern') {
          rect(g, ox + 1, oy - 1, 2, 1, 13);
          outlinedRect(g, ox, oy, 4, 5, 13, 14, 7, 8);
          rect(g, ox + 1, oy + 1, 2, 3, 18);
        } else if (partId === 'dagger_off') {
          rect(g, ox + 1, oy - 2, 2, 5, 15);
          rect(g, ox, oy + 2, 4, 1, 7);
        }
        break;
      }
    }

    return g;
  }

  // 解析索引色到实际 Hex 颜色（LUT 映射核心）
  function resolvePaletteColor(colorIndex, slotId, paletteObj, skinObj, handColorBugMode) {
    if (colorIndex === 0) return null;
    if (colorIndex >= 1 && colorIndex <= 4) return paletteObj.primary[colorIndex - 1];
    if (colorIndex >= 5 && colorIndex <= 8) return paletteObj.secondary[colorIndex - 5];
    if (colorIndex >= 9 && colorIndex <= 12) {
      // 复现「手没跟着变色」的坑：手臂槽位被写死成原木色，不跟角色肤色走
      if ((slotId === 'front_arm' || slotId === 'back_arm') && handColorBugMode === 'baked_wood') {
        return SKINS.wood.ramp[colorIndex - 9];
      }
      return skinObj.ramp[colorIndex - 9];
    }
    if (colorIndex >= 13 && colorIndex <= 16) return METAL_RAMP[colorIndex - 13];
    if (colorIndex === 17) return 'rgba(15, 23, 42, 0.28)';
    if (colorIndex === 18) return '#ffffff';
    if (colorIndex === 19) return '#111827';
    return null;
  }

  // =========================================================================
  // 5. 核心类：PaperDollCharacter
  // =========================================================================

  class PaperDollCharacter {
    constructor(config = {}) {
      this.skin = config.skin || 'wood';
      this.direction = config.direction || 'S';
      this.action = config.action || 'idle';
      this.handColorBugMode = config.handColorBugMode || 'none'; // 'none' | 'baked_wood' | 'dyed_sleeve'
      this.slots = {};
      this.palettes = {};
      this.hiddenSlots = new Set();

      // 默认从木头人素体初始化
      for (const s of SLOTS) {
        this.slots[s.id] = MANNEQUIN_PRESET.slots[s.id];
        this.palettes[s.id] = MANNEQUIN_PRESET.palettes[s.id] || 'cobalt';
      }

      if (config.preset) {
        this.applyPreset(config.preset);
      }
      if (config.slots) {
        Object.assign(this.slots, config.slots);
      }
      if (config.palettes) {
        Object.assign(this.palettes, config.palettes);
      }
    }

    setSlot(slotId, partId) {
      if (!PARTS[slotId]) throw new Error(`Unknown slot: ${slotId}`);
      const valid = PARTS[slotId].some(p => p.id === partId);
      if (!valid) throw new Error(`Unknown part "${partId}" for slot "${slotId}"`);
      this.slots[slotId] = partId;
      return this;
    }

    setPalette(slotId, paletteId) {
      if (!PALETTES[paletteId]) throw new Error(`Unknown palette: ${paletteId}`);
      this.palettes[slotId] = paletteId;
      return this;
    }

    setAllClothingPalette(paletteId) {
      if (!PALETTES[paletteId]) throw new Error(`Unknown palette: ${paletteId}`);
      const targets = ['back_cape', 'legs_bottom', 'feet_shoes', 'torso_top', 'belt_waist', 'back_arm', 'front_arm', 'head_hat'];
      for (const id of targets) {
        this.palettes[id] = paletteId;
      }
      return this;
    }

    setSkin(skinId) {
      if (!SKINS[skinId]) throw new Error(`Unknown skin: ${skinId}`);
      this.skin = skinId;
      return this;
    }

    setDirection(directionId) {
      if (!DIRECTIONS.some(d => d.id === directionId)) {
        throw new Error(`Unknown direction: ${directionId}`);
      }
      this.direction = directionId;
      return this;
    }

    setAction(actionId) {
      if (!ACTIONS.some(a => a.id === actionId)) {
        throw new Error(`Unknown action: ${actionId}`);
      }
      this.action = actionId;
      return this;
    }

    setHandColorBugMode(mode) {
      const valid = ['none', 'baked_wood', 'dyed_sleeve'];
      if (!valid.includes(mode)) throw new Error(`Invalid handColorBugMode: ${mode}`);
      this.handColorBugMode = mode;
      return this;
    }

    setSlotVisible(slotId, visible) {
      if (visible) this.hiddenSlots.delete(slotId);
      else this.hiddenSlots.add(slotId);
      return this;
    }

    applyPreset(presetId) {
      const preset = presetId === 'mannequin'
        ? MANNEQUIN_PRESET
        : PRESETS_16.find(p => p.id === presetId);
      if (!preset) throw new Error(`Unknown preset: ${presetId}`);

      this.skin = preset.skin || 'wood';
      for (const s of SLOTS) {
        this.slots[s.id] = (preset.slots && preset.slots[s.id] !== undefined)
          ? preset.slots[s.id]
          : MANNEQUIN_PRESET.slots[s.id];
        this.palettes[s.id] = (preset.palettes && preset.palettes[s.id] !== undefined)
          ? preset.palettes[s.id]
          : (MANNEQUIN_PRESET.palettes[s.id] || 'cobalt');
      }
      return this;
    }

    randomize(rng = Math.random) {
      const pick = arr => arr[Math.floor(rng() * arr.length)];
      const skinKeys = Object.keys(SKINS).filter(k => k !== 'wood');
      const palKeys = Object.keys(PALETTES);
      this.skin = pick(skinKeys);
      const mainPal = pick(palKeys);
      const accentPal = pick(palKeys);

      for (const s of SLOTS) {
        const list = PARTS[s.id];
        if (s.required) {
          this.slots[s.id] = pick(list).id;
        } else {
          this.slots[s.id] = pick(list).id;
        }
        this.palettes[s.id] = rng() < 0.65 ? mainPal : accentPal;
      }
      // 同步双臂袖子样式与颜色
      this.slots.back_arm = this.slots.front_arm;
      this.palettes.back_arm = this.palettes.front_arm;
      return this;
    }

    getActiveLayerCount() {
      let count = 0;
      for (const s of SLOTS) {
        if (!this.hiddenSlots.has(s.id) && this.slots[s.id] && this.slots[s.id] !== 'none') {
          count++;
        }
      }
      return count;
    }

    getFrameIndex(timeMs = 0) {
      const act = ACTIONS.find(a => a.id === this.action) || ACTIONS[0];
      return Math.floor((timeMs / 1000) * act.fps) % act.frames;
    }

    /**
     * 合成当前帧所有可见层（返回供 Canvas 渲染或测试断言的图层列表）
     */
    composeFrame(frameIndex = 0) {
      const dir = DIRECTIONS.find(d => d.id === this.direction) || DIRECTIONS[0];
      const pose = computePose(this.action, frameIndex, dir);
      const order = getRenderOrder(this.direction);
      const skinObj = SKINS[this.skin] || SKINS.wood;
      const layers = [];

      for (const slotId of order) {
        if (this.hiddenSlots.has(slotId)) continue;
        const partId = this.slots[slotId];
        if (!partId || partId === 'none') continue;
        const paletteObj = PALETTES[this.palettes[slotId]] || PALETTES.cobalt;
        const grid = rasterizeSlot(slotId, partId, dir, pose, {
          handColorBugMode: this.handColorBugMode,
        });
        layers.push({ slotId, partId, paletteObj, skinObj, grid });
      }
      return { dir, pose, layers };
    }

    /**
     * 渲染到 Canvas 2D 上下文
     */
    render(ctx, x, y, scale = 6, timeMs = 0, opts = {}) {
      const frameIndex = typeof opts.frameIndex === 'number'
        ? opts.frameIndex
        : this.getFrameIndex(timeMs);
      const { dir, layers } = this.composeFrame(frameIndex);
      const explodeSpread = opts.explodeSpread || 0; // 分层爆炸展开演示用

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      layers.forEach((layer, idx) => {
        const { slotId, paletteObj, skinObj, grid } = layer;
        const offsetX = explodeSpread ? (idx - (layers.length - 1) / 2) * explodeSpread : 0;
        const originX = x + offsetX;

        for (let py = 0; py < GRID; py++) {
          for (let pxIdx = 0; pxIdx < GRID; pxIdx++) {
            const cIdx = grid[py * GRID + pxIdx];
            if (cIdx === 0) continue;
            const color = resolvePaletteColor(cIdx, slotId, paletteObj, skinObj, this.handColorBugMode);
            if (!color) continue;
            const drawX = dir.flipX ? (GRID - 1 - pxIdx) : pxIdx;
            ctx.fillStyle = color;
            ctx.fillRect(
              Math.floor(originX + drawX * scale),
              Math.floor(y + py * scale),
              Math.ceil(scale),
              Math.ceil(scale)
            );
          }
        }
      });

      ctx.restore();
    }

    toJSON() {
      return {
        version: '1.0.0',
        skin: this.skin,
        direction: this.direction,
        action: this.action,
        handColorBugMode: this.handColorBugMode,
        slots: { ...this.slots },
        palettes: { ...this.palettes },
      };
    }

    static fromJSON(data) {
      return new PaperDollCharacter(data);
    }
  }

  return {
    VERSION: '1.0.0',
    GRID,
    SLOTS,
    DIRECTIONS,
    ACTIONS,
    PALETTES,
    SKINS,
    PARTS,
    MANNEQUIN_PRESET,
    PRESETS_16,
    getRenderOrder,
    resolvePaletteColor,
    PaperDollCharacter,
  };
});
