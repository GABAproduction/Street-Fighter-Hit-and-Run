'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePresence, useBroadcast, PlayerPresence } from '@/lib/realtimeHooks';
import { supabase } from '@/lib/supabaseClient';

interface RoomLobbyProps {
  roomCode: string;
  playerName: string;
  onStartGame: () => void;
  onLeaveRoom: () => void;
}

export default function RoomLobby({ roomCode, playerName, onStartGame, onLeaveRoom }: RoomLobbyProps) {
  const router = useRouter();
  const myUserId = (typeof window !== 'undefined') ? localStorage.getItem('sfhr_user_id') || '' : '';
  
  const { players, myReady, setReady, setName, playerCount } = usePresence(roomCode, myUserId, playerName);
  const { send, on } = useBroadcast(roomCode, myUserId);
  
  const [hostId, setHostId] = useState<string>('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [roomCreated, setRoomCreated] = useState(false);

  // Determine host (first player to join)
  useEffect(() => {
    const playerArray = Array.from(players.values()).sort((a, b) => a.joined_at - b.joined_at);
    if (playerArray.length > 0) {
      setHostId(playerArray[0].user_id);
    }
  }, [players]);

  const isHost = hostId === myUserId;
  const allReady = playerCount === 2 && Array.from(players.values()).every(p => p.ready);
  const opponent = Array.from(players.values()).find(p => p.user_id !== myUserId);

  // Create room in database when host joins
  useEffect(() => {
    if (isHost && !roomCreated) {
      createRoomInDB();
    }
  }, [isHost, roomCreated]);

  const createRoomInDB = async () => {
    try {
      const { error } = await (supabase as any)
        .from('rooms')
        .upsert({
          kode_room: roomCode.toUpperCase(),
          status: 'waiting',
        }, { onConflict: 'kode_room' });
      if (!error) setRoomCreated(true);
    } catch (e) {
      console.error('Failed to create room:', e);
    }
  };

  // Update room status to playing when game starts
  const updateRoomStatus = async (status: 'waiting' | 'playing' | 'finished') => {
    try {
      await (supabase as any)
        .from('rooms')
        .update({ status })
        .eq('kode_room', roomCode.toUpperCase());
    } catch (e) {
      console.error('Failed to update room status:', e);
    }
  };

  // Listen for round_start from host
  useEffect(() => {
    const cleanup = on('round_start', () => {
      setCountdown(3);
      updateRoomStatus('playing');
      const timer = setInterval(() => {
        setCountdown(c => c === null ? null : c - 1);
      }, 1000);
      setTimeout(() => {
        clearInterval(timer);
        setCountdown(null);
        onStartGame();
      }, 3500);
    });
    return cleanup;
  }, [on, onStartGame]);

  // Listen for host leaving
  useEffect(() => {
    const cleanup = on('match_end', () => {
      updateRoomStatus('finished');
      setError('Host keluar dari room');
      setTimeout(() => onLeaveRoom(), 1500);
    });
    return cleanup;
  }, [on, onLeaveRoom]);

  const handleReadyClick = () => {
    if (countdown !== null) return;
    setReady(!myReady);
  };

  const handleStartGame = async () => {
    if (!isHost) return;
    if (playerCount !== 2) { setError('Butuh 2 pemain untuk mulai'); return; }
    if (!allReady) { setError('Tunggu lawan ready'); return; }
    
    await send('round_start', {});
  };

  const handleLeave = async () => {
    if (isHost) {
      await send('match_end', {});
      await updateRoomStatus('finished');
    }
    onLeaveRoom();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value.slice(0, 20);
    setName(newName);
    localStorage.setItem('sfhr_player_name', newName);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-mono flex flex-col items-center py-12 px-4">
      <header className="mb-6 text-center w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleLeave} className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded border border-gray-700">← Keluar</button>
          <h1 className="text-2xl font-bold">ROOM: <span className="text-yellow-300">{roomCode}</span></h1>
          <div className="w-24" />
        </div>
        <p className="text-gray-400">Bagikan kode ini ke teman untuk bergabung</p>
      </header>

      {countdown !== null && countdown > 0 && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/80" style={{ pointerEvents: 'none' }}>
          <div className="text-8xl font-bold text-yellow-300 animate-pulse">{countdown}</div>
        </div>
      )}
      {countdown === 0 && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/80" style={{ pointerEvents: 'none' }}>
          <div className="text-8xl font-bold text-green-400 animate-pulse">FIGHT!</div>
        </div>
      )}

      <div className="w-full max-w-2xl bg-gray-800 rounded-lg p-6 border border-gray-700 space-y-6">
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            Pemain ({playerCount}/2)
            {isHost && <span className="text-xs bg-yellow-600 text-black px-2 py-0.5 rounded">HOST</span>}
          </h2>
          <div className="space-y-3">
            {Array.from(players.values()).map((p) => (
              <div key={p.user_id} className="flex items-center justify-between bg-gray-700 rounded-lg p-4">
                <div className="flex items-center gap-4">
                  <span className={`w-3 h-3 rounded-full ${p.ready ? 'bg-green-400' : 'bg-gray-500'}`} />
                  <div>
                    <input type="text" value={p.name} onChange={p.user_id === myUserId ? handleNameChange : undefined} disabled={p.user_id !== myUserId} className="bg-transparent border-none text-white font-mono text-lg focus:outline-none disabled:text-gray-300" maxLength={20} />
                    <p className="text-xs text-gray-400">{p.user_id === myUserId ? ' (Kamu)' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {p.ready ? <span className="text-green-400 font-bold">READY</span> : <span className="text-gray-500">Menunggu...</span>}
                </div>
              </div>
            ))}
            {playerCount < 2 && (
              <div className="text-center py-6 text-gray-500 border-2 border-dashed border-gray-600 rounded-lg">
                Menunggu pemain lain bergabung...
                <p className="text-xs mt-1">Kirim kode room: <strong className="text-yellow-300">{roomCode}</strong></p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
          {isHost ? (
            <button onClick={handleStartGame} disabled={playerCount !== 2 || !allReady || countdown !== null} className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-lg transition-colors text-lg">
              {countdown !== null ? 'MEMULAI...' : allReady ? 'MULAI PERTARUNGAN' : 'Tunggu lawan ready'}
            </button>
          ) : (
            <button onClick={handleReadyClick} disabled={countdown !== null} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-bold py-4 rounded-lg transition-colors text-lg">
              {myReady ? '✓ SIAP - Klik untuk batal' : 'KLIK UNTUK SIAP'}
            </button>
          )}
        </div>

        {error && <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm text-center">{error}</div>}

        <div className="text-xs text-gray-500 text-center space-y-1">
          <p>Kontrol: ← → Jalan | Shift Dash | Spasi/X/Z Pukul</p>
          <p>Best of 3 ronde. HP 100. Arena menyempit setelah 45 detik.</p>
        </div>
      </div>

      <footer className="mt-8 text-center text-gray-500 text-sm"><p>Langkah 3: Sinkronisasi Pertarungan | Room + DB</p></footer>
    </div>
  );
}