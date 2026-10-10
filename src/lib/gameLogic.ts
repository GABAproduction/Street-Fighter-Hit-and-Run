import { GAME_CONFIG } from './gameConfig';

/**
 * Helper untuk AABB collision detection
 */
export function checkAABB(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw &&
         ax + aw > bx &&
         ay < by + bh &&
         ay + ah > by;
}

/**
 * Partikel untuk efek visual (hit, dash, dll)
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

/**
 * Entity dasar - bisa dipakai untuk pemain maupun target
 */
export interface Entity {
  x: number;           // posisi tengah (center) X
  y: number;           // posisi tengah Y (di lantai)
  facing: 1 | -1;      // 1 = kanan, -1 = kiri
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  name: string;        // nama ditampilkan di atas kepala
  
  // State gerak
  isMoving: boolean;
  isDashing: boolean;
  dashTimer: number;      // frame tersisa dash
  dashCooldown: number;   // frame cooldown dash
  dashDirection: 1 | -1 | 0;
  
  // State pukul
  isPunching: boolean;
  punchTimer: number;     // frame tersisa hitbox aktif
  punchCooldown: number;  // frame cooldown pukul
  
  // Momentum bonus (setelah dash)
  momentumTimer: number;  // frame tersisa bonus momentum
  
  // Penalti berdiri dekat
  closeRangeFrames: number; // berapa frame sudah dekat
  
  // Stamina regen delay
  staminaRegenDelay: number;
  
  // Warna placeholder
  color: string;
  
  // Visual feedback state (diisi oleh GameCanvas, tidak di gameLogic)
  hitFlashTimer?: number;
  screenShakeTimer?: number;
  footstepTimer?: number;
  lastX?: number;        // untuk deteksi gerak kaki
}

/**
 * Membuat entity pemain baru
 */
export function createPlayer(x: number, facing: 1 | -1 = 1): Entity {
  const cfg = GAME_CONFIG.character;
  return {
    x,
    y: GAME_CONFIG.arena.floorY,
    facing,
    hp: GAME_CONFIG.hp.max,
    maxHp: GAME_CONFIG.hp.max,
    stamina: GAME_CONFIG.stamina.max,
    maxStamina: GAME_CONFIG.stamina.max,
    name: `Petarung-${Math.floor(Math.random() * 9000) + 1000}`,
    isMoving: false,
    isDashing: false,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirection: 0,
    isPunching: false,
    punchTimer: 0,
    punchCooldown: 0,
    momentumTimer: 0,
    closeRangeFrames: 0,
    staminaRegenDelay: 0,
    color: cfg.color,
    hitFlashTimer: 0,
    screenShakeTimer: 0,
    footstepTimer: 0,
    lastX: x,
  };
}

/**
 * Membuat target latihan (dummy)
 */
export function createTarget(x: number): Entity {
  const cfg = GAME_CONFIG.target;
  return {
    x,
    y: GAME_CONFIG.arena.floorY,
    facing: -1, // menghadap pemain
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    stamina: 0,
    maxStamina: 0,
    name: 'Target Latihan',
    isMoving: false,
    isDashing: false,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirection: 0,
    isPunching: false,
    punchTimer: 0,
    punchCooldown: 0,
    momentumTimer: 0,
    closeRangeFrames: 0,
    staminaRegenDelay: 0,
    color: cfg.color,
    hitFlashTimer: 0,
    screenShakeTimer: 0,
    footstepTimer: 0,
    lastX: x,
  };
}

/**
 * Buat entity bot (single-player).
 * Mirip createPlayer tapi dengan nama & warna khas bot.
 */
export function createBot(x: number, facing: 1 | -1 = -1, name = 'BOT'): Entity {
  const cfg = GAME_CONFIG.character;
  return {
    x,
    y: GAME_CONFIG.arena.floorY,
    facing,
    hp: GAME_CONFIG.hp.max,
    maxHp: GAME_CONFIG.hp.max,
    stamina: GAME_CONFIG.stamina.max,
    maxStamina: GAME_CONFIG.stamina.max,
    name,
    isMoving: false,
    isDashing: false,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirection: 0,
    isPunching: false,
    punchTimer: 0,
    punchCooldown: 0,
    momentumTimer: 0,
    closeRangeFrames: 0,
    staminaRegenDelay: 0,
    color: '#f97316', // oranye khas bot
    hitFlashTimer: 0,
    screenShakeTimer: 0,
    footstepTimer: 0,
    lastX: x,
  };
}

/**
 * Mendapatkan hurtbox entity (dalam koordinat world)
 */
export function getHurtbox(e: Entity) {
  const cfg = GAME_CONFIG.character;
  const hb = cfg.hurtbox;
  // hurtbox centered di entity.x, entity.y adalah tengah bawah
  return {
    x: e.x - hb.width / 2 + hb.offsetX * e.facing,
    y: e.y - cfg.height + hb.offsetY, // y adalah bawah, jadi naik ke atas
    width: hb.width,
    height: hb.height,
  };
}

/**
 * Mendapatkan pushbox entity
 */
export function getPushbox(e: Entity) {
  const cfg = GAME_CONFIG.character;
  const pb = cfg.pushbox;
  return {
    x: e.x - pb.width / 2 + pb.offsetX * e.facing,
    y: e.y - cfg.height + pb.offsetY,
    width: pb.width,
    height: pb.height,
  };
}

/**
 * Mendapatkan hitbox pukulan (hanya aktif saat isPunching)
 */
export function getPunchHitbox(e: Entity) {
  const cfg = GAME_CONFIG.character;
  const hb = cfg.punchHitbox;
  // hitbox di depan karakter
  const offsetX = hb.offsetX * e.facing;
  return {
    x: e.x + offsetX - hb.width / 2,
    y: e.y - cfg.height + hb.offsetY,
    width: hb.width,
    height: hb.height,
  };
}

/**
 * Update stamina (regen)
 */
function updateStamina(e: Entity) {
  const cfg = GAME_CONFIG.stamina;
  if (e.stamina >= e.maxStamina) {
    e.stamina = e.maxStamina;
    e.staminaRegenDelay = 0;
    return;
  }
  
  if (e.staminaRegenDelay > 0) {
    e.staminaRegenDelay--;
  } else {
    e.stamina = Math.min(e.maxStamina, e.stamina + cfg.regenPerFrame);
  }
}

/**
 * Cek apakah dua entity saling dekat (untuk penalti)
 */
function checkCloseRange(player: Entity, target: Entity): boolean {
  const distance = Math.abs(player.x - target.x);
  return distance < GAME_CONFIG.damage.closeRangeThreshold;
}

/**
 * Update timer-timer (cooldown, duration, dll)
 */
function updateTimers(e: Entity) {
  if (e.dashTimer > 0) e.dashTimer--;
  if (e.dashCooldown > 0) e.dashCooldown--;
  if (e.punchTimer > 0) e.punchTimer--;
  if (e.punchCooldown > 0) e.punchCooldown--;
  if (e.momentumTimer > 0) e.momentumTimer--;
  if (e.hitFlashTimer && e.hitFlashTimer > 0) e.hitFlashTimer--;
  if (e.screenShakeTimer && e.screenShakeTimer > 0) e.screenShakeTimer--;
}

/**
 * Handle input untuk pemain
 */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  dash: boolean;
  punch: boolean;
}

export function handlePlayerInput(player: Entity, input: PlayerInput) {
  const cfg = GAME_CONFIG.character;
  
  // Gerak kiri/kanan (hanya kalau tidak dash dan tidak pukul)
  if (!player.isDashing && !player.isPunching) {
    if (input.left && !input.right) {
      player.facing = -1;
      player.isMoving = true;
      player.x -= cfg.moveSpeed;
    } else if (input.right && !input.left) {
      player.facing = 1;
      player.isMoving = true;
      player.x += cfg.moveSpeed;
    } else {
      player.isMoving = false;
    }
  }
  
  // Dash
  if (input.dash && player.dashCooldown === 0 && player.stamina >= cfg.dashStaminaCost && !player.isDashing) {
    player.isDashing = true;
    player.dashTimer = cfg.dashDurationFrames;
    player.dashCooldown = cfg.dashCooldownFrames;
    player.dashDirection = player.facing;
    player.stamina -= cfg.dashStaminaCost;
    player.staminaRegenDelay = GAME_CONFIG.stamina.regenDelayFrames;
    player.isMoving = false; // dash mengoverride gerak normal
  }
  
  // Pukul
  if (input.punch && player.punchCooldown === 0 && !player.isPunching) {
    player.isPunching = true;
    player.punchTimer = cfg.punchDurationFrames;
    player.punchCooldown = cfg.punchCooldownFrames;
    player.isMoving = false;
  }
}

/**
 * Update posisi saat dash
 */
function updateDash(player: Entity) {
  const cfg = GAME_CONFIG.character;
  if (player.isDashing && player.dashTimer > 0) {
    player.x += cfg.dashSpeed * player.dashDirection;
  } else if (player.isDashing && player.dashTimer === 0) {
    player.isDashing = false;
    player.dashDirection = 0;
    // Mulai timer momentum bonus
    player.momentumTimer = GAME_CONFIG.damage.momentumWindowFrames;
  }
}

/**
 * Update pukulan - cek hit ke target
 * Return info hit untuk feedback visual/suara
 */
export interface HitResult {
  hit: boolean;
  damage: number;
  hitX: number;
  hitY: number;
  isMomentum: boolean;
}

export function updatePunch(attacker: Entity, defender: Entity): HitResult {
  const result: HitResult = {
    hit: false,
    damage: 0,
    hitX: 0,
    hitY: 0,
    isMomentum: false,
  };
  
  if (!attacker.isPunching || attacker.punchTimer === 0) {
    attacker.isPunching = false;
    return result;
  }
  
  // Cek collision hitbox attacker vs hurtbox defender
  const hitbox = getPunchHitbox(attacker);
  const hurtbox = getHurtbox(defender);
  
  const hit = checkAABB(
    hitbox.x, hitbox.y, hitbox.width, hitbox.height,
    hurtbox.x, hurtbox.y, hurtbox.width, hurtbox.height
  );
  
  if (hit) {
    // Hit! Hitung damage
    let damage = GAME_CONFIG.damage.basePunch;
    const isMomentum = attacker.momentumTimer > 0;
    
    // Bonus momentum jika baru selesai dash
    if (isMomentum) {
      damage *= GAME_CONFIG.damage.momentumBonus;
    }
    
    // Penalti berdiri dekat terlalu lama
    if (attacker.closeRangeFrames > 0) {
      const penalty = Math.min(
        GAME_CONFIG.damage.maxCloseRangePenalty,
        attacker.closeRangeFrames * GAME_CONFIG.damage.closeRangePenaltyPerFrame
      );
      damage *= (1 - penalty);
    }
    
    const finalDamage = Math.round(damage);
    defender.hp = Math.max(0, defender.hp - finalDamage);
    
    // Trigger visual feedback pada defender
    defender.hitFlashTimer = GAME_CONFIG.juice.hitPauseFrames;
    defender.screenShakeTimer = GAME_CONFIG.juice.screenShakeDurationFrames;
    
    attacker.isPunching = false; // pukulan hanya hit sekali per animasi
    attacker.punchTimer = 0;
    
    result.hit = true;
    result.damage = finalDamage;
    result.hitX = (hitbox.x + hurtbox.x) / 2; // posisi tengah untuk partikel
    result.hitY = (hitbox.y + hurtbox.y) / 2;
    result.isMomentum = isMomentum;
  }
  
  return result;
}

/**
 * Update pushbox collision - dorong agar tidak saling menembus
 */
export function resolvePushCollision(player: Entity, other: Entity) {
  const pPush = getPushbox(player);
  const oPush = getPushbox(other);
  
  if (checkAABB(pPush.x, pPush.y, pPush.width, pPush.height,
                oPush.x, oPush.y, oPush.width, oPush.height)) {
    // Saling mendorong - player didorong ke arah lawan
    const overlap = (pPush.width + oPush.width) / 2 - Math.abs(player.x - other.x);
    if (player.x < other.x) {
      player.x -= overlap / 2;
      other.x += overlap / 2;
    } else {
      player.x += overlap / 2;
      other.x -= overlap / 2;
    }
  }
}

/**
 * Clamp posisi ke batas arena (dengan arena menyempit)
 */
export function clampToArena(entity: Entity, leftWall: number, rightWall: number) {
  const cfg = GAME_CONFIG.character;
  const halfWidth = cfg.pushbox.width / 2; // pakai pushbox untuk batas
  
  if (entity.x - halfWidth < leftWall) {
    entity.x = leftWall + halfWidth;
  }
  if (entity.x + halfWidth > rightWall) {
    entity.x = rightWall - halfWidth;
  }
}

/**
 * Update arena walls (menyempit seiring waktu)
 */
export function updateArenaWalls(elapsedMs: number): { left: number; right: number } {
  const cfg = GAME_CONFIG.arena;
  if (elapsedMs < cfg.shrinkStartTime) {
    return { left: cfg.leftWall, right: cfg.rightWall };
  }
  
  const shrinkTime = elapsedMs - cfg.shrinkStartTime;
  const shrinkFrames = shrinkTime / GAME_CONFIG.frameMs;
  const totalShrink = shrinkFrames * cfg.shrinkSpeed;
  
  return {
    left: Math.min(cfg.leftWall + totalShrink, cfg.minLeftWall),
    right: Math.max(cfg.rightWall - totalShrink, cfg.maxRightWall),
  };
}

/**
 * Update penalti berdiri dekat
 */
function updateCloseRangePenalty(player: Entity, target: Entity) {
  if (checkCloseRange(player, target)) {
    player.closeRangeFrames++;
  } else {
    player.closeRangeFrames = 0;
  }
}

/**
 * Generate partikel hit
 */
export function createHitParticles(x: number, y: number, color: string, count?: number): Particle[] {
  const cfg = GAME_CONFIG.juice;
  const num = count || cfg.hitParticles;
  const particles: Particle[] = [];
  
  for (let i = 0; i < num; i++) {
    const angle = (Math.PI * 2 * i) / num + Math.random() * 0.5;
    const speed = cfg.particleSpeed * (0.5 + Math.random() * 0.5);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2, // sedikit ke atas
      life: cfg.particleLifetimeFrames,
      maxLife: cfg.particleLifetimeFrames,
      size: cfg.particleSize * (0.5 + Math.random() * 0.5),
      color,
    });
  }
  return particles;
}

/**
 * Update partikel
 */
export function updateParticles(particles: Particle[]): Particle[] {
  return particles
    .map(p => ({
      ...p,
      x: p.x + p.vx,
      y: p.y + p.vy,
      vy: p.vy + 0.3, // gravity
      life: p.life - 1,
    }))
    .filter(p => p.life > 0);
}

/**
 * Main update loop untuk satu frame
 */
export function updateGame(
  player: Entity,
  target: Entity,
  input: PlayerInput,
  elapsedMs: number
): { leftWall: number; right: number; hitResult: HitResult } {
  // Update arena walls
  const walls = updateArenaWalls(elapsedMs);
  
  // Handle input
  handlePlayerInput(player, input);
  
  // Update dash
  updateDash(player);
  
  // Update punch - cek hit ke target
  const hitResult = updatePunch(player, target);
  
  // Resolve push collision
  resolvePushCollision(player, target);
  
  // Clamp ke arena
  clampToArena(player, walls.left, walls.right);
  clampToArena(target, walls.left, walls.right);
  
  // Update timers
  updateTimers(player);
  updateTimers(target);
  
  // Update stamina
  updateStamina(player);
  
  // Update close range penalty
  updateCloseRangePenalty(player, target);
  
  // Footstep timer untuk suara jalan
  if (player.isMoving && !player.isDashing) {
    player.footstepTimer = (player.footstepTimer || 0) + 1;
  } else {
    player.footstepTimer = 0;
  }
  
  return { leftWall: walls.left, right: walls.right, hitResult };
}

/**
 * Update game logic untuk dua pemain (human vs bot).
 * Setiap pemain memiliki input sendiri; damage mutual terjadi.
 */
export function updateGameTwoPlayer(
  player: Entity,
  opponent: Entity,
  playerInput: PlayerInput,
  opponentInput: PlayerInput,
  elapsedMs: number
): { leftWall: number; right: number; playerHit: HitResult; opponentHit: HitResult } {
  // Update arena walls
  const walls = updateArenaWalls(elapsedMs);

  // Handle both inputs
  handlePlayerInput(player, playerInput);
  handlePlayerInput(opponent, opponentInput);

  // Update dash for both
  updateDash(player);
  updateDash(opponent);

  // Both can punch; order matters: player first, then opponent.
  // This permits both to hit each other in the same frame if timing overlaps.
  const playerHit = updatePunch(player, opponent);
  const opponentHit = updatePunch(opponent, player);

  // Resolve push collision only once
  resolvePushCollision(player, opponent);

  // Clamp both entities to arena bounds
  clampToArena(player, walls.left, walls.right);
  clampToArena(opponent, walls.left, walls.right);

  // Update timers for both
  updateTimers(player);
  updateTimers(opponent);

  // Update stamina for both
  updateStamina(player);
  updateStamina(opponent);

  // Update close-range penalties for both
  updateCloseRangePenalty(player, opponent);
  updateCloseRangePenalty(opponent, player);

  // Footstep timers for both
  for (const e of [player, opponent]) {
    if (e.isMoving && !e.isDashing) {
      e.footstepTimer = (e.footstepTimer || 0) + 1;
    } else {
      e.footstepTimer = 0;
    }
  }

  return { leftWall: walls.left, right: walls.right, playerHit: playerHit, opponentHit: opponentHit };
}

/**
 * Reset ronde (untuk best of 3)
 */
export function resetRound(player: Entity, target: Entity, playerX: number, targetX: number) {
  const cfg = GAME_CONFIG.character;
  player.x = playerX;
  player.y = GAME_CONFIG.arena.floorY;
  player.hp = GAME_CONFIG.hp.max;
  player.stamina = GAME_CONFIG.stamina.max;
  // Hadap ke lawan: pemain di kiri → kanan (1), di kanan → kiri (-1)
  player.facing = playerX < targetX ? 1 : -1;
  player.isMoving = false;
  player.isDashing = false;
  player.dashTimer = 0;
  player.dashCooldown = 0;
  player.dashDirection = 0;
  player.isPunching = false;
  player.punchTimer = 0;
  player.punchCooldown = 0;
  player.momentumTimer = 0;
  player.closeRangeFrames = 0;
  player.staminaRegenDelay = 0;
  player.hitFlashTimer = 0;
  player.screenShakeTimer = 0;
  player.footstepTimer = 0;
  player.lastX = playerX;
  
  target.x = targetX;
  target.y = GAME_CONFIG.arena.floorY;
  target.hp = GAME_CONFIG.target.maxHp;
  // Target selalu menghadap pemain
  target.facing = targetX < playerX ? 1 : -1;
  target.hitFlashTimer = 0;
  target.screenShakeTimer = 0;
}

/**
 * Cek apakah ronde selesai
 */
export function checkRoundEnd(player: Entity, target: Entity): 'player' | 'target' | null {
  if (player.hp <= 0) return 'target';
  if (target.hp <= 0) return 'player';
  return null;
}