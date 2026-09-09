// Geometry for the minimap selection. Regions are stored in normalised 0..1
// coordinates so a saved selection survives a change of capture resolution.

// A drag smaller than this is treated as a stray click, not a selection.
export const MIN_REGION_SIZE = 0.01;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Returns the rendered image bounds for object-fit: contain. */
export function containRect(containerWidth, containerHeight, sourceWidth, sourceHeight) {
  if (containerWidth <= 0 || containerHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** Turns two normalised drag points into a rect, or null if the drag was too small. */
export function rectFromPoints(start, end) {
  const left = clamp01(Math.min(start.x, end.x));
  const top = clamp01(Math.min(start.y, end.y));
  const right = clamp01(Math.max(start.x, end.x));
  const bottom = clamp01(Math.max(start.y, end.y));

  const width = right - left;
  const height = bottom - top;
  if (width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) return null;

  return { x: left, y: top, width, height };
}

/** Converts a normalised region into an integer pixel rect inside a frame. */
export function toPixelRect(region, sourceWidth, sourceHeight) {
  const x = Math.min(sourceWidth - 1, Math.max(0, Math.round(region.x * sourceWidth)));
  const y = Math.min(sourceHeight - 1, Math.max(0, Math.round(region.y * sourceHeight)));

  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(region.width * sourceWidth), sourceWidth - x)),
    height: Math.max(1, Math.min(Math.round(region.height * sourceHeight), sourceHeight - y)),
  };
}
