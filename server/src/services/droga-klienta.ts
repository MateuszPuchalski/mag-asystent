import { db as defaultDb, type Db } from "../db/db.js";
import { sprawaOtwarta } from "./statusy-spraw.js";
import { statusRozmowy } from "./conversations.js";

/* ── Droga klienta przez cztery kolejki (`docs/obsluga-klienta-calosc.md`) ───
   Panel prowadzi CZTERY kolejki: skrzynkę, zwroty, reklamacje i dyskusje.
   Klient ma jedną sprawę i przechodzi przez nie po kolei. Podział jest NASZ,
   nie jego — i to jest punkt 1 dekalogu.

   Wiązania istniały przed tym plikiem, ale niepełne: pięć przejść z dwunastu
   możliwych. Żaden ekran nie widział sprawy POSPRZEDAŻOWEJ, więc agent
   odpowiadający na pytanie nie wiedział o otwartej reklamacji tego klienta.
   Ten plik domyka brakujące siedem jednym mostkiem.

   MOSTKIEM JEST NUMER ZAMÓWIENIA i nic więcej. `message.related_order_id`,
   `zwrot_klienta.order_id` i `reklamacja_klienta.order_id` mówią o tym samym
   zakupie. Po loginie ten plik nie wiąże, bo droga ZAKUPU to jedno
   zamówienie, a login łączy wszystkie zakupy klienta. Te niesie historia
   klienta (`klient-historia.ts`). Login rozmówcy to login kupującego —
   zweryfikował to właściciel 24 września 2026 (`docs/allegro-ksztalt.md`).

   ZERO ŻĄDAŃ DO ALLEGRO i zero nowych tabel. Wszystko, czego te odczyty
   potrzebują, leży już w naszej bazie od pierwszej synchronizacji. Piąta
   tabela ze wspólnym statusem nad kolejkami kosztowałaby to, co nakładka
   spraw w 0.140.0 — cztery tabele i ręczne SCAL. */

type Wiersz = Record<string, unknown>;

/**
 * Które rozmowy są o którym zamówieniu — JEDNA relacja SQL dla każdej strony
 * mostka (@wydanie). Kolumny: `conversation_id`, `numer`, `at`.
 *
 * Do tego wydania skrzynka czytała numer rozmowy razem z ręcznym wskazaniem
 * (`numerZamowieniaRozmowy`), a zwrot, reklamacja, droga zakupu i szukanie —
 * tylko z `message.related_order_id`. Rozmowa z zamówieniem wskazanym przez
 * agenta widziała więc zwrot, a zwrot jej nie widział. Wiązanie jednostronne
 * to wiązanie, którego nie ma (CLAUDE.md), i nic go nie pilnowało.
 *
 * Reguła jest ta sama co w `numerZamowieniaRozmowy`: numer z wiadomości bije
 * wskazanie, bo numer z Allegro jest faktem, a wskazanie wnioskiem. Wskazanie
 * liczy się więc tylko przy rozmowie bez żadnego numeru w wiadomościach,
 * i tylko OSTATNIE — pomyłkę poprawia się wskazaniem innego zamówienia.
 * `at` wskazania to pierwsza wiadomość rozmowy: klient pisał, zanim agent
 * wskazał, a droga zakupu układa przystanki po czasie pisania.
 *
 * Konta relacja nie filtruje — robi to zapytanie po `conversation`.
 * Pilnuje jej strażnik źródła w `droga-klienta.test.ts`.
 */
export const ROZMOWA_ZAMOWIENIA = `(
  SELECT m.conversation_id AS conversation_id, m.related_order_id AS numer, m.sent_at AS at
    FROM message m WHERE m.related_order_id IS NOT NULL
  UNION ALL
  SELECT e.conversation_id, json_extract(e.payload, '$.externalId'),
         COALESCE((SELECT MIN(x.sent_at) FROM message x WHERE x.conversation_id = e.conversation_id),
                  e.created_at)
    FROM conversation_event e
   WHERE e.event_type = 'order_linked_manually'
     AND e.id = (SELECT MAX(w.id) FROM conversation_event w
                  WHERE w.conversation_id = e.conversation_id AND w.event_type = 'order_linked_manually')
     AND NOT EXISTS (SELECT 1 FROM message y
                      WHERE y.conversation_id = e.conversation_id AND y.related_order_id IS NOT NULL))`;

const tekst = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Sprawa posprzedażowa tego samego zakupu — wiersz LEKKI i to jest decyzja.
 *
 * `WierszReklamacji` ma czterdzieści pól, bo obsługuje własną kolejkę. Blok
 * kontekstu odpowiada na jedno pytanie: „czy ten klient ma u nas coś jeszcze
 * otwartego i jak pilne". Pełny wiersz dołożyłby do skrzynki propozycje
 * kartotek i stany rabatów, których nikt tam nie czyta — audyt zwrotów
 * z 15 września 2026 opisuje dokładnie ten koszt przy szczególe zwrotu.
 */
export interface SprawaZakupu {
  id: number;
  /** `CLAIM` albo `DISPUTE` — ekran pisze to słowem, nie jedną plakietką. */
  typ: string;
  /** `referenceNumber`; przy dyskusji Allegro go NIE nadaje (§25c.1). */
  numer: string | null;
  temat: string | null;
  statusAllegro: string | null;
  /** Termin decyzji z Allegro; dyskusja nie ma go z definicji. */
  decyzjaDo: string | null;
  otwartoAt: string;
  prowadzi: string | null;
  /** Czy sprawa jest jeszcze otwarta — po tym ekran decyduje o sygnale. */
  otwarta: boolean;
}


const naSprawe = (w: Wiersz): SprawaZakupu => ({
  id: Number(w.id),
  typ: String(w.typ),
  numer: tekst(w.reference_number),
  temat: tekst(w.temat),
  statusAllegro: tekst(w.status_allegro),
  decyzjaDo: tekst(w.decyzja_do),
  otwartoAt: String(w.otwarto_at),
  prowadzi: tekst(w.prowadzi),
  otwarta: sprawaOtwarta(tekst(w.status_allegro)),
});

/**
 * Reklamacje i dyskusje TEGO zamówienia (S1 spoiwa).
 *
 * `pomin` wycina sprawę, z której ekran pyta — inaczej reklamacja pokazywałaby
 * w rodzeństwie samą siebie. Skrzynka i zwroty nie mają czego pomijać
 * i przekazują `null`.
 *
 * Konto jest w warunku, bo `order_id` przyjeżdża z Allegro i nie ma gwarancji
 * rozłączności między kontami. Wiersz z cudzego konta na ekranie byłby
 * pokazaniem cudzych zakupów — ta sama zasada, co w `klient-historia.ts`.
 */
export function sprawyZakupu(
  database: Db = defaultDb(), konto: number, orderId: string | null,
  pomin: number | null = null,
): SprawaZakupu[] {
  if (!orderId) return [];
  /* bez typu: ten odczyt CHCE obu rodzajów i oddaje `typ` wprost w wierszu.
     Warunek na typ zabrałby dyskusję z rodzeństwa reklamacji, czyli dokładnie
     to przejście, dla którego blok powstał. Plakietki nie sklejamy — blizna
     0.121.0 mówi o jednej etykiecie na dwa byty, a tu etykieta jest polem. */
  return (database.prepare(`
    SELECT id, typ, reference_number, temat, status_allegro, decyzja_do,
           otwarto_at, prowadzi
      FROM reklamacja_klienta
     WHERE channel_account_id = ? AND order_id = ? AND id IS NOT ?
     ORDER BY otwarto_at DESC`).all(konto, orderId, pomin) as Wiersz[]).map(naSprawe);
}

/**
 * Przystanek na drodze klienta — jeden byt z jednej kolejki (S3 spoiwa).
 *
 * `rodzaj` mówi, w której kolejce stoi, a `at` kiedy się tam pojawił.
 * Kolejność przystanków JEST drogą i nic poza nią nie trzeba zapisywać.
 */
export interface PrzystanekDrogi {
  rodzaj: "rozmowa" | "dyskusja" | "reklamacja" | "zwrot";
  id: number;
  at: string;
  opis: string | null;
}

/**
 * Droga jednego zakupu przez kolejki — ODCZYT, nigdy zapis.
 *
 * Projekt spoiwa przewidywał tu zdarzenie dopisywane przy synchronizacji.
 * Zdarzenie jest ZBĘDNE: moment otwarcia każdego bytu i tak leży w bazie,
 * więc przeskok wylicza się z kolejności. Zapis dokładałby drugą prawdę o tym
 * samym fakcie, a ta rozjeżdża się przy pierwszej poprawce jednej z nich.
 *
 * Wynika z tego druga rzecz, ważniejsza: otwarcie ekranu niczego nie mutuje.
 * Zapis przy samym patrzeniu jest blizną 0.18.0 i umową liczników w testach.
 */
export function drogaZakupu(
  database: Db = defaultDb(), konto: number, orderId: string | null,
): PrzystanekDrogi[] {
  if (!orderId) return [];
  const przystanki: PrzystanekDrogi[] = [];

  /* Rozmowa wchodzi na drogę PIERWSZĄ wiadomością o tym zamówieniu, nie datą
     założenia wątku: wątek bywa starszy od zakupu, gdy klient pytał przed nim. */
  for (const w of database.prepare(`
    SELECT c.id, c.subject, MIN(rz.at) AS pierwsza
      FROM ${ROZMOWA_ZAMOWIENIA} rz JOIN conversation c ON c.id = rz.conversation_id
     WHERE rz.numer = ? AND c.channel_account_id = ?
     GROUP BY c.id`).all(orderId, konto) as Wiersz[]) {
    const at = tekst(w.pierwsza);
    if (at) przystanki.push({ rodzaj: "rozmowa", id: Number(w.id), at, opis: tekst(w.subject) });
  }

  /* bez typu: droga ma pokazać PRZEJŚCIE z dyskusji w reklamację, więc pyta
     o oba rodzaje naraz. Rozdziela je linijka niżej, po kolumnie `typ`:
     przystanek nazywa się „dyskusja" albo „reklamacja", nigdy wspólnie. */
  for (const w of database.prepare(`
    SELECT id, typ, temat, otwarto_at FROM reklamacja_klienta
     WHERE order_id = ? AND channel_account_id = ?`).all(orderId, konto) as Wiersz[]) {
    przystanki.push({
      rodzaj: String(w.typ) === "DISPUTE" ? "dyskusja" : "reklamacja",
      id: Number(w.id), at: String(w.otwarto_at), opis: tekst(w.temat),
    });
  }

  for (const w of database.prepare(`
    SELECT id, reference_number, created_at FROM zwrot_klienta
     WHERE order_id = ? AND channel_account_id = ?`).all(orderId, konto) as Wiersz[]) {
    przystanki.push({
      rodzaj: "zwrot", id: Number(w.id), at: String(w.created_at),
      opis: tekst(w.reference_number),
    });
  }

  return przystanki.sort((a, b) => a.at.localeCompare(b.at));
}

/** Miesiąc w postaci `RRRR-MM` — po nim grupuje się miara eskalacji. */
const miesiac = (at: string): string => at.slice(0, 7);

export interface MiesiacEskalacji {
  miesiac: string;
  /** Zakupy, przy których klient napisał do skrzynki. */
  zRozmowa: number;
  /** Z tych zakupów: ile skończyło się dyskusją albo reklamacją. */
  eskalowane: number;
}

/**
 * Miara eskalacji (S5 spoiwa): po ilu rozmowach klient szedł dalej.
 *
 * Liczy zakupy, nie sprawy. Klient, który przy jednym zamówieniu napisał
 * trzy razy i złożył jedną reklamację, jest JEDNĄ eskalacją — inaczej miara
 * nagradzałaby milczenie agenta.
 *
 * Liczymy WYŁĄCZNIE eskalacje po rozmowie i w tej kolejności. Reklamacja
 * złożona bez pytania do nas nie mówi nic o naszej odpowiedzi, bo odpowiedzi
 * nie było. To jest różnica między miarą obsługi a licznikiem reklamacji.
 */
export function eskalacje(
  database: Db = defaultDb(),
  /* `null` znaczy WSZYSTKIE konta i jest wartością trasy raportu. Miara mówi
     o pracy biura, a biuro jest jedno, choćby kont Allegro przybyło. Odczyt
     konta osobno musiałby je najpierw wybrać, a wyboru nie ma z czego zrobić:
     `kontoKanalu` ZAPISUJE, więc na trasie odczytu nie ma prawa stanąć. */
  konto: number | null = null,
): MiesiacEskalacji[] {
  const poKoncie = konto === null ? "" : "AND c.channel_account_id = ?";
  const rozmowy = database.prepare(`
    SELECT rz.numer AS zam, MIN(rz.at) AS pierwsza
      FROM ${ROZMOWA_ZAMOWIENIA} rz JOIN conversation c ON c.id = rz.conversation_id
     WHERE 1=1 ${poKoncie}
     GROUP BY rz.numer`).all(...(konto === null ? [] : [konto])) as Wiersz[];

  const sprawy = new Map<string, string>();
  /* bez typu: eskalacją jest KAŻDE wyjście klienta poza skrzynkę — dyskusja
     tak samo jak reklamacja. Liczenie samych reklamacji przemilczałoby ten
     ruch, który zwykle jest pierwszy. */
  for (const w of database.prepare(`
    SELECT order_id AS zam, MIN(otwarto_at) AS pierwsza FROM reklamacja_klienta
     WHERE order_id IS NOT NULL ${konto === null ? "" : "AND channel_account_id = ?"}
     GROUP BY order_id`).all(...(konto === null ? [] : [konto])) as Wiersz[]) {
    const at = tekst(w.pierwsza);
    if (at) sprawy.set(String(w.zam), at);
  }

  const wynik = new Map<string, MiesiacEskalacji>();
  for (const w of rozmowy) {
    const pierwsza = tekst(w.pierwsza);
    if (!pierwsza) continue;
    const klucz = miesiac(pierwsza);
    const m = wynik.get(klucz) ?? { miesiac: klucz, zRozmowa: 0, eskalowane: 0 };
    m.zRozmowa += 1;
    const sprawa = sprawy.get(String(w.zam));
    /* Ostro większe, nie „większe bądź równe": sprawa otwarta w tej samej
       sekundzie co pierwsza wiadomość nie wynika z naszej odpowiedzi. */
    if (sprawa && sprawa > pierwsza) m.eskalowane += 1;
    wynik.set(klucz, m);
  }

  return [...wynik.values()].sort((a, b) => b.miesiac.localeCompare(a.miesiac));
}

/**
 * Kontekst posprzedażowy JEDNEGO zwrotu — konto i zamówienie czyta serwis.
 *
 * Trasa nie ma prawa pytać bazy o `channel_account_id`, żeby złożyć argumenty
 * dla drugiego odczytu; to jest logika, nie przekazanie parametru. `WierszZwrotu`
 * konta nie niesie i nie ma powodu zaczynać — czyta je ten jeden zapytanie
 * niżej, w miejscu, które i tak zna tabelę zwrotu.
 */
export function kontekstZwrotu(
  database: Db = defaultDb(), zwrotId: number,
): { sprawy: SprawaZakupu[]; droga: PrzystanekDrogi[] } {
  const w = database.prepare(
    "SELECT channel_account_id, order_id FROM zwrot_klienta WHERE id=?")
    .get(zwrotId) as Wiersz | undefined;
  if (!w) return { sprawy: [], droga: [] };
  const konto = Number(w.channel_account_id);
  const zam = tekst(w.order_id);
  return { sprawy: sprawyZakupu(database, konto, zam), droga: drogaZakupu(database, konto, zam) };
}

/** Jedna pozycja listy „Moje" — z której kolejki i co to za sprawa. */
export interface MojaSprawa {
  /* Trzy kolejki, nie cztery: zwrot nie ma prowadzącego od 0.370.0. Powód
     stoi przy zapytaniach w `mojeSprawy`. */
  kolejka: "rozmowa" | "reklamacja" | "dyskusja";
  id: number;
  /** Zdanie na wiersz: temat rozmowy, numer zwrotu albo temat sprawy. */
  opis: string;
  /** Ostatni ruch przy sprawie — zegar opisowy, nie termin. */
  at: string;
  /** Termin z Allegro albo ustawowy; `null` przy rozmowie i dyskusji. */
  terminDo: string | null;
}

/**
 * Wszystko, co prowadzi jedna osoba — trzy kolejki jedną listą (S4 spoiwa).
 *
 * ODCZYT Z DWÓCH ZAPYTAŃ, nie piąta kolejka i nie nowa tabela. Kliknięcie
 * prowadzi na ekran właściwy dla rodzaju sprawy, bo to tam stoją jej bramki.
 * Wspólny ekran roboczy nad kolejkami byłby piątą kolejką z własnym statusem,
 * czyli kształtem, który kosztował cztery tabele nakładki (blizna 0.140.0).
 *
 * KAŻDA KOLEJKA MA WŁASNE POJĘCIE WŁAŚCICIELA i to nie jest niedoróbka.
 * Rozmowa ma `assigned_user_id` — przydział, bo odpowiada jedna osoba. Sprawa
 * posprzedażowa i zwrot mają `prowadzi_user_id` — ZNACZNIK, nie zamek.
 * Sprowadzenie obu do jednej kolumny skasowałoby tę różnicę w miejscu,
 * w którym jest ona całą treścią.
 *
 * KOLEJNOŚĆ MA DWA PIĘTRA, nie jedno pole. Najpierw sprawy z TERMINEM, wedle
 * terminu; potem reszta, wedle ostatniego ruchu. Jedno pole na oba zegary
 * ustawiłoby sprawę ruszoną wczoraj nad sprawą, której termin mija jutro —
 * a to jest wprost blizna 0.121.0: jeden zegar nazwany drugim. Zegar rządzi
 * kolejnością pracy, ale wyłącznie tam, gdzie zegar jest.
 */
export function mojeSprawy(
  database: Db = defaultDb(), userId: number,
): MojaSprawa[] {
  const lista: MojaSprawa[] = [];

  for (const w of database.prepare(`
    SELECT id, subject, updated_at FROM conversation
     WHERE assigned_user_id = ?
       AND status NOT IN ('resolved','closed','spam')`).all(userId) as Wiersz[]) {
    /* Zakończenie liczy się też SAMO, przy odczycie (23 września 2026):
       podziękowanie, dwa dni ciszy, wątek zamknięty w Allegro. Kolumna tego
       nie zna, więc filtr SQL zostaje tylko wstępnym sitem — rozstrzyga ta
       sama reguła, co w skrzynce. */
    if (statusRozmowy(database, Number(w.id)) === "resolved") continue;
    lista.push({
      kolejka: "rozmowa", id: Number(w.id),
      opis: tekst(w.subject) ?? "Rozmowa bez tematu",
      at: String(w.updated_at), terminDo: null,
    });
  }

  /* bez typu: obie kolejki naraz, bo to jest właśnie sens tej listy — jedno
     miejsce zamiast czterech. Rodzaj wychodzi w kolumnie `kolejka` niżej,
     więc plakietki nie sklejamy (blizna 0.121.0). */
  for (const w of database.prepare(`
    SELECT id, typ, reference_number, temat, decyzja_do, otwarto_at,
           ostatnia_wiadomosc_at, status_allegro
      FROM reklamacja_klienta
     WHERE prowadzi_user_id = ?`).all(userId) as Wiersz[]) {
    if (!sprawaOtwarta(tekst(w.status_allegro))) continue;
    const termin = tekst(w.decyzja_do);
    lista.push({
      kolejka: String(w.typ) === "DISPUTE" ? "dyskusja" : "reklamacja",
      id: Number(w.id),
      opis: tekst(w.temat) ?? tekst(w.reference_number) ?? "Sprawa bez tematu",
      at: tekst(w.ostatnia_wiadomosc_at) ?? String(w.otwarto_at),
      terminDo: termin,
    });
  }

  /* ZWROTÓW TU NIE MA I TO NIE JEST NIEDOKOŃCZONA ROBOTA. Projekt spoiwa
     mówił „cztery źródła", a w 0.370.0 właściciel zdjął ze zwrotu znacznik
     prowadzącego wprost: zwrot przechodzi przez biuro jako KOLEJKA DECYZJI,
     nie jako czyjaś sprawa. Kolumny `prowadzi_*` zostały w tabeli, ale nikt
     ich nie pisze, więc lista z nich byłaby pusta albo — gorzej — pokazywała
     przydziały sprzed tamtego wydania.

     Wskrzeszanie znacznika przy okazji innej funkcji odwracałoby decyzję
     właściciela bez jednego zdania uzasadnienia. Zwrot wraca tu w dniu,
     w którym ktoś tę decyzję świadomie zmieni. */

  return lista.sort((a, b) => {
    if (a.terminDo && b.terminDo) return a.terminDo.localeCompare(b.terminDo);
    if (a.terminDo) return -1;
    if (b.terminDo) return 1;
    return a.at.localeCompare(b.at);
  });
}
