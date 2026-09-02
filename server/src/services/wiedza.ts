import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import { sqlZwin, zwin } from "../tekst.js";

/**
 * Baza wiedzy zastosowań (§11.3, §11.4, §12, etap E2).
 *
 * Trzy tabele: `model_urzadzenia`, `zastosowanie`, `dowod_zastosowania`.
 * Wiedza rośnie Z PRACY: z zatwierdzonych doborów, z pomiarów z hali
 * i z ręcznych wpisów biura — zawsze jako PROPOZYCJA, którą rozstrzyga
 * człowiek. Automat może proponować (i w E3/F będzie), ale nie zatwierdza
 * nigdy — doktryna `zwiazPewne` z `services/sygnatury.ts`. Roli „ekspert"
 * nie ma decyzją właściciela: rozstrzyga każdy z biura, także autor
 * propozycji, a obie osoby są zapisane osobno.
 *
 * Ten plik NIE importuje `dobor.ts` — tamten importuje ten (hak na
 * zatwierdzeniu doboru), a `kandydaci.ts` oba.
 */

/* Listy ZAMKNIĘTE — trzy kopie każdej: tu, w `CHECK` na kolumnie i w typach
   panelu. `opis` i `copilot` stoją bez nadawcy do E3/F, bo CHECK nie da się
   rozszerzyć bez przebudowy tabeli (blizna 0.135.0). */
export const POWODY_NEGATYWNE = [
  "nie_pasuje", "tylko_inny_wariant", "niewlasciwy_rozstaw",
  "srednica_ok_inne_mocowanie", "mylace_oznaczenie", "wymaga_pomiaru",
] as const;
export type PowodNegatywny = (typeof POWODY_NEGATYWNE)[number];

/* Zdanie dla ekranu pisze SERWER (§11.3) — panel nie tłumaczy kodów sam. */
export const ZDANIE_POWODU: Record<PowodNegatywny, string> = {
  nie_pasuje: "nie pasuje",
  tylko_inny_wariant: "pasuje tylko do innego wariantu",
  niewlasciwy_rozstaw: "niewłaściwy rozstaw",
  srednica_ok_inne_mocowanie: "właściwa średnica przy innym sposobie mocowania",
  mylace_oznaczenie: "występuje pod mylącym oznaczeniem",
  wymaga_pomiaru: "wymaga dodatkowego pomiaru",
};

/* Kolejność = MOC dowodu: producent najmocniejszy, ślad rozmowy najsłabszy.
   `decyzja_biura` stoi tam, gdzie projekt pisał „ekspert". */
export const RODZAJE_DOWODU = [
  "producent", "katalog_dostawcy", "pomiar_wlasny", "sprzedaz_weryfikacja", "decyzja_biura", "rozmowa",
] as const;
export type RodzajDowodu = (typeof RODZAJE_DOWODU)[number];
export const NAZWA_DOWODU: Record<RodzajDowodu, string> = {
  producent: "producent",
  katalog_dostawcy: "katalog dostawcy",
  pomiar_wlasny: "pomiar własny",
  sprzedaz_weryfikacja: "sprzedaż i weryfikacja",
  decyzja_biura: "decyzja biura",
  rozmowa: "rozmowa",
};
/* `rozmowa` to ślad („dobór zatwierdzony w rozmowie"), nie dowód techniczny.
   Reguła makiety „pewność z najsłabszego dowodu" brana dosłownie karałaby za
   dopisanie śladu rozmowy do katalogu producenta — stąd: potwierdzone, gdy
   stoi CHOĆ JEDEN dowód techniczny; same ślady rozmów dają „prawdopodobne",
   a ich liczba pewności nie podnosi. */
export const DOWODY_TECHNICZNE: RodzajDowodu[] = RODZAJE_DOWODU.filter((r) => r !== "rozmowa");

export const ZRODLA_PROPOZYCJI = ["dobor", "pomiar", "reczne", "opis", "copilot"] as const;
export type ZrodloPropozycji = (typeof ZRODLA_PROPOZYCJI)[number];
export const STANY_ZASTOSOWANIA = ["propozycja", "zatwierdzone", "odrzucone", "wycofane"] as const;
export type StanZastosowania = (typeof STANY_ZASTOSOWANIA)[number];
export type Polaryzacja = "pasuje" | "nie_pasuje";
export type PewnoscZastosowania = "potwierdzone" | "prawdopodobne";

export interface ModelUrzadzenia {
  id: number; rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string;
  wariant: string | null; lata: string | null; klucz: string;
  /** „NAC LS 46-450 HS" — jedno zdanie dla ekranu i szkicu. */
  etykieta: string;
}

export interface DowodZastosowania {
  id: number; rodzaj: RodzajDowodu; nazwaRodzaju: string; tresc: string; link: string | null;
  zadanieId: number | null; conversationId: number | null; autor: string; at: string;
}

export interface Zastosowanie {
  id: number; twId: number; symbol: string; model: ModelUrzadzenia;
  polaryzacja: Polaryzacja; powodNegatywny: PowodNegatywny | null; zdaniePowodu: string | null;
  stan: StanZastosowania; zrodlo: ZrodloPropozycji; komentarz: string | null;
  conversationId: number | null; zastepujeId: number | null;
  zaproponowal: string; zaproponowanoAt: string;
  rozstrzygnal: string | null; rozstrzygnietoAt: string | null; powodRozstrzygniecia: string | null;
  dowody: DowodZastosowania[];
  pewnosc: PewnoscZastosowania;
  /** Zdanie źródła (§14.3) — dla kandydata, ostrzeżenia i szkicu. */
  zdanieZrodla: string;
}

export type Autor = { userId: number; name: string } | { automat: string };

/** Rozstrzygnięte przez kogoś innego, zanim doszło żądanie — trasa robi z tego 409. */
export class WiedzaConflict extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) { super(message); }
}

/* Mutacje wiedzy bywają wołane Z WNĘTRZA cudzej transakcji (hak w
   `ustawStatusDoboru`), a `node:sqlite` nie zagnieżdża BEGIN. Otwarta
   transakcja jest wtedy transakcją wołającego — zapis idzie w niej, a jej
   ROLLBACK cofa także wiedzę. Tego właśnie chcemy: dobór bez propozycji
   albo propozycja bez doboru byłyby stanem w połowie. */
function wTransakcji<R>(database: DatabaseSync, fn: () => R): R {
  return database.isTransaction ? fn() : transaction(database, fn)();
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Klucz modelu: rodzaj + `zwin()` z marki, nazwy i wariantu. Nigdy własny `toLowerCase`. */
export function kluczModelu(
  rodzaj: "maszyna" | "silnik", marka: string, nazwa: string, wariant?: string | null,
): string {
  return `${rodzaj}|${zwin([marka, nazwa, wariant ?? ""].join(" "))}`;
}

const etykietaModelu = (m: { marka: string; nazwa: string; wariant: string | null }) =>
  [m.marka, m.nazwa, m.wariant].filter(Boolean).join(" ");

function naModel(w: Record<string, unknown>): ModelUrzadzenia {
  const m = {
    id: Number(w.id), rodzaj: String(w.rodzaj) as "maszyna" | "silnik",
    marka: String(w.marka), nazwa: String(w.nazwa),
    wariant: w.wariant == null ? null : String(w.wariant),
    lata: w.lata == null ? null : String(w.lata), klucz: String(w.klucz),
  };
  return { ...m, etykieta: etykietaModelu(m) };
}

/**
 * Kto rozstrzyga: WYŁĄCZNIE konto z rolą biura. Sprawdzane PRZED zapisem —
 * to jest „automat nie zatwierdza" w kształcie kodu, nie w dyscyplinie.
 */
function czlowiekZBiura(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name, role FROM app_user WHERE user_id=?").get(userId) as
    { name: string; role: string } | undefined;
  if (!u || !["biuro", "admin"].includes(u.role)) {
    throw new Error("Wiedzę rozstrzyga człowiek z biura — automat i hala nie zatwierdzają");
  }
  return u.name;
}

const podpis = (autor: Autor) =>
  "automat" in autor ? { name: `automat (${autor.automat})`, userId: null } : { name: autor.name, userId: autor.userId };

/** Modele do podpowiedzi w formularzu. Odczyt, `LIKE` po formie zwiniętej. */
export function szukajModeli(fraza: string, database: DatabaseSync = db()): ModelUrzadzenia[] {
  const q = zwin(fraza ?? "");
  if (!q) return [];
  return (database.prepare(`SELECT * FROM model_urzadzenia
    WHERE ${sqlZwin("marka || ' ' || nazwa || ' ' || COALESCE(wariant,'')")} LIKE ? ESCAPE '\\'
    ORDER BY marka, nazwa, wariant LIMIT 20`)
    .all(`%${q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`) as Array<Record<string, unknown>>).map(naModel);
}

export interface DaneModelu {
  rodzaj: "maszyna" | "silnik"; marka: string; nazwa: string; wariant?: string | null; lata?: string | null;
}

/** Model po kluczu: INSERT OR IGNORE + SELECT. Jedna kosiarka = jeden wiersz. */
export function upewnijModel(m: DaneModelu, autor: Autor, database: DatabaseSync = db()): ModelUrzadzenia {
  const marka = oczysc(m.marka); const nazwa = oczysc(m.nazwa);
  if (!marka || !nazwa) throw new Error("Model urządzenia wymaga marki i nazwy");
  if (m.rodzaj !== "maszyna" && m.rodzaj !== "silnik") throw new Error("Rodzaj modelu to maszyna albo silnik");
  const klucz = kluczModelu(m.rodzaj, marka, nazwa, oczysc(m.wariant));
  const kto = podpis(autor);
  const r = database.prepare(`INSERT OR IGNORE INTO model_urzadzenia(rodzaj,marka,nazwa,wariant,lata,klucz,
    utworzono_przez,utworzono_user_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(m.rodzaj, marka, nazwa, oczysc(m.wariant), oczysc(m.lata), klucz, kto.name, kto.userId);
  const w = database.prepare("SELECT * FROM model_urzadzenia WHERE klucz=?").get(klucz) as Record<string, unknown>;
  if (r.changes > 0) {
    logEvent("wiedza_model_utworzony", kto.name, null, { modelId: Number(w.id), klucz }, kto.userId, database);
  }
  return naModel(w);
}

/* ── Odczyt ────────────────────────────────────────────────────────────── */

const SELECT = `SELECT z.*, m.id AS m_id, m.rodzaj AS m_rodzaj, m.marka AS m_marka, m.nazwa AS m_nazwa,
  m.wariant AS m_wariant, m.lata AS m_lata, m.klucz AS m_klucz
  FROM zastosowanie z JOIN model_urzadzenia m ON m.id = z.model_id`;

function dowody(database: DatabaseSync, ids: number[]): Map<number, DowodZastosowania[]> {
  const wynik = new Map<number, DowodZastosowania[]>();
  if (ids.length === 0) return wynik;
  const dziury = ids.map(() => "?").join(",");
  for (const d of database.prepare(`SELECT * FROM dowod_zastosowania
      WHERE zastosowanie_id IN (${dziury}) ORDER BY id`).all(...ids) as Array<Record<string, unknown>>) {
    const lista = wynik.get(Number(d.zastosowanie_id)) ?? [];
    lista.push({
      id: Number(d.id), rodzaj: String(d.rodzaj) as RodzajDowodu,
      nazwaRodzaju: NAZWA_DOWODU[String(d.rodzaj) as RodzajDowodu] ?? String(d.rodzaj),
      tresc: String(d.tresc), link: d.link == null ? null : String(d.link),
      zadanieId: d.zadanie_id == null ? null : Number(d.zadanie_id),
      conversationId: d.conversation_id == null ? null : Number(d.conversation_id),
      autor: String(d.autor), at: String(d.at),
    });
    wynik.set(Number(d.zastosowanie_id), lista);
  }
  return wynik;
}

export function pewnoscZastosowania(lista: Array<{ rodzaj: RodzajDowodu }>): PewnoscZastosowania {
  return lista.some((d) => DOWODY_TECHNICZNE.includes(d.rodzaj)) ? "potwierdzone" : "prawdopodobne";
}

const dzien = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

/** Najmocniejszy dowód pierwszy — po nim ekran i szkic podpisują twierdzenie. */
function najmocniejszy(lista: DowodZastosowania[]): DowodZastosowania | null {
  return [...lista].sort((a, b) => RODZAJE_DOWODU.indexOf(a.rodzaj) - RODZAJE_DOWODU.indexOf(b.rodzaj))[0] ?? null;
}

/**
 * Zdanie źródła (§14.3). Pisze je serwer, żeby panel, kandydat i szkic
 * mówiły to samo — i żeby „potwierdzone" zawsze niosło, CZYM potwierdzone.
 */
export function zdanieZrodla(z: Omit<Zastosowanie, "zdanieZrodla" | "pewnosc"> & { pewnosc: PewnoscZastosowania }): string {
  const d = najmocniejszy(z.dowody);
  const podpisDowodu = d ? `${d.nazwaRodzaju}, ${dzien(d.at)}, ${d.autor}` : "bez dowodu";
  if (z.polaryzacja === "nie_pasuje") {
    return `nie pasuje do ${z.model.etykieta}: ${z.zdaniePowodu} — ${podpisDowodu}`;
  }
  return z.pewnosc === "potwierdzone"
    ? `potwierdzone zastosowanie do ${z.model.etykieta} — ${podpisDowodu}`
    : `zastosowanie do ${z.model.etykieta} zatwierdzone na podstawie rozmowy — ${podpisDowodu}; bez dowodu technicznego`;
}

function naZastosowania(database: DatabaseSync, wiersze: Array<Record<string, unknown>>): Zastosowanie[] {
  const d = dowody(database, wiersze.map((w) => Number(w.id)));
  return wiersze.map((w) => {
    const model = naModel({ id: w.m_id, rodzaj: w.m_rodzaj, marka: w.m_marka, nazwa: w.m_nazwa,
      wariant: w.m_wariant, lata: w.m_lata, klucz: w.m_klucz });
    const powod = w.powod_negatywny == null ? null : String(w.powod_negatywny) as PowodNegatywny;
    const lista = d.get(Number(w.id)) ?? [];
    const bez = {
      id: Number(w.id), twId: Number(w.tw_id), symbol: String(w.tw_symbol), model,
      polaryzacja: String(w.polaryzacja) as Polaryzacja, powodNegatywny: powod,
      zdaniePowodu: powod ? ZDANIE_POWODU[powod] : null,
      stan: String(w.stan) as StanZastosowania, zrodlo: String(w.zrodlo_propozycji) as ZrodloPropozycji,
      komentarz: w.komentarz == null ? null : String(w.komentarz),
      conversationId: w.conversation_id == null ? null : Number(w.conversation_id),
      zastepujeId: w.zastepuje_id == null ? null : Number(w.zastepuje_id),
      zaproponowal: String(w.zaproponowal), zaproponowanoAt: String(w.zaproponowano_at),
      rozstrzygnal: w.rozstrzygnal == null ? null : String(w.rozstrzygnal),
      rozstrzygnietoAt: w.rozstrzygnieto_at == null ? null : String(w.rozstrzygnieto_at),
      powodRozstrzygniecia: w.powod_rozstrzygniecia == null ? null : String(w.powod_rozstrzygniecia),
      dowody: lista, pewnosc: pewnoscZastosowania(lista),
    };
    return { ...bez, zdanieZrodla: zdanieZrodla(bez) };
  });
}

export function zastosowanie(id: number, database: DatabaseSync = db()): Zastosowanie | null {
  const w = database.prepare(`${SELECT} WHERE z.id=?`).get(id) as Record<string, unknown> | undefined;
  return w ? naZastosowania(database, [w])[0] : null;
}

/** Kolejka do rozstrzygnięcia — najstarsze pierwsze, bo czekają najdłużej. */
export function kolejkaPropozycji(database: DatabaseSync = db()): { propozycje: Zastosowanie[]; liczba: number } {
  const wiersze = database.prepare(`${SELECT} WHERE z.stan='propozycja' ORDER BY z.zaproponowano_at, z.id`)
    .all() as Array<Record<string, unknown>>;
  const propozycje = naZastosowania(database, wiersze);
  return { propozycje, liczba: propozycje.length };
}

/** Co wiemy o kartotece: potwierdzone, negatywne i to, co jeszcze czeka. */
export function zastosowaniaTowaru(twId: number, database: DatabaseSync = db()): {
  potwierdzone: Zastosowanie[]; negatywne: Zastosowanie[]; propozycje: Zastosowanie[];
} {
  const wszystkie = naZastosowania(database, database.prepare(
    `${SELECT} WHERE z.tw_id=? AND z.stan IN ('zatwierdzone','propozycja') ORDER BY z.id`)
    .all(twId) as Array<Record<string, unknown>>);
  return {
    potwierdzone: wszystkie.filter((z) => z.stan === "zatwierdzone" && z.polaryzacja === "pasuje"),
    negatywne: wszystkie.filter((z) => z.stan === "zatwierdzone" && z.polaryzacja === "nie_pasuje"),
    propozycje: wszystkie.filter((z) => z.stan === "propozycja"),
  };
}

/** ZATWIERDZONE zastosowania modelu — to z nich biorą się kandydaci i ostrzeżenia. */
export function zastosowaniaModelu(klucz: string, database: DatabaseSync = db()): Zastosowanie[] {
  return naZastosowania(database, database.prepare(
    `${SELECT} WHERE m.klucz=? AND z.stan='zatwierdzone' ORDER BY z.id`)
    .all(klucz) as Array<Record<string, unknown>>);
}

/* ── Mutacje ───────────────────────────────────────────────────────────── */

export interface NowyDowod { rodzaj: RodzajDowodu; tresc: string; link?: string | null; zadanieId?: number | null }

function sprawdzDowod(d: NowyDowod): { rodzaj: RodzajDowodu; tresc: string; link: string | null; zadanieId: number | null } {
  if (!RODZAJE_DOWODU.includes(d.rodzaj)) throw new Error(`Nieznany rodzaj dowodu: ${String(d.rodzaj)}`);
  const tresc = oczysc(d.tresc);
  if (!tresc) throw new Error("Dowód musi mieć treść — sam rodzaj niczego nie dowodzi");
  return { rodzaj: d.rodzaj, tresc, link: oczysc(d.link), zadanieId: d.zadanieId ?? null };
}

function wstawDowod(
  database: DatabaseSync, zastosowanieId: number, d: NowyDowod, conversationId: number | null, kto: { name: string; userId: number | null },
): void {
  const s = sprawdzDowod(d);
  database.prepare(`INSERT INTO dowod_zastosowania(zastosowanie_id,rodzaj,tresc,link,zadanie_id,conversation_id,autor,autor_user_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(zastosowanieId, s.rodzaj, s.tresc, s.link, s.zadanieId, conversationId, kto.name, kto.userId);
}

function sladRozmowy(database: DatabaseSync, z: Zastosowanie, typ: string, dane: Record<string, unknown>, autor: string): void {
  if (z.conversationId === null) return;
  database.prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
    .run(z.conversationId, typ, JSON.stringify({ ...dane, zastosowanieId: z.id, symbol: z.symbol, model: z.model.etykieta, autor }));
}

function odswiez(z: Zastosowanie): void {
  if (z.conversationId !== null) publishConversationEvent("assignment.changed", z.conversationId, { dobor: true });
}

export interface NowaPropozycja {
  twId: number;
  model: DaneModelu;
  polaryzacja: Polaryzacja;
  powodNegatywny?: PowodNegatywny | null;
  komentarz?: string | null;
  zrodlo: ZrodloPropozycji;
  conversationId?: number | null;
  dowod: NowyDowod;
  zastepujeId?: number | null;
}

/**
 * Propozycja zastosowania. Może ją złożyć automat (E3 opis, F Copilot) albo
 * człowiek; rodzi się ZAWSZE z dowodem, bo zatwierdzenie bez dowodu odbija
 * się. Symbol idzie z bazy, nie z żądania (wzorzec `wybierzKandydata`).
 *
 * `null` = aktywny duplikat (ta sama kartoteka, model i polaryzacja czeka
 * albo już stoi). Bez śladu — drugie zatwierdzenie tego samego doboru nie ma
 * prawa zaśmiecać kolejki.
 */
export function zaproponujZastosowanie(
  p: NowaPropozycja, autor: Autor, database: DatabaseSync = db(),
): Zastosowanie | null {
  if (p.polaryzacja !== "pasuje" && p.polaryzacja !== "nie_pasuje") throw new Error("Polaryzacja to pasuje albo nie_pasuje");
  const powod = p.polaryzacja === "nie_pasuje" ? p.powodNegatywny ?? null : null;
  if (p.polaryzacja === "nie_pasuje" && (!powod || !POWODY_NEGATYWNE.includes(powod))) {
    throw new Error("Negatywne dopasowanie wymaga powodu z listy §11.4");
  }
  if (!ZRODLA_PROPOZYCJI.includes(p.zrodlo)) throw new Error(`Nieznane źródło propozycji: ${String(p.zrodlo)}`);
  const t = database.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(p.twId) as { symbol: string } | undefined;
  if (!t) throw new Error("Nie ma takiej kartoteki w Subiekcie");
  const dowod = sprawdzDowod(p.dowod);
  const kto = podpis(autor);

  const wynik = wTransakcji(database, () => {
    if (p.zastepujeId != null) {
      const stare = database.prepare("SELECT stan FROM zastosowanie WHERE id=?").get(p.zastepujeId) as { stan: string } | undefined;
      if (!stare || stare.stan !== "zatwierdzone") throw new Error("Zastąpić można tylko zatwierdzone zastosowanie");
    }
    const model = upewnijModel(p.model, autor, database);
    /* Zastępowane zastosowanie nie liczy się jako duplikat: poprawka celowo
       dotyczy tej samej pary (kartoteka, model). */
    const dubel = database.prepare(`SELECT id FROM zastosowanie WHERE tw_id=? AND model_id=? AND polaryzacja=?
      AND stan IN ('propozycja','zatwierdzone') AND id != COALESCE(?, -1)`)
      .get(p.twId, model.id, p.polaryzacja, p.zastepujeId ?? null);
    if (dubel) return null;
    const id = Number(database.prepare(`INSERT INTO zastosowanie(tw_id,tw_symbol,model_id,polaryzacja,powod_negatywny,
      zrodlo_propozycji,komentarz,conversation_id,zastepuje_id,zaproponowal,zaproponowal_user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.twId, t.symbol, model.id, p.polaryzacja, powod, p.zrodlo, oczysc(p.komentarz),
        p.conversationId ?? null, p.zastepujeId ?? null, kto.name, kto.userId).lastInsertRowid);
    wstawDowod(database, id, dowod, p.conversationId ?? null, kto);
    const z = zastosowanie(id, database)!;
    logEvent("wiedza_propozycja", kto.name, p.twId, { zastosowanie: z }, kto.userId, database);
    sladRozmowy(database, z, "wiedza_propozycja", { polaryzacja: z.polaryzacja, zrodlo: z.zrodlo }, kto.name);
    return z;
  });
  if (wynik) odswiez(wynik);
  return wynik;
}

function zaladujDoRozstrzygniecia(database: DatabaseSync, id: number): Zastosowanie {
  const z = zastosowanie(id, database);
  if (!z) throw new Error("Nie znaleziono zastosowania");
  if (z.stan !== "propozycja") {
    throw new WiedzaConflict(`Tę propozycję rozstrzygnął już ${z.rozstrzygnal ?? "ktoś inny"}`,
      { stan: z.stan, rozstrzygnal: z.rozstrzygnal, rozstrzygnietoAt: z.rozstrzygnietoAt });
  }
  return z;
}

/**
 * Rozstrzygnięcie propozycji: zatwierdzenie albo odrzucenie z powodem.
 * Zatwierdzić może każdy z biura, także autor — decyzja właściciela.
 * Zatwierdzenie z `zastepujeId` wycofuje stare zastosowanie w tej samej
 * transakcji: historia wersji to łańcuch wierszy, nie osobna tabela.
 */
export function rozstrzygnijZastosowanie(
  id: number, decyzja: "zatwierdz" | "odrzuc", powod: string | null | undefined, userId: number,
  database: DatabaseSync = db(),
): Zastosowanie {
  const autor = czlowiekZBiura(database, userId);
  if (decyzja !== "zatwierdz" && decyzja !== "odrzuc") throw new Error("Decyzja to zatwierdz albo odrzuc");
  const uzasadnienie = oczysc(powod);
  if (decyzja === "odrzuc" && !uzasadnienie) throw new Error("Odrzucenie wymaga powodu — bez niego autor nie wie, co poprawić");
  const wynik = wTransakcji(database, () => {
    const z = zaladujDoRozstrzygniecia(database, id);
    if (decyzja === "zatwierdz" && z.dowody.length === 0) {
      throw new Error("Zatwierdzenie wymaga choć jednego dowodu");
    }
    const stan: StanZastosowania = decyzja === "zatwierdz" ? "zatwierdzone" : "odrzucone";
    database.prepare(`UPDATE zastosowanie SET stan=?, rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(stan, autor, userId, uzasadnienie, id);
    if (decyzja === "zatwierdz" && z.zastepujeId !== null) {
      database.prepare(`UPDATE zastosowanie SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
        rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=?
        WHERE id=? AND stan='zatwierdzone'`).run(autor, userId, `zastąpione przez #${id}`, z.zastepujeId);
    }
    const po = zastosowanie(id, database)!;
    logEvent("wiedza_rozstrzygniecie", autor, po.twId, { decyzja, powod: uzasadnienie, zastosowanie: po }, userId, database);
    sladRozmowy(database, po, "wiedza_rozstrzygniecie", { decyzja, polaryzacja: po.polaryzacja }, autor);
    return po;
  });
  odswiez(wynik);
  return wynik;
}

/**
 * Wycofanie ZATWIERDZONEGO zastosowania. Negatyw schodzi wyłącznie z powodem
 * (§14.2: negatywnej wiedzy nie usuwa się po cichu); pozytyw — powód
 * opcjonalny. Wiersz zostaje, zmienia się stan — historia nie znika.
 */
export function wycofajZastosowanie(
  id: number, powod: string | null | undefined, userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const autor = czlowiekZBiura(database, userId);
  const uzasadnienie = oczysc(powod);
  const wynik = wTransakcji(database, () => {
    const z = zastosowanie(id, database);
    if (!z) throw new Error("Nie znaleziono zastosowania");
    if (z.stan !== "zatwierdzone") throw new Error("Wycofać można tylko zatwierdzone zastosowanie");
    if (z.polaryzacja === "nie_pasuje" && !uzasadnienie) {
      throw new Error("Negatywne dopasowanie wycofuje się wyłącznie z powodem — to ostrzeżenie, nie brak danych");
    }
    database.prepare(`UPDATE zastosowanie SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(autor, userId, uzasadnienie, id);
    const po = zastosowanie(id, database)!;
    logEvent("wiedza_wycofanie", autor, po.twId, { powod: uzasadnienie, zastosowanie: po }, userId, database);
    sladRozmowy(database, po, "wiedza_wycofanie", { polaryzacja: po.polaryzacja, powod: uzasadnienie }, autor);
    return po;
  });
  odswiez(wynik);
  return wynik;
}

/** Dowód dopisany do propozycji albo zatwierdzonego zastosowania. Nigdy do odrzuconego. */
export function dodajDowod(
  id: number, d: NowyDowod, userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const autor = czlowiekZBiura(database, userId);
  const wynik = wTransakcji(database, () => {
    const z = zastosowanie(id, database);
    if (!z) throw new Error("Nie znaleziono zastosowania");
    if (z.stan === "odrzucone" || z.stan === "wycofane") throw new Error("Do odrzuconego albo wycofanego zastosowania nie dopisuje się dowodów");
    wstawDowod(database, id, d, z.conversationId, { name: autor, userId });
    const po = zastosowanie(id, database)!;
    logEvent("wiedza_dowod", autor, po.twId, { zastosowanieId: id, rodzaj: d.rodzaj }, userId, database);
    return po;
  });
  odswiez(wynik);
  return wynik;
}

/**
 * Wynik pomiaru z hali jako PROPOZYCJA wiedzy (§13.4). Wynik nie staje się
 * faktem: idzie do kolejki jako dowód `pomiar_wlasny` wskazujący zadanie.
 * Gdy para (kartoteka, model, polaryzacja) już czeka albo stoi, pomiar
 * dopisuje się do niej jako kolejny dowód — wiedza rośnie, kolejka nie.
 */
export function propozycjaZPomiaru(
  zadanieId: number,
  p: { twId?: number | null; model: DaneModelu; polaryzacja: Polaryzacja; powodNegatywny?: PowodNegatywny | null },
  userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const autor = czlowiekZBiura(database, userId);
  const z = database.prepare(`SELECT status, wynik, tw_id, conversation_id, wykonano_przez, wykonano_at
    FROM zadanie_terenowe WHERE id=?`).get(zadanieId) as
    { status: string; wynik: string | null; tw_id: number | null; conversation_id: number | null; wykonano_przez: string | null; wykonano_at: string | null } | undefined;
  if (!z) throw new Error("Nie znaleziono zadania");
  if (z.status !== "wykonane" || !z.wynik) throw new Error("Dowodem może być tylko WYKONANE zadanie z wynikiem");
  const twId = p.twId ?? z.tw_id;
  if (twId == null) throw new Error("Pomiar nie wskazuje kartoteki — wskaż ją przed zaproponowaniem");
  const dowod: NowyDowod = {
    rodzaj: "pomiar_wlasny", zadanieId,
    tresc: `${z.wynik} (zadanie #${zadanieId}, ${z.wykonano_przez ?? "hala"})`,
  };
  return wTransakcji(database, () => {
    const nowe = zaproponujZastosowanie({
      twId, model: p.model, polaryzacja: p.polaryzacja, powodNegatywny: p.powodNegatywny ?? null,
      zrodlo: "pomiar", conversationId: z.conversation_id, dowod,
    }, { userId, name: autor }, database);
    if (nowe) return nowe;
    const model = upewnijModel(p.model, { userId, name: autor }, database);
    const juz = database.prepare(`SELECT id FROM zastosowanie WHERE tw_id=? AND model_id=? AND polaryzacja=?
      AND stan IN ('propozycja','zatwierdzone')`).get(twId, model.id, p.polaryzacja) as { id: number };
    const maJuzTenPomiar = database.prepare(
      "SELECT 1 FROM dowod_zastosowania WHERE zastosowanie_id=? AND zadanie_id=?").get(juz.id, zadanieId);
    return maJuzTenPomiar ? zastosowanie(juz.id, database)! : dodajDowod(juz.id, dowod, userId, database);
  });
}

/**
 * Hak na zdjęciu wyboru przy zatwierdzonym doborze: automat wycofuje WŁASNĄ,
 * jeszcze nierozstrzygniętą propozycję z tej rozmowy. Zatwierdzonej nie
 * dotyka — tę rozstrzygnął człowiek i tylko człowiek ją wycofa.
 */
export function wycofajPropozycjeDoboru(
  conversationId: number, twId: number, autor: { userId: number; name: string }, database: DatabaseSync = db(),
): number {
  const ids = (database.prepare(`SELECT id FROM zastosowanie WHERE conversation_id=? AND tw_id=?
    AND stan='propozycja' AND zrodlo_propozycji='dobor'`).all(conversationId, twId) as Array<{ id: number }>)
    .map((r) => r.id);
  for (const id of ids) {
    database.prepare(`UPDATE zastosowanie SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia='zdjęto wybór w doborze' WHERE id=?`)
      .run(autor.name, autor.userId, id);
    logEvent("wiedza_wycofanie", autor.name, twId, { zastosowanieId: id, powod: "zdjęto wybór w doborze" }, autor.userId, database);
  }
  return ids.length;
}
