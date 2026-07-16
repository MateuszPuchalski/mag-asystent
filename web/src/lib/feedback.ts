/* Sygnały potwierdzenia: beep (WebAudio) + wibracja. */
let audioCtx: AudioContext | null = null;

export function beep(ok = true) {
  try {
    audioCtx =
      audioCtx ||
      new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.frequency.value = ok ? 1400 : 320;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
    o.start();
    o.stop(audioCtx.currentTime + 0.17);
  } catch {
    /* brak audio — trudno */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 40, 60]);
}
