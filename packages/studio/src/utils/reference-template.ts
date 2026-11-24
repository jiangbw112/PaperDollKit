import {
  STANDARD_17_SLOTS,
  type DirectionId,
  type SlotId,
} from '@paperdollkit/core';

const SOCKET_GUIDE_POSITIONS: Record<string, { x: number; y: number }> = {
  head_top: { x: 0.5, y: 0.2 },
  shoulder_l: { x: 0.4, y: 0.51 },
  shoulder_r: { x: 0.6, y: 0.51 },
  hand_main: { x: 0.69, y: 0.67 },
  hand_off: { x: 0.31, y: 0.67 },
  waist: { x: 0.5, y: 0.68 },
  back_center: { x: 0.5, y: 0.58 },
};

const SLOT_GUIDE_COORDS: Record<SlotId, { x: number; y: number; color: string }> = {
  shadow: { x: 128, y: 226, color: '#64748b' },
  back_cloak: { x: 128, y: 158, color: '#6366f1' },
  back_hair: { x: 128, y: 82, color: '#8b5cf6' },
  back_arm: { x: 96, y: 154, color: '#0ea5e9' },
  offhand: { x: 84, y: 174, color: '#06b6d4' },
  body_base: { x: 128, y: 152, color: '#f59e0b' },
  legs_bottom: { x: 128, y: 196, color: '#10b981' },
  boots: { x: 128, y: 214, color: '#14b8a6' },
  torso_top: { x: 128, y: 148, color: '#3b82f6' },
  belt_waist: { x: 128, y: 174, color: '#eab308' },
  head_base: { x: 128, y: 86, color: '#fb923c' },
  face: { x: 132, y: 92, color: '#f43f5e' },
  front_hair: { x: 128, y: 64, color: '#a855f7' },
  helmet_hat: { x: 128, y: 50, color: '#ec4899' },
  shoulder: { x: 112, y: 132, color: '#22d3ee' },
  front_arm: { x: 158, y: 158, color: '#38bdf8' },
  mainhand: { x: 178, y: 172, color: '#ef4444' },
};

/**
 * Generates a 256×256 AI-friendly equipment painting & generation reference template PNG
 * containing a subtle chibi mannequin silhouette, 17-slot anchor crosshairs, foot-origin
 * baseline (y=224), and labeled attachment sockets (`hand_main`, `head_top`, `shoulder`, etc.).
 */
export function renderEquipmentReferenceTemplate(
  canvasSize: { width: number; height: number } = { width: 256, height: 256 },
  direction: DirectionId = 'SE',
): HTMLCanvasElement {
  const w = canvasSize.width;
  const h = canvasSize.height;
  const sx = w / 256;
  const sy = h / 256;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D context for reference template.');

  // Subtle dark-neutral checkerboard background for ControlNet / img2img clarity
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += Math.round(32 * sx)) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += Math.round(32 * sy)) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  // Center vertical symmetry axis & foot-origin baseline
  const footY = 224 * sy;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
  ctx.beginPath();
  ctx.moveTo(0, footY);
  ctx.lineTo(w, footY);
  ctx.stroke();
  ctx.restore();

  // Chibi mannequin silhouette (semi-transparent)
  ctx.save();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
  ctx.lineWidth = 1.5;

  // Ground shadow oval
  ctx.beginPath();
  ctx.ellipse(128 * sx, 224 * sy, 34 * sx, 11 * sy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head oval
  ctx.beginPath();
  ctx.ellipse(128 * sx, 88 * sy, 34 * sx, 32 * sy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Torso capsule
  ctx.beginPath();
  ctx.roundRect(102 * sx, 122 * sy, 52 * sx, 54 * sy, 14 * sx);
  ctx.fill();
  ctx.stroke();

  // Arms
  ctx.beginPath();
  ctx.roundRect(84 * sx, 130 * sy, 16 * sx, 44 * sy, 8 * sx);
  ctx.roundRect(156 * sx, 130 * sy, 16 * sx, 44 * sy, 8 * sx);
  ctx.fill();
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.roundRect(106 * sx, 174 * sy, 18 * sx, 48 * sy, 7 * sx);
  ctx.roundRect(132 * sx, 174 * sy, 18 * sx, 48 * sy, 7 * sx);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 17-slot crosshairs
  ctx.font = '8px monospace';
  for (const slot of STANDARD_17_SLOTS) {
    const pt = SLOT_GUIDE_COORDS[slot.id];
    if (!pt) continue;
    const px = pt.x * sx;
    const py = pt.y * sy;
    ctx.strokeStyle = pt.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 4, py);
    ctx.lineTo(px + 4, py);
    ctx.moveTo(px, py - 4);
    ctx.lineTo(px, py + 4);
    ctx.stroke();
  }

  // Named socket markers (hand_main, hand_off, head_top, back_center, waist, shoulder_l/r)
  const flipX = direction === 'SW' || direction === 'W' || direction === 'NW';
  for (const [socketName, pos] of Object.entries(SOCKET_GUIDE_POSITIONS)) {
    const px = (flipX ? 1 - pos.x : pos.x) * w;
    const py = pos.y * h;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.fillText(socketName, px + 5, py + 3);
  }

  // Header & Footer labels
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(`PaperDollKit ${w}x${h} AI Ref (${direction})`, 8, 14);
  ctx.fillStyle = '#fda4af';
  ctx.font = '9px monospace';
  ctx.fillText('FOOT ORIGIN y=224 (0.5, 0.875)', 8, footY - 4);

  return canvas;
}

export function downloadEquipmentReferenceTemplate(
  canvasSize: { width: number; height: number } = { width: 256, height: 256 },
  direction: DirectionId = 'SE',
): void {
  const canvas = renderEquipmentReferenceTemplate(canvasSize, direction);
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `paperdollkit-reference-${direction}-${canvasSize.width}x${canvasSize.height}.png`;
  a.click();
}
