'use client';

/**
 * Gambar prosedural (Canvas API saja, tanpa file aset eksternal).
 * Dipakai bersama oleh GameCanvas (single-player) dan MultiplayerGameCanvas.
 *
 * - drawArena      : langit malam + skyline + penonton + lantai perspektif + dinding merah
 * - drawFighter    : figur berbentuk tubuh (kepala, badan, tangan, kaki) yang beranimasi
 *                    (jalan, napas, condong saat dash, pukulan, kuda-kuda, kilat saat kena hit)
 * - drawDashTrail  : jejak bayangan saat dash
 */
import { GAME_CONFIG } from './gameConfig';
import type { Entity } from './gameLogic';

interface Palette {
  shirt: string;
  shirtDark: string;
  pants: string;
  pantsDark: string;
  skin: string;
  skinDark: string;
  hair: string;
  accent: string;
  aura: string; // rgb tanpa alpha
}

const PLAYER_PALETTE: Palette = {
  shirt: '#3b82f6',
  shirtDark: '#1e40af',
  pants: '#1e293b',
  pantsDark: '#0f172a',
  skin: '#f1c27d',
  skinDark: '#d9a05b',
  hair: '#1f2937',
  accent: '#fbbf24',
  aura: '59,130,246',
};

const TARGET_PALETTE: Palette = {
  shirt: '#ef4444',
  shirtDark: '#991b1b',
  pants: '#3f1d1d',
  pantsDark: '#1c0a0a',
  skin: '#e0a673',
  skinDark: '#c0834f',
  hair: '#111111',
  accent: '#f8fafc',
  aura: '239,68,68',
};

const OUTLINE = '#07070f';
const SHOE = '#111827';

// ---------- util ----------

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/** Pseudo-random deterministik (0..1) supaya pola skyline/penonton tetap sama tiap frame */
function seeded(a: number, b: number) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Garis tebal dengan outline gelap (gaya kartun) */
function limb(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  width: number, color: string
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 2.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// ---------- ARENA ----------

let bgCache: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Latar statis (langit, bintang, skyline, lantai) — dirender sekali lalu di-cache */
function buildStaticBackground(W: number, H: number, floorY: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return c;

  // Langit malam -> ungu
  const sky = g.createLinearGradient(0, 0, 0, floorY);
  sky.addColorStop(0, '#070a1f');
  sky.addColorStop(0.6, '#1b1140');
  sky.addColorStop(1, '#43175f');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, floorY);

  // Bintang
  for (let i = 0; i < 70; i++) {
    const s = seeded(i, 7) > 0.85 ? 2 : 1;
    g.fillStyle = `rgba(255,255,255,${(0.25 + seeded(i, 9) * 0.6).toFixed(2)})`;
    g.fillRect(seeded(i, 1) * W, seeded(i, 2) * floorY * 0.5, s, s);
  }

  // Cahaya horizon
  const glow = g.createRadialGradient(W / 2, floorY, 10, W / 2, floorY, 460);
  glow.addColorStop(0, 'rgba(244,114,182,0.5)');
  glow.addColorStop(1, 'rgba(244,114,182,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, floorY);

  // Skyline gedung + jendela
  let x = -10;
  let i = 0;
  while (x < W + 10) {
    const bw = 44 + seeded(i, 3) * 64;
    const bh = 70 + seeded(i, 4) * 150;
    g.fillStyle = '#120a2c';
    g.fillRect(x, floorY - bh, bw, bh);
    for (let wy = floorY - bh + 8; wy < floorY - 10; wy += 12) {
      for (let wx = x + 6; wx < x + bw - 8; wx += 10) {
        const r = seeded(wx * 3 + wy * 5, i + 11);
        if (r > 0.7) {
          g.fillStyle = r > 0.85 ? 'rgba(253,224,71,0.55)' : 'rgba(125,211,252,0.4)';
          g.fillRect(wx, wy, 4, 5);
        }
      }
    }
    x += bw + 4 + seeded(i, 6) * 10;
    i++;
  }

  // Lantai
  const floor = g.createLinearGradient(0, floorY, 0, H);
  floor.addColorStop(0, '#1e1b4b');
  floor.addColorStop(1, '#07061a');
  g.fillStyle = floor;
  g.fillRect(0, floorY, W, H - floorY);

  // Grid perspektif (hanya di area lantai)
  g.save();
  g.beginPath();
  g.rect(0, floorY, W, H - floorY);
  g.clip();
  const vpX = W / 2;
  const vpY = floorY - 140;
  g.strokeStyle = 'rgba(129,140,248,0.22)';
  g.lineWidth = 1;
  for (let k = -12; k <= 12; k++) {
    g.beginPath();
    g.moveTo(vpX, vpY);
    g.lineTo(W / 2 + k * 110, H);
    g.stroke();
  }
  for (let k = 1; k <= 8; k++) {
    const y = floorY + (H - floorY) * Math.pow(k / 8, 2);
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.restore();

  // Tepi lantai bercahaya
  g.save();
  g.shadowBlur = 14;
  g.shadowColor = '#818cf8';
  g.strokeStyle = '#818cf8';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, floorY);
  g.lineTo(W, floorY);
  g.stroke();
  g.restore();

  return c;
}

function getStaticBackground(W: number, H: number, floorY: number) {
  const key = `${W}x${H}x${floorY}`;
  if (!bgCache || bgCache.key !== key) {
    bgCache = { key, canvas: buildStaticBackground(W, H, floorY) };
  }
  return bgCache.canvas;
}

function drawWallZone(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number, H: number, offset: number
) {
  if (x1 - x0 <= 0) return;
  ctx.fillStyle = 'rgba(233,69,96,0.32)';
  ctx.fillRect(x0, 0, x1 - x0, H);

  // Garis miring (hatch) bergerak — memberi kesan dinding "berbahaya"
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, x1 - x0, H);
  ctx.clip();
  ctx.strokeStyle = 'rgba(233,69,96,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = x0 - H + offset; k < x1; k += 14) {
    ctx.moveTo(k, H);
    ctx.lineTo(k + H, 0);
  }
  ctx.stroke();
  ctx.restore();
}

/** Gambar seluruh arena (dipanggil tiap frame) */
export function drawArena(
  ctx: CanvasRenderingContext2D,
  arena: { width: number; height: number; floorY: number },
  walls: { left: number; right: number },
  timeMs: number
) {
  const W = arena.width;
  const H = arena.height;
  const floorY = arena.floorY;
  const t = timeMs / 1000;

  ctx.drawImage(getStaticBackground(W, H, floorY), 0, 0);

  // Sorot lampu bergerak
  ctx.save();
  for (let side = 0; side < 2; side++) {
    const ox = side === 0 ? 0 : W;
    const tx = W / 2 + Math.sin(t * 0.5 + side * 3) * W * 0.3;
    ctx.fillStyle = side === 0 ? 'rgba(129,140,248,0.08)' : 'rgba(244,114,182,0.08)';
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(tx - 130, floorY);
    ctx.lineTo(tx + 130, floorY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Penonton (silhouette) yang bergoyang
  for (let i = 0; i < 70; i++) {
    const x = (i / 70) * W + seeded(i, 8) * 10;
    const r = 6 + seeded(i, 9) * 4;
    const bob = Math.sin(t * 3 + i * 0.7) * (seeded(i, 10) > 0.5 ? 1.2 : 0.4);
    const cy = floorY - 10 - r + bob;
    ctx.fillStyle = '#0a0718';
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r * 1.2, cy + r * 0.8, r * 2.4, floorY - (cy + r * 0.8));
    if (seeded(i, 11) > 0.82) {
      ctx.strokeStyle = '#0a0718';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + r, cy + r);
      ctx.lineTo(x + r * 1.7, cy - r * 2.2 + bob);
      ctx.stroke();
    }
  }

  // Dinding merah yang menyempit
  drawWallZone(ctx, 0, walls.left, H, (t * 30) % 14);
  drawWallZone(ctx, walls.right, W, H, (t * 30) % 14);

  // Batas dinding (putus-putus, bercahaya)
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#e94560';
  ctx.beginPath();
  ctx.moveTo(walls.left, 0);
  ctx.lineTo(walls.left, H);
  ctx.moveTo(walls.right, 0);
  ctx.lineTo(walls.right, H);
  ctx.stroke();
  ctx.restore();

  // Garis tengah samar
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([20, 20]);
  ctx.beginPath();
  ctx.moveTo(W / 2, floorY);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.restore();
}

/** Jejak bayangan saat dash (posisi y = sisi atas kotak karakter) */
export function drawDashTrail(
  ctx: CanvasRenderingContext2D,
  trail: Array<{ x: number; y: number; alpha: number }>,
  width: number,
  height: number
) {
  for (const t of trail) {
    const a = Math.max(0, t.alpha);
    roundRectPath(ctx, t.x - width / 2, t.y, width, height, 10);
    ctx.fillStyle = `rgba(59,130,246,${(a * 0.25).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(147,197,253,${(a * 0.35).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// ---------- FIGHTER ----------

const LEG_LEN = 20;
const UPPER_ARM = 12;
const FORE_ARM = 11;

function drawLeg(
  ctx: CanvasRenderingContext2D,
  hx: number, hy: number,
  angle: number,
  thigh: string, shin: string
) {
  const kneeX = hx + Math.sin(angle) * LEG_LEN;
  const kneeY = hy + Math.cos(angle) * LEG_LEN;
  const footAng = angle * 0.5;
  const footX = kneeX + Math.sin(footAng) * LEG_LEN;
  const footY = kneeY + Math.cos(footAng) * LEG_LEN;
  limb(ctx, hx, hy, kneeX, kneeY, 9, thigh);
  limb(ctx, kneeX, kneeY, footX, footY, 8, shin);
  ctx.fillStyle = SHOE;
  ctx.beginPath();
  ctx.ellipse(footX + 3, footY, 7, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  upperAng: number, foreAng: number, foreScale: number,
  sleeve: string, skin: string
) {
  const elbowX = sx + Math.sin(upperAng) * UPPER_ARM;
  const elbowY = sy + Math.cos(upperAng) * UPPER_ARM;
  const fistX = elbowX + Math.sin(foreAng) * FORE_ARM * foreScale;
  const fistY = elbowY + Math.cos(foreAng) * FORE_ARM * foreScale;
  limb(ctx, sx, sy, elbowX, elbowY, 7.5, sleeve);
  limb(ctx, elbowX, elbowY, fistX, fistY, 6.5, skin);
  ctx.fillStyle = skin;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(fistX, fistY, 4.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Gambar satu figur petarung (dalam koordinat dunia; kaki di (e.x, e.y)).
 * Termasuk health bar & nama di atas kepala.
 */
export function drawFighter(
  ctx: CanvasRenderingContext2D,
  e: Entity,
  isPlayer: boolean,
  timeMs: number
) {
  const pal = isPlayer ? PLAYER_PALETTE : TARGET_PALETTE;
  const flash = (e.hitFlashTimer ?? 0) > 0;
  const col = {
    shirt: flash ? '#ffffff' : pal.shirt,
    shirtDark: flash ? '#d1d5db' : pal.shirtDark,
    pants: flash ? '#e5e7eb' : pal.pants,
    pantsDark: flash ? '#9ca3af' : pal.pantsDark,
    skin: flash ? '#ffffff' : pal.skin,
    skinDark: flash ? '#d1d5db' : pal.skinDark,
    hair: flash ? '#9ca3af' : pal.hair,
    accent: flash ? '#ffffff' : pal.accent,
  };

  const t = timeMs / 1000;
  const dashing = e.isDashing;
  const moving = e.isMoving && !dashing;
  const walk = moving ? Math.sin(t * 14) : 0;
  const breath = dashing ? 0 : Math.sin(t * 3.2 + (isPlayer ? 0 : 1.3)) * 1.0;
  const lean = dashing ? 0.28 : 0;
  const punchP = e.isPunching ? clamp01(e.punchTimer / GAME_CONFIG.character.punchDurationFrames) : 0;
  const ext = e.isPunching ? Math.sin(Math.PI * clamp01(1 - punchP)) : 0;

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(e.facing, 1);

  // Bayangan di lantai
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Aura momentum
  if (e.momentumTimer > 0) {
    const g = ctx.createRadialGradient(0, -48, 8, 0, -48, 72);
    g.addColorStop(0, 'rgba(251,191,36,0.45)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -48, 72, 0, Math.PI * 2);
    ctx.fill();
  }

  // Kaki (dari pinggul, tidak ikut condong)
  const hipY = -40;
  const frontLeg = dashing ? 0.9 : walk * 0.55;
  const backLeg = dashing ? -0.5 : -walk * 0.55;
  drawLeg(ctx, -3, hipY, backLeg, col.pantsDark, col.pantsDark);
  drawLeg(ctx, 3, hipY, frontLeg, col.pants, col.pantsDark);

  // Bagian atas tubuh (ikut condong saat dash)
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(lean);

  // Lengan belakang (di bawah badan)
  if (dashing) {
    drawArm(ctx, -7, -30, -1.2, -0.9, 1, col.shirtDark, col.skinDark);
  } else {
    drawArm(ctx, -7, -30 + breath, -0.3 + walk * 0.3, 2.4, 1, col.shirtDark, col.skinDark);
  }

  // Badan (trapesium dengan gradasi)
  const shoulderY = -34 + breath;
  const torso = ctx.createLinearGradient(-11, 0, 11, 0);
  torso.addColorStop(0, col.shirtDark);
  torso.addColorStop(0.5, col.shirt);
  torso.addColorStop(1, col.shirtDark);
  ctx.beginPath();
  ctx.moveTo(-7, 2);
  ctx.lineTo(7, 2);
  ctx.lineTo(11, shoulderY + 2);
  ctx.lineTo(-11, shoulderY + 2);
  ctx.closePath();
  ctx.fillStyle = torso;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ikat pinggang + gesper
  ctx.fillStyle = '#111827';
  ctx.fillRect(-8, -5, 16, 5);
  ctx.fillStyle = col.accent;
  ctx.fillRect(-2, -4, 4, 3);

  // Leher
  ctx.fillStyle = col.skinDark;
  ctx.fillRect(-3.5, shoulderY - 4, 7, 6);

  // Kepala
  const headY = -45 + breath;
  ctx.beginPath();
  ctx.arc(0, headY, 11, 0, Math.PI * 2);
  ctx.fillStyle = col.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rambut (setengah atas)
  ctx.beginPath();
  ctx.arc(0, headY, 11.5, Math.PI, Math.PI * 2);
  ctx.fillStyle = col.hair;
  ctx.fill();

  // Headband
  ctx.fillStyle = col.accent;
  ctx.fillRect(-11, headY - 5, 22, 3);

  // Mata + alis + mulut (ekspresi petarung)
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(3, headY - 0.5, 3.5, 3.5);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(2, headY - 3.5);
  ctx.lineTo(7, headY - 2.5);
  ctx.moveTo(3, headY + 5);
  ctx.lineTo(7, headY + 4);
  ctx.stroke();

  // Lengan depan (tinju / pukulan)
  if (dashing) {
    drawArm(ctx, 7, -30, -1.1, -0.9, 1, col.shirt, col.skin);
  } else if (e.isPunching) {
    drawArm(ctx, 7, -30, 1.5, 1.6 - ext * 0.1, 1 + ext * 0.6, col.shirt, col.skin);
  } else {
    drawArm(ctx, 7, -30 + breath, 1.5 - walk * 0.3, 2.2, 1, col.shirt, col.skin);
  }

  ctx.restore();
  ctx.restore();

  // Health bar, nama, stamina (koordinat dunia, tanpa flip)
  drawOverhead(ctx, e, isPlayer);
}

/** Health bar bergradasi, nama berlabel, dan stamina (pemain saja) */
function drawOverhead(ctx: CanvasRenderingContext2D, e: Entity, isPlayer: boolean) {
  const juice = GAME_CONFIG.juice;
  const H = GAME_CONFIG.character.height;

  // Nama dalam label pill
  if (juice.showName && e.name) {
    const nameY = e.y - H - juice.nameOffsetY;
    ctx.font = 'bold 11px monospace';
    const w = ctx.measureText(e.name).width + 12;
    roundRectPath(ctx, e.x - w / 2, nameY - 11, w, 15, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = isPlayer ? '#93c5fd' : '#fca5a5';
    ctx.fillText(e.name, e.x, nameY);
    ctx.textAlign = 'left';
  }

  if (!juice.showHealthBar) return;

  const barW = 60;
  const barH = 7;
  const barX = e.x - barW / 2;
  const barY = e.y - H - juice.healthBarOffsetY;

  // Latar + bingkai
  roundRectPath(ctx, barX - 2, barY - 2, barW + 4, barH + 4, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fill();

  // Isi HP (gradasi)
  const pct = clamp01(e.hp / e.maxHp);
  if (pct > 0) {
    const [c1, c2] = pct > 0.6 ? ['#4ade80', '#15803d'] : pct > 0.3 ? ['#fde68a', '#d97706'] : ['#f87171', '#991b1b'];
    const g = ctx.createLinearGradient(barX, 0, barX, barY + barH);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    roundRectPath(ctx, barX, barY, barW * pct, barH, 3);
    ctx.fillStyle = g;
    ctx.fill();
    // kilau tipis
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(barX + 1, barY + 1, Math.max(0, barW * pct - 2), 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, barX - 2, barY - 2, barW + 4, barH + 4, 5);
  ctx.stroke();

  // Stamina (hanya pemain)
  if (isPlayer && e.maxStamina > 0) {
    const sy = barY + barH + 5;
    const sPct = clamp01(e.stamina / e.maxStamina);
    roundRectPath(ctx, barX - 1, sy - 1, barW + 2, 5, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fill();
    if (sPct > 0) {
      roundRectPath(ctx, barX, sy, barW * sPct, 3, 1.5);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
    }
  }
}
