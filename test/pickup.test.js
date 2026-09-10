import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickupGate, parsePickup, pickupStats, parsePickupLines, createPickupLogTracker } from '../src/pickup.js';
import { createExpLog } from '../src/exp-log.js';

test('pickup parser accepts gains and rejects balances with percentages or multiple lines', () => {
  assert.equal(parsePickup('+1,200'), 1200);
  for (const text of ['222060044[60.88%]', '100\n200', '-30', '1,20', '0']) assert.equal(parsePickup(text), null);
});

test('persistent and briefly unreadable notifications are counted once; repeated pickups after disappearance count again', () => {
  const gate = createPickupGate();
  const gains = ['100', '100', '?', '100', '', '100', '', '', '100'].map(text => gate.read(text, 95).value);
  assert.equal(gains.filter(value => value !== null).reduce((a, b) => a + b, 0), 200);
});

test('low confidence and changed notifications require confirmation', () => {
  const gate = createPickupGate();
  assert.equal(gate.read('100', 0).value, null);
  assert.equal(gate.read('100', 0).value, 100);
  assert.equal(gate.read('200', 95).value, null);
  assert.equal(gate.read('200', 95).value, 200);
});

test('sums the first pickup and repeated equal amounts, including idle time in rates', () => {
  assert.deepEqual(pickupStats([{ exp: 100, meso: 30 }, { exp: 100, meso: 20 }], 120000), {
    totals: { exp: 200, hp: 0, mp: 0, meso: 50 }, rates: { exp: 100, hp: 0, mp: 0, meso: 25 },
  });
});

test('recording starts without a balance, independent gains do not repeat stale fields, pause ignores pickups', () => {
  const nodes = new Map();
  const root = { querySelector(key) {
    if (!nodes.has(key)) nodes.set(key, { value: '', textContent: '', replaceChildren() {}, append() {} });
    return nodes.get(key);
  } };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ append() {} }) };
  let clock = 10000;
  const log = createExpLog({ root, storage: { getItem: () => null, setItem() {} }, now: () => new Date(clock) });
  try {
    root.querySelector('[data-exp-start]').onclick();
    clock += 1000;
    log.accept({ exp: 100 });
    clock += 1000;
    log.accept({ meso: 30 });
    clock += 1000;
    log.accept({ exp: 100 });
    assert.deepEqual(log.list().map(({ exp, meso }) => [exp, meso]), [[100, 0], [0, 30], [100, 0]]);
    root.querySelector('[data-exp-stop]').onclick();
    log.accept({ exp: 999 });
    assert.equal(log.list().length, 3);
    assert.match(root.querySelector('[data-exp-totals]').textContent, /EXP 200/);
  } finally { log.destroy(); globalThis.document = originalDocument; }
});

test('parses mixed Chinese multiline notifications from the supplied screenshot', () => {
  const text = '已獲得經驗值 (+70)\n已獲得經驗值 (+120)\n已獲得其他道具 (風獨眼獸之尾巴)\n已獲得金幣 (+120)\n已獲得金幣 (+139)\n已獲得金幣 (+128)\n已獲得金幣 (+106)';
  const tracker = createPickupLogTracker();
  assert.deepEqual(tracker.read(text).gains, {});
  assert.deepEqual(tracker.read(text).gains, { exp: 190, meso: 493 });
  assert.deepEqual(tracker.read(text).gains, {});
});

test('scroll overlap only counts new rows, including equal-valued new rows', () => {
  const tracker = createPickupLogTracker();
  const before = '已獲得經驗值 (+70)\n已獲得金幣 (+120)';
  tracker.read(before); tracker.read(before);
  const after = '已獲得金幣 (+120)\n已獲得經驗值 (+70)\n已獲得金幣 (+120)';
  tracker.read(after);
  assert.deepEqual(tracker.read(after).gains, { exp: 70, meso: 120 });
  const fewer = '已獲得經驗值 (+70)\n已獲得金幣 (+120)';
  tracker.read(fewer);
  assert.deepEqual(tracker.read(fewer).gains, {});
});

test('Chinese fullwidth punctuation works and item/balance numbers are excluded', () => {
  assert.deepEqual(parsePickupLines('已獲得經驗值（＋１２０）').map(line => line.value), [120]);
  assert.equal(parsePickupLines('EXP 222060044[60.88%]\n金幣 123456\n已獲得其他道具 (藥水120)').filter(line => line.target).length, 0);
});

test('missing middle rows, OCR blanks, and restored rows never add old gains again', () => {
  const tracker = createPickupLogTracker();
  const a = '已獲得經驗值 (+70)', b = '已獲得金幣 (+120)', c = '已獲得金幣 (+130)';
  const confirm = text => { tracker.read(text); return tracker.read(text).gains; };
  assert.deepEqual(confirm([a,b,c].join('\n')), { exp: 70, meso: 250 });
  assert.deepEqual(confirm([a,c].join('\n')), {});
  assert.deepEqual(confirm([a,b,c].join('\n')), {});
  confirm('');
  assert.deepEqual(confirm([a,b,c].join('\n')), {});
});

test('a stable new row can confirm while later rows are still arriving', () => {
  const tracker = createPickupLogTracker();
  const a = '已獲得經驗值 (+70)', b = '已獲得金幣 (+120)', c = '已獲得金幣 (+130)';
  tracker.read(a); tracker.read(a);
  assert.deepEqual(tracker.read([a,b].join('\n')).gains, {});
  assert.deepEqual(tracker.read([a,b,c].join('\n')).gains, { meso: 120 });
});

test('unanchored replacements are reported as uncertain rather than counted as a fresh screen', () => {
  const tracker = createPickupLogTracker();
  tracker.read('已獲得經驗值 (+70)'); tracker.read('已獲得經驗值 (+70)');
  for (let i = 0; i < 3; i++) {
    const result = tracker.read('已獲得經驗值 (+700)');
    assert.deepEqual(result.gains, {});
    assert.equal(result.decision, 'uncertain');
  }
});

test('video 12-14 seconds: a full rollover retains coin gains and counts the next repeated EXP batch', () => {
  const tracker = createPickupLogTracker();
  const exp = '已獲得經驗值 (+70)';
  const coin = n => `已獲得金幣 (+${n})`;
  const confirm = lines => { const text = lines.join('\n'); tracker.read(text, { confidence: 80 }); return tracker.read(text, { confidence: 80 }).gains; };
  assert.deepEqual(confirm(Array(6).fill(exp)), { exp: 420 });
  assert.deepEqual(confirm([...Array(5).fill(exp),coin(139)]), { meso: 139 });
  assert.deepEqual(confirm([coin(139),coin(128),coin(132),coin(106)]), { meso: 366 });
  assert.deepEqual(confirm(Array(6).fill(exp)), { exp: 420 });
  assert.deepEqual(confirm(Array(6).fill(exp)), {});
});
