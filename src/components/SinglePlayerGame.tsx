'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createMusic } from '@/lib/gameMusic';
import { GAME_CONFIG } from '@/lib/gameConfig';
import {
  createPlayer,
  createBot,
  updateGameTwoPlayer,
  resetRound,
  checkRoundEnd,
  getPunchHitbox,
  createHitParticles,
  updateParticles,
  Entity,
  PlayerInput,
  Particle,
} from '@/lib/gameLogic';
import { createBotState, updateBotDecision, BotDifficulty } from '@/lib/botAI';
import { drawArena, drawFighter, drawDashTrail } from '@/lib/gameArt';

interface SinglePlayerGameProps {
  difficulty: BotDifficulty;
  // 1 = cuma 1 ronde, 2 = Best of 3 (butuh 2 kemenangan)
  winsNeeded?: number;
  playerName: string;
  onMatchEnd?: (winner: 'player' | 'bot' | 'target' | 'opponent') => void;
  onBackToLobby?: () => void;
}

export default function SinglePlayerGame({
  difficulty,
  winsNeeded = 2,
  playerName,
  onMatchEnd,
  onBackToLobby,
}: SinglePlayerGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const elapsedMsRef = useRef<number>(0);

  // Audio context untuk sound effects
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<ReturnType<typeof createMusic> | null>(null);

  // Game state (pakai ref agar tidak trigger re-render React)
  const playerRef = useRef<Entity>(createPlayer(200, 1));
  const botRef = useRef<Entity>(createBot(760, -1, 'BOT'));
  botRef.current.name = 'BOT';
  const inputRef = useRef<PlayerInput>({ left: false, right: false, dash: false, punch: false });

  // Sync player name from prop
  useEffect(() => {
    playerRef.current.name = playerName;
  }, [playerName]);
  const botInputRef = useRef<PlayerInput>({ left: false, right: false, dash: false, punch: false });
  const botStateRef = useRef(createBotState());
  const keysPressedRef = useRef<Set<string>>(new Set());

  // Visual effects state
  const particlesRef = useRef<Particle[]>([]);
  const screenShakeRef = useRef({ x: 0, y: 0, timer: 0 });
  const hitPauseRef = useRef(0);
  const dashTrailRef = useRef<Array<{ x: number; y: number; alpha: number }>>([]);
  const matchOverRef = useRef(false);
  const gameOverRef = useRef(false);
  const winsRef = useRef({ my: 0, bot: 0 });
  const roundRef = useRef(1);
  const roundScoresRef = useRef<Array<{ round: number; winner: 'player' | 'bot' }>>([]);
  const renderRef = useRef<(canvas: HTMLCanvasElement) => void>(() => {});

  // State untuk UI
  const [playerHp, setPlayerHp] = useState<number>(GAME_CONFIG.hp.max);
  const [botHp, setBotHp] = useState<number>(GAME_CONFIG.hp.max);
  const [playerStamina, setPlayerStamina] = useState<number>(GAME_CONFIG.stamina.max);
  const [walls, setWalls] = useState<{ left: number; right: number }>({ left: GAME_CONFIG.arena.leftWall, right: GAME_CONFIG.arena.rightWall });
  const [round, setRound] = useState<number>(1);
  const [playerWins, setPlayerWins] = useState<number>(0);
  const [botWins, setBotWins] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<'player' | 'bot' | null>(null);
  const [musicOn, setMusicOn] = useState(true);

  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);
  useEffect(() => { winsRef.current = { my: playerWins, bot: botWins }; }, [playerWins, botWins]);
  useEffect(() => { roundRef.current = round; }, [round]);

  // ============ AUDIO HELPERS ============

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((
    freq: number,
    duration: number,
    type: OscillatorType = 'square',
    volume: number = 0.1,
    pitch: number = 1
  ) => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.value = freq * pitch;
      gain.gain.value = volume;

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      // Audio gagal, abaikan
    }
  }, [getAudioContext]);

  const playFootstep = useCallback(() => {
    playTone(120, 0.05, 'sine', 0.03);
  }, [playTone]);

  const playDash = useCallback(() => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  }, [getAudioContext]);

  const playPunch = useCallback((isMomentum: boolean) => {
    playTone(isMomentum ? 300 : 180, 0.08, 'square', 0.08, isMomentum ? 1.5 : 1);
  }, [playTone]);

  const playHit = useCallback((isMomentum: boolean) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.06;
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.1);

    playTone(isMomentum ? 400 : 250, 0.12, 'triangle', 0.06, isMomentum ? 1.3 : 1);
  }, [getAudioContext, playTone]);

  const playRoundEnd = useCallback((isWin: boolean) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const notes = isWin ? [523, 659, 784, 1047] : [220, 185, 165, 147];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
  }, [getAudioContext]);

  // ============ ROUND / MATCH ============

  const applyRoundWin = useCallback((isPlayerWinner: boolean) => {
    if (gameOverRef.current) return;
    if (roundScoresRef.current.length >= roundRef.current) return;

    roundScoresRef.current.push({ round: roundScoresRef.current.length + 1, winner: isPlayerWinner ? 'player' : 'bot' });
    playRoundEnd(isPlayerWinner);

    const nextMy = winsRef.current.my + (isPlayerWinner ? 1 : 0);
    const nextBot = winsRef.current.bot + (isPlayerWinner ? 0 : 1);
    winsRef.current = { my: nextMy, bot: nextBot };
    if (isPlayerWinner) setPlayerWins(nextMy);
    else setBotWins(nextBot);

    const matchFinished = nextMy >= winsNeeded || nextBot >= winsNeeded;
    if (matchFinished) {
      const playerWon = nextMy >= winsNeeded;
      setGameOver(true);
      setWinner(playerWon ? 'player' : 'bot');
      onMatchEnd?.(playerWon ? 'player' : 'bot');
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    } else {
      setRound(r => r + 1);
      roundRef.current += 1;
      resetRound(playerRef.current, botRef.current, 200, 760);
      particlesRef.current = [];
      dashTrailRef.current = [];
      matchOverRef.current = false;
      playerRef.current.hp = GAME_CONFIG.hp.max;
      botRef.current.hp = GAME_CONFIG.hp.max;
      botStateRef.current = createBotState();
    }
  }, [playRoundEnd, onMatchEnd, winsNeeded]);

  // ============ INPUT HANDLERS ============

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysPressedRef.current.add(e.code);

    if (['ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyZ'].includes(e.code)) {
      e.preventDefault();
    }

    switch (e.code) {
      case 'ArrowLeft':
        inputRef.current.left = true;
        break;
      case 'ArrowRight':
        inputRef.current.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        if (!inputRef.current.dash) {
          playDash();
        }
        inputRef.current.dash = true;
        break;
      case 'Space':
      case 'KeyX':
      case 'KeyZ':
        inputRef.current.punch = true;
        break;
    }
  }, [playDash]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysPressedRef.current.delete(e.code);

    switch (e.code) {
      case 'ArrowLeft':
        inputRef.current.left = false;
        break;
      case 'ArrowRight':
        inputRef.current.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        inputRef.current.dash = false;
        break;
      case 'Space':
      case 'KeyX':
      case 'KeyZ':
        inputRef.current.punch = false;
        break;
    }
  }, []);

  // ============ GAME LOOP ============

  const gameLoop = useCallback((timestamp: number) => {
    if (matchOverRef.current && gameOverRef.current) {
      return;
    }

    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaMs = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

    if (hitPauseRef.current > 0) {
      hitPauseRef.current--;
      renderRef.current(canvasRef.current!);
      animationRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    elapsedMsRef.current += deltaMs;

    const player = playerRef.current;
    const bot = botRef.current;
    const input = inputRef.current;

    // Bot membuat keputusan setiap frame
    const botInput = updateBotDecision(
      botStateRef.current,
      bot,
      player,
      difficulty,
      timestamp
    );
    botInputRef.current = botInput;

    // Update game dengan dua pemain (bot juga mendapat stamina/regen sendiri)
    const result = updateGameTwoPlayer(player, bot, input, botInput, elapsedMsRef.current);

    // Feedback untuk pukulan pemain
    if (result.playerHit.hit) {
      hitPauseRef.current = GAME_CONFIG.juice.hitPauseFrames;
      screenShakeRef.current.timer = GAME_CONFIG.juice.screenShakeDurationFrames;
      const particleColor = result.playerHit.isMomentum ? '#fbbf24' : '#ef4444';
      particlesRef.current.push(...createHitParticles(result.playerHit.hitX, result.playerHit.hitY, particleColor));
      playPunch(result.playerHit.isMomentum);
      playHit(result.playerHit.isMomentum);
    }

    // Feedback untuk pukulan bot
    if (result.opponentHit.hit) {
      hitPauseRef.current = GAME_CONFIG.juice.hitPauseFrames;
      screenShakeRef.current.timer = GAME_CONFIG.juice.screenShakeDurationFrames;
      const particleColor = result.opponentHit.isMomentum ? '#fbbf24' : '#3b82f6';
      particlesRef.current.push(...createHitParticles(result.opponentHit.hitX, result.opponentHit.hitY, particleColor));
      playPunch(result.opponentHit.isMomentum);
      playHit(result.opponentHit.isMomentum);
    }

    // Footstep untuk pemain & bot
    if (player.isMoving && !player.isDashing && player.footstepTimer) {
      if (player.footstepTimer % GAME_CONFIG.juice.footstepIntervalFrames === 0) {
        playFootstep();
      }
    }

    // Dash trail untuk pemain & bot
    if (player.isDashing) {
      dashTrailRef.current.push({
        x: player.x,
        y: player.y - GAME_CONFIG.character.height / 2,
        alpha: 1,
      });
      if (dashTrailRef.current.length > GAME_CONFIG.juice.dashTrailCount) {
        dashTrailRef.current.shift();
      }
    }
    if (bot.isDashing) {
      dashTrailRef.current.push({
        x: bot.x,
        y: bot.y - GAME_CONFIG.character.height / 2,
        alpha: 1,
      });
      if (dashTrailRef.current.length > GAME_CONFIG.juice.dashTrailCount * 2) {
        dashTrailRef.current.shift();
      }
    }

    dashTrailRef.current = dashTrailRef.current
      .map(t => ({ ...t, alpha: t.alpha - 1 / GAME_CONFIG.juice.dashTrailFadeFrames }))
      .filter(t => t.alpha > 0);

    particlesRef.current = updateParticles(particlesRef.current);

    if (screenShakeRef.current.timer > 0) {
      const intensity = GAME_CONFIG.juice.screenShakeIntensity;
      screenShakeRef.current.x = (Math.random() - 0.5) * intensity * 2;
      screenShakeRef.current.y = (Math.random() - 0.5) * intensity * 2;
      screenShakeRef.current.timer--;
    } else {
      screenShakeRef.current.x = 0;
      screenShakeRef.current.y = 0;
    }

    setWalls({ left: result.leftWall, right: result.right });

    setPlayerHp(player.hp);
    setBotHp(bot.hp);
    setPlayerStamina(Math.round(player.stamina));

    // Cek ronde selesai — bot dan pemain sama beratnya
    if (!matchOverRef.current) {
      const roundWinner = checkRoundEnd(player, bot);
      if (roundWinner) {
        matchOverRef.current = true;
        player.hp = 1;
        bot.hp = 1;
        const isPlayerWinner = roundWinner === 'player';
        // Beri jeda singkat agar pemain melihat hasil KO sebelum reset
        setTimeout(() => applyRoundWin(isPlayerWinner), 300);
      }
    }

    renderRef.current(canvasRef.current!);
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [difficulty, playFootstep, playPunch, playHit, applyRoundWin]);

  // ============ RENDER ============

  const render = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { arena } = GAME_CONFIG;
    const player = playerRef.current;
    const bot = botRef.current;
    const cfg = GAME_CONFIG.character;

    ctx.save();
    ctx.translate(screenShakeRef.current.x, screenShakeRef.current.y);

    ctx.clearRect(0, 0, arena.width, arena.height);

    drawArena(ctx, arena, walls, elapsedMsRef.current);

    drawDashTrail(ctx, dashTrailRef.current, cfg.width, cfg.height);

    particlesRef.current.forEach(p => {
      const alpha = p.life / p.maxLife;
      if (p.color.startsWith('#')) {
        const hex = p.color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    });

    drawFighter(ctx, bot, false, elapsedMsRef.current);
    drawFighter(ctx, player, true, elapsedMsRef.current);

    // Efek pukulan pemain
    if (player.isPunching && player.punchTimer > 0) {
      const hitbox = getPunchHitbox(player);
      const extP = 1 - Math.max(0, player.punchTimer) / GAME_CONFIG.character.punchDurationFrames;
      const cx = hitbox.x + hitbox.width / 2;
      const cy = hitbox.y + hitbox.height / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(253,224,71,0.7)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, (1 - extP) * 26 + 8, Math.PI * 0.2, Math.PI * 1.1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(253,224,71,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, hitbox.width * 0.7, hitbox.height * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Efek pukulan bot
    if (bot.isPunching && bot.punchTimer > 0) {
      const hitbox = getPunchHitbox(bot);
      const extP = 1 - Math.max(0, bot.punchTimer) / GAME_CONFIG.character.punchDurationFrames;
      const cx = hitbox.x + hitbox.width / 2;
      const cy = hitbox.y + hitbox.height / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(251,146,60,0.7)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, (1 - extP) * 26 + 8, Math.PI * 0.2, Math.PI * 1.1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(251,146,60,0.25)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, hitbox.width * 0.7, hitbox.height * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (player.momentumTimer > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ MOMENTUM!', player.x, player.y - cfg.height - 20);
      ctx.textAlign = 'left';
    }
    if (bot.momentumTimer > 0) {
      ctx.fillStyle = '#fb923c';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ MOMENTUM!', bot.x, bot.y - cfg.height - 20);
      ctx.textAlign = 'left';
    }
    if (player.closeRangeFrames > 30) {
      ctx.fillStyle = '#f87171';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ TERLALU DEKAT!', player.x, player.y - cfg.height - 40);
      ctx.textAlign = 'left';
    }

    const shrinkTimeLeft = Math.max(0, GAME_CONFIG.arena.shrinkStartTime - elapsedMsRef.current);
    if (shrinkTimeLeft > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Arena menyempit dalam: ${Math.ceil(shrinkTimeLeft / 1000)}s`, arena.width / 2, 30);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ ARENA MENYEMPIT!', arena.width / 2, 30);
      ctx.textAlign = 'left';
    }

    // Round info
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`RONDE ${round} / ${winsNeeded * 2 - 1}`, arena.width / 2, 55);
    ctx.fillText(`Kamu: ${playerWins}  -  BOT: ${botWins}`, arena.width / 2, 75);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('← → Gerak  |  Shift Dash  |  Spasi/X/Z Pukul', 20, arena.height - 20);

    ctx.restore();
  }, [walls, round, playerWins, botWins, winsNeeded]);

  renderRef.current = render;

  // ============ INIT & CLEANUP ============

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = GAME_CONFIG.arena.width;
    canvas.height = GAME_CONFIG.arena.height;

    musicRef.current = createMusic();
    musicRef.current.setVolume(0.4);
    musicRef.current.start();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    lastTimeRef.current = 0;
    elapsedMsRef.current = 0;
    hitPauseRef.current = 0;
    particlesRef.current = [];
    dashTrailRef.current = [];
    screenShakeRef.current = { x: 0, y: 0, timer: 0 };
    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      musicRef.current?.stop();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [handleKeyDown, handleKeyUp, gameLoop]);

  // Reset match bila difficulty/winsNeeded berganti dari luar
  useEffect(() => {
    // Reset internal bila props berubah
    // (hanya reset jika match belum mulai / sudah selesai agar tidak mengganggu ronde berjalan)
    if (roundRef.current === 1 && roundScoresRef.current.length === 0) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, winsNeeded]);

  // ============ MUSIC ============

  const toggleMusic = useCallback(() => {
    setMusicOn((prev) => {
      const next = !prev;
      if (next) musicRef.current?.start();
      else musicRef.current?.stop();
      return next;
    });
  }, []);

  // ============ RENDER WRAPPER ============

  if (gameOver) {
    return (
      <div style={{ position: 'relative', width: '100%', maxWidth: GAME_CONFIG.arena.width }}>
        <canvas ref={canvasRef} style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, height: 'auto', aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`, border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '8px',
          color: '#fff',
          fontFamily: 'monospace',
          padding: 16,
        }}>
          <h2 style={{ fontSize: '48px', margin: 0, color: winner === 'player' ? '#22c55e' : '#ef4444' }}>
            {winner === 'player' ? 'MENANG!' : 'KALAH!'}
          </h2>
          <p style={{ fontSize: '18px', margin: '12px 0' }}>
            {winner === 'player' ? 'Kamu mengalahkan BOT!' : 'BOT menang... coba lagi!'}
          </p>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>
            Skor: {playerWins} - {botWins}
          </p>
          <div style={{ marginTop: 24 }}>
            {onBackToLobby && (
              <button
                onClick={onBackToLobby}
                style={{
                  padding: '14px 32px',
                  fontSize: '16px',
                  fontFamily: 'monospace',
                  background: '#374151',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  minWidth: 220,
                }}
              >
                KEMBALI KE LOBBY
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%' }}>
      <div style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={toggleMusic}
          title={musicOn ? 'Matikan musik' : 'Nyalakan musik'}
          style={{ fontFamily: 'monospace', fontSize: '12px', background: 'transparent', color: '#a1a1aa', border: '1px solid #3f3f46', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
        >
          {musicOn ? '🔊 Musik' : '🔇 Musik'}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, height: 'auto', aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`, border: '2px solid #333', borderRadius: '8px', display: 'block' }}
      />
      <div style={{
        width: '100%',
        maxWidth: GAME_CONFIG.arena.width,
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#fff'
      }}>
        <div>
          <div>HP: {playerHp} / {GAME_CONFIG.hp.max}</div>
          <div>Stamina: {playerStamina} / {GAME_CONFIG.stamina.max}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>BOT HP: {botHp} / {GAME_CONFIG.hp.max}</div>
        </div>
      </div>
      <div style={{
        width: '100%',
        maxWidth: GAME_CONFIG.arena.width,
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888',
        textAlign: 'center'
      }}>
        Kontrol: ← → Jalan | Shift Dash | Spasi/X/Z Pukul
      </div>
    </div>
  );
}
