'use client';

import { createClient } from '@supabase/supabase-js';

// Client-side only Supabase client
// Gunakan NEXT_PUBLIC_* agar bisa diakses di browser
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars. Check .env.local');
}

// Singleton pattern untuk menghindari multiple instances
let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false, // tidak perlu login
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 20, // broadcast rate limit
        },
      },
    });
  }
  return supabaseInstance;
}

// Export instance langsung untuk kemudahan
export const supabase = getSupabaseClient();