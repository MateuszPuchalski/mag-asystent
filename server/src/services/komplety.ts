import { db as defaultDb, type Db } from "../db/db.js";
import { logEvent } from "./events.js";
import { iloscLiczona } from "./ilosc-zwrotu.js";
import { kartotekaPoSku } from "./dopasowanie-sku.js";

/* ── Komplet rozbity na paragonie (0.328.0) ─────────────────────────────────
   Zgłoszenie właściciela: „niektóre oferty są sprzedawane jako komplety, ale
   zbierane osobno na magazynie, więc produkty idące do koszyka zwrotów powinny
   być brane z paragonu jako źródła prawdy, bo na paragonie są rozbite pozycje".

   TABELA `oferta_kartoteka` MA KLUCZ `(konto, oferta)`, czyli jedna oferta
   wskazuje DOKŁADNIE JEDNĄ kartotekę. Komplet nie ma jak wskazać trzech i to
   nie jest przeoczenie — tak było projektowane, gdy komplety nie istniały.
   Dokładanie drugiego mapowania znaczyłoby drugie miejsce do utrzymania
   i drugie do rozjechania. Paragon już to rozbicie ma, bo Subiekt wystawia
   komplet osobnymi wierszami — i to jest DOKUMENT, a nie nasze mapowanie.

   REGUŁA WŁAŚCICIELA, zapisana dosłownie: „kartotekę tak, z paragonu, ale
   ilość bierze ze zwrotu". Paragon mówi CO wróciło na półkę, zwrot mówi ILE.
   Odwrotnie być nie może: paragon niesie CAŁE zamówienie, więc przy zwrocie
   częściowym jego ilości wrzuciłyby na stan sztuki, które zostały u klienta.

   ── Jak przypisujemy wiersze paragonu do oferty ──────────────────────────
   Odejmowaniem, bo dokument nie mówi, z której oferty pochodzi wiersz.
   Oferty zamówienia, które MAJĄ kartotekę, zabierają swoje wiersze; reszta
   dokumentu należy do oferty, która kartoteki nie ma — czyli do kompletu.
   Działa to wtedy i tylko wtedy, gdy taka oferta jest w zamówieniu JEDNA.
   Przy dwóch podziału nie da się zgadnąć i automat ma wtedy MILCZEĆ, a nie
   zgadywać: pomyłka kładzie na półkę cudzy towar i podnosi stan o sztuki,
   których nikt nie oddał. To wychodzi dopiero przy inwentaryzacji.

   Ustalony skład ZAPAMIĘTUJE SIĘ przy ofercie (`oferta_komplet`). Następny
   zwrot tego kompletu idzie już bez liczenia — także wtedy, gdy tamto
   zamówienie byłoby niejednoznaczne.                                        */

/** Jedna kartoteka wchodząca do koszyka. */
export interface Skladnik {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Sztuki POLICZONE dla tego zwrotu: ilość na komplet razy zwracane komplety. */
  ilosc: number;
}

export interface SkladPozycji {
  skladniki: Skladnik[];
  /**
   * Skąd wzięły się kartoteki:
   * `oferta` — mapowanie oferty, czyli droga sprzed tego wydania;
   * `paragon` — rozbicie z dokumentu sprzedaży;
   * `biuro` — człowiek wskazał wiersze dokumentu.
   */
  zrodlo: "oferta" | "paragon" | "biuro" | null;
  /** Zdanie na ekran, gdy składu NIE MA. Pisze je serwer, panel go nie układa. */
  powod: string | null;
}

type WierszPozycji = {
  zwrot_id: number; offer_id: string | null; tw_id: number | null; nazwa: string;
  ilosc: number; ilosc_zwrocona: number | null;
  channel_account_id: number; order_id: string | null; faktura_dok_id: number | null;
};

const PUSTY = (powod: string): SkladPozycji => ({ skladniki: [], zrodlo: null, powod });

/** Wiersze dokumentu sprzedaży, zsumowane po kartotece. */
function pozycjeDokumentu(database: Db, dokId: number): Map<number, number> {
  const w = database.prepare(
    `SELECT tw_id, SUM(ilosc) AS ilosc FROM sgt_faktura_pozycja WHERE dok_id=? GROUP BY tw_id`)
    .all(dokId) as Array<{ tw_id: number; ilosc: number }>;
  return new Map(w.map((x) => [Number(x.tw_id), Number(x.ilosc)]));
}

/** Symbol i nazwa kartoteki — na ekran i na dokument MM. */
function kartoteka(database: Db, twId: number): { symbol: string; nazwa: string } {
  const t = database.prepare("SELECT symbol, nazwa FROM sgt_towar WHERE tw_id=?")
    .get(twId) as { symbol: string; nazwa: string } | undefined;
  return { symbol: t?.symbol ?? String(twId), nazwa: t?.nazwa ?? `kartoteka ${twId}` };
}

/**
 * Skład zapamiętany przy ofercie — jeśli jest, rozstrzyga bez liczenia.
 *
 * Pierwszeństwo przed dokumentem jest CELOWE: raz ustalony skład kompletu nie
 * ma się zmieniać dlatego, że akurat tamto zamówienie wyglądało inaczej.
 */
function zapamietanySklad(
  database: Db, kontoId: number, offerId: string, ile: number,
): SkladPozycji | null {
  const w = database.prepare(
    `SELECT tw_id, ilosc_na_sztuke, zrodlo FROM oferta_komplet
      WHERE channel_account_id=? AND offer_id=? ORDER BY tw_id`)
    .all(kontoId, offerId) as
      Array<{ tw_id: number; ilosc_na_sztuke: number; zrodlo: string }>;
  if (!w.length) return null;
  return {
    skladniki: w.map((x) => ({
      twId: Number(x.tw_id),
      ...kartoteka(database, Number(x.tw_id)),
      ilosc: Number(x.ilosc_na_sztuke) * ile,
    })),
    zrodlo: w[0].zrodlo === "biuro" ? "biuro" : "paragon",
    powod: null,
  };
}

/**
 * Co naprawdę wchodzi do koszyka za tę pozycję zwrotu.
 *
 * CZYTA I NIC NIE ZAPISUJE, także wtedy, gdy skład właśnie wyliczyło
 * z dokumentu. Zasada „zero zapisu przy patrzeniu" obowiązuje tu podwójnie:
 * to samo wywołanie rysuje ekran zwrotu i przygotowuje dokument MM.
 * Zapamiętanie robi `zapamietajSklad` z drogi zapisu.
 */
export function skladPozycji(
  database: Db = defaultDb(), pozycjaId: number,
): SkladPozycji {
  const p = database.prepare(
    `SELECT p.zwrot_id, p.offer_id, p.tw_id, p.nazwa, p.ilosc, p.ilosc_zwrocona,
            z.channel_account_id, z.order_id, z.faktura_dok_id
       FROM zwrot_klienta_pozycja p
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE p.id=?`).get(pozycjaId) as WierszPozycji | undefined;
  if (!p) return PUSTY("Nie znaleziono pozycji zwrotu");

  const ile = iloscLiczona(p);

  if (p.offer_id) {
    const juz = zapamietanySklad(database, Number(p.channel_account_id), p.offer_id, ile);
    if (juz) return juz;
  }

  /* Bez wskazanego dokumentu zostaje droga sprzed tego wydania: kartoteka
     z mapowania oferty. To NIE jest gorszy wynik dla zwykłego towaru —
     mapowanie wskazuje wtedy tę samą kartotekę, którą wystawił Subiekt. */
  if (p.faktura_dok_id == null) {
    if (p.tw_id == null) return PUSTY("Pozycja nie ma kartoteki, a zwrot nie ma wskazanego dokumentu sprzedaży");
    return {
      skladniki: [{ twId: Number(p.tw_id), ...kartoteka(database, Number(p.tw_id)), ilosc: ile }],
      zrodlo: "oferta", powod: null,
    };
  }

  const naDokumencie = pozycjeDokumentu(database, Number(p.faktura_dok_id));
  if (naDokumencie.size === 0) {
    if (p.tw_id == null) return PUSTY("Wskazany dokument nie ma pozycji w kopii z Subiekta");
    return {
      skladniki: [{ twId: Number(p.tw_id), ...kartoteka(database, Number(p.tw_id)), ilosc: ile }],
      zrodlo: "oferta", powod: null,
    };
  }

  /* POZYCJA ZWYKŁA: jej kartoteka stoi na paragonie, więc dokument potwierdza
     mapowanie i nie ma czego rozbijać. Ilość i tak bierzemy ze zwrotu. */
  if (p.tw_id != null && naDokumencie.has(Number(p.tw_id))) {
    return {
      skladniki: [{ twId: Number(p.tw_id), ...kartoteka(database, Number(p.tw_id)), ilosc: ile }],
      zrodlo: "paragon", powod: null,
    };
  }

  return zKompletu(database, p, ile, naDokumencie);
}

/**
 * Kartoteka oferty ZAMÓWIENIA: z mapowania, a gdy go nie ma — po SKU (0.343.0).
 *
 * TO JEST POWÓD, DLA KTÓREGO AUTOMAT MILCZAŁ. Odejmowanie niżej wymaga, żeby
 * każda POZOSTAŁA oferta zamówienia miała kartotekę, a `oferta_kartoteka`
 * wypełnia się dopiero wtedy, gdy ktoś zatwierdzi kartotekę PRZY ZWROCIE tamtej
 * oferty. W zamówieniu na pięć różnych rzeczy nie ma jej prawie nigdy — więc
 * rozbicie kompletu odmawiało nie dlatego, że dane są złe, tylko dlatego, że
 * pytaliśmy nie o to źródło. Zgłoszenia właściciela z 0.336.0 („Ofert bez
 * kartoteki na tym dokumencie: 3" i „: 5") to była reguła, nie wyjątek.
 *
 * ODCZYT W LOCIE, NIE ZAPIS. Dopasowanie po SKU nie trafia do
 * `oferta_kartoteka`: tamta tabela jest PAMIĘCIĄ CZŁOWIEKA (§4.3 panelu —
 * wynik automatu nie ma udawać czyjejś decyzji), a my odpowiadamy tu tylko na
 * pytanie „czyj jest ten wiersz paragonu".
 *
 * DWA TRAFIENIA TO BRAK TRAFIENIA — tak samo jak przy propozycji kartoteki
 * (`kartotekaPoSku`). Symbol miał być unikalny; skoro nie jest, zgadywanie
 * przypisałoby wiersze paragonu cudzej ofercie, a to kładzie na półkę towar,
 * którego nikt nie oddał.
 */
function kartotekaOferty(
  database: Db, kontoId: number, offerId: string, sku: string | null,
): { tw_id: number } | undefined {
  const m = database.prepare(
    "SELECT tw_id FROM oferta_kartoteka WHERE channel_account_id=? AND offer_id=?")
    .get(kontoId, offerId) as { tw_id: number } | undefined;
  if (m) return m;
  const poSku = kartotekaPoSku(database, sku);
  return poSku.stan === "jedno" && poSku.twId !== null ? { tw_id: poSku.twId } : undefined;
}

/**
 * Rozbicie kompletu: wiersze dokumentu, których nie zabrała żadna inna oferta.
 *
 * Liczymy po OFERTACH ZAMÓWIENIA, nie po pozycjach zwrotu, i to jest sedno.
 * Paragon niesie całe zamówienie: gdyby odejmować tylko to, co klient oddał,
 * do kompletu doliczyłby się towar, który klient zatrzymał.
 */
function zKompletu(
  database: Db, p: WierszPozycji, ile: number, naDokumencie: Map<number, number>,
): SkladPozycji {
  if (!p.order_id || !p.offer_id) {
    return PUSTY("Bez numeru zamówienia nie da się przypisać wierszy paragonu do oferty");
  }

  const oferty = database.prepare(
    `SELECT o.offer_id, SUM(o.ilosc) AS ilosc, MIN(o.sku) AS sku
       FROM zamowienie_klienta_pozycja o
       JOIN zamowienie_klienta z ON z.id = o.zamowienie_id
      WHERE z.channel_account_id=? AND z.external_id=? AND o.offer_id IS NOT NULL
      GROUP BY o.offer_id`)
    .all(Number(p.channel_account_id), p.order_id) as
      Array<{ offer_id: string; ilosc: number; sku: string | null }>;
  if (!oferty.length) {
    return PUSTY("Zamówienia nie ma jeszcze w kopii — bez niego nie wiadomo, co jeszcze było na paragonie");
  }

  const zostalo = new Map(naDokumencie);
  const bezKartoteki: string[] = [];
  for (const o of oferty) {
    const m = kartotekaOferty(database, Number(p.channel_account_id), o.offer_id, o.sku);
    if (o.offer_id === p.offer_id) {
      /* Nasza oferta NIE zabiera sobie nic, nawet gdy ma mapowanie: trafiłaby
         tu tylko wtedy, gdy jej kartoteki na dokumencie NIE MA. */
      bezKartoteki.push(o.offer_id);
      continue;
    }
    if (!m || !zostalo.has(Number(m.tw_id))) {
      bezKartoteki.push(o.offer_id);
      continue;
    }
    /* Cudza oferta zabiera SWOJE sztuki, nie cały wiersz: ten sam towar bywa
       i w komplecie, i osobno w tym samym zamówieniu. */
    const twId = Number(m.tw_id);
    const reszta = Number(zostalo.get(twId)) - Number(o.ilosc);
    if (reszta > 0) zostalo.set(twId, reszta); else zostalo.delete(twId);
  }

  if (bezKartoteki.length > 1) {
    /* Bez odmiany przez przypadki: „są 5 oferty" czytało się jak usterka
       panelu, a to zdanie ma wysłać człowieka do roboty, nie do zgłoszenia. */
    return PUSTY(
      `Ofert bez kartoteki na tym dokumencie: ${bezKartoteki.length} — ` +
      "nie umiem rozdzielić wierszy paragonu; wskaż skład ręcznie");
  }
  if (zostalo.size === 0) {
    return PUSTY("Na paragonie nie zostało nic, co można przypisać tej ofercie");
  }

  /* NA JEDEN KOMPLET, nie na całe zamówienie: klient mógł kupić dwa zestawy
     i oddać jeden. Liczbę sprzedanych bierzemy z zamówienia, bo `ilosc`
     pozycji zwrotu mówi już o zwracanych. */
  const sprzedanych = Math.max(1, Number(
    oferty.find((o) => o.offer_id === p.offer_id)?.ilosc ?? 1));

  const skladniki = [...zostalo.entries()]
    .map(([twId, iloscNaDok]) => ({
      twId,
      ...kartoteka(database, twId),
      ilosc: (iloscNaDok / sprzedanych) * ile,
    }))
    .sort((a, b) => a.twId - b.twId);

  return { skladniki, zrodlo: "paragon", powod: null };
}

/**
 * Zapisuje ustalony skład przy ofercie. Woła to DROGA ZAPISU, nigdy odczyt.
 *
 * Bez tego każdy zwrot liczyłby skład od nowa — a to znaczy, że komplet
 * z niejednoznacznego zamówienia raz wchodziłby do koszyka, a raz nie,
 * zależnie od tego, co klient dokupił.
 */
export function zapamietajSklad(
  database: Db, kontoId: number, offerId: string, skladniki: Skladnik[],
  naSztuke: (s: Skladnik) => number, zrodlo: "paragon" | "biuro",
  kto: { id: number | null; name: string }, teraz = new Date(),
): void {
  if (!skladniki.length) return;
  const at = teraz.toISOString();
  const wstaw = database.prepare(
    `INSERT INTO oferta_komplet
       (channel_account_id, offer_id, tw_id, ilosc_na_sztuke, zrodlo, ustalono_at, ustalono_przez)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(channel_account_id, offer_id, tw_id) DO UPDATE SET
       ilosc_na_sztuke=excluded.ilosc_na_sztuke, zrodlo=excluded.zrodlo,
       ustalono_at=excluded.ustalono_at, ustalono_przez=excluded.ustalono_przez`);
  for (const s of skladniki) {
    wstaw.run(kontoId, offerId, s.twId, naSztuke(s), zrodlo, at, kto.name);
  }
  logEvent("oferta_komplet_ustalony", kto.name, null,
    { offerId, kartotek: skladniki.length, zrodlo }, kto.id, database);
}

/* ── Skład wskazany ręką biura (0.336.0) ─────────────────────────────────────
   Zgłoszenie właściciela: „rozwiąż «nie weszła do koszyka» — nie wiem, gdzie
   to wskazać". Automat sam odsyłał do ręcznej drogi („wskaż skład ręcznie"),
   której nigdy nie zbudowano: kolumna `zrodlo='biuro'` stała w schemacie od
   0.328.0 i nie miał jej kto wypełnić.

   Odejmowanie z paragonu wymaga, żeby KAŻDA POZOSTAŁA oferta zamówienia miała
   kartotekę. `oferta_kartoteka` wypełnia się dopiero przy zwrocie tej oferty,
   więc w zamówieniu na pięć różnych rzeczy automat prawie zawsze milczy — nie
   dlatego, że dane są złe, tylko dlatego, że nie ma ich skąd wziąć. Człowiek
   patrzy wtedy na paragon i wie w pięć sekund, co wchodziło w skład.         */

/** Wiersz dokumentu sprzedaży — materiał, z którego biuro składa komplet. */
export interface WierszDokumentu {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Sztuki na CAŁYM dokumencie, czyli na całe zamówienie. */
  naDokumencie: number;
}

/**
 * Wiersze dokumentu wskazanego przy zwrocie — pusto, gdy dokumentu nie ma.
 *
 * PARAGON, A NIE WYSZUKIWARKA KARTOTEK, i to jest decyzja. Pozwolenie na
 * dowolną kartotekę znaczyłoby drogę, którą na dokument MM trafia towar
 * nieobecny na żadnej sprzedaży — czyli dokładnie to, przed czym broni się
 * reguła „kartoteka z paragonu".
 */
export function wierszeDokumentuZwrotu(database: Db, zwrotId: number): WierszDokumentu[] {
  const z = database.prepare("SELECT faktura_dok_id FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as { faktura_dok_id: number | null } | undefined;
  if (!z?.faktura_dok_id) return [];
  return [...pozycjeDokumentu(database, Number(z.faktura_dok_id)).entries()]
    .map(([twId, ilosc]) => ({ twId, ...kartoteka(database, twId), naDokumencie: ilosc }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol, "pl"));
}

/**
 * Zapisuje skład kompletu wskazany przez człowieka.
 *
 * ILOŚĆ NA JEDEN KOMPLET, nie na zwrot. Tak stoi w tabeli i tak myśli
 * człowiek patrzący na zestaw: „w środku są dwie sztuki tego". Przeliczenie
 * na zwracane sztuki robi `skladPozycji`, ten sam kod co przy paragonie.
 *
 * KASUJEMY POPRZEDNI SKŁAD tej oferty przed zapisem. Sam `zapamietajSklad`
 * nadpisuje wiersz po wierszu, więc bez kasowania nie dałoby się USUNĄĆ
 * składnika wpisanego przez pomyłkę — a pomyłka w składzie kładzie na MM
 * towar, którego nikt nie zwrócił.
 */
export function zapiszSkladRecznie(
  database: Db, pozycjaId: number,
  skladniki: Array<{ twId: number; naKomplet: number }>,
  kto: { id: number; name: string }, teraz = new Date(),
): SkladPozycji {
  const p = database.prepare(
    `SELECT p.offer_id, z.channel_account_id
       FROM zwrot_klienta_pozycja p
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE p.id=?`).get(pozycjaId) as
    { offer_id: string | null; channel_account_id: number } | undefined;
  if (!p) throw new Error("Nie znaleziono pozycji zwrotu.");
  /* Skład pamięta się PRZY OFERCIE — bez jej identyfikatora nie ma gdzie go
     powiesić ani jak odnaleźć przy następnym zwrocie tego samego zestawu. */
  if (!p.offer_id) throw new Error("Ta pozycja nie ma oferty — składu nie ma przy czym zapamiętać.");
  if (!skladniki.length) throw new Error("Pusty skład nic nie znaczy — wskaż choć jedną kartotekę.");

  const czysty = skladniki.map((s) => {
    const twId = Number(s.twId);
    const ile = Number(s.naKomplet);
    if (!Number.isFinite(twId) || twId <= 0) throw new Error("Zły numer kartoteki w składzie.");
    if (!Number.isFinite(ile) || ile <= 0) {
      throw new Error("Ilość w komplecie musi być większa od zera — zerowy składnik to brak składnika.");
    }
    const t = database.prepare("SELECT symbol, nazwa FROM sgt_towar WHERE tw_id=?").get(twId) as
      { symbol: string; nazwa: string } | undefined;
    /* Kartoteka spoza kopii Subiekta nie ma prawa wejść na dokument MM:
       Sfera odrzuciłaby go dopiero w workerze, po odejściu operatora. */
    if (!t) throw new Error(`Kartoteki ${twId} nie ma w kopii Subiekta.`);
    return { twId, symbol: t.symbol, nazwa: t.nazwa, ilosc: ile };
  });
  /* Ta sama kartoteka dwa razy to podwojone sztuki na MM. Klucz tabeli by je
     scalił po cichu, biorąc ostatnią — cisza jest tu gorsza od odmowy. */
  if (new Set(czysty.map((s) => s.twId)).size !== czysty.length) {
    throw new Error("Ta sama kartoteka wpisana dwa razy — zsumuj ją w jednym wierszu.");
  }

  /* TRANSAKCJĘ TRZYMA WOŁAJĄCY (`wskazSklad`) — tak jak `dolozDoKosza`
     i `zapamietajSklad` obok. Własna wywracałaby się na zagnieżdżeniu:
     `node:sqlite` nie zna transakcji w transakcji. */
  database.prepare("DELETE FROM oferta_komplet WHERE channel_account_id=? AND offer_id=?")
    .run(Number(p.channel_account_id), p.offer_id);
  zapamietajSklad(database, Number(p.channel_account_id), p.offer_id, czysty,
    (s) => s.ilosc, "biuro", kto, teraz);
  return skladPozycji(database, pozycjaId);
}
