// Decides when a detection deserves an alert. Pure state machine: time is
// passed in, so it can be unit tested without timers.
//
// The gate exposes its active state as well as the one-shot notification edge.
// This lets the Win11/Picture-in-Picture overlay stay visible for exactly as
// long as the warning is present, then reappear on the next rising edge.

export const DEFAULT_ALERT_OPTIONS = {
  threshold: 1,
  stableFrames: 2,
  // null means "use stableFrames". Warning-image detectors set this to 3 to
  // match the macOS helper's more conservative clear behaviour.
  clearStableFrames: null,
  cooldownMs: 30000,
};

export function createAlertGate(options = {}) {
  const opts = { ...DEFAULT_ALERT_OPTIONS, ...options };

  let aboveStreak = 0;
  let belowStreak = 0;
  let active = false;
  let pending = false;
  let lastNotifiedAt = null;

  const cooldownElapsed = (now) =>
    lastNotifiedAt === null || now - lastNotifiedAt >= opts.cooldownMs;

  const appearFrames = () => Math.max(1, Number(opts.stableFrames) || 1);
  const clearFrames = () => Math.max(
    1,
    Number(opts.clearStableFrames ?? opts.stableFrames) || 1,
  );

  return {
    /**
     * Applies new options without disturbing the alert state. Rebuilding the
     * gate instead would clear the cooldown, so adjusting a setting while a
     * warning is on screen would fire a second alert for the same unchanged
     * warning.
     */
    configure(next) {
      Object.assign(opts, next);
    },

    /** Feeds one detection result in; returns true when a notification should fire. */
    update(count, now) {
      if (count >= opts.threshold) {
        aboveStreak++;
        belowStreak = 0;
      } else {
        belowStreak++;
        aboveStreak = 0;
      }

      // Rising and falling edges can use different stability counts. A longer
      // clear count prevents a single animation/noise frame from making the
      // overlay blink off and back on.
      if (!active && aboveStreak >= appearFrames()) {
        active = true;
        pending = true;
      } else if (active && belowStreak >= clearFrames()) {
        active = false;
        pending = false;
      }

      // An alert raised during the cooldown is held, not dropped, so a player
      // who arrives just after the previous alert is still reported if the
      // condition remains active until the cooldown expires.
      if (active && pending && cooldownElapsed(now)) {
        pending = false;
        lastNotifiedAt = now;
        return true;
      }

      return false;
    },

    /** Current debounced state; used by the persistent top-most overlay. */
    isActive() {
      return active;
    },
  };
}
