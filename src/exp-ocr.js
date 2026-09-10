import { parseExp, parseMeso } from './exp-log.js';
import { createPickupLogTracker } from './pickup.js';
import { createOcrAudit } from './ocr-audit.js';

const OCR_INTERVAL_MS = 250;
const HIGH_CONFIDENCE = 70;
const TARGETS = {
  exp: { label: 'EXP', parse: parseExp },
  meso: { label: '金錢', parse: parseMeso },
};

export function evaluateOcrReading({ target, text, confidence, previous }) {
  const value = TARGETS[target]?.parse(text) ?? null;
  if (value === null) return { value: null, accepted: false, reason: '格式不符' };
  const structuredExp = target === 'exp' && /\d+(?:\.\d+)?%/.test(String(text));
  const stable = previous?.value === value;
  return {
    value,
    accepted: confidence >= HIGH_CONFIDENCE || structuredExp || stable,
    reason: confidence >= HIGH_CONFIDENCE || structuredExp ? '格式有效' : stable ? '連續兩次一致' : '等待再次確認',
  };
}

export function createExpOcr({ root, accept, storage = localStorage, session = () => ({}), records = () => [] }) {
  const canvases = Object.fromEntries(Object.keys(TARGETS).map(target => [target, root.querySelector(`[data-exp-preview-${target}]`)]));
  const statuses = Object.fromEntries(Object.keys(TARGETS).map(target => [target, root.querySelector(`[data-exp-ocr-status-${target}]`)]));
  const enabled = root.querySelector('[data-exp-auto]');
  let regions = loadRegions(storage), worker = null, busy = false, last = -Infinity, revision = 0;
  let tracker = createPickupLogTracker();
  const auditStatus = root.querySelector('[data-ocr-audit-status]');
  const audit = createOcrAudit({ storage, onStatus: text => { if (auditStatus) auditStatus.textContent = text; } });
  const auditEvent = event => audit.add({ at: new Date().toISOString(), ...event, session: session() });
  const exportButton = root.querySelector('[data-ocr-audit-export]');
  if (exportButton) exportButton.onclick = () => {
    const payload = { ...audit.snapshot(), algorithm: 'pickup-lines-v3', records: records() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `ocr-audit-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function loadRegions(store) {
    try {
      const parsed = JSON.parse(store.getItem('the-magic-of-love-pickup-regions-v1') || '{}');
      return Object.fromEntries(Object.keys(TARGETS).map(target => [target, validRegion(parsed[target]) ? parsed[target] : null]));
    } catch {
      return { exp: null, meso: null };
    }
  }

  function validRegion(value) {
    return value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
      && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0
      && value.x + value.width <= 1 && value.y + value.height <= 1;
  }

  function saveRegions() {
    try { storage.setItem('the-magic-of-love-pickup-regions-v1', JSON.stringify(regions)); } catch { /* Ignore private-mode storage failures. */ }
  }

  async function ensureWorker() {
    if (worker) return worker;
    for (const target of Object.keys(TARGETS)) if (regions[target]) statuses[target].textContent = '載入辨識模型…';
    if (!globalThis.Tesseract) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('辨識元件載入失敗，請檢查網路')); };
      document.head.append(script);
    });
    worker = await globalThis.Tesseract.createWorker('chi_tra+eng');
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return worker;
  }

  async function process(source, width, height) {
    const selected = Object.keys(TARGETS).filter(target => regions[target]);
    if (!enabled.checked || !selected.length || busy || performance.now() - last < OCR_INTERVAL_MS) return;
    busy = true;
    last = performance.now();
    const token = revision;
    const capturedAt = new Date().toISOString();
    const captureSession = session();
    const started = performance.now();
    try {
      // A MediaStreamTrackProcessor VideoFrame is closed as soon as this call
      // returns. Copy every selected ROI before the first await.
      for (const target of selected) {
        const r = regions[target];
        const canvas = canvases[target];
        const scale = Math.min(3, 1600 / (r.width * width));
        canvas.width = Math.max(1, Math.round(r.width * width * scale));
        canvas.height = Math.max(1, Math.round(r.height * height * scale));
        canvas.getContext('2d').drawImage(source, r.x * width, r.y * height, r.width * width, r.height * height, 0, 0, canvas.width, canvas.height);
      }

      const recognizer = await ensureWorker();
      const { data } = await recognizer.recognize(canvases[selected[0]]);
      if (token !== revision || !enabled.checked) {
        auditEvent({ type: 'ocr', capturedAt, captureSession, rawText: data.text, decision: 'cancelled', reason: '辨識期間設定已變更' });
        return;
      }
      const result = tracker.read(data.text, { confidence: data.confidence });
      for (const target of Object.keys(TARGETS)) {
        const values = result.lines.filter(line => line.target === target).map(line => `+${line.value}`);
        statuses[target].textContent = `${values.length ? values.join('、') : '未辨識到此類提示'} · ${result.reason}`;
      }
      const currentSession = session();
      const sameSession = captureSession.startTime === currentSession.startTime && captureSession.active === currentSession.active;
      const entry = sameSession && Object.keys(result.gains).length ? accept(result.gains) : null;
      auditEvent({ type: 'ocr', capturedAt, captureSession, durationMs: Math.round(performance.now() - started),
        region: { ...regions[selected[0]] }, sourceSize: { width, height }, rawText: data.text,
        confidence: data.confidence, parsed: result.lines, decision: sameSession ? result.decision : 'session-changed',
        reason: result.reason, proposedGains: result.gains, recorded: entry ?? null });
    } catch (error) {
      auditEvent({ type: 'error', capturedAt, message: error.message });
      for (const target of selected) statuses[target].textContent = error.message;
      enabled.checked = false;
    }
    finally { busy = false; }
  }

  function refreshStatuses() {
    for (const [target, config] of Object.entries(TARGETS)) {
      statuses[target].textContent = enabled.checked
        ? (regions[target] ? '等待通知區文字' : '請框選完整獲得通知區（含中文字與數字）')
        : (regions[target] ? '已設定範圍，尚未啟用' : '尚未設定範圍');
    }
  }

  enabled.onchange = () => { revision++; auditEvent({ type: 'auto-toggle', enabled: enabled.checked }); refreshStatuses(); };
  refreshStatuses();
  return {
    process,
    audit: auditEvent,
    region(target) { return regions[target] ?? null; },
    select(target, value) {
      if (!TARGETS[target] || !validRegion(value)) return;
      regions.exp = value;
      regions.meso = value;
      tracker = createPickupLogTracker();
      revision++;
      saveRegions();
      auditEvent({ type: 'region', region: { ...value } });
      for (const status of Object.values(statuses)) status.textContent = '已設定共用獲得通知區';
    },
  };
}
