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
import { drawArena, drawFighter, drawDashTrail } from '@/lib/gameArt';

interface GameCanvasProps {
  onRoundEnd?: (winner: 'player' | 'target') => void;
}

export default function GameCanvas({ onRoundEnd }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const elapsedMsRef = useRef<number>(0);
  
  // Audio context untuk sound effects
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<ReturnType<typeof createMusic> | null>(null);
  
  // Game state (pakai ref agar tidak trigger re-render React)
  const playerRef = useRef<Entity>(createPlayer(200, 1));
  const targetRef = useRef<Entity>(createTarget(760));
  const inputRef = useRef<PlayerInput>({ left: false, right: false, dash: false, punch: false });
  const keysPressedRef = useRef<Set<string>>(new Set());
  
  // Visual effects state
  const particlesRef = useRef<Particle[]>([]);
  const screenShakeRef = useRef({ x: 0, y: 0, timer: 0 });
  const hitPauseRef = useRef(0);
  const dashTrailRef = useRef<Array<{ x: number; y: number; alpha: number }>>([]);
  const lastHitWasMomentum = useRef(false);
  const matchOverRef = useRef(false); // guard biar game loop berhenti pas match selesai
  // mirror gameOver ke ref supaya gameLoop stabil (effect init tidak re-run tiap ronde
  // yang tadinya me-restart musik & animation loop).
  const gameOverRef = useRef(false);
  const renderRef = useRef<(canvas: HTMLCanvasElement) => void>(() => {});
  
  // State untuk UI yang butuh re-render (HP, stamina)
  const [playerHp, setPlayerHp] = useState<number>(GAME_CONFIG.hp.max);
  const [targetHp, setTargetHp] = useState<number>(GAME_CONFIG.target.maxHp);
  const [playerStamina, setPlayerStamina] = useState<number>(GAME_CONFIG.stamina.max);
  const [walls, setWalls] = useState<{ left: number; right: number }>({ left: GAME_CONFIG.arena.leftWall, right: GAME_CONFIG.arena.rightWall });
  const [round, setRound] = useState<number>(1);
  const [playerWins, setPlayerWins] = useState<number>(0);
  const [targetWins, setTargetWins] = useState<number>(0);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<'player' | 'target' | null>(null);
  const [musicOn, setMusicOn] = useState(true);

  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);
  
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
      // Audio gagal (user belum interact), abaikan
    }
  }, [getAudioContext]);
  
  const playFootstep = useCallback(() => {
    playTone(120, 0.05, 'sine', 0.03);
  }, [playTone]);
  
  const playDash = useCallback(() => {
    // Dash sound: sweep up
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
    // Hit sound: noise burst + tone
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    
    // Noise burst
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
    
    // Tone
    playTone(isMomentum ? 400 : 250, 0.12, 'triangle', 0.06, isMomentum ? 1.3 : 1);
  }, [getAudioContext, playTone]);
  
  const playRoundEnd = useCallback((isWin: boolean) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    
    const notes = isWin ? [523, 659, 784, 1047] : [220, 185, 165, 147]; // Major vs minor
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
  
  // ============ INPUT HANDLERS ============
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keysPressedRef.current.add(e.code);
    
    // Prevent default untuk arrow keys dan space
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
        if (!inputRef.current.dash) { // trigger dash sound sekali
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
    // Stop loop kalau match sudah selesai
    if (matchOverRef.current && gameOverRef.current) {
      return;
    }
    
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaMs = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;
    
    // Hit pause: skip frame tapi tetap render
    if (hitPauseRef.current > 0) {
      hitPauseRef.current--;
      renderRef.current(canvasRef.current!);
      animationRef.current = requestAnimationFrame(gameLoop);
      return;
    }
    
    elapsedMsRef.current += deltaMs;
    
    const player = playerRef.current;
    const target = targetRef.current;
    const input = inputRef.current;
    
    // Update game logic
    const result = updateGame(player, target, input, elapsedMsRef.current);
    
    // Handle hit result - visual/audio feedback
    if (result.hitResult.hit) {
      // Hit pause (freeze frame)
      hitPauseRef.current = GAME_CONFIG.juice.hitPauseFrames;
      
      // Screen shake
      screenShakeRef.current.timer = GAME_CONFIG.juice.screenShakeDurationFrames;
      
      // Partikel
      const particleColor = result.hitResult.isMomentum ? '#fbbf24' : '#ef4444'; // amber vs red
      particlesRef.current.push(...createHitParticles(
        result.hitResult.hitX,
        result.hitResult.hitY,
        particleColor
      ));
      
      // Sound
      playPunch(result.hitResult.isMomentum);
      playHit(result.hitResult.isMomentum);
      
      lastHitWasMomentum.current = result.hitResult.isMomentum;
    }
    
    // Footstep sound
    if (player.isMoving && !player.isDashing && player.footstepTimer) {
      if (player.footstepTimer % GAME_CONFIG.juice.footstepIntervalFrames === 0) {
        playFootstep();
      }
    }
    
    // Dash trail
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
    
    // Fade dash trail
    dashTrailRef.current = dashTrailRef.current
      .map(t => ({ ...t, alpha: t.alpha - 1 / GAME_CONFIG.juice.dashTrailFadeFrames }))
      .filter(t => t.alpha > 0);
    
    // Update particles
    particlesRef.current = updateParticles(particlesRef.current);
    
    // Update screen shake
    if (screenShakeRef.current.timer > 0) {
      const intensity = GAME_CONFIG.juice.screenShakeIntensity;
      screenShakeRef.current.x = (Math.random() - 0.5) * intensity * 2;
      screenShakeRef.current.y = (Math.random() - 0.5) * intensity * 2;
      screenShakeRef.current.timer--;
    } else {
      screenShakeRef.current.x = 0;
      screenShakeRef.current.y = 0;
    }
    
    // Update walls state untuk UI
    setWalls({ left: result.leftWall, right: result.right });
    
    // Update HP/stamina state untuk UI
    setPlayerHp(player.hp);
    setTargetHp(target.hp);
    setPlayerStamina(Math.round(player.stamina));
    
    // Cek ronde selesai (hanya kalau match belum selesai)
    if (!matchOverRef.current) {
      const roundWinner = checkRoundEnd(player, target);
      if (roundWinner) {
        // Prevent double-trigger: set flag & reset HP biar checkRoundEnd tidak trigger lagi
        matchOverRef.current = true;
        player.hp = 1; // reset sementara
        target.hp = 1;
        
        const isPlayerWin = roundWinner === 'player';
        
        // Use functional updates to get latest values
        setPlayerWins(currentPlayerWins => {
          const newPlayerWins = isPlayerWin ? currentPlayerWins + 1 : currentPlayerWins;
          setTargetWins(currentTargetWins => {
            const newTargetWins = !isPlayerWin ? currentTargetWins + 1 : currentTargetWins;
            
            if (newPlayerWins >= 2 || newTargetWins >= 2) {
              // Match selesai
              setGameOver(true);
              setWinner(roundWinner);
              playRoundEnd(isPlayerWin);
              onRoundEnd?.(roundWinner);
              // Stop game loop
              if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
              }
            } else {
              // Ronde berikutnya
              setRound(r => r + 1);
              resetRound(player, target, 200, 760);
              elapsedMsRef.current = 0;
              particlesRef.current = [];
              dashTrailRef.current = [];
              matchOverRef.current = false; // reset flag untuk ronde berikutnya
            }
            return currentTargetWins;
          });
          return newPlayerWins;
        });
      }
    }
    
    // Render (lewat ref supaya selalu pakai state terbaru, lihat renderRef di atas)
    renderRef.current(canvasRef.current!);
    
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [onRoundEnd, playFootstep, playPunch, playHit, playRoundEnd]);
  
  // ============ RENDER ============
  
  const render = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const { arena } = GAME_CONFIG;
    const player = playerRef.current;
    const target = targetRef.current;
    const cfg = GAME_CONFIG.character;
    
    // Apply screen shake
    ctx.save();
    ctx.translate(screenShakeRef.current.x, screenShakeRef.current.y);
    
    // Clear canvas
    ctx.clearRect(0, 0, arena.width, arena.height);
    
    // Arena: langit, skyline, penonton, lantai, dinding merah menyempit
    drawArena(ctx, arena, walls, elapsedMsRef.current);
    
    // Draw dash trail (behind characters)
    drawDashTrail(ctx, dashTrailRef.current, cfg.width, cfg.height);
    
    // Draw particles
    particlesRef.current.forEach(p => {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', '');
      // Handle hex color
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
    
    // Draw fighters (figur prosedural beranimasi)
    drawFighter(ctx, target, false, elapsedMsRef.current);
    drawFighter(ctx, player, true, elapsedMsRef.current);
    
    // Efek pukulan (arc gerakan + kilau tinju)
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
    
    // Momentum indicator
    if (player.momentumTimer > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ MOMENTUM!', player.x, player.y - cfg.height - 20);
      ctx.textAlign = 'left';
    }
    
    // Close range penalty indicator
    if (player.closeRangeFrames > 30) {
      ctx.fillStyle = '#f87171';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ TERLALU DEKAT!', player.x, player.y - cfg.height - 40);
      ctx.textAlign = 'left';
    }
    
    // Timer arena shrink
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
    ctx.fillText(`RONDE ${round} / 3`, arena.width / 2, 55);
    ctx.fillText(`Pemain: ${playerWins}  -  Target: ${targetWins}`, arena.width / 2, 75);
    ctx.textAlign = 'left';
    
    // Controls hint
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px monospace';
    ctx.fillText('← → Gerak  |  Shift Dash  |  Spasi/X/Z Pukul', 20, arena.height - 20);
    
    ctx.restore(); // restore screen shake transform
  }, [walls, round, playerWins, targetWins]);

  renderRef.current = render;
  
  
  // ============ INIT & CLEANUP ============
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Set canvas size
    canvas.width = GAME_CONFIG.arena.width;
    canvas.height = GAME_CONFIG.arena.height;
    
    // Music
    musicRef.current = createMusic();
    musicRef.current.setVolume(0.4);
    musicRef.current.start();

    // Event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Start game loop
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
      // Stop music
      musicRef.current?.stop();
      // Close audio context on unmount
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [handleKeyDown, handleKeyUp, gameLoop]);
  
  // ============ RESTART ============
  
  const handleRestart = useCallback(() => {
    const player = playerRef.current;
    const target = targetRef.current;
    resetRound(player, target, 200, 760);
    setRound(1);
    setPlayerWins(0);
    setTargetWins(0);
    setGameOver(false);
    setWinner(null);
    elapsedMsRef.current = 0;
    lastTimeRef.current = 0;
    hitPauseRef.current = 0;
    particlesRef.current = [];
    dashTrailRef.current = [];
    screenShakeRef.current = { x: 0, y: 0, timer: 0 };
    matchOverRef.current = false; // reset flag
    // Restart game loop
    animationRef.current = requestAnimationFrame(gameLoop);
  }, [gameLoop]);

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
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', maxWidth: GAME_CONFIG.arena.width, height: 'auto', aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`, border: '2px solid #333', borderRadius: '8px', display: 'block' }} />
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '8px',
          color: '#fff',
          fontFamily: 'monospace',
        }}>
          <h2 style={{ fontSize: '48px', margin: 0, color: winner === 'player' ? '#22c55e' : '#ef4444' }}>
            {winner === 'player' ? 'MENANG!' : 'KALAH!'}
          </h2>
          <p style={{ fontSize: '24px', margin: '16px 0' }}>
            {winner === 'player' ? 'Kamu mengalahkan target latihan!' : 'Target latihan menang...'}
          </p>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>
            Skor: {playerWins} - {targetWins}
          </p>
          <button
            onClick={handleRestart}
            style={{
              padding: '16px 48px',
              fontSize: '20px',
              fontFamily: 'monospace',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#2563eb'}
            onMouseOut={(e) => e.currentTarget.style.background = '#3b82f6'}
          >
            MAIN LAGI
          </button>
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
          <div>Target HP: {targetHp} / {GAME_CONFIG.target.maxHp}</div>
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