'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePresence, useBroadcast, PlayerPresence } from '@/lib/realtimeHooks';
import { supabase } from '@/lib/supabaseClient';

interface RoomLobbyProps {
  roomCode: string;
  playerName: string;
  // isPlayer1: pemain yang join duluan (host) = true; opponentName: nama lawan
  onStartGame: (isPlayer1?: boolean, opponentName?: string, winsNeeded?: number) => void;
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
  // Kemenangan ronde yang dibutuhkan untuk menang (1 = 1 ronde, 2 = Best of 3, 3 = Best of 5)
  const [winsNeeded, setWinsNeeded] = useState<number>(2);

  // Determine host (first player to join)
  useEffect(() => {
    const playerArray = Array.from(players.values()).sort((a, b) => a.joined_at - b.joined_at);
    if (playerArray.length > 0) {
      setHostId(playerArray[0].user_id);
    }
  }, [players]);

  const isHost = hostId === myUserId;

  // Auto-ready for host
  useEffect(() => {
    if (isHost && !myReady) {
      setReady(true);
    }
  }, [isHost, myReady, setReady]);
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
          host_name: playerName,
          player_count: playerCount,
          wins_needed: winsNeeded,
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
        .update({ status, player_count: playerCount, wins_needed: winsNeeded })
        .eq('kode_room', roomCode.toUpperCase());
    } catch (e) {
      console.error('Failed to update room status:', e);
    }
  };

  // Sinkron wins_needed ke DB saat host mengubah (agd muncul di daftar room + untuk tamu)
  useEffect(() => {
    if (!isHost || !roomCreated) return;
    (supabase as any)
      .from('rooms')
      .update({ wins_needed: winsNeeded, player_count: playerCount })
      .eq('kode_room', roomCode.toUpperCase())
      .then(() => {});
    // Broadcast ke lawan agar mendapat update instan (tanpa perlu polling DB)
    send('wins_needed_update', { winsNeeded });
  }, [winsNeeded, playerCount, isHost, roomCreated, roomCode, send]);

  // Terima broadcast wins_needed dari host
  useEffect(() => {
    const cleanup = on('wins_needed_update', (data: any) => {
      if (data && typeof data.winsNeeded === 'number') {
        // clamp ke format yang tersedia (1 ronde / Best of 3)
        setWinsNeeded(data.winsNeeded >= 3 ? 2 : data.winsNeeded === 1 ? 1 : 2);
      }
    });
    return cleanup;
  }, [on]);

  // Tamu: baca wins_needed dari DB (fallback jika broadcast terlewat)
  useEffect(() => {
    if (isHost || !roomCode) return;
    (supabase as any)
      .from('rooms')
      .select('wins_needed')
      .eq('kode_room', roomCode.toUpperCase())
      .maybeSingle()
      .then(({ data }: any) => {
        if (data && typeof data.wins_needed === 'number') {
          // clamp ke format yang tersedia (1 ronde / Best of 3)
          setWinsNeeded(data.wins_needed >= 3 ? 2 : data.wins_needed === 1 ? 1 : 2);
        }
      });
  }, [isHost, roomCode]);

  // Countdown lalu pindah ke game. Dipanggil di host (lokal) dan di lawan (dari broadcast).
  const beginCountdown = useCallback((wins?: number) => {
    const raw = typeof wins === 'number' ? wins : winsNeeded;
    const finalWins = raw >= 3 ? 2 : raw === 1 ? 1 : 2; // clamp ke format yang tersedia
    setWinsNeeded(finalWins);
    setCountdown(3);
    updateRoomStatus('playing');
    const timer = setInterval(() => {
      setCountdown(c => c === null ? null : c - 1);
    }, 1000);
    setTimeout(() => {
      clearInterval(timer);
      setCountdown(null);
      onStartGame(isHost, opponent?.name, finalWins);
    }, 3500);
  }, [onStartGame, isHost, opponent, winsNeeded]);

  // Listen for round_start from host (hanya lawan; host tidak menerima pesan sendiri)
  useEffect(() => {
    const cleanup = on('round_start', (payload: any) => {
      beginCountdown(payload?.winsNeeded);
    });
    return cleanup;
  }, [on, beginCountdown]);

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
    
    await send('round_start', { winsNeeded });
    // Host tidak menerima broadcast sendiri, jadi jalankan countdown di sini juga
    beginCountdown();
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

        {isHost && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-sm text-gray-300 mb-2">Format pertarungan</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 1, label: '1 Ronde' },
                { value: 2, label: 'Best of 3' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setWinsNeeded(opt.value)}
                  disabled={countdown !== null}
                  className={`py-2 rounded-lg border text-sm font-bold transition-colors ${
                    winsNeeded === opt.value
                      ? 'bg-yellow-600 border-yellow-500 text-black'
                      : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
          <p>{winsNeeded === 1 ? '1 ronde' : 'Best of 3'}. HP 100. Arena menyempit setelah 45 detik.</p>
        </div>
      </div>

      <footer className="mt-8 text-center text-gray-500 text-sm"><p>Street Fighter : Hit and Run</p></footer>
    </div>
  );
}