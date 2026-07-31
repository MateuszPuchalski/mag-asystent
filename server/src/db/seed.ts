import fs from "node:fs";
import { db, nowIso, transaction } from "./db.js";
import { config } from "../config.js";

/**
 * Zasila read-model sgt_* prawdziwymi danymi z server/seed/products.json
 * (eksport magmat.xlsx:
 *  [symbol,nazwa,ean,mag,rez,mgp,unit,ordered,lokalizacja,opis,dostawca]).
 *
 * Dodatkowo syntetyzuje dokumenty FZ/PZ (eksport to płaski stan, bez dokumentów
 * przyjęć), aby moduł rozkładania miał realną zawartość: pozycjami są towary
 * z bieżącym stanem na MGP (fizycznie czekają na rozłożenie), POGRUPOWANE po
 * prawdziwym dostawcy z eksportu — jeden dostawca = jeden dokument dostawy.
 * Dodatkowo kilka pozycji bez lokalizacji trafia do dokumentów (ścieżka BRAK LOK).
 *
 * Magazyn skutku dokumentu rozstrzyga, który tryb go obsługuje, i celowo daje
 * dane obu ścieżkom: krajowe FZ/PZ na MAG (tryb A — sam adres), jeden kontener
 * na MGP (tryb B — sesja z wózkiem i MM).
 */

type Row = [
  string, string, string, number, number, number,
  string, number, string, string, string,
];

const DOSTAWCA_FALLBACK = "Dostawca nieznany";

/* Magazyny demo bez roli. Identyfikatory z góry zakresu, żeby nie zderzyć się
   z MAG_ID_* nawet po ich przestawieniu w konfiguracji — seed nie ma prawa
   nadpisać magazynu, któremu ktoś właśnie nadał rolę. */
const MAG_SERWIS = 91;
const MAG_EKSPOZYCJA = 92;
const MAG_ARCHIWUM = 93;

function seed() {
  const d = db();
  const already = (d.prepare("SELECT COUNT(*) AS n FROM sgt_towar").get() as { n: number }).n;
  if (already > 0 && process.env.FORCE_SEED !== "1") {
    console.log(`[seed] sgt_towar ma już ${already} rekordów — pomijam (FORCE_SEED=1 aby nadpisać).`);
    return;
  }

  const rows: Row[] = JSON.parse(fs.readFileSync(config.seedProducts, "utf8"));
  console.log(`[seed] wczytano ${rows.length} kartotek z ${config.seedProducts}`);

  const wipe = transaction(d, () => {
    /* Pozycje przed nagłówkami — trzyma je klucz obcy. */
    for (const t of [
      "sgt_zam_pozycja", "sgt_zamowienie",
      "sgt_pozycja", "sgt_dokument", "sgt_stan", "sgt_towar", "sgt_magazyn",
    ]) {
      d.prepare(`DELETE FROM ${t}`).run();
    }
  });
  wipe();

  const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  insMag.run(config.magId.MAG, "MAG", "Magazyn główny");
  insMag.run(config.magId.MGP, "MGP", "Strefa przyjęć");
  insMag.run(config.magId.ZWROTY, "ZWROTY", "Zwroty od klientów");
  /* Magazyny BEZ ROLI — po to, żeby tryb demo w ogóle pokazywał zestawienie
     „gdzie ten towar jeszcze leży" i sekcję ukrywania w ustawieniach. Bez nich
     ta funkcja byłaby niewidoczna aż do podłączenia prawdziwego Subiekta. */
  const DEMO_MAGAZYNY: Array<[number, string, string]> = [
    [MAG_SERWIS, "SERWIS", "Serwis i reklamacje"],
    [MAG_EKSPOZYCJA, "EKSPO", "Ekspozycja / salon"],
    [MAG_ARCHIWUM, "ARCH", "Magazyn sezonowy"],
  ];
  for (const [id, kod, nazwa] of DEMO_MAGAZYNY) insMag.run(id, kod, nazwa);

  const insTowar = d.prepare(
    `INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja)
     VALUES (@tw_id,@symbol,@nazwa,@ean,@unit,@opis,@lokalizacja)`
  );
  const insStan = d.prepare(
    "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)"
  );

  const mgpProducts: Array<{ tw_id: number; mgp: number; dostawca: string }> = [];
  const noLocProducts: number[] = [];
  /* Kolumna `ordered` z eksportu NIE idzie już do sgt_towar. Do 0.7.0 leżała
     tam jako gotowa liczba, ale importer produkcyjny nie miał jej skąd wziąć
     (w Subiekcie „zamówione" pochodzi z dokumentów ZD, nie z kartoteki)
     i wpisywał zero — czyli demo pokazywało coś, czego produkcja nie umiała.
     Ta sama liczba zasila teraz syntetyczne zamówienia, więc obie ścieżki
     chodzą tym samym torem. */
  const zamowione: Array<{ tw_id: number; ilosc: number; dostawca: string }> = [];

  const insertAll = transaction(d, (data: Row[]) => {
    data.forEach((r, i) => {
      const tw_id = i + 1;
      const [symbol, nazwa, ean, mag, rez, mgp, unit, ordered, lokalizacja, opis, dostawca] = r;
      insTowar.run({
        tw_id, symbol, nazwa, ean: ean || "", unit: unit || "szt.",
        opis: opis || "", lokalizacja: lokalizacja || "",
      });
      if (ordered > 0) {
        zamowione.push({ tw_id, ilosc: ordered, dostawca: dostawca || DOSTAWCA_FALLBACK });
      }
      insStan.run(tw_id, config.magId.MAG, mag || 0, rez || 0);
      insStan.run(tw_id, config.magId.MGP, mgp || 0, 0);
      /* Co ósma kartoteka leży też w serwisie, co jedenasta na ekspozycji —
         rozrzedzone celowo, żeby sekcja „pozostałe magazyny" pojawiała się
         czasem, a nie na każdym towarze. Magazyn sezonowy zostaje PUSTY:
         zerowe stany też mają być widoczne i trzeba je na czymś sprawdzić. */
      if (tw_id % 8 === 0) insStan.run(tw_id, MAG_SERWIS, (tw_id % 5) + 1, 0);
      if (tw_id % 11 === 0) insStan.run(tw_id, MAG_EKSPOZYCJA, 1, 0);
      if (mgp > 0) mgpProducts.push({ tw_id, mgp, dostawca: dostawca || DOSTAWCA_FALLBACK });
      else if (!lokalizacja) noLocProducts.push(tw_id);
    });
  });
  insertAll(rows);
  console.log(`[seed] towary=${rows.length}, na MGP=${mgpProducts.length}, bez lokalizacji=${noLocProducts.length}`);

  // ── syntetyczne dokumenty FZ/PZ (deterministyczne, bez losowości) ────────
  const insDok = d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?,?,?,?,?,?,?)`
  );
  /* `ob_id` rośnie GLOBALNIE, przez wszystkie dokumenty — tak samo jak klucz
     pozycji w Subiekcie, który jest identyfikatorem wiersza w całej tabeli,
     a nie numerem porządkowym w obrębie faktury. Seed, który numerowałby od
     nowa w każdym dokumencie, uczyłby kodu fałszywej własności. */
  let obId = 0;
  const insPozRaw = d.prepare(
    "INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc, ob_id) VALUES (?,?,?,?)"
  );
  const insPoz = (dokId: number, twId: number, ilosc: number) =>
    insPozRaw.run(dokId, twId, ilosc, ++obId);

  // grupowanie towarów z MGP po prawdziwym dostawcy; duże grupy (np. własne
  // przyjęcia WERTIS) dzielimy na kilka mniejszych, dających się rozłożyć
  // dokumentów — jak realne, rozłożone w czasie dostawy (spec §5.4).
  const MAX_POZ = 20; // maks. pozycji na dokument
  const byDostawca = new Map<string, Array<{ tw_id: number; mgp: number }>>();
  for (const p of mgpProducts) {
    const g = byDostawca.get(p.dostawca) ?? [];
    g.push({ tw_id: p.tw_id, mgp: p.mgp });
    byDostawca.set(p.dostawca, g);
  }
  // paczki (dostawca, pozycje) — deterministycznie: dostawcy alfabetycznie
  const paczki: Array<{ dostawca: string; items: Array<{ tw_id: number; mgp: number }> }> = [];
  for (const dostawca of [...byDostawca.keys()].sort()) {
    const items = byDostawca.get(dostawca)!;
    for (let i = 0; i < items.length; i += MAX_POZ) {
      paczki.push({ dostawca, items: items.slice(i, i + MAX_POZ) });
    }
  }
  /* Data bazowa liczona od DZISIAJ, nie zapisana na sztywno.
     Wcześniej stało tu `new Date("2026-07-16")`, a lista dostaw pokazuje okno
     14 dni — więc demo się STARZAŁO: dwa tygodnie po tej dacie `npm run seed`
     dawał bazę, w której zakładka rozkładania jest pusta. Przy pokazie
     u klienta wygląda to jak zepsuta aplikacja, a nie jak stare dane. */
  const dzis = new Date();
  const baseDate = new Date(Date.UTC(dzis.getUTCFullYear(), dzis.getUTCMonth(), dzis.getUTCDate()));
  const mmrrrr = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

  const buildDocs = transaction(d, () => {
    paczki.forEach((paczka, k) => {
      const dok_id = k + 1;
      const typ = k % 2 === 0 ? "FZ" : "PZ";
      const dataDok = new Date(baseDate.getTime() - k * 86400_000);
      const nr = `${typ} ${120 + k}/${mmrrrr(dataDok)}`;
      const date = dataDok.toISOString().slice(0, 10);
      // ostatni dokument w buforze → dokument w buforze jest normalnie do pracy (D1)
      const wBuforze = k === paczki.length - 1 ? 1 : 0;
      // Magazyn skutku decyduje o trybie rozkładania (i tylko on — dokument nie
      // może wisieć w obu zakładkach naraz). Krajowe FZ/PZ księgują się wprost
      // na MAG → tryb A, sam adres. Jeden dokument zostaje na MGP jako kontener
      // importowy → tryb B, sesja z wózkiem i realnym MM MGP→MAG.
      const kontener = k === 1;
      insDok.run(
        dok_id,
        typ,
        nr,
        date,
        kontener ? config.magId.MGP : config.magId.MAG,
        paczka.dostawca,
        wBuforze
      );

      for (const p of paczka.items) insPoz(dok_id, p.tw_id, p.mgp);

      // dorzuć 2 nowe SKU bez lokalizacji (ścieżka BRAK LOK, §5.4 pkt 4)
      for (const twId of noLocProducts.slice(k * 2, k * 2 + 2)) {
        insPoz(dok_id, twId, 12);
      }

      /* TEN SAM TOWAR W DRUGIM WIERSZU — pierwszy dokument dostaje duplikat.
         W Subiekcie zdarza się to normalnie: dwie ceny, dwie partie, dwa
         wiersze. Dla magazyniera to nadal jedna paleta, więc `openDelivery`
         skleja je w jedną linię roboczą — ale opis różnic biuro trzyma PRZY
         POZYCJI, więc linia musi pamiętać OBA identyfikatory.

         Bez tego przypadku w demo ścieżka, dla której powstała kolumna
         `sgt_pozycje`, nie miałaby ani jednego przebiegu. */
      if (k === 0 && paczka.items.length) {
        insPoz(dok_id, paczka.items[0].tw_id, 3);
      }
    });
  });
  buildDocs();

  // ── stan na magazynie Zwroty ─────────────────────────────────────────────
  // Zwroty przyjmuje i rozlicza biuro w Subiekcie — aplikacja nie ma tam nic do
  // roboty (rozkładanie koszykami wypadło w 0.17.0). Stan zasiewamy mimo to,
  // bo karta towaru odpowiada na pytanie „gdzie jeszcze leży" i magazyn Zwroty
  // jest jedną z możliwych odpowiedzi.
  const zwrotItems: Array<{ tw_id: number; qty: number }> = [];
  rows.forEach((r, i) => {
    const mag = r[3];
    const lokalizacja = r[8];
    if (zwrotItems.length < 7 && mag > 0 && lokalizacja) {
      zwrotItems.push({ tw_id: i + 1, qty: (zwrotItems.length % 3) + 1 });
    }
  });
  if (noLocProducts.length) zwrotItems.push({ tw_id: noLocProducts[0], qty: 2 });

  if (zwrotItems.length) {
    const buildZwrot = transaction(d, () => {
      const insZwStan = d.prepare(
        "INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,0) ON CONFLICT(tw_id, mag_id) DO UPDATE SET stan = stan + excluded.stan"
      );
      for (const it of zwrotItems) insZwStan.run(it.tw_id, config.magId.ZWROTY, it.qty);
    });
    buildZwrot();
    console.log(`[seed] stan na magazynie Zwroty: kartotek=${zwrotItems.length}`);
  }

  // ── syntetyczne zamówienia do dostawcy (ZD) ─────────────────────────────
  // Jeden dostawca = jedno zamówienie, tak jak przy dostawach wyżej. Wariantów
  // celowo kilka, bo karta ma je rozróżniać: część zamówień jest w połowie
  // zrealizowana, część nie ma terminu (baza go nie udostępnia), a jedno ma
  // termin już przeterminowany — dostawca się spóźnia i to widać.
  if (zamowione.length) {
    const insZam = d.prepare(
      `INSERT INTO sgt_zamowienie(dok_id, nr_pelny, data_wyst, termin, dostawca, status)
       VALUES (?,?,?,?,?,?)`
    );
    const insZamPoz = d.prepare(
      "INSERT INTO sgt_zam_pozycja(dok_id, tw_id, ilosc, zreal) VALUES (?,?,?,?)"
    );
    const zamByDostawca = new Map<string, Array<{ tw_id: number; ilosc: number }>>();
    for (const z of zamowione) {
      const g = zamByDostawca.get(z.dostawca) ?? [];
      g.push({ tw_id: z.tw_id, ilosc: z.ilosc });
      zamByDostawca.set(z.dostawca, g);
    }
    const buildZam = transaction(d, () => {
      let dokId = 1;
      let pozycji = 0;
      for (const dostawca of [...zamByDostawca.keys()].sort()) {
        const items = zamByDostawca.get(dostawca)!;
        for (let i = 0; i < items.length; i += MAX_POZ, dokId++) {
          // −7 dni na dokument: zamówienia są starsze niż dostawy i rozjeżdżają
          // się w czasie, więc sortowanie po terminie ma co porządkować
          const dataZam = new Date(baseDate.getTime() - dokId * 7 * 86400_000);
          const terminDni = (dokId % 4) * 10 - 5; // −5, +5, +15, +25 od dziś
          const termin =
            dokId % 5 === 0
              ? null // co piąte bez terminu — ścieżka „nie wiem kiedy"
              : new Date(baseDate.getTime() + terminDni * 86400_000).toISOString().slice(0, 10);
          insZam.run(
            dokId,
            `ZD ${40 + dokId}/${mmrrrr(dataZam)}`,
            dataZam.toISOString().slice(0, 10),
            termin,
            dostawca,
            5
          );
          for (const it of items.slice(i, i + MAX_POZ)) {
            // co trzecia pozycja częściowo dostarczona — karta ma pokazać
            // POZOSTAŁO, a nie pierwotnie zamówione
            const zreal = it.tw_id % 3 === 0 ? Math.floor(it.ilosc / 2) : 0;
            insZamPoz.run(dokId, it.tw_id, it.ilosc, zreal);
            pozycji++;
          }
        }
      }
      console.log(`[seed] zamówienia ZD: ${dokId - 1}, pozycji=${pozycji}`);
    });
    buildZam();
  }

  const docs = d.prepare("SELECT dok_id, nr_pelny, w_buforze FROM sgt_dokument").all();
  console.log(`[seed] dokumenty FZ/PZ:`, docs);
  console.log(`[seed] gotowe (${nowIso()}).`);
}

seed();
