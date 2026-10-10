'use client';

/**
 * Musik latar looping sederhana pakai WebAudio (tanpa file aset).
 * Dipakai di GameCanvas (single-player) & MultiplayerGameCanvas.
 *
 * Catatan penting:
 * - State disimpan per-instance (bukan modul global) supaya tidak bentrok kalau ada >1 pemanggil.
 * - Browser memblokir AudioContext sebelum ada interaksi user. Karena itu kita pasang
 *   listener gesture (pointerdown/keydown) untuk `resume()` konteks audio, sehingga musik
 *   benar-benar terdengar begitu pemain menekan tombol/klik.
 */
export interface MusicController {
  start: () => void;
  stop: () => void;
  setVolume: (vol: number) => void;
}

/**
 * Urutan nada (frekuensi Hz) — sederhana, tipe "retro fighting game".
 * Pattern 8-beat yang berulang.
 */
const melody = [
  { freq: 196.00, dur: 0.15 }, // G3
  { freq: 220.00, dur: 0.15 }, // A3
  { freq: 246.94, dur: 0.15 }, // B3
  { freq: 261.63, dur: 0.15 }, // C4
  { freq: 293.66, dur: 0.15 }, // D4
  { freq: 261.63, dur: 0.15 }, // C4
  { freq: 220.00, dur: 0.15 }, // A3
  { freq: 196.00, dur: 0.30 }, // G3 (panjang)
] as const;

const bassNotes = [98.00, 110.00, 123.47, 130.81] as const; // G2 A2 B2 C3

export function createMusic(): MusicController {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let volume = 0.12;
  let bassIndex = 0;
  const cleanups: Array<() => void> = [];

  function ensureCtx(): AudioContext {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function resume() {
    try {
      const c = ensureCtx();
      if (c.state === 'suspended') c.resume().catch(() => {});
    } catch {}
  }

  // Resume konteks audio pada gesture pertama (kebijakan autoplay browser).
  function attachUnlock() {
    if (typeof window === 'undefined') return;
    const handler = () => resume();
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    cleanups.push(() => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    });
  }

  function playNote(freq: number, duration: number, type: OscillatorType = 'square', gainMult = 1) {
    try {
      const c = ensureCtx();
      if (c.state === 'suspended') c.resume().catch(() => {});
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const now = c.currentTime;
      const peak = Math.max(0.0001, volume * gainMult);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(master!);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {}
  }

  function scheduleNextBar() {
    if (!playing) return;
    resume();

    // Bass tiap 2 beat
    if (bassIndex % 2 === 0) {
      playNote(bassNotes[bassIndex % bassNotes.length], 0.4, 'sawtooth', 0.6);
    }
    bassIndex = (bassIndex + 1) % bassNotes.length;

    // Melody
    melody.forEach((note, i) => {
      const delay = i * 0.2;
      setTimeout(() => {
        if (playing) playNote(note.freq, note.dur, 'triangle', 0.5);
      }, delay * 1000);
    });

    const barDuration = melody.length * 0.2 + 0.4;
    timer = setTimeout(scheduleNextBar, barDuration * 1000);
  }

  return {
    start() {
      if (playing) return;
      playing = true;
      bassIndex = 0;
      attachUnlock();
      resume();
      scheduleNextBar();
    },
    stop() {
      playing = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
    },
    setVolume(vol: number) {
      volume = Math.max(0, Math.min(1, vol));
      if (master) master.gain.value = volume;
    },
  };
}
