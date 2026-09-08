import { normalizeRegion } from './settings.js';
import { toPixelRect } from './region.js';
import { createAlertGate } from './alert-gate.js';

const TYPES = [
  ['route', '滑鼠測試', [0, 0, 533, 526]],
  ['check', '測謊／怪物名稱確認', [380, 213, 690, 220]],
  ['rune', '符文詛咒紫色橫幅', [450, 330, 1650, 240]],
];
const KEY = 'ms-warning-regions-v1';
const clamp = (v, fallback, lo, hi) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
export function normalizeWarning(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const minScale = clamp(raw.minScale, 0.2, 0.05, 1);
  return { enabled: raw.enabled === true, region: normalizeRegion(raw.region),
    threshold: clamp(raw.threshold, 0.8, 0.1, 1), stableFrames: Math.round(clamp(raw.stableFrames, 2, 1, 10)),
    clearStableFrames: Math.round(clamp(raw.clearStableFrames, 3, 1, 10)),
    cooldown: clamp(raw.cooldown, 30, 0, 3600), minScale,
    maxScale: Math.max(minScale, clamp(raw.maxScale, 1, 0.05, 1)),
    sample: typeof raw.sample === 'string' && raw.sample.startsWith('data:image/png;base64,') && raw.sample.length < 300000 ? raw.sample : null };
}

export function createWarnings({ container, fire, channels, onAlert, onState = () => {}, onChange = () => {}, storage = localStorage, assetBase = 'assets/warnings/' }) {
  let saved = {};
  try { saved = JSON.parse(storage.getItem(KEY)) || {}; } catch {}
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const states = TYPES.map(([id, name, crop]) => ({ id, name, crop, config: normalizeWarning(saved[id]), template: null, gate: createAlertGate(), result: null }));
  let generation = 0, busy = false;
  const worker = new Worker(new URL('./warning-worker.js', import.meta.url), { type: 'module' });
  worker.onerror = () => {
    busy = false;
    for (const s of states) { s.result = null; s.status.textContent = '警告比對程序發生錯誤，請重新整理'; }
  };
  worker.onmessage = ({ data }) => {
    busy = false;
    if (data.generation !== generation) return;
    if (data.error) { for (const s of states) s.status.textContent = `比對失敗：${data.error}`; return; }
    for (const { id, result } of data.results) {
      const s = states.find(s => s.id === id), c = s.config;
      s.result = result;
      const hit = result.score >= c.threshold;
      s.status.textContent = `${hit ? '命中' : '搜尋中'}　相似度 ${result.score.toFixed(3)} ／ ${c.threshold.toFixed(2)}`;
      s.status.className = hit ? 'warn' : 'muted';
      s.gate.configure({
        threshold: 1,
        stableFrames: c.stableFrames,
        clearStableFrames: c.clearStableFrames,
        cooldownMs: c.cooldown * 1000,
      });
      const wasActive = s.gate.isActive();
      const shouldNotify = s.gate.update(hit ? 1 : 0, performance.now());
      const isActive = s.gate.isActive();
      const body = `警告畫面命中，相似度 ${result.score.toFixed(3)}`;
      if (isActive !== wasActive) onState({ id: s.id, name: s.name, active: isActive, title: s.name, body, tag: s.id });
      if (shouldNotify) {
        fire({ title: s.name, body, tag: s.id, channels: channels() });
        onAlert(s.name);
      }
    }
    onChange();
  };
  function persist() {
    try { storage.setItem(KEY, JSON.stringify(Object.fromEntries(states.map(s => [s.id, s.config])))); }
    catch { document.getElementById('warningStorage').textContent = '儲存失敗：目前設定僅於本次有效'; }
  }
  function resetGate(s) {
    if (s.gate?.isActive()) onState({ id: s.id, name: s.name, active: false, title: s.name, body: '', tag: s.id });
    s.gate = createAlertGate();
  }
  async function load(s) {
    const revision = s.loadRevision = (s.loadRevision || 0) + 1;
    s.template = null;
    try {
      const img = new Image();
      img.src = s.config.sample || `${assetBase}${s.id === 'route' ? 'mouse-test' : s.id}.png`;
      await img.decode();
      if (s.loadRevision !== revision) return;
      const [x, y, w, h] = s.config.sample ? [0, 0, img.width, img.height] : s.crop;
      const c = document.createElement('canvas'); c.width = 160; c.height = Math.max(12, Math.round(160 * h / w));
      const context = c.getContext('2d', { willReadFrequently: true });
      context.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      s.template = context.getImageData(0, 0, c.width, c.height);
      s.card.querySelector('img').src = c.toDataURL();
      s.status.textContent = s.config.region ? '待機中' : '尚未設定搜尋區';
    } catch { s.status.textContent = '樣本載入失敗'; }
  }
  const loads = [];
  for (const s of states) {
    const card = document.createElement('div'); card.className = 'warning-row'; s.card = card;
    card.innerHTML = `<h3>${s.name}</h3><img alt="${s.name}比對樣本"><div class="toggles"><label class="toggle"><input type="checkbox" data-field="enabled">啟用</label><button type="button" data-test>測試警報</button><button type="button" data-reset>還原樣本</button><button type="button" data-clear>清除搜尋區</button></div><div class="grid"></div><output aria-live="off"></output>`;
    const fields = [['threshold', '相似度門檻', 0.1, 1, 0.01], ['stableFrames', '連續命中幀數', 1, 10, 1], ['clearStableFrames', '連續消失幀數', 1, 10, 1], ['cooldown', '冷卻秒數', 0, 3600, 1], ['minScale', '樣本最小寬度／搜尋區', 0.05, 1, 0.05], ['maxScale', '樣本最大寬度／搜尋區', 0.05, 1, 0.05]];
    card.querySelector('.grid').innerHTML = fields.map(([key, label, min, max, step]) => `<label>${label}<input data-field="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`).join('');
    for (const input of card.querySelectorAll('[data-field]')) {
      const key = input.dataset.field;
      if (key === 'enabled') input.checked = s.config[key]; else input.value = s.config[key];
      input.addEventListener('change', () => {
        s.config[key] = key === 'enabled' ? input.checked : Number(input.value);
        s.config = normalizeWarning(s.config);
        for (const field of card.querySelectorAll('input[type=number]')) field.value = s.config[field.dataset.field];
        generation++; s.result = null;
        if (key === 'enabled') resetGate(s);
        s.status.textContent = s.config.enabled ? (s.config.region ? '等待畫面' : '尚未設定搜尋區') : '已停用';
        persist(); onChange();
      });
    }
    card.querySelector('[data-test]').onclick = () => fire({ title: s.name, body: '測試警報', tag: s.id, test: true, channels: channels() });
    card.querySelector('[data-reset]').onclick = () => { generation++; s.config.sample = null; s.result = null; resetGate(s); persist(); load(s); onChange(); };
    card.querySelector('[data-clear]').onclick = () => { generation++; s.config.region = null; resetGate(s); s.result = null; s.status.textContent = '尚未設定搜尋區'; persist(); onChange(); };
    s.status = card.querySelector('output'); container.append(card); loads.push(load(s));
  }
  return {
    states,
    ready: Promise.all(loads),
    reset() { generation++; for (const s of states) { resetGate(s); s.result = null; s.status.textContent = s.template ? '待機中' : '樣本未載入'; } },
    select(id, region, sample, video) {
      const s = states.find(s => s.id === id); if (!s) return;
      generation++; s.result = null;
      if (sample) {
        const r = toPixelRect(region, video.videoWidth, video.videoHeight);
        const scale = Math.min(160 / r.width, 320 / r.height);
        canvas.width = Math.max(1, Math.round(r.width * scale)); canvas.height = Math.max(1, Math.round(r.height * scale));
        ctx.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
        s.config.sample = canvas.toDataURL(); load(s);
      } else { s.config.region = region; s.status.textContent = '搜尋區已設定'; }
      resetGate(s); persist();
    },
    process(drawable, width, height) {
      if (busy) return;
      const jobs = [];
      for (const s of states) {
        const c = s.config;
        if (!c.enabled || !c.region || !s.template) { s.result = null; continue; }
        const r = toPixelRect(c.region, width, height);
        const scale = Math.min(1, 360 / r.width, 360 / r.height);
        canvas.width = Math.max(1, Math.round(r.width * scale)); canvas.height = Math.max(1, Math.round(r.height * scale));
        ctx.drawImage(drawable, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        s.searchSize = { width: canvas.width, height: canvas.height };
        jobs.push({ id: s.id, image, template: s.template, config: c });
      }
      if (jobs.length) { worker.postMessage({ jobs, generation }, jobs.map(j => j.image.data.buffer)); busy = true; }
    },
  };
}
