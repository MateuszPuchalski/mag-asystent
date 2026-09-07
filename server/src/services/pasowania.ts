import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  DOWODY_TECHNICZNE, NAZWA_DOWODU, POWODY_NEGATYWNE, RODZAJE_DOWODU, WiedzaConflict, ZDANIE_POWODU,
  czlowiekZBiura, dzien, podpis, wTransakcji,
} from "./wiedza.js";
import type { Autor, PewnoscZastosowania, Polaryzacja, PowodNegatywny, RodzajDowodu, StanZastosowania } from "./wiedza.js";
import { podzielZamienniki } from "./zamienniki.js";
import { kartotekaPoSku } from "./dopasowanie-sku.js";

/**
 * Pasowanie części: uszczelka pasuje DO gaźnika (§11.2).
 *
 * ── PO CO ─────────────────────────────────────────────────────────────────
 * Klienci pytają „czy ta uszczelka pasuje do tego gaźnika" — także o membrany,
 * zestawy naprawcze i łączniki kolektora. Do tego serwisu relacji część↔część
 * nie było wcale: `zastosowanie` wiąże część z modelem, `zabudowa_silnika`
 * model z modelem, a zamiennik jest liczony z tekstu opisu i nigdzie nie
 * zapisany.
 *
 * ── HIERARCHIA PLIKÓW ─────────────────────────────────────────────────────
 * Importuje `wiedza.ts`, `zamienniki.ts` i `dopasowanie-sku.ts`; NIGDY
 * `dobor.ts` ani `kandydaci.ts` — tamte importują ten. Jak `silniki.ts`.
 *
 * ── PRZECHODNIOŚĆ PRZEZ ZAMIENNIKI — PRZY ODCZYCIE, NIGDY W TABELI ────────
 * Ta sama uszczelka stoi pod kilkoma symbolami od różnych dostawców
 * (`LC170430140-0001` ≡ `06-12038` ≡ `W53-0201`), a ten sam gaźnik też
 * (`W09-0211` ≡ `EX055`). Wpis „X pasuje do Y" ma więc obowiązywać także dla
 * zamienników X i zamienników Y — inaczej biuro wpisywałoby każdą parę
 * kilkanaście razy. Liczymy to PRZY ODCZYCIE, bo zamiennik jest efemeryczny
 * (parser opisu, bez tabeli): gdy import zmieni opis, wniosek zmienia się
 * w tej samej sekundzie. Głębokość JEDEN, kierunek TEGO opisu (doktryna
 * `zamienniki.ts`: jeśli B wymienia A, a A nie wymienia B — przy odczycie A
 * nic), a wniosek nigdy nie jest `potwierdzone`: „zamiennik" gaźnika bywa
 * produktem nadrzędnym (gaźnik z zestawem serwisowym) i pozycja uszczelki może
 * się w nim różnić.
 */

export const ROLE_PASOWANIA = ["uszczelka", "membrana", "zestaw_naprawczy", "lacznik", "element_zestawu", "inne"] as const;
export type RolaPasowania = (typeof ROLE_PASOWANIA)[number];
export const NAZWA_ROLI: Record<RolaPasowania, string> = {
  uszczelka: "uszczelka", membrana: "membrany", zestaw_naprawczy: "zestaw naprawczy",
  lacznik: "łącznik kolektora", element_zestawu: "element zestawu", inne: "inne",
};
export const ZRODLA_PASOWANIA = ["reczne", "dobor", "opis", "copilot"] as const;
export type ZrodloPasowania = (typeof ZRODLA_PASOWANIA)[number];

export interface Kartoteka { twId: number; symbol: string; nazwa: string }

export interface Pasowanie {
  id: number;
  /** Część, która PASUJE (uszczelka). */
  czesc: Kartoteka;
  /** DO CZEGO pasuje (gaźnik). */
  doCzego: Kartoteka;
  rola: RolaPasowania;
  nazwaRoli: string;
  pozycja: string | null;
  polaryzacja: Polaryzacja;
  powodNegatywny: PowodNegatywny | null;
  zdaniePowodu: string | null;
  stan: StanZastosowania;
  zrodlo: ZrodloPasowania;
  rodzajDowodu: RodzajDowodu;
  nazwaRodzajuDowodu: string;
  dowodTresc: string;
  dowodLink: string | null;
  komentarz: string | null;
  conversationId: number | null;
  zastepujeId: number | null;
  zaproponowal: string;
  zaproponowanoAt: string;
  rozstrzygnal: string | null;
  rozstrzygnietoAt: string | null;
  powodRozstrzygniecia: string | null;
  pewnosc: PewnoscZastosowania;
  /** Zdanie źródła (§14.3) — dla kandydata, ostrzeżenia i szkicu. */
  zdanieZrodla: string;
}

/**
 * Trafienie przy odczycie: wprost albo przez zamiennik. `czesc` i `doCzego`
 * to końce PO rozwiązaniu zamiennika; `pasowanie` to wiersz, który za tym
 * stoi. Przez zamiennik pewność jest najwyżej `prawdopodobne`.
 */
export interface TrafieniePasowania {
  czesc: Kartoteka;
  doCzego: Kartoteka;
  pasowanie: Pasowanie;
  przezZamiennik: string | null;
  pewnosc: PewnoscZastosowania;
  zdanie: string;
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const SELECT = `
  SELECT p.*, a.nazwa AS a_nazwa, b.nazwa AS b_nazwa
    FROM pasowanie_czesci p
    LEFT JOIN sgt_towar a ON a.tw_id = p.tw_id
    LEFT JOIN sgt_towar b ON b.tw_id = p.do_tw_id`;

function naPasowanie(w: Record<string, unknown>): Pasowanie {
  const rola = String(w.rola) as RolaPasowania;
  const rodzajDowodu = String(w.rodzaj_dowodu) as RodzajDowodu;
  const powod = w.powod_negatywny == null ? null : String(w.powod_negatywny) as PowodNegatywny;
  const pewnosc: PewnoscZastosowania = DOWODY_TECHNICZNE.includes(rodzajDowodu) ? "potwierdzone" : "prawdopodobne";
  const czesc = { twId: Number(w.tw_id), symbol: String(w.tw_symbol), nazwa: String(w.a_nazwa ?? w.tw_symbol) };
  const doCzego = { twId: Number(w.do_tw_id), symbol: String(w.do_tw_symbol), nazwa: String(w.b_nazwa ?? w.do_tw_symbol) };
  const pozycja = w.pozycja == null ? null : String(w.pozycja);
  const podpisDowodu = `${NAZWA_DOWODU[rodzajDowodu]}, ${dzien(String(w.zaproponowano_at))}, ${String(w.zaproponowal)}`;
  const opisCzesci = `${NAZWA_ROLI[rola]}${pozycja ? ` (${pozycja})` : ""} ${czesc.symbol}`;
  const zdanieZrodla = powod
    ? `${opisCzesci} nie pasuje do ${doCzego.symbol}: ${ZDANIE_POWODU[powod]} — ${podpisDowodu}`
    : `${opisCzesci} pasuje do ${doCzego.symbol} — ${podpisDowodu}`;
  return {
    id: Number(w.id), czesc, doCzego, rola, nazwaRoli: NAZWA_ROLI[rola], pozycja,
    polaryzacja: String(w.polaryzacja) as Polaryzacja, powodNegatywny: powod,
    zdaniePowodu: powod ? ZDANIE_POWODU[powod] : null,
    stan: String(w.stan) as StanZastosowania, zrodlo: String(w.zrodlo_propozycji) as ZrodloPasowania,
    rodzajDowodu, nazwaRodzajuDowodu: NAZWA_DOWODU[rodzajDowodu],
    dowodTresc: String(w.dowod_tresc), dowodLink: w.dowod_link == null ? null : String(w.dowod_link),
    komentarz: w.komentarz == null ? null : String(w.komentarz),
    conversationId: w.conversation_id == null ? null : Number(w.conversation_id),
    zastepujeId: w.zastepuje_id == null ? null : Number(w.zastepuje_id),
    zaproponowal: String(w.zaproponowal), zaproponowanoAt: String(w.zaproponowano_at),
    rozstrzygnal: w.rozstrzygnal == null ? null : String(w.rozstrzygnal),
    rozstrzygnietoAt: w.rozstrzygnieto_at == null ? null : String(w.rozstrzygnieto_at),
    powodRozstrzygniecia: w.powod_rozstrzygniecia == null ? null : String(w.powod_rozstrzygniecia),
    pewnosc, zdanieZrodla,
  };
}

export function pasowanie(id: number, database: DatabaseSync = db()): Pasowanie | null {
  const w = database.prepare(`${SELECT} WHERE p.id=?`).get(id) as Record<string, unknown> | undefined;
  return w ? naPasowanie(w) : null;
}

function wiersze(database: DatabaseSync, sql: string, ...args: Array<number | string>): Pasowanie[] {
  return (database.prepare(`${SELECT} ${sql}`).all(...args) as Array<Record<string, unknown>>).map(naPasowanie);
}

/** Kolejka do rozstrzygnięcia — najstarsze pierwsze, jak przy zastosowaniach. */
export function kolejkaPasowan(database: DatabaseSync = db()): { propozycje: Pasowanie[]; liczba: number } {
  const propozycje = wiersze(database, "WHERE p.stan='propozycja' ORDER BY p.zaproponowano_at, p.id");
  return { propozycje, liczba: propozycje.length };
}

function towar(database: DatabaseSync, twId: number): (Kartoteka & { opis: string }) | null {
  const w = database.prepare("SELECT tw_id, symbol, nazwa, opis FROM sgt_towar WHERE tw_id=?").get(twId) as
    { tw_id: number; symbol: string; nazwa: string; opis: string | null } | undefined;
  return w ? { twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa, opis: w.opis ?? "" } : null;
}

/**
 * Zamienniki z opisu TEJ kartoteki, rozwiązane do kartotek. Tylko `znane`
 * i tylko jednoznaczne (`stan === "jedno"`): symbol zdublowany w Subiekcie
 * nie ma prawa wskazać cudzej części.
 */
function zamiennikiKartoteki(database: DatabaseSync, t: Kartoteka & { opis: string }): Kartoteka[] {
  if (!t.opis) return [];
  const { znane } = podzielZamienniki(t.opis, t.symbol, (s) => kartotekaPoSku(database, s).stan !== "brak");
  const out: Kartoteka[] = [];
  for (const s of znane) {
    const k = kartotekaPoSku(database, s);
    if (k.stan !== "jedno" || k.twId === t.twId) continue;
    const w = towar(database, k.twId);
    if (w) out.push({ twId: w.twId, symbol: w.symbol, nazwa: w.nazwa });
  }
  return out;
}

const wprost = (p: Pasowanie): TrafieniePasowania =>
  ({ czesc: p.czesc, doCzego: p.doCzego, pasowanie: p, przezZamiennik: null, pewnosc: p.pewnosc, zdanie: p.zdanieZrodla });

function przezZamiennik(
  p: Pasowanie, czesc: Kartoteka, doCzego: Kartoteka, kto: Kartoteka, zamiennik: Kartoteka,
): TrafieniePasowania {
  const przez = `${kto.symbol} podaje ${zamiennik.symbol} jako zamiennik w opisie`;
  return { czesc, doCzego, pasowanie: p, przezZamiennik: przez, pewnosc: "prawdopodobne",
    zdanie: `${p.zdanieZrodla}; ${przez}` };
}

/**
 * Co wiemy o kartotece: do czego pasuje, co do niej pasuje, negatywy i to,
 * co czeka. Wprost i przez zamiennik (patrz nagłówek pliku). Dedup po parze
 * (część, do czego): wprost bije przechodnie.
 */
export function pasowaniaTowaru(twId: number, database: DatabaseSync = db()): {
  pasujeDo: TrafieniePasowania[]; pasujace: TrafieniePasowania[]; negatywne: Pasowanie[]; propozycje: Pasowanie[];
} {
  const ja = towar(database, twId);
  const wszystkie = wiersze(database,
    "WHERE (p.tw_id=? OR p.do_tw_id=?) AND p.stan IN ('zatwierdzone','propozycja') ORDER BY p.id", twId, twId);
  const zatw = wszystkie.filter((p) => p.stan === "zatwierdzone");
  const propozycje = wszystkie.filter((p) => p.stan === "propozycja");
  const negatywne = zatw.filter((p) => p.polaryzacja === "nie_pasuje");
  const pozytywne = zatw.filter((p) => p.polaryzacja === "pasuje");

  const pasujeDo = new Map<string, TrafieniePasowania>();
  const pasujace = new Map<string, TrafieniePasowania>();
  const klucz = (a: Kartoteka, b: Kartoteka) => `${a.twId}>${b.twId}`;
  const dodaj = (mapa: Map<string, TrafieniePasowania>, t: TrafieniePasowania) => {
    const k = klucz(t.czesc, t.doCzego);
    const juz = mapa.get(k);
    if (!juz || (juz.przezZamiennik !== null && t.przezZamiennik === null)) mapa.set(k, t);
  };

  for (const p of pozytywne) {
    if (p.czesc.twId === twId) dodaj(pasujeDo, wprost(p));
    if (p.doCzego.twId === twId) dodaj(pasujace, wprost(p));
  }

  if (ja) {
    /* Moje zamienniki: to, co pasuje DO nich, pasuje do mnie; to, do czego
       ONE pasują, pasuje ode mnie. */
    for (const z of zamiennikiKartoteki(database, ja)) {
      for (const p of wiersze(database,
        "WHERE (p.tw_id=? OR p.do_tw_id=?) AND p.stan='zatwierdzone' AND p.polaryzacja='pasuje' ORDER BY p.id", z.twId, z.twId)) {
        if (p.doCzego.twId === z.twId) dodaj(pasujace, przezZamiennik(p, p.czesc, ja, ja, z));
        if (p.czesc.twId === z.twId) dodaj(pasujeDo, przezZamiennik(p, ja, p.doCzego, ja, z));
      }
    }
    /* Zamienniki DRUGIEGO końca każdego trafienia wprost: uszczelka od innego
       dostawcy pasuje do tego samego gaźnika, ten sam gaźnik pod innym symbolem
       przyjmuje tę samą uszczelkę. */
    for (const p of pozytywne) {
      if (p.doCzego.twId === twId) {
        const x = towar(database, p.czesc.twId);
        if (x) for (const z of zamiennikiKartoteki(database, x)) dodaj(pasujace, przezZamiennik(p, z, ja, x, z));
      }
      if (p.czesc.twId === twId) {
        const y = towar(database, p.doCzego.twId);
        if (y) for (const z of zamiennikiKartoteki(database, y)) dodaj(pasujeDo, przezZamiennik(p, ja, z, y, z));
      }
    }
  }

  const porzadek = (a: TrafieniePasowania, b: TrafieniePasowania) =>
    Number(a.przezZamiennik !== null) - Number(b.przezZamiennik !== null) || a.pasowanie.id - b.pasowanie.id;
  return {
    pasujeDo: [...pasujeDo.values()].sort(porzadek),
    pasujace: [...pasujace.values()].sort(porzadek),
    negatywne, propozycje,
  };
}

/* ── Mutacje ───────────────────────────────────────────────────────────── */

export interface NowePasowanie {
  twId: number;
  doTwId: number;
  rola: RolaPasowania;
  pozycja?: string | null;
  polaryzacja: Polaryzacja;
  powodNegatywny?: PowodNegatywny | null;
  rodzajDowodu: RodzajDowodu;
  dowodTresc: string;
  dowodLink?: string | null;
  komentarz?: string | null;
  zrodlo: ZrodloPasowania;
  conversationId?: number | null;
  zastepujeId?: number | null;
}

function slad(database: DatabaseSync, p: Pasowanie, typ: string, dane: Record<string, unknown>, autor: string): void {
  if (p.conversationId === null) return;
  database.prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
    .run(p.conversationId, typ, JSON.stringify({ ...dane, pasowanieId: p.id, symbol: p.czesc.symbol, doCzego: p.doCzego.symbol, autor }));
}
function odswiez(p: Pasowanie): void {
  if (p.conversationId !== null) publishConversationEvent("assignment.changed", p.conversationId, { dobor: true });
}

/**
 * Propozycja pasowania. Zawsze PROPOZYCJA, także gdy wpisał ją człowiek —
 * precedens `przerobModelZOpisu`. Symbole idą z bazy, nie z żądania.
 * `null` = aktywny duplikat tej samej pary i polaryzacji; pozycja nie wchodzi
 * do klucza dubla, bo ta sama uszczelka w dwóch pozycjach jednego gaźnika nie
 * występuje.
 */
export function zaproponujPasowanie(p: NowePasowanie, autor: Autor, database: DatabaseSync = db()): Pasowanie | null {
  if (!ROLE_PASOWANIA.includes(p.rola)) throw new Error(`Nieznana rola części: ${String(p.rola)}`);
  if (!ZRODLA_PASOWANIA.includes(p.zrodlo)) throw new Error(`Nieznane źródło propozycji: ${String(p.zrodlo)}`);
  if (p.polaryzacja !== "pasuje" && p.polaryzacja !== "nie_pasuje") throw new Error("Polaryzacja to pasuje albo nie_pasuje");
  const powod = p.polaryzacja === "nie_pasuje" ? p.powodNegatywny ?? null : null;
  if (p.polaryzacja === "nie_pasuje" && (!powod || !POWODY_NEGATYWNE.includes(powod))) {
    throw new Error("Negatywne pasowanie wymaga powodu z listy §11.4");
  }
  if (!RODZAJE_DOWODU.includes(p.rodzajDowodu)) throw new Error(`Nieznany rodzaj dowodu: ${String(p.rodzajDowodu)}`);
  const tresc = oczysc(p.dowodTresc);
  if (!tresc) throw new Error("Pasowanie bez dowodu nie powstaje — napisz, skąd wiadomo");
  if (p.twId === p.doTwId) throw new Error("Część nie pasuje sama do siebie");
  const czesc = towar(database, p.twId);
  const doCzego = towar(database, p.doTwId);
  if (!czesc || !doCzego) throw new Error("Nie ma takiej kartoteki w Subiekcie");
  const kto = podpis(autor);

  const wynik = wTransakcji(database, () => {
    if (p.zastepujeId != null) {
      const stare = database.prepare("SELECT stan FROM pasowanie_czesci WHERE id=?").get(p.zastepujeId) as { stan: string } | undefined;
      if (!stare || stare.stan !== "zatwierdzone") throw new Error("Zastąpić można tylko zatwierdzone pasowanie");
    }
    const dubel = database.prepare(`SELECT id FROM pasowanie_czesci WHERE tw_id=? AND do_tw_id=? AND polaryzacja=?
      AND stan IN ('propozycja','zatwierdzone') AND id != COALESCE(?, -1)`)
      .get(p.twId, p.doTwId, p.polaryzacja, p.zastepujeId ?? null);
    if (dubel) return null;
    const id = Number(database.prepare(`INSERT INTO pasowanie_czesci(tw_id,tw_symbol,do_tw_id,do_tw_symbol,rola,pozycja,
      polaryzacja,powod_negatywny,zrodlo_propozycji,rodzaj_dowodu,dowod_tresc,dowod_link,komentarz,conversation_id,
      zastepuje_id,zaproponowal,zaproponowal_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(czesc.twId, czesc.symbol, doCzego.twId, doCzego.symbol, p.rola, oczysc(p.pozycja), p.polaryzacja, powod,
        p.zrodlo, p.rodzajDowodu, tresc, oczysc(p.dowodLink), oczysc(p.komentarz), p.conversationId ?? null,
        p.zastepujeId ?? null, kto.name, kto.userId).lastInsertRowid);
    const z = pasowanie(id, database)!;
    logEvent("pasowanie_propozycja", kto.name, z.czesc.twId, { pasowanie: z }, kto.userId, database);
    slad(database, z, "pasowanie_propozycja", { polaryzacja: z.polaryzacja, zrodlo: z.zrodlo }, kto.name);
    return z;
  });
  if (wynik) odswiez(wynik);
  return wynik;
}

export function rozstrzygnijPasowanie(
  id: number, decyzja: "zatwierdz" | "odrzuc", powod: string | null | undefined, userId: number,
  database: DatabaseSync = db(),
): Pasowanie {
  const autor = czlowiekZBiura(database, userId);
  if (decyzja !== "zatwierdz" && decyzja !== "odrzuc") throw new Error("Decyzja to zatwierdz albo odrzuc");
  const uzasadnienie = oczysc(powod);
  if (decyzja === "odrzuc" && !uzasadnienie) throw new Error("Odrzucenie wymaga powodu — bez niego autor nie wie, co poprawić");
  const wynik = wTransakcji(database, () => {
    const z = pasowanie(id, database);
    if (!z) throw new Error("Nie znaleziono pasowania");
    if (z.stan !== "propozycja") {
      throw new WiedzaConflict(`Tę propozycję rozstrzygnął już ${z.rozstrzygnal ?? "ktoś inny"}`,
        { stan: z.stan, rozstrzygnal: z.rozstrzygnal, rozstrzygnietoAt: z.rozstrzygnietoAt });
    }
    const stan: StanZastosowania = decyzja === "zatwierdz" ? "zatwierdzone" : "odrzucone";
    database.prepare(`UPDATE pasowanie_czesci SET stan=?, rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(stan, autor, userId, uzasadnienie, id);
    if (decyzja === "zatwierdz" && z.zastepujeId !== null) {
      database.prepare(`UPDATE pasowanie_czesci SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
        rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=?
        WHERE id=? AND stan='zatwierdzone'`).run(autor, userId, `zastąpione przez #${id}`, z.zastepujeId);
    }
    const po = pasowanie(id, database)!;
    logEvent("pasowanie_rozstrzygniecie", autor, po.czesc.twId, { decyzja, powod: uzasadnienie, pasowanie: po }, userId, database);
    slad(database, po, "pasowanie_rozstrzygniecie", { decyzja, polaryzacja: po.polaryzacja }, autor);
    return po;
  });
  odswiez(wynik);
  return wynik;
}

/**
 * Wycofanie ZATWIERDZONEGO pasowania. Negatyw schodzi wyłącznie z powodem
 * (§14.2), pozytyw — powód opcjonalny: reguła `wycofajZastosowanie`, nie
 * `wycofajZabudowe`, bo pasowanie nie gasi całej gałęzi kandydatów.
 */
export function wycofajPasowanie(
  id: number, powod: string | null | undefined, userId: number, database: DatabaseSync = db(),
): Pasowanie {
  const autor = czlowiekZBiura(database, userId);
  const uzasadnienie = oczysc(powod);
  const wynik = wTransakcji(database, () => {
    const z = pasowanie(id, database);
    if (!z) throw new Error("Nie znaleziono pasowania");
    if (z.stan !== "zatwierdzone") throw new Error("Wycofać można tylko zatwierdzone pasowanie");
    if (z.polaryzacja === "nie_pasuje" && !uzasadnienie) {
      throw new Error("Negatywne pasowanie wycofuje się wyłącznie z powodem — to ostrzeżenie, nie brak danych");
    }
    database.prepare(`UPDATE pasowanie_czesci SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(autor, userId, uzasadnienie, id);
    const po = pasowanie(id, database)!;
    logEvent("pasowanie_wycofanie", autor, po.czesc.twId, { powod: uzasadnienie, pasowanie: po }, userId, database);
    slad(database, po, "pasowanie_wycofanie", { polaryzacja: po.polaryzacja, powod: uzasadnienie }, autor);
    return po;
  });
  odswiez(wynik);
  return wynik;
}
