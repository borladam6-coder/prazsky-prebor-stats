<script lang="ts">
  // Play-by-play grouped by half-inning (newest first). With `onedit` every play gets
  // an edit button (live scoring page); without it the log is read-only (watch page).
  import { fly } from 'svelte/transition';
  import { league } from '../league.svelte.ts';
  import { resultDef } from '../stats.ts';
  import { plural } from '../format.ts';
  import { byHalfInning, type PlayItem } from '../plays.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

  let {
    plays,
    awayTeamId,
    onedit = undefined
  }: {
    plays: PlayItem[];
    awayTeamId: number | undefined;
    onedit?: (p: PlayItem) => void;
  } = $props();

  const halves = $derived(byHalfInning(plays));
  const name = (pid: string | null) => league.player(pid)?.name ?? '?';
  const short = (pid: string | null) => name(pid).split(' ')[0];
</script>

{#if halves.length === 0}
  <p class="empty">Zatím žádné akce.</p>
{:else}
  {#each halves as h (h.key)}
    {@const t = league.team(h.teamId)}
    <div class="half" style:--team={t?.color}>
      <header>
        <span class="hn">{h.inning}. směna {h.teamId === awayTeamId ? '▲' : '▼'}</span>
        <span class="ht"><TeamBadge team={t} size={18} /> {t?.short_name ?? ''}</span>
        {#if h.runs}<span class="pill {h.runs > 0 ? 'pos' : 'neg'}">{h.runs > 0 ? '+' : '−'}{Math.abs(h.runs)} {plural(Math.abs(h.runs), ['bod', 'body', 'bodů'])}</span>{/if}
      </header>
      <ol>
        {#each h.plays as p (p.id)}
          <li class:adjust={p.kind === 'adjust'} class:gone={p.paDeleted} in:fly={{ y: -8, duration: 220 }}>
            {#if p.kind === 'adjust'}
              <span class="chip g-fix">OPR</span>
              <span class="desc">
                <strong>Oprava doběhů</strong>
                <span class="extra">
                  {#if p.scored.length}<span class="sc">+1 doběh: {p.scored.map(short).join(', ')}</span>{/if}
                  {#if p.removed.length}<span class="out">−1 doběh: {p.removed.map(short).join(', ')}</span>{/if}
                </span>
              </span>
            {:else}
              <span class="chip g-{p.result ? resultDef(p.result)?.group : 'run'}">{p.result ?? 'SB'}</span>
              <span class="desc">
                {#if p.result}
                  <span><strong>{name(p.batter)}</strong> <span class="muted">{resultDef(p.result)?.label}</span></span>
                {:else}
                  <strong>Pohyb běžců</strong>
                {/if}
                <span class="extra">
                  {#if p.edited}<span class="tag">upraveno</span>{/if}
                  {#if p.paDeleted}<span class="tag">zápis smazán</span>{/if}
                  {#if p.stole.length}<span>ukradená meta: {p.stole.map(short).join(', ')}</span>{/if}
                  {#if p.scored.length}<span class="sc">doběh: {p.scored.map(short).join(', ')}</span>{/if}
                  {#if p.rbi}<span>{p.rbi} RBI</span>{/if}
                  {#if p.inningEnded}<span class="end">3. aut, konec poloviny</span>{:else if p.outs}<span class="out">{p.outs === 1 ? `${p.outsAfter}. aut` : `${p.outs} auty (${p.outsAfter} celkem)`}</span>{/if}
                </span>
              </span>
            {/if}
            <span class="right">
              {#if p.runs}<span class="plus" class:minus={p.runs < 0}>{p.runs > 0 ? '+' : '−'}{Math.abs(p.runs)}</span>{/if}
              {#if onedit}
                <button type="button" class="edit" aria-label="Upravit akci" onclick={() => onedit(p)}><Icon name="pencil" size={16} /></button>
              {/if}
            </span>
          </li>
        {/each}
      </ol>
    </div>
  {/each}
{/if}

<style>
  .half {
    margin-bottom: 12px;
    border-radius: var(--r-l);
    background: var(--surface);
    border: 1px solid var(--line);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--team) 18%, transparent), transparent 70%);
    border-bottom: 1px solid var(--line);
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
    padding: 4px 0;
  }
  li {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 9px 10px 9px 14px;
  }
  li + li {
    border-top: 1px dashed var(--line);
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
    background: var(--pos-soft);
    color: var(--pos);
  }
  .g-onbase {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .g-run {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent-text);
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
    color: var(--pos);
    font-weight: 700;
  }
  .out {
    color: var(--neg);
    font-weight: 600;
  }
  .end {
    color: var(--neg);
    font-weight: 800;
  }
  .tag {
    color: var(--accent-text);
    font-weight: 700;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .plus {
    font-weight: 800;
    font-size: 18px;
    color: var(--pos);
  }
  .plus.minus {
    color: var(--neg);
  }
  .edit {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
  }
  .edit:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }
</style>
