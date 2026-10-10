# Pražský přebor mužů – statistiky

Komunitní web s pálkařskými statistikami Pražského přeboru mužů v softballu. Nejde o oficiální web svazu.

- **Frontend:** SvelteKit (statický web), hosting Netlify
- **Databáze:** Supabase (Postgres s Row Level Security)
- **Import:** Netlify funkce každých 6 hodin stáhne ze softball.cz týmy, soupisky, rozpis, výsledky a tabulku

## Stav

- Krok 1: databáze, zabezpečení, historie změn a import ze softball.cz.
- Krok 2: celý web – přehled s tabulkou a nejlepšími pálkaři, zápasy s box score a zápisem statistik, týmy se soupiskou, hráči s filtry, historie změn s vracením. Tmavý a světlý vzhled, mobil na prvním místě.
- Krok 3: živý zápis – pořadí pálkařů, pálkař po pálkaři, běžci na metách, auty a směny. Doběhy (R) a RBI se dopočítají samy, každou akci jde vrátit. Na přehledu a v detailu zápasu je vidět „Právě se hraje“.

## Živý zápis

1. V detailu zápasu (nejdřív 2 hodiny před začátkem) klikni **Zapisovat živě** a vyber režim:
   - **Zapisovat celý zápas:** zadáš sestavu hostů, pak domácích, a dáš Začít zápas. Pálka se po 3 outech střídá (hosté ▲, domácí ▼).
   - **Zapisovat jen jeden tým:** vybereš tým a klikáš jeho pálkaře, pořadí se posouvá a soupeř se nepřepíná.
2. Klepáním na hráče ze soupisky sestav pořadí pálkařů a dej **Začít zápis**.
3. U pálkaře na řadě klepni na výsledek. Když jsou mety prázdné, uloží se hned. Když jsou na metách běžci, ukáže se, co se s nimi stalo. Výchozí návrh odpovídá běžnému průběhu, třeba singl posune jen vynucené běžce, takže 4 singly po sobě dají 1 bod. Stačí změnit, co bylo jinak, a dát **Uložit**.
4. Klepnutím na běžce na diamantu zapíšeš ukradenou metu, postup bez odpalu nebo aut běžce.
5. **Zpět** vrátí poslední akci. **Pořadí a střídání** a **Opravit stav** řeší náhradníky, náhradní běžce nebo špatně zapsané auty.
6. V režimu celého zápasu vrací Zpět poslední akci zápasu bez ohledu na tým.

**Sledovat** (z přehledu, detailu zápasu nebo výběru na stránce živého zápisu) otevře pohled jen pro diváky: skóre, směna a auty, diamant s běžci, kdo je na pálce, skóre po směnách, průběh zápasu po polovinách směn a sestavy s dnešními výsledky. Aktualizuje se sám.

**Opravy:** v živém zápisu je u každé akce v Průběhu zápasu tužka. Jde opravit výsledek a RBI, přidat nebo odebrat doběh v té směně, akci smazat nebo vrátit celý zápis k ní. Všechno je v historii a dá se vrátit.

**Správce** (dole v detailu zápasu → Správa zápasu, odemyká se kódem správce): ruční konečné skóre (import ho nepřepíše) a smazání celého záznamu zápasu. Změny správce může vrátit jen správce. V databázi je jen bcrypt hash kódu (`private.settings.admin_code_hash`). Kód jde změnit přímo na webu. Při zapomenutí ho nastaví nový hash v SQL Editoru: `update private.settings set admin_code_hash = extensions.crypt('NOVYKOD', extensions.gen_salt('bf', 8));` (kód bez pomlček, velkými písmeny).

Statistiky z živého zápisu jdou do stejných tabulek jako ruční zápis. Box score a sezónní statistiky jsou tedy pořád jen jedny.

## Struktura

```
supabase/migrations/001_init.sql   databáze: tabulky, zabezpečení, zápisové funkce, historie, statistiky
supabase/migrations/002_live.sql   živý zápis: pořadí pálkařů, stav směny, akce a jejich vracení
supabase/migrations/003_live_undo_game.sql  vracení poslední akce zápasu při zápisu obou týmů
supabase/migrations/004_admin_and_corrections.sql  opravy živého zápisu, správce (reset zápasu, ruční skóre)
supabase/tests/consistency.sql     kontrola konzistence (prázdný výsledek = vše v pořádku)
netlify/functions/import-league.mts plánovaný import ze softball.cz
netlify/lib/softball-api.ts        stažení a očištění dat ze softball.cz
src/routes/                        stránky: přehled, zápasy, týmy, hráči, historie
src/lib/                           data, formátování, logika živého zápisu (live.ts), komponenty
tests/                             automatické testy databáze a importu
netlify.toml                       nastavení buildu, přesměrování, bezpečnostní hlavičky
.env.example                       vzor proměnných prostředí
```

## Nasazení (jednorázově)

### 1. Supabase

1. Na [supabase.com](https://supabase.com) vytvoř **nový projekt**. Region zvol Evropu (např. Frankfurt).
2. Otevři **SQL Editor**, vlož celý obsah `supabase/migrations/001_init.sql` a dej **Run**. Má proběhnout bez chyby. Potom stejně spusť `002_live.sql`, `003_live_undo_game.sql` a `004_admin_and_corrections.sql`. Migrace se spouští postupně a každá jen jednou.
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

   Volbu „Contains secret values“ zaškrtni **jen** u `SUPABASE_SECRET_KEY`. Při importu z .env platí pro všechny vkládané proměnné najednou, proto secret key přidej zvlášť (Add a single variable). Kdyby byly jako tajné označené i ostatní, Netlify najde jejich hodnoty v kódu webu a build zastaví.

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
npm test                  # testy databáze, importu a živého zápisu (bez připojení k internetu)
npm run check             # typová kontrola webu
npm run check:server      # typová kontrola importu a testů
```
