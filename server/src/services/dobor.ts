import type { DatabaseSync } from "node:sqlite";
import { db, transaction } from "../db/db.js";
import { logEvent } from "./events.js";
import { ConversationConflict } from "./conversations.js";
import { publishConversationEvent } from "./conversation-realtime.js";
import {
  kluczModelu, propozycjaZPomiaru, wycofajPropozycjeDoboru, zaproponujZastosowanie, zastosowaniaModelu,
  type Polaryzacja, type PowodNegatywny, type Zastosowanie,
} from "./wiedza.js";
import { zabudowyMaszyny, type Zabudowa } from "./silniki.js";
import { pasowaniaTowaru, type TrafieniePasowania } from "./pasowania.js";
import { szukajPoIdentyfikatorze } from "./identyfikatory.js";
import { bezPodpisu, zwin } from "../tekst.js";
import { ocenWarunki } from "./warunki-zastosowania.js";

/**
 * Dobór części przy rozmowie — kontrakt w `docs/dobor-od-zera.md`.
 *
 * Agent odpowiada klientowi jedną z czterech rzeczy: ta część, nie mamy,
 * dopytać albo nie dotyczy. Wynik ustawia WYŁĄCZNIE człowiek, a stan dla
 * kolejki wylicza się z danych i wyniku. Stan zapisany obok faktów
 * rozjeżdża się z nimi, a automat, który go nadaje, musi go potem cofać.
 *
 * Brak wiersza znaczy dobór pusty i liczy się przy odczycie, więc otwarcie
 * zakładki niczego nie wstawia.
 */

export const WYNIKI_DOBORU = ["czesc", "brak", "dopytac", "nie_dotyczy"] as const;
export type WynikDoboru = (typeof WYNIKI_DOBORU)[number];
export type StanDoboru = "pusty" | "otwarty" | WynikDoboru;
export const PODSTAWY_WYBORU = ["numer", "wiedza", "podobne", "reczny"] as const;
export type PodstawaWyboru = (typeof PODSTAWY_WYBORU)[number];

export interface DaneDoboru {
  marka: string | null; model: string | null; wariant: string | null;
  rocznik: string | null; nrSeryjny: string | null; silnik: string | null;
  oem: string | null; nazwaCzesci: string | null;
}

export interface Dobor {
  stan: StanDoboru;
  wynik: WynikDoboru | null;
  wersja: number;
  dane: DaneDoboru;
  /** Tylko przy wyniku `czesc`. */
  wybrany: { twId: number; symbol: string; podstawa: PodstawaWyboru; zdanieDoSzkicu: string } | null;
  /** Tylko przy wyniku `dopytac`. */
  dopytac: string | null;
  zmienil: string | null;
  /** Ostatni zapis zrobił automat, nie człowiek. */
  zmienilAutomat: boolean;
  zmienionoAt: string | null;
}

const POLA: Array<[keyof DaneDoboru, string]> = [
  ["marka", "marka"], ["model", "model"], ["wariant", "wariant"], ["rocznik", "rocznik"],
  ["nrSeryjny", "nr_seryjny"], ["silnik", "silnik"], ["oem", "oem"], ["nazwaCzesci", "nazwa_czesci"],
];

/* Pola, które opisują MASZYNĘ. Ich zmiana zdejmuje wybraną część, bo wybór
   dotyczył innej maszyny. Silnik, numer i nazwa części opisują pytanie, nie
   egzemplarz, więc wyboru nie ruszają. */
const POLA_MASZYNY: Array<keyof DaneDoboru> = ["marka", "model", "wariant", "rocznik", "nrSeryjny"];

const PUSTE: DaneDoboru = {
  marka: null, model: null, wariant: null, rocznik: null, nrSeryjny: null, silnik: null, oem: null, nazwaCzesci: null,
};

/**
 * Stan doboru w SQL, dla wiersza tabeli `dobor` pod aliasem. Jedna definicja
 * dla kolejki i miar: dwie kopie reguły „otwarty" rozjechałyby się przy
 * pierwszym nowym polu. Brak wiersza (LEFT JOIN) daje `pusty`.
 */
export const stanDoboruSql = (a: string): string => `CASE WHEN ${a}.wynik IS NOT NULL THEN ${a}.wynik
  WHEN COALESCE(${POLA.map(([, k]) => `${a}.${k}`).join(", ")}) IS NOT NULL THEN 'otwarty'
  ELSE 'pusty' END`;

/* Zdanie źródła do szkicu przy wyborze BEZ podparcia w wiedzy. Panel go nie
   układa: druga kopia listy rozjechałaby się przy pierwszej poprawce. */
const ZDANIE_PODSTAWY: Record<PodstawaWyboru, string> = {
  numer: "numer albo oferta wskazane przez klienta",
  wiedza: "wpis bazy wiedzy bez potwierdzenia",
  podobne: "trafienie po nazwie — nie dowód",
  reczny: "wskazane ręcznie przez agenta",
};

/** Kto zapisuje: konto człowieka albo nazwany automat. */
export type AutorDanych = number | { automat: string };

/* Automat NIE UDAJE CZŁOWIEKA: podpis `automat (…)` przy pustym
   `zmienil_user_id` to jedyny znacznik, który odróżnia wpis maszyny od
   wpisu agenta. Ten sam wzorzec co przy wiedzy i szkicu. */
function ktoPisze(database: DatabaseSync, kto: AutorDanych): { autor: string; userId: number | null } {
  if (typeof kto === "number") return { autor: imie(database, kto), userId: kto };
  return { autor: `automat (${kto.automat})`, userId: null };
}

function imie(database: DatabaseSync, userId: number): string {
  const u = database.prepare("SELECT name FROM app_user WHERE user_id=?").get(userId) as { name: string } | undefined;
  return u?.name ?? `konto ${userId}`;
}

function istniejeRozmowa(database: DatabaseSync, conversationId: number): void {
  if (!database.prepare("SELECT 1 FROM conversation WHERE id=?").get(conversationId)) {
    throw new Error("Nie znaleziono rozmowy");
  }
}

const wiersz = (database: DatabaseSync, conversationId: number) =>
  database.prepare("SELECT * FROM dobor WHERE conversation_id=?").get(conversationId) as
    Record<string, unknown> | undefined;

const tekst = (v: unknown): string | null => (v == null ? null : String(v));
const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** Urządzenie jednym zdaniem: „NAC LS 46-450 (2019)". Puste, gdy nic nie wiadomo. */
function urzadzenie(dane: DaneDoboru): string {
  const nazwa = [dane.marka, dane.model, dane.wariant].filter(Boolean).join(" ");
  if (!nazwa) return "";
  return dane.rocznik ? `${nazwa} (${dane.rocznik})` : nazwa;
}

/**
 * Zdanie do szkicu. Pisze je SERWER, ze źródłem, i nie zależy od wyniku:
 * wybór agenta nie jest dowodem, więc sam go nie wzmacnia.
 *
 * „Pasuje" bez „prawdopodobnie" wolno napisać wyłącznie przy potwierdzonym
 * wpisie w wiedzy. Bez podparcia zdanie mówi, skąd agent wziął część, i że
 * to przypuszczenie. Klient, któremu obiecaliśmy „pasuje" bez dowodu,
 * odsyła część jako „nie pasuje".
 *
 * Do klienta idzie źródło z datą, BEZ nazwiska pracownika. Wycięcie na
 * wyjściu, w jednym miejscu, bo każda gałąź wkleja czyjś podpis.
 */
function zdanieDoSzkicu(
  dane: DaneDoboru, symbol: string, podstawa: PodstawaWyboru,
  podparcie: { zastosowanie: Zastosowanie; zabudowa: Zabudowa | null } | null,
  pasowanie: TrafieniePasowania | null,
  pozaZakresem: { zastosowanie: Zastosowanie; zdanie: string } | null,
): string {
  const maszyna = urzadzenie(dane);
  /* Wpis jest, ale rocznik albo numer z doboru leży POZA jego zakresem.
     Zdanie mówi wprost, że wybór stoi w poprzek wiedzy, i dlaczego. */
  if (!podparcie && pozaZakresem && maszyna) {
    return bezPodpisu(`${symbol} do ${maszyna} może nie pasować — ${pozaZakresem.zdanie};`
      + ` źródło: ${pozaZakresem.zastosowanie.zdanieZrodla}.`);
  }
  if (podparcie && maszyna) {
    const { zastosowanie, zabudowa } = podparcie;
    /* Warunek, którego dobór nie umie sprawdzić („nr seryjny od X" bez
       numeru w danych), zbija „pasuje" do „prawdopodobnie". Łańcuch przez
       silnik jest wart tyle, co jego słabsze ogniwo, jak w `kandydaci.ts`. */
    const warunkowo = ocenWarunki(zastosowanie.warunki, dane, zabudowa ? "silnika" : "maszyny").ocena === "nieznane";
    const pewne = zastosowanie.pewnosc === "potwierdzone" && !warunkowo
      && (zabudowa === null || zabudowa.pewnosc === "potwierdzone");
    const orzeczenie = pewne ? "pasuje" : "prawdopodobnie pasuje";
    /* Zdanie przez silnik nazywa OBA ogniwa: klient ma prawo wiedzieć, że
       dopasowanie idzie przez silnik, a nie wprost do jego maszyny. */
    if (zabudowa) {
      return bezPodpisu(`Do ${maszyna} ${orzeczenie} ${symbol} — pasuje do ${zabudowa.silnik.etykieta},`
        + ` który stoi w tej maszynie; źródło: ${zastosowanie.zdanieZrodla}; ${zabudowa.zdanieZrodla}.`);
    }
    return bezPodpisu(`Do ${maszyna} ${orzeczenie} ${symbol} — źródło: ${zastosowanie.zdanieZrodla}.`);
  }
  /* PASOWANIE nie potrzebuje maszyny: klient nazwał GAŹNIK, nie kosiarkę. */
  if (pasowanie) {
    const p = pasowanie.pasowanie;
    const orzeczenie = pasowanie.pewnosc === "potwierdzone" ? "pasuje" : "prawdopodobnie pasuje";
    const co = `${p.nazwaRoli}${p.pozycja ? `, ${p.pozycja}` : ""}`;
    return bezPodpisu(`Do ${pasowanie.doCzego.symbol} ${orzeczenie} ${symbol} (${co}) — źródło: ${pasowanie.zdanie}.`);
  }
  /* Trafienie po numerze mówi, co WIEMY: to część o numerze, który podał
     klient. Zgodności z maszyną nie twierdzi, bo baza jej nie zna. */
  if (podstawa === "numer") {
    return `${symbol} to część o numerze z pytania klienta`
      + `${maszyna ? `; zgodności z ${maszyna} baza wiedzy nie potwierdza` : ""}.`;
  }
  const zrodlo = `źródło: ${ZDANIE_PODSTAWY[podstawa]}`;
  if (!maszyna) return `${symbol} — ${zrodlo}; dobór bez wskazanej maszyny — to przypuszczenie.`;
  return `Do ${maszyna} prawdopodobnie pasuje ${symbol} — ${zrodlo}; bez potwierdzonego zastosowania.`;
}

/**
 * Czym podparty jest wybór: zastosowaniem do MASZYNY albo, gdy takiego nie
 * ma, zastosowaniem do jej zatwierdzonego SILNIKA. Bez drugiej gałęzi szkic
 * mówiłby „bez potwierdzonego zastosowania" przy pełnym dowodzie w bazie.
 */
function zastosowanieWyboru(
  database: DatabaseSync, dane: DaneDoboru, twId: number,
): { zastosowanie: Zastosowanie; zabudowa: Zabudowa | null } | null {
  if (!dane.marka || !dane.model) return null;
  const kluczMaszyny = kluczModelu("maszyna", dane.marka, dane.model, dane.wariant);
  /* Wpis ZŁAMANY przez rocznik albo numer nie podpiera wyboru: katalog,
     który mówi „od nr X", pod X wskazuje inną część. */
  const wprost = zastosowaniaModelu(kluczMaszyny, database)
    .find((z) => z.twId === twId && z.polaryzacja === "pasuje"
      && ocenWarunki(z.warunki, dane, "maszyny").ocena !== "niespelnione");
  if (wprost) return { zastosowanie: wprost, zabudowa: null };
  for (const zab of zabudowyMaszyny(kluczMaszyny, database)) {
    /* Wpisu do silnika tabliczka maszyny nie łamie — patrz `ocenWarunki`. */
    const przezSilnik = zastosowaniaModelu(zab.silnik.klucz, database)
      .find((z) => z.twId === twId && z.polaryzacja === "pasuje");
    if (przezSilnik) return { zastosowanie: przezSilnik, zabudowa: zab };
  }
  return null;
}

/** Wpis o wybranej części do TEJ maszyny, którego zakres łamią dane doboru. */
function pozaZakresemWyboru(
  database: DatabaseSync, dane: DaneDoboru, twId: number,
): { zastosowanie: Zastosowanie; zdanie: string } | null {
  if (!dane.marka || !dane.model) return null;
  for (const z of zastosowaniaModelu(kluczModelu("maszyna", dane.marka, dane.model, dane.wariant), database)) {
    if (z.twId !== twId || z.polaryzacja !== "pasuje") continue;
    const o = ocenWarunki(z.warunki, dane, "maszyny");
    if (o.ocena === "niespelnione") return { zastosowanie: z, zdanie: o.zdanie! };
  }
  return null;
}

/**
 * Pasowanie, którym podparty jest wybór: wybrana część pasuje DO kartoteki,
 * którą agent wskazał w danych (symbol albo numer w polu OEM lub nazwie).
 */
function pasowanieWyboru(database: DatabaseSync, dane: DaneDoboru, twId: number): TrafieniePasowania | null {
  const wpisane = [dane.oem, dane.nazwaCzesci].filter((v): v is string => Boolean(v));
  if (wpisane.length === 0) return null;
  const { pasujeDo } = pasowaniaTowaru(twId, database);
  if (pasujeDo.length === 0) return null;
  const zwiniete = wpisane.map(zwin);
  const cele = new Set(wpisane.flatMap((v) => szukajPoIdentyfikatorze(v, database).map((t) => t.twId)));
  return pasujeDo.find((t) => zwiniete.includes(zwin(t.doCzego.symbol)) || cele.has(t.doCzego.twId)) ?? null;
}

function naDobor(w: Record<string, unknown> | undefined, database: DatabaseSync): Dobor {
  if (!w) {
    return { stan: "pusty", wynik: null, wersja: 1, dane: { ...PUSTE }, wybrany: null, dopytac: null,
      zmienil: null, zmienilAutomat: false, zmienionoAt: null };
  }
  const dane = { ...PUSTE };
  for (const [pole, kolumna] of POLA) dane[pole] = tekst(w[kolumna]);
  const wynik = tekst(w.wynik) as WynikDoboru | null;
  const stan: StanDoboru = wynik ?? (POLA.some(([pole]) => dane[pole] !== null) ? "otwarty" : "pusty");
  const twId = w.tw_id == null ? null : Number(w.tw_id);
  let wybrany: Dobor["wybrany"] = null;
  if (wynik === "czesc" && twId !== null) {
    /* Podstawa bez wartości zdarza się tylko w wierszu przeniesionym ze
       starego doboru; wiemy wtedy tyle, że kartotekę wskazał agent. */
    const podstawa = (tekst(w.podstawa) ?? "reczny") as PodstawaWyboru;
    const symbol = String(w.symbol ?? twId);
    wybrany = { twId, symbol, podstawa, zdanieDoSzkicu: zdanieDoSzkicu(dane, symbol, podstawa,
      zastosowanieWyboru(database, dane, twId), pasowanieWyboru(database, dane, twId),
      pozaZakresemWyboru(database, dane, twId)) };
  }
  const zmienil = tekst(w.zmienil);
  return {
    stan, wynik, wersja: Number(w.wersja), dane, wybrany,
    dopytac: wynik === "dopytac" ? tekst(w.dopytac) : null,
    zmienil, zmienilAutomat: zmienil !== null && w.zmienil_user_id == null,
    zmienionoAt: tekst(w.zmieniono_at),
  };
}

/** Dobór rozmowy. Bez wiersza — pusty, i NIC nie zapisuje. */
export function doborRozmowy(conversationId: number, database: DatabaseSync = db()): Dobor {
  istniejeRozmowa(database, conversationId);
  return naDobor(wiersz(database, conversationId), database);
}

/* Dwóch agentów przy jednym doborze to ten sam wyścig, co przy szkicu:
   cichy zapis gubi cudze pola. Odmowa niesie bieżący stan, żeby ekran
   pokazał, co się zmieniło. */
function sprawdzWersje(database: DatabaseSync, conversationId: number, expectedVersion: number): Dobor {
  if (!Number.isInteger(expectedVersion)) throw new Error("Zapis doboru wymaga oczekiwanej wersji");
  const biezacy = naDobor(wiersz(database, conversationId), database);
  if (biezacy.wersja !== expectedVersion) {
    throw new ConversationConflict("Ktoś zmienił dobór, zanim doszedł zapis — odśwież",
      { wersja: biezacy.wersja, zmienil: biezacy.zmienil, dobor: biezacy });
  }
  return biezacy;
}

/** Wiersz, wersja i podpis w jednym kroku — każdy zapis kończy się tak samo. */
function zapisz(
  database: DatabaseSync, conversationId: number, kolumny: Record<string, unknown>, autor: string, userId: number | null,
): void {
  database.prepare("INSERT OR IGNORE INTO dobor(conversation_id) VALUES (?)").run(conversationId);
  const nazwy = Object.keys(kolumny);
  database.prepare(`UPDATE dobor SET ${nazwy.map((k) => `${k}=?`).join(", ")}, wersja=wersja+1,
      zmienil=?, zmienil_user_id=?, zmieniono_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE conversation_id=?`)
    .run(...(Object.values(kolumny) as Array<string | number | null>), autor, userId, conversationId);
}

/** Zmiana wyniku: kreska na osi rozmowy i wpis w dzienniku, jednym wywołaniem. */
function sladWyniku(
  database: DatabaseSync, conversationId: number, dane: Record<string, unknown>, autor: string, userId: number | null,
): void {
  database.prepare("INSERT INTO conversation_event(conversation_id, event_type, payload) VALUES (?,?,?)")
    .run(conversationId, "dobor_wynik", JSON.stringify({ ...dane, autor }));
  logEvent("dobor_wynik", autor, null, { conversationId, ...dane }, userId, database);
}

/**
 * Zapis danych. Zapisuje tylko zmienione pola; zapis bez zmian nie podnosi
 * wersji koledze i nie zostawia śladu.
 *
 * Zmiana maszyny przy wyniku `czesc` zdejmuje wynik w tej samej transakcji:
 * wybór dotyczył innej maszyny, a jego propozycja w wiedzy też.
 */
export function zapiszDane(
  conversationId: number, dane: Partial<DaneDoboru>, expectedVersion: number, kto: AutorDanych,
  database: DatabaseSync = db(),
): Dobor {
  istniejeRozmowa(database, conversationId);
  const { autor, userId } = ktoPisze(database, kto);
  const wynik = transaction(database, () => {
    const przed = sprawdzWersje(database, conversationId, expectedVersion);
    const kolumny: Record<string, string | null> = {};
    const zmiany: Record<string, { z: string | null; na: string | null }> = {};
    for (const [pole, kolumna] of POLA) {
      if (!(pole in dane)) continue;
      const v = oczysc(dane[pole]);
      if (v === przed.dane[pole]) continue;
      zmiany[pole] = { z: przed.dane[pole], na: v };
      kolumny[kolumna] = v;
    }
    if (Object.keys(zmiany).length === 0) return przed;
    const zdejmij = przed.wybrany && POLA_MASZYNY.some((p) => p in zmiany) ? przed.wybrany : null;
    zapisz(database, conversationId,
      zdejmij ? { ...kolumny, wynik: null, tw_id: null, symbol: null, podstawa: null } : kolumny, autor, userId);
    logEvent("dobor_dane", autor, null, { conversationId, zmiany }, userId, database);
    if (zdejmij) {
      wycofajPropozycjeDoboru(conversationId, zdejmij.twId, { userId, name: autor }, database);
      sladWyniku(database, conversationId, { przed: "czesc", po: null, symbol: zdejmij.symbol,
        podstawa: zdejmij.podstawa, powod: "zmiana maszyny w danych doboru" }, autor, userId);
    }
    return naDobor(wiersz(database, conversationId), database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { dobor: true });
  return wynik;
}

/**
 * Wynik doboru. Ustawia go wyłącznie człowiek; `null` otwiera dobór ponownie.
 *
 * Symbol idzie Z BAZY, nie z żądania: panel mógłby przysłać symbol z
 * nieświeżej listy, a kartoteka pod tym `tw_id` nazywa się już inaczej.
 *
 * WIEDZA ROŚNIE Z PRACY: wejście w `czesc` przy znanej marce i modelu rodzi
 * PROPOZYCJĘ zastosowania z dowodem „rozmowa", nigdy fakt. Zejście z tej
 * części wycofuje własną, nierozstrzygniętą propozycję. Wszystko w jednej
 * transakcji: wynik bez propozycji albo propozycja bez wyniku byłyby stanem
 * w połowie.
 */
export function ustawWynik(
  conversationId: number,
  p: { wynik: WynikDoboru | null; twId?: number | null; podstawa?: PodstawaWyboru | null; dopytac?: string | null },
  expectedVersion: number, userId: number, database: DatabaseSync = db(),
): Dobor {
  istniejeRozmowa(database, conversationId);
  const po = p.wynik ?? null;
  if (po !== null && !WYNIKI_DOBORU.includes(po)) throw new Error(`Nieznany wynik doboru: ${String(po)}`);
  const nowe: { tw_id: number | null; symbol: string | null; podstawa: PodstawaWyboru | null; dopytac: string | null } =
    { tw_id: null, symbol: null, podstawa: null, dopytac: null };
  if (po === "czesc") {
    if (!Number.isInteger(p.twId)) throw new Error("Wynik „ta część” wymaga wybranej kartoteki");
    if (!p.podstawa || !PODSTAWY_WYBORU.includes(p.podstawa)) {
      throw new Error("Wynik „ta część” wymaga podstawy wyboru: numer, wiedza, podobne albo reczny");
    }
    const t = database.prepare("SELECT symbol FROM sgt_towar WHERE tw_id=?").get(p.twId!) as { symbol: string } | undefined;
    if (!t) throw new Error("Nie ma takiej kartoteki w Subiekcie");
    Object.assign(nowe, { tw_id: p.twId!, symbol: t.symbol, podstawa: p.podstawa });
  }
  if (po === "dopytac") {
    nowe.dopytac = oczysc(p.dopytac);
    if (!nowe.dopytac) throw new Error("Wynik „dopytać” wymaga zdania, czego brakuje");
  }
  const autor = imie(database, userId);
  const kto = { userId, name: autor };
  const wynik = transaction(database, () => {
    const przed = sprawdzWersje(database, conversationId, expectedVersion);
    const byl = przed.wybrany;
    if (przed.wynik === po && (byl?.twId ?? null) === nowe.tw_id && (byl?.podstawa ?? null) === nowe.podstawa
      && przed.dopytac === nowe.dopytac) return przed;
    zapisz(database, conversationId, { wynik: po, ...nowe }, autor, userId);
    sladWyniku(database, conversationId, { przed: przed.wynik, po, symbol: nowe.symbol ?? byl?.symbol ?? null,
      podstawa: nowe.podstawa, ...(nowe.dopytac ? { dopytac: nowe.dopytac } : {}) }, autor, userId);
    if (byl && byl.twId !== nowe.tw_id) wycofajPropozycjeDoboru(conversationId, byl.twId, kto, database);
    const { marka, model, wariant } = przed.dane;
    /* Bez marki i modelu nie ma do czego pasować, więc nic nie powstaje.
       Duplikat tej samej pary `zaproponujZastosowanie` sam pomija. */
    if (po === "czesc" && marka && model) {
      zaproponujZastosowanie({
        twId: nowe.tw_id!, model: { rodzaj: "maszyna", marka, nazwa: model, wariant },
        polaryzacja: "pasuje", zrodlo: "dobor", conversationId,
        dowod: { rodzaj: "rozmowa", tresc: `część wybrana w rozmowie #${conversationId} przez ${autor}` },
      }, kto, database);
    }
    return naDobor(wiersz(database, conversationId), database);
  })();
  publishConversationEvent("assignment.changed", conversationId, { dobor: true });
  return wynik;
}

/* ── Wiedza przy doborze ─────────────────────────────────────────────────── */

export interface PomiarRozmowy {
  zadanieId: number; tytul: string; wynik: string; wykonanoAt: string; wykonanoPrzez: string;
  twId: number | null; symbol: string | null;
  /** Ten pomiar już stoi jako dowód w bazie wiedzy — drugi raz nie proponujemy. */
  zaproponowano: boolean;
}

/**
 * Co baza wiedzy mówi o WYBRANEJ kartotece, silniki maszyny i pomiary z tej
 * rozmowy, które mogą stać się dowodem. Osobna trasa, nie odczyt rozmowy:
 * tamten odświeża się na każde zdarzenie szyny.
 */
export function wiedzaDoboru(conversationId: number, database: DatabaseSync = db()): {
  zastosowanie: Zastosowanie | null; zabudowa: Zabudowa | null; pasowanie: TrafieniePasowania | null;
  silniki: Zabudowa[]; pomiary: PomiarRozmowy[];
} {
  const { dane, wybrany } = doborRozmowy(conversationId, database);
  const podparcie = wybrany ? zastosowanieWyboru(database, dane, wybrany.twId) : null;
  const silniki = dane.marka && dane.model
    ? zabudowyMaszyny(kluczModelu("maszyna", dane.marka, dane.model, dane.wariant), database) : [];
  const pomiary = (database.prepare(`
    SELECT z.id, z.tytul, z.wynik, z.wykonano_at, z.wykonano_przez, z.tw_id, t.symbol,
           EXISTS(SELECT 1 FROM dowod_zastosowania d WHERE d.zadanie_id = z.id) AS zaproponowano
      FROM zadanie_terenowe z LEFT JOIN sgt_towar t ON t.tw_id = z.tw_id
     WHERE z.conversation_id=? AND z.status='wykonane' AND z.wynik IS NOT NULL ORDER BY z.wykonano_at`)
    .all(conversationId) as Array<Record<string, unknown>>).map((z) => ({
      zadanieId: Number(z.id), tytul: String(z.tytul), wynik: String(z.wynik),
      wykonanoAt: String(z.wykonano_at), wykonanoPrzez: String(z.wykonano_przez ?? "hala"),
      twId: z.tw_id == null ? null : Number(z.tw_id), symbol: tekst(z.symbol),
      zaproponowano: Boolean(Number(z.zaproponowano ?? 0)),
    }));
  return { zastosowanie: podparcie?.zastosowanie ?? null, zabudowa: podparcie?.zabudowa ?? null,
    pasowanie: wybrany ? pasowanieWyboru(database, dane, wybrany.twId) : null, silniki, pomiary };
}

/**
 * Wynik pomiaru z tej rozmowy jako propozycja wiedzy. Model bierze się z
 * DANYCH DOBORU — bez marki i modelu odmowa mówi, co wpisać, zamiast
 * wstawiać wiedzę bez maszyny.
 */
export function pomiarDoWiedzy(
  conversationId: number,
  p: { zadanieId: number; twId?: number | null; polaryzacja: Polaryzacja; powodNegatywny?: PowodNegatywny | null },
  userId: number, database: DatabaseSync = db(),
): Zastosowanie {
  const { dane, wybrany } = doborRozmowy(conversationId, database);
  if (!dane.marka || !dane.model) {
    throw new Error("Wpisz markę i model maszyny w danych doboru — pomiar musi wiedzieć, do czego pasuje");
  }
  const nalezy = database.prepare("SELECT 1 FROM zadanie_terenowe WHERE id=? AND conversation_id=?")
    .get(p.zadanieId, conversationId);
  if (!nalezy) throw new Error("To zadanie nie należy do tej rozmowy");
  return propozycjaZPomiaru(p.zadanieId, {
    twId: p.twId ?? wybrany?.twId ?? null,
    model: { rodzaj: "maszyna", marka: dane.marka, nazwa: dane.model, wariant: dane.wariant },
    polaryzacja: p.polaryzacja, powodNegatywny: p.powodNegatywny ?? null,
  }, userId, database);
}
