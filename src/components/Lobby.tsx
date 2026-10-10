'use client';

import { useState, useEffect, useCallback } from 'react';
import { generateDefaultName, generateRoomCode } from '@/lib/realtimeHooks';
import { supabase } from '@/lib/supabaseClient';
import GamePreview from '@/components/GamePreview';

type BotDifficulty = 'easy' | 'normal' | 'hard';

interface LobbyProps {
  onEnterRoom: (roomCode: string, name: string) => void;
  onStartSingle: (difficulty: BotDifficulty, winsNeeded: number, name: string) => void;
}

interface PublicRoom {
  kode_room: string;
  host_name: string;
  player_count: number;
  wins_needed: number;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
      {children}
    </span>
  );
}

function InfoCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h3 className="font-bold tracking-wide">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-white/65">{children}</div>
    </div>
  );
}

export default function Lobby({ onEnterRoom, onStartSingle }: LobbyProps) {
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [savedName, setSavedName] = useState('');
  const [isPublicRoom, setIsPublicRoom] = useState(true);
  const [showRoomList, setShowRoomList] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [mode, setMode] = useState<'multiplayer' | 'single'>('multiplayer');
  const [singleDifficulty, setSingleDifficulty] = useState<BotDifficulty>('normal');
  const [singleWinsNeeded, setSingleWinsNeeded] = useState<number>(2);

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
    <div
      className="min-h-screen text-white"
      style={{
        background:
          'radial-gradient(1200px 600px at 15% -10%, rgba(59,130,246,0.25), transparent 60%), radial-gradient(1000px 500px at 90% 0%, rgba(217,70,239,0.22), transparent 60%), linear-gradient(180deg, #070714 0%, #0b0b1e 45%, #05050f 100%)',
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        {/* NAV */}
        <nav className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-fuchsia-600 text-2xl shadow-lg shadow-fuchsia-900/40">
              🥊
            </div>
            <div className="leading-tight">
              <p className="font-black tracking-widest">STREET FIGHTER</p>
              <p className="text-[11px] tracking-[0.35em] text-white/50">HIT &amp; RUN</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Chip>🟢 Realtime</Chip>
            <Chip>🎮 1v1</Chip>
            <Chip>🤖 vs Bot</Chip>
            <Chip>🕹️ Tanpa Login</Chip>
          </div>
        </nav>

        {/* HERO */}
        <section className="mb-16 grid items-center gap-8 lg:grid-cols-2">
          <div>
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
              ⚡ Fighting 2D Multiplayer Online
            </span>
            <h1 className="mb-4 text-4xl font-black leading-[0.95] tracking-tight md:text-6xl">
              Duel Cepat,
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
                Pukul &amp; Lari!
              </span>
            </h1>
            <p className="mb-6 max-w-xl text-lg leading-relaxed text-white/70">
              Bertarung 1&nbsp;lawan&nbsp;1 secara real-time. Kumpulkan <strong className="text-white">momentum</strong> lewat dash,
              hantam lawan sebelum <strong className="text-white">arena menyempit</strong>, dan rebut kemenangan
              di mode <strong className="text-white">1 Ronde</strong> atau <strong className="text-white">Best of 3</strong>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip>🌐 Room Publik &amp; Privat</Chip>
              <Chip>⏱️ Arena menyempit 45s</Chip>
              <Chip>💥 Bonus Momentum Dash</Chip>
              <Chip>📱 Main di Browser</Chip>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-blue-600/30 via-fuchsia-600/30 to-amber-500/30 blur-2xl" />
            <div className="relative rounded-3xl border border-white/15 bg-black/40 p-2 shadow-2xl">
              <GamePreview label="GAMEPLAY" />
            </div>
          </div>
        </section>

        {/* MAIN: PLAY + SIDE INFO */}
        <section className="mb-16 grid gap-6 lg:grid-cols-3">
          {/* Panel bermain */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur lg:col-span-2">
            {/* Nama */}
            <div>
              <label className="mb-2 block text-sm font-medium text-white/80">Nama Pemain</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={generateDefaultName()}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white placeholder-white/30 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40"
                maxLength={20}
                autoFocus
              />
              <p className="mt-1 text-xs text-white/40">Maks 20 karakter. Kosong = nama random.</p>
            </div>

            <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
              {/* Mode permainan */}
              <div>
                <p className="mb-2 text-sm font-medium text-white/80">Mode Permainan</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode('multiplayer')}
                    className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                      mode === 'multiplayer'
                        ? 'border-blue-400/60 bg-blue-500/20 text-blue-100 shadow-inner'
                        : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                    }`}
                  >
                    🌐 Multiplayer (2 Pemain)
                  </button>
                  <button
                    onClick={() => setMode('single')}
                    className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                      mode === 'single'
                        ? 'border-orange-400/60 bg-orange-500/20 text-orange-100 shadow-inner'
                        : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                    }`}
                  >
                    🤖 Single-Player (vs Bot)
                  </button>
                </div>
              </div>

              {/* Single player */}
              {mode === 'single' && (
                <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/80">Level Bot</p>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'easy', label: 'Mudah' },
                        { value: 'normal', label: 'Sedang' },
                        { value: 'hard', label: 'Sulit' },
                      ] as const).map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setSingleDifficulty(opt.value)}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                            singleDifficulty === opt.value
                              ? 'border-orange-400/60 bg-orange-500/20 text-orange-100 shadow-inner'
                              : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/80">Format Pertandingan</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: 1, label: '1 Ronde' },
                        { value: 2, label: 'Best of 3' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setSingleWinsNeeded(opt.value)}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                            singleWinsNeeded === opt.value
                              ? 'border-yellow-400/60 bg-yellow-500/20 text-yellow-100 shadow-inner'
                              : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const trimmed = name.trim() || savedName || generateDefaultName();
                      onStartSingle(singleDifficulty, singleWinsNeeded, trimmed);
                    }}
                    className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-red-600 py-4 text-lg font-black tracking-wide shadow-lg shadow-orange-900/40 transition hover:from-orange-400 hover:to-red-500"
                  >
                    ⚔️ MULAI MELAWAN BOT
                  </button>
                </div>
              )}
              {mode === 'multiplayer' && (
                <div>
                  {/* Jenis room */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-white/80">Jenis Room</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setIsPublicRoom(true)}
                        className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                          isPublicRoom
                            ? 'border-green-400/60 bg-green-500/20 text-green-100 shadow-inner'
                            : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                        }`}
                      >
                        🌍 Publik
                      </button>
                      <button
                        onClick={() => setIsPublicRoom(false)}
                        className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                          !isPublicRoom
                            ? 'border-amber-400/60 bg-amber-500/20 text-amber-100 shadow-inner'
                            : 'border-white/15 bg-black/30 text-white/50 hover:border-white/30'
                        }`}
                      >
                        🔒 Privat
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-white/40">
                      {isPublicRoom ? 'Room tampil di daftar room publik.' : 'Hanya bisa masuk lewat kode.'}
                    </p>
                  </div>

                  {/* Buat Room */}
                  <button
                    onClick={handleCreateRoom}
                    disabled={creating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-4 text-lg font-black tracking-wide shadow-lg shadow-emerald-900/40 transition hover:from-green-400 hover:to-emerald-500 disabled:opacity-60"
                  >
                    {creating ? 'MEMBUAT...' : '🎮 BUAT ROOM BARU'}
                  </button>

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-[#0b0b1e] px-3 tracking-widest text-white/40">ATAU</span>
                    </div>
                  </div>

                  {/* Gabung Room */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-white/80">Kode Room (4-6 huruf/angka)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={roomCodeInput}
                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                        onKeyDown={handleKeyDown}
                        placeholder="Contoh: A7K9M"
                        className="flex-1 rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-center text-lg tracking-[0.3em] text-white placeholder-white/25 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/40"
                        maxLength={6}
                        style={{ textTransform: 'uppercase' }}
                      />
                      <button
                        onClick={handleJoinRoom}
                        disabled={joining}
                        className="whitespace-nowrap rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-3 font-black tracking-wide shadow-lg shadow-blue-900/40 transition hover:from-blue-400 hover:to-indigo-500 disabled:opacity-60"
                      >
                        {joining ? 'MASUK...' : 'GABUNG'}
                      </button>
                    </div>
                  </div>

                  {/* Daftar room publik */}
                  <button
                    onClick={() => setShowRoomList((v) => !v)}
                    className="w-full rounded-xl border border-purple-400/40 bg-purple-500/15 py-3 font-bold text-purple-100 transition hover:bg-purple-500/25"
                  >
                    {showRoomList ? '▲ Sembunyikan Daftar Room' : '📋 LIHAT ROOM PUBLIK'}
                  </button>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/15 p-3 text-center text-sm text-red-200">
                {error}
              </div>
            )}

            <p className="mt-4 text-center text-xs text-white/35">
              Tidak perlu login. Data nama tersimpan di browser.
            </p>

            {/* Daftar room publik */}
            {showRoomList && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-bold tracking-wide">ROOM PUBLIK</h2>
                  <button
                    onClick={fetchPublicRooms}
                    className="rounded-md border border-white/15 px-2 py-1 text-xs text-white/60 transition hover:text-white"
                  >
                    🔄 Muat ulang
                  </button>
                </div>
                {publicRooms.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-white/15 py-8 text-center text-white/45">
                    Belum ada room publik yang menunggu.
                    <p className="mt-2 text-xs">
                      Buat room baru dengan jenis <strong className="text-white/70">Publik</strong> agar teman bisa menemukannya.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {publicRooms.map((r) => (
                      <div
                        key={r.kode_room}
                        className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-4"
                      >
                        <div>
                          <p className="font-bold">
                            {r.host_name || 'Host'}
                            <span className="ml-2 text-xs text-white/40">Room {r.kode_room}</span>
                          </p>
                          <p className="text-xs text-white/45">
                            {r.player_count}/2 pemain · {r.wins_needed === 1 ? '1 ronde' : 'Best of 3'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleJoinFromList(r.kode_room)}
                          className="rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2 text-sm font-bold shadow transition hover:from-green-400 hover:to-emerald-500"
                        >
                          MASUK
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sisi: preview + info */}
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-black/40 p-2 shadow-xl">
              <GamePreview staticFrame label="ARENA MENYEMPIT" />
            </div>

            <InfoCard icon="🚀" title="Cara Bermain">
              <ol className="list-decimal space-y-1 pl-4">
                <li>Buat room (pilih Publik/Privat) atau masukkan kode teman.</li>
                <li>Tunggu 2 pemain, lalu host pilih format dan mulai.</li>
                <li>Setelah hitungan <strong>3-2-1 FIGHT!</strong> bertarunglah.</li>
                <li>Kalahkan lawan sampai HP-nya habis untuk merebut ronde.</li>
              </ol>
            </InfoCard>

            <InfoCard icon="⌨️" title="Kontrol">
              <div className="space-y-1 font-mono text-xs">
                <p>← → &nbsp;: Jalan</p>
                <p>Shift&nbsp;: Dash (isi momentum)</p>
                <p>Spasi / X / Z : Pukul</p>
              </div>
            </InfoCard>
          </div>
        </section>

        {/* FITUR */}
        <section className="mb-16">
          <h2 className="mb-6 text-center text-2xl font-black tracking-wide md:text-3xl">Kenapa Seru?</h2>
          <div className="grid gap-6 md:grid-cols-3">
            <InfoCard icon="⚔️" title="Duel Real-time">
              Pertarungan 1v1 langsung lewat koneksi real-time. Tanpa login, cukup pakai kode room.
            </InfoCard>
            <InfoCard icon="🔥" title="Momentum Dash">
              Dash mengisi momentum — pukulan setelah dash memberi damage lebih besar. Risiko &amp; imbalan!
            </InfoCard>
            <InfoCard icon="🗺️" title="Arena Menyempit">
              Setelah 45 detik dinding merah mulai menghimpit. Jadikan lawan terkunci di sudut!
            </InfoCard>
          </div>
        </section>

        {/* ATURAN / INFO */}
        <section className="mb-16 rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur md:p-8">
          <h2 className="mb-6 text-2xl font-black tracking-wide">Info &amp; Aturan Pertandingan</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-bold text-blue-300">Format Ronde</p>
              <p className="text-sm text-white/60">
                <strong>1 Ronde</strong> (sekali menang langsung juara) atau <strong>Best of 3</strong>
                {' '}(butuh 2 kemenangan).
              </p>
            </div>
            <div>
              <p className="text-sm font-bold text-fuchsia-300">HP &amp; Damage</p>
              <p className="text-sm text-white/60">
                HP maksimal 100. Pukulan dasar 12 damage, bisa naik hingga ~1.6x saat momentum.
              </p>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-300">Penalti Jarak Dekat</p>
              <p className="text-sm text-white/60">
                Berdiri terlalu dekat membuat damage berkurang hingga 60%. Jaga jarak untuk pukulan penuh!
              </p>
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-300">Room &amp; Lawan</p>
              <p className="text-sm text-white/60">
                Room <strong>Publik</strong> tampil di daftar; <strong>Privat</strong> hanya lewat kode.
                Lawan yang putus koneksi akan ditandai dan bisa Anda tinggalkan.
              </p>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-6 text-center text-sm text-white/40">
          <p>Street Fighter : Hit and Run — dibangun dengan HTML5 Canvas &amp; Supabase Realtime.</p>
        </footer>
      </div>
    </div>
  );
}
