'use client';

import { supabase } from './supabaseClient';

export interface RoundRecord {
  ronde: number;
  pemenang: string; // nama pemain yg menang ronde ini
}

export interface MatchResult {
  kodeRoom: string;
  namaPemain1: string; // player 1 (host, left side)
  namaPemain2: string; // player 2 (joiner, right side)
  pemenang: string;    // nama pemenang match
  skorRunde: RoundRecord[];
  waktuMulai: string;  // ISO string
  waktuSelesai: string; // ISO string
}

export async function saveMatch(result: MatchResult): Promise<number | null> {
  try {
    // 1. Get or create room id by kode_room
    const roomRes = await (supabase as any)
      .from('rooms')
      .select('id')
      .eq('kode_room', result.kodeRoom.toUpperCase())
      .single();

    let roomId = roomRes.data?.id;

    if (!roomId) {
      // Room doesn't exist in DB yet (shouldn't happen but handle gracefully)
      const createRes = await (supabase as any)
        .from('rooms')
        .insert({ kode_room: result.kodeRoom.toUpperCase(), status: 'finished' })
        .select('id')
        .single();
      roomId = createRes.data?.id;
    }

    if (!roomId) {
      console.error('[matchStore] Failed to get/create room id');
      return null;
    }

    // 2. Insert match record
    const matchRes = await (supabase as any)
      .from('matches')
      .insert({
        room_id: roomId,
        nama_pemain_1: result.namaPemain1,
        nama_pemain_2: result.namaPemain2,
        pemenang: result.pemenang,
        skor_runde: result.skorRunde,
        waktu_mulai: result.waktuMulai,
        waktu_selesai: result.waktuSelesai,
      })
      .select('id')
      .single();

    if (matchRes.error) {
      console.error('[matchStore] Insert match failed:', matchRes.error);
      return null;
    }

    console.log('[matchStore] Match saved:', matchRes.data.id);
    return matchRes.data.id;
  } catch (e) {
    console.error('[matchStore] Exception:', e);
    return null;
  }
}