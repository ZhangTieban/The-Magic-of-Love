const STORAGE_KEY = 'the-magic-of-love-exp-log-v1';
const LIMIT = 1000;

const NUMBER_FIELDS = ['exp', 'hp', 'mp', 'meso'];

function toNumber(value) {
  const number = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function parseExp(text) {
  const match = String(text).trim().match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:(?:\s+|\s*[\[(])\d+(?:\.\d+)?%[\])]?)?$/);
  const value = match ? Number(match[1].replaceAll(',', '')) : NaN;
  return Number.isSafeInteger(value) ? value : null;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('zh-TW');
}

function formatDuration(ms) {
  if (ms <= 0) return '0分0秒';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${seconds % 60}秒`;
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = typeof raw.time === 'string' && Number.isFinite(Date.parse(raw.time)) ? raw.time : null;
  if (!time) return null;
  return {
    time,
    session: Number.isFinite(raw.session) ? raw.session : null,
    exp: toNumber(raw.exp),
    hp: toNumber(raw.hp),
    mp: toNumber(raw.mp),
    meso: toNumber(raw.meso),
    note: String(raw.note ?? '').slice(0, 120),
  };
}

function load(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(sanitizeEntry).filter(Boolean).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function save(storage, entries) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Private-mode storage failures should not break live tracking.
  }
}

function delta(entries, minutes) {
  if (entries.length < 2) return null;
  const newest = entries[0];
  const newestTime = Date.parse(newest.time);
  const cutoff = newestTime - minutes * 60 * 1000;
  const oldest = [...entries].reverse().find(entry => Date.parse(entry.time) >= cutoff) ?? entries.at(-1);
  const elapsedMs = newestTime - Date.parse(oldest.time);
  if (elapsedMs <= 0) return null;
  return { newest, oldest, elapsedMs };
}

function perMinute(newest, oldest, elapsedMs, field) {
  return ((newest[field] - oldest[field]) / elapsedMs) * 60000;
}

function csvEscape(value) {
  return `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
}

export function expLogCsv(entries) {
  return '\uFEFF' + [
    ['時間 (ISO 8601)', 'EXP', 'HP', 'MP', '金錢', '備註'],
    ...entries.map(entry => [entry.time, entry.exp, entry.hp, entry.mp, entry.meso, entry.note]),
  ].map(row => row.map(csvEscape).join(',')).join('\r\n');
}

export function createExpLog({ root, storage = localStorage, now = () => new Date() }) {
  let entries = load(storage);
  let active = false;
  let startTime = entries[0]?.session ?? null;

  const el = selector => root.querySelector(selector);
  const inputs = Object.fromEntries(NUMBER_FIELDS.map(field => [field, el(`[data-exp-${field}]`)]));
  const noteInput = el('[data-exp-note]');
  const rows = el('[data-exp-rows]');
  const empty = el('[data-exp-empty]');
  const status = el('[data-exp-status]');
  const startedAt = el('[data-exp-started]');
  const elapsed = el('[data-exp-elapsed]');
  const perMin = el('[data-exp-per-min]');
  const projection10 = el('[data-exp-proj-10]');
  const projection60 = el('[data-exp-proj-60]');
  const totals = el('[data-exp-totals]');
  const samples = el('[data-exp-samples]');

  function newest() {
    return entries[0] ?? null;
  }

  function updateInputsFromNewest() {
    const entry = newest();
    if (!entry) return;
    for (const field of NUMBER_FIELDS) inputs[field].value = String(entry[field]);
  }

  function renderStats() {
    const session = entries.filter(entry => !startTime || Date.parse(entry.time) >= startTime);
    const all = delta(session, Number.POSITIVE_INFINITY);
    const last10 = delta(session, 10);
    const last60 = delta(session, 60);
    const base = last10 ?? last60 ?? all;
    const sinceStart = active && startTime ? now() - startTime : (all?.elapsedMs ?? 0);

    startedAt.textContent = startTime ? new Date(startTime).toLocaleTimeString('zh-TW', { hour12: false }) : '--:--:--';
    elapsed.textContent = formatDuration(sinceStart);
    samples.textContent = `${entries.length} 筆`;

    if (!base) {
      perMin.textContent = 'EXP 0　HP 0　MP 0　金錢 0';
      projection10.textContent = 'EXP 0　HP 0　MP 0　金錢 0';
      projection60.textContent = 'EXP 0　HP 0　MP 0　金錢 0';
      totals.textContent = 'EXP 0　HP 0　MP 0　金錢 0';
      return;
    }

    const rates = Object.fromEntries(NUMBER_FIELDS.map(field => [field, perMinute(base.newest, base.oldest, base.elapsedMs, field)]));
    perMin.textContent = `EXP ${formatNumber(rates.exp)}　HP ${formatNumber(rates.hp)}　MP ${formatNumber(rates.mp)}　金錢 ${formatNumber(rates.meso)}`;
    projection10.textContent = `EXP ${formatNumber(rates.exp * 10)}　HP ${formatNumber(rates.hp * 10)}　MP ${formatNumber(rates.mp * 10)}　金錢 ${formatNumber(rates.meso * 10)}`;
    projection60.textContent = `EXP ${formatNumber(rates.exp * 60)}　HP ${formatNumber(rates.hp * 60)}　MP ${formatNumber(rates.mp * 60)}　金錢 ${formatNumber(rates.meso * 60)}`;
    totals.textContent = `EXP ${formatNumber(base.newest.exp - all.oldest.exp)}　HP ${formatNumber(base.newest.hp - all.oldest.hp)}　MP ${formatNumber(base.newest.mp - all.oldest.mp)}　金錢 ${formatNumber(base.newest.meso - all.oldest.meso)}`;
  }

  function renderRows() {
    rows.replaceChildren();
    for (const entry of entries.slice(0, 50)) {
      const tr = document.createElement('tr');
      const values = [
        new Date(entry.time).toLocaleString('zh-TW', { hour12: false }),
        formatNumber(entry.exp),
        formatNumber(entry.hp),
        formatNumber(entry.mp),
        formatNumber(entry.meso),
        entry.note,
      ];
      for (const value of values) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      rows.append(tr);
    }
    empty.hidden = entries.length > 0;
  }

  function render() {
    renderStats();
    renderRows();
  }

  function record(note = noteInput.value) {
    if (parseExp(inputs.exp.value) === null) {
      status.textContent = '請輸入有效的整數 EXP';
      return null;
    }
    if (entries[0] && Date.parse(entries[0].time) >= startTime && Number(inputs.exp.value) < entries[0].exp) {
      status.textContent = 'EXP 下降：請確認讀值；升級後請開始新一輪紀錄';
      return null;
    }
    const entry = {
      session: startTime,
      time: now().toISOString(),
      exp: toNumber(inputs.exp.value),
      hp: toNumber(inputs.hp.value),
      mp: toNumber(inputs.mp.value),
      meso: toNumber(inputs.meso.value),
      note: String(note ?? '').trim().slice(0, 120),
    };
    entries.unshift(entry);
    entries.length = Math.min(entries.length, LIMIT);
    save(storage, entries);
    status.textContent = `已紀錄 ${new Date(entry.time).toLocaleTimeString('zh-TW', { hour12: false })}`;
    render();
    return entry;
  }

  el('[data-exp-start]').onclick = () => {
    if (parseExp(inputs.exp.value) === null) { status.textContent = '請先輸入目前 EXP 或啟用自動讀值'; return; }
    active = true;
    startTime = now().getTime();
    record('起始');
    status.textContent = '已開始紀錄';
    render();
  };
  el('[data-exp-stop]').onclick = () => { active = false; renderStats(); status.textContent = '已暫停'; };
  el('[data-exp-delete]').onclick = () => { entries.shift(); save(storage, entries); render(); };

  el('[data-exp-record]').onclick = () => record();
  el('[data-exp-use-latest]').onclick = updateInputsFromNewest;
  el('[data-exp-clear]').onclick = () => {
    entries = [];
    active = false;
    startTime = null;
    save(storage, entries);
    status.textContent = '已清除經驗值紀錄';
    render();
  };
  el('[data-exp-export]').onclick = () => {
    const url = URL.createObjectURL(new Blob([expLogCsv(entries)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `exp-log-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  updateInputsFromNewest();
  render();
  const timer = setInterval(renderStats, 1000);

  return { record, list: () => entries.map(entry => ({ ...entry })), get active() { return active; },
    accept(value) { inputs.exp.value = String(value); if (active) record('自動讀值'); },
    destroy() { clearInterval(timer); } };
}
