import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { naLike, sqlZwin, zwin } from "../tekst.js";
import {
  WiedzaConflict, czlowiekZBiura, naModel, podpis, rozstrzygnijZastosowanie, upewnijModel, wTransakcji,
  zaproponujZastosowanie,
} from "./wiedza.js";
import type { Autor, DaneModelu, ModelUrzadzenia } from "./wiedza.js";

/**
 * Tokeny silników w NAZWACH kartotek (§12, 0.239.0).
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Szczebel „przez silnik" (0.229.0) ma tyle paliwa, ile zastosowań
 * część→silnik biuro wpisało ręcznie. Tymczasem ~3400 nazw kartotek mówi
 * wprost: „Gaźnik do silników HONDA GX160", „Filtr powietrza Briggs & Stratton
 * 450E". Token w nazwie to najpewniejsze i najtańsze źródło pasowań do
 * silników, jakie firma ma u siebie — zapowiedź z 0.230.0.
 *
 * ── CO ROBI CZŁOWIEK, A CO AUTOMAT ────────────────────────────────────────
 * Człowiek wpisuje: „GX160" = silnik Honda GX160 (automat nie zgaduje marki
 * z tokenu — 0.186.0, „Modele:"). Automat dopasowuje token do nazw DOKŁADNIE
 * po `zwin` (podłańcuch, bez furtki na literówki) i układa listę. Człowiek
 * przegląda listę, odznacza, co nie pasuje, i klika: zaznaczone dostają
 * ZATWIERDZONE zastosowanie, odznaczone idą do pominiętych i nie wracają
 * po imporcie. Decyzja właściciela z 9.09.2026: jedno kliknięcie na token,
 * nie trzydzieści w kolejce.
 *
 * Propozycję i rozstrzygnięcie robi TEN SAM człowiek w jednej transakcji.
 * Wolno: „zatwierdza każdy z biura, także autor propozycji". Nowe jest tylko
 * to, że oba zapisy idą naraz — ślad jest pełny: `zaproponowal` =
 * `rozstrzygnal` = człowiek, źródło `opis`, dowód `decyzja_biura` z tokenem
 * i nazwą kartoteki.
 *
 * Tylko NAZWA, nigdy opis: opis bywa notatką magazynu i mówi też „nie pasuje
 * do GX160". Nazwa jest tym, co firma sama napisała o części.
 *
 * Ten plik importuje `wiedza.ts` i nigdy odwrotnie — jak `silniki.ts`.
 */

export type StanKartotekiTokenu = "nowa" | "zatwierdzona" | "pominieta";

export interface KartotekaTokenu {
  twId: number;
  symbol: string;
  nazwa: string | null;
  stan: StanKartotekiTokenu;
  zastosowanieId: number | null;
}

export interface TokenSilnika {
  id: number;
  /** Tak, jak wpisało biuro — etykieta; dopasowanie idzie po `zwin`. */
  token: string;
  silnik: ModelUrzadzenia;
  dodal: string;
  dodanoAt: string;
  nowych: number;
  zatwierdzonych: number;
  pominietych: number;
  /** Kartoteki do decyzji — najwyżej 200, jak lista „Z opisów". */
  nowe: KartotekaTokenu[];
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const SELECT_TOKEN = `
  SELECT k.id, k.token, k.dodal, k.dodano_at,
         si.id s_id, si.rodzaj s_rodzaj, si.marka s_marka, si.nazwa s_nazwa,
         si.wariant s_wariant, si.lata s_lata, si.klucz s_klucz
    FROM token_silnika k JOIN model_urzadzenia si ON si.id = k.silnik_id`;

const silnikZWiersza = (w: Record<string, unknown>) => naModel({
  id: w.s_id, rodzaj: w.s_rodzaj, marka: w.s_marka, nazwa: w.s_nazwa,
  wariant: w.s_wariant, lata: w.s_lata, klucz: w.s_klucz,
});

/* Nazwa zwinięta po stronie SQL kosztuje ~20 ms na przebieg po 3400
   kartotekach (pomiar w `tekst.ts`). To cena raz przy dodaniu tokenu i raz
   po imporcie — nigdy przy odczycie, bo dopasowania leżą w tabeli. */
const GDZIE_NAZWA = `${sqlZwin("nazwa")} LIKE ? ESCAPE '\\'`;
const wzorzec = (norm: string) => `%${naLike(norm)}%`;

/**
 * Przebudowa dopasowań: `INSERT OR IGNORE` po `(token_id, tw_id)` chroni
 * `zatwierdzona` i `pominieta`; `nowa`, której nazwa przestała pasować albo
 * kartoteka zniknęła z read-modelu, schodzi. Jeden token (po dodaniu) albo
 * wszystkie (po imporcie, `po-imporcie.ts`).
 */
export function przebudujTokenySilnikow(
  database: DatabaseSync = db(), tokenId?: number,
): { tokenow: number; nowych: number; ms: number } {
  const start = Date.now();
  const tokeny = database.prepare(tokenId == null
    ? "SELECT id, token_norm FROM token_silnika"
    : "SELECT id, token_norm FROM token_silnika WHERE id=?")
    .all(...(tokenId == null ? [] : [tokenId])) as Array<{ id: number; token_norm: string }>;
  let nowych = 0;
  /* `wTransakcji`, nie `transaction`: przebudowę woła `dodajToken` z wnętrza
     własnej transakcji, a `node:sqlite` nie zagnieżdża BEGIN. */
  wTransakcji(database, () => {
    const ins = database.prepare(`INSERT OR IGNORE INTO token_silnika_kartoteka(token_id,tw_id,tw_symbol)
      SELECT ?, tw_id, symbol FROM sgt_towar WHERE ${GDZIE_NAZWA}`);
    const del = database.prepare(`DELETE FROM token_silnika_kartoteka WHERE token_id=? AND stan='nowa'
      AND tw_id NOT IN (SELECT tw_id FROM sgt_towar WHERE ${GDZIE_NAZWA})`);
    for (const t of tokeny) {
      nowych += Number(ins.run(t.id, wzorzec(t.token_norm)).changes);
      del.run(t.id, wzorzec(t.token_norm));
    }
  });
  return { tokenow: tokeny.length, nowych, ms: Date.now() - start };
}

/** Słownik z licznikami i listą kartotek do decyzji — jeden odczyt, zero zapisu. */
export function listaTokenow(database: DatabaseSync = db()): { tokeny: TokenSilnika[]; nowychRazem: number } {
  const liczniki = database.prepare(`SELECT token_id,
      SUM(stan='nowa') nowych, SUM(stan='zatwierdzona') zatwierdzonych, SUM(stan='pominieta') pominietych
    FROM token_silnika_kartoteka GROUP BY token_id`).all() as Array<Record<string, number>>;
  const nowe = database.prepare(`SELECT k.token_id, k.tw_id, k.tw_symbol, k.stan, k.zastosowanie_id, t.nazwa
      FROM token_silnika_kartoteka k LEFT JOIN sgt_towar t ON t.tw_id = k.tw_id
     WHERE k.stan='nowa' ORDER BY k.tw_symbol`).all() as Array<Record<string, unknown>>;
  const tokeny = (database.prepare(`${SELECT_TOKEN} ORDER BY k.token COLLATE NOCASE, k.id`)
    .all() as Array<Record<string, unknown>>).map((w) => {
      const id = Number(w.id);
      const l = liczniki.find((x) => Number(x.token_id) === id);
      return {
        id, token: String(w.token), silnik: silnikZWiersza(w), dodal: String(w.dodal), dodanoAt: String(w.dodano_at),
        nowych: Number(l?.nowych ?? 0), zatwierdzonych: Number(l?.zatwierdzonych ?? 0),
        pominietych: Number(l?.pominietych ?? 0),
        nowe: nowe.filter((n) => Number(n.token_id) === id).slice(0, 200).map((n) => ({
          twId: Number(n.tw_id), symbol: String(n.tw_symbol), nazwa: n.nazwa == null ? null : String(n.nazwa),
          stan: String(n.stan) as StanKartotekiTokenu,
          zastosowanieId: n.zastosowanie_id == null ? null : Number(n.zastosowanie_id),
        })),
      };
    });
  return { tokeny, nowychRazem: tokeny.reduce((s, t) => s + t.nowych, 0) };
}

/**
 * Token wpisuje CZŁOWIEK z biura. Krótszy niż trzy znaki po zwinięciu łapie
 * pół katalogu, więc nie wchodzi. Dubel to `WiedzaConflict` (409) ze
 * wskazaniem, do którego silnika token już prowadzi.
 */
export function dodajToken(
  p: { token: string; silnik: DaneModelu }, autor: Autor, database: DatabaseSync = db(),
): TokenSilnika {
  const token = oczysc(p.token);
  if (!token) throw new Error("Token wymaga tekstu — tego, co stoi w nazwach kartotek, np. GX160");
  const norm = zwin(token);
  if (norm.length < 3) throw new Error("Token krótszy niż trzy znaki łapałby pół katalogu");
  if (p.silnik?.rodzaj !== "silnik") throw new Error("Token wskazuje SILNIK, nie maszynę");
  if (!("automat" in autor)) czlowiekZBiura(database, autor.userId);
  const kto = podpis(autor);
  const id = wTransakcji(database, () => {
    const jest = database.prepare(`${SELECT_TOKEN} WHERE k.token_norm=?`).get(norm) as Record<string, unknown> | undefined;
    if (jest) {
      throw new WiedzaConflict(`„${String(jest.token)}” już jest w słowniku i prowadzi do ${silnikZWiersza(jest).etykieta}`,
        { tokenId: Number(jest.id), silnik: silnikZWiersza(jest) });
    }
    const silnik = upewnijModel(p.silnik, autor, database);
    const nowy = Number(database.prepare(`INSERT INTO token_silnika(token,token_norm,silnik_id,dodal,dodal_user_id)
      VALUES (?,?,?,?,?)`).run(token, norm, silnik.id, kto.name, kto.userId).lastInsertRowid);
    const p2 = przebudujTokenySilnikow(database, nowy);
    logEvent("token_silnika_dodany", kto.name, null, { tokenId: nowy, token, silnik: silnik.klucz, dopasowan: p2.nowych },
      kto.userId, database);
    return nowy;
  });
  return listaTokenow(database).tokeny.find((t) => t.id === id)!;
}

/**
 * Usunięcie tokenu zabiera pary (CASCADE), ale NIE zastosowania: to fakty
 * z dowodem, które cofa się osobno przez wycofanie z powodem.
 */
export function usunToken(id: number, userId: number, database: DatabaseSync = db()): void {
  const autor = czlowiekZBiura(database, userId);
  const w = database.prepare(`${SELECT_TOKEN} WHERE k.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!w) throw new Error("Nie znaleziono tokenu");
  database.prepare("DELETE FROM token_silnika WHERE id=?").run(id);
  logEvent("token_silnika_usuniety", autor, null, { tokenId: id, token: String(w.token) }, userId, database);
}

/**
 * Jedno kliknięcie na przejrzaną listę. `zatwierdz`: zastosowanie do silnika
 * tokenu ze źródłem `opis` i dowodem `decyzja_biura`, od razu zatwierdzone
 * przez tego samego człowieka (jedna transakcja: pół listy w bazie i pół
 * w powietrzu to stan, którego nikt nie chce). Gdy para kartoteka–silnik już
 * stoi w bazie, wiersz podpina istniejące zastosowanie. `pomin`: wiersz
 * schodzi na `pominieta` i nie wraca po imporcie. Obce id — błąd, nie cisza.
 */
export function rozstrzygnijToken(
  id: number, decyzja: { zatwierdz: number[]; pomin: number[] }, userId: number, database: DatabaseSync = db(),
): { zatwierdzonych: number; juzBylo: number; pominietych: number } {
  const autor = czlowiekZBiura(database, userId);
  const zatwierdz = [...new Set((decyzja.zatwierdz ?? []).map(Number))];
  const pomin = [...new Set((decyzja.pomin ?? []).map(Number))].filter((t) => !zatwierdz.includes(t));
  if (zatwierdz.length + pomin.length === 0) throw new Error("Nie wskazano żadnej kartoteki");
  return wTransakcji(database, () => {
    const w = database.prepare(`${SELECT_TOKEN} WHERE k.id=?`).get(id) as Record<string, unknown> | undefined;
    if (!w) throw new Error("Nie znaleziono tokenu");
    const token = String(w.token);
    const silnik = silnikZWiersza(w);
    const nowe = new Map((database.prepare(`SELECT k.tw_id, k.tw_symbol, t.nazwa
        FROM token_silnika_kartoteka k LEFT JOIN sgt_towar t ON t.tw_id = k.tw_id
       WHERE k.token_id=? AND k.stan='nowa'`).all(id) as Array<{ tw_id: number; tw_symbol: string; nazwa: string | null }>)
      .map((r) => [Number(r.tw_id), r]));
    const obce = [...zatwierdz, ...pomin].filter((t) => !nowe.has(t));
    if (obce.length) throw new Error(`Kartoteki ${obce.join(", ")} nie czekają na decyzję przy tym tokenie`);

    const podpisz = database.prepare(`UPDATE token_silnika_kartoteka SET stan=?, zastosowanie_id=?,
      rozstrzygnal=?, rozstrzygnal_user_id=?, rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE token_id=? AND tw_id=?`);
    let zatwierdzonych = 0; let juzBylo = 0;
    for (const twId of zatwierdz) {
      const k = nowe.get(twId)!;
      const z = zaproponujZastosowanie({
        twId, model: { rodzaj: "silnik", marka: silnik.marka, nazwa: silnik.nazwa, wariant: silnik.wariant },
        polaryzacja: "pasuje", zrodlo: "opis", komentarz: `token „${token}” w nazwie`,
        dowod: { rodzaj: "decyzja_biura",
          tresc: `token „${token}” w nazwie kartoteki „${k.nazwa ?? k.tw_symbol}”, zatwierdzone z listy tokenów` },
      }, { userId, name: autor }, database);
      let zastosowanieId: number;
      if (z) {
        rozstrzygnijZastosowanie(z.id, "zatwierdz", null, userId, database);
        zastosowanieId = z.id; zatwierdzonych += 1;
      } else {
        /* Para już stoi (inną drogą) — dopasowanie wskazuje ją, nie dubluje. */
        const jest = database.prepare(`SELECT z.id FROM zastosowanie z JOIN model_urzadzenia m ON m.id=z.model_id
          WHERE z.tw_id=? AND m.klucz=? AND z.polaryzacja='pasuje' AND z.stan IN ('propozycja','zatwierdzone')
          ORDER BY z.id DESC LIMIT 1`).get(twId, silnik.klucz) as { id: number };
        zastosowanieId = jest.id; juzBylo += 1;
      }
      podpisz.run("zatwierdzona", zastosowanieId, autor, userId, id, twId);
    }
    for (const twId of pomin) podpisz.run("pominieta", null, autor, userId, id, twId);
    logEvent("token_silnika_rozstrzygniecie", autor, null,
      { tokenId: id, token, zatwierdzonych, juzBylo, pominietych: pomin.length }, userId, database);
    return { zatwierdzonych, juzBylo, pominietych: pomin.length };
  });
}
