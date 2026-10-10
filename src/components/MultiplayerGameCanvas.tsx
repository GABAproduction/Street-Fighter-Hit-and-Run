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
  getPunchHitbox,
  createHitParticles,
  updateParticles,
  Entity,
  PlayerInput,
  Particle,
} from '@/lib/gameLogic';
import { saveMatch } from '@/lib/matchStore';
import { useBattleSync } from '@/lib/realtimeSync';
import { drawArena, drawFighter, drawDashTrail } from '@/lib/gameArt';

interface MultiplayerGameCanvasProps {
  roomCode: string;
  myUserId: string;
  myName: string;
  opponentName: string;
  isPlayer1: boolean;
  winsNeeded?: number;
  onMatchEnd: (winner: 'player' | 'opponent') => void;
}

export default function MultiplayerGameCanvas({
  roomCode,
  myUserId,
  myName,
  opponentName,
  isPlayer1,
  winsNeeded = 2,
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
  // mirror state gameOver ke ref supaya gameLoop/applyRoundWin stabil (tidak memicu
  // re-run effect init yang akan me-restart musik & reset elapsed).
  const gameOverRef = useRef(false);
  const roundScoresRef = useRef<Array<{ ronde: number; pemenang: string }>>([]);
  const startTimeRef = useRef<string>(new Date().toISOString());
  const matchSavedRef = useRef(false);
  const winsRef = useRef({ my: 0, opp: 0 });
  const roundRef = useRef(1);
  const handleBackToLobbyRef = useRef<(() => void) | null>(null);
  const broadcastRoomAbortRef = useRef<(() => void) | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // gameLoop disimpan lewat useCallback; pakai ref supaya selalu memanggil render terbaru
  // (sebelumnya render stale → skor, ronde, dan dinding arena tidak pernah ter-update di canvas)
  const renderRef = useRef<(canvas: HTMLCanvasElement) => void>(() => {});

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
  // Hitung mundur saat lawan terputus; setelah 30 detik muncul tombol keluar
  const [disconnectCountdown, setDisconnectCountdown] = useState<number>(0);
  const [musicOn, setMusicOn] = useState(true);

  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);

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
    if (gameOverRef.current) return;
    if (roundScoresRef.current.length >= roundRef.current) return;

    const winnerName = isMeWinner ? myName : opponentName;
    roundScoresRef.current.push({ ronde: roundScoresRef.current.length + 1, pemenang: winnerName });
    playRoundEnd(isMeWinner);

    const nextMy = winsRef.current.my + (isMeWinner ? 1 : 0);
    const nextOpp = winsRef.current.opp + (isMeWinner ? 0 : 1);
    if (isMeWinner) setMyWins(nextMy); else setOpponentWins(nextOpp);
    winsRef.current = { my: nextMy, opp: nextOpp };

    const matchFinished = nextMy >= winsNeeded || nextOpp >= winsNeeded;
    if (matchFinished) {
      const meWon = nextMy >= winsNeeded;
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
      // JANGAN reset elapsedMsRef.current di sini — biarkan arena terus menyempit selama match
      particlesRef.current = [];
      dashTrailRef.current = [];
      matchOverRef.current = false;
      awaitingConfirmRef.current = false;
      myPlayerRef.current.hp = GAME_CONFIG.hp.max;
      opponentRef.current.hp = GAME_CONFIG.hp.max;
    }
  }, [myName, opponentName, playRoundEnd, onMatchEnd, doSaveMatch, isPlayer1, winsNeeded]);

  // ---------- back to lobby ----------
  const handleBackToLobby = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    window.location.href = '/';
  }, []);

  handleBackToLobbyRef.current = handleBackToLobby;

  // ---------- lawan terputus: hitung mundur lalu tawarkan keluar ----------
  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearInterval(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const handleOpponentPresenceChange = useCallback((present: boolean) => {
    setOpponentConnected(present);
    if (present) {
      setConnectionWarning('');
      setDisconnectCountdown(0);
      clearDisconnectTimer();
      return;
    }
    // mulai hitung mundur 30 detik
    if (disconnectTimerRef.current) return;
    setConnectionWarning('Lawan terputus — menunggu reconnect...');
    let remaining = 30;
    setDisconnectCountdown(remaining);
    disconnectTimerRef.current = setInterval(() => {
      remaining -= 1;
      setDisconnectCountdown(remaining);
      if (remaining <= 0) {
        clearDisconnectTimer();
        setConnectionWarning('Lawan terputus lebih dari 30 detik. Keluar sekarang agar tidak terjebak.');
      }
    }, 1000);
  }, [clearDisconnectTimer]);

  // ---------- keluar permainan (tombol KELUAR) ----------
  const handleAbort = useCallback(async () => {
    try { await broadcastRoomAbortRef.current?.(); } catch {}
    handleBackToLobbyRef.current?.();
  }, []);

  const toggleMusic = useCallback(() => {
    setMusicOn((prev) => {
      const next = !prev;
      if (next) musicRef.current?.start();
      else musicRef.current?.stop();
      return next;
    });
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
    broadcastHit,
    broadcastRoundEnd,
    broadcastMatchEnd,
    broadcastRoomAbort,
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
    onRoomAbort: () => handleBackToLobbyRef.current?.(),
  });

  // keep refs after hook (for callbacks that need them before hook)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  (broadcastMatchEndRef as any).current = broadcastMatchEnd;
  broadcastRoomAbortRef.current = broadcastRoomAbort;

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
    if (matchOverRef.current && gameOverRef.current) return;
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaMs = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

    if (hitPauseRef.current > 0) {
      hitPauseRef.current--;
      renderRef.current(canvasRef.current!);
      animationRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    if (awaitingConfirmRef.current) {
      renderRef.current(canvasRef.current!);
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

    renderRef.current(canvasRef.current!);
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [
    broadcastPosition, broadcastHit, broadcastRoundEnd,
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
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
    });

    drawFighter(ctx, opponent, false, elapsedMsRef.current);
    drawFighter(ctx, myPlayer, true, elapsedMsRef.current);

    if (myPlayer.isPunching && myPlayer.punchTimer > 0) {
      const hitbox = getPunchHitbox(myPlayer);
      const extP = 1 - Math.max(0, myPlayer.punchTimer) / GAME_CONFIG.character.punchDurationFrames;
      const cx = hitbox.x + hitbox.width / 2;
      const cy = hitbox.y + hitbox.height / 2;
      // lengkung gerakan tinju (mulai dari depan tangan)
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
    ctx.fillText(`RONDE ${round} / ${winsNeeded * 2 - 1}`, arena.width / 2, 55);
    ctx.fillText(`${myName}: ${myWins}  -  ${opponentName}: ${opponentWins}`, arena.width / 2, 75); ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '12px monospace';
    ctx.fillText('← → Jalan | Shift Dash | Spasi/X/Z Pukul', 20, arena.height - 20);
    ctx.restore();
  }, [walls, round, myWins, opponentWins, myName, opponentName, winsNeeded]);

  renderRef.current = render;


  // ---------- init ----------
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
    lastTimeRef.current = 0; elapsedMsRef.current = 0; hitPauseRef.current = 0;
    particlesRef.current = []; dashTrailRef.current = []; screenShakeRef.current = { x: 0, y: 0, timer: 0 };
    animationRef.current = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (musicRef.current) { musicRef.current.stop(); musicRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
      clearDisconnectTimer();
    };
  }, [handleKeyDown, handleKeyUp, gameLoop, clearDisconnectTimer]);

  if (gameOver) {
    return (
      <div style={{ position: 'relative', width: '100%', maxWidth: GAME_CONFIG.arena.width }}>
        <canvas ref={canvasRef} style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, height: 'auto', aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`, border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
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
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={handleBackToLobby} style={{ padding: '14px 28px', fontSize: '16px', fontFamily: 'monospace', background: '#374151', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>KEMBALI KE LOBBY</button>
            {!opponentConnected && disconnectCountdown <= 0 && (
              <button onClick={handleAbort} style={{ padding: '14px 28px', fontSize: '16px', fontFamily: 'monospace', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>KELUAR</button>
            )}
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
      <div style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '12px', color: opponentConnected ? '#22c55e' : '#f87171' }}>
        <span>● {opponentConnected ? 'Terhubung' : `Terputus${disconnectCountdown > 0 ? ` — ${disconnectCountdown}s` : ''}`}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          Room {roomCode} — {isPlayer1 ? 'P1' : 'P2'}
          <button
            onClick={toggleMusic}
            title={musicOn ? 'Matikan musik' : 'Nyalakan musik'}
            style={{ fontFamily: 'monospace', fontSize: '12px', background: 'transparent', color: '#a1a1aa', border: '1px solid #3f3f46', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}
          >
            {musicOn ? '🔊' : '🔇'}
          </button>
        </span>
      </div>
      {connectionWarning && <div style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, background: '#7f1d1d', color: '#fecaca', fontFamily: 'monospace', fontSize: '12px', padding: '6px 10px', borderRadius: 6, textAlign: 'center' }}>{connectionWarning}{!opponentConnected && disconnectCountdown <= 0 && (
        <button onClick={handleAbort} style={{ display: 'block', margin: '8px auto 0', padding: '8px 20px', fontFamily: 'monospace', fontSize: '13px', fontWeight: 700, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>KELUAR</button>
      )}</div>}
      <canvas ref={canvasRef} style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, height: 'auto', aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`, border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
      <div style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '14px', color: '#fff' }}>
        <div><div>HP: {myHp} / {GAME_CONFIG.hp.max}</div><div>Stamina: {myStamina} / {GAME_CONFIG.stamina.max}</div></div>
        <div style={{ textAlign: 'right' }}><div>{opponentName} HP: {opponentHp} / {GAME_CONFIG.hp.max}</div></div>
      </div>
      <div style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, fontFamily: 'monospace', fontSize: '12px', color: '#888', textAlign: 'center' }}>Kontrol: ← → Jalan | Shift Dash | Spasi/X/Z Pukul</div>
    </div>
  );
}
