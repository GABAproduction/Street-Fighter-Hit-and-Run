/**
 * Konfigurasi game - SEMUA ANGKA DI SINI supaya mudah di-setel nanti.
 * Nilai awal masuk akal untuk prototipe.
 */

export const GAME_CONFIG = {
  // Arena
  arena: {
    width: 960,
    height: 540,
    floorY: 420, // posisi y lantai (dari atas)
    leftWall: 60,
    rightWall: 900,
    // Arena menyempit setelah 45 detik
    shrinkStartTime: 45_000, // ms
    shrinkSpeed: 0.5, // pixel per frame (60fps -> ~30px/detik)
    minLeftWall: 120,
    maxRightWall: 840,
  },

  // Karakter
  character: {
    width: 48,
    height: 96,
    // Hurtbox (area yang bisa kena pukulan) - sedikit lebih kecil dari sprite
    hurtbox: { width: 36, height: 84, offsetX: 6, offsetY: 6 },
    // Pushbox (agar tidak saling menembus)
    pushbox: { width: 28, height: 84, offsetX: 10, offsetY: 6 },
    // Hitbox pukulan (muncul saat pukul)
    punchHitbox: { width: 28, height: 24, offsetX: 48, offsetY: 30 }, // offsetX dari pusat karakter ke depan
    punchDurationFrames: 8, // berapa frame hitbox aktif
    punchCooldownFrames: 18, // jeda sebelum bisa pukul lagi
    moveSpeed: 4.5, // pixel per frame
    dashSpeed: 18, // pixel per frame saat dash
    dashDurationFrames: 10,
    dashCooldownFrames: 30,
    dashStaminaCost: 25,
    // Warna placeholder
    color: '#3b82f6', // biru untuk pemain
    targetColor: '#ef4444', // merah untuk target latihan
  },

  // Stamina
  stamina: {
    max: 100,
    regenPerFrame: 0.15, // ~9 per detik di 60fps
    regenDelayFrames: 30, // jeda sebelum mulai regen setelah dipakai
  },

  // Damage
  damage: {
    basePunch: 12,
    momentumBonus: 1.6, // pukulan setelah dash dikali ini (12 * 1.6 = 19.2)
    momentumWindowFrames: 12, // berapa frame setelah dash selesai bonus masih aktif
    // Penalti berdiri dekat lawan terlalu lama
    closeRangeThreshold: 80, // jarak (px) dianggap "dekat"
    closeRangePenaltyPerFrame: 0.02, // damage dikalikan (1 - penalty * frames)
    maxCloseRangePenalty: 0.6, // maksimal 60% reduction
  },

  // HP
  hp: {
    max: 100,
  },

  // Target latihan (dummy)
  target: {
    width: 48,
    height: 96,
    hurtbox: { width: 36, height: 84, offsetX: 6, offsetY: 6 },
    hp: 100,
    maxHp: 100,
    color: '#ef4444',
  },

  // Juice / Visual feedback
  juice: {
    hitPauseFrames: 4,           // freeze frame saat hit (60fps = ~67ms)
    screenShakeIntensity: 8,     // pixel max shake
    screenShakeDurationFrames: 10,
    // Partikel hit
    hitParticles: 12,            // jumlah partikel
    particleSpeed: 6,            // pixel per frame
    particleLifetimeFrames: 20,
    particleSize: 4,
    // Dash trail
    dashTrailCount: 6,
    dashTrailFadeFrames: 8,
    // Health bar di atas kepala
    showHealthBar: true,
    healthBarWidth: 48,
    healthBarHeight: 5,
    healthBarOffsetY: 14,        // jarak dari atas kepala
    // Nama
    showName: true,
    nameOffsetY: 28,             // jarak dari atas kepala
    nameFontSize: '11px',
    // Footstep sound timing
    footstepIntervalFrames: 12,  // jalan: suara tiap 12 frame
    dashSoundPitch: 1.5,
    hitSoundPitch: 1.0,
    punchSoundPitch: 0.8,
  },

  // Game loop
  fps: 60,
  frameMs: 1000 / 60,
} as const;

export type GameConfig = typeof GAME_CONFIG;