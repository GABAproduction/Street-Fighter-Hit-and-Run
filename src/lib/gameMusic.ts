'use client';

/**
 * Musik latar looping sederhana pakai WebAudio (tanpa file aset).
 * Dipakai di GameCanvas (single-player) & MultiplayerGameCanvas.
 */
export interface MusicController {
  start: () => void;
  stop: () => void;
  setVolume: (vol: number) => void;
}

let musicContext: AudioContext | null = null;
let musicGain: GainNode | null = null;
let musicOscillators: OscillatorNode[] = [];
let musicInterval: ReturnType<typeof setInterval> | null = null;
let isMusicPlaying = false;
let musicVolume = 0.08;

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
let bassIndex = 0;

function getCtx() {
  if (!musicContext) {
    musicContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    musicGain = musicContext.createGain();
    musicGain.gain.value = musicVolume;
    musicGain.connect(musicContext.destination);
  }
  return musicContext;
}

function playNote(freq: number, duration: number, type: OscillatorType = 'square', gainMult = 1) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = musicVolume * gainMult;
  osc.connect(gain);
  gain.connect(musicGain!);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(musicVolume * gainMult, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
  musicOscillators.push(osc);
  osc.onended = () => {
    const idx = musicOscillators.indexOf(osc);
    if (idx !== -1) musicOscillators.splice(idx, 1);
  };
}

function scheduleNextBar() {
  if (!isMusicPlaying) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Bass tiap 2 beat
  if (bassIndex % 2 === 0) {
    playNote(bassNotes[bassIndex % bassNotes.length], 0.4, 'sawtooth', 0.6);
  }
  bassIndex = (bassIndex + 1) % bassNotes.length;

  // Melody
  melody.forEach((note, i) => {
    const delay = i * 0.2; // spacing
    setTimeout(() => {
      if (!isMusicPlaying) return;
      playNote(note.freq, note.dur, 'triangle', 0.5);
    }, delay * 1000);
  });

  const barDuration = melody.length * 0.2 + 0.3;
  musicInterval = setTimeout(scheduleNextBar, barDuration * 1000);
}

export function createMusic(): MusicController {
  return {
    start() {
      if (isMusicPlaying) return;
      isMusicPlaying = true;
      bassIndex = 0;
      scheduleNextBar();
    },
    stop() {
      isMusicPlaying = false;
      if (musicInterval) {
        clearTimeout(musicInterval);
        musicInterval = null;
      }
      musicOscillators.forEach(osc => {
        try { osc.stop(); } catch {}
      });
      musicOscillators = [];
    },
    setVolume(vol: number) {
      musicVolume = Math.max(0, Math.min(1, vol));
      if (musicGain) musicGain.gain.value = musicVolume;
    },
  };
}