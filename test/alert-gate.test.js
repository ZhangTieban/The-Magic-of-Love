import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertGate } from '../src/alert-gate.js';

const redGate = (options = {}) => createAlertGate({
  stableFrames: 2, cooldownMs: 5000, repeatWhileActive: true,
  notifyOnCountIncrease: true, ...options,
});

test('red dots repeat at the configured interval after stable appearance', () => {
  const gate = redGate();
  assert.equal(gate.update(1, 0), false);
  assert.equal(gate.update(1, 100), true);
  assert.equal(gate.update(2, 5099), false);
  assert.equal(gate.update(1, 5100), true);
  assert.equal(gate.update(1, 10100), true);
});

test('confirmed disappearance stops repeats and reappearance alerts immediately', () => {
  const gate = redGate();
  gate.update(1, 0);
  gate.update(1, 100);
  assert.equal(gate.update(0, 200), false);
  assert.equal(gate.update(0, 300), false);
  assert.equal(gate.isActive(), false);
  assert.equal(gate.update(1, 400), false);
  assert.equal(gate.update(1, 500), true);
  assert.equal(gate.update(1, 5499), false);
  assert.equal(gate.update(1, 5500), true);
  gate.update(0, 5600);
  gate.update(0, 5700);
  assert.equal(gate.update(0, 20000), false);
});

test('a dropped frame does not reset cooldown or emit a repeat without dots', () => {
  const gate = redGate();
  gate.update(1, 0);
  gate.update(1, 100);
  gate.update(0, 200);
  assert.equal(gate.update(1, 300), false);
  assert.equal(gate.update(0, 5100), false);
  assert.equal(gate.update(1, 5200), true);
});

test('interval changes apply without resetting the last alert time', () => {
  const gate = redGate({ stableFrames: 1 });
  assert.equal(gate.update(1, 0), true);
  gate.configure({ cooldownMs: 10000 });
  assert.equal(gate.update(1, 5000), false);
  assert.equal(gate.update(1, 10000), true);
  gate.configure({ cooldownMs: 2000 });
  assert.equal(gate.update(1, 12000), true);
});

test('zero cooldown repeats on each qualifying sample and respects threshold', () => {
  const gate = redGate({ stableFrames: 1, threshold: 2, cooldownMs: 0 });
  assert.equal(gate.update(1, 0), false);
  assert.equal(gate.update(2, 100), true);
  assert.equal(gate.update(2, 200), true);
  assert.equal(gate.update(1, 300), false);
});

test('other warning gates retain one-shot alerts and deferred cooldown delivery', () => {
  const gate = createAlertGate({ cooldownMs: 5000 });
  assert.equal(gate.update(1, 0), true);
  assert.equal(gate.update(1, 10000), false);
  gate.update(0, 10100);
  assert.equal(gate.update(1, 10200), true);
  gate.update(0, 10300);
  assert.equal(gate.update(1, 10400), false);
  assert.equal(gate.update(1, 15200), true);
  assert.equal(gate.update(1, 20200), false);
});

test('another stable red dot alerts inside cooldown and restarts the repeat interval', () => {
  const gate = redGate();
  gate.update(1, 0);
  assert.equal(gate.update(1, 100), true);
  gate.acknowledge();
  assert.equal(gate.update(2, 200), false);
  assert.equal(gate.update(2, 300), true);
  assert.equal(gate.update(2, 5299), false);
  assert.equal(gate.update(2, 5300), true);
});

test('acknowledgement suppresses all timed repeats including zero cooldown', () => {
  const gate = redGate({ stableFrames: 1 });
  assert.equal(gate.update(1, 0), true);
  gate.acknowledge();
  assert.equal(gate.isActive(), true);
  assert.equal(gate.update(1, 5000), false);
  assert.equal(gate.update(1, 60000), false);
  gate.configure({ cooldownMs: 0 });
  assert.equal(gate.update(1, 61000), false);
});

test('acknowledged dots stay quiet through noise and decreases, then rearm on arrival', () => {
  const gate = redGate();
  gate.update(2, 0);
  gate.update(2, 100);
  gate.acknowledge();
  for (const [count, time] of [[3, 6000], [2, 6100], [0, 6200], [2, 6300], [1, 6400], [1, 6500], [1, 12000]]) {
    assert.equal(gate.update(count, time), false);
  }
  assert.equal(gate.update(2, 12100), false);
  assert.equal(gate.update(2, 12200), true);
  gate.acknowledge();
  assert.equal(gate.update(0, 12300), false);
  assert.equal(gate.update(0, 12400), false);
  assert.equal(gate.update(1, 12500), false);
  assert.equal(gate.update(1, 12600), true);
});

test('stable count decreases allow a later arrival, but brief fluctuations do not', () => {
  const gate = redGate();
  gate.update(2, 0);
  gate.update(2, 100);
  assert.equal(gate.update(3, 200), false);
  assert.equal(gate.update(2, 300), false);
  assert.equal(gate.update(1, 400), false);
  assert.equal(gate.update(2, 500), false);
  assert.equal(gate.update(2, 600), false);
  assert.equal(gate.update(1, 700), false);
  assert.equal(gate.update(1, 800), false);
  assert.equal(gate.update(2, 900), false);
  assert.equal(gate.update(2, 1000), true);
});
