import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { sqlZwin, zwin } from "../tekst.js";
import { logEvent } from "./events.js";
import { przerobModelZOpisu } from "./identyfikatory.js";
import { rozstrzygnijPasowanie } from "./pasowania.js";
import { rozstrzygnijZastosowanie, type DaneModelu } from "./wiedza.js";

/* ── Kolejka wiedzy opróżnia się sama (0.331.0) ──────────────────────────────
   Właściciel: „wiedza powinna uzupełniać się automatycznie", a pytany o zakres
   wybrał najdalszy: cała kolejka automatycznie, człowiek tylko prostuje.

   TO JEST ODWRÓCENIE ZASADY, NIE JEJ ROZSZERZENIE, i plik ma o tym mówić
   wprost, bo inaczej następny czytelnik uzna poprzednie zdania za zapomniane.
   `wiedza.ts` niósł w nagłówku „automat może proponować, ale nie zatwierdza
   nigdy". `identyfikatory.ts` niósł „decyzją właściciela automat nie zgaduje
   marki z FS450 — model wskazuje człowiek". Oba zdania zeszły z tą zmianą.

   CO TO KOSZTUJE, powiedziane raz i bez owijania: błędne zastosowanie karmi
   czwarty szczebel doboru, więc wraca do klienta jako zła część, zanim
   ktokolwiek zajrzy na listę „co automat dopisał". Zgoda właściciela była
   świadoma i tego nie zmienia.

   CZEGO TO NIE ZNOSI. Automat nie staje się człowiekiem: `czlowiekZBiura`
   dalej strzeże gałęzi ludzkiej, a maszyna idzie własną, zostawiając parę
   `rozstrzygnal='automat (wiedza)'` z pustym `rozstrzygnal_user_id`. Po tej
   parze liczy się, ile wiedzy dopisała maszyna, i po niej stoi lista do
   prostowania. Zrównanie podpisów byłoby jedyną zmianą w tym pliku, której
   nie da się cofnąć.

   ── SKĄD AUTOMAT BIERZE MARKĘ ────────────────────────────────────────────
   Kolejka `model_z_opisu` nie czeka na ZATWIERDZENIE, tylko na ODCZYTANIE:
   w wierszu stoi goły tekst („LS 46-450", „FS450", „236; 240"), a człowiek
   dopisywał do niego markę. Cztery źródła, od najmocniejszego:

     1. tekst ZACZYNA SIĘ od marki, którą już znamy („NAC LS 46-450");
     2. sama nazwa trafia w DOKŁADNIE JEDEN znany model („FS450" → STIHL);
     3. marka stoi w nazwie kartoteki albo w tytule naszej oferty;
     4. model językowy — dopiero gdy trzy powyższe milczą.

   ── PUŁAPKA, KTÓREJ TU NIE MA, I DLACZEGO O NIEJ PISZĘ ───────────────────
   Pierwszy szkic tego pliku brał markę z parametru „Marka" NASZEJ oferty.
   To jest źródło pozornie najlepsze i całkowicie błędne: parametr niesie
   markę CZĘŚCI, nie maszyny. Wiersz listy zgodności „LS 46-450" przy naszej
   ofercie dałby wtedy model „WERTIS LS 46-450" — markę sprzedawcy sklejoną
   z nazwą cudzej kosiarki, zatwierdzoną automatycznie i wpisaną do wiedzy.
   Tytuł oferty czytamy (źródło 3), ale WYŁĄCZNIE po to, żeby znaleźć w nim
   markę, którą już znamy z zatwierdzonej wiedzy.                           */

/** Podpis maszyny. Jedno miejsce, bo po nim liczy się i prostuje. */
export const AUTOMAT = { automat: "wiedza" } as const;

/** Ile wierszy bierze jeden przebieg. Takt nie ma hamulca w kliknięciu. */
export const NA_PRZEBIEG = 25;

export interface WynikAutomatu {
  /** Wiersze `model_z_opisu`, którym automat złożył klucz. */
  zlozonych: number;
  /** Wiersze, przy których milczały wszystkie źródła — zostają człowiekowi. */
  bezMarki: number;
  /** Propozycje zastosowań podniesione do `zatwierdzone`. */
  zastosowan: number;
  /** Propozycje pasowań podniesione do `zatwierdzone`. */
  pasowan: number;
  /** Wiersze, które wywróciły się na sprawdzeniu. Przebieg leci dalej. */
  bledow: number;
}

const PUSTY: WynikAutomatu = { zlozonych: 0, bezMarki: 0, zastosowan: 0, pasowan: 0, bledow: 0 };

/* ── Etap 1: złożenie klucza ──────────────────────────────────────────────── */

/** Marki, które już przeszły przez człowieka. Automat nie wymyśla nowych. */
function znaneMarki(database: DatabaseSync): string[] {
  /* Kolejności NIE ustalamy tutaj: `markaNaPoczatku` sortuje sama, bo to jej
     warunek poprawności, a nie uprzejmość wołającego. */
  return (database.prepare("SELECT DISTINCT marka FROM model_urzadzenia ORDER BY marka")
    .all() as Array<{ marka: string }>).map((w) => w.marka);
}

/**
 * Źródło 1: tekst zaczyna się od znanej marki.
 *
 * NAJDŁUŻSZA MARKA WYGRYWA i sortowanie stoi TUTAJ, nie u wołającego.
 * Pierwsza wersja ufała kolejności listy i przy „NAC PRO 46" zwracała markę
 * „NAC" z nazwą „PRO 46" — człon marki wędrował do nazwy, a wiedza dostawała
 * model, którego nie ma. Funkcja poprawna tylko przy odpowiednio posortowanym
 * wejściu jest funkcją niepoprawną; wołający nie ma o tym wiedzieć.
 */
export function markaNaPoczatku(tekst: string, marki: string[]): DaneModelu | null {
  const t = zwin(tekst);
  for (const marka of [...marki].sort((a, b) => zwin(b).length - zwin(a).length)) {
    const m = zwin(marka);
    if (!m || !t.startsWith(m)) continue;
    const reszta = tekst.trim().slice(marka.trim().length).trim();
    if (reszta) return { rodzaj: "maszyna", marka: marka.trim(), nazwa: reszta };
  }
  return null;
}

/**
 * Źródło 2: sama nazwa trafia w DOKŁADNIE JEDEN znany model.
 *
 * „Dokładnie jeden" jest tu całą ostrożnością. `FS450` przy jednym STIHL-u
 * w bazie jest rozstrzygnięciem; przy STIHL-u i Husqvarnie naraz jest
 * zgadywaniem, a zgadywanie kończy się częścią wysłaną do złej maszyny.
 */
export function jedynyModelPoNazwie(database: DatabaseSync, tekst: string): DaneModelu | null {
  const t = zwin(tekst);
  if (!t) return null;
  const trafienia = database.prepare(
    `SELECT DISTINCT marka, nazwa, wariant, rodzaj FROM model_urzadzenia
      WHERE ${sqlZwin("nazwa")} = ?`)
    .all(t) as Array<Record<string, unknown>>;
  if (trafienia.length !== 1) return null;
  const w = trafienia[0]!;
  return {
    rodzaj: String(w.rodzaj) as "maszyna" | "silnik",
    marka: String(w.marka), nazwa: String(w.nazwa),
    wariant: w.wariant == null ? null : String(w.wariant),
  };
}

/**
 * Źródło 3: marka znana stoi w nazwie kartoteki albo w tytule naszej oferty.
 *
 * Czytamy je WYŁĄCZNIE jako miejsce, gdzie może paść znana marka — nigdy
 * jako źródło marki samo w sobie. Parametr „Marka" oferty jest tu celowo
 * nieużyty: niesie markę CZĘŚCI, nie maszyny (patrz nagłówek).
 */
export function markaZKontekstu(
  database: DatabaseSync, twId: number, ofertaId: string | null, tekst: string, marki: string[],
): DaneModelu | null {
  const t = (database.prepare("SELECT nazwa FROM sgt_towar WHERE tw_id=?").get(twId) as
    { nazwa: string } | undefined)?.nazwa ?? "";
  const o = ofertaId
    ? (database.prepare("SELECT nazwa FROM offer_snapshot WHERE external_id=? LIMIT 1").get(ofertaId) as
      { nazwa: string } | undefined)?.nazwa ?? ""
    : "";
  const korpus = zwin(`${t} ${o}`);
  if (!korpus) return null;
  /* Marka z tekstu wiersza nie może wrócić jako nazwa: „STIHL" znalezione
     w tytule i „STIHL" na początku tekstu to ten sam przypadek, a obsługuje
     go źródło 1. Tutaj interesuje nas tekst BEZ marki. */
  const kandydaci = marki.filter((m) => zwin(m) && korpus.includes(zwin(m)));
  if (kandydaci.length !== 1) return null;
  return { rodzaj: "maszyna", marka: kandydaci[0]!.trim(), nazwa: tekst.trim() };
}

/**
 * Nadawca składania klucza — źródło 4. Wstrzykiwany, jak każdy nadawca.
 *
 * Oddaje też ZUŻYCIE, bo to jedyna część automatu, która kosztuje, a księga
 * `copilot_wywolanie` jest jedynym miejscem, gdzie rachunek u dostawcy da się
 * później porównać z naszym. `model: null` znaczy „nie wiem" i jest
 * odpowiedzią, nie awarią.
 */
export interface OdpowiedzKlucza {
  model: DaneModelu | null;
  zuzycie: { wej: number; wyj: number; cacheZapis: number; cacheOdczyt: number };
  ms: number;
}
export type NadawcaKlucza = (
  tekst: string, kontekst: { kartoteka: string; oferta: string | null; marki: string[] },
) => Promise<OdpowiedzKlucza>;

export interface Deps {
  database?: DatabaseSync;
  naPrzebieg?: number;
  /** Brak nadawcy = same źródła deterministyczne. Tak chodzą testy. */
  nadajKlucz?: NadawcaKlucza;
}

/**
 * Złożenie klucza dla jednego wiersza. `null` znaczy „wszystkie źródła
 * milczą" — wiersz zostaje w kolejce dla człowieka, bo pusty klucz byłby
 * gorszy od braku klucza.
 */
export async function zlozKlucz(
  database: DatabaseSync, w: { id: number; twId: number; tekst: string; ofertaId: string | null },
  marki: string[], nadaj?: NadawcaKlucza,
): Promise<{ model: DaneModelu; skad: string } | null> {
  const z1 = markaNaPoczatku(w.tekst, marki);
  if (z1) return { model: z1, skad: "marka na początku tekstu" };
  const z2 = jedynyModelPoNazwie(database, w.tekst);
  if (z2) return { model: z2, skad: "jedyny znany model o tej nazwie" };
  const z3 = markaZKontekstu(database, w.twId, w.ofertaId, w.tekst, marki);
  if (z3) return { model: z3, skad: "marka z nazwy kartoteki albo tytułu oferty" };
  if (!nadaj) return null;

  const kartoteka = (database.prepare("SELECT nazwa FROM sgt_towar WHERE tw_id=?").get(w.twId) as
    { nazwa: string } | undefined)?.nazwa ?? "";
  const oferta = w.ofertaId
    ? (database.prepare("SELECT nazwa FROM offer_snapshot WHERE external_id=? LIMIT 1").get(w.ofertaId) as
      { nazwa: string } | undefined)?.nazwa ?? null
    : null;
  const odp = await nadaj(w.tekst, { kartoteka, oferta, marki });
  zapiszWywolanieKlucza(database, odp);
  const m = odp.model;
  if (!m) return null;
  /* SPRAWDZENIE DETERMINISTYCZNE, tak samo jak przy danych doboru ze szkicu.
     Model wolno wskazać markę, ale nie wolno jej WYMYŚLIĆ: musi stać w tekście
     wiersza, w nazwie kartoteki, w tytule oferty albo wśród marek, które już
     przeszły przez człowieka. Bez tego sita źródło 4 dopisywałoby do wiedzy
     marki, których w firmie nie ma. */
  const korpus = zwin(`${w.tekst} ${kartoteka} ${oferta ?? ""}`);
  const znana = marki.some((x) => zwin(x) === zwin(m.marka));
  if (!znana && !korpus.includes(zwin(m.marka))) return null;
  if (!zwin(m.nazwa) || !korpus.includes(zwin(m.nazwa))) return null;
  return { model: m, skad: "model językowy" };
}

/**
 * Wywołanie modelu do księgi — także to, które oddało „nie wiem".
 *
 * Nieudane kosztuje tyle samo co udane i musi stać w rachunku; ta sama
 * reguła, którą sufit godzinowy automatycznych szkiców liczy od 0.317.0.
 * `conversation_id` zostaje puste: kolejka wiedzy nie wisi na rozmowie.
 */
function zapiszWywolanieKlucza(database: DatabaseSync, odp: OdpowiedzKlucza): void {
  database.prepare(`INSERT INTO copilot_wywolanie
    (zadanie,model,tokeny_wej,tokeny_wyj,tokeny_cache_zapis,tokeny_cache_odczyt,ms,wynik,przez_user_id,at)
    VALUES ('klucz_modelu','',?,?,?,?,?,?,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(odp.zuzycie.wej, odp.zuzycie.wyj, odp.zuzycie.cacheZapis,
      odp.zuzycie.cacheOdczyt, odp.ms, odp.model ? "ok" : "niepewny");
}

/* ── Przebieg ─────────────────────────────────────────────────────────────── */

/**
 * Jeden przebieg automatu: najpierw klucze, potem rozstrzygnięcia.
 *
 * KOLEJNOŚĆ MA ZNACZENIE. Klucz złożony w tym przebiegu rodzi propozycję,
 * którą ten sam przebieg zaraz zatwierdza — inaczej wiersz czekałby do
 * następnego taktu na drugą połowę własnej drogi.
 *
 * Potknięcie na jednym wierszu NIE przerywa przebiegu. Para już w kolejce,
 * kartoteka zniknięta po imporcie, wyścig z człowiekiem — każde z tych
 * kończy się `WiedzaConflict`, który dotyczy TEGO wiersza, nie kolejki.
 */
export async function oproznijKolejke(deps: Deps = {}): Promise<WynikAutomatu> {
  const database = deps.database ?? db();
  const limit = Math.max(1, deps.naPrzebieg ?? NA_PRZEBIEG);
  const w: WynikAutomatu = { ...PUSTY };
  const marki = znaneMarki(database);

  const wiersze = database.prepare(
    `SELECT id, tw_id, tekst, oferta_id FROM model_z_opisu
      WHERE stan='nowy' ORDER BY id LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  for (const r of wiersze) {
    const wiersz = {
      id: Number(r.id), twId: Number(r.tw_id), tekst: String(r.tekst),
      ofertaId: r.oferta_id == null ? null : String(r.oferta_id),
    };
    let klucz: Awaited<ReturnType<typeof zlozKlucz>>;
    try {
      klucz = await zlozKlucz(database, wiersz, marki, deps.nadajKlucz);
    } catch {
      w.bledow += 1;
      continue;
    }
    if (!klucz) { w.bezMarki += 1; continue; }
    try {
      przerobModelZOpisu(wiersz.id, klucz.model, AUTOMAT, database);
      w.zlozonych += 1;
    } catch {
      /* Powodu nie logujemy przy wierszu: najczęstszy to „ta para już czeka
         w kolejce", czyli stan zastany, nie awaria. Liczba wystarcza. */
      w.bledow += 1;
    }
  }

  for (const r of database.prepare(
    `SELECT id FROM zastosowanie WHERE stan='propozycja' ORDER BY id LIMIT ?`)
    .all(limit) as Array<{ id: number }>) {
    try {
      rozstrzygnijZastosowanie(Number(r.id), "zatwierdz", null, AUTOMAT, database);
      w.zastosowan += 1;
    } catch {
      /* Najczęstszy powód to propozycja bez dowodu — serwis wymaga choć
         jednego i ten warunek zostaje także dla maszyny. */
      w.bledow += 1;
    }
  }

  for (const r of database.prepare(
    `SELECT id FROM pasowanie_czesci WHERE stan='propozycja' ORDER BY id LIMIT ?`)
    .all(limit) as Array<{ id: number }>) {
    try {
      rozstrzygnijPasowanie(Number(r.id), "zatwierdz", null, AUTOMAT, database);
      w.pasowan += 1;
    } catch {
      w.bledow += 1;
    }
  }

  /* Ładunek niesie LICZBY, nigdy treści wierszy (§19). Zdarzenie idzie także
     przy pustym przebiegu, bo „automat chodził i nie miał co robić" to inna
     informacja niż „automat nie chodził". */
  logEvent("wiedza_automat_przebieg", "automat", null, { ...w }, null, database);
  return w;
}

/* ── Co automat dopisał ───────────────────────────────────────────────────── */

export interface WpisAutomatu {
  rodzaj: "zastosowanie" | "pasowanie";
  id: number;
  symbol: string;
  etykieta: string;
  at: string;
}

/**
 * Lista do PROSTOWANIA — to jest druga połowa decyzji właściciela i bez niej
 * pierwsza jest nie do przyjęcia. Automat zatwierdza, człowiek ogląda i cofa
 * (`wycofajZastosowanie`, `wycofajPasowanie`, obie już istnieją).
 *
 * Czysty ODCZYT. Rozpoznanie po parze `rozstrzygnal_user_id IS NULL` przy
 * niepustym `rozstrzygnal` — to jest ten znacznik z nagłówka, jedyny, po
 * którym wpis maszyny odróżnia się od wpisu człowieka.
 */
export function coAutomatDopisal(limit = 100, database: DatabaseSync = db()): WpisAutomatu[] {
  const ile = Math.max(1, Math.min(500, limit));
  const zastosowania = database.prepare(
    `SELECT z.id, z.tw_symbol AS symbol, z.rozstrzygnieto_at AS at,
            m.marka, m.nazwa, m.wariant
       FROM zastosowanie z JOIN model_urzadzenia m ON m.id = z.model_id
      WHERE z.stan='zatwierdzone' AND z.rozstrzygnal_user_id IS NULL AND z.rozstrzygnal IS NOT NULL
      ORDER BY z.rozstrzygnieto_at DESC, z.id DESC LIMIT ?`)
    .all(ile) as Array<Record<string, unknown>>;
  const pasowania = database.prepare(
    `SELECT p.id, p.tw_symbol AS symbol, p.rozstrzygnieto_at AS at, p.do_tw_symbol AS doCzego
       FROM pasowanie_czesci p
      WHERE p.stan='zatwierdzone' AND p.rozstrzygnal_user_id IS NULL AND p.rozstrzygnal IS NOT NULL
      ORDER BY p.rozstrzygnieto_at DESC, p.id DESC LIMIT ?`)
    .all(ile) as Array<Record<string, unknown>>;

  return [
    ...zastosowania.map((w) => ({
      rodzaj: "zastosowanie" as const, id: Number(w.id), symbol: String(w.symbol),
      etykieta: [w.marka, w.nazwa, w.wariant].filter(Boolean).join(" "),
      at: String(w.at ?? ""),
    })),
    ...pasowania.map((w) => ({
      rodzaj: "pasowanie" as const, id: Number(w.id), symbol: String(w.symbol),
      etykieta: `pasuje do ${String(w.doCzego ?? "")}`,
      at: String(w.at ?? ""),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ile);
}
