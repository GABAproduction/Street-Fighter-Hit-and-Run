'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getOrCreateUserId, generateDefaultName, generateRoomCode } from '@/lib/realtimeHooks';

interface LobbyProps {
  onEnterRoom: (roomCode: string, name: string) => void;
}

export default function Lobby({ onEnterRoom }: LobbyProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [savedName, setSavedName] = useState('');

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
      onEnterRoom(roomCode, trimmedName);
    } catch (e) {
      setError('Gagal buat room');
    } finally {
      setCreating(false);
    }
  }, [name, savedName, onEnterRoom]);

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
      localStorage.setItem('sfhr_player_name', trimmedName);
      onEnterRoom(code, trimmedName);
    } catch (e) {
      setError('Gagal gabung room');
    } finally {
      setJoining(false);
    }
  }, [name, savedName, roomCodeInput, onEnterRoom]);

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
          {/* Buat Room */}
          <div className="text-center">
            <p className="text-sm text-gray-400 mb-3">Atau buat room baru</p>
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

      <footer className="mt-12 text-center text-gray-500 text-sm">
        <p>Langkah 2: Lobi & Room | Dev 1</p>
      </footer>
    </div>
  );
}