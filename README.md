# Pražský přebor mužů – statistiky

Komunitní web s pálkařskými statistikami Pražského přeboru mužů v softballu. Nejde o oficiální web svazu.

- **Frontend:** SvelteKit (statický web), hosting Netlify
- **Databáze:** Supabase (Postgres s Row Level Security)
- **Import:** Netlify funkce každých 6 hodin stáhne ze softball.cz týmy, soupisky, rozpis, výsledky a tabulku

## Stav

Krok 1 je hotový: databáze, zabezpečení, historie změn a import. Web zatím ukazuje jen kontrolní stránku, která ověřuje připojení a import. Plný web přijde v dalším kroku.

## Struktura

```
supabase/migrations/001_init.sql   databáze: tabulky, zabezpečení, zápisové funkce, historie, statistiky
supabase/tests/consistency.sql     kontrola konzistence (prázdný výsledek = vše v pořádku)
netlify/functions/import-league.mts plánovaný import ze softball.cz
netlify/lib/softball-api.ts        stažení a očištění dat ze softball.cz
src/                               web (SvelteKit)
tests/                             automatické testy databáze a importu
netlify.toml                       nastavení buildu, přesměrování, bezpečnostní hlavičky
.env.example                       vzor proměnných prostředí
```

## Nasazení (jednorázově)

### 1. Supabase

1. Na [supabase.com](https://supabase.com) vytvoř **nový projekt**. Region zvol Evropu (např. Frankfurt).
2. Otevři **SQL Editor**, vlož celý obsah `supabase/migrations/001_init.sql` a dej **Run**. Má proběhnout bez chyby.
3. Pro další kroky si připrav tyto údaje:
   - **Project URL**: tlačítko **Connect** v projektu, má tvar `https://xxxx.supabase.co`
   - **Publishable key**: **Settings → API Keys**, začíná `sb_publishable_`
   - **Secret key**: tamtéž, začíná `sb_secret_`. Nikomu ho neposílej a nikam ho nevkládej kromě Netlify.

### 2. GitHub

Vytvoř prázdný repozitář (např. `prazsky-prebor-stats`) a nahraj do něj tyhle soubory. Případně mi dej přístup a nahraju je tam sám.

### 3. Netlify

1. **Add new project → Import an existing project → GitHub** a vyber repozitář. Nastavení buildu se načte z `netlify.toml`, nic neměň.
2. Před prvním deployem přidej v **Environment variables** tyto proměnné:

| Proměnná | Hodnota |
|---|---|
| `PUBLIC_SUPABASE_URL` | Project URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `SUPABASE_URL` | Project URL (stejná hodnota) |
| `SUPABASE_SECRET_KEY` | Secret key |
| `SEASON_YEAR` | `2026` |

   Pokud Netlify nabídne volbu „Contains secret values“, zaškrtni ji **jen** u `SUPABASE_SECRET_KEY`. U URL ne, protože je veřejně vidět v kódu webu a Netlify by build zastavil.

3. Spusť **Deploy**.
4. Po deployi otevři v Netlify sekci **Functions → import-league** a klikni **Run now**. Tím proběhne první import, další už běží samy každých 6 hodin.
5. Otevři web. Kontrolní stránka má ukázat 10 týmů, zápasy a hráče.

## Kontrola konzistence

V Supabase → SQL Editor spusť obsah `supabase/tests/consistency.sql`. Prázdný výsledek znamená, že všechny součty sedí.

## Nová sezóna

V Netlify změň `SEASON_YEAR` (např. na `2027`) a spusť import. Nová sezóna se stane aktuální a stará zůstane v databázi beze změny.

## Bezpečnost

- Prohlížeč má jen publishable key a smí jen **číst**.
- Každý zápis jde přes databázové funkce, které:
  - kontrolují vstup (výsledek, RBI, hráč patří do zápasu, zápas je odehraný)
  - omezují počet změn: 150 za 10 minut na zařízení nebo IP adresu
  - zapisují historii (kdo, kdy, co)
- Nic se nemaže natvrdo. Smazání je jen označení a každou změnu lze vrátit.
- IP adresy se ukládají jen jako zahashované a po 24 hodinách se mažou.
- Z webu svazu se ukládá jen jméno hráče, číslo dresu a tým. Data narození, adresy klubů, účty ani jména rozhodčích se neukládají.

## Vývoj

```
npm install
cp .env.example .env      # doplnit hodnoty
npm run dev               # web na localhost
npm test                  # testy databáze a importu (bez připojení k internetu)
npm run check             # typová kontrola webu
npm run check:server      # typová kontrola importu a testů
```
