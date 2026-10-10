'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createMusic } from '@/lib/gameMusic';
import { GAME_CONFIG } from '@/lib/gameConfig';
import {
  createPlayer,
  createTarget,
  updateGame,
  resetRound,
  checkRoundEnd,
  getHurtbox,
  getPunchHitbox,
  createHitParticles,
  updateParticles,
  Entity,
  PlayerInput,
  Particle,
} from '@/lib/gameLogic';
import { saveMatch } from '@/lib/matchStore';
import { useBattleSync } from '@/lib/realtimeSync';

interface MultiplayerGameCanvasProps {
  roomCode: string;
  myUserId: string;
  myName: string;
  opponentName: string;
  isPlayer1: boolean;
  onMatchEnd: (winner: 'player' | 'opponent') => void;
}

export default function MultiplayerGameCanvas({
  roomCode,
  myUserId,
  myName,
  opponentName,
  isPlayer1,
  onMatchEnd,
}: MultiplayerGameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const elapsedMsRef = useRef<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<ReturnType<typeof createMusic> | null>(null);

  const myPlayerRef = useRef<Entity>(createPlayer(isPlayer1 ? 200 : 760, isPlayer1 ? 1 : -1));
  const opponentRef = useRef<Entity>(createTarget(isPlayer1 ? 760 : 200));

  myPlayerRef.current.name = myName;
  opponentRef.current.name = opponentName;

  const inputRef = useRef<PlayerInput>({ left: false, right: false, dash: false, punch: false });
  const keysPressedRef = useRef<Set<string>>(new Set());

  const particlesRef = useRef<Particle[]>([]);
  const screenShakeRef = useRef({ x: 0, y: 0, timer: 0 });
  const hitPauseRef = useRef(0);
  const dashTrailRef = useRef<Array<{ x: number; y: number; alpha: number }>>([]);
  const matchOverRef = useRef(false);
  const awaitingConfirmRef = useRef(false);
  const roundScoresRef = useRef<Array<{ ronde: number; pemenang: string }>>([]);
  const startTimeRef = useRef<string>(new Date().toISOString());
  const matchSavedRef = useRef(false);
  const winsRef = useRef({ my: 0, opp: 0 });
  const roundRef = useRef(1);

  const [myHp, setMyHp] = useState<number>(GAME_CONFIG.hp.max);
  const [opponentHp, setOpponentHp] = useState<number>(GAME_CONFIG.hp.max);
  const [myStamina, setMyStamina] = useState<number>(GAME_CONFIG.stamina.max);
  const [walls, setWalls] = useState<{ left: number; right: number }>({ left: GAME_CONFIG.arena.leftWall, right: GAME_CONFIG.arena.rightWall });
  const [round, setRound] = useState<number>(1);
  const [myWins, setMyWins] = useState<number>(0);
  const [opponentWins, setOpponentWins] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<'player' | 'opponent' | null>(null);
  const [matchSaved, setMatchSaved] = useState(false);
  const [myWantsRematch, setMyWantsRematch] = useState(false);
  const [opponentWantsRematch, setOpponentWantsRematch] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);
  const [connectionWarning, setConnectionWarning] = useState('');

  useEffect(() => { winsRef.current = { my: myWins, opp: opponentWins }; }, [myWins, opponentWins]);
  useEffect(() => { roundRef.current = round; }, [round]);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((freq: number, duration: number, type: OscillatorType = 'square', volume: number = 0.1, pitch: number = 1) => {
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
    } catch {}
  }, [getAudioContext]);

  const playFootstep = useCallback(() => playTone(120, 0.05, 'sine', 0.03), [playTone]);
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
  const playPunch = useCallback((isMomentum: boolean) => playTone(isMomentum ? 300 : 180, 0.08, 'square', 0.08, isMomentum ? 1.5 : 1), [playTone]);
  const playHit = useCallback((isMomentum: boolean) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
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

  // ---------- helpers: round/match transition (single source of truth) ----------
  const doSaveMatch = useCallback(async (finalMyWins: number, finalOppWins: number, winnerName: string) => {
    if (matchSavedRef.current) return;
    if (!isPlayer1) return;
    matchSavedRef.current = true;
    const kodeRoom = roomCode.toUpperCase();
    const nama1 = isPlayer1 ? myName : opponentName;
    const nama2 = isPlayer1 ? opponentName : myName;
    const skorRunde = roundScoresRef.current;
    const res = await saveMatch({
      kodeRoom,
      namaPemain1: nama1,
      namaPemain2: nama2,
      pemenang: winnerName,
      skorRunde,
      waktuMulai: startTimeRef.current,
      waktuSelesai: new Date().toISOString(),
    });
    if (res) setMatchSaved(true);
    else matchSavedRef.current = false;
  }, [roomCode, isPlayer1, myName, opponentName]);

  const applyRoundWin = useCallback((isMeWinner: boolean) => {
    if (gameOver) return;
    if (roundScoresRef.current.length >= roundRef.current) return;

    const winnerName = isMeWinner ? myName : opponentName;
    roundScoresRef.current.push({ ronde: roundScoresRef.current.length + 1, pemenang: winnerName });
    playRoundEnd(isMeWinner);

    const nextMy = winsRef.current.my + (isMeWinner ? 1 : 0);
    const nextOpp = winsRef.current.opp + (isMeWinner ? 0 : 1);
    if (isMeWinner) setMyWins(nextMy); else setOpponentWins(nextOpp);
    winsRef.current = { my: nextMy, opp: nextOpp };

    const matchFinished = nextMy >= 2 || nextOpp >= 2;
    if (matchFinished) {
      const meWon = nextMy >= 2;
      const finalWinner: 'player' | 'opponent' = meWon ? 'player' : 'opponent';
      setGameOver(true);
      setWinner(finalWinner);
      onMatchEnd(finalWinner);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      doSaveMatch(nextMy, nextOpp, meWon ? myName : opponentName);
      broadcastMatchEndRef.current?.(meWon ? 'player' : 'target');
    } else {
      setRound(r => r + 1);
      roundRef.current += 1;
      resetRound(myPlayerRef.current, opponentRef.current, isPlayer1 ? 200 : 760, isPlayer1 ? 760 : 200);
      elapsedMsRef.current = 0;
      particlesRef.current = [];
      dashTrailRef.current = [];
      matchOverRef.current = false;
      awaitingConfirmRef.current = false;
      myPlayerRef.current.hp = GAME_CONFIG.hp.max;
      opponentRef.current.hp = GAME_CONFIG.hp.max;
    }
  }, [gameOver, myName, opponentName, playRoundEnd, onMatchEnd, doSaveMatch, isPlayer1]);

  // ---------- back to lobby ----------
  const handleBackToLobby = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    window.location.href = '/';
  }, []);

  const handleOpponentPresenceChange = useCallback((present: boolean) => {
    setOpponentConnected(present);
    setConnectionWarning(present ? '' : 'Lawan terputus — menunggu reconnect...');
  }, []);

  const handleOpponentHit = useCallback((damage: number, hitX: number, hitY: number, isMomentum: boolean) => {
    const myPlayer = myPlayerRef.current;
    myPlayer.hp = Math.max(0, myPlayer.hp - damage);
    myPlayer.hitFlashTimer = GAME_CONFIG.juice.hitPauseFrames;
    myPlayer.screenShakeTimer = GAME_CONFIG.juice.screenShakeDurationFrames;
    particlesRef.current.push(...createHitParticles(hitX, hitY, isMomentum ? '#fbbf24' : '#ef4444'));
    playPunch(isMomentum);
    playHit(isMomentum);
    hitPauseRef.current = GAME_CONFIG.juice.hitPauseFrames;
    screenShakeRef.current.timer = GAME_CONFIG.juice.screenShakeDurationFrames;
  }, [playPunch, playHit]);

  const handleMatchEnd = useCallback((matchWinner: 'player' | 'target') => {
    const isMeWinner = matchWinner === 'target';
    setGameOver(true);
    setWinner(isMeWinner ? 'player' : 'opponent');
    onMatchEnd(isMeWinner ? 'player' : 'opponent');
    playRoundEnd(isMeWinner);
    const meWon = isMeWinner;
    const finalMy = winsRef.current.my + (meWon ? 1 : 0);
    const finalOpp = winsRef.current.opp + (meWon ? 0 : 1);
    if (!matchSavedRef.current && isPlayer1) {
      roundScoresRef.current.push({ ronde: roundScoresRef.current.length + 1, pemenang: meWon ? myName : opponentName });
      doSaveMatch(finalMy, finalOpp, meWon ? myName : opponentName);
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
  }, [onMatchEnd, playRoundEnd, isPlayer1, myName, opponentName, doSaveMatch]);

  const broadcastMatchEndRef = useRef<((winner: 'player' | 'target') => void) | null>(null);

  // remote round_end: sender's 'player' means sender won → for us it's a loss (invert)
  const handleRoundEnd = useCallback((roundWinner: 'player' | 'target') => {
    if (matchOverRef.current && !awaitingConfirmRef.current) return;
    const isMeWinner = roundWinner === 'target';
    matchOverRef.current = true;
    awaitingConfirmRef.current = false;
    myPlayerRef.current.hp = 1;
    opponentRef.current.hp = 1;
    setTimeout(() => applyRoundWin(isMeWinner), 30);
  }, [applyRoundWin]);

  // ---------- battle sync hook ----------
  const {
    broadcastPosition,
    broadcastAction,
    broadcastHit,
    broadcastRoundEnd,
    broadcastMatchEnd,
    broadcastRematchVote,
    interpolateOpponent,
  } = useBattleSync({
    roomCode,
    myUserId,
    myPlayer: myPlayerRef.current,
    opponentPlayer: opponentRef.current,
    onOpponentHit: handleOpponentHit,
    onRoundEnd: handleRoundEnd,
    onMatchEnd: handleMatchEnd,
    onOpponentPresenceChange: handleOpponentPresenceChange,
  });

  // keep refs after hook (for callbacks that need them before hook)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  (broadcastMatchEndRef as any).current = broadcastMatchEnd;

  // ---------- input ----------
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysPressedRef.current.add(e.code);
    if (['ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyZ'].includes(e.code)) e.preventDefault();
    switch (e.code) {
      case 'ArrowLeft': inputRef.current.left = true; break;
      case 'ArrowRight': inputRef.current.right = true; break;
      case 'ShiftLeft': case 'ShiftRight':
        if (!inputRef.current.dash) playDash();
        inputRef.current.dash = true; break;
      case 'Space': case 'KeyX': case 'KeyZ': inputRef.current.punch = true; break;
    }
  }, [playDash]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysPressedRef.current.delete(e.code);
    switch (e.code) {
      case 'ArrowLeft': inputRef.current.left = false; break;
      case 'ArrowRight': inputRef.current.right = false; break;
      case 'ShiftLeft': case 'ShiftRight': inputRef.current.dash = false; break;
      case 'Space': case 'KeyX': case 'KeyZ': inputRef.current.punch = false; break;
    }
  }, []);

  // ---------- game loop ----------
  const gameLoop = useCallback((timestamp: number) => {
    if (matchOverRef.current && gameOver) return;
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaMs = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

    if (hitPauseRef.current > 0) {
      hitPauseRef.current--;
      render(canvasRef.current!);
      animationRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    if (awaitingConfirmRef.current) {
      render(canvasRef.current!);
      animationRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    elapsedMsRef.current += deltaMs;

    const myPlayer = myPlayerRef.current;
    const opponent = opponentRef.current;
    const input = inputRef.current;

    const result = updateGame(myPlayer, opponent, input, elapsedMsRef.current);

    if (result.hitResult.hit) {
      hitPauseRef.current = GAME_CONFIG.juice.hitPauseFrames;
      screenShakeRef.current.timer = GAME_CONFIG.juice.screenShakeDurationFrames;
      const particleColor = result.hitResult.isMomentum ? '#fbbf24' : '#ef4444';
      particlesRef.current.push(...createHitParticles(result.hitResult.hitX, result.hitResult.hitY, particleColor));
      playPunch(result.hitResult.isMomentum);
      playHit(result.hitResult.isMomentum);
      broadcastHit(result.hitResult.damage, result.hitResult.hitX, result.hitResult.hitY, result.hitResult.isMomentum);
    }

    if (myPlayer.isMoving && !myPlayer.isDashing && myPlayer.footstepTimer) {
      if (myPlayer.footstepTimer % GAME_CONFIG.juice.footstepIntervalFrames === 0) playFootstep();
    }

    if (myPlayer.isDashing) {
      dashTrailRef.current.push({ x: myPlayer.x, y: myPlayer.y - GAME_CONFIG.character.height / 2, alpha: 1 });
      if (dashTrailRef.current.length > GAME_CONFIG.juice.dashTrailCount) dashTrailRef.current.shift();
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
    } else { screenShakeRef.current.x = 0; screenShakeRef.current.y = 0; }

    interpolateOpponent(0.3);
    broadcastPosition();
    broadcastAction({
      isPunching: myPlayer.isPunching,
      punchTimer: myPlayer.punchTimer,
      momentumTimer: myPlayer.momentumTimer,
    });

    setWalls({ left: result.leftWall, right: result.right });
    setMyHp(myPlayer.hp);
    setOpponentHp(opponent.hp);
    setMyStamina(Math.round(myPlayer.stamina));

    if (!matchOverRef.current && !awaitingConfirmRef.current) {
      const roundWinner = checkRoundEnd(myPlayer, opponent);
      if (roundWinner) {
        const isMeWinner = roundWinner === 'player';
        if (!isMeWinner) {
          matchOverRef.current = true;
          myPlayer.hp = 1; opponent.hp = 1;
          broadcastRoundEnd('target');
          setTimeout(() => applyRoundWin(false), 30);
        } else {
          awaitingConfirmRef.current = true;
          myPlayer.hp = 1; opponent.hp = 1;
          matchOverRef.current = true;
          setTimeout(() => {
            if (awaitingConfirmRef.current) {
              awaitingConfirmRef.current = false;
              applyRoundWin(true);
            }
          }, 1200);
        }
      }
    }

    render(canvasRef.current!);
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [
    gameOver,
    broadcastPosition, broadcastAction, broadcastHit, broadcastRoundEnd,
    interpolateOpponent, playFootstep, playPunch, playHit, applyRoundWin,
  ]);

  // ---------- render ----------
  const render = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { arena } = GAME_CONFIG;
    const myPlayer = myPlayerRef.current;
    const opponent = opponentRef.current;
    const cfg = GAME_CONFIG.character;
    const juice = GAME_CONFIG.juice;

    ctx.save();
    ctx.translate(screenShakeRef.current.x, screenShakeRef.current.y);
    ctx.clearRect(0, 0, arena.width, arena.height);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, arena.width, arena.height);
    ctx.fillStyle = '#16213e';
    ctx.fillRect(0, arena.floorY, arena.width, arena.height - arena.floorY);
    ctx.strokeStyle = '#0f3460'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, arena.floorY); ctx.lineTo(arena.width, arena.floorY); ctx.stroke();

    ctx.fillStyle = '#e94560';
    ctx.fillRect(0, 0, walls.left, arena.height);
    ctx.fillRect(walls.right, 0, arena.width - walls.right, arena.height);
    ctx.strokeStyle = '#fff'; ctx.setLineDash([10, 10]); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(walls.left, 0); ctx.lineTo(walls.left, arena.height);
    ctx.moveTo(walls.right, 0); ctx.lineTo(walls.right, arena.height); ctx.stroke(); ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.setLineDash([20, 20]);
    ctx.beginPath(); ctx.moveTo(arena.width / 2, arena.floorY); ctx.lineTo(arena.width / 2, arena.height); ctx.stroke(); ctx.setLineDash([]);

    dashTrailRef.current.forEach(t => {
      ctx.fillStyle = `rgba(59, 130, 246, ${t.alpha * 0.3})`;
      ctx.fillRect(t.x - cfg.width / 2, t.y, cfg.width, cfg.height);
    });

    particlesRef.current.forEach(p => {
      const alpha = p.life / p.maxLife;
      if (p.color.startsWith('#')) {
        const hex = p.color.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
    });

    drawCharacter(ctx, opponent, cfg, false);
    drawCharacter(ctx, myPlayer, cfg, true);

    if (myPlayer.isPunching && myPlayer.punchTimer > 0) {
      const hitbox = getPunchHitbox(myPlayer);
      const flashAlpha = myPlayer.hitFlashTimer ? 0.8 : 0.5;
      ctx.fillStyle = `rgba(255, 255, 0, ${flashAlpha})`;
      ctx.fillRect(hitbox.x, hitbox.y, hitbox.width, hitbox.height);
      ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2; ctx.strokeRect(hitbox.x, hitbox.y, hitbox.width, hitbox.height);
      ctx.strokeStyle = 'rgba(255,255,0,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(myPlayer.x + myPlayer.facing * 24, myPlayer.y - cfg.height + 30);
      ctx.lineTo(hitbox.x + hitbox.width / 2, hitbox.y + hitbox.height / 2); ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)'; ctx.lineWidth = 1;
    const myHurt = getHurtbox(myPlayer); ctx.strokeRect(myHurt.x, myHurt.y, myHurt.width, myHurt.height);
    const oppHurt = getHurtbox(opponent); ctx.strokeRect(oppHurt.x, oppHurt.y, oppHurt.width, oppHurt.height);

    if (myPlayer.momentumTimer > 0) {
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
      ctx.fillText('⚡ MOMENTUM!', myPlayer.x, myPlayer.y - cfg.height - 20); ctx.textAlign = 'left';
    }
    if (myPlayer.closeRangeFrames > 30) {
      ctx.fillStyle = '#f87171'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
      ctx.fillText('⚠ TERLALU DEKAT!', myPlayer.x, myPlayer.y - cfg.height - 40); ctx.textAlign = 'left';
    }

    const shrinkLeft = Math.max(0, GAME_CONFIG.arena.shrinkStartTime - elapsedMsRef.current);
    if (shrinkLeft > 0) {
      ctx.fillStyle = '#fff'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`Arena menyempit: ${Math.ceil(shrinkLeft / 1000)}s`, arena.width / 2, 30); ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#f87171'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      ctx.fillText('⚠ ARENA MENYEMPIT!', arena.width / 2, 30); ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#fff'; ctx.font = '16px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`RONDE ${round} / 3`, arena.width / 2, 55);
    ctx.fillText(`${myName}: ${myWins}  -  ${opponentName}: ${opponentWins}`, arena.width / 2, 75); ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px monospace';
    ctx.fillText('← → Jalan | Shift Dash | Spasi/X/Z Pukul', 20, arena.height - 20);
    ctx.restore();
  }, [walls, round, myWins, opponentWins, myName, opponentName]);

  const drawCharacter = useCallback((
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    charCfg: typeof GAME_CONFIG.character,
    isMe: boolean
  ) => {
    const juice = GAME_CONFIG.juice;
    ctx.fillStyle = entity.hitFlashTimer && entity.hitFlashTimer > 0 ? 'rgba(255,255,255,0.6)' : entity.color;
    ctx.fillRect(entity.x - charCfg.width / 2, entity.y - charCfg.height, charCfg.width, charCfg.height);
    ctx.fillStyle = '#fff';
    const eyeOffset = entity.facing === 1 ? 12 : -12;
    ctx.fillRect(entity.x + eyeOffset, entity.y - charCfg.height + 22, 6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(entity.facing === 1 ? '▶' : '◀', entity.x, entity.y - charCfg.height / 2 + 4); ctx.textAlign = 'left';
    if (isMe && entity.isDashing) {
      ctx.strokeStyle = 'rgba(59,130,246,0.7)'; ctx.lineWidth = 3;
      for (let i = 1; i <= 4; i++) {
        const ox = -entity.facing * i * 10;
        ctx.beginPath(); ctx.moveTo(entity.x + ox, entity.y - charCfg.height / 2);
        ctx.lineTo(entity.x + ox - 15, entity.y - charCfg.height / 2); ctx.stroke();
      }
    }
    if (juice.showHealthBar) {
      const barW = juice.healthBarWidth, barH = juice.healthBarHeight;
      const barX = entity.x - barW / 2, barY = entity.y - charCfg.height - juice.healthBarOffsetY;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      const hpPct = entity.hp / entity.maxHp;
      ctx.fillStyle = hpPct > 0.6 ? '#22c55e' : hpPct > 0.3 ? '#fbbf24' : '#ef4444';
      ctx.fillRect(barX, barY, barW * hpPct, barH);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
    }
    if (juice.showName && entity.name) {
      ctx.fillStyle = '#fff'; ctx.font = `${juice.nameFontSize} monospace`; ctx.textAlign = 'center';
      const nameY = entity.y - charCfg.height - juice.nameOffsetY;
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(entity.name, entity.x + 1, nameY + 1);
      ctx.fillStyle = isMe ? '#3b82f6' : '#ef4444'; ctx.fillText(entity.name, entity.x, nameY); ctx.textAlign = 'left';
    }
    if (isMe && entity.maxStamina > 0) {
      const barW = juice.healthBarWidth, barH = 3;
      const barX = entity.x - barW / 2, barY = entity.y - charCfg.height - juice.healthBarOffsetY + juice.healthBarHeight + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(barX, barY, barW * (entity.stamina / entity.maxStamina), barH);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
    }
  }, []);

  // ---------- init ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = GAME_CONFIG.arena.width;
    canvas.height = GAME_CONFIG.arena.height;
    musicRef.current = createMusic();
    musicRef.current.setVolume(0.08);
    musicRef.current.start();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    lastTimeRef.current = 0; elapsedMsRef.current = 0; hitPauseRef.current = 0;
    particlesRef.current = []; dashTrailRef.current = []; screenShakeRef.current = { x: 0, y: 0, timer: 0 };
    animationRef.current = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (musicRef.current) { musicRef.current.stop(); musicRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    };
  }, [handleKeyDown, handleKeyUp, gameLoop]);

  if (gameOver) {
    return (
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: '#fff', fontFamily: 'monospace', padding: 16 }}>
          <h2 style={{ fontSize: '48px', margin: 0, color: winner === 'player' ? '#22c55e' : '#ef4444' }}>
            {winner === 'player' ? 'MENANG!' : 'KALAH!'}
          </h2>
          <p style={{ fontSize: '18px', margin: '12px 0' }}>
            {winner === 'player' ? `Kamu mengalahkan ${opponentName}!` : `${opponentName} menang...`}
          </p>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '12px' }}>Skor: {myWins} - {opponentWins} — Room {roomCode}</p>
          <p style={{ fontSize: '12px', color: matchSaved ? '#22c55e' : '#f59e0b', marginBottom: '16px' }}>{matchSaved ? '✓ Hasil tersimpan ke DB' : isPlayer1 ? 'Menyimpan hasil...' : 'Hasil disimpan oleh host'}</p>
          {connectionWarning && <p style={{ fontSize: '12px', color: '#f87171', marginBottom: 12 }}>{connectionWarning}</p>}
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleBackToLobby} style={{ padding: '14px 28px', fontSize: '16px', fontFamily: 'monospace', background: '#374151', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>KEMBALI KE LOBBY</button>
          </div>
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: 12 }}>
            {opponentName}: {opponentConnected ? 'terhubung' : 'terputus'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: GAME_CONFIG.arena.width, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '12px', color: opponentConnected ? '#22c55e' : '#f87171' }}>
        <span>● {opponentConnected ? 'Terhubung' : 'Terputus'}</span>
        <span>Room {roomCode} — {isPlayer1 ? 'P1' : 'P2'}</span>
      </div>
      {connectionWarning && <div style={{ width: GAME_CONFIG.arena.width, background: '#7f1d1d', color: '#fecaca', fontFamily: 'monospace', fontSize: '12px', padding: '6px 10px', borderRadius: 6, textAlign: 'center' }}>{connectionWarning}</div>}
      <canvas ref={canvasRef} style={{ border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
      <div style={{ width: GAME_CONFIG.arena.width, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '14px', color: '#fff' }}>
        <div><div>HP: {myHp} / {GAME_CONFIG.hp.max}</div><div>Stamina: {myStamina} / {GAME_CONFIG.stamina.max}</div></div>
        <div style={{ textAlign: 'right' }}><div>{opponentName} HP: {opponentHp} / {GAME_CONFIG.hp.max}</div></div>
      </div>
      <div style={{ width: GAME_CONFIG.arena.width, fontFamily: 'monospace', fontSize: '12px', color: '#888', textAlign: 'center' }}>Kontrol: ← → Jalan | Shift Dash | Spasi/X/Z Pukul</div>
    </div>
  );
}
