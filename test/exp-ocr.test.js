import test from 'node:test';
import assert from 'node:assert/strict';

import { createExpOcr, evaluateOcrReading } from '../src/exp-ocr.js';
import { expLogCsv, parseExp, parseMeso } from '../src/exp-log.js';

test('parses the EXP text shown in the supplied screenshot', () => {
  assert.equal(parseExp('222046394[60.87%]'), 222046394);
});

test('accepts a structured EXP reading even when Tesseract reports zero confidence', () => {
  assert.deepEqual(
    evaluateOcrReading({ target: 'exp', text: '222046394[60.87%]', confidence: 0, previous: null }),
    { value: 222046394, accepted: true, reason: '格式有效' },
  );
});

test('requires two matching low-confidence plain-number readings', () => {
  const first = evaluateOcrReading({ target: 'meso', text: '12,345,678', confidence: 20, previous: null });
  const second = evaluateOcrReading({ target: 'meso', text: '12,345,678', confidence: 20, previous: { value: first.value } });
  assert.equal(first.accepted, false);
  assert.equal(first.reason, '等待再次確認');
  assert.equal(second.accepted, true);
  assert.equal(second.reason, '連續兩次一致');
});

test('rejects malformed meso text', () => {
  assert.equal(parseMeso('12,34,567'), null);
  assert.equal(parseMeso('EXP 12345'), null);
});

test('keeps existing EXP validation and CSV escaping behavior', () => {
  for (const input of ['', '12 34', '12.34%', '-1', '9007199254740992', '1,23', 'EXP 123']) {
    assert.equal(parseExp(input), null);
  }
  const csv = expLogCsv([{ time: '2026-09-08T00:00:00Z', exp: 100, hp: 0, mp: 0, meso: 0, note: '=SUM("A1")' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=SUM(\"\"A1\"\")"));
});

test('copies all ROIs before an asynchronous OCR worker can outlive its VideoFrame', async () => {
  let drawCalls = 0;
  const source = { closed: false };
  const statuses = { exp: { textContent: '' }, meso: { textContent: '' } };
  const canvases = Object.fromEntries(['exp', 'meso'].map(target => [target, {
    width: 320,
    height: 40,
    getContext: () => ({
      drawImage(drawable) {
        assert.equal(drawable.closed, false);
        drawCalls++;
      },
    }),
  }]));
  const enabled = { checked: true, onchange: null };
  const root = {
    querySelector(selector) {
      if (selector === '[data-exp-auto]') return enabled;
      const preview = selector.match(/^\[data-exp-preview-(exp|meso)\]$/)?.[1];
      if (preview) return canvases[preview];
      const status = selector.match(/^\[data-exp-ocr-status-(exp|meso)\]$/)?.[1];
      return status ? statuses[status] : null;
    },
  };
  const storage = { getItem: () => null, setItem: () => {} };
  const originalTesseract = globalThis.Tesseract;
  globalThis.Tesseract = {
    async createWorker() {
      assert.equal(drawCalls, 2);
      return {
        setParameters: async () => {},
        recognize: async () => ({ data: { text: '', confidence: 0 } }),
      };
    },
  };

  try {
    const ocr = createExpOcr({ root, storage, accept: () => {} });
    const region = { x: 0, y: 0, width: 0.5, height: 0.2 };
    ocr.select('exp', region);
    ocr.select('meso', region);
    const pending = ocr.process(source, 100, 100);
    source.closed = true;
    await pending;
    assert.equal(drawCalls, 2);
  } finally {
    globalThis.Tesseract = originalTesseract;
  }
});
