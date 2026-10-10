// Administrator mode. The code is checked by the database (only a bcrypt hash is stored
// there); this device remembers it so the admin panel stays unlocked until "Zamknout".

import { supabase } from './supabase.ts';
import { identity } from './identity.svelte.ts';

const KEY = 'pps.admin';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export type UnlockResult = 'ok' | 'wrong' | 'locked' | 'unset' | 'error';

class Admin {
  code = $state<string | null>(read());

  get unlocked() {
    return this.code !== null;
  }

  async unlock(code: string): Promise<UnlockResult> {
    if (!supabase) return 'error';
    const { data, error } = await supabase.rpc('admin_check', { p_code: code, p_device: identity.device });
    if (error) return 'error';
    const r = data as UnlockResult;
    if (r === 'ok') {
      this.code = code;
      try {
        localStorage.setItem(KEY, code);
      } catch {
        /* private mode: unlocked for this visit only */
      }
    }
    return r;
  }

  lock() {
    this.code = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  /** Called when the database rejects the stored code (e.g. it was changed elsewhere). */
  forget() {
    this.lock();
  }
}

export const admin = new Admin();
