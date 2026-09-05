// Supplies frames from a screen-capture track at a bounded rate.
//
// The tab running this app is hidden while the game is in the foreground, and
// a hidden tab gets no rendering callbacks and heavily throttled timers. So the
// preferred path reads VideoFrames straight off the capture track, which is
// driven by the capture pipeline rather than by the page being painted. The
// video-element path only exists for browsers without that API.

import { createFramePump } from './frame-pump.js';

export function supportsTrackProcessor() {
  return typeof globalThis.MediaStreamTrackProcessor === 'function';
}

function createProcessorSource({ track, pump, onEnd, onError }) {
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  let stopped = false;

  (async () => {
    while (!stopped) {
      const { value: frame, done } = await reader.read();
      if (done || stopped) {
        frame?.close();
        break;
      }

      try {
        pump.push(
          { drawable: frame, width: frame.displayWidth, height: frame.displayHeight },
          performance.now(),
        );
      } finally {
        frame.close();
      }
    }
  })().catch((error) => {
    // Only reader-level failures reach here; frame handler errors are contained
    // by the pump. Either way the loop is over, so say so rather than leaving
    // the page believing it is still watching.
    if (!stopped) {
      onError(error);
      onEnd();
    }
  });

  return {
    mode: 'track-processor',
    stop() {
      stopped = true;
      reader.cancel().catch(() => {});
    },
  };
}

function createVideoSource({ video, pump, minIntervalMs }) {
  let stopped = false;

  const grab = () => {
    if (stopped || !video.videoWidth) return;
    pump.push(
      { drawable: video, width: video.videoWidth, height: video.videoHeight },
      performance.now(),
    );
  };

  if (typeof video.requestVideoFrameCallback === 'function') {
    const step = () => {
      if (stopped) return;
      grab();
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  }

  // Runs alongside the frame callback: the callback stops in a hidden tab and
  // the timer keeps going (throttled) while the page is kept awake.
  const timer = setInterval(grab, minIntervalMs);

  return {
    mode: 'video-element',
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Starts delivering frames. `onFrame(drawable, width, height)` is called with a
 * drawable that is only valid for the duration of the call. A frame handler
 * that throws is reported through `onError` and sampling continues.
 */
export function createFrameSource({
  track,
  video,
  fps,
  onFrame,
  onEnd = () => {},
  onError = () => {},
}) {
  const minIntervalMs = 1000 / fps - 1;
  const pump = createFramePump({
    minIntervalMs,
    onFrame: ({ drawable, width, height }) => onFrame(drawable, width, height),
    onError,
  });

  return supportsTrackProcessor()
    ? createProcessorSource({ track, pump, onEnd, onError })
    : createVideoSource({ video, pump, minIntervalMs });
}
