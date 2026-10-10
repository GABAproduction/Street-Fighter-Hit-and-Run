'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePresence } from '@/lib/realtimeHooks';
import { getOrCreateUserId, generateDefaultName } from '@/lib/realtimeHooks';
import dynamic from 'next/dynamic';

const RoomLobby = dynamic(() => import('@/components/RoomLobby').then(m => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[400px] bg-gray-900">
      <div className="text-center text-white font-mono">
        <div className="text-4xl mb-4">⏳</div>
        <div>Menghubungkan ke room...</div>
      </div>
    </div>
  ),
});

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.code as string;
  const [playerName, setPlayerName] = useState('');
  const [isHost, setIsHost] = useState(false);
  const userId = getOrCreateUserId();

  // Use presence to determine host
  const { players } = usePresence(roomCode.toUpperCase(), userId, playerName);

  useEffect(() => {
    const stored = localStorage.getItem('sfhr_player_name');
    if (stored) setPlayerName(stored);
    else {
      const def = generateDefaultName();
      setPlayerName(def);
      localStorage.setItem('sfhr_player_name', def);
    }
  }, []);

  // Determine host from presence
  useEffect(() => {
    const playerArray = Array.from(players.values()).sort((a, b) => a.joined_at - b.joined_at);
    if (playerArray.length > 0) {
      setIsHost(playerArray[0].user_id === userId);
    }
  }, [players, userId]);

  const handleStartGame = () => {
    const playerNum = isHost ? '1' : '2';
    router.push(`/?game=1&room=${roomCode}&name=${encodeURIComponent(playerName)}&player=${playerNum}`);
  };

  const handleLeaveRoom = () => {
    router.push('/');
  };

  if (!roomCode) return null;

  return (
    <RoomLobby
      roomCode={roomCode.toUpperCase()}
      playerName={playerName}
      onStartGame={handleStartGame}
      onLeaveRoom={handleLeaveRoom}
    />
  );
}