// Chrome throttles timers in hidden tabs, but not in tabs that are producing
// audio. Playing an inaudible tone keeps the fallback sampling loop running
// while the game is in the foreground. Only used when the capture track cannot
// drive the loop by itself.

const INAUDIBLE_FREQUENCY_HZ = 20;
const GAIN = 0.003;

export function createKeepAwake() {
  let context = null;
  let oscillator = null;

  return {
    start() {
      if (oscillator) return;
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return;

      context ??= new AudioContextClass();
      context.resume();

      const gain = context.createGain();
      gain.gain.value = GAIN;
      oscillator = context.createOscillator();
      oscillator.frequency.value = INAUDIBLE_FREQUENCY_HZ;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
    },

    stop() {
      oscillator?.stop();
      oscillator?.disconnect();
      oscillator = null;
    },
  };
}
