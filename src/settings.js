// Settings shape, validation and persistence. Anything read back from storage
// is untrusted, so every value is clamped before it reaches the detector.

import { DEFAULT_OPTIONS as DETECT_DEFAULTS } from './detect.js';
import { DEFAULT_ALERT_OPTIONS } from './alert-gate.js';
import { MIN_REGION_SIZE } from './region.js';

// Bumped whenever the detector calibration changes, so options saved by an
// earlier version are dropped rather than keeping the old behaviour alive.
export const SETTINGS_VERSION = 7;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  threshold: DEFAULT_ALERT_OPTIONS.threshold,
  stableFrames: DEFAULT_ALERT_OPTIONS.stableFrames,
  cooldownSeconds: DEFAULT_ALERT_OPTIONS.cooldownMs / 1000,
  sampleFps: 4,
  soundVolume: 80,
  soundSeconds: 6,
  notifySystem: true,
  notifySound: true,
  notifyFlash: true,
  region: null,
  detect: { ...DETECT_DEFAULTS },
};

// [min, max, integer]
const RANGES = {
  threshold: [1, 99, true],
  stableFrames: [1, 10, true],
  cooldownSeconds: [0, 3600, true],
  sampleFps: [1, 10, true],
  soundVolume: [0, 100, true],
  soundSeconds: [1, 30, true],
};

const DETECT_RANGES = {
  hueTolerance: [0, 60, false],
  minSaturation: [0, 1, false],
  minValue: [0, 1, false],
  minArea: [1, 10000, true],
  maxArea: [1, 100000, true],
  mergeThreshold: [1, 10, false],
};

function clampNumber(value, fallback, [min, max, integer]) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

function normalizeGroup(raw, defaults, ranges) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result = {};

  for (const [key, fallback] of Object.entries(defaults)) {
    const value = source[key];
    if (typeof fallback === 'boolean') {
      result[key] = typeof value === 'boolean' ? value : fallback;
    } else if (ranges[key]) {
      result[key] = clampNumber(value, fallback, ranges[key]);
    } else {
      result[key] = fallback;
    }
  }
  return result;
}

/** Accepts a region only if it is a rect that fits inside the frame. */
export function normalizeRegion(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const { x, y, width, height } = raw;
  const numbers = [x, y, width, height];
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (x < 0 || y < 0 || width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) return null;
  if (x + width > 1 || y + height > 1) return null;

  return { x, y, width, height };
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { version, region, detect, ...scalars } = DEFAULT_SETTINGS;
  const storedDetect = source.version === SETTINGS_VERSION ? source.detect : undefined;
  const detectOptions = normalizeGroup(storedDetect, DETECT_DEFAULTS, DETECT_RANGES);
  const scalarSource = source.version === SETTINGS_VERSION
    ? source
    : { ...source, stableFrames: DEFAULT_SETTINGS.stableFrames };

  // An inverted area range matches no blob at all, which would leave the app
  // reporting zero dots for ever without saying why. Widening the upper bound
  // errs towards a false alarm, which is the failure a watcher can survive.
  detectOptions.maxArea = Math.max(detectOptions.minArea, detectOptions.maxArea);

  return {
    version: SETTINGS_VERSION,
    ...normalizeGroup(scalarSource, scalars, RANGES),
    region: normalizeRegion(source.region),
    detect: detectOptions,
  };
}

export const STORAGE_KEY = 'the-magic-of-love-settings';

/** Reads settings from a localStorage-like store, falling back to defaults. */
export function loadSettings(storage) {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return normalizeSettings(stored ? JSON.parse(stored) : undefined);
  } catch {
    return normalizeSettings(undefined);
  }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // Private-mode storage failures must not break detection.
  }
}
