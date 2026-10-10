// Offline queue of live plays for one game.
//
// Every play is first stored on the phone and shown at once, then sent in order. Without
// signal the plays wait and go out as soon as the connection is back (also after the page
// is reopened). Each play carries a client id, so a play whose answer got lost is not
// applied twice. A refusal by the database (someone else scored meanwhile, invalid play)
// stops the queue and lets the scorer retry or drop the waiting plays.

import { isNetworkError, livePlayOnce, errorMessage, WriteCancelled } from './api.ts';
import { applyPlay, runsOn, type Bases, type Play } from './live.ts';
import type { LiveSession } from './types.ts';

export interface QueuedPlay {
  id: string;
  teamId: number;
  play: Play;
  /** batter of the play (null for a runner-only play) */
  batter: string | null;
  at: string;
}

type Status = 'idle' | 'sending' | 'offline' | 'error';

interface Stored {
  items: QueuedPlay[];
  base: Record<number, LiveSession>;
}

const RETRY_MS = 8_000;

export class PlayQueue {
  items = $state<QueuedPlay[]>([]);
  /** server state of each team the waiting plays start from */
  base = $state<Record<number, LiveSession>>({});
  status = $state<Status>('idle');
  error = $state<string | null>(null);
  /** the moment the last play reached the database (for the "Uloženo" indicator) */
  savedAt = $state<number | null>(null);

  #key: string;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #sending = false;
  #onSent: () => Promise<void> | void;
  #onOnline = () => this.flush();

  constructor(gameId: number, onSent: () => Promise<void> | void) {
    this.#key = `pps.queue.${gameId}`;
    this.#onSent = onSent;
    try {
      const raw = localStorage.getItem(this.#key);
      if (raw) {
        const s = JSON.parse(raw) as Stored;
        if (Array.isArray(s.items) && s.items.length) {
          this.items = s.items;
          this.base = s.base ?? {};
        }
      }
    } catch {
      /* private mode or broken data: start empty */
    }
    if (typeof window !== 'undefined') window.addEventListener('online', this.#onOnline);
    if (this.items.length) this.flush();
  }

  destroy() {
    clearTimeout(this.#timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', this.#onOnline);
  }

  get pending() {
    return this.items.length;
  }

  #persist() {
    try {
      if (this.items.length) localStorage.setItem(this.#key, JSON.stringify({ items: this.items, base: this.base }));
      else localStorage.removeItem(this.#key);
    } catch {
      /* storage full or blocked: the queue still works while the page is open */
    }
  }

  /**
   * State of a team as the scorer sees it: the server state, or with waiting plays the
   * state they start from with the plays applied.
   */
  effective(server: LiveSession, lineup: string[]): LiveSession {
    const base = this.base[server.team_id];
    const mine = this.items.filter((i) => i.teamId === server.team_id);
    if (!base) return server;
    // the server caught up (plays sent and reloaded): use it
    if (!mine.length && server.version >= base.version) return server;
    let st = { inning: base.inning, outs: base.outs, bases: [base.runner_1, base.runner_2, base.runner_3] as Bases, nextSlot: base.next_slot };
    for (const i of mine) {
      const n = applyPlay(st, lineup, i.play);
      st = { inning: Math.min(n.inning, 30), outs: n.outs, bases: n.bases, nextSlot: n.nextSlot };
    }
    return {
      ...base,
      inning: st.inning,
      outs: st.outs,
      runner_1: st.bases[0],
      runner_2: st.bases[1],
      runner_3: st.bases[2],
      next_slot: st.nextSlot,
      updated_at: mine.at(-1)?.at ?? base.updated_at
    };
  }

  /** Runs of a team in plays that did not reach the database yet. */
  pendingRuns(teamId: number | undefined): number {
    return this.items.filter((i) => i.teamId === teamId).reduce((a, i) => a + runsOn(i.play), 0);
  }

  add(current: LiveSession, lineup: string[], play: Play) {
    if (!this.base[current.team_id] || !this.items.some((i) => i.teamId === current.team_id)) {
      // first waiting play of this team starts from the state the scorer sees now
      this.base = { ...this.base, [current.team_id]: $state.snapshot(current) as LiveSession };
    }
    this.items = [
      ...this.items,
      {
        id: crypto.randomUUID(),
        teamId: current.team_id,
        play: $state.snapshot(play) as Play,
        batter: play.result ? (lineup[current.next_slot] ?? null) : null,
        at: new Date().toISOString()
      }
    ];
    this.#persist();
    this.flush();
  }

  /** Takes back the last play that has not been sent yet (false if there is none). */
  undoLast(): boolean {
    if (!this.items.length || this.status === 'sending') return false;
    this.items = this.items.slice(0, -1);
    this.#persist();
    if (!this.items.length) {
      this.status = 'idle';
      this.error = null;
    }
    return true;
  }

  /** Drops every waiting play (after a refusal). */
  discard() {
    this.items = [];
    this.base = {};
    this.status = 'idle';
    this.error = null;
    this.#persist();
    this.#onSent();
  }

  async flush() {
    if (this.#sending || !this.items.length) return;
    clearTimeout(this.#timer);
    this.#sending = true;
    this.status = 'sending';
    this.error = null;
    try {
      while (this.items.length) {
        const item = this.items[0];
        const from = this.base[item.teamId];
        if (!from) throw new Error('Chybí výchozí stav zápisu. Zahoď čekající akce a načti stránku znovu.');
        const next = await livePlayOnce(item.id, from, item.play);
        this.base = { ...this.base, [item.teamId]: next };
        this.items = this.items.slice(1);
        this.savedAt = Date.now();
        this.#persist();
      }
      this.status = 'idle';
      await this.#onSent();
      // the page has the fresh server state now
      if (!this.items.length) this.base = {};
    } catch (e) {
      if (e instanceof WriteCancelled) {
        this.status = 'error';
        this.error = 'Bez přezdívky nejde zápis uložit.';
      } else if (isNetworkError(e)) {
        this.status = 'offline';
        this.#timer = setTimeout(() => this.flush(), RETRY_MS);
      } else {
        this.status = 'error';
        this.error = errorMessage(e);
      }
    } finally {
      this.#sending = false;
    }
  }
}
