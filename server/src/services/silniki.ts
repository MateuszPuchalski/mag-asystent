import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { zwin } from "../tekst.js";
import { logEvent } from "./events.js";
import {
  DOWODY_TECHNICZNE, NAZWA_DOWODU, RODZAJE_DOWODU, WiedzaConflict, czlowiekZBiura, dzien,
  kluczModelu, naModel, podpis, upewnijModel, wTransakcji,
} from "./wiedza.js";
import type {
  Autor, DaneModelu, ModelUrzadzenia, PewnoscZastosowania, RodzajDowodu, StanZastosowania,
} from "./wiedza.js";

/**
 * Zabudowa silnika: który silnik stoi w której maszynie (§11.2).
 *
 * ── PO CO TO JEST ─────────────────────────────────────────────────────────
 * Części ogrodnicze mają problem dwupoziomowy. Filtr, gaźnik, świeca i linka
 * rozrusznika pasują do SILNIKA, a kupujący zna wyłącznie model kosiarki.
 * Bez tej relacji pytanie „filtr do NAC LS 46-450" nie ma jak trafić na filtr
 * Loncina, choć oba wpisy leżą w bazie obok siebie.
 *
 * ── DLACZEGO OSOBNY PLIK ──────────────────────────────────────────────────
 * Ten plik importuje `wiedza.ts` i NIGDY odwrotnie; `kandydaci.ts` i `dobor.ts`
 * importują oba. Ta sama hierarchia, co między `wiedza.ts` a `dobor.ts` —
 * inaczej powstaje cykl.
 *
 * ── CZEGO TU NIE MA ───────────────────────────────────────────────────────
 * Automat nie zakłada par sam. `lukiSilnikow()` układa KOLEJKĘ — mówi, których
 * maszyn agenci pytają najczęściej i jakie łańcuchy wpisywali w pole „Silnik" —
 * a markę i nazwę silnika wpisuje człowiek. Rozbijanie „B&S 450E" na markę
 * i nazwę to to samo zgadywanie, które właściciel odrzucił przy `FS350 FS400`
 * (§12).
 *
 * ── SŁOWNIK SILNIKÓW (0.238.0) ────────────────────────────────────────────
 * Most między wolnym tekstem a modelem jest LUDZKI: biuro wpisuje alias
 * „B&S 450E" = silnik Briggs & Stratton 450E, a `silnikZTekstu()` dopasowuje
 * tekst DOKŁADNIE po zwinięciu — bez rozbijania i bez furtki na literówki.
 * Alias prowadzi tylko do PROPOZYCJI zabudowy jednym kliknięciem w Doborze;
 * szczebel dalej czyta wyłącznie zabudowę zatwierdzoną przez człowieka.
 * Powód: po 0.237.0 Copilot wpisuje „Lonci v200" z rozmowy do pola, a bez
 * słownika ten tekst dalej był tylko notatką.
 */

export const ZRODLA_ZABUDOWY = ["reczne", "dobor", "copilot"] as const;
export type ZrodloZabudowy = (typeof ZRODLA_ZABUDOWY)[number];

export interface Zabudowa {
  id: number;
  maszyna: ModelUrzadzenia;
  silnik: ModelUrzadzenia;
  stan: StanZastosowania;
  zrodlo: ZrodloZabudowy;
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
  /** Dowód techniczny daje `potwierdzone`; sam ślad rozmowy — `prawdopodobne`. */
  pewnosc: PewnoscZastosowania;
  /** Zdanie źródła (§14.3): drugie ogniwo łańcucha w kandydacie i w szkicu. */
  zdanieZrodla: string;
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const SELECT = `
  SELECT z.*,
         ma.id m_id, ma.rodzaj m_rodzaj, ma.marka m_marka, ma.nazwa m_nazwa,
         ma.wariant m_wariant, ma.lata m_lata, ma.klucz m_klucz,
         si.id s_id, si.rodzaj s_rodzaj, si.marka s_marka, si.nazwa s_nazwa,
         si.wariant s_wariant, si.lata s_lata, si.klucz s_klucz
    FROM zabudowa_silnika z
    JOIN model_urzadzenia ma ON ma.id = z.maszyna_id
    JOIN model_urzadzenia si ON si.id = z.silnik_id`;

function naZabudowe(w: Record<string, unknown>): Zabudowa {
  const maszyna = naModel({ id: w.m_id, rodzaj: w.m_rodzaj, marka: w.m_marka, nazwa: w.m_nazwa,
    wariant: w.m_wariant, lata: w.m_lata, klucz: w.m_klucz });
  const silnik = naModel({ id: w.s_id, rodzaj: w.s_rodzaj, marka: w.s_marka, nazwa: w.s_nazwa,
    wariant: w.s_wariant, lata: w.s_lata, klucz: w.s_klucz });
  const rodzajDowodu = String(w.rodzaj_dowodu) as RodzajDowodu;
  const pewnosc: PewnoscZastosowania =
    DOWODY_TECHNICZNE.includes(rodzajDowodu) ? "potwierdzone" : "prawdopodobne";
  return {
    id: Number(w.id), maszyna, silnik,
    stan: String(w.stan) as StanZastosowania,
    zrodlo: String(w.zrodlo_propozycji) as ZrodloZabudowy,
    rodzajDowodu, nazwaRodzajuDowodu: NAZWA_DOWODU[rodzajDowodu],
    dowodTresc: String(w.dowod_tresc),
    dowodLink: w.dowod_link == null ? null : String(w.dowod_link),
    komentarz: w.komentarz == null ? null : String(w.komentarz),
    conversationId: w.conversation_id == null ? null : Number(w.conversation_id),
    zastepujeId: w.zastepuje_id == null ? null : Number(w.zastepuje_id),
    zaproponowal: String(w.zaproponowal), zaproponowanoAt: String(w.zaproponowano_at),
    rozstrzygnal: w.rozstrzygnal == null ? null : String(w.rozstrzygnal),
    rozstrzygnietoAt: w.rozstrzygnieto_at == null ? null : String(w.rozstrzygnieto_at),
    powodRozstrzygniecia: w.powod_rozstrzygniecia == null ? null : String(w.powod_rozstrzygniecia),
    pewnosc,
    zdanieZrodla: `${silnik.etykieta} stoi w ${maszyna.etykieta}`
      + ` — ${NAZWA_DOWODU[rodzajDowodu]}, ${dzien(String(w.zaproponowano_at))}, ${String(w.zaproponowal)}`,
  };
}

export function zabudowa(id: number, database: DatabaseSync = db()): Zabudowa | null {
  const w = database.prepare(`${SELECT} WHERE z.id=?`).get(id) as Record<string, unknown> | undefined;
  return w ? naZabudowe(w) : null;
}

/** ZATWIERDZONE silniki maszyny — to z nich bierze kandydatów szczebel „przez silnik". */
export function zabudowyMaszyny(kluczMaszyny: string, database: DatabaseSync = db()): Zabudowa[] {
  return (database.prepare(`${SELECT} WHERE ma.klucz=? AND z.stan='zatwierdzone' ORDER BY z.id`)
    .all(kluczMaszyny) as Array<Record<string, unknown>>).map(naZabudowe);
}

/** W drugą stronę: w jakich maszynach stoi ten silnik. Ekran WIEDZA. */
export function zabudowySilnika(kluczSilnika: string, database: DatabaseSync = db()): Zabudowa[] {
  return (database.prepare(`${SELECT} WHERE si.klucz=? AND z.stan='zatwierdzone' ORDER BY z.id`)
    .all(kluczSilnika) as Array<Record<string, unknown>>).map(naZabudowe);
}

/**
 * Para w stanie ŻYWYM (`propozycja` albo `zatwierdzone`) dla maszyny
 * i silnika — do podpowiedzi pod polem „Silnik": czy klikać „Zaproponuj
 * zabudowę", czy para już czeka. `null` = nie ma takiej pary.
 */
export function zabudowaPary(
  kluczMaszyny: string, kluczSilnika: string, database: DatabaseSync = db(),
): Zabudowa | null {
  const w = database.prepare(`${SELECT} WHERE ma.klucz=? AND si.klucz=?
      AND z.stan IN ('propozycja','zatwierdzone') ORDER BY z.stan='zatwierdzone' DESC, z.id DESC LIMIT 1`)
    .get(kluczMaszyny, kluczSilnika) as Record<string, unknown> | undefined;
  return w ? naZabudowe(w) : null;
}

/* ── Słownik silników ────────────────────────────────────────────────────── */

export interface AliasSilnika {
  id: number;
  /** Tekst tak, jak wpisało go biuro — etykieta; dopasowanie idzie po `zwin`. */
  tekst: string;
  silnik: ModelUrzadzenia;
  dodal: string;
  dodanoAt: string;
}

const SELECT_ALIAS = `
  SELECT a.id, a.tekst, a.dodal, a.dodano_at,
         si.id s_id, si.rodzaj s_rodzaj, si.marka s_marka, si.nazwa s_nazwa,
         si.wariant s_wariant, si.lata s_lata, si.klucz s_klucz
    FROM alias_silnika a JOIN model_urzadzenia si ON si.id = a.silnik_id`;

const naAlias = (w: Record<string, unknown>): AliasSilnika => ({
  id: Number(w.id), tekst: String(w.tekst), dodal: String(w.dodal), dodanoAt: String(w.dodano_at),
  silnik: naModel({ id: w.s_id, rodzaj: w.s_rodzaj, marka: w.s_marka, nazwa: w.s_nazwa,
    wariant: w.s_wariant, lata: w.s_lata, klucz: w.s_klucz }),
});

/** Cały słownik do ekranu, alfabetycznie. */
export function aliasySilnikow(database: DatabaseSync = db()): AliasSilnika[] {
  return (database.prepare(`${SELECT_ALIAS} ORDER BY a.tekst COLLATE NOCASE, a.id`)
    .all() as Array<Record<string, unknown>>).map(naAlias);
}

/**
 * Jedyna droga od tekstu z pola „Silnik" do modelu. Dopasowanie DOKŁADNE po
 * `zwin` — ta sama normalizacja, co klucz modelu i `towar_identyfikator`,
 * nigdy własny `toLowerCase` i nigdy odległość edycyjna (blizna szarpaka).
 */
export function silnikZTekstu(tekst: string | null | undefined, database: DatabaseSync = db()): AliasSilnika | null {
  const norm = zwin(String(tekst ?? ""));
  if (!norm) return null;
  const w = database.prepare(`${SELECT_ALIAS} WHERE a.tekst_norm=?`).get(norm) as Record<string, unknown> | undefined;
  return w ? naAlias(w) : null;
}

/**
 * Alias wpisuje CZŁOWIEK z biura. Model silnika powstaje tą samą drogą, co
 * przy zabudowie (`upewnijModel`), więc słownik nigdy nie wskazuje maszyny.
 * Dubel to `WiedzaConflict` (409): biuro ma zobaczyć, do czego ten tekst
 * już prowadzi, zamiast po cichu nadpisać cudzy wpis.
 */
export function dodajAliasSilnika(
  p: { tekst: string; silnik: DaneModelu }, autor: Autor, database: DatabaseSync = db(),
): AliasSilnika {
  const tekst = oczysc(p.tekst);
  if (!tekst) throw new Error("Alias wymaga tekstu — tego, co agenci wpisują w pole „Silnik”");
  if (tekst.length > 80) throw new Error("Alias to krótki tekst z pola, nie opis — najwyżej 80 znaków");
  if (p.silnik?.rodzaj !== "silnik") throw new Error("Alias słownika wskazuje SILNIK, nie maszynę");
  if (!("automat" in autor)) czlowiekZBiura(database, autor.userId);
  const norm = zwin(tekst);
  const kto = podpis(autor);
  return wTransakcji(database, () => {
    const jest = database.prepare(`${SELECT_ALIAS} WHERE a.tekst_norm=?`).get(norm) as Record<string, unknown> | undefined;
    if (jest) {
      const a = naAlias(jest);
      throw new WiedzaConflict(`„${a.tekst}” już jest w słowniku i znaczy ${a.silnik.etykieta}`,
        { aliasId: a.id, silnik: a.silnik });
    }
    const silnik = upewnijModel(p.silnik, autor, database);
    const id = Number(database.prepare(`INSERT INTO alias_silnika(tekst,tekst_norm,silnik_id,dodal,dodal_user_id)
      VALUES (?,?,?,?,?)`).run(tekst, norm, silnik.id, kto.name, kto.userId).lastInsertRowid);
    logEvent("alias_silnika_dodany", kto.name, null, { aliasId: id, tekst, silnik: silnik.klucz }, kto.userId, database);
    return naAlias(database.prepare(`${SELECT_ALIAS} WHERE a.id=?`).get(id) as Record<string, unknown>);
  });
}

/** Pomyłkę w słowniku się usuwa — alias nie ma stanów, bo nie jest propozycją. */
export function usunAliasSilnika(id: number, userId: number, database: DatabaseSync = db()): void {
  const autor = czlowiekZBiura(database, userId);
  const w = database.prepare(`${SELECT_ALIAS} WHERE a.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!w) throw new Error("Nie znaleziono aliasu");
  const a = naAlias(w);
  database.prepare("DELETE FROM alias_silnika WHERE id=?").run(id);
  logEvent("alias_silnika_usuniety", autor, null, { aliasId: id, tekst: a.tekst, silnik: a.silnik.klucz }, userId, database);
}

/** Kolejka do rozstrzygnięcia — najstarsze pierwsze, jak przy zastosowaniach. */
export function kolejkaZabudow(database: DatabaseSync = db()): { propozycje: Zabudowa[]; liczba: number } {
  const propozycje = (database.prepare(
    `${SELECT} WHERE z.stan='propozycja' ORDER BY z.zaproponowano_at, z.id`)
    .all() as Array<Record<string, unknown>>).map(naZabudowe);
  return { propozycje, liczba: propozycje.length };
}

/** Wszystkie zatwierdzone pary, do zwiniętej listy na ekranie. */
export function zatwierdzoneZabudowy(database: DatabaseSync = db()): Zabudowa[] {
  return (database.prepare(`${SELECT} WHERE z.stan='zatwierdzone' ORDER BY ma.marka, ma.nazwa, z.id`)
    .all() as Array<Record<string, unknown>>).map(naZabudowe);
}

/* ── Kolejka luk ───────────────────────────────────────────────────────── */

export interface LukaSilnika {
  marka: string;
  model: string;
  wariant: string | null;
  klucz: string;
  /** Ile doborów wskazało tę maszynę — po tym sortujemy. */
  pytan: number;
  /**
   * SUROWE łańcuchy z pola „Silnik", z licznikiem, scalone po `zwin` (pierwsza
   * pisownia zostaje etykietą). Nierozbite — `silnik` niesie wyłącznie to, co
   * biuro wpisało do słownika; `null` = tekst bez aliasu.
   */
  wpisaneSilniki: Array<{ tekst: string; ile: number; silnik: ModelUrzadzenia | null }>;
  zabudowy: Zabudowa[];
}

/**
 * Czego brakuje, od najczęstszego — CZYSTY ODCZYT.
 *
 * Ranking liczymy z `dobor_rozmowy.marka/model/wariant`, czyli z PÓL
 * WPISANYCH PRZEZ AGENTA. Blizna „szarpaka" zakazuje szukać po treści
 * wiadomości klienta i ten zakaz obowiązuje także tutaj: tytuł pytania i tak
 * nigdy nie powie „Loncin LC1P65FE", a rozbijanie go na markę i model byłoby
 * tym samym zgadywaniem, które właściciel odrzucił przy sekcjach „Modele:".
 *
 * Klucz liczy `kluczModelu()` w JS, a nie `sqlZwin` w SQL — normalizacja ma
 * mieć jednego właściciela.
 */
export function lukiSilnikow(
  limit = 200, database: DatabaseSync = db(),
): { luki: LukaSilnika[]; liczba: number } {
  const wiersze = database.prepare(`
    SELECT marka, model, wariant, silnik, count(*) ile
      FROM dobor_rozmowy
     WHERE marka IS NOT NULL AND marka != '' AND model IS NOT NULL AND model != ''
     GROUP BY marka, model, wariant, silnik`)
    .all() as Array<Record<string, unknown>>;

  const mapa = new Map<string, LukaSilnika>();
  for (const w of wiersze) {
    const marka = String(w.marka);
    const model = String(w.model);
    const wariant = w.wariant == null ? null : String(w.wariant);
    const klucz = kluczModelu("maszyna", marka, model, wariant);
    const ile = Number(w.ile);
    const luka = mapa.get(klucz)
      ?? { marka, model, wariant, klucz, pytan: 0, wpisaneSilniki: [], zabudowy: [] };
    luka.pytan += ile;
    const tekst = oczysc(w.silnik);
    if (tekst) {
      /* Scalanie po `zwin`, nie po równości: „B&S 450E" i „b&s 450e" to jeden
         czip, tak samo jak jeden alias w słowniku. */
      const juz = luka.wpisaneSilniki.find((s) => zwin(s.tekst) === zwin(tekst));
      if (juz) juz.ile += ile;
      else luka.wpisaneSilniki.push({ tekst, ile, silnik: null });
    }
    mapa.set(klucz, luka);
  }

  const luki = [...mapa.values()];
  for (const l of luki) {
    l.zabudowy = zabudowyMaszyny(l.klucz, database);
    for (const s of l.wpisaneSilniki) s.silnik = silnikZTekstu(s.tekst, database)?.silnik ?? null;
    l.wpisaneSilniki.sort((a, b) => b.ile - a.ile || a.tekst.localeCompare(b.tekst));
  }
  /* Bez zabudowy najpierw — to jest lista PRACY, nie raport. W drugiej
     kolejności częstość: maszyna, o którą pytano czternaście razy, kosztuje
     więcej niż ta z jednym pytaniem. */
  luki.sort((a, b) =>
    Number(a.zabudowy.length > 0) - Number(b.zabudowy.length > 0)
    || b.pytan - a.pytan
    || `${a.marka} ${a.model}`.localeCompare(`${b.marka} ${b.model}`));
  return { luki: luki.slice(0, limit), liczba: luki.length };
}

/* ── Mutacje ───────────────────────────────────────────────────────────── */

export interface NowaZabudowa {
  maszyna: DaneModelu;
  silnik: DaneModelu;
  rodzajDowodu: RodzajDowodu;
  dowodTresc: string;
  dowodLink?: string | null;
  komentarz?: string | null;
  zrodlo: ZrodloZabudowy;
  conversationId?: number | null;
  zastepujeId?: number | null;
}

/**
 * Propozycja pary maszyna→silnik. Zawsze PROPOZYCJA, nigdy fakt — także gdy
 * wpisał ją człowiek. Precedens: `przerobModelZOpisu` też zakłada propozycję,
 * choć markę i model wskazuje ręka.
 *
 * `null` = aktywny duplikat. Bez śladu: druga próba tej samej pary nie ma
 * prawa zaśmiecać kolejki.
 */
export function zaproponujZabudowe(
  p: NowaZabudowa, autor: Autor, database: DatabaseSync = db(),
): Zabudowa | null {
  if (p.maszyna.rodzaj !== "maszyna") throw new Error("Pierwszy model zabudowy to MASZYNA");
  if (p.silnik.rodzaj !== "silnik") throw new Error("Drugi model zabudowy to SILNIK");
  if (!ZRODLA_ZABUDOWY.includes(p.zrodlo)) throw new Error(`Nieznane źródło zabudowy: ${String(p.zrodlo)}`);
  if (!RODZAJE_DOWODU.includes(p.rodzajDowodu)) throw new Error(`Nieznany rodzaj dowodu: ${String(p.rodzajDowodu)}`);
  const tresc = oczysc(p.dowodTresc);
  if (!tresc) throw new Error("Zabudowa bez dowodu nie powstaje — napisz, skąd wiadomo");
  const kto = podpis(autor);

  return wTransakcji(database, () => {
    if (p.zastepujeId != null) {
      const stare = database.prepare("SELECT stan FROM zabudowa_silnika WHERE id=?")
        .get(p.zastepujeId) as { stan: string } | undefined;
      if (!stare || stare.stan !== "zatwierdzone") throw new Error("Zastąpić można tylko zatwierdzoną zabudowę");
    }
    const maszyna = upewnijModel(p.maszyna, autor, database);
    const silnik = upewnijModel(p.silnik, autor, database);
    if (maszyna.id === silnik.id) throw new Error("Maszyna i silnik to ten sam model");
    /* Wycofana para NIE jest duplikatem — dlatego tabela nie ma `UNIQUE`.
       Zastępowana też nie: poprawka celowo dotyczy tej samej pary. */
    const dubel = database.prepare(`SELECT id FROM zabudowa_silnika WHERE maszyna_id=? AND silnik_id=?
      AND stan IN ('propozycja','zatwierdzone') AND id != COALESCE(?, -1)`)
      .get(maszyna.id, silnik.id, p.zastepujeId ?? null);
    if (dubel) return null;
    const id = Number(database.prepare(`INSERT INTO zabudowa_silnika(maszyna_id,silnik_id,zrodlo_propozycji,
      rodzaj_dowodu,dowod_tresc,dowod_link,komentarz,conversation_id,zastepuje_id,zaproponowal,zaproponowal_user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(maszyna.id, silnik.id, p.zrodlo, p.rodzajDowodu, tresc, oczysc(p.dowodLink),
        oczysc(p.komentarz), p.conversationId ?? null, p.zastepujeId ?? null, kto.name, kto.userId)
      .lastInsertRowid);
    const z = zabudowa(id, database)!;
    logEvent("zabudowa_propozycja", kto.name, null, { zabudowa: z }, kto.userId, database);
    return z;
  });
}

/**
 * Rozstrzygnięcie: zatwierdzenie albo odrzucenie z powodem. Rozstrzyga
 * WYŁĄCZNIE człowiek z biura, także autor propozycji — jak przy zastosowaniu.
 * Zatwierdzenie z `zastepujeId` wycofuje starą parę w tej samej transakcji.
 */
export function rozstrzygnijZabudowe(
  id: number, decyzja: "zatwierdz" | "odrzuc", powod: string | null | undefined, userId: number,
  database: DatabaseSync = db(),
): Zabudowa {
  const autor = czlowiekZBiura(database, userId);
  if (decyzja !== "zatwierdz" && decyzja !== "odrzuc") throw new Error("Decyzja to zatwierdz albo odrzuc");
  const uzasadnienie = oczysc(powod);
  if (decyzja === "odrzuc" && !uzasadnienie) {
    throw new Error("Odrzucenie wymaga powodu — bez niego autor nie wie, co poprawić");
  }
  return wTransakcji(database, () => {
    const z = zabudowa(id, database);
    if (!z) throw new Error("Nie znaleziono zabudowy");
    if (z.stan !== "propozycja") {
      throw new WiedzaConflict(`Tę propozycję rozstrzygnął już ${z.rozstrzygnal ?? "ktoś inny"}`,
        { stan: z.stan, rozstrzygnal: z.rozstrzygnal, rozstrzygnietoAt: z.rozstrzygnietoAt });
    }
    const stan: StanZastosowania = decyzja === "zatwierdz" ? "zatwierdzone" : "odrzucone";
    database.prepare(`UPDATE zabudowa_silnika SET stan=?, rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(stan, autor, userId, uzasadnienie, id);
    if (decyzja === "zatwierdz" && z.zastepujeId !== null) {
      database.prepare(`UPDATE zabudowa_silnika SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
        rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=?
        WHERE id=? AND stan='zatwierdzone'`).run(autor, userId, `zastąpione przez #${id}`, z.zastepujeId);
    }
    const po = zabudowa(id, database)!;
    logEvent("zabudowa_rozstrzygniecie", autor, null, { decyzja, powod: uzasadnienie, zabudowa: po }, userId, database);
    return po;
  });
}

/**
 * Wycofanie ZATWIERDZONEJ pary — wyłącznie z powodem.
 *
 * Powód jest obowiązkowy inaczej niż przy pozytywnym zastosowaniu, bo cofnięcie
 * zabudowy unieważnia CAŁĄ gałąź szczebla: wszystkie części tego silnika
 * przestają być kandydatami dla tej maszyny naraz.
 */
export function wycofajZabudowe(
  id: number, powod: string | null | undefined, userId: number, database: DatabaseSync = db(),
): Zabudowa {
  const autor = czlowiekZBiura(database, userId);
  const uzasadnienie = oczysc(powod);
  if (!uzasadnienie) throw new Error("Wycofanie zabudowy wymaga powodu — znika z nią cała gałąź kandydatów");
  return wTransakcji(database, () => {
    const z = zabudowa(id, database);
    if (!z) throw new Error("Nie znaleziono zabudowy");
    if (z.stan !== "zatwierdzone") throw new Error("Wycofać można tylko zatwierdzoną zabudowę");
    database.prepare(`UPDATE zabudowa_silnika SET stan='wycofane', rozstrzygnal=?, rozstrzygnal_user_id=?,
      rozstrzygnieto_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), powod_rozstrzygniecia=? WHERE id=?`)
      .run(autor, userId, uzasadnienie, id);
    const po = zabudowa(id, database)!;
    logEvent("zabudowa_wycofanie", autor, null, { powod: uzasadnienie, zabudowa: po }, userId, database);
    return po;
  });
}
