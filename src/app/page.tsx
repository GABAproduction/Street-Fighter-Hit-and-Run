'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { getOrCreateUserId, generateDefaultName } from '@/lib/realtimeHooks';

// Dynamic imports
const Lobby = dynamic(() => import('@/components/Lobby').then(m => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[400px] bg-gray-900">
      <div className="text-center text-white font-mono">
        <div className="text-4xl mb-4">⏳</div>
        <div>Memuat lobi...</div>
      </div>
    </div>
  ),
});

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

const GameCanvas = dynamic(() => import('@/components/GameCanvas').then(m => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[540px] bg-gray-900 rounded-lg">
      <div className="text-center text-white font-mono">
        <div className="text-4xl mb-4">⏳</div>
        <div>Memuat game...</div>
      </div>
    </div>
  ),
});

const MultiplayerGameCanvas = dynamic(() => import('@/components/MultiplayerGameCanvas').then(m => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[540px] bg-gray-900 rounded-lg">
      <div className="text-center text-white font-mono">
        <div className="text-4xl mb-4">⏳</div>
        <div>Memuat game multiplayer...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  const [phase, setPhase] = useState<'lobby' | 'room' | 'game' | 'multiplayer'>('lobby');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [isPlayer1, setIsPlayer1] = useState(true);
  const [opponentName, setOpponentName] = useState('');
  const [winsNeeded, setWinsNeeded] = useState(2);

  const userId = getOrCreateUserId();

  // Check URL params for multiplayer game
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gameMode = params.get('game');
    const room = params.get('room');
    const name = params.get('name');
    const player = params.get('player'); // '1' or '2'
    const opponent = params.get('opponent'); // nama lawan
    const wins = params.get('wins'); // jumlah ronde menang yang dibutuhkan

    if (gameMode === '1' && room && name) {
      setRoomCode(room.toUpperCase());
      setPlayerName(name);
      setIsMultiplayer(true);
      setIsPlayer1(player === '1');
      if (opponent) setOpponentName(opponent);
      const winsNum = wins ? parseInt(wins, 10) : 2;
      if (winsNum === 1 || winsNum === 2) setWinsNeeded(winsNum);
      setPhase('multiplayer');
    }
  }, []);

  const handleEnterRoom = (code: string, name: string) => {
    setRoomCode(code);
    setPlayerName(name);
    setIsMultiplayer(false);
    setPhase('room');
  };

  // Dipanggil dari RoomLobby saat countdown selesai.
  // isHost/opponentName hanya ada bila masuk lewat jalur room (lobby).
  const handleStartGame = (isHost?: boolean, opponent?: string, winsNeededParam?: number) => {
    if (winsNeededParam !== undefined && (winsNeededParam === 1 || winsNeededParam === 2)) {
      setWinsNeeded(winsNeededParam);
    }
    if (isMultiplayer) {
      setPhase('multiplayer');
    } else if (isHost !== undefined) {
      // jalur room: ini sesi multiplayer, flag host + nama lawan dari presence
      setIsMultiplayer(true);
      setIsPlayer1(isHost);
      if (opponent) setOpponentName(opponent);
      if (winsNeededParam !== undefined && (winsNeededParam === 1 || winsNeededParam === 2)) {
        setWinsNeeded(winsNeededParam);
      }
      setPhase('multiplayer');
    } else {
      setPhase('game');
    }
  };

  const handleLeaveRoom = () => {
    setRoomCode('');
    setPlayerName('');
    setIsMultiplayer(false);
    setPhase('lobby');
    window.history.pushState({}, '', '/');
  };

  const handleMatchEnd = (winner: 'player' | 'target' | 'opponent') => {
    console.log('Match ended, winner:', winner);
  };

  if (phase === 'lobby') {
    return <Lobby onEnterRoom={handleEnterRoom} />;
  }

  if (phase === 'room') {
    return (
      <RoomLobby
        roomCode={roomCode}
        playerName={playerName}
        onStartGame={handleStartGame}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  if (phase === 'multiplayer') {
    return (
      <MultiplayerGameCanvas
        roomCode={roomCode}
        myUserId={userId}
        myName={playerName}
        opponentName={opponentName || 'Lawan'}
        isPlayer1={isPlayer1}
        winsNeeded={winsNeeded}
        onMatchEnd={handleMatchEnd}
      />
    );
  }

  // phase === 'game' (local)
  return (
    <div className="min-h-screen bg-gray-900 text-white font-mono flex flex-col items-center py-6 px-4">
      <header className="mb-4 text-center w-full max-w-[960px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Room: {roomCode}</span>
          <h1 className="text-xl font-bold">STREET FIGHTER : HIT AND RUN</h1>
          <span className="text-sm text-gray-400">{playerName}</span>
        </div>
      </header>
      <GameCanvas onRoundEnd={handleMatchEnd} />
      <footer className="mt-6 text-center text-gray-500 text-sm">
        <p>Game Lokal</p>
      </footer>
    </div>
  );
}