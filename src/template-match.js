// Sparse multi-scale matching. Coordinates are relative to the search image.
export function matchTemplate(image, template, { minScale = 0.2, maxScale = 1 } = {}) {
  const { width: tw, height: th, data: td } = template;
  const { width, height } = image;
  let best = { score: 0, x: 0, y: 0, width: 0, height: 0 };
  function integral(source) {
    const stride = source.width + 1;
    const result = new Float64Array(stride * (source.height + 1) * 3);
    for (let y = 1; y <= source.height; y++) for (let x = 1; x <= source.width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        const i = (y * stride + x) * 3 + ch;
        result[i] = source.data[((y - 1) * source.width + x - 1) * 4 + ch] + result[i - 3] + result[i - stride * 3] - result[i - stride * 3 - 3];
      }
    }
    return { result, stride };
  }
  const sourceIntegral = integral(image), templateIntegral = integral(template);
  function mean(table, x, y, w, h, gx, gy, ch) {
    const x0 = x + Math.floor(gx * w / 20), y0 = y + Math.floor(gy * h / 12);
    const x1 = Math.max(x0 + 1, x + Math.floor((gx + 1) * w / 20));
    const y1 = Math.max(y0 + 1, y + Math.floor((gy + 1) * h / 12));
    const { result: a, stride } = table;
    return (a[(y1 * stride + x1) * 3 + ch] - a[(y0 * stride + x1) * 3 + ch] - a[(y1 * stride + x0) * 3 + ch] + a[(y0 * stride + x0) * 3 + ch]) / ((x1 - x0) * (y1 - y0));
  }
  const samples = [];
  let sumT = 0, sumTT = 0;
  for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 20; gx++) {
    const u = (gx + 0.5) / 20, v = (gy + 0.5) / 12;
    const i = (Math.floor(v * th) * tw + Math.floor(u * tw)) * 4;
    if (td[i + 3] < 200) continue;
    const rgb = [0, 1, 2].map(ch => mean(templateIntegral, 0, 0, tw, th, gx, gy, ch));
    const t = (rgb[0] + rgb[1] + rgb[2]) / 3;
    samples.push({ gx, gy, rgb, t }); sumT += t; sumTT += t * t;
  }
  const n = samples.length;
  const varT = sumTT - sumT * sumT / n;
  if (n < 30 || varT < n * 16) return best;
  const kernels = new Map();
  function scoreAt(x, y, w, h) {
    let kernel = kernels.get(w);
    if (!kernel) {
      kernel = samples.map(s => {
        const x0 = Math.floor(s.gx * w / 20), y0 = Math.floor(s.gy * h / 12);
        const x1 = Math.max(x0 + 1, Math.floor((s.gx + 1) * w / 20));
        const y1 = Math.max(y0 + 1, Math.floor((s.gy + 1) * h / 12));
        const stride = sourceIntegral.stride;
        return { ...s, a: (y1 * stride + x1) * 3, b: (y0 * stride + x1) * 3,
          c: (y1 * stride + x0) * 3, d: (y0 * stride + x0) * 3, inv: 1 / ((x1 - x0) * (y1 - y0)) };
      });
      kernels.set(w, kernel);
    }
    const base = (y * sourceIntegral.stride + x) * 3, pixels = sourceIntegral.result;
    let sum = 0, sumSq = 0, cross = 0, error = 0;
    for (const s of kernel) {
      const ia = base + s.a, ib = base + s.b, ic = base + s.c, id = base + s.d;
      const r = (pixels[ia] - pixels[ib] - pixels[ic] + pixels[id]) * s.inv;
      const g = (pixels[ia + 1] - pixels[ib + 1] - pixels[ic + 1] + pixels[id + 1]) * s.inv;
      const b = (pixels[ia + 2] - pixels[ib + 2] - pixels[ic + 2] + pixels[id + 2]) * s.inv;
      const p = (r + g + b) / 3;
      sum += p; sumSq += p * p; cross += p * s.t;
      error += Math.abs(r - s.rgb[0]) + Math.abs(g - s.rgb[1]) + Math.abs(b - s.rgb[2]);
    }
    const variance = sumSq - sum * sum / n;
    if (variance < n * 16) return 0;
    const correlation = Math.max(0, (cross - sum * sumT / n) / Math.sqrt(variance * varT));
    return 0.75 * correlation + 0.25 * (1 - error / (n * 765));
  }
  const candidates = [];
  const maxW = Math.min(width * maxScale, height * tw / th, width);
  for (let size = Math.max(20, width * minScale, 12 * tw / th); size <= maxW + 0.01; size = Math.min(maxW, size * 1.12)) {
    const w = Math.round(size), h = Math.max(1, Math.round(w * th / tw));
    if (w > width || h > height) break;
    const step = Math.max(1, Math.floor(w / 24));
    const yStep = Math.max(1, Math.floor(h / 24));
    for (let y = 0; y <= height - h; y += Math.min(yStep, height - h - y || yStep)) {
      for (let x = 0; x <= width - w; x += Math.min(step, width - w - x || step)) {
        const score = scoreAt(x, y, w, h);
        if (score > best.score) best = { score, x, y, width: w, height: h };
        if (candidates.length < 4 || score > candidates[candidates.length - 1].score) {
          candidates.push({ score, x, y, width: w, height: h }); candidates.sort((a, b) => b.score - a.score); candidates.length = Math.min(4, candidates.length);
        }
      }
    }
    if (size === maxW) break;
  }
  // Refine scale and location around the strongest coarse candidates.
  for (const candidate of candidates) {
    const radius = Math.max(1, Math.floor(candidate.width / 24));
    const yRadius = Math.max(1, Math.floor(candidate.height / 24));
    for (let w = Math.max(20, Math.ceil(width * minScale), Math.floor(candidate.width * 0.9)); w <= Math.min(maxW, candidate.width * 1.1); w += 2) {
      const h = Math.round(w * th / tw); if (h < 12 || h > height) continue;
      for (let y = Math.max(0, candidate.y - yRadius); y <= Math.min(height - h, candidate.y + yRadius); y++) {
        for (let x = Math.max(0, candidate.x - radius); x <= Math.min(width - w, candidate.x + radius); x += 2) {
          const score = scoreAt(x, y, w, h);
          if (score > best.score) best = { score, x, y, width: w, height: h };
        }
      }
    }
  }
  const candidate = best;
  for (let w = Math.max(20, Math.ceil(width * minScale), candidate.width - 2); w <= Math.min(maxW, candidate.width + 2); w++) {
    const h = Math.round(w * th / tw); if (h < 12 || h > height) continue;
    for (let y = Math.max(0, candidate.y - 2); y <= Math.min(height - h, candidate.y + 2); y++) {
      for (let x = Math.max(0, candidate.x - 2); x <= Math.min(width - w, candidate.x + 2); x++) {
        const score = scoreAt(x, y, w, h);
        if (score > best.score) best = { score, x, y, width: w, height: h };
      }
    }
  }
  return best;
}
