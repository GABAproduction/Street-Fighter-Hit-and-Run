'use client';

/**
 * Pratinjau gameplay (bukan file gambar — digambar langsung dengan Canvas yang sama
 * seperti di game). Dipakai di landing page sebagai "screenshot" hidup.
 */
import { useEffect, useRef } from 'react';
import { GAME_CONFIG } from '@/lib/gameConfig';
import { drawArena, drawFighter } from '@/lib/gameArt';
import { createPlayer, createTarget } from '@/lib/gameLogic';
import type { Entity } from '@/lib/gameLogic';

interface GamePreviewProps {
  className?: string;
  /** kalau true, gambar satu frame statis (hemat resource) */
  staticFrame?: boolean;
  label?: string;
}

export default function GamePreview({ className, staticFrame = false, label }: GamePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = GAME_CONFIG.arena.width;
    canvas.height = GAME_CONFIG.arena.height;

    const me: Entity = createPlayer(300, 1);
    const foe: Entity = createTarget(660);
    me.name = 'Kamu';
    foe.name = 'Lawan';

    const scene = (t: number) => {
      const walk = Math.sin(t / 650);
      me.isMoving = !staticFrame;
      foe.isMoving = !staticFrame;
      me.x = 300 + walk * 70;
      foe.x = 660 - walk * 45;
      foe.facing = me.x < foe.x ? -1 : 1;
      me.facing = foe.x < me.x ? -1 : 1;
      const punching = !staticFrame && (Math.floor(t / 1200) % 2 === 0) && ((t % 1200) < 300);
      me.isPunching = punching;
      me.punchTimer = punching ? 6 : 0;
      me.hitFlashTimer = 0;
      foe.hitFlashTimer = 0;

      drawArena(
        ctx,
        GAME_CONFIG.arena,
        { left: GAME_CONFIG.arena.leftWall, right: GAME_CONFIG.arena.rightWall },
        t
      );
      drawFighter(ctx, foe, false, t);
      drawFighter(ctx, me, true, t);
    };

    if (staticFrame) {
      scene(1200);
      return;
    }

    let last = performance.now();
    const loop = (now: number) => {
      timeRef.current += now - last;
      last = now;
      scene(timeRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [staticFrame]);

  return (
    <div className={className} style={{ position: 'relative', lineHeight: 0 }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: `${GAME_CONFIG.arena.width} / ${GAME_CONFIG.arena.height}`,
          display: 'block',
          borderRadius: 12,
        }}
      />
      {label && (
        <span
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            fontFamily: 'monospace',
            fontSize: 11,
            letterSpacing: 1,
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff',
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
