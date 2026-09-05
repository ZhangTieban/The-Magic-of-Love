// Owns the screen-capture stream and the detection loop. Each sampled frame is
// cropped to the selected minimap region before it reaches the detector, so the
// pixel work stays proportional to the region and not to the whole screen.

import { detectRedDots } from './detect.js';
import { createFrameSource } from './frame-source.js';
import { toPixelRect } from './region.js';

const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };

const requestDisplayStream = () => navigator.mediaDevices.getDisplayMedia({
  video: { frameRate: { ideal: 30 } },
  audio: false,
});

export function createCapture({ video, onResult, onStop, onError, onFrame, requestStream = requestDisplayStream }) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null;
  let source = null;
  let region = null;
  let detectOptions = {};
  let fps = 4;

  function handleFrame(drawable, frameWidth, frameHeight) {
    const rect = toPixelRect(region ?? FULL_FRAME, frameWidth, frameHeight);
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    try {
      context.drawImage(
        drawable,
        rect.x, rect.y, rect.width, rect.height,
        0, 0, rect.width, rect.height,
      );
    } catch {
      return; // A frame can go stale mid-draw while the stream is ending.
    }

    const image = context.getImageData(0, 0, rect.width, rect.height);
    const { count, blobs } = detectRedDots(image, detectOptions);
    onResult({ count, blobs, rect, frameWidth, frameHeight });
    onFrame?.(drawable, frameWidth, frameHeight);
  }

  function startSource() {
    source?.stop();
    source = createFrameSource({
      track: stream.getVideoTracks()[0],
      video,
      fps,
      onFrame: handleFrame,
      onEnd: () => api.stop(),
      onError: (error) => onError?.(error),
    });
    return source.mode;
  }

  const api = {
    async start() {
      stream = await requestStream();

      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => api.stop());

      video.srcObject = stream;
      try {
        await video.play();
      } catch (error) {
        onError?.(error);
      }

      return startSource();
    },

    stop() {
      source?.stop();
      source = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      onStop?.();
    },

    isRunning: () => stream !== null,
    setRegion(next) { region = next; },
    setDetectOptions(next) { detectOptions = next; },
    setFps(next) {
      fps = next;
      if (stream) startSource();
    },
  };

  return api;
}
