/**
 * Client-side Tibia sprite renderer.
 * Renders outfits/creatures using pre-extracted WebP sprite sheets + Canvas 2D compositing.
 * Falls back to outfit-worker URL if sheets not available.
 */

// --- Color Palette (133 Tibia colors, ported from OTClient outfit.cpp) ---
const HSI_H_STEPS = 19;
const HSI_SI_VALUES = 7;

function computeColor(ci: number): [number, number, number] {
  if (ci >= HSI_H_STEPS * HSI_SI_VALUES) ci = 0;
  let l1 = 0, l2 = 0, l3 = 0;
  if (ci % HSI_H_STEPS !== 0) {
    l1 = (ci % HSI_H_STEPS) / 18.0; l2 = 1; l3 = 1;
    switch (Math.floor(ci / HSI_H_STEPS)) {
      case 0: l2 = 0.25; l3 = 1.00; break;
      case 1: l2 = 0.25; l3 = 0.75; break;
      case 2: l2 = 0.50; l3 = 0.75; break;
      case 3: l2 = 0.667; l3 = 0.75; break;
      case 4: l2 = 1.00; l3 = 1.00; break;
      case 5: l2 = 1.00; l3 = 0.75; break;
      case 6: l2 = 1.00; l3 = 0.50; break;
    }
  } else { l1 = 0; l2 = 0; l3 = 1 - ci / HSI_H_STEPS / HSI_SI_VALUES; }
  if (l3 === 0) return [0, 0, 0];
  if (l2 === 0) { const v = Math.round(l3 * 255); return [v, v, v]; }
  let r = 0, g = 0, b = 0;
  if (l1 < 1 / 6) { r = l3; b = l3 * (1 - l2); g = b + (l3 - b) * 6 * l1; }
  else if (l1 < 2 / 6) { g = l3; b = l3 * (1 - l2); r = g - (l3 - b) * (6 * l1 - 1); }
  else if (l1 < 3 / 6) { g = l3; r = l3 * (1 - l2); b = r + (l3 - r) * (6 * l1 - 2); }
  else if (l1 < 4 / 6) { b = l3; r = l3 * (1 - l2); g = b - (l3 - r) * (6 * l1 - 3); }
  else if (l1 < 5 / 6) { b = l3; g = l3 * (1 - l2); r = g + (l3 - g) * (6 * l1 - 4); }
  else { r = l3; g = l3 * (1 - l2); b = r - (l3 - g) * (6 * l1 - 5); }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const TIBIA_COLORS = Array.from({ length: HSI_H_STEPS * HSI_SI_VALUES }, (_, i) => computeColor(i));

// --- Metadata ---
interface FrameGroupMeta {
  type: number;
  spriteWidth: number;
  spriteHeight: number;
  patternX: number;
  patternY: number;
  patternZ: number;
  layers: number;
  animationPhases: number;
  phaseDurations?: { min: number; max: number }[];
  loopType?: number;
  loopCount?: number;
}

interface AppearanceMeta {
  id: number;
  name: string;
  category: 'outfit' | 'creature';
  frameGroups: Record<number, FrameGroupMeta>;
  files: {
    base: Record<number, string>;
    maskHead?: Record<number, string>;
    maskBody?: Record<number, string>;
    maskLegs?: Record<number, string>;
    maskFeet?: Record<number, string>;
  };
}

interface MetadataIndex {
  outfits: Record<number, AppearanceMeta>;
  creatures: Record<number, AppearanceMeta>;
  items: Record<number, AppearanceMeta>;
}

const SPRITES_BASE = 'https://cdn.jsdelivr.net/gh/holybaiakteam/holybaiak-images@main';

// Lazy-loaded metadata per category
const categoryCache: Partial<Record<string, Record<number, AppearanceMeta>>> = {};
const categoryPromises: Partial<Record<string, Promise<Record<number, AppearanceMeta>>>> = {};

async function loadCategory(category: 'outfits' | 'creatures' | 'items'): Promise<Record<number, AppearanceMeta>> {
  if (categoryCache[category]) return categoryCache[category]!;
  if (!categoryPromises[category]) {
    categoryPromises[category] = fetch(`${SPRITES_BASE}/metadata-${category}.json`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d: Record<number, AppearanceMeta>) => { categoryCache[category] = d; return d; })
      .catch(e => { delete categoryPromises[category]; throw e; });
  }
  return categoryPromises[category]!;
}

// Load outfits + creatures (most pages need these)
async function loadMetadata(): Promise<MetadataIndex> {
  const [outfits, creatures] = await Promise.all([
    loadCategory('outfits'),
    loadCategory('creatures'),
  ]);
  return { outfits, creatures, items: categoryCache['items'] || {} };
}

// --- Sheet Cache (LRU) ---
const sheetCache = new Map<string, HTMLImageElement>();
const loadingSheets = new Map<string, Promise<HTMLImageElement>>();

async function loadSheet(path: string): Promise<HTMLImageElement> {
  const cached = sheetCache.get(path);
  if (cached) return cached;
  const existing = loadingSheets.get(path);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (sheetCache.size > 100) {
        const first = sheetCache.keys().next().value;
        if (first) sheetCache.delete(first);
      }
      sheetCache.set(path, img);
      loadingSheets.delete(path);
      resolve(img);
    };
    img.onerror = () => { loadingSheets.delete(path); reject(new Error(`Failed: ${path}`)); };
    img.src = `${SPRITES_BASE}/${path}`;
  });

  loadingSheets.set(path, promise);
  return promise;
}

// --- Renderer ---
export interface SpriteRenderOptions {
  looktype: number;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
  addons?: number;
  mount?: number;
  direction?: number;
  animationPhase?: number;
  frameGroup?: number;
}

function getSpriteRect(fg: FrameGroupMeta, px: number, py: number, pz: number, phase: number): [number, number, number, number] {
  return [
    (px + phase * fg.patternX) * fg.spriteWidth,
    (py + pz * fg.patternY) * fg.spriteHeight,
    fg.spriteWidth,
    fg.spriteHeight,
  ];
}

// Offscreen canvas pool
const pool: OffscreenCanvas[] = [];
function getOff(w: number, h: number): OffscreenCanvas {
  const c = pool.pop() || new OffscreenCanvas(w, h);
  c.width = w; c.height = h;
  return c;
}
function retOff(c: OffscreenCanvas) { if (pool.length < 8) pool.push(c); }

export async function renderSprite(
  ctx: CanvasRenderingContext2D,
  opts: SpriteRenderOptions,
): Promise<boolean> {
  const meta = await loadMetadata();
  const app = meta.outfits[opts.looktype] || meta.creatures[opts.looktype];
  if (!app) return false;

  const fgType = opts.frameGroup ?? 0;
  const fg = app.frameGroups[fgType] ?? app.frameGroups[Object.keys(app.frameGroups)[0] as any];
  if (!fg) return false;

  const sw = fg.spriteWidth, sh = fg.spriteHeight;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  // Center sprite in canvas (handles 32x32 sprites in 64x64 canvas)
  const dx = Math.floor((cw - sw) / 2);
  const dy = Math.floor((ch - sh) / 2);

  // Tibia isometric directions: 0=North, 1=East, 2=South, 3=West
  // East (1) = facing down-right = "facing the viewer" in isometric view
  const requestedDir = opts.direction ?? 2;
  const dir = Math.min(requestedDir, fg.patternX - 1);
  const addons = opts.addons ?? 0;
  const phase = (opts.animationPhase ?? 0) % Math.max(1, fg.animationPhases);
  const mountZ = opts.mount && opts.mount > 0 && fg.patternZ > 1 ? 1 : 0;

  // Mount
  if (opts.mount && opts.mount > 0) {
    const mountApp = meta.outfits[opts.mount] || meta.creatures[opts.mount];
    if (mountApp) {
      const mfg = mountApp.frameGroups[fgType] ?? mountApp.frameGroups[Object.keys(mountApp.frameGroups)[0] as any];
      if (mfg && mountApp.files.base[fgType]) {
        const mSheet = await loadSheet(mountApp.files.base[fgType]);
        const mDir = Math.min(dir, mfg.patternX - 1);
        const mRect = getSpriteRect(mfg, mDir, 0, 0, phase % Math.max(1, mfg.animationPhases));
        ctx.drawImage(mSheet, ...mRect, dx, dy, sw, sh);
      }
    }
  }

  const basePath = app.files.base[fgType];
  if (!basePath) return false;
  const baseSheet = await loadSheet(basePath);

  for (let pY = 0; pY < fg.patternY; pY++) {
    if (pY > 0 && !(addons & (1 << (pY - 1)))) continue;
    const rect = getSpriteRect(fg, dir, pY, mountZ, phase);
    ctx.drawImage(baseSheet, ...rect, dx, dy, sw, sh);

    if (fg.layers >= 2 && app.category === 'outfit') {
      const parts: { key: keyof typeof app.files; color: number }[] = [
        { key: 'maskHead', color: opts.head ?? 0 },
        { key: 'maskBody', color: opts.body ?? 0 },
        { key: 'maskLegs', color: opts.legs ?? 0 },
        { key: 'maskFeet', color: opts.feet ?? 0 },
      ];

      for (const { key, color } of parts) {
        if (color === 0) continue;
        const maskFiles = app.files[key] as Record<number, string> | undefined;
        if (!maskFiles?.[fgType]) continue;
        const maskSheet = await loadSheet(maskFiles[fgType]);
        const [r, g, b] = TIBIA_COLORS[color] || [0, 0, 0];

        const tmp = getOff(cw, ch);
        const tc = tmp.getContext('2d')!;
        tc.clearRect(0, 0, cw, ch);
        tc.drawImage(maskSheet, ...rect, dx, dy, sw, sh);
        tc.globalCompositeOperation = 'multiply';
        tc.fillStyle = `rgb(${r},${g},${b})`;
        tc.fillRect(0, 0, cw, ch);
        tc.globalCompositeOperation = 'destination-in';
        tc.drawImage(maskSheet, ...rect, dx, dy, sw, sh);
        tc.globalCompositeOperation = 'source-over';
        ctx.drawImage(tmp, 0, 0);
        retOff(tmp);
      }
    }
  }

  return true;
}

/** Get animation info for a looktype (phases count + durations). */
export async function getAnimationInfo(
  looktype: number,
  frameGroup: number = 1,
): Promise<{ phases: number; durations: { min: number; max: number }[] } | null> {
  try {
    const meta = await loadMetadata();
    const app = meta.outfits[looktype] || meta.creatures[looktype];
    if (!app) return null;

    const fg = app.frameGroups[frameGroup] ?? app.frameGroups[Object.keys(app.frameGroups)[0] as any];
    if (!fg) return null;

    return {
      phases: fg.animationPhases,
      durations: fg.phaseDurations || [],
      loopType: fg.loopType ?? 0,
      loopCount: fg.loopCount ?? 0,
    };
  } catch {
    return null;
  }
}
