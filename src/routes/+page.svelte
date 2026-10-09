<script lang="ts">
  // Temporary status page for step 1: verifies the database connection and the import.
  // It is replaced by the real home page in the next step.
  import { supabase, configProblem } from '#lib/supabase.ts';

  interface Team {
    id: number;
    name: string;
    code: string;
    color: string;
  }
  interface Status {
    season: { name: string; year: number; imported_at: string | null } | null;
    teams: (Team & { players: number })[];
    games: number;
    played: number;
    plateAppearances: number;
  }

  const problems: Record<string, string> = {
    missing: 'Chybí proměnné PUBLIC_SUPABASE_URL a PUBLIC_SUPABASE_PUBLISHABLE_KEY v nastavení Netlify.',
    'bad-url': 'PUBLIC_SUPABASE_URL nemá tvar https://projekt.supabase.co (bez lomítka a cesty na konci).',
    'secret-key': 'V PUBLIC_SUPABASE_PUBLISHABLE_KEY je tajný klíč (sb_secret_…). Ten do prohlížeče nepatří, použij publishable key.'
  };

  async function load(): Promise<Status> {
    if (!supabase) throw new Error(problems[configProblem ?? 'missing']);
    const { data: season, error: e1 } = await supabase
      .from('seasons')
      .select('id, name, year, imported_at')
      .eq('is_current', true)
      .maybeSingle();
    if (e1) throw e1;
    if (!season) return { season: null, teams: [], games: 0, played: 0, plateAppearances: 0 };

    const [teams, players, games, pas] = await Promise.all([
      supabase.from('season_teams').select('teams(id, name, code, color)').eq('season_id', season.id),
      supabase.from('players').select('team_id').eq('season_id', season.id).eq('active', true),
      supabase.from('games').select('status').eq('season_id', season.id),
      supabase.from('plate_appearances').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    ]);
    for (const r of [teams, players, games, pas]) if (r.error) throw r.error;

    const perTeam = new Map<number, number>();
    for (const p of players.data ?? []) perTeam.set(p.team_id, (perTeam.get(p.team_id) ?? 0) + 1);

    const teamList = (teams.data ?? [])
      .map((r) => r.teams as unknown as Team)
      .filter(Boolean)
      .map((t) => ({ ...t, players: perTeam.get(t.id) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'));

    return {
      season,
      teams: teamList,
      games: games.data?.length ?? 0,
      played: (games.data ?? []).filter((g) => g.status === 'played').length,
      plateAppearances: pas.count ?? 0
    };
  }

  const status = load();

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' })
      : 'zatím neproběhl';
</script>

<svelte:head>
  <title>Pražský přebor mužů – statistiky</title>
</svelte:head>

<main>
  <p class="kicker">Komunitní statistiky</p>
  <h1>Pražský přebor mužů</h1>
  <p class="lead">Web se připravuje. Tahle stránka ověřuje propojení s databází a import ze softball.cz.</p>

  {#await status}
    <p class="muted">Načítám…</p>
  {:then s}
    {#if !s.season}
      <div class="card warn">
        Databáze je připojená, ale import ještě neproběhl. V Netlify spusť funkci <b>import-league</b> tlačítkem „Run now“.
      </div>
    {:else}
      <div class="card ok">
        <b>{s.season.name} {s.season.year}</b>
        <span class="muted">· poslední import: {fmt(s.season.imported_at)}</span>
      </div>
      <dl class="stats">
        <div><dt>Týmy</dt><dd>{s.teams.length}</dd></div>
        <div><dt>Zápasy</dt><dd>{s.played}<small>/{s.games}</small></dd></div>
        <div><dt>Hráči</dt><dd>{s.teams.reduce((a, t) => a + t.players, 0)}</dd></div>
        <div><dt>Zapsané PA</dt><dd>{s.plateAppearances}</dd></div>
      </dl>
      <ul class="teams">
        {#each s.teams as t (t.id)}
          <li style:--team={t.color}>
            <span class="dot"></span>
            <span class="name">{t.name}</span>
            <span class="muted">{t.code} · {t.players} hráčů</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:catch err}
    <div class="card error">
      <b>Nepodařilo se načíst data.</b><br />
      {err?.message ?? String(err)}
    </div>
  {/await}
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 16px 64px;
  }
  .kicker {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 {
    margin: 6px 0 8px;
    font-size: clamp(30px, 7vw, 44px);
    line-height: 1.05;
    letter-spacing: -0.02em;
  }
  .lead {
    margin: 0 0 28px;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .card {
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-left-width: 4px;
    border-radius: 10px;
    background: var(--surface);
    margin-bottom: 16px;
    line-height: 1.5;
  }
  .card.ok {
    border-left-color: var(--ok);
  }
  .card.warn {
    border-left-color: #ffc53d;
  }
  .card.error {
    border-left-color: var(--danger);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0 0 16px;
  }
  .stats div {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px;
  }
  dt {
    font-size: 12px;
    color: var(--muted);
  }
  dd {
    margin: 4px 0 0;
    font-size: 24px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  dd small {
    font-size: 14px;
    color: var(--muted);
    font-weight: 500;
  }
  .teams {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .teams li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  .teams li:last-child {
    border-bottom: none;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--team);
    flex-shrink: 0;
  }
  .name {
    font-weight: 600;
    flex: 1;
  }
  @media (max-width: 520px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
