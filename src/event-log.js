export const LOG_KEY = 'alarm-event-log-v1';
export const LOG_LIMIT = 500;
export const EVENT_TYPES = { 'red-dot': '小地圖紅點', route: '滑鼠測試', check: '測謊／怪物確認', rune: '符文詛咒', stalled: '畫面中斷' };

export function createEventLog(storage, onError = () => {}) {
  let entries = [];
  try {
    const raw = JSON.parse(storage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(raw)) entries = raw.filter(e => e && typeof e.time === 'string' && Number.isFinite(Date.parse(e.time)) && typeof e.tag === 'string' && typeof e.title === 'string' && typeof e.body === 'string')
      .slice(0, LOG_LIMIT).map(e => ({ time: e.time, tag: e.tag.slice(0, 80), title: e.title.slice(0, 200), body: e.body.slice(0, 1000), test: e.test === true }));
  } catch { onError('無法讀取舊紀錄'); }
  function save() { try { storage.setItem(LOG_KEY, JSON.stringify(entries)); } catch { onError('紀錄儲存失敗，目前僅保留於本次工作階段'); } }
  return {
    list: () => entries.map(e => ({ ...e })),
    add(event, date = new Date()) {
      const row = { time: date.toISOString(), tag: String(event.tag || 'alert').slice(0, 80), title: String(event.title || '').slice(0, 200), body: String(event.body || '').slice(0, 1000), test: event.test === true };
      entries.unshift(row); entries.length = Math.min(entries.length, LOG_LIMIT); save(); return row;
    },
    clear() { entries = []; save(); },
  };
}

export function logCsv(entries) {
  const cell = value => '"' + String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const rows = [['時間 (ISO 8601)', '種類', '模式', '標題', '內容'], ...entries.map(e => [e.time, EVENT_TYPES[e.tag] || e.tag, e.test ? '測試' : '實際', e.title, e.body])];
  return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}
