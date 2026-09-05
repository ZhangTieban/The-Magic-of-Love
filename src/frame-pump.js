// Rate limiting and failure containment for the sampling loop.
//
// This is the part of frame delivery worth testing on its own: a frame handler
// that throws must not take the loop down with it. Detection runs on every
// frame, so a single bad frame — or a bug anywhere downstream in the UI — would
// otherwise end sampling silently while the page still claims to be watching.

export function createFramePump({ minIntervalMs, onFrame, onError = () => {} }) {
  let lastFrameAt = -Infinity;

  return {
    /** Offers one frame to the handler, honouring the sample interval. */
    push(frame, now) {
      if (now - lastFrameAt < minIntervalMs) return false;
      lastFrameAt = now;

      try {
        onFrame(frame);
      } catch (error) {
        onError(error);
      }
      return true;
    },
  };
}
