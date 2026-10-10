'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

/**
 * Tipe data presence per player
 */
export interface PlayerPresence {
  user_id: string;           // random ID per browser session
  name: string;              // nama player
  ready: boolean;            // status ready
  joined_at: number;         // timestamp join
}

/**
 * Tipe data broadcast untuk game state
 */
export interface GameBroadcast {
  type: 'position' | 'action' | 'hit' | 'round_start' | 'round_end' | 'match_end' | 'wins_needed_update';
  payload: any;
  sender_id: string;
  timestamp: number;
}

/**
 * Hook untuk Presence (siapa yang ada di room, status ready)
 * Channel: `room:<kode_room>`
 */
export function usePresence(roomCode: string, myUserId: string, myName: string) {
  const [players, setPlayers] = useState<Map<string, PlayerPresence>>(new Map());
  const [myReady, setMyReady] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myStateRef = useRef<PlayerPresence>({
    user_id: myUserId,
    name: myName,
    ready: false,
    joined_at: Date.now(),
  });

  useEffect(() => {
    if (!roomCode) return;

    const channel = supabase.channel(`room:${roomCode}`, {
      config: {
        presence: {
          key: myUserId,
        },
      },
    });

    // Track presence join/leave
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PlayerPresence>();
        const newMap = new Map<string, PlayerPresence>();
        Object.values(state).forEach((presences) => {
          presences.forEach((p) => {
            newMap.set(p.user_id, p);
          });
        });
        setPlayers(newMap);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('[Presence] Join:', key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('[Presence] Leave:', key, leftPresences);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track presence sendiri
          await channel.track(myStateRef.current);
        }
      });

    channelRef.current = channel;

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [roomCode, myUserId, myName]);

  // Update ready status
  const setReady = useCallback(async (ready: boolean) => {
    myStateRef.current = { ...myStateRef.current, ready };
    setMyReady(ready);
    if (channelRef.current) {
      await channelRef.current.track(myStateRef.current);
    }
  }, []);

  // Update nama
  const setName = useCallback(async (name: string) => {
    myStateRef.current = { ...myStateRef.current, name };
    if (channelRef.current) {
      await channelRef.current.track(myStateRef.current);
    }
  }, []);

  return {
    players,           // Map<user_id, PlayerPresence>
    myReady,
    setReady,
    setName,
    playerCount: players.size,
  };
}

/**
 * Hook untuk Broadcast (kirim/terima game state realtime)
 * Channel: `room:<kode_room>` (sama dengan presence)
 */
export function useBroadcast(roomCode: string, myUserId: string) {
  const [lastMessage, setLastMessage] = useState<GameBroadcast | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const handlersRef = useRef<Map<string, (payload: any) => void>>(new Map());

  useEffect(() => {
    if (!roomCode) return;

    const channel = supabase.channel(`room:${roomCode}`);

    channel
      .on('broadcast', { event: 'game' }, ({ payload }) => {
        const msg = payload as GameBroadcast;
        // Jangan proses pesan sendiri
        if (msg.sender_id === myUserId) return;
        
        setLastMessage(msg);
        
        // Call registered handler
        const handler = handlersRef.current.get(msg.type);
        if (handler) {
          handler(msg.payload);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomCode, myUserId]);

  // Kirim broadcast
  const send = useCallback(async (type: GameBroadcast['type'], payload: any) => {
    if (!channelRef.current) return;
    
    const msg: GameBroadcast = {
      type,
      payload,
      sender_id: myUserId,
      timestamp: Date.now(),
    };
    
    await channelRef.current.send({
      type: 'broadcast',
      event: 'game',
      payload: msg,
    });
  }, []);

  // Register handler untuk tipe pesan tertentu
  const on = useCallback((type: GameBroadcast['type'], handler: (payload: any) => void) => {
    handlersRef.current.set(type, handler);
    return () => {
      handlersRef.current.delete(type);
    };
  }, []);

  return { send, on, lastMessage };
}

/**
 * Generate random user ID (simpan di localStorage biar persist per browser)
 */
export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return 'server';
  
  let userId = localStorage.getItem('sfhr_user_id');
  if (!userId) {
    userId = `user_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem('sfhr_user_id', userId);
  }
  return userId;
}

/**
 * Generate nama default
 */
export function generateDefaultName(): string {
  return `Petarung-${Math.floor(Math.random() * 9000) + 1000}`;
}

/**
 * Generate room code (4-6 karakter)
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}