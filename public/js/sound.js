/* Chess2 sound + haptic feedback.
 * Tiny synth via Web Audio - no audio files to ship or precache.
 * Vibration uses navigator.vibrate where available (Android Chrome).
 * Both respect a localStorage on/off toggle and prefers-reduced-motion.
 */
(function (root) {
  const PREF_KEY = 'chess2.sound';

  let ctx = null;
  function audioCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    return ctx;
  }

  function isEnabled() {
    return localStorage.getItem(PREF_KEY) !== 'off';
  }
  function setEnabled(on) {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
    window.dispatchEvent(new Event('chess2:sound-pref-changed'));
  }
  function toggle() { setEnabled(!isEnabled()); }

  /* Play one or more sine-blip 'notes' at the given offsets. ADSR envelope
   * keeps clicks subtle and short. The array entries are [frequency, startOffset]. */
  function play(notes, duration, type, peak) {
    if (!isEnabled()) return;
    const ac = audioCtx();
    if (!ac) return;
    if (ac.state === 'suspended') {
      // Autoplay policies: resume() needs a user gesture - we ignore the
      // failure quietly; the next click will succeed.
      ac.resume().catch(() => {});
    }
    const now = ac.currentTime;
    const dur = duration || 0.10;
    const vol = peak || 0.14;
    for (const [freq, startAt] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      const t0 = now + startAt;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  function vibrate(pattern) {
    if (!isEnabled()) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch {}
    }
  }

  /* High-level cues. Frequencies picked so they don't collide muddily with
   * each other and stay friendly under a phone speaker. */
  const Sound = {
    isEnabled, setEnabled, toggle,
    move()    { play([[520, 0]], 0.06, 'square', 0.06); vibrate(8); },
    capture() { play([[260, 0], [180, 0.04]], 0.14, 'square', 0.10); vibrate([18, 18, 18]); },
    check()   { play([[880, 0], [988, 0.06], [1175, 0.12]], 0.20, 'triangle', 0.12); vibrate([30, 40, 30]); },
    castle()  { play([[440, 0], [554, 0.06], [659, 0.12]], 0.14, 'triangle', 0.10); vibrate([12, 12, 12]); },
    promote() { play([[523, 0], [659, 0.06], [784, 0.12], [1047, 0.18]], 0.18, 'sine', 0.14); vibrate([20, 20, 30]); },
    gameStart() { play([[392, 0], [494, 0.10], [659, 0.20]], 0.12, 'triangle', 0.10); },
    win()     { play([[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]], 0.25, 'triangle', 0.16); vibrate([40, 30, 40, 30, 80]); },
    lose()    { play([[440, 0], [349, 0.14], [294, 0.28]], 0.28, 'sine', 0.12); vibrate([60]); },
    draw()    { play([[523, 0], [523, 0.14]], 0.20, 'sine', 0.10); },
    notification() { play([[660, 0], [880, 0.08]], 0.10, 'sine', 0.10); vibrate([30, 20, 30]); },
  };

  root.Chess2Sound = Sound;
})(window);
