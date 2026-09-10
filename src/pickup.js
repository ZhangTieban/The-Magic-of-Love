// Each crop contains one notification's amount, not a balance or an EXP bar.
export function parsePickup(text) {
  const match = String(text ?? '').trim().match(/^\+?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*$/);
  const value = match ? Number(match[1].replaceAll(',', '')) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function createPickupGate() {
  let counted = null, candidate = null, hits = 0, blanks = 0;
  return {
    read(text, confidence) {
      const value = parsePickup(text);
      if (value === null) {
        candidate = null;
        hits = 0;
        // An unreadable nonempty frame is not proof that a notification ended.
        blanks = String(text ?? '').trim() === '' ? blanks + 1 : 0;
        if (blanks >= 2) counted = null;
        return { value: null, reason: '等待獲得提示' };
      }
      blanks = 0;
      hits = candidate === value ? hits + 1 : 1;
      candidate = value;
      if (value === counted) return { value: null, reason: '此提示已計入' };
      if (confidence < 70 && hits < 2) return { value: null, reason: '等待再次確認' };
      // Require confirmation when an existing notification changes digits.
      if (counted !== null && hits < 2) return { value: null, reason: '等待新提示確認' };
      counted = value;
      return { value, reason: `本次獲得 +${value.toLocaleString('zh-TW')}` };
    },
  };
}

export function pickupStats(entries, elapsedMs) {
  const totals = Object.fromEntries(['exp', 'hp', 'mp', 'meso'].map(field => [field,
    entries.reduce((sum, entry) => sum + (entry[field] || 0), 0)]));
  const rates = Object.fromEntries(Object.entries(totals).map(([field, value]) =>
    [field, elapsedMs > 0 ? value * 60000 / elapsedMs : 0]));
  return { totals, rates };
}

export function parsePickupLines(text) {
  return String(text ?? '').normalize('NFKC').split(/\r?\n/).map(line => {
    const normalized = line.replace(/\s/g, '');
    if (!normalized) return null;
    const target = /經驗|经验/.test(normalized) ? 'exp' : /金[幣币]|楓幣|枫币/.test(normalized) ? 'meso' : null;
    // Require a positive parenthesized amount to exclude item names and balances.
    const match = normalized.match(/\(\+([\d,]+)\)/);
    const value = match ? parsePickup(match[1]) : null;
    if (target && value !== null) return { key: `${target}:${value}`, target, value };
    if (/已獲得其他道具|已获得其他道具/.test(normalized)) return { key: normalized, target: null, value: 0 };
    return null;
  }).filter(Boolean);
}

export function createPickupLogTracker() {
  let previous = [], pending = new Map(), unanchored = '', lostFrames = 0;
  return {
    read(text, { confidence = 0 } = {}) {
      const lines = parsePickupLines(text);
      if (!lines.length) {
        pending.clear();
        // OCR blanks do not prove that previously counted notifications vanished.
        return { gains: {}, reason: String(text ?? '').trim() ? '有文字，但未辨識到經驗值／金幣與 (+數字)' : '未讀到文字，保留去重紀錄', lines: [], decision: 'unreadable' };
      }
      let overlap = Math.min(previous.length, lines.length);
      while (overlap && !previous.slice(-overlap).every((key, i) => key === lines[i].key)) overlap--;
      let start = overlap;
      if (previous.length && !overlap) {
        // Recover correspondence across missing/intermittently unreadable rows.
        // Only rows after the last matched row can represent new notifications.
        const dp = Array.from({ length: previous.length + 1 }, () => new Uint16Array(lines.length + 1));
        for (let i = previous.length - 1; i >= 0; i--) for (let j = lines.length - 1; j >= 0; j--) {
          dp[i][j] = previous[i] === lines[j].key ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
        if (!dp[0][0]) {
          const signature = JSON.stringify(lines.map(line => line.key));
          lostFrames = unanchored === signature ? lostFrames + 1 : 1;
          unanchored = signature;
          pending.clear();
          if (lostFrames >= 2 && confidence >= 70 && lines.filter(line => line.target).length >= 2) {
            previous = lines.map(line => line.key);
            lostFrames = 0;
            const gains = {};
            for (const line of lines) if (line.target) gains[line.target] = (gains[line.target] || 0) + line.value;
            return { gains, lines, added: lines, decision: 'accepted-rollover', reason: '整批新提示已確認' };
          }
          if (lostFrames >= 3) { previous = lines.map(line => line.key); lostFrames = 0; }
          return { gains: {}, lines, decision: 'uncertain', reason: '無法確認是否新提示，略過並重新對齊' };
        }
        let i = 0, j = 0;
        while (i < previous.length && j < lines.length) {
          if (previous[i] === lines[j].key) { start = j + 1; i++; j++; }
          else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
          else j++;
        }
      }
      lostFrames = 0;
      unanchored = '';
      const added = lines.slice(start);
      const nextPending = new Map(), occurrences = new Map();
      const confirmed = [];
      let waiting = false;
      for (const line of added) {
        const ordinal = occurrences.get(line.key) || 0;
        occurrences.set(line.key, ordinal + 1);
        const id = `${line.key}#${ordinal}`;
        const hits = (pending.get(id) || 0) + 1;
        nextPending.set(id, hits);
        if (hits < 2) waiting = true;
        if (!waiting) confirmed.push(line);
      }
      pending = nextPending;
      // Keep missing rows in the history so their reappearance cannot add them again.
      if (confirmed.length) {
        previous = [...lines.slice(0, start), ...confirmed].map(line => line.key).slice(-64);
        pending.clear();
      }
      const gains = {};
      for (const line of confirmed) if (line.target) gains[line.target] = (gains[line.target] || 0) + line.value;
      return { gains, reason: confirmed.length ? '已計入新增提示' : added.length ? '新增行等待確認' : '提示未新增，不重複計入', lines,
        decision: confirmed.length ? 'accepted' : added.length ? 'pending' : 'duplicate', added: confirmed };
    },
  };
}
