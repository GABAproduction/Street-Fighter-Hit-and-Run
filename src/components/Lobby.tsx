'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getOrCreateUserId, generateDefaultName, generateRoomCode } from '@/lib/realtimeHooks';
import { supabase } from '@/lib/supabaseClient';

interface LobbyProps {
  onEnterRoom: (roomCode: string, name: string) => void;
}

interface PublicRoom {
  kode_room: string;
  host_name: string;
  player_count: number;
  wins_needed: number;
}

export default function Lobby({ onEnterRoom }: LobbyProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [savedName, setSavedName] = useState('');
  const [isPublicRoom, setIsPublicRoom] = useState(true);
  const [showRoomList, setShowRoomList] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  // Load saved name from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('sfhr_player_name');
    if (stored) {
      setSavedName(stored);
      setName(stored);
    } else {
      const defaultName = generateDefaultName();
      setSavedName(defaultName);
      setName(defaultName);
    }
  }, []);

  // Fetch public rooms (di-refresh saat panel dibuka)
  const fetchPublicRooms = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('rooms')
        .select('kode_room, host_name, player_count, wins_needed')
        .eq('is_public', true)
        .eq('status', 'waiting')
        .lt('player_count', 2)
        .order('dibuat_pada', { ascending: false })
        .limit(20);
      if (!error) setPublicRooms(data || []);
    } catch (e) {
      // biar tidak crash kalau kolom belum ada
      setPublicRooms([]);
    }
  }, []);

  useEffect(() => {
    if (!showRoomList) return;
    fetchPublicRooms();
    const id = setInterval(fetchPublicRooms, 8000);
    return () => clearInterval(id);
  }, [showRoomList, fetchPublicRooms]);

  const handleCreateRoom = useCallback(async () => {
    const trimmedName = name.trim() || savedName;
    if (!trimmedName) {
      setError('Nama tidak boleh kosong');
      return;
    }

    setError('');
    setCreating(true);

    try {
      const roomCode = generateRoomCode();
      localStorage.setItem('sfhr_player_name', trimmedName);
      // Simpan konfigurasi room (publik/privat + host) ke DB agar muncul di daftar room
      try {
        await (supabase as any).from('rooms').upsert({
          kode_room: roomCode,
          status: 'waiting',
          is_public: isPublicRoom,
          host_name: trimmedName,
          player_count: 1,
        }, { onConflict: 'kode_room' });
      } catch {}
      onEnterRoom(roomCode, trimmedName);
    } catch (e) {
      setError('Gagal buat room');
    } finally {
      setCreating(false);
    }
  }, [name, savedName, isPublicRoom, onEnterRoom]);

  const handleJoinRoom = useCallback(async () => {
    const trimmedName = name.trim() || savedName;
    const code = roomCodeInput.trim().toUpperCase();

    if (!trimmedName) {
      setError('Nama tidak boleh kosong');
      return;
    }
    if (!code) {
      setError('Kode room tidak boleh kosong');
      return;
    }
    if (code.length < 4 || code.length > 6) {
      setError('Kode room 4-6 karakter');
      return;
    }

    setError('');
    setJoining(true);

    try {
      // Validasi: kode harus ada di daftar room yang tersedia (bukan asal ketik).
      const { data, error: lookupError } = await (supabase as any)
        .from('rooms')
        .select('kode_room, status')
        .eq('kode_room', code)
        .maybeSingle();

      if (lookupError || !data) {
        setError('Kode room tidak ditemukan. Periksa kembali kodenya.');
        return;
      }
      if (data.status === 'finished') {
        setError('Room tersebut sudah selesai/tidak tersedia.');
        return;
      }

      localStorage.setItem('sfhr_player_name', trimmedName);
      onEnterRoom(code, trimmedName);
    } catch (e) {
      setError('Gagal gabung room');
    } finally {
      setJoining(false);
    }
  }, [name, savedName, roomCodeInput, onEnterRoom]);

  const handleJoinFromList = useCallback((code: string) => {
    const trimmedName = name.trim() || savedName;
    if (!trimmedName) {
      setError('Nama tidak boleh kosong');
      return;
    }
    localStorage.setItem('sfhr_player_name', trimmedName);
    onEnterRoom(code.toUpperCase(), trimmedName);
  }, [name, savedName, onEnterRoom]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey || roomCodeInput) {
        handleJoinRoom();
      } else {
        handleCreateRoom();
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-mono flex flex-col items-center py-12 px-4">
      <header className="mb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2">
          STREET FIGHTER : HIT AND RUN
        </h1>
        <p className="text-gray-400 text-lg">Multiplayer 1v1 - Masuk Room</p>
      </header>

      <div className="w-full max-w-md bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-6">
        {/* Nama */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Nama Pemain
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={generateDefaultName()}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            maxLength={20}
            autoFocus
          />
          <p className="text-xs text-gray-500 mt-1">Maks 20 karakter. Kosong = nama random.</p>
        </div>

        <div className="border-t border-gray-700 pt-6 space-y-4">
          {/* Jenis room */}
          <div>
            <p className="text-sm font-medium text-gray-300 mb-2">Jenis Room</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsPublicRoom(true)}
                className={`py-3 px-4 rounded-lg border font-bold text-sm transition-colors ${
                  isPublicRoom
                    ? 'bg-green-600 border-green-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                }`}
              >
                🌍 Publik
              </button>
              <button
                onClick={() => setIsPublicRoom(false)}
                className={`py-3 px-4 rounded-lg border font-bold text-sm transition-colors ${
                  !isPublicRoom
                    ? 'bg-yellow-600 border-yellow-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                }`}
              >
                🔒 Privat
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {isPublicRoom
                ? 'Room tampil di daftar room publik.'
                : 'Hanya bisa masuk lewat kode.'}
            </p>
          </div>

          {/* Buat Room */}
          <div className="text-center">
            <button
              onClick={handleCreateRoom}
              disabled={creating}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {creating ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Membuat...
                </>
              ) : (
                '🎮 BUAT ROOM BARU'
              )}
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-800 px-2 text-gray-500">ATAU</span>
            </div>
          </div>

          {/* Gabung Room */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Kode Room (4-6 huruf/angka)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                placeholder="Contoh: A7K9M"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg tracking-widest"
                maxLength={6}
                style={{ textTransform: 'uppercase' }}
              />
              <button
                onClick={handleJoinRoom}
                disabled={joining}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-bold py-3 px-6 rounded-lg transition-colors whitespace-nowrap"
              >
                {joining ? 'Masuk...' : 'GABUNG'}
              </button>
            </div>
          </div>

          {/* Daftar room publik */}
          <button
            onClick={() => setShowRoomList(v => !v)}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
          >
            {showRoomList ? '▲ Sembunyikan Daftar Room' : '📋 LIHAT ROOM PUBLIK'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm text-center">
            {error}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-gray-500 text-center space-y-1 pt-2 border-t border-gray-700">
          <p>Room code: 5 karakter (huruf/angka, case-insensitive)</p>
          <p>Tidak perlu login. Data tersimpan di browser.</p>
        </div>
      </div>

      {showRoomList && (
        <div className="w-full max-w-md bg-gray-800 rounded-lg p-6 border border-gray-700 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">ROOM PUBLIK</h2>
            <button onClick={fetchPublicRooms} className="text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1">
              🔄 Muat ulang
            </button>
          </div>
          {publicRooms.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-600 rounded-lg">
              Belum ada room publik yang menunggu.
              <p className="text-xs mt-2">Buat room baru dengan jenis <strong>Publik</strong> agar teman bisa menemukannya.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {publicRooms.map(r => (
                <div key={r.kode_room} className="flex items-center justify-between bg-gray-700 rounded-lg p-4">
                  <div>
                    <p className="font-bold text-white">
                      {r.host_name || 'Host'}
                      <span className="text-xs text-gray-400 ml-2">Room {r.kode_room}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {r.player_count}/2 pemain · {r.wins_needed === 1 ? '1 ronde' : r.wins_needed === 2 ? 'Best of 3' : 'Best of 5'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleJoinFromList(r.kode_room)}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded-lg text-sm"
                  >
                    MASUK
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <footer className="mt-12 text-center text-gray-500 text-sm"><p>Street Fighter : Hit and Run</p></footer>
    </div>
  );
}
