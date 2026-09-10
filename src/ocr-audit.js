const KEY = 'the-magic-of-love-ocr-audit-v1';
const MAX_ROWS = 2000;
const MAX_CHARS = 1800000;

export function createOcrAudit({ storage, onStatus = () => {} }) {
  let rows = [], dropped = 0, sequence = 0;
  try {
    const saved = JSON.parse(storage.getItem(KEY) || '{}');
    if (Array.isArray(saved.rows)) rows = saved.rows.slice(-MAX_ROWS);
    dropped = Number(saved.dropped) || 0;
    sequence = Number(saved.sequence) || 0;
  } catch { /* A broken diagnostic archive must not stop recording. */ }
  onStatus(`辨識追查 ${rows.length} 筆${dropped ? `（較早 ${dropped} 筆已輪替）` : ''}`);
  function flush() {
    let payload = JSON.stringify({ version: 1, sequence, dropped, rows });
    while (payload.length > MAX_CHARS && rows.length > 1) {
      const count = Math.max(1, Math.floor(rows.length / 10));
      rows.splice(0, count); dropped += count;
      payload = JSON.stringify({ version: 1, sequence, dropped, rows });
    }
    try {
      storage.setItem(KEY, payload);
      onStatus(`辨識追查 ${rows.length} 筆${dropped ? `（較早 ${dropped} 筆已輪替）` : ''}`);
    } catch {
      onStatus('辨識追查僅保留於記憶體，請先匯出再重新整理');
    }
  }
  return {
    add(event) {
      rows.push({ ...event, sequence: ++sequence });
      if (rows.length > MAX_ROWS) { rows.shift(); dropped++; }
      flush();
    },
    snapshot() { return { version: 1, exportedAt: new Date().toISOString(), dropped, rows: structuredClone(rows) }; },
  };
}
