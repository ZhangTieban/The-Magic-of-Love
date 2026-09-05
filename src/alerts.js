// Alert delivery: desktop notification, audible chime and an on-page flash.
// Each channel is independent so the user can keep only what they want.

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function createAlerts({ onFlash, onEvent = () => {}, onError = () => {} }) {
  let audioContext = null;
  let serviceWorker = null;
  const voices = new Set();
  function stopSound() {
    for (const oscillator of voices) { try { oscillator.stop(); } catch {} }
    voices.clear();
  }

  async function showNotification({ title, body, tag }) {
    if (notificationPermission() !== 'granted') return;

    const options = {
      body,
      tag,
      renotify: true,
      requireInteraction: false,
      silent: true, // The chime is handled separately so it can be switched off.
    };

    // A service worker notification survives the tab being hidden or minimised
    // on platforms where a page-scoped Notification would be dropped.
    try {
      if (serviceWorker) {
        await serviceWorker.showNotification(title, options);
        return;
      }
    } catch {
      // Fall through to the page-scoped notification.
    }
    new Notification(title, options);
  }

  // Rising for an arrival, falling for a fault: the two must be tellable apart
  // by ear, since the whole point is that nobody is looking at the screen.
  const CHIMES = {
    alert: [880, 1320],
    fault: [660, 440],
  };

  function playChime(kind, channels) {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => onError('音效無法播放，請按測試通知重新啟用'));
    stopSound();

    const now = audioContext.currentTime;
    const volume = Math.max(0, Math.min(100, channels.soundVolume ?? 80)) / 100;
    const seconds = Math.max(1, Math.min(30, channels.soundSeconds ?? 6));
    const tones = CHIMES[kind] ?? CHIMES.alert;
    for (let index = 0; index < Math.floor(seconds / 0.3); index++) {
      const frequency = tones[index % tones.length];
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * 0.3;

      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.65 * volume), start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);

      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      voices.add(oscillator);
      oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.stop(start + 0.27);
    }
  }

  return {
    stopSound,
    /**
     * Must be called from a user gesture so audio is allowed to start. The
     * audio context is created before the first await so the gesture is not
     * spent, and nothing here rejects: failing to set up a channel must never
     * stop capture from starting.
     */
    async prepare() {
      try {
        if (!audioContext) {
          const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
          if (AudioContextClass) audioContext = new AudioContextClass();
        }
        if (audioContext?.state === 'suspended') await audioContext.resume();
      } catch {
        onError('音效初始化失敗，請重新按測試通知');
      }

      if (!serviceWorker && 'serviceWorker' in navigator) {
        try {
          navigator.serviceWorker.ready.then(worker => { serviceWorker = worker; }).catch(() => {});
        } catch {
          serviceWorker = null;
        }
      }
    },

    fire({ title, body, tag, kind = 'alert', channels, test = false }) {
      onEvent({ title, body, tag, kind, test });
      if (channels.notifySystem) showNotification({ title, body, tag }).catch(() => onError('系統通知傳送失敗'));
      if (channels.notifySound) playChime(kind, channels);
      if (channels.notifyFlash) onFlash(title, kind);
    },
  };
}
