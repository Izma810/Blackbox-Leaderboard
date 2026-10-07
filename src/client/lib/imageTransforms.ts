/**
 * Image transforms — exact JavaScript ports of the Python implementations in
 * blackbox-ml-game/src/blackbox_game/images.py.
 * Parameters match the Python constants exactly so results are pixel-identical.
 */

export const ALL_TRANSFORMS = [
  'rotate_chunks', 'mirror_sum', 'circular_shift', 'swap_rgb_rbg',
  'swap_rgb_bgr', 'invert', 'solarise', 'posterise',
  'opacity', 'vignette', 'ghost_echo', 'stretch_horizontal',
] as const

export type TransformName = typeof ALL_TRANSFORMS[number]

export const TRANSFORM_DESCRIPTIONS: Record<TransformName, string> = {
  rotate_chunks:      'Cuts the image into 64×64 tiles and rotates each tile 90° clockwise',
  mirror_sum:         'Averages each pixel with the pixel directly opposite (vertical flip blend)',
  circular_shift:     'Rolls the image 32 columns right, wrapping around',
  swap_rgb_rbg:       'Swaps green and blue channels: (R,G,B) → (R,B,G)',
  swap_rgb_bgr:       'Swaps red and blue channels: (R,G,B) → (B,G,R)',
  invert:             'Inverts all pixel values: 255 − value',
  solarise:           'Inverts bright pixels (≥128); darker pixels are unchanged',
  posterise:          'Reduces each channel to 4 levels: 0, 85, 170, 255',
  opacity:            'Fades the image towards white: 60% image + 40% white',
  vignette:           'Darkens towards the corners (strength 0.6)',
  ghost_echo:         'Blends the image with a copy shifted 16 px right (weights 0.5137 / 0.4863)',
  stretch_horizontal: 'Magnifies horizontally 1.6× about the centre, nearest-neighbour',
}

const W = 256, H = 256
const CHUNK = 64
const GHOST_SHIFT = 16
const ECHO_WEIGHT = 0.5137   // weight of original; echo gets 1 - ECHO_WEIGHT
const OPACITY_W   = 0.6
const VIGNETTE_STRENGTH = 0.6
const STRETCH_FACTOR = 1.6
const SOLARISE_THRESHOLD = 128
const POSTERISE_STEP = 64

type Pixels = Uint8ClampedArray

function copyPixels(src: Pixels): Pixels { return new Uint8ClampedArray(src) }

/** Byte index for pixel at column x, row y (RGBA layout). */
function idx(x: number, y: number) { return (y * W + x) * 4 }

// ─── 1. rotate_chunks ────────────────────────────────────────────────────────
// np.rot90(tile, k=-1) = 90° clockwise.
// dst tile pixel (r, c) ← src tile pixel (S-1-c, r).
// In canvas coords (x=col, y=row):
//   out at (tx+c, ty+r) ← src at (tx+r, ty+S-1-c)

export function rotate_chunks(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src.length)
  const S = CHUNK
  for (let ty = 0; ty < H; ty += S) {
    for (let tx = 0; tx < W; tx += S) {
      for (let r = 0; r < S; r++) {
        for (let c = 0; c < S; c++) {
          const si = idx(tx + r,     ty + S - 1 - c)
          const di = idx(tx + c,     ty + r)
          out[di]   = src[si]
          out[di+1] = src[si+1]
          out[di+2] = src[si+2]
          out[di+3] = 255
        }
      }
    }
  }
  return out
}

// ─── 2. mirror_sum ───────────────────────────────────────────────────────────
// (img + img[::-1]) / 2  — average with vertical flip.

export function mirror_sum(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src.length)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const di = idx(x, y), si = idx(x, H - 1 - y)
      out[di]   = Math.round((src[di]   + src[si])   / 2)
      out[di+1] = Math.round((src[di+1] + src[si+1]) / 2)
      out[di+2] = Math.round((src[di+2] + src[si+2]) / 2)
      out[di+3] = 255
    }
  }
  return out
}

// ─── 3. circular_shift ───────────────────────────────────────────────────────
// np.roll(img, shift=(0, 32), axis=(0, 1)) — roll 32 columns right.
// out[y][x] = src[y][(x - 32 + W) % W]

export function circular_shift(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src.length)
  const shift = 32
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = ((x - shift) % W + W) % W
      const di = idx(x, y), si = idx(sx, y)
      out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = 255
    }
  }
  return out
}

// ─── 4. swap_rgb_rbg — (R,G,B) → (R,B,G): green ↔ blue ─────────────────────

export function swap_rgb_rbg(src: Pixels): Pixels {
  const out = copyPixels(src)
  for (let i = 0; i < out.length; i += 4) {
    out[i+1] = src[i+2]   // new G = old B
    out[i+2] = src[i+1]   // new B = old G
  }
  return out
}

// ─── 5. swap_rgb_bgr — (R,G,B) → (B,G,R): red ↔ blue ───────────────────────

export function swap_rgb_bgr(src: Pixels): Pixels {
  const out = copyPixels(src)
  for (let i = 0; i < out.length; i += 4) {
    out[i]   = src[i+2]   // new R = old B
    out[i+2] = src[i]     // new B = old R
  }
  return out
}

// ─── 6. invert ───────────────────────────────────────────────────────────────

export function invert(src: Pixels): Pixels {
  const out = copyPixels(src)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - src[i]; out[i+1] = 255 - src[i+1]; out[i+2] = 255 - src[i+2]
  }
  return out
}

// ─── 7. solarise ─────────────────────────────────────────────────────────────
// Invert channels at or above SOLARISE_THRESHOLD (128).

export function solarise(src: Pixels): Pixels {
  const out = copyPixels(src)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i]   >= SOLARISE_THRESHOLD) out[i]   = 255 - out[i]
    if (out[i+1] >= SOLARISE_THRESHOLD) out[i+1] = 255 - out[i+1]
    if (out[i+2] >= SOLARISE_THRESHOLD) out[i+2] = 255 - out[i+2]
  }
  return out
}

// ─── 8. posterise ────────────────────────────────────────────────────────────
// 4 levels: 0, 85, 170, 255.  (img // 64) * 85, capped at 255.

export function posterise(src: Pixels): Pixels {
  const out = copyPixels(src)
  const levels = 256 / POSTERISE_STEP    // = 4
  const step   = 255 / (levels - 1)      // = 85
  for (let i = 0; i < out.length; i += 4) {
    out[i]   = Math.min(255, Math.floor(src[i]   / POSTERISE_STEP) * step)
    out[i+1] = Math.min(255, Math.floor(src[i+1] / POSTERISE_STEP) * step)
    out[i+2] = Math.min(255, Math.floor(src[i+2] / POSTERISE_STEP) * step)
  }
  return out
}

// ─── 9. opacity ──────────────────────────────────────────────────────────────
// Fade towards white: 0.6 × img + 0.4 × 255.

export function opacity(src: Pixels): Pixels {
  const out = copyPixels(src)
  for (let i = 0; i < out.length; i += 4) {
    out[i]   = Math.round(OPACITY_W * src[i]   + (1 - OPACITY_W) * 255)
    out[i+1] = Math.round(OPACITY_W * src[i+1] + (1 - OPACITY_W) * 255)
    out[i+2] = Math.round(OPACITY_W * src[i+2] + (1 - OPACITY_W) * 255)
  }
  return out
}

// ─── 10. vignette ────────────────────────────────────────────────────────────
// cy = (H-1)/2 = 127.5, cx = (W-1)/2 = 127.5 (matching Python's cy, cx).
// radius = sqrt(((y-cy)/(H/2))^2 + ((x-cx)/(W/2))^2)
// factor = 1 - strength * clip(radius/sqrt(2), 0, 1)^2

export function vignette(src: Pixels): Pixels {
  const out = copyPixels(src)
  const cy = (H - 1) / 2, cx = (W - 1) / 2
  const hy = H / 2, hx = W / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ry = (y - cy) / hy, rx = (x - cx) / hx
      const r = Math.sqrt(ry * ry + rx * rx)
      const t = Math.min(1, r / Math.SQRT2)
      const factor = 1 - VIGNETTE_STRENGTH * t * t
      const i = idx(x, y)
      out[i]   = Math.round(src[i]   * factor)
      out[i+1] = Math.round(src[i+1] * factor)
      out[i+2] = Math.round(src[i+2] * factor)
    }
  }
  return out
}

// ─── 11. ghost_echo ──────────────────────────────────────────────────────────
// echo[:,GHOST_SHIFT:] = img[:,:-GHOST_SHIFT]
// echo[:,:GHOST_SHIFT] = img[:,:GHOST_SHIFT]  (leftmost cols keep original)
// result = ECHO_WEIGHT * img + (1 - ECHO_WEIGHT) * echo

export function ghost_echo(src: Pixels): Pixels {
  const out = copyPixels(src)
  const echoW = 1 - ECHO_WEIGHT
  for (let y = 0; y < H; y++) {
    for (let x = GHOST_SHIFT; x < W; x++) {
      const di = idx(x, y)
      const ei = idx(x - GHOST_SHIFT, y)  // echo pixel comes from x - GHOST_SHIFT
      out[di]   = Math.round(ECHO_WEIGHT * src[di]   + echoW * src[ei])
      out[di+1] = Math.round(ECHO_WEIGHT * src[di+1] + echoW * src[ei+1])
      out[di+2] = Math.round(ECHO_WEIGHT * src[di+2] + echoW * src[ei+2])
    }
    // x < GHOST_SHIFT: echo = original → weight sums to 1 → pixel unchanged
  }
  return out
}

// ─── 12. stretch_horizontal ──────────────────────────────────────────────────
// cx = (W-1)/2 (Python uses (w-1)/2.0).
// src_x = clip(round(cx + (x - cx) / STRETCH_FACTOR), 0, W-1)

export function stretch_horizontal(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src.length)
  const cx = (W - 1) / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.max(0, Math.min(W - 1, Math.round(cx + (x - cx) / STRETCH_FACTOR)))
      const di = idx(x, y), si = idx(sx, y)
      out[di] = src[si]; out[di+1] = src[si+1]; out[di+2] = src[si+2]; out[di+3] = 255
    }
  }
  return out
}

// ─── Pipeline runner ──────────────────────────────────────────────────────────

const FN_MAP: Record<TransformName, (p: Pixels) => Pixels> = {
  rotate_chunks, mirror_sum, circular_shift, swap_rgb_rbg, swap_rgb_bgr,
  invert, solarise, posterise, opacity, vignette, ghost_echo, stretch_horizontal,
}

export function applyPipeline(src: Pixels, transforms: string[]): Pixels {
  let cur = src
  for (const t of transforms) {
    const fn = FN_MAP[t as TransformName]
    if (fn) cur = fn(cur)
  }
  return cur
}

// ─── Source image generators (fallback when PNGs are not present) ─────────────

export function generateSourceImage(name: string): ImageData {
  const data = new Uint8ClampedArray(W * H * 4)
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = idx(x, y)
    data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255
  }

  switch (name) {
    case 'checkmate': {
      const sq = W / 8
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v = ((Math.floor(x/sq) + Math.floor(y/sq)) % 2 === 0) ? 0 : 255
          set(x, y, v, v, v)
        }
      break
    }
    case 'matrix': {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const stripe = (x + y * 3) % 16 < 6 ? 180 : 40
          set(x, y, 0, stripe, 0)
        }
      break
    }
    case 'moon': {
      // Dark sky, bright circle
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) set(x, y, 15, 15, 40)
      const cx = 128, cy = 100, r = 70
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if ((x-cx)**2 + (y-cy)**2 < r*r) set(x, y, 240, 235, 200)
      break
    }
    case 'molecule': {
      // White background with coloured circles
      for (let i = 0; i < data.length; i += 4) { data[i]=240; data[i+1]=240; data[i+2]=240; data[i+3]=255 }
      const atoms = [[128,128,60],[80,160,40],[176,160,40],[64,80,30],[192,80,30],[128,200,35]]
      const cols  = [[200,50,50],[50,100,200],[50,180,80],[200,150,50],[150,50,200],[80,200,200]]
      for (let a=0; a<atoms.length; a++) {
        const [ax, ay, ar] = atoms[a], [cr, cg, cb] = cols[a]
        for (let y=0;y<H;y++) for (let x=0;x<W;x++)
          if ((x-ax)**2+(y-ay)**2 < ar*ar) set(x,y,cr,cg,cb)
      }
      break
    }
    case 'lsd': {
      // Psychedelic gradient
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const fx = x/W, fy = y/H
          set(x, y, Math.round(255*Math.abs(Math.sin(fx*6+fy*4))),
            Math.round(255*Math.abs(Math.sin(fx*4+fy*8+1))),
            Math.round(255*Math.abs(Math.sin(fx*8+fy*2+2))))
        }
      break
    }
    case 'marbles': {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v = Math.round(128 + 127*Math.sin(x/12)*Math.cos(y/12))
          set(x, y, v, Math.round(v*0.7), 255-v)
        }
      break
    }
    case 'monet': {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const t = y/H
          set(x, y, Math.round(100+80*t), Math.round(140+60*(1-t)), Math.round(180-60*t))
        }
      break
    }
    case 'doctor_strange': {
      const cx = W/2, cy = H*0.45
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const r = Math.sqrt((x-cx)**2+(y-cy)**2)
          const t = Math.min(1, r/128)
          set(x, y, Math.round(244-200*t), Math.round(197-180*t), Math.round(122-100*t))
        }
      for (let y=185;y<H;y++) for (let x=50;x<W-50;x++) set(x,y,180,20,10)
      break
    }
    case 'pexels': {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const fy = y/H, fx = x/W
          set(x, y, Math.round(135*fy+50*fx), Math.round(80+60*fy), Math.round(200*(1-fy)))
        }
      break
    }
    default:
      for (let i=0; i<data.length; i+=4) { data[i]=128; data[i+1]=128; data[i+2]=128; data[i+3]=255 }
  }
  return new ImageData(data, W, H)
}
