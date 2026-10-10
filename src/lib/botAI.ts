'use client';

import type { Entity } from './gameLogic';

/**
 * Bot AI untuk mode single-player.
 * 
 * Bot meniru pemain sungguhan: bergerak, dash, dan memukul berdasarkan
 * jarak dan kondisi permainan. Tingkat kesulitan mengontrol:
 * - Reaksi: seberapa cepat bot merespons gerakan pemain
 * - Agresi: seberapa sering bot menyerang
 * - Akurasi: seberapa sering bot meleset
 * - Kecerdasan: seberapa efektif bot mengelola jarak dan momentum
 */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  // Reaksi (ms): delay sebelum bot mengubah keputusan
  reactionTime: number;
  // Agresi (0-1): probabilitas menyerang saat peluang terbuka
  aggression: number;
  // Akurasi (0-1): probabilitas pukulan mengenai (mengurangi miss)
  accuracy: number;
  // Kecerdasan jarak: seberapa disiplin mempertahankan jarak ideal
  distanceDiscipline: number;
  // Kemungkinan dash saat mengejar atau menghindar
  dashChance: number;
  // Probabilitas menggunakan momentum (dash + pukul)
  momentumChance: number;
  // HP threshold untuk mundur (0-1 dari maxHP)
  retreatThreshold: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionTime: 600,
    aggression: 0.4,
    accuracy: 0.5,
    distanceDiscipline: 0.3,
    dashChance: 0.3,
    momentumChance: 0.1,
    retreatThreshold: 0.3,
  },
  normal: {
    reactionTime: 350,
    aggression: 0.65,
    accuracy: 0.7,
    distanceDiscipline: 0.6,
    dashChance: 0.5,
    momentumChance: 0.3,
    retreatThreshold: 0.25,
  },
  hard: {
    reactionTime: 180,
    aggression: 0.85,
    accuracy: 0.85,
    distanceDiscipline: 0.85,
    dashChance: 0.7,
    momentumChance: 0.5,
    retreatThreshold: 0.2,
  },
};

export interface BotState {
  // Saat keputusan terakhir diambil
  lastDecisionTime: number;
  // Arah tujuan (-1 kiri, 0 diam, 1 kanan)
  targetDirection: -1 | 0 | 1;
  // Apakah sedang mencoba dash
  tryingToDash: boolean;
  // Apakah sedang mencoba pukul
  tryingToPunch: boolean;
  // Rencana momentum: dash sekarang, pukul setelah momentum aktif
  momentumPlanned: boolean;
}

/**
 * Buat state bot baru
 */
export function createBotState(): BotState {
  return {
    lastDecisionTime: 0,
    targetDirection: 0,
    tryingToDash: false,
    tryingToPunch: false,
    momentumPlanned: false,
  };
}

/**
 * Perbarui keputusan bot (dipanggil setiap frame)
 * 
 * @param state State bot (mutable)
 * @param bot Entity bot
 * @param player Entity pemain
 * @param difficulty Tingkat kesulitan
 * @param currentTime Waktu saat ini (ms)
 * @returns Input untuk updateGameTwoPlayer
 */
export function updateBotDecision(
  state: BotState,
  bot: Entity,
  player: Entity,
  difficulty: BotDifficulty,
  currentTime: number
): { left: boolean; right: boolean; dash: boolean; punch: boolean } {
  const profile = BOT_PROFILES[difficulty];

  // Ambil keputusan baru sesuai reaksi
  if (currentTime - state.lastDecisionTime >= profile.reactionTime) {
    state.lastDecisionTime = currentTime;
    makeDecision(state, bot, player, profile);
  }

  // Eksekusi keputusan → input
  return executeDecision(state, bot, player, profile);
}

function makeDecision(
  state: BotState,
  bot: Entity,
  player: Entity,
  profile: BotProfile
) {
  const distance = player.x - bot.x;
  const absDistance = Math.abs(distance);
  const hpRatio = bot.hp / bot.maxHp;
  const direction: -1 | 1 = distance > 0 ? 1 : -1;

  // Reset per-intent
  state.tryingToDash = false;
  state.tryingToPunch = false;
  state.targetDirection = 0;

  // 1. Momentum aktif? Langsung pukul.
  if (bot.momentumTimer > 0 && state.momentumPlanned) {
    state.tryingToPunch = true;
    state.targetDirection = direction;
    return;
  }

  // 2. HP rendah → mundur
  if (hpRatio < profile.retreatThreshold && Math.random() < 0.6) {
    state.targetDirection = -direction as -1 | 1;
    if (Math.random() < profile.dashChance * 0.5 && bot.stamina > 30 && bot.dashCooldown === 0) {
      state.tryingToDash = true;
    }
    return;
  }

  // 3. Ideal range: 50–75 px
  const idealMin = 50;
  const idealMax = 75;

  if (absDistance < idealMin) {
    // Terlalu dekat: serang atau mundur
    if (Math.random() < profile.aggression) {
      state.tryingToPunch = true;
      state.targetDirection = 0;
    } else if (Math.random() < profile.distanceDiscipline) {
      state.targetDirection = -direction as -1 | 1;
    }
  } else if (absDistance <= idealMax) {
    // Jarak ideal: serang
    if (Math.random() < profile.aggression) {
      state.tryingToPunch = true;
      state.targetDirection = 0;
      // Kadang rencanakan momentum
      if (
        Math.random() < profile.momentumChance &&
        bot.momentumTimer === 0 &&
        bot.stamina > 50 &&
        bot.dashCooldown === 0
      ) {
        state.tryingToDash = true;
        state.tryingToPunch = false;
        state.targetDirection = direction;
        state.momentumPlanned = true;
      }
    }
  } else if (absDistance <= idealMax * 2) {
    // Agak jauh: mendekat
    state.targetDirection = direction;
    if (Math.random() < profile.dashChance * 0.3 && bot.stamina > 40 && bot.dashCooldown === 0) {
      state.tryingToDash = true;
    }
  } else {
    // Jauh: mendekat, kadang dash
    state.targetDirection = direction;
    if (Math.random() < profile.dashChance && bot.stamina > 50 && bot.dashCooldown === 0) {
      state.tryingToDash = true;
    }
  }

  // 4. Rencana momentum prospektif: jarak menengah + stamina cukup
  if (
    !state.momentumPlanned &&
    bot.momentumTimer === 0 &&
    state.targetDirection === direction &&
    bot.stamina > 60 &&
    bot.dashCooldown === 0 &&
    absDistance > 60 &&
    absDistance < 120 &&
    Math.random() < profile.momentumChance
  ) {
    state.tryingToDash = true;
    state.momentumPlanned = true;
  }
}

function executeDecision(
  state: BotState,
  bot: Entity,
  player: Entity,
  profile: BotProfile
): { left: boolean; right: boolean; dash: boolean; punch: boolean } {
  const distance = player.x - bot.x;
  const direction: -1 | 1 = distance > 0 ? 1 : -1;

  // Reset momentum plan setelah dipakai
  if (bot.momentumTimer === 0 && state.momentumPlanned) {
    state.momentumPlanned = false;
  }

  const input = { left: false, right: false, dash: false, punch: false };

  // Gerakan
  if (state.targetDirection === -1) {
    input.left = true;
  } else if (state.targetDirection === 1) {
    input.right = true;
  }

  // Dash (hanya jika belum dash dan cooldown selesai)
  if (state.tryingToDash && !bot.isDashing && bot.dashCooldown === 0 && bot.stamina >= 25) {
    input.dash = true;
    // Arah dash sesuai target; kalau diam, dash ke arah lawan
    if (state.targetDirection === -1) {
      input.left = true;
      input.right = false;
    } else if (state.targetDirection === 1) {
      input.right = true;
      input.left = false;
    } else {
      if (direction === -1) input.left = true;
      else input.right = true;
    }
  }

  // Pukul (hanya jika belum pukul dan cooldown selesai)
  if (state.tryingToPunch && !bot.isPunching && bot.punchCooldown === 0) {
    // Akurasi: bot mudah meleset di difficulty rendah
    if (Math.random() < profile.accuracy) {
      input.punch = true;
      // Hadap ke lawan saat pukul
      if (direction === -1) {
        input.left = true;
        input.right = false;
      } else {
        input.right = true;
        input.left = false;
      }
    }
  }

  return input;
}
