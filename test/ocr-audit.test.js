import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrAudit } from '../src/ocr-audit.js';

test('diagnostics persist raw OCR, decision and actual ledger entry across reloads', () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const audit = createOcrAudit({ storage });
  audit.add({ capturedAt: '2026-09-10T05:25:27Z', rawText: '已獲得經驗值 (+70)', decision: 'accepted', recorded: { exp: 70 } });
  const restored = createOcrAudit({ storage }).snapshot();
  assert.equal(restored.rows[0].recorded.exp, 70);
  assert.equal(restored.rows[0].sequence, 1);
  assert.equal(restored.dropped, 0);
});

test('storage failures are visible and memory data remains exportable', () => {
  let status;
  const audit = createOcrAudit({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } }, onStatus: text => { status = text; } });
  audit.add({ decision: 'uncertain' });
  assert.match(status, /記憶體/);
  assert.equal(audit.snapshot().rows.length, 1);
});
