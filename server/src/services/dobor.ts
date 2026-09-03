import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { ConversationConflict } from "./conversations.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  kluczModelu, propozycjaZPomiaru, wycofajPropozycjeDoboru, zaproponujZastosowanie, zastosowaniaModelu,
  type Polaryzacja, type PowodNegatywny, type Zastosowanie,
} from "./wiedza.js";

/**
 * Dobór części przy rozmowie (§11, etap E1).
 *
 * §1 nazywa dobór NAJWAŻNIEJSZYM przypadkiem panelu, a do etapu E panel nie
 * miał go wcale: ani stanu, ani miejsca na to, o jaką maszynę chodzi. Ten
 * serwis daje mu kręgosłup — dane wejściowe, status, wybór kartoteki. Wiedzy
 * (zastosowań i dowodów) tu NIE MA; to etap E2.
 *
 * Dobór wisi przy ROZMOWIE: jedno pytanie = jeden dobór, a sprawa widzi dobory
 * przez swoje rozmowy. Brak wiersza znaczy `not_started` i liczy się przy
 * odczycie, więc otwarcie zakładki niczego nie wstawia.
 *
 * Automat NIGDY nie zatwierdza — doktryna `zwiazPewne` z `services/sygnatury.ts`
 * i decyzja właściciela: zatwierdza każdy z biura, roli „ekspert" nie ma.
 */

/* Lista ZAMKNIĘTA, wprost z §7. Trzy kopie — tu, w `CHECK` na kolumnie
   i w typie panelu — bo każda pilnuje innej granicy. */
export const STATUSY_DOBORU = [
  "not_started", "extracting_data", "missing_information", "searching",
  "candidates_found", "requires_expert", "confirmed", "rejected", "not_applicable",
] as const;
export type StatusDoboru = (typeof STATUSY_DOBORU)[number];

/* `extracting_data` nie ma w etapie E nadawcy: to stan, w którym Copilot (F)
   wyciąga dane z pytania klienta. Człowiek nie ma go jak ustawić uczciwie —
   on dane WPISUJE, nie wyciąga — więc serwis go odrzuca, a `CHECK` zostawia
   na listę, żeby F nie musiał przebudowywać tabeli. */
export const STATUSY_DOBORU_RECZNE: StatusDoboru[] =
  STATUSY_DOBORU.filter((s) => s !== "extracting_data");

/* Osiem dróg §11.2. Trzy ostatnie czekają na E2/E3 bez nadawcy. */
export const DROGI_DOBORU = [
  "oferta", "zamiennik", "symbol", "ean", "wyszukiwarka", "zastosowanie", "oem", "pelnotekst",
] as const;
export type DrogaDoboru = (typeof DROGI_DOBORU)[number];
/* Od E3 każda droga z §11.2 ma nadawcę; lista zostaje jako strażnik przed
   drogą spoza słownika (np. „semantyka" z etapu F, której jeszcze nie ma). */
const DROGI_Z_NADAWCA: DrogaDoboru[] = [...DROGI_DOBORU];

/* Zdanie źródła dla szkicu (§14.3): panel go nie układa, bo druga kopia tej
   listy rozjechałaby się przy pierwszej nowej drodze. */
const ZRODLO_DROGI: Record<DrogaDoboru, string> = {
  oferta: "kartoteka oferty, o którą pyta klient",
  zamiennik: "zamiennik z opisu kartoteki oferty",
  symbol: "dokładny symbol",
  ean: "kod EAN",
  wyszukiwarka: "wskazane ręcznie przez agenta",
  zastosowanie: "potwierdzone zastosowanie",
  oem: "numer OEM",
  pelnotekst: "trafienie po treści — nie dowód",
};

/** Dane wejściowe §11.1. Każde pole jest propozycją, którą agent poprawia. */
export interface DaneDoboru {
  marka: string | null;
  model: string | null;
  wariant: string | null;
  rocznik: string | null;
  nrSeryjny: string | null;
  silnik: string | null;
  oem: string | null;
  nazwaCzesci: string | null;
  /** Parametry i wymiary — lista otwarta, stąd słownik, nie kolumny. */
  parametry: Record<string, string>;
}

const POLA: Array<[keyof Omit<DaneDoboru, "parametry">, string]> = [
  ["marka", "marka"], ["model", "model"], ["wariant", "wariant"], ["rocznik", "rocznik"],
  ["nrSeryjny", "nr_seryjny"], ["silnik", "silnik"], ["oem", "oem"], ["nazwaCzesci", "nazwa_czesci"],
];

export interface WyborDoboru {
  twId: number;
  symbol: string;
  droga: DrogaDoboru;
  przez: string;
  at: string;
  /** Zdanie do szkicu pisze SERWER (§14.3) — ze źródłem, nie samą wartością. */
  zdanieDoSzkicu: string;
}

export interface Dobor {
  status: StatusDoboru;
  wersja: number;
  dane: DaneDoboru;
  brakuje: string | null;
  wybrany: WyborDoboru | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const PUSTE: DaneDoboru = {
  marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null,
  silnik: null, oem: null, nazwaCzesci: null, parametry: {},
};

function imie(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name FROM app_user WHERE user_id=?").get(userId) as
    { name: string } | undefined;
  return u?.name ?? `konto ${userId}`;
}

function istniejeRozmowa(database: DatabaseSync, conversationId: number): void {
  if (!database.prepare("SELECT 1 FROM conversation WHERE id=?").get(conversationId)) {
    throw new Error("Nie znaleziono rozmowy");
  }
}

function wiersz(database: DatabaseSync, conversationId: number) {
  return database.prepare("SELECT * FROM dobor_rozmowy WHERE conversation_id=?")
    .get(conversationId) as Record<string, unknown> | undefined;
}

/** Urządzenie jednym zdaniem: „NAC LS 46-450 (2019)". Puste, gdy nic nie wiadomo. */
function urzadzenie(dane: DaneDoboru): string {
  const nazwa = [dane.marka, dane.model, dane.wariant].filter(Boolean).join(" ");
  if (!nazwa) return "";
  return dane.rocznik ? `${nazwa} (${dane.rocznik})` : nazwa;
}

/**
 * Zdanie do szkicu (§14.3). Bez marki i modelu dobór nie ma do czego pasować,
 * więc zdanie mówi to wprost — ekran nie ma prawa dopisać maszyny sam.
 *
 * Gdy za wyborem stoi ZATWIERDZONE zastosowanie z bazy wiedzy (E2), zdanie
 * cytuje jego dowód — to jest „rekomendacja techniczna pokazuje źródło"
 * z §25. Bez niego zatwierdzony dobór to wciąż dobór AGENTA: stąd
 * „prawdopodobnie" i „bez potwierdzonego zastosowania".
 */
function zdanieDoSzkicu(
  dane: DaneDoboru, symbol: string, droga: DrogaDoboru, status: StatusDoboru, zastosowanie: Zastosowanie | null,
): string {
  const maszyna = urzadzenie(dane);
  const zrodlo = `źródło: ${ZRODLO_DROGI[droga]}`;
  if (!maszyna) return `${symbol} — ${zrodlo}; dobór bez wskazanej maszyny — to przypuszczenie.`;
  /* Zastosowanie zatwierdzone na samym śladzie rozmowy to nadal „prawdopodobnie":
     zdanie źródła mówi wprost, że dowodu technicznego nie ma. */
  if (zastosowanie) {
    const orzeczenie = zastosowanie.pewnosc === "potwierdzone" ? "pasuje" : "prawdopodobnie pasuje";
    return `Do ${maszyna} ${orzeczenie} ${symbol} — źródło: ${zastosowanie.zdanieZrodla}.`;
  }
  return status === "confirmed"
    ? `Do ${maszyna} pasuje ${symbol} — ${zrodlo}.`
    : `Do ${maszyna} prawdopodobnie pasuje ${symbol} — ${zrodlo}; dobór bez potwierdzonego zastosowania.`;
}

/** Zatwierdzone POZYTYWNE zastosowanie wybranej kartoteki do wpisanej maszyny — albo nic. */
function zastosowanieWyboru(database: DatabaseSync, dane: DaneDoboru, twId: number): Zastosowanie | null {
  if (!dane.marka || !dane.model) return null;
  return zastosowaniaModelu(kluczModelu("maszyna", dane.marka, dane.model, dane.wariant), database)
    .find((z) => z.twId === twId && z.polaryzacja === "pasuje") ?? null;
}

function naDobor(w: Record<string, unknown> | undefined, database: DatabaseSync): Dobor {
  if (!w) {
    return { status: "not_started", wersja: 1, dane: PUSTE, brakuje: null, wybrany: null,
      updatedBy: null, updatedAt: null };
  }
  const dane: DaneDoboru = { ...PUSTE, parametry: {} };
  for (const [pole, kolumna] of POLA) dane[pole] = w[kolumna] == null ? null : String(w[kolumna]);
  try {
    dane.parametry = w.parametry_json ? JSON.parse(String(w.parametry_json)) as Record<string, string> : {};
  } catch { dane.parametry = {}; }
  const status = String(w.status) as StatusDoboru;
  const droga = w.wybrany_droga == null ? null : String(w.wybrany_droga) as DrogaDoboru;
  return {
    status, wersja: Number(w.wersja), dane,
    brakuje: w.brakuje == null ? null : String(w.brakuje),
    wybrany: w.wybrany_tw_id == null || droga === null ? null : {
      twId: Number(w.wybrany_tw_id), symbol: String(w.wybrany_symbol), droga,
      przez: String(w.wybrano_przez ?? "?"), at: String(w.wybrano_at ?? ""),
      zdanieDoSzkicu: zdanieDoSzkicu(dane, String(w.wybrany_symbol), droga, status,
        zastosowanieWyboru(database, dane, Number(w.wybrany_tw_id))),
    },
    updatedBy: w.updated_by == null ? null : String(w.updated_by),
    updatedAt: w.updated_at == null ? null : String(w.updated_at),
  };
}

/** Dobór rozmowy. Bez wiersza — `not_started`, i NIC nie zapisuje. */
export function doborRozmowy(conversationId: number, database: DatabaseSync = db()): Dobor {
  istniejeRozmowa(database, conversationId);
  return naDobor(wiersz(database, conversationId), database);
}

/* Wersja pilnuje DANYCH i WYBORU, nie statusu. Dwóch agentów przy jednym
   doborze to ten sam wyścig, co przy szkicu: cichy zapis gubi cudze chipy.
   Odmowa niesie bieżący stan, żeby ekran pokazał, co się zmieniło. */
function sprawdzWersje(database: DatabaseSync, conversationId: number, expectedVersion: number): Dobor {
  const biezacy = naDobor(wiersz(database, conversationId), database);
  if (!Number.isInteger(expectedVersion)) throw new Error("Zapis doboru wymaga oczekiwanej wersji");
  if (biezacy.wersja !== expectedVersion) {
    throw new ConversationConflict("Ktoś zmienił dobór, zanim doszedł zapis — odśwież",
      { wersja: biezacy.wersja, updatedBy: biezacy.updatedBy, dobor: biezacy });
  }
  return biezacy;
}

/** Wiersz musi istnieć, zanim `UPDATE` ma co zmienić; sam INSERT nic nie mówi. */
function upewnijWiersz(database: DatabaseSync, conversationId: number): void {
  database.prepare("INSERT OR IGNORE INTO dobor_rozmowy(conversation_id) VALUES (?)").run(conversationId);
}

function podpisz(database: DatabaseSync, conversationId: number, autor: string, userId: number): void {
  database.prepare(`UPDATE dobor_rozmowy SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_by=?, updated_user_id=? WHERE conversation_id=?`).run(autor, userId, conversationId);
}

function slad(
  database: DatabaseSync, conversationId: number, typOsi: string, typAudytu: string,
  dane: Record<string, unknown>, autor: string, userId: number,
): void {
  database.prepare(`INSERT INTO conversation_event(conversation_id, event_type, payload)
    VALUES (?,?,?)`).run(conversationId, typOsi, JSON.stringify({ ...dane, autor }));
  logEvent(typAudytu, autor, null, { conversationId, ...dane }, userId, database);
}

/* Zmiana statusu w JEDNYM miejscu, także ta samoczynna (wybór podnosi do
   `candidates_found`): każda zostawia kreskę na osi z „przed → po". */
function zmienStatus(
  database: DatabaseSync, conversationId: number, przed: StatusDoboru, po: StatusDoboru,
  brakuje: string | null, autor: string, userId: number,
): void {
  database.prepare("UPDATE dobor_rozmowy SET status=?, brakuje=? WHERE conversation_id=?")
    .run(po, brakuje, conversationId);
  slad(database, conversationId, "dobor_status_changed", "dobor_status",
    { przed, po, ...(brakuje ? { brakuje } : {}) }, autor, userId);
}

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/**
 * Zapis danych wejściowych. UPSERT z wersją; nic niezmienionego nie zapisuje
 * ani nie zostawia śladu — odświeżenie formularza bez zmian nie ma prawa
 * podnosić wersji koledze.
 *
 * Pierwszy zapis danych podnosi `not_started` do `searching`: skoro agent
 * wpisał, o jaką maszynę chodzi, dobór SIĘ ZACZĄŁ, a wiersz z danymi
 * w `not_started` znikałby z plakietki kolejki.
 */
export function zapiszDane(
  conversationId: number, dane: Partial<DaneDoboru>, expectedVersion: number, userId: number,
  database: DatabaseSync = db(),
): Dobor {
  istniejeRozmowa(database, conversationId);
  const autor = imie(database, userId);
  const wynik = transaction(database, () => {
    const przed = sprawdzWersje(database, conversationId, expectedVersion);
    const nowe: DaneDoboru = { ...przed.dane };
    const zmiany: Record<string, { z: unknown; na: unknown }> = {};
    for (const [pole] of POLA) {
      if (!(pole in dane)) continue;
      const v = oczysc(dane[pole]);
      if (v !== przed.dane[pole]) { zmiany[pole] = { z: przed.dane[pole], na: v }; nowe[pole] = v; }
    }
    if (dane.parametry) {
      const parametry: Record<string, string> = {};
      for (const [k, v] of Object.entries(dane.parametry)) {
        const klucz = oczysc(k); const wartosc = oczysc(v);
        if (klucz && wartosc) parametry[klucz] = wartosc;
      }
      if (JSON.stringify(parametry) !== JSON.stringify(przed.dane.parametry)) {
        zmiany.parametry = { z: przed.dane.parametry, na: parametry }; nowe.parametry = parametry;
      }
    }
    if (Object.keys(zmiany).length === 0) return przed;

    upewnijWiersz(database, conversationId);
    database.prepare(`UPDATE dobor_rozmowy SET marka=?, model=?, wariant=?, rocznik=?, nr_seryjny=?,
      silnik=?, oem=?, nazwa_czesci=?, parametry_json=?, wersja=wersja+1 WHERE conversation_id=?`)
      .run(nowe.marka, nowe.model, nowe.wariant, nowe.rocznik, nowe.nrSeryjny, nowe.silnik,
        nowe.oem, nowe.nazwaCzesci, Object.keys(nowe.parametry).length ? JSON.stringify(nowe.parametry) : null,
        conversationId);
    podpisz(database, conversationId, autor, userId);
    logEvent("dobor_dane", autor, null, { conversationId, zmiany }, userId, database);
    if (przed.status === "not_started") {
      zmienStatus(database, conversationId, "not_started", "searching", null, autor, userId);
    }
    return naDobor(wiersz(database, conversationId), database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { dobor: true });
  return wynik;
}

/**
 * Ręczna zmiana statusu (§7). Bez wersji — jak przy statusie rozmowy: status
 * nie jest treścią, którą dwoje ludzi pisze naraz, a oś pokazuje oba przejścia.
 *
 * `confirmed` wymaga WYBORU: zatwierdzenie doboru bez kartoteki nie mówi
 * niczego, co dałoby się wstawić do szkicu. `missing_information` niesie,
 * czego dopytać; opuszczenie tego stanu kasuje notatkę, bo byłaby nieaktualna.
 */
export function ustawStatusDoboru(
  conversationId: number, status: string, brakuje: string | null | undefined, userId: number,
  database: DatabaseSync = db(),
): Dobor {
  istniejeRozmowa(database, conversationId);
  if (status === "extracting_data") {
    throw new Error("Stan „extracting_data” nadaje Copilot, nie człowiek — w tym wydaniu nie ma go kto ustawić");
  }
  if (!STATUSY_DOBORU_RECZNE.includes(status as StatusDoboru)) throw new Error(`Nieznany status doboru: ${status}`);
  const po = status as StatusDoboru;
  const autor = imie(database, userId);
  const wynik = transaction(database, () => {
    const przed = naDobor(wiersz(database, conversationId), database);
    if (po === "confirmed" && !przed.wybrany) {
      throw new Error("Zatwierdzenie doboru wymaga wybranej kartoteki");
    }
    const notatka = po === "missing_information" ? (oczysc(brakuje) ?? przed.brakuje) : null;
    if (przed.status === po && przed.brakuje === notatka) return przed;
    upewnijWiersz(database, conversationId);
    zmienStatus(database, conversationId, przed.status, po, notatka, autor, userId);
    /* WIEDZA ROŚNIE Z PRACY (E2): zatwierdzony dobór z marką i modelem
       staje się PROPOZYCJĄ zastosowania — z dowodem „rozmowa", do kolejki,
       nigdy faktem. Bez marki albo modelu nie ma do czego pasować, więc nic
       nie powstaje. W tej samej transakcji: dobór bez propozycji albo
       propozycja bez doboru byłyby stanem w połowie. */
    if (po === "confirmed" && przed.wybrany && przed.dane.marka && przed.dane.model) {
      zaproponujZastosowanie({
        twId: przed.wybrany.twId,
        model: { rodzaj: "maszyna", marka: przed.dane.marka, nazwa: przed.dane.model, wariant: przed.dane.wariant },
        polaryzacja: "pasuje", zrodlo: "dobor", conversationId,
        dowod: { rodzaj: "rozmowa", tresc: `dobór zatwierdzony w rozmowie #${conversationId} przez ${autor}` },
      }, { userId, name: autor }, database);
    }
    podpisz(database, conversationId, autor, userId);
    return naDobor(wiersz(database, conversationId), database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { dobor: true });
  return wynik;
}

/**
 * Wybór kandydata; `null` zdejmuje. Symbol idzie Z BAZY, nie z żądania —
 * wzorzec `potwierdzKartoteke` ze zwrotów: panel mógłby przysłać symbol
 * z nieświeżej listy, a kartoteka pod tym `tw_id` już się nazywa inaczej.
 *
 * Wybór sam podnosi status do `candidates_found` — fakt się wydarzył, agent nie
 * musi go klikać drugi raz (ta sama lekcja, co `waiting_for_internal` z pomiaru).
 * Zdjęcie wyboru przy `confirmed` cofa do `candidates_found`, bo zatwierdzenie
 * dotyczyło TEJ kartoteki, nie doboru w ogóle.
 */
export function wybierzKandydata(
  conversationId: number, twId: number | null, droga: string, expectedVersion: number, userId: number,
  database: DatabaseSync = db(),
): Dobor {
  istniejeRozmowa(database, conversationId);
  const autor = imie(database, userId);
  const wynik = transaction(database, () => {
    const przed = sprawdzWersje(database, conversationId, expectedVersion);
    upewnijWiersz(database, conversationId);

    if (twId === null) {
      if (!przed.wybrany) return przed;
      database.prepare(`UPDATE dobor_rozmowy SET wybrany_tw_id=NULL, wybrany_symbol=NULL, wybrany_droga=NULL,
        wybrano_przez=NULL, wybrano_user_id=NULL, wybrano_at=NULL, wersja=wersja+1 WHERE conversation_id=?`)
        .run(conversationId);
      slad(database, conversationId, "dobor_wybor_zdjety", "dobor_wybor_zdjety",
        { twId: przed.wybrany.twId, symbol: przed.wybrany.symbol }, autor, userId);
      if (przed.status === "confirmed") {
        zmienStatus(database, conversationId, "confirmed", "candidates_found", null, autor, userId);
        /* Automat sprząta po sobie: własna, NIEROZSTRZYGNIĘTA propozycja
           z tej rozmowy schodzi. Zatwierdzonej nie dotyka (§14.2). */
        wycofajPropozycjeDoboru(conversationId, przed.wybrany.twId, { userId, name: autor }, database);
      }
      podpisz(database, conversationId, autor, userId);
      return naDobor(wiersz(database, conversationId), database);
    }

    if (!DROGI_Z_NADAWCA.includes(droga as DrogaDoboru)) {
      throw new Error(`Droga „${droga}” nie ma w tym wydaniu nadawcy — wybierz kandydata z listy albo z wyszukiwarki`);
    }
    const t = database.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(twId) as
      { symbol: string } | undefined;
    if (!t) throw new Error("Nie ma takiej kartoteki w Subiekcie");
    database.prepare(`UPDATE dobor_rozmowy SET wybrany_tw_id=?, wybrany_symbol=?, wybrany_droga=?,
      wybrano_przez=?, wybrano_user_id=?, wybrano_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      wersja=wersja+1 WHERE conversation_id=?`)
      .run(twId, t.symbol, droga, autor, userId, conversationId);
    slad(database, conversationId, "dobor_wybrano", "dobor_wybor",
      { twId, symbol: t.symbol, droga }, autor, userId);
    if (przed.status !== "candidates_found") {
      zmienStatus(database, conversationId, przed.status, "candidates_found", null, autor, userId);
      if (przed.status === "confirmed" && przed.wybrany) {
        wycofajPropozycjeDoboru(conversationId, przed.wybrany.twId, { userId, name: autor }, database);
      }
    }
    podpisz(database, conversationId, autor, userId);
    return naDobor(wiersz(database, conversationId), database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { dobor: true });
  return wynik;
}

/* ── Wiedza przy doborze (E2) ─────────────────────────────────────────────── */

export interface PomiarRozmowy {
  zadanieId: number; tytul: string; wynik: string; wykonanoAt: string; wykonanoPrzez: string;
  twId: number | null; symbol: string | null;
  /** Ten pomiar już stoi jako dowód w bazie wiedzy — drugi raz nie proponujemy. */
  zaproponowano: boolean;
}

/**
 * Co baza wiedzy mówi o WYBRANEJ kartotece i jakie pomiary z tej rozmowy
 * mogą stać się dowodem. Osobna trasa, nie `osRozmowy`: tamten odczyt
 * odświeża się na każde zdarzenie szyny, a to są dwa dodatkowe zapytania.
 */
export function wiedzaDoboru(conversationId: number, database: DatabaseSync = db()): {
  zastosowanie: Zastosowanie | null; pomiary: PomiarRozmowy[];
} {
  const dobor = doborRozmowy(conversationId, database);
  const zastosowanie = dobor.wybrany ? zastosowanieWyboru(database, dobor.dane, dobor.wybrany.twId) : null;
  const pomiary = (database.prepare(`
    SELECT z.id, z.tytul, z.wynik, z.wykonano_at, z.wykonano_przez, z.tw_id, t.symbol,
           EXISTS(SELECT 1 FROM dowod_zastosowania d WHERE d.zadanie_id = z.id) AS zaproponowano
      FROM zadanie_terenowe z LEFT JOIN sgt_towar t ON t.tw_id = z.tw_id
     WHERE z.conversation_id=? AND z.status='wykonane' AND z.wynik IS NOT NULL ORDER BY z.wykonano_at`)
    .all(conversationId) as Array<Record<string, unknown>>).map((z) => ({
      zadanieId: Number(z.id), tytul: String(z.tytul), wynik: String(z.wynik),
      wykonanoAt: String(z.wykonano_at), wykonanoPrzez: String(z.wykonano_przez ?? "hala"),
      twId: z.tw_id == null ? null : Number(z.tw_id), symbol: z.symbol == null ? null : String(z.symbol),
      zaproponowano: Boolean(Number(z.zaproponowano ?? 0)),
    }));
  return { zastosowanie, pomiary };
}

/**
 * Wynik pomiaru z tej rozmowy jako propozycja wiedzy (§13.4). Model bierze
 * się z DANYCH DOBORU — bez marki i modelu nie ma do czego pasować, więc
 * odmowa mówi, co wpisać, zamiast wstawiać wiedzę bez maszyny.
 */
export function pomiarDoWiedzy(
  conversationId: number,
  p: { zadanieId: number; twId?: number | null; polaryzacja: Polaryzacja; powodNegatywny?: PowodNegatywny | null },
  userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const dobor = doborRozmowy(conversationId, database);
  if (!dobor.dane.marka || !dobor.dane.model) {
    throw new Error("Wpisz markę i model maszyny w danych doboru — pomiar musi wiedzieć, do czego pasuje");
  }
  const nalezy = database.prepare("SELECT 1 FROM zadanie_terenowe WHERE id=? AND conversation_id=?")
    .get(p.zadanieId, conversationId);
  if (!nalezy) throw new Error("To zadanie nie należy do tej rozmowy");
  return propozycjaZPomiaru(p.zadanieId, {
    twId: p.twId ?? dobor.wybrany?.twId ?? null,
    model: { rodzaj: "maszyna", marka: dobor.dane.marka, nazwa: dobor.dane.model, wariant: dobor.dane.wariant },
    polaryzacja: p.polaryzacja, powodNegatywny: p.powodNegatywny ?? null,
  }, userId, database);
}
