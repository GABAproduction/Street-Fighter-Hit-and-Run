'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { GAME_CONFIG } from './gameConfig';
import { Entity, PlayerInput } from './gameLogic';

export interface GameBroadcast {
  type: 'position' | 'action' | 'hit' | 'round_start' | 'round_end' | 'match_end' | 'player_ready' | 'rematch_vote';
  payload: any;
  sender_id: string;
  timestamp: number;
}

export interface OpponentState {
  x: number;
  y: number;
  facing: 1 | -1;
  hp: number;
  stamina: number;
  isMoving: boolean;
  isDashing: boolean;
  dashDirection: 1 | -1 | 0;
  isPunching: boolean;
  punchTimer: number;
  momentumTimer: number;
  lastUpdate: number;
}

interface UseBattleSyncProps {
  roomCode: string;
  myUserId: string;
  myPlayer: Entity;
  opponentPlayer: Entity;
  onOpponentHit: (damage: number, hitX: number, hitY: number, isMomentum: boolean) => void;
  onRoundEnd: (winner: 'player' | 'target') => void;
  onMatchEnd: (winner: 'player' | 'target') => void;
  onRematchVote?: (wantsRematch: boolean, fromUserId: string) => void;
  onOpponentPresenceChange?: (present: boolean) => void;
}

export function useBattleSync({
  roomCode,
  myUserId,
  myPlayer,
  opponentPlayer,
  onOpponentHit,
  onRoundEnd,
  onMatchEnd,
  onRematchVote,
  onOpponentPresenceChange,
}: UseBattleSyncProps) {
  const channelRef = useRef<any>(null);
  
  const opponentStateRef = useRef<OpponentState>({
    x: opponentPlayer.x,
    y: opponentPlayer.y,
    facing: opponentPlayer.facing,
    hp: opponentPlayer.hp,
    stamina: opponentPlayer.maxStamina,
    isMoving: false,
    isDashing: false,
    dashDirection: 0,
    isPunching: false,
    punchTimer: 0,
    momentumTimer: 0,
    lastUpdate: Date.now(),
  });

  const interpolatedOpponentRef = useRef<OpponentState>({ ...opponentStateRef.current });
  const lastBroadcastRef = useRef(0);
  const BROADCAST_INTERVAL = 50;

  // Ref untuk callback stabil (hindari subscribe ulang channel)
  const onOpponentHitRef = useRef(onOpponentHit);
  const onRoundEndRef = useRef(onRoundEnd);
  const onMatchEndRef = useRef(onMatchEnd);
  const onRematchVoteRef = useRef(onRematchVote);
  useEffect(() => { onOpponentHitRef.current = onOpponentHit; }, [onOpponentHit]);
  useEffect(() => { onRoundEndRef.current = onRoundEnd; }, [onRoundEnd]);
  useEffect(() => { onMatchEndRef.current = onMatchEnd; }, [onMatchEnd]);
  useEffect(() => { onRematchVoteRef.current = onRematchVote; }, [onRematchVote]);

  useEffect(() => {
    if (!roomCode) return;

    const channel = supabase.channel(`room:${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: myUserId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<any>();
        const count = Object.keys(state).length;
        onOpponentPresenceChange?.(count > 1); // >1 artinya selain kita ada lawan
      })
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        const msg = payload as GameBroadcast;
        if (msg.sender_id === myUserId) return;
        handleBroadcastMessage(msg);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: myUserId, at: Date.now() });
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomCode, myUserId]);

  const handleBroadcastMessage = (msg: GameBroadcast) => {
    switch (msg.type) {
      case 'position':
        updateOpponentPosition(msg.payload);
        break;
      case 'action':
        updateOpponentAction(msg.payload);
        break;
      case 'hit':
        onOpponentHitRef.current(msg.payload.damage, msg.payload.hitX, msg.payload.hitY, msg.payload.isMomentum);
        break;
      case 'round_start':
        break;
      case 'round_end':
        onRoundEndRef.current(msg.payload.winner);
        break;
      case 'match_end':
        onMatchEndRef.current(msg.payload.winner);
        break;
      case 'rematch_vote':
        onRematchVoteRef.current?.(msg.payload.wantsRematch, msg.sender_id);
        break;
    }
  };

  const updateOpponentPosition = (payload: any) => {
    const now = Date.now();
    interpolatedOpponentRef.current = {
      ...opponentStateRef.current,
      x: payload.x, y: payload.y, facing: payload.facing,
      hp: payload.hp, stamina: payload.stamina,
      isMoving: payload.isMoving, isDashing: payload.isDashing,
      dashDirection: payload.dashDirection, lastUpdate: now,
    };
    opponentPlayer.x = payload.x;
    opponentPlayer.y = payload.y;
    opponentPlayer.facing = payload.facing;
    opponentPlayer.hp = payload.hp;
    opponentPlayer.stamina = payload.stamina;
    opponentPlayer.isMoving = payload.isMoving;
    opponentPlayer.isDashing = payload.isDashing;
    opponentPlayer.dashDirection = payload.dashDirection;
  };

  const updateOpponentAction = (payload: any) => {
    opponentPlayer.isPunching = payload.isPunching;
    opponentPlayer.punchTimer = payload.punchTimer;
    opponentPlayer.momentumTimer = payload.momentumTimer;
    interpolatedOpponentRef.current.isPunching = payload.isPunching;
    interpolatedOpponentRef.current.punchTimer = payload.punchTimer;
    interpolatedOpponentRef.current.momentumTimer = payload.momentumTimer;
  };

  const broadcastPosition = useCallback(() => {
    const now = Date.now();
    if (now - lastBroadcastRef.current < BROADCAST_INTERVAL) return;
    lastBroadcastRef.current = now;
    if (!channelRef.current) return;

    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: {
        type: 'position',
        payload: {
          x: myPlayer.x, y: myPlayer.y, facing: myPlayer.facing,
          hp: myPlayer.hp, stamina: myPlayer.stamina,
          isMoving: myPlayer.isMoving, isDashing: myPlayer.isDashing,
          dashDirection: myPlayer.dashDirection,
        },
        sender_id: myUserId, timestamp: now,
      },
    });
  }, [myPlayer, myUserId]);

  const broadcastAction = useCallback((action: Partial<OpponentState>) => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: { type: 'action', payload: action, sender_id: myUserId, timestamp: Date.now() },
    });
  }, [myUserId]);

  const broadcastHit = useCallback((damage: number, hitX: number, hitY: number, isMomentum: boolean) => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: { type: 'hit', payload: { damage, hitX, hitY, isMomentum }, sender_id: myUserId, timestamp: Date.now() },
    });
  }, [myUserId]);

  const broadcastRoundEnd = useCallback((winner: 'player' | 'target') => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: { type: 'round_end', payload: { winner }, sender_id: myUserId, timestamp: Date.now() },
    });
  }, [myUserId]);

  const broadcastMatchEnd = useCallback((winner: 'player' | 'target') => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: { type: 'match_end', payload: { winner }, sender_id: myUserId, timestamp: Date.now() },
    });
  }, [myUserId]);

  const broadcastRematchVote = useCallback((wantsRematch: boolean) => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast', event: 'game',
      payload: { type: 'rematch_vote', payload: { wantsRematch }, sender_id: myUserId, timestamp: Date.now() },
    });
  }, [myUserId]);

  const interpolateOpponent = useCallback((alpha: number) => {
    const target = interpolatedOpponentRef.current;
    const current = opponentStateRef.current;
    current.x += (target.x - current.x) * alpha;
    current.y += (target.y - current.y) * alpha;
    current.facing = target.facing;
    current.hp = target.hp;
    current.stamina = target.stamina;
    current.isMoving = target.isMoving;
    current.isDashing = target.isDashing;
    current.dashDirection = target.dashDirection;
    opponentPlayer.x = current.x;
    opponentPlayer.y = current.y;
    opponentPlayer.facing = current.facing;
    opponentPlayer.hp = current.hp;
    opponentPlayer.stamina = current.stamina;
    opponentPlayer.isMoving = current.isMoving;
    opponentPlayer.isDashing = current.isDashing;
    opponentPlayer.dashDirection = current.dashDirection;
  }, [opponentPlayer]);

  return {
    broadcastPosition,
    broadcastAction,
    broadcastHit,
    broadcastRoundEnd,
    broadcastMatchEnd,
    broadcastRematchVote,
    interpolateOpponent,
  };
}