// Notices when frames stop arriving.
//
// A capture track stays live even when its source produces nothing — a
// minimised window is the common case, since Windows stops drawing it. Without
// this, a blind detector is indistinguishable from a quiet one: the count and
// the frame rate both freeze at their last value, because both are only updated
// when a frame arrives.

export const DEFAULT_STALL_OPTIONS = {
  stallAfterMs: 3000,
};

export function createStallWatch(options = {}) {
  const opts = { ...DEFAULT_STALL_OPTIONS, ...options };

  let lastFrameAt = null;
  let stalled = false;

  return {
    /** Records an arriving frame. Returns true when this ends a stall. */
    feed(now) {
      lastFrameAt = now;
      if (!stalled) return false;
      stalled = false;
      return true;
    },

    /** Returns true on the single tick where a stall begins. */
    check(now) {
      if (lastFrameAt === null || stalled) return false;
      if (now - lastFrameAt < opts.stallAfterMs) return false;
      stalled = true;
      return true;
    },

    get stalled() {
      return stalled;
    },
  };
}
