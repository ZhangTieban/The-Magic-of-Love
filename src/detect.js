// Pure red-dot detection. No DOM dependencies so it can be unit tested in Node.

export const DEFAULT_OPTIONS = {
  hueTolerance: 12,
  minSaturation: 0.75,
  // A minimap dot is drawn in near-pure red, so its darkest pixel still sits
  // around 0.87. Scenery is shaded with darker reds that top out near 0.8, so
  // the floor goes between the two rather than below both.
  minValue: 0.85,
  // A player dot is roughly 5x5 at native scale and 10x10 when the capture is
  // upscaled, so anything down at a few pixels is a speck of map art, not a
  // player. Lower this only if the capture is scaled below native resolution.
  minArea: 12,
  maxArea: 400,
  splitMergedBlobs: false,
  mergeThreshold: 1.6,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Players standing on the same spot merge into one blob. Anything noticeably
 * larger than the typical dot is assumed to hold that many players.
 */
function estimateDotsPerBlob(blobs, opts) {
  const typicalArea = median(blobs.map((blob) => blob.area));
  for (const blob of blobs) {
    blob.dots = blob.area > typicalArea * opts.mergeThreshold
      ? Math.max(1, Math.round(blob.area / typicalArea))
      : 1;
  }
}

function isRed(r, g, b, options) {
  const max = Math.max(r, g, b);
  if (max / 255 < options.minValue) return false;

  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta / max < options.minSaturation) return false;

  // Only pixels whose hue sits within `hueTolerance` degrees of pure red count.
  if (max !== r) return false;
  let hue = (60 * (((g - b) / delta) % 6) + 360) % 360;
  if (hue > 180) hue -= 360;
  return Math.abs(hue) <= options.hueTolerance;
}

/**
 * Finds clusters of pure-red pixels in an ImageData-shaped object.
 * Returns the clusters that pass the area filter, plus their count.
 */
export function detectRedDots(imageData, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height, data } = imageData;
  const size = width * height;

  const mask = new Uint8Array(size);
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    if (isRed(data[p], data[p + 1], data[p + 2], opts)) mask[i] = 1;
  }

  const stack = new Int32Array(size);
  const blobs = [];

  for (let start = 0; start < size; start++) {
    if (mask[start] !== 1) continue;

    let top = 0;
    stack[top++] = start;
    mask[start] = 2;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const n = ny * width + nx;
          if (mask[n] === 1) {
            mask[n] = 2;
            stack[top++] = n;
          }
        }
      }
    }

    if (area < opts.minArea || area > opts.maxArea) continue;
    blobs.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      area,
      dots: 1,
    });
  }

  if (opts.splitMergedBlobs && blobs.length > 0) estimateDotsPerBlob(blobs, opts);

  return {
    count: blobs.reduce((total, blob) => total + blob.dots, 0),
    blobs,
  };
}
