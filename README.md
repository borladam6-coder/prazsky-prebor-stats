# Pražský přebor mužů – statistiky

Komunitní web s pálkařskými statistikami Pražského přeboru mužů v softballu. Nejde o oficiální web svazu.

- **Frontend:** SvelteKit (statický web), hosting Netlify
- **Databáze:** Supabase (Postgres s Row Level Security)
- **Import:** Netlify funkce jednou za 3 dny (v noci) stáhne ze softball.cz týmy, soupisky, rozpis, výsledky a tabulku Hráče ze soupisky svazu načte jen jednou na začátku sezóny (pro každý tým, který ještě žádné hráče nemá). Potom soupisku spravuje jen web: import nikoho nepřidá, nepřejmenuje ani neskryje, protože hrát může kdokoli, kdo přijde.

## Stav

- Krok 1: databáze, zabezpečení, historie změn a import ze softball.cz.
- Krok 2: celý web – přehled s tabulkou a nejlepšími pálkaři, zápasy s box score a zápisem statistik, týmy se soupiskou, hráči s filtry, historie změn s vracením. Tmavý a světlý vzhled, mobil na prvním místě.
- Krok 3: živý zápis – pořadí pálkařů, pálkař po pálkaři, běžci na metách, outy a směny. Doběhy (R) a RBI se dopočítají samy, každou akci jde vrátit. Na přehledu a v detailu zápasu je vidět „Právě se hraje“.
- Kroky 4–7: zápis obou týmů, sledování, opravy, správce, dva režimy zápisu.
- Krok 19: hit, po kterém je pálkař out při pokusu o další metu („Out na 2.“), zůstává hitem (AB i H) a přibude out; run, který doběhl před tím, platí i při 3. outu. Když se pálkař po hitu nebo BB dostane dál, jde zapsat proč (na hod / na error), v průběhu zápasu pak „to 2nd on an error“.
- Krok 18: herní pravidla a zápis od dne zápasu.
  - Zapisovat (živě i ručně) jde celý den zápasu od půlnoci, ne až od začátku.
  - Při 3. outu, kdy je out pálkař, se běžci nabízí jen Out / Zůstal a run se nepočítá; po force outu se run nepočítá, jen při time play (běžec vyautovaný dotykem).
  - Dropped third strike: pálkař smí běžet jen při volné 1. metě nebo při 2 outech.
  - Tie-breaker: od 8. směny začíná každá polovina s posledním pálkařem na 2. metě (Zpět ho zase odebere).
  - Nový výsledek CI (catcher's interference, v Další možnosti): PA, ale ne AB.
  - Tlačítko Střídat na kartě pálkaře (pinch hitter), upozornění na podobné jméno při přidání hráče, plná sestava nového hráče jen přidá na soupisku.
  - Po 7. směně (nebo walk-off) web nabídne Ukončit zápis.
- Krok 17 (nový design) byl vrácen, web má design z kroku 16.
- Krok 16: OUT s prázdnými metami se dělí na Fly out a Ground out (jedno klepnutí), ruční zápis zase jde u týmu, jehož živý zápis byl smazaný nebo nemá žádné akce.
- Krok 15: živý zápis se po dni zápasu sám ukončí (každou noc, znovu otevřít ho pak může jen správce), oprava akcí přímo v detailu zápasu (záložka Průběh, např. hit → error, u akce je vidět „opraveno · původně 2B“), filtr zápasů Se zápisem / Jen výsledek, import ze softball.cz jednou za 3 dny.
- Krok 14: průběh zápasu jako oficiální play-by-play anglicky („Skokan Sváťa grounds into a double play to shortstop. Pevný Pavel forced out at 2nd. Skokan Sváťa out at 1st.“), souhrn každé poloviny směny (runs, hits, errors, LOB), přepínač Podrobný zápis (kam šel míček, line out / pop out, vždy jde „Neuvádět“).
- Krok 13: softballové termíny všude anglicky (double play, fly out, stolen base, runs, G/W/L/PCT v tabulce …), i v hláškách databáze.
- Krok 12: chytrý zápis outů (Out v poli → fly out / ground out / fielder’s choice / double play / sacrifice bunt; SF, SH, FC a RBI se odvodí samy), běžcům se nabízí jen možné mety a posun běžce posune i ty před ním, soupisky ze svazu jen na začátku sezóny, značka „Skóre nesedí“ u zápasů, kde zápis nesedí s výsledkem svazu.
- Krok 11: smazání nebo vrácení akce vrátí přesně stav před ní (běžci, outy, pálkař), Zpět funguje i po opravách akce, starší akce jde smazat jen „od této akce“, oprava výsledku nabízí jen výsledky, které sedí na stav na metách.
- Krok 10: sestava 9 pálkařů (přepínač „Hrajeme v 10“ pro extra hráče), krátký kód správce (aspoň 4 znaky), testovací zápas s vymyšlenými týmy pro všechny.
- Krok 9: menu bez Historie (je v patičce a v detailu zápasu), přehled na jeden pohled (živě, další zápas, poslední výsledky, top 3 pálkaři, tabulka), hledání hráčů a týmů (lupa nebo klávesa /), na telefonu tabulky jen s hlavními sloupci (přepínač Všechny statistiky), šedé obrysy při načítání, instalace jako aplikace, rychlejší start (data z minulé návštěvy hned, čerstvá chvíli poté).
- Krok 8: zápis bez signálu (akce čekají v telefonu), výsledková tlačítka dole pod palcem, rychlejší sestava (přetažení, pořadí z minulého zápasu), Další možnosti, nápověda, ruční zápis zamčený u týmu se živým zápisem.

## Živý zápis

1. V detailu zápasu (od rána dne zápasu) klikni **Zapisovat živě** a vyber režim:
   - **Zapisovat celý zápas:** zadáš sestavu hostů, pak domácích, a dáš Začít zápas. Pálka se po 3 outech střídá (hosté ▲, domácí ▼).
   - **Zapisovat jen jeden tým:** vybereš tým a klikáš jeho pálkaře, pořadí se posouvá a soupeř se nepřepíná.
2. Klepáním na hráče ze soupisky sestav pořadí pálkařů (nebo **Pořadí z minulého zápasu**), pořadí změníš přetažením za úchyt. Dej **Začít zápis**.
3. U pálkaře na řadě klepni na výsledek (na telefonu jsou tlačítka dole, podržením tlačítka se ukáže celý název). Když jsou mety prázdné, uloží se hned (u OUT se ještě vybere Fly out nebo Ground out, klepnutím se uloží). Když jsou na metách běžci, ukáže se, co se s nimi stalo. Výchozí návrh odpovídá běžnému průběhu, třeba singl posune jen vynucené běžce, takže 4 singly po sobě dají 1 bod. Stačí změnit, co bylo jinak, a dát **Uložit**.
4. Klepnutím na běžce na diamantu zapíšeš ukradenou metu, postup bez odpalu nebo out běžce.
5. **Zpět** vrátí poslední akci. **Pořadí a střídání** řeší náhradníky. V **Další možnosti** je Opravit stav (náhradní běžec, špatně zapsané outy), Ukončit zápis, Pohled diváka, Správa zápasu a nápověda.
6. V režimu celého zápasu vrací Zpět poslední akci zápasu bez ohledu na tým.

**Sestava:** standardně 9 pálkařů. Zaškrtnutím „Hrajeme v 10“ jde přidat desátého (extra hráč, EP). Víc než 10 databáze nepřijme.

**Testovací zápas** (Zápasy → Vyzkoušet živý zápis, nebo odkaz v patičce): týmy Testovací Lvi a Testovací Orli po 12 vymyšlených hráčích, zápas je otevřený kdykoli. Je ve vlastní sezóně (id −1), takže se nepočítá do tabulky, žebříčků, statistik, hledání, „Právě se hraje“ ani do celkové historie změn, a import ze softball.cz na něj nesahá. Tlačítko Vynulovat (může kdokoli) smaže vše zapsané a zápis začne znovu.

**Outy:** tlačítka 1B, 2B, 3B, HR, BB, HBP, K, OUT, ROE. OUT s prázdnými metami: dvě velká tlačítka Fly out (chycený míč) a Ground out (míč po zemi, pálkař vyautován na 1. metě), klepnutí out rovnou uloží. S běžci na metách se web zeptá, jak k outu došlo: Fly out (běžci zůstávají; run po tag-upu při méně než 2 outech = SF s RBI), Ground out (out pálkaře, forced runners postoupí), Fielder’s choice (out běžce, pálkař na metě), Double play (bez RBI), Sacrifice bunt (= SH). Oficiální výsledek se ukáže („Zapíše se: SF – Sacrifice fly“) a mění se podle toho, co nastavíš u běžců.

**Průběh zápasu (play-by-play):** každá nová akce se popíše větou jako v oficiálním zápisu: „singles to left field“, „reaches on an error by the shortstop“, „forced out at 2nd“, „doubled off 1st“, „out at 3rd after tagging up“, „steals 2nd“, „caught stealing 2nd“. Pod každou polovinou směny je souhrn runs, hits, errors (ROE) a LOB (běžci, kteří zůstali na metách po 3. outu). Akce zapsané před krokem 14 zůstávají v krátké podobě.

**Podrobný zápis** (Další možnosti → Podrobný zápis, pamatuje si ho telefon): u 1B, 2B, 3B, HR, OUT a ROE se nabídne, kam šel míček (LF, CF, RF, 3B, SS, 2B, 1B, P, C nebo **Neuvádět**), a u outu i Line out a Pop out a druh outu i při prázdných metách. V jednoduchém zápisu se nic z toho neptá a věta je kratší („Daleký Dan singles.“).

**Běžci:** nabízí se jen mety, kam se běžec mohl dostat (běžec z 1. mety při doublu: jen 3. meta, scored, nebo out). Když posuneš běžce nebo pálkaře, běžci před ním se posunou s ním.

**Skóre nesedí:** když součet runs v našem zápisu týmu nesedí s výsledkem nahlášeným svazu, zápas má značku „Skóre nesedí“ a v detailu je vidět rozdíl. Je to jen upozornění, nic se nemění.

**Bez signálu:** každá akce se nejdřív uloží v telefonu a hned se ukáže, pak se odešle. Bez signálu čeká (u poslední akce je vidět „Bez signálu · čeká N“) a odešle se sama, jakmile je připojení zpět, i po zavření a otevření stránky. Každá akce má vlastní identifikátor, takže se při opakovaném odeslání nezapíše dvakrát. Když databáze akci odmítne (např. mezitím zapsal někdo jiný), zápis se zastaví a nabídne Zkusit znovu nebo Zahodit čekající. Opravy, sestava a ukončení zápisu potřebují připojení.

**Sledovat** (z přehledu, detailu zápasu nebo výběru na stránce živého zápisu) otevře pohled jen pro diváky: skóre, směna a outy, diamant s běžci, kdo je na pálce, skóre po směnách, průběh zápasu po polovinách směn a sestavy s dnešními výsledky. Aktualizuje se sám.

**Automatické ukončení:** každou noc (po půlnoci pražského času) Netlify funkce close-live ukončí živé zápisy zápasů z předchozích dnů, ve kterých se od včerejška nic nezapsalo. V historii je to vidět jako „Živý zápis ukončen automaticky po dni zápasu“. Po dni zápasu může ukončený zápis znovu otevřít jen správce (s odemčenou Správou zápasu se na stránce živého zápisu ukáže Otevřít znovu). Testovací zápas se neukončuje.

**Opravy:** v detailu zápasu je záložka **Průběh** (u zápasů se živým zápisem) a v živém zápisu je u každé akce v Průběhu zápasu tužka. U poslední akce: Smazat akci (vše se vrátí přesně do stavu před ní, i běžci, outy a pálkař na řadě) nebo Zapsat znovu. U starší akce: Smazat od této akce (smaže ji i všechny pozdější) nebo Vrátit zápis sem. Výsledek a RBI jde opravit jen na hodnoty, které sedí na to, co se stalo na metách. Doběh jde přidat nebo odebrat v dané směně. Zpět funguje i po opravách, střídání a korekci doběhů. Opravená akce má štítek „opraveno · původně 2B“. Opravy jdou i po ukončení zápisu a po dni zápasu, zápis při nich zůstává ukončený. Všechno je v historii a dá se vrátit.

**Správce** (dole v detailu zápasu → Správa zápasu, odemyká se kódem správce): ruční konečné skóre (import ho nepřepíše) a smazání celého záznamu zápasu. Změny správce může vrátit jen správce. V databázi je jen bcrypt hash kódu (`private.settings.admin_code_hash`). Kód jde změnit přímo na webu. Při zapomenutí ho nastaví nový hash v SQL Editoru: `update private.settings set admin_code_hash = extensions.crypt('NOVYKOD', extensions.gen_salt('bf', 8));` (kód bez pomlček, velkými písmeny, aspoň 4 znaky).

Statistiky z živého zápisu jdou do stejných tabulek jako ruční zápis. Box score a sezónní statistiky jsou tedy pořád jen jedny. Tým, který má v zápase živý zápis, nejde zapisovat ručně (web i databáze to odmítnou), opravuje se v průběhu zápasu. Ruční zápis zůstává pro týmy bez živého zápisu. Ukončený živý zápis bez jediné akce (po Smazat celý záznam zápasu nebo po smazání všech akcí) se nepočítá, tým jde zase zapsat ručně.

## Struktura

```
supabase/migrations/001_init.sql   databáze: tabulky, zabezpečení, zápisové funkce, historie, statistiky
supabase/migrations/002_live.sql   živý zápis: pořadí pálkařů, stav směny, akce a jejich vracení
supabase/migrations/003_live_undo_game.sql  vracení poslední akce zápasu při zápisu obou týmů
supabase/migrations/004_admin_and_corrections.sql  opravy živého zápisu, správce (reset zápasu, ruční skóre)
supabase/migrations/014_hit_out_extra.sql  out pálkaře po hitu, důvod postupu pálkaře
supabase/migrations/013_gameday_ci_rules.sql  zápis od dne zápasu, CI, pravidla 3. outu a dropped third strike, tie-breaker
supabase/migrations/012_manual_after_reset.sql  ruční zápis znovu povolený, když živý zápis týmu nemá žádné akce
supabase/migrations/011_autofinish.sql  automatické ukončení živého zápisu po dni zápasu, znovuotevření jen správcem
supabase/migrations/010_play_details.sql  podrobnosti akcí pro play-by-play (druh, místo, běžci)
supabase/migrations/009_english_terms.sql  softballové termíny v hláškách anglicky
supabase/migrations/008_import_rosters_once.sql  soupisky ze svazu jen jako výchozí seznam
supabase/migrations/007_exact_undo.sql  vrácení akce = přesně stav před ní
supabase/migrations/006_lineup_admin_testgame.sql  sestava 9/10, krátký kód správce, testovací zápas
supabase/migrations/005_offline_and_manual_lock.sql  zápis bez signálu (akce jen jednou), zámek ručního zápisu, „out“ ve zprávách
supabase/tests/consistency.sql     kontrola konzistence (prázdný výsledek = vše v pořádku)
netlify/functions/import-league.mts plánovaný import ze softball.cz (jednou za 3 dny)
netlify/functions/close-live.mts   každou noc ukončí živé zápisy po dni zápasu
netlify/lib/softball-api.ts        stažení a očištění dat ze softball.cz
src/routes/                        stránky: přehled, zápasy, týmy, hráči, historie
src/lib/                           data, formátování, logika živého zápisu (live.ts), věty play-by-play (narrate.ts), komponenty
tests/                             automatické testy databáze a importu
static/manifest.webmanifest, static/icons/  instalace jako aplikace (ikona na ploše)
static/sw.js                       service worker: stránka jde otevřít i bez signálu, stránky vždy čerstvé ze sítě
netlify.toml                       nastavení buildu, přesměrování, bezpečnostní hlavičky
.env.example                       vzor proměnných prostředí
```

## Nasazení (jednorázově)

### 1. Supabase

1. Na [supabase.com](https://supabase.com) vytvoř **nový projekt**. Region zvol Evropu (např. Frankfurt).
2. Otevři **SQL Editor**, vlož celý obsah `supabase/migrations/001_init.sql` a dej **Run**. Má proběhnout bez chyby. Potom stejně spusť `002_live.sql`, `003_live_undo_game.sql`, `004_admin_and_corrections.sql`, `005_offline_and_manual_lock.sql`, `006_lineup_admin_testgame.sql`, `007_exact_undo.sql`, `008_import_rosters_once.sql`, `009_english_terms.sql`, `010_play_details.sql`, `011_autofinish.sql`, `012_manual_after_reset.sql`, `013_gameday_ci_rules.sql` a `014_hit_out_extra.sql`. Migrace se spouští postupně a každá jen jednou.
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
4. Po deployi otevři v Netlify sekci **Functions → import-league** a klikni **Run now**. Tím proběhne první import, další už běží samy jednou za 3 dny. Funkce **close-live** běží každou noc a ukončí živé zápisy, které zůstaly otevřené po dni zápasu.
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
