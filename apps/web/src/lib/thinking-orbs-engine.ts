/**
 * thinking-orbs engine — real per-frame math extracted from
 * thinking-orbs@0.3.1 (MIT © Jakub Antalik,
 * https://github.com/Jakubantalik/thinking-orbs).
 *
 * Only the pieces needed for three of its nine states: listening (wave),
 * composing (ribbon), shaping (morph). Same projection, radius-scale, and
 * frame-finalize helpers as the shipped bundle. Pure — no React, no DOM
 * (painting helpers accept a 2D canvas context).
 */

export interface OrbDot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a?: number;
}

export interface OrbLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  white: number;
  a?: number;
}

export interface OrbFrame {
  dots: OrbDot[];
  lines: OrbLine[];
}

export type OrbMode = "wave" | "ribbon" | "morph";
export type OrbState = "listening" | "composing" | "shaping";
export type OrbSize = 20 | 64;

export interface WaveOptions {
  rings?: number;
  lonDensity?: number;
  rBase?: number;
  rDepth?: number;
  rsPow?: number;
  rMin?: number;
}

export interface RibbonOptions {
  lanes?: number;
  segs?: number;
  ghostN?: number;
  rBase?: number;
  rDepth?: number;
  rsPow?: number;
  rMin?: number;
  spin?: number;
  bandMul?: number;
  wobMul?: number;
  faceOn?: boolean;
}

export interface MorphOptions {
  rDot?: number;
  iconD?: number;
  rMin?: number;
  spread?: number;
}

export type OrbOptions = WaveOptions | RibbonOptions | MorphOptions;
export type OrbDraw = (size: number, t: number, opts: OrbOptions) => OrbFrame;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Fibonacci sphere point i of n (used by composing's ghost sphere)
function fibSpherePoint(i: number, n: number): [number, number, number] {
  const gAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const theta = i * gAngle;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
}

// yaw(n) then pitch(s) rotation + orthographic projection to (t, r) center, scale a
function makeProj(
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  scale: number,
): (x: number, y: number, z: number) => [number, number, number] {
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy_ = Math.cos(yaw);
  return (x, y, z) => {
    const rx = x * cy_ + z * sy;
    const rz1 = -x * sy + z * cy_;
    const ry = y * cp - rz1 * sp;
    const rz = y * sp + rz1 * cp;
    return [cx + rx * scale, cy - ry * scale, rz];
  };
}

function radiusScale(size: number, power: number): number {
  return (size / 300) ** power;
}

// keep visible dots, clamp min radius, z-sort back-to-front
function finalizeFrame(dots: OrbDot[], lines: OrbLine[], rMin = 0.3): OrbFrame {
  const kept: OrbDot[] = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    kept.push(d);
  }
  kept.sort((a, b) => a.z - b.z);
  return { dots: kept, lines: lines.filter((l) => (l.a ?? 1) >= 0.02) };
}

export function paintDots(ctx: CanvasRenderingContext2D, dots: OrbDot[], dark: boolean): void {
  for (const d of dots) {
    const alpha = d.a ?? 1;
    const white = Math.min(1, Math.max(0, d.white));
    const v = Math.round((dark ? 1 - white : white) * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function paintLines(ctx: CanvasRenderingContext2D, lines: OrbLine[], dark: boolean): void {
  for (const l of lines) {
    const alpha = l.a ?? 1;
    const white = Math.min(1, Math.max(0, l.white));
    const v = Math.round((dark ? 1 - white : white) * 255);
    ctx.strokeStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.lineWidth = l.w;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
}

export function paintFrame(ctx: CanvasRenderingContext2D, frame: OrbFrame, dark: boolean): void {
  if (frame.lines.length) paintLines(ctx, frame.lines, dark);
  paintDots(ctx, frame.dots, dark);
}

// ---------------------------------------------------------------
// listening — "wave": a waveform rolls through dotted latitude rings
// ---------------------------------------------------------------
export function drawWave(size: number, t: number, opts: WaveOptions): OrbFrame {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.874;
  const proj = makeProj(t * 0.18, 0.38, cx, cy, 1);
  const rScale = radiusScale(size, opts.rsPow ?? 0.6);
  const dots: OrbDot[] = [];
  const rings = opts.rings ?? 15;
  const lonDensity = opts.lonDensity ?? 40;
  for (let ring = 0; ring <= rings; ring++) {
    const lat = -Math.PI / 2 + (ring / rings) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    const waveVal =
      0.62 * Math.sin(t * 2.1 - ring * 0.52) + 0.38 * Math.sin(t * 1.27 + ring * 0.83);
    const ringR = radius * (0.88 + 0.105 * waveVal);
    const count = Math.max(1, Math.round(Math.abs(cl) * lonDensity));
    for (let k = 0; k < count; k++) {
      const lon = (k / count) * 2 * Math.PI;
      const [px, py, pz] = proj(cl * Math.cos(lon) * ringR, sl * ringR, cl * Math.sin(lon) * ringR);
      const depth = (pz / radius + 1) / 2;
      const wPos = Math.max(0, waveVal);
      dots.push({
        x: px,
        y: py,
        z: pz,
        r: ((opts.rBase ?? 0.6) + (opts.rDepth ?? 1.7) * depth) * (1 + 0.4 * wPos) * rScale,
        white: 0.66 - 0.56 * depth - 0.1 * wPos,
      });
    }
  }
  return finalizeFrame(dots, [], opts.rMin);
}

// ---------------------------------------------------------------
// composing — "ribbon": an undulating multi-band sash around a ghost sphere
// ---------------------------------------------------------------
export function drawRibbon(size: number, t: number, opts: RibbonOptions): OrbFrame {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.78;
  const spin = opts.spin ?? 1;
  const basePitch = 0.3;
  const proj = makeProj(t * 0.1 * spin, basePitch, cx, cy, 1);
  const rScale = radiusScale(size, opts.rsPow ?? 0.6);
  const dots: OrbDot[] = [];

  const ghostN = opts.ghostN ?? 150;
  for (let i = 0; i < ghostN; i++) {
    const p = fibSpherePoint(i, ghostN);
    const [px, py, pz] = proj(p[0] * radius, p[1] * radius, p[2] * radius);
    const depth = (pz / radius + 1) / 2;
    dots.push({ x: px, y: py, z: pz, r: 0.8 * rScale, white: 0.78, a: 0.1 + 0.22 * depth });
  }

  const yaw = t * 0.24 * spin;
  const pitch = opts.faceOn ? -basePitch : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const R_ = Math.cos(yaw);
  const w_ = 0;
  const i_ = Math.sin(yaw);
  const u_ = -i_ * Math.sin(pitch);
  const y_ = Math.cos(pitch);
  const b_ = R_ * Math.sin(pitch);
  const f_ = w_ * b_ - i_ * y_;
  const P_ = i_ * u_ - R_ * b_;
  const x_ = R_ * y_ - w_ * u_;
  const wob = 0.23 * (opts.wobMul ?? 1);
  const bandRadius = opts.faceOn ? radius / (1 + 0.85 * wob) : radius;
  const lanes = opts.lanes ?? 5;
  const segs = opts.segs ?? 88;
  const bands = Math.max(1, Math.round(lanes * (opts.bandMul ?? 1)));

  for (let band = 0; band < bands; band++) {
    const offset = (band - (bands - 1) / 2) * 0.075;
    const edge = Math.abs(band - (bands - 1) / 2) / Math.max(1, (bands - 1) / 2);
    for (let s = 0; s < segs; s++) {
      const ang = (s / segs) * 2 * Math.PI;
      const wobble =
        (0.16 * Math.sin(ang * 3 - t * 1.7 + band * 0.22) + 0.07 * Math.sin(ang * 5 + t * 1.1)) *
        (opts.wobMul ?? 1);
      const stretch = opts.faceOn ? 1 + wobble : 1;
      const cOff = opts.faceOn ? offset : offset + wobble;
      const q_ = R_ * Math.cos(ang) + u_ * Math.sin(ang) + f_ * cOff;
      const F_ = w_ * Math.cos(ang) + y_ * Math.sin(ang) + P_ * cOff;
      const j_ = i_ * Math.cos(ang) + b_ * Math.sin(ang) + x_ * cOff;
      const mag = Math.sqrt(q_ * q_ + F_ * F_ + j_ * j_);
      const rr = bandRadius * stretch;
      const [px, py, pz] = proj((q_ / mag) * rr, (F_ / mag) * rr, (j_ / mag) * rr);
      const depth = (pz / radius + 1) / 2;
      dots.push({
        x: px,
        y: py,
        z: pz,
        r: ((opts.rBase ?? 1.1) + (opts.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rScale,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth,
      });
    }
  }
  return finalizeFrame(dots, [], opts.rMin);
}

// ---------------------------------------------------------------
// shaping — "morph": dotted outline morphs circle -> triangle -> square
// ---------------------------------------------------------------
function easeSmooth(n: number): number {
  return n * n * (3 - 2 * n);
}

// arc-length parametrize a closed polyline so dots space evenly along it
function arcLenParam(points: Array<[number, number]>): (u: number) => [number, number] {
  const n = points.length;
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLen.push(d);
    total += d;
  }
  return (u) => {
    let target = u * total;
    let i = 0;
    while (target > segLen[i] && i < n - 1) {
      target -= segLen[i];
      i++;
    }
    const a = points[i];
    const b = points[(i + 1) % n];
    const m = segLen[i] ? Math.min(1, target / segLen[i]) : 0;
    return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
  };
}

const circleShape = (u: number): [number, number] => {
  const a = -Math.PI / 2 + u * 2 * Math.PI;
  return [Math.cos(a) * 0.24, Math.sin(a) * 0.24];
};
const triangleShape = arcLenParam([
  [0, -0.26],
  [0.24, 0.16],
  [-0.24, 0.16],
]);
const squareShape = arcLenParam([
  [0, -0.2],
  [0.2, -0.2],
  [0.2, 0.2],
  [-0.2, 0.2],
  [-0.2, -0.2],
]);
const SHAPES: Array<(u: number) => [number, number]> = [circleShape, triangleShape, squareShape];

function dotCountForSize(mul: number): number {
  return Math.max(6, Math.round(34 * mul));
}

const HOLD = 1.4;
const MORPH_DUR = 0.9;
const CYCLE = HOLD + MORPH_DUR;

export function drawMorph(size: number, t: number, opts: MorphOptions): OrbFrame {
  const shapesN = SHAPES.length;
  const pos = t % (CYCLE * shapesN);
  const idx = Math.floor(pos / CYCLE);
  const within = pos - idx * CYCLE;
  const morphT = within > HOLD ? easeSmooth((within - HOLD) / MORPH_DUR) : 0;
  const spread = opts.spread ?? 1;
  const shapeA = SHAPES[idx];
  const shapeB = SHAPES[(idx + 1) % shapesN];

  const SAMPLES = 160;
  const outline: Array<[number, number]> = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const a = shapeA(u);
    const b = shapeB(u);
    outline.push([
      (a[0] + (b[0] - a[0]) * morphT) * spread,
      (a[1] + (b[1] - a[1]) * morphT) * spread,
    ]);
  }
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % SAMPLES];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLen.push(d);
    total += d;
  }

  const dotCount = dotCountForSize(opts.iconD ?? 1);
  const rDot = (opts.rDot ?? 0.021) * 1.35 * spread;
  const pulse = 1 + 0.02 * Math.sin(within * 3.1);
  const dots: OrbDot[] = [];
  const half = size / 2;
  let seg = 0;
  let acc = 0;
  for (let i = 0; i < dotCount; i++) {
    const target = (i / dotCount) * total;
    while (acc + segLen[seg] < target && seg < SAMPLES - 1) {
      acc += segLen[seg];
      seg++;
    }
    const a = outline[seg];
    const b = outline[(seg + 1) % SAMPLES];
    const m = segLen[seg] ? Math.min(1, (target - acc) / segLen[seg]) : 0;
    const px = (a[0] + (b[0] - a[0]) * m) * pulse;
    const py = (a[1] + (b[1] - a[1]) * m) * pulse;
    dots.push({
      x: half + px * size,
      y: half + py * size,
      z: 0,
      r: Math.max(0.35, rDot * size),
      white: 0.1,
    });
  }
  return finalizeFrame(dots, [], opts.rMin);
}

// ---------------------------------------------------------------
// presets — exact tuning tables from the shipped bundle
// ---------------------------------------------------------------
const BASE_OPTS: Record<OrbMode, OrbOptions> = {
  wave: { rings: 15, lonDensity: 40, rBase: 0.6, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  ribbon: { lanes: 5, segs: 88, ghostN: 150, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  morph: { rDot: 0.021, iconD: 1, rMin: 0.25 },
};

interface SizeTuning {
  speed: number;
  count: number;
  size: number;
  extra?: Record<string, number>;
}

const SIZE_TUNING: Record<OrbMode, Record<number, SizeTuning>> = {
  wave: {
    64: { speed: 4.388, count: 0.341, size: 1 },
    20: { speed: 3.998, count: 0.105, size: 1.6 },
  },
  ribbon: {
    64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } },
    20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } },
  },
  morph: {
    64: { speed: 2.405, count: 0.702, size: 0.395, extra: { spread: 1.45 } },
    20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } },
  },
};

const PAIRED_COUNT_KEYS: Array<[string, string]> = [
  ["rings", "lonDensity"],
  ["lanes", "segs"],
];
const SINGLE_COUNT_KEYS: string[] = ["ghostN"];
const RADIUS_KEYS: string[] = ["rBase", "rDepth", "rDot"];

function scaleCount(opts: OrbOptions, mul: number): OrbOptions {
  const out = { ...opts } as Record<string, unknown>;
  const touched = new Set<string>();
  const sq = Math.sqrt(mul);
  for (const [k1, k2] of PAIRED_COUNT_KEYS) {
    if (out[k1] != null && out[k2] != null && !touched.has(k1) && !touched.has(k2)) {
      out[k1] = Math.max(2, Math.round((out[k1] as number) * sq));
      out[k2] = Math.max(2, Math.round((out[k2] as number) * sq));
      touched.add(k1);
      touched.add(k2);
    }
  }
  for (const k of SINGLE_COUNT_KEYS) {
    if (out[k] != null && out[k] !== 0 && !touched.has(k)) {
      out[k] = Math.max(1, Math.round((out[k] as number) * mul));
    }
  }
  if (out.iconD != null) out.iconD = Math.max(0.02, (out.iconD as number) * mul);
  return out as unknown as OrbOptions;
}

function scaleSize(opts: OrbOptions, mul: number): OrbOptions {
  const out = { ...opts } as Record<string, unknown>;
  for (const k of RADIUS_KEYS) {
    if (out[k] != null) out[k] = (out[k] as number) * mul;
  }
  return out as unknown as OrbOptions;
}

export interface ResolvedPreset {
  speed: number;
  opts: OrbOptions;
}

export function resolvePreset(mode: OrbMode, size: OrbSize): ResolvedPreset {
  const tuning = SIZE_TUNING[mode][size];
  let opts = { ...BASE_OPTS[mode] };
  if (tuning.count !== 1) opts = scaleCount(opts, tuning.count);
  if (tuning.size !== 1) opts = scaleSize(opts, tuning.size);
  if (tuning.extra) opts = { ...opts, ...tuning.extra };
  return { speed: tuning.speed, opts };
}

export const DRAW: Record<OrbMode, OrbDraw> = {
  wave: drawWave as OrbDraw,
  ribbon: drawRibbon as OrbDraw,
  morph: drawMorph as OrbDraw,
};

export const STATE_TO_MODE: Record<OrbState, OrbMode> = {
  listening: "wave",
  composing: "ribbon",
  shaping: "morph",
};

export const STATE_LABEL: Record<OrbState, string> = {
  listening: "Listening…",
  composing: "Composing…",
  shaping: "Shaping…",
};
