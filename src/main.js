// Wires the UI to the capture loop, the detector and the alert channels.

import { createAlertGate } from './alert-gate.js';
import {
  createAlerts,
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
} from './alerts.js';
import { createCapture } from './capture.js';
import { createWarnings } from './warnings.js';
import { createAlertCenter } from './alert-center.js';
import { createExpLog } from './exp-log.js';
import { createExpOcr } from './exp-ocr.js';
import { bindNavigation } from './navigation.js';
import { createKeepAwake } from './keep-awake.js';
import { rectFromPoints } from './region.js';
import { createStallWatch } from './stall-watch.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from './settings.js';

const el = (id) => document.getElementById(id);

const ui = {
  statusPill: el('statusPill'),
  sourceMode: el('sourceMode'),
  dotCount: el('dotCount'),
  statThreshold: el('statThreshold'),
  statFps: el('statFps'),
  statLastAlert: el('statLastAlert'),
  statHidden: el('statHidden'),
  startButton: el('startButton'),
  stopButton: el('stopButton'),
  testButton: el('testButton'),
  clearRegionButton: el('clearRegionButton'),
  permissionButton: el('permissionButton'),
  permissionState: el('permissionState'),
  resetButton: el('resetButton'),
  previewWrap: el('previewWrap'),
  video: el('preview'),
  overlay: el('overlay'),
  regionInfo: el('regionInfo'),
};

const SCALAR_FIELDS = ['threshold', 'cooldownSeconds', 'sampleFps', 'stableFrames', 'soundVolume', 'soundSeconds'];
const TOGGLE_FIELDS = ['notifySystem', 'notifySound', 'notifyFlash'];
const DETECT_NUMBER_FIELDS = ['hueTolerance', 'minSaturation', 'minValue', 'minArea', 'maxArea', 'minFillRatio', 'maxAspectRatio', 'mergeThreshold'];
const DETECT_TOGGLE_FIELDS = ['splitMergedBlobs'];

let settings = loadSettings(localStorage);
let gate = createGate();
let lastResult = null;
let dragStart = null;
let dragCurrent = null;
let flashTimer = null;
let hiddenFrames = 0;
let frameErrors = 0;
let sourceLabel = '';
let stallWatch = null;
let stallTimer = null;
const frameTimestamps = [];

const overlayContext = ui.overlay.getContext('2d');
const keepAwake = createKeepAwake();
const expLog = createExpLog({ root: el('expLog') });
const expOcr = createExpOcr({ root: el('expLog'), accept: value => expLog.accept(value) });
const expOption = document.createElement('option');
expOption.value = 'exp';
expOption.textContent = '經驗值數字';
el('selectionTarget').append(expOption);
const alertCenter = createAlertCenter({ stopSound: () => alerts.stopSound() });

const alerts = createAlerts({
  onEvent: event => alertCenter.record(event),
  onError: message => { el('audioStatus').textContent = message; },
  onFlash: (title) => {
    document.body.classList.remove('alerting');
    void document.body.offsetWidth; // Restart the animation on a repeat alert.
    document.body.classList.add('alerting');
    document.title = `🔴 ${title}`;

    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      document.body.classList.remove('alerting');
      document.title = 'The Magic of Love';
    }, 4000);
  },
});

const warnings = createWarnings({
  container: el('warningList'),
  channels: () => settings,
  fire: (message) => { alerts.prepare(); alerts.fire(message); },
  onAlert: (name) => { ui.statLastAlert.textContent = `${new Date().toLocaleTimeString('zh-TW', { hour12: false })} ${name}`; },
  onState: ({ active, ...event }) => {
    if (active) alertCenter.setActive(event);
    else alertCenter.clearActive(event.tag);
  },
  onChange: () => drawOverlay(),
});

const capture = createCapture({
  video: ui.video,
  onResult: handleResult,
  onStop: handleStopped,
  onError: handleCaptureError,
  onFrame: (drawable, width, height) => { warnings.process(drawable, width, height); void expOcr.process(drawable, width, height); },
});

// A frame that fails to process no longer stops sampling, so the failure has to
// be visible instead: a silent watcher is worse than no watcher.
function handleCaptureError(error) {
  frameErrors++;
  console.warn('capture', error);
  ui.sourceMode.textContent = `偵測發生錯誤（已略過 ${frameErrors} 幀）：${error?.message ?? error}`;
}

function gateOptions() {
  return {
    threshold: settings.threshold,
    stableFrames: settings.stableFrames,
    cooldownMs: settings.cooldownSeconds * 1000,
  };
}

function createGate() {
  return createAlertGate(gateOptions());
}

function persist() {
  settings = normalizeSettings(settings);
  saveSettings(localStorage, settings);
  capture.setDetectOptions(settings.detect);
  capture.setRegion(settings.region);
  ui.statThreshold.textContent = String(settings.threshold);
}

function fillForm() {
  el('volumeReadout').textContent = `${settings.soundVolume}%`;
  for (const field of SCALAR_FIELDS) el(field).value = String(settings[field]);
  for (const field of TOGGLE_FIELDS) el(field).checked = settings[field];
  for (const field of DETECT_NUMBER_FIELDS) el(field).value = String(settings.detect[field]);
  for (const field of DETECT_TOGGLE_FIELDS) el(field).checked = settings.detect[field];
  ui.statThreshold.textContent = String(settings.threshold);
  describeRegion();
}

function bindForm() {
  for (const field of SCALAR_FIELDS) {
    el(field).addEventListener('change', (event) => {
      settings[field] = Number(event.target.value);
      persist();
      fillForm();
      // Reconfigured rather than rebuilt: a settings tweak must not clear the
      // cooldown and re-alert on a dot that has been there all along.
      gate.configure(gateOptions());
      if (field === 'sampleFps') {
        capture.setFps(settings.sampleFps);
        if (capture.isRunning()) startStallWatch();
      }
    });
  }

  for (const field of TOGGLE_FIELDS) {
    el(field).addEventListener('change', (event) => {
      settings[field] = event.target.checked;
      if (field === 'notifySound' && !settings.notifySound) alerts.stopSound();
      persist();
    });
  }

  for (const field of DETECT_NUMBER_FIELDS) {
    el(field).addEventListener('change', (event) => {
      settings.detect[field] = Number(event.target.value);
      persist();
      // Normalisation can adjust a field other than the one edited, so the
      // whole form is refilled rather than just this input.
      fillForm();
    });
  }

  for (const field of DETECT_TOGGLE_FIELDS) {
    el(field).addEventListener('change', (event) => {
      settings.detect[field] = event.target.checked;
      persist();
    });
  }
}

function describeRegion() {
  const region = settings.region;
  ui.clearRegionButton.disabled = !region;
  // Drives the callout over the preview, which only shows while sharing is
  // running and nothing has been framed yet.
  ui.previewWrap.classList.toggle('needs-region', !region);
  ui.regionInfo.classList.toggle('warn', !region);
  ui.regionInfo.textContent = region
    ? `已框選範圍：畫面的 ${(region.width * 100).toFixed(1)}% × ${(region.height * 100).toFixed(1)}%，`
      + `左上角在 ${(region.x * 100).toFixed(1)}%, ${(region.y * 100).toFixed(1)}%。`
    : '尚未框選範圍，目前偵測整個畫面。';
}

function setStatus(text, variant) {
  ui.statusPill.textContent = text;
  ui.statusPill.className = `pill pill-${variant}`;
}

function measureFps() {
  const now = performance.now();
  frameTimestamps.push(now);
  while (frameTimestamps.length && now - frameTimestamps[0] > 2000) frameTimestamps.shift();
  const span = now - frameTimestamps[0];
  const fps = span > 0 ? ((frameTimestamps.length - 1) * 1000) / span : 0;
  ui.statFps.textContent = `${fps.toFixed(1)} fps`;
}

// Frames stop without the track ending when the captured window is minimised,
// so absence of frames has to be watched for on a clock of its own.
function stallAfterMs() {
  return Math.max(3000, (1000 / settings.sampleFps) * 4);
}

function startStallWatch() {
  stopStallWatch();
  stallWatch = createStallWatch({ stallAfterMs: stallAfterMs() });
  stallWatch.feed(performance.now());
  stallTimer = setInterval(() => {
    if (stallWatch?.check(performance.now())) reportStall();
  }, 1000);
}

function stopStallWatch() {
  clearInterval(stallTimer);
  stallTimer = null;
  stallWatch = null;
}

function reportStall() {
  ui.statFps.textContent = '0.0 fps';
  setStatus('畫面已停止更新', 'alert');
  ui.sourceMode.textContent = '收不到畫面：遊戲視窗可能被最小化，或分享已被系統中斷。';
  const event = {
    title: '偵測已停止',
    body: '收不到畫面，可能是遊戲視窗被最小化。紅點警報目前不會運作。',
    tag: 'stalled',
    kind: 'fault',
  };
  alertCenter.setActive(event);
  alerts.fire({ ...event, channels: settings });
}

function handleResult(result) {
  lastResult = result;
  measureFps();

  if (stallWatch?.feed(performance.now())) {
    ui.sourceMode.textContent = sourceLabel;
    alertCenter.clearActive('stalled');
  }

  if (frameErrors > 0) {
    frameErrors = 0;
    ui.sourceMode.textContent = sourceLabel;
  }

  // Proof that sampling survives the tab being hidden, which is the state the
  // app spends almost all of its time in.
  if (document.hidden) {
    hiddenFrames++;
    ui.statHidden.textContent = `${hiddenFrames} 幀`;
  }

  if (!settings.region) {
    ui.dotCount.textContent = '–';
    ui.dotCount.classList.remove('hot');
    setStatus('請先框選小地圖', 'live');
    if (gate.isActive()) alertCenter.clearActive('red-dot');
    gate = createGate();
    return;
  }

  ui.dotCount.textContent = String(result.count);
  ui.dotCount.classList.toggle('hot', result.count >= settings.threshold);
  setStatus(result.count >= settings.threshold ? `偵測到 ${result.count} 個紅點` : '偵測中', result.count >= settings.threshold ? 'alert' : 'live');

  const redDotWasActive = gate.isActive();
  const shouldNotifyRedDot = gate.update(result.count, performance.now());
  const redDotIsActive = gate.isActive();
  const redDotEvent = {
    title: `小地圖出現 ${result.count} 個紅點`,
    body: `已達到警戒值 ${settings.threshold}，可能有其他玩家進入地圖。`,
    tag: 'red-dot',
  };

  if (!redDotWasActive && redDotIsActive) alertCenter.setActive(redDotEvent);
  else if (redDotWasActive && !redDotIsActive) alertCenter.clearActive('red-dot');

  if (shouldNotifyRedDot) {
    alerts.fire({ ...redDotEvent, channels: settings });
    ui.statLastAlert.textContent = `${new Date().toLocaleTimeString('zh-TW', { hour12: false })} 小地圖紅點`;
  }

  drawOverlay();
}

function handleStopped() {
  alerts.stopSound();
  alertCenter.clearAllActive();
  warnings.reset();
  ui.startButton.disabled = false;
  ui.stopButton.disabled = true;
  ui.previewWrap.classList.remove('live');
  ui.sourceMode.textContent = '';
  ui.dotCount.textContent = '–';
  ui.dotCount.classList.remove('hot');
  ui.statFps.textContent = '0.0 fps';
  setStatus('待機中', 'idle');
  stopStallWatch();
  keepAwake.stop();
  frameTimestamps.length = 0;
  lastResult = null;
  drawOverlay();
}

function resizeOverlay() {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(ui.overlay.clientWidth * ratio);
  const height = Math.round(ui.overlay.clientHeight * ratio);
  if (width && height && (ui.overlay.width !== width || ui.overlay.height !== height)) {
    ui.overlay.width = width;
    ui.overlay.height = height;
  }
  drawOverlay();
}

function drawOverlay() {
  const { width, height } = ui.overlay;
  overlayContext.clearRect(0, 0, width, height);
  if (!width || !height) return;

  const preview = dragStart && dragCurrent ? rectFromPoints(dragStart, dragCurrent) : null;
  const target = el('selectionTarget').value;
  const region = preview ?? (target === 'minimap' ? settings.region : target === 'exp' ? expOcr.region : warnings.states.find(s => s.id === target)?.config.region);

  if (region) {
    overlayContext.fillStyle = 'rgba(5, 7, 11, 0.55)';
    overlayContext.fillRect(0, 0, width, height);
    overlayContext.clearRect(
      region.x * width,
      region.y * height,
      region.width * width,
      region.height * height,
    );

    overlayContext.strokeStyle = preview ? '#ffffff' : '#4c8dff';
    overlayContext.lineWidth = 2;
    overlayContext.setLineDash(preview ? [6, 4] : []);
    overlayContext.strokeRect(
      region.x * width,
      region.y * height,
      region.width * width,
      region.height * height,
    );
    overlayContext.setLineDash([]);
  }

  if (!lastResult) return;

  for (const s of warnings.states) {
    const r = s.config.region, match = s.result, size = s.searchSize;
    if (!r || !match || !size || match.score < s.config.threshold) continue;
    overlayContext.strokeStyle = '#ffb454';
    overlayContext.lineWidth = 3;
    overlayContext.strokeRect((r.x + match.x / size.width * r.width) * width,
      (r.y + match.y / size.height * r.height) * height,
      match.width / size.width * r.width * width, match.height / size.height * r.height * height);
  }

  const { blobs, rect, frameWidth, frameHeight } = lastResult;
  overlayContext.lineWidth = 2;
  overlayContext.font = `${Math.round(13 * (window.devicePixelRatio || 1))}px system-ui, sans-serif`;

  for (const blob of blobs) {
    const x = ((rect.x + blob.x) / frameWidth) * width;
    const y = ((rect.y + blob.y) / frameHeight) * height;
    const w = (blob.width / frameWidth) * width;
    const h = (blob.height / frameHeight) * height;
    const pad = 3;

    overlayContext.strokeStyle = '#35d07f';
    overlayContext.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);

    if (blob.dots > 1) {
      overlayContext.fillStyle = '#35d07f';
      overlayContext.fillText(`×${blob.dots}`, x + w + pad * 2, y + h);
    }
  }
}

function pointerPosition(event) {
  const bounds = ui.overlay.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  };
}

function bindRegionSelection() {
  ui.overlay.addEventListener('pointerdown', (event) => {
    if (!capture.isRunning() || ui.video.readyState < 2) return;
    ui.overlay.setPointerCapture(event.pointerId);
    dragStart = pointerPosition(event);
    dragCurrent = dragStart;
    drawOverlay();
  });

  ui.overlay.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    dragCurrent = pointerPosition(event);
    drawOverlay();
  });

  ui.overlay.addEventListener('pointerup', (event) => {
    if (!dragStart) return;
    const region = rectFromPoints(dragStart, pointerPosition(event));
    dragStart = null;
    dragCurrent = null;

    if (region) {
      const target = el('selectionTarget').value;
      if (target === 'minimap') {
        settings.region = region;
        persist();
        describeRegion();
      } else {
        if (target === 'exp') expOcr.select(region);
        else warnings.select(target, region, el('selectionMode').value === 'sample', ui.video);
      }
    }
    drawOverlay();
  });

  ui.clearRegionButton.addEventListener('click', () => {
    settings.region = null;
    persist();
    describeRegion();
    drawOverlay();
  });
}

function refreshPermissionState() {
  if (!notificationsSupported()) {
    ui.permissionState.textContent = '這個瀏覽器不支援系統通知';
    ui.permissionButton.hidden = true;
    return;
  }

  const state = notificationPermission();
  ui.permissionButton.hidden = state !== 'default';
  ui.permissionState.textContent = {
    granted: '系統通知已允許',
    denied: '系統通知被封鎖，請到瀏覽器網站設定開啟',
    default: '尚未授權系統通知',
  }[state] ?? '';
}

function bindButtons() {
  ui.startButton.addEventListener('click', async () => {
    ui.startButton.disabled = true;

    // getDisplayMedia needs the click's transient activation and other calls
    // can spend it, so it goes first and everything else waits its turn. The
    // audio context is only created here, before the first await, because
    // creating it later would leave it suspended.
    const preparing = alerts.prepare();

    try {
      capture.setRegion(settings.region);
      capture.setDetectOptions(settings.detect);
      capture.setFps(settings.sampleFps);
      gate = createGate();
      alertCenter.clearAllActive();
      warnings.reset();
      hiddenFrames = 0;
      frameErrors = 0;
      ui.statHidden.textContent = '0 幀';

      const mode = await capture.start();
      if (mode === 'video-element') {
        keepAwake.start();
        sourceLabel = '相容模式：請讓此視窗保持可見';
      } else {
        sourceLabel = '背景取樣模式';
      }
      ui.sourceMode.textContent = sourceLabel;

      ui.stopButton.disabled = false;
      ui.previewWrap.classList.add('live');
      setStatus('偵測中', 'live');
      startStallWatch();
      resizeOverlay();

      await preparing;

      // Asked for as part of starting, once capture has taken the gesture it
      // needed. Capture is already running by now, so a rejected prompt must
      // not surface as a capture failure; the state simply stays 'default' and
      // the button in the settings panel is the way back to it.
      await requestNotificationPermission().catch(() => {});
      refreshPermissionState();
    } catch (error) {
      ui.startButton.disabled = false;
      if (error?.name !== 'NotAllowedError') {
        ui.sourceMode.textContent = `無法開始擷取：${error?.message ?? error}`;
      }
    }
  });

  ui.stopButton.addEventListener('click', () => capture.stop());

  ui.testButton.addEventListener('click', async () => {
    const preparing = alerts.prepare();
    await requestNotificationPermission();
    refreshPermissionState();
    await preparing;
    alerts.fire({
      title: `小地圖出現 ${settings.threshold} 個紅點`,
      body: '這是一則測試通知。',
      test: true,
      tag: 'red-dot',
      channels: settings,
    });
  });

  ui.permissionButton.addEventListener('click', async () => {
    await requestNotificationPermission();
    refreshPermissionState();
  });

  ui.resetButton.addEventListener('click', () => {
    const region = settings.region;
    settings = normalizeSettings({ ...DEFAULT_SETTINGS, region });
    persist();
    fillForm();
    gate.configure(gateOptions());
    capture.setFps(settings.sampleFps);
  });
}

ui.video.addEventListener('loadedmetadata', () => {
  ui.previewWrap.style.setProperty('--preview-aspect', `${ui.video.videoWidth} / ${ui.video.videoHeight}`);
  resizeOverlay();
});

new ResizeObserver(resizeOverlay).observe(ui.overlay);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

fillForm();
bindForm();
bindButtons();
bindRegionSelection();
el('soundVolume').addEventListener('input', event => { el('volumeReadout').textContent = `${event.target.value}%`; });
el('selectionTarget').addEventListener('change', () => {
  el('selectionMode').disabled = ['minimap', 'exp'].includes(el('selectionTarget').value);
  ui.previewWrap.classList.toggle('needs-region', el('selectionTarget').value === 'minimap' && !settings.region);
  drawOverlay();
});
ui.overlay.addEventListener('pointercancel', () => { dragStart = null; dragCurrent = null; drawOverlay(); });
refreshPermissionState();
persist();
bindNavigation();
