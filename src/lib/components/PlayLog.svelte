<script lang="ts">
  // Play-by-play grouped by half-inning (newest first). With `onedit` the whole row of a
  // play opens its corrections; without it the log is read-only (watch page).
  // `limit` shows only the newest plays (live scoring); the half-inning totals stay complete.
  // `sticky` keeps the half-inning header under the site header while scrolling.
  import { fly } from 'svelte/transition';
  import { league } from '../league.svelte.ts';
  import { resultDef } from '../stats.ts';
  import { plural } from '../format.ts';
  import { byHalfInning, type PlayItem } from '../plays.ts';
  import { narrate, halfSummary } from '../narrate.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

  let {
    plays,
    awayTeamId,
    onedit = undefined,
    limit = undefined,
    sticky = false
  }: {
    plays: PlayItem[];
    awayTeamId: number | undefined;
    onedit?: (p: PlayItem) => void;
    limit?: number;
    sticky?: boolean;
  } = $props();

  const halves = $derived.by(() => {
    const all = byHalfInning(plays).map((h) => ({ ...h, all: h.plays }));
    if (!limit) return all;
    let left = limit;
    const out: typeof all = [];
    for (const h of all) {
      if (left <= 0) break;
      out.push({ ...h, plays: h.plays.slice(0, left) });
      left -= h.plays.length;
    }
    return out;
  });
  const name = (pid: string | null) => league.player(pid)?.name ?? '?';
  const short = (pid: string | null) => name(pid).split(' ')[0];
  const summary = (plays: PlayItem[]) => halfSummary([...plays].reverse());
</script>

{#if halves.length === 0}
  <p class="empty">Zatím žádné akce.</p>
{:else}
  {#each halves as h (h.key)}
    {@const t = league.team(h.teamId)}
    {@const sum = summary(h.all)}
    <div class="half" style:--team={t?.color}>
      <header class:sticky>
        <span class="hn">{h.inning}. směna {h.teamId === awayTeamId ? '▲' : '▼'}</span>
        <span class="ht"><TeamBadge team={t} size={18} /> {t?.short_name ?? ''}</span>
        {#if h.runs}<span class="pill {h.runs > 0 ? 'pos' : 'neg'}">{h.runs > 0 ? '+' : '−'}{Math.abs(h.runs)} {plural(Math.abs(h.runs), ['run', 'runs', 'runs'])}</span>{/if}
      </header>
      <ol>
        {#each h.plays as p (p.id)}
          <li class:adjust={p.kind === 'adjust'} class:gone={p.paDeleted} in:fly={{ y: -8, duration: 220 }}>
            <svelte:element
              this={onedit ? 'button' : 'div'}
              class="row"
              type={onedit ? 'button' : undefined}
              aria-label={onedit ? 'Upravit akci' : undefined}
              onclick={onedit ? () => onedit(p) : undefined}
              role={onedit ? undefined : 'group'}
            >
            {#if p.kind === 'adjust'}
              <span class="chip g-fix">OPR</span>
              <span class="desc">
                <strong>Oprava runs</strong>
                <span class="extra">
                  {#if p.scored.length}<span class="sc">+1 run: {p.scored.map(short).join(', ')}</span>{/if}
                  {#if p.removed.length}<span class="out">−1 run: {p.removed.map(short).join(', ')}</span>{/if}
                </span>
              </span>
            {:else}
              <span class="chip g-{p.result ? resultDef(p.result)?.group : 'run'}">{p.result ?? (p.stole.length ? 'SB' : 'RUN')}</span>
              <span class="desc">
                {#if p.detail && !p.paDeleted}
                  <span class="story">{narrate(p.detail, p.result, name)}</span>
                {:else if p.result}
                  <span><strong>{name(p.batter)}</strong> <span class="muted">{resultDef(p.result)?.label}</span></span>
                {:else}
                  <strong>Pohyb běžců</strong>
                {/if}
                <span class="extra">
                  {#if p.edited}<span class="tag"><Icon name="history" size={13} /> opraveno · původně {p.recordedResult !== p.result ? p.recordedResult : `${p.recordedRbi} RBI`}</span>{/if}
                  {#if p.paDeleted}<span class="tag">zápis smazán</span>{/if}
                  {#if !p.detail && p.stole.length}<span>stolen base: {p.stole.map(short).join(', ')}</span>{/if}
                  {#if !p.detail && p.scored.length}<span class="sc">run: {p.scored.map(short).join(', ')}</span>{/if}
                  {#if p.rbi}<span>{p.rbi} RBI</span>{/if}
                  {#if p.inningEnded}<span class="end">3. out, konec poloviny</span>{:else if p.outs}<span class="out">{p.outs === 1 ? `${p.outsAfter}. out` : `double play (${p.outsAfter}. out)`}</span>{/if}
                </span>
              </span>
            {/if}
            <span class="right">
              {#if p.runs}<span class="plus num-c" class:minus={p.runs < 0}>{p.runs > 0 ? '+' : '−'}{Math.abs(p.runs)}</span>{/if}
              {#if onedit}<span class="edit" aria-hidden="true"><Icon name="chevron" size={16} /></span>{/if}
            </span>
            </svelte:element>
          </li>
        {/each}
      </ol>
      <footer class="sum" aria-label="Souhrn poloviny směny">
        <span><strong>{sum.runs}</strong> {sum.runs === 1 ? 'run' : 'runs'}</span>
        <span><strong>{sum.hits}</strong> {sum.hits === 1 ? 'hit' : 'hits'}</span>
        <span><strong>{sum.errors}</strong> {sum.errors === 1 ? 'error' : 'errors'}</span>
        {#if sum.lob !== null}<span><strong>{sum.lob}</strong> LOB</span>{/if}
      </footer>
    </div>
  {/each}
{/if}

<style>
  .half {
    margin-bottom: 12px;
    border-radius: var(--r-l);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--r-l) var(--r-l) 0 0;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--team) 18%, transparent), transparent 70%),
      var(--surface);
    border-bottom: 1px solid var(--line);
  }
  header.sticky {
    position: sticky;
    top: var(--header-h, 0px);
    z-index: 2;
  }
  .hn {
    font-weight: 800;
  }
  .ht {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: var(--muted);
    margin-right: auto;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 2px 0;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    width: 100%;
    padding: 10px 10px 10px 14px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
    transition: background-color 140ms;
  }
  button.row:hover,
  button.row:focus-visible {
    background: var(--surface-2);
  }
  li:last-child button.row {
    border-radius: 0 0 var(--r-l) var(--r-l);
  }
  li.gone .desc strong {
    text-decoration: line-through;
    color: var(--muted);
  }
  .chip {
    display: inline-grid;
    place-items: center;
    min-width: 40px;
    padding: 5px 6px;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 800;
    background: var(--surface-3);
    color: var(--muted);
  }
  .g-hit {
    background: var(--hit-soft);
    color: var(--hit);
  }
  .g-onbase {
    background: var(--onbase-soft);
    color: var(--onbase);
  }
  .g-out {
    background: var(--out-soft);
    color: var(--out);
  }
  .g-run {
    background: var(--surface-3);
    color: var(--ink);
  }
  .g-fix {
    background: transparent;
    border: 1px dashed var(--line-strong);
    font-size: 11px;
  }
  .desc {
    display: grid;
    gap: 3px;
    min-width: 0;
    font-size: 14.5px;
  }
  .desc .muted {
    font-size: 13px;
    margin-left: 4px;
  }
  .story {
    font-weight: 600;
    line-height: 1.4;
  }
  .sum {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    padding: 8px 14px 10px;
    border-top: 1px solid var(--line);
    border-radius: 0 0 var(--r-l) var(--r-l);
    background: var(--surface-2);
    font-size: 12.5px;
    color: var(--muted);
  }
  .sum strong {
    color: var(--ink);
    font-weight: 800;
  }
  .extra {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .extra:empty {
    display: none;
  }
  .sc {
    color: var(--hit);
    font-weight: 700;
  }
  .out {
    color: var(--out);
    font-weight: 600;
  }
  .end {
    color: var(--out);
    font-weight: 800;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    font-weight: 700;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 4px;
    align-self: center;
  }
  .plus {
    font-weight: 800;
    font-size: 19px;
    color: var(--hit);
  }
  .plus.minus {
    color: var(--out);
  }
  .edit {
    display: grid;
    place-items: center;
    color: var(--faint);
  }
</style>
