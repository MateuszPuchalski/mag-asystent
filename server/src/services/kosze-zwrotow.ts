import { logEvent } from "./events.js";
import { transaction, type Db } from "../db/db.js";
import { config } from "../config.js";
import { enqueueMM } from "./queue.js";
import { iloscLiczona } from "./ilosc-zwrotu.js";
import { skladPozycji, zapamietajSklad, type Skladnik, type SkladPozycji } from "./komplety.js";

/* ── Koszyk zwrotów składany w panelu (0.192.0) ─────────────────────────────
   Właściciel opisał obieg, który biuro robi od lat ręką:

     „gdy agent zasiada do zwrotów, to otwiera pustą MM i dodaje kolejno
      przedmioty ze zwrotów; gdy koszyk się zapełni, zamyka MM i tak w kółko"

   Ten plik jest tym obiegiem, tyle że dokument wystawia Sfera, a nie człowiek.
   Kartka z numerem napisanym odręcznie przestaje być potrzebna — numer wraca
   z kolejki i staje na ekranie.

   ── Dlaczego to wraca dopiero teraz ──────────────────────────────────────
   Ścieżka koszyków istniała i wypadła w 0.17.0 z jednym, twardym powodem:
   „domknięcie koszyka kolejkuje MM, a dokumentów MM na produkcji nie da się
   dziś wystawić". Ten powód wygasł — worker Sfery w C# ma prawdziwe
   `CreateMM` (`sfera-worker/src/ISferaAdapter.cs`). Schemat `kosz` czekał na
   to bez zmian: status `otwarty` nosi w komentarzu zdanie „biuro dokłada
   zwroty", które przez rok nie miało kto wykonać.

   Reguła „tylko lokalizacja" z 0.16.0 nie jest tu złamana: dotyczy SUROWYCH
   zapisów do bazy Subiekta, a dokumenty idą osobnym, przyjętym kanałem —
   przez Sferę, tak samo jak korekta zwrotu.

   ── Trzy decyzje właściciela z 3 września 2026 ───────────────────────────
   1. Do koszyka wchodzi WYŁĄCZNIE towar oceniony „na stan". Przecena
      i utylizacja zostają poza tą ścieżką; utylizacji nie wolno wysłać MM na
      regał zwrotów, bo to towar, który ma zejść ze stanu, a nie pojechać na
      półkę.
   2. Otwarty koszyk jest JEDEN NA OPERATORA. Fizyczny kosz stoi przy jednym
      biurku, więc dwie osoby przy zwrotach nie mieszają towaru w jednym
      dokumencie.
   3. Dokładanie nie jest osobnym ruchem. Ocena „na stan", którą operator
      i tak naciska, JEST dołożeniem do koszyka — najszybsza decyzja to ta,
      której nie podejmuje się dwa razy.                                     */

/** Kto podpisuje wypuszczenie MM po dojściu ostatniej korekty. Nie człowiek —
    to nie on kliknął; ten sam wzorzec co `AUTOMAT` w `services/sygnatury.ts`. */
const AUTOMAT_KOREKTY = "automat (komplet korekt)";

/** Przedrostek kodu koszy składanych u nas. */
const PRZEDROSTEK = "Z-";

/**
 * Do czego ten koszyk służy (0.211.0).
 *
 * `zwroty` idzie na regał zwrotów, `odpad` na magazyn odpadu. Różnią się
 * WYŁĄCZNIE magazynem docelowym MM — reszta drogi jest ta sama, bo fizycznie
 * to ta sama praca: biuro zbiera towar do pudła, zamyka je i wysyła na halę
 * z jednym papierem. Dwie osobne maszynerie znaczyłyby dwa miejsca, w których
 * trzeba pamiętać o bramce korekty.
 */
export type RodzajKosza = "zwroty" | "odpad";

/**
 * Magazyn docelowy MM dla tego rodzaju. `0` znaczy WYŁĄCZONY.
 *
 * Odpad bez numeru w `wertis.env` nie ma dokąd jechać, więc koszyka nie
 * zakładamy wcale — zgadnięty numer przesunąłby złom na cudzy magazyn.
 */
export const magazynDocelowy = (rodzaj: RodzajKosza): number =>
  rodzaj === "odpad" ? config.magId.ODP : config.magId.ZWROTY;

export interface StanKosza {
  /** Do czego służy — panel pokazuje dwa koszyki obok siebie (0.211.0). */
  rodzaj: RodzajKosza;
  id: number;
  kod: string;
  pozycji: number;
  sztuk: number;
  otwartyOd: string;
  pozycje: Array<{
    /** Id wiersza koszyka — po nim zdejmuje się to, co dołożono ręką. */
    id: number;
    symbol: string;
    nazwa: string;
    ilosc: number;
    /**
     * Wiersz przyszedł z OCENY ZWROTU (0.365.0).
     *
     * Ekran rozstrzyga po tym, którą drogą wyjścia pokazać: wiersz ze zwrotu
     * schodzi cofnięciem oceny na karcie zwrotu, dołożony ręką — krzyżykiem
     * przy pozycji. Jedna droga na obie kosztowałaby kasowanie cudzej oceny.
     */
    zeZwrotu: boolean;
  }>;
}

/**
 * Kod nowego koszyka.
 *
 * PRZEDROSTEK JEST KONIECZNY, nie ozdobny. Kosze z Subiekta noszą jako kod
 * samą liczbę z numeru MM („1209") — tę z kartki, którą magazynier wpisuje na
 * kolektorze. Gołe „7" z naszego licznika zderzyłoby się z tamtą przestrzenią
 * przy pierwszym trafieniu i otworzyłoby cudzy kosz.
 */
function nowyKod(database: Db): string {
  const uzyte = (database.prepare(
    `SELECT kod FROM kosz WHERE kod LIKE '${PRZEDROSTEK}%'`).all() as Array<{ kod: string }>)
    .map((k) => Number(k.kod.slice(PRZEDROSTEK.length)))
    .filter((n) => Number.isFinite(n));
  return `${PRZEDROSTEK}${(uzyte.length ? Math.max(...uzyte) : 0) + 1}`;
}

/* ── Kartoteka, której dokument MM nie ruszy ────────────────────────────────
   Koszyk Z-8 zamknął się z kosztem przesyłki w środku, a Sfera odrzuciła jego
   MM zdaniem „Brak towaru w magazynie" (0.371.0). Wiersz wszedł SKANEM, więc
   bramka stojąca przy zamykaniu kosza przyszłaby o dwadzieścia pięć kartotek
   za późno — poprawia się to tam, gdzie się to popełnia, czyli przy dokładaniu.

   Rozstrzygamy DWIEMA rzeczami, które wiemy na pewno, a nie zgadywaniem
   rodzaju kartoteki. Kolumny `tw_Rodzaj` nie ma w read-modelu i nie ma jej
   w `docs/subiekt-gt-struktura.md` — dopisanie jej do importu z pamięci to
   dokładnie ten błąd, który regułą „kształt czyta się z pliku" zamyka CLAUDE.md.

   Pierwsza: `TW_ID_PRZESYLKA` z konfiguracji. Tę kartotekę nazwał człowiek,
   a automat ZW już jej pilnuje po swojej stronie (`services/zw-automat.ts`) —
   asymetria między ZW a MM znaczyłaby, że jedna droga ją wpuszcza, a druga nie.

   Druga: brak JAKIEGOKOLWIEK wiersza stanu. Importer bierze całe `tw_Stan`,
   bez filtra magazynów, więc kartoteka prowadzona magazynowo ma tu wiersz —
   choćby z zerem. Usługa nie ma go wcale i nie zacznie mieć, bo dokument
   magazynowy jej nie dotyczy. Towar wracający ze sprzedaży ma go z definicji:
   coś, co wyszło z magazynu, jest w nim znane.                               */

/**
 * Dlaczego ta kartoteka nie wejdzie do pudła, albo `null` gdy wejdzie.
 *
 * Numer przesyłki PARAMETREM z domyślną wartością, nie odczytem w środku:
 * `config` zamarza przy imporcie, więc test bez tego nie sprawdziłby bramki,
 * nie przestawiając całego procesu. Ten sam wzorzec co `OpcjeZw`.
 */
export function powodPozaMagazynem(
  database: Db, twId: number, przesylkaTwId = config.twIdPrzesylka,
): string | null {
  if (przesylkaTwId > 0 && twId === przesylkaTwId) {
    return "to kartoteka przesyłki — koszt dostawy wraca do klienta przelewem, " +
      "a nie dokumentem magazynowym";
  }
  /* KARTOTEKI NIEZNANEJ NIE SĄDZIMY. Importer bierze wyłącznie kartoteki
     odblokowane (`tw_Zablokowany = 0`) i tylko dla nich wstawia wiersze stanu,
     więc towar ZABLOKOWANY w Subiekcie nie ma tu ani jednego wiersza — a taki
     leży na regale zwrotów najczęściej ze wszystkich. Brak stanu znaczy
     „usługa" dopiero wtedy, gdy kartotekę skądinąd znamy. */
  const znana = database.prepare("SELECT 1 AS jest FROM sgt_towar WHERE tw_id=? LIMIT 1")
    .get(twId) as { jest: number } | undefined;
  if (!znana) return null;

  const stan = database.prepare("SELECT 1 AS jest FROM sgt_stan WHERE tw_id=? LIMIT 1")
    .get(twId) as { jest: number } | undefined;
  if (!stan) {
    return "ta kartoteka nie jest prowadzona magazynowo — dokument MM nie ma " +
      "czego na niej przesunąć";
  }
  return null;
}

/**
 * Otwarty koszyk tego operatora — istniejący albo świeżo założony.
 *
 * Szuka po `utworzono_przez`, bo to jest właściciel fizycznego kosza. Kosze
 * z Subiekta (`mm_dok_id IS NOT NULL`) odpadają: tamte rodzi dokument, a nie
 * praca przy biurku, i nigdy nie stoją otwarte.
 */
export class WyborKoszyka extends Error {
  constructor(public readonly kosze: Array<{ id: number; kod: string }>) {
    super("Masz otwarte kilka koszyków — wskaż, do którego to wkładasz.");
    this.name = "WyborKoszyka";
  }
}

/** Otwarte pudła tego operatora dla tego rodzaju, od najstarszego. */
function otwarteTegoRodzaju(
  database: Db, kto: { name: string }, rodzaj: RodzajKosza,
): Array<{ id: number; kod: string }> {
  return (database.prepare(
    `SELECT id, kod FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? AND rodzaj=? ORDER BY id`)
    .all(kto.name, rodzaj) as Array<{ id: number; kod: string }>)
    .map((k) => ({ id: Number(k.id), kod: k.kod }));
}

/**
 * Do którego pudła trafia ta sztuka.
 *
 * KILKA PUDEŁ NARAZ OD 0.379.0. Decyzja właściciela odwraca tę z 3 września
 * („otwarty koszyk jest JEDEN na operatora"): przy biurku stoi czasem kilka
 * kartonów o różnym przeznaczeniu, a jeden na operatora znaczył, że trzeba
 * zamknąć pierwszy, żeby zacząć drugi.
 *
 * Cena tej swobody jest jedna i właściciel wybrał ją świadomie: przy kilku
 * otwartych pudłach OCENA PYTA, do którego. Zgadywanie „do najnowszego" byłoby
 * tanie w kodzie i drogie na hali — towar trafiałby do cudzego kartonu bez
 * jednego słowa na ekranie.
 *
 * Bez wskazania rozstrzygamy tylko tam, gdzie nie ma czego zgadywać: zero
 * otwartych pudeł zakłada nowe, jedno bierze siebie.
 */
export function koszDoDolozenia(
  database: Db, kto: { id: number; name: string }, teraz = new Date(),
  rodzaj: RodzajKosza = "zwroty", koszId?: number | null,
): number {
  if (koszId) {
    const k = database.prepare(
      `SELECT id FROM kosz WHERE id=? AND status='otwarty' AND mm_dok_id IS NULL
         AND mm_queue_id IS NULL AND rodzaj=?`).get(koszId, rodzaj) as
      { id: number } | undefined;
    if (!k) {
      throw new Error("Ten koszyk nie jest już otwarty na ten rodzaj towaru — odśwież ekran.");
    }
    return Number(k.id);
  }

  /* PO RODZAJU, nie tylko po właścicielu (0.211.0). Operator ma przy biurku
     osobne pudła na zwroty i na odpad — a bez tego warunku pozycja do
     utylizacji wpadłaby do pierwszego z brzegu i pojechała na zły magazyn. */
  const otwarte = otwarteTegoRodzaju(database, kto, rodzaj);
  if (otwarte.length === 1) return otwarte[0].id;
  if (otwarte.length > 1) throw new WyborKoszyka(otwarte);

  return zalozPudlo(database, kto, teraz, rodzaj);
}

/** Zakłada pudło i melduje to w dzienniku. Jedyne miejsce, które je tworzy. */
function zalozPudlo(database: Db, kto: { id: number; name: string },
  teraz: Date, rodzaj: RodzajKosza): number {
  const at = teraz.toISOString();
  const kod = nowyKod(database);
  const id = Number(database.prepare(
    `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez)
     VALUES (?, 'otwarty', ?, ?, ?)`).run(kod, rodzaj, at, kto.name).lastInsertRowid);
  logEvent("kosz_zwrotow_otwarty", kto.name, null, { koszId: id, kod, rodzaj },
    kto.id, database);
  return id;
}

/* ── Koszyk zakładany WPROST, bez zwrotu pod ręką (0.378.0) ─────────────────
   Zgłoszenie właściciela: „potrzebuję tworzenia koszy zwrotowych i dodawania
   produktów do nich jako oddzielna opcja".

   To ODWRACA granicę z 0.365.0 („tylko z poziomu obsługi zwrotów"), i to jest
   cała treść tej zmiany. Tamta granica zakładała, że pudło zawsze powstaje
   przy rozpakowywanym zwrocie. Nie zawsze: agent siada do zwrotów i najpierw
   stawia przy biurku pusty karton, a dopiero potem otwiera pierwszą paczkę.

   ZASADA „JEDEN KOSZYK NA OPERATORA" ZOSTAJE (decyzja z 3 września 2026).
   Fizyczny kosz stoi przy jednym biurku, więc drugie naciśnięcie NOWY KOSZYK
   oddaje ten sam kosz zamiast zakładać drugi. Bez tego dwie osoby przy
   zwrotach mieszałyby towar w jednym dokumencie — albo jedna osoba w dwóch.  */

/**
 * Zakłada koszyk WPROST — za każdym naciśnięciem NOWE pudło (0.379.0).
 *
 * Do 0.378.0 drugie naciśnięcie oddawało ten sam kosz, bo obowiązywała zasada
 * „jeden koszyk na operatora". Właściciel ją odwrócił: przy biurku stoi czasem
 * kilka kartonów, a zamykanie pierwszego po to, żeby zacząć drugi, wystawia
 * dokument na pudło, które jeszcze nie odjechało.
 */
export function zalozKoszyk(
  database: Db, kto: { id: number; name: string }, teraz = new Date(),
  rodzaj: RodzajKosza = "zwroty",
): StanKosza {
  if (magazynDocelowy(rodzaj) <= 0) {
    throw new Error("Ten rodzaj koszyka nie ma magazynu docelowego — sprawdź wertis.env.");
  }
  const koszId = zalozPudlo(database, kto, teraz, rodzaj);
  const stan = otwarteKoszyki(database, kto).find((k) => k.id === koszId);
  if (!stan) throw new Error("Koszyk powstał, ale nie umiem go odczytać — odśwież ekran.");
  return stan;
}

/**
 * Usuwa CAŁY koszyk — także napełniony (0.380.0).
 *
 * Do 0.379.0 schodził wyłącznie pusty. Zgłoszenie właściciela: „zrób, żeby
 * można było usunąć cały koszyk zwrotowy". Powód widać było na jego ekranie:
 * pudła odrzucone przez Sferę stały w pasku z kilkoma kartotekami usługowymi
 * w środku, a jedyną drogą było zdejmowanie ich wiersz po wierszu.
 *
 * BRAMKĄ JEST DOKUMENT, tak samo jak przy poprawianiu zawartości. Koszyk
 * z wystawioną MM nie schodzi i nie zejdzie: papier pojechał na halę, ktoś
 * rozkłada z niego towar, a stan w Subiekcie już się przesunął. Kasowanie
 * takiego kosza u nas nie cofnęłoby ani jednej z tych rzeczy — zostawiłoby
 * tylko halę bez listy.
 *
 * OCENY WRACAJĄ, wiersz po wierszu, tą samą regułą co przy zdejmowaniu jednego
 * (0.379.0): to ocena wsadziła towar do pudła, więc usunięcie pudła bez jej
 * zdjęcia zostawiłoby karty zwrotów mówiące o regale, na który nic nie jedzie.
 * Zwroty wracają do kubełka DO OCENY, każdy ze zdaniem na osi.
 *
 * ZADANIE MM SCHODZI RAZEM Z KOSZYKIEM. Pudło odrzucone przez Sferę ma przy
 * sobie zadanie w błędzie; zostawione bez kosza wisiałoby w kolejce jako praca
 * nad czymś, czego nie ma.
 */
export function usunKoszyk(
  database: Db, koszId: number, kto: { id: number; name: string },
): { koszId: number; kod: string; pozycji: number; zwrotow: number } {
  return transaction(database, () => {
    const k = database.prepare(
      `SELECT id, kod, status, rodzaj, mm_dok_id FROM kosz WHERE id=?`).get(koszId) as
      { id: number; kod: string; status: string; rodzaj: RodzajKosza;
        mm_dok_id: number | null } | undefined;
    if (!k) throw new Error("Nie znam takiego koszyka zwrotów.");
    if (k.rodzaj !== "zwroty" && k.rodzaj !== "odpad") {
      throw new Error(`Koszyk ${k.kod} nie jest koszykiem zwrotów ani odpadu.`);
    }
    if (k.mm_dok_id !== null) {
      throw new Error(
        `Koszyk ${k.kod} ma już dokument MM — towar pojechał na halę i aplikacja go nie cofnie.`);
    }

    const wiersze = database.prepare(
      `SELECT id, symbol, ilosc, zwrot_pozycja_id FROM kosz_pozycja WHERE kosz_id=?`)
      .all(koszId) as Array<{ id: number; symbol: string; ilosc: number;
        zwrot_pozycja_id: number | null }>;

    /* NAJPIERW OCENY, potem kasowanie: po `DELETE` nie ma już czego czytać,
       a numer zwrotu jest potrzebny do zdania na jego osi. */
    const zwroty = new Set<number>();
    const at = new Date().toISOString();
    for (const w of wiersze) {
      if (w.zwrot_pozycja_id === null) continue;
      const poz = Number(w.zwrot_pozycja_id);
      const z = database.prepare(
        "SELECT zwrot_id, nazwa FROM zwrot_klienta_pozycja WHERE id=?").get(poz) as
        { zwrot_id: number; nazwa: string } | undefined;
      database.prepare(`UPDATE zwrot_klienta_pozycja
        SET ocena=NULL, ocena_at=NULL, ocena_przez=NULL WHERE id=?`).run(poz);
      if (!z) continue;
      zwroty.add(Number(z.zwrot_id));
      database.prepare("UPDATE zwrot_klienta SET wersja=wersja+1 WHERE id=?")
        .run(Number(z.zwrot_id));
      database.prepare(`INSERT INTO zwrot_zdarzenie
        (zwrot_id, rodzaj, tresc, dane_json, kiedy_at, kto, kto_user_id)
        VALUES (?,'ocena_cofnieta',?,?,?,?,?)`)
        .run(Number(z.zwrot_id), `${z.nazwa} — koszyk ${k.kod} usunięty, ocena cofnięta`,
          JSON.stringify({ pozycjaId: poz, koszId, kod: k.kod }), at, kto.name, kto.id);
    }

    uniewaznijZadanieMm(database, koszId, kto);
    database.prepare("DELETE FROM kosz_pozycja WHERE kosz_id=?").run(koszId);
    database.prepare("DELETE FROM kosz WHERE id=?").run(koszId);

    /* ŚLAD Z ZAWARTOŚCIĄ, nie samą liczbą. Usunięte pudło znika z bazy razem
       z wierszami, więc dziennik jest jedynym miejscem, w którym zostaje
       odpowiedź na pytanie „co w nim było". */
    logEvent("kosz_zwrotow_usuniety", kto.name, null,
      { koszId, kod: k.kod, status: k.status, rodzaj: k.rodzaj,
        pozycje: wiersze.map((w) => ({ symbol: w.symbol, ilosc: Number(w.ilosc) })),
        zwrotow: zwroty.size },
      kto.id, database);
    return { koszId, kod: k.kod, pozycji: wiersze.length, zwrotow: zwroty.size };
  })();
}

/**
 * Dokłada pozycję zwrotu do otwartego koszyka operatora.
 *
 * Oddaje `null`, gdy dołożyć się NIE DA — i to nie jest awaria, tylko stan
 * pracy: pozycja bez kartoteki nie ma `tw_id`, a dokument MM przesuwa stany
 * kartotek, nie nazwy. Ocena zapisuje się mimo to, bo jest faktem o towarze;
 * ekran ma wtedy powiedzieć, czego nie zrobił. Cicha utrata pozycji byłaby
 * najgorszym z wyjść: karton pojechałby na halę z towarem, którego nie ma na
 * żadnym dokumencie.
 */
export function dolozDoKosza(
  database: Db, pozycjaId: number, kto: { id: number; name: string }, teraz = new Date(),
  rodzaj: RodzajKosza = "zwroty", koszId?: number | null,
): number | null {
  /* Odpad bez numeru magazynu w `wertis.env` nie ma dokąd jechać. Koszyka
     wtedy NIE zakładamy: ocena zapisuje się jak przed 0.211.0, a ekran
     powie, że do koszyka nie weszła. */
  if (magazynDocelowy(rodzaj) <= 0) return null;
  const p = database.prepare(
    `SELECT p.id, p.offer_id, p.tw_id, p.nazwa, p.ilosc, p.ilosc_zwrocona,
            z.channel_account_id
       FROM zwrot_klienta_pozycja p
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE p.id=?`).get(pozycjaId) as
    { id: number; offer_id: string | null; tw_id: number | null; nazwa: string;
      ilosc: number; ilosc_zwrocona: number | null; channel_account_id: number } | undefined;
  if (!p) return null;

  /* CO WCHODZI, ROZSTRZYGA PARAGON (0.328.0). Komplet sprzedany jako jedna
     oferta leży na magazynie osobno, a rozbicie ma wyłącznie dokument
     sprzedaży — patrz `services/komplety.ts`. Pozycja bez składu nie wchodzi
     do koszyka i to nie jest awaria, tylko stan pracy: ekran mówi, czego nie
     zrobił, zamiast po cichu dokładać jedną kartotekę zamiast trzech. */
  const sklad = skladPozycji(database, pozycjaId);
  if (!sklad.skladniki.length) return null;

  /* KARTOTEKA POZA MAGAZYNEM ZATRZYMUJE CAŁĄ POZYCJĘ, nie jeden składnik.
     Wiersz przesyłki stoi na paragonie obok towaru, więc ocena „na stan"
     wpuściłaby go do pudła tą samą drogą co komplet. Dołożenie reszty bez
     niego dałoby kosz, który nie zgadza się z tym, co operator widzi na
     ekranie zwrotu — a to gorsze niż odmowa, bo milczy. */
  for (const s of sklad.skladniki) {
    const powod = powodPozaMagazynem(database, s.twId);
    if (powod) {
      logEvent("kosz_zwrotow_odmowa", kto.name, s.twId,
        { pozycjaId, twId: s.twId, powod }, kto.id, database);
      return null;
    }
  }

  const kosz = koszDoDolozenia(database, kto, teraz, rodzaj, koszId);
  /* Dwa razy ta sama pozycja to jeden wiersz. Operator bywa poprawiany:
     cofnięcie oceny i ponowne „na stan" nie ma prawa podwoić sztuk na MM.
     Przy komplecie wierszy jest kilka, więc pytamy o ISTNIENIE, nie o jeden. */
  const stoi = database.prepare(
    "SELECT id FROM kosz_pozycja WHERE kosz_id=? AND zwrot_pozycja_id=? LIMIT 1")
    .get(kosz, pozycjaId) as { id: number } | undefined;
  if (stoi) return kosz;

  /* TO, CO WRÓCIŁO, nie deklaracja klienta (0.212.0) — `skladPozycji` liczy
     sztuki tą samą regułą. Na dokument MM idzie towar, który fizycznie leży
     w pudle; liczba z Allegro opisuje zamiar klienta. */
  const ile = iloscLiczona(p);
  const wstaw = database.prepare(
    `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
     VALUES (?,?,?,?,?,?)`);
  for (const s of sklad.skladniki) {
    wstaw.run(kosz, s.twId, s.symbol, s.nazwa, s.ilosc, pozycjaId);
  }
  /* Skład policzony z dokumentu ZAPAMIĘTUJE SIĘ dopiero tutaj, na drodze
     zapisu. Liczenie go od nowa przy każdym zwrocie znaczyłoby, że ten sam
     komplet raz wchodzi do koszyka, a raz nie — zależnie od tego, co klient
     dokupił w tamtym zamówieniu. */
  if (sklad.zrodlo === "paragon" && p.offer_id && sklad.skladniki.length > 1) {
    zapamietajSklad(database, Number(p.channel_account_id), p.offer_id,
      sklad.skladniki, (s) => s.ilosc / Math.max(1, ile), "paragon", kto, teraz);
  }
  logEvent("kosz_zwrotow_dolozono", kto.name, null,
    { koszId: kosz, pozycjaId, kartotek: sklad.skladniki.length, zrodlo: sklad.zrodlo,
      sztuk: sklad.skladniki.reduce((a, s) => a + s.ilosc, 0), ilosc: ile },
    kto.id, database);
  return kosz;
}

/* ── Towar dołożony RĘKĄ: skanem albo z kartoteki (0.365.0) ─────────────────
   Zgłoszenie właściciela: „dodaj możliwość dodawania produktów do koszyka
   zwrotowego poprzez zeskanowanie produktu lub wybranie go z kartoteki".

   To jest świadome poszerzenie decyzji nr 3 z 3 września 2026 („dokładanie nie
   jest osobnym ruchem"), a nie jej cofnięcie. Tamta decyzja opisywała ocenę
   zwrotu i tam nic się nie zmienia: „na stan" dalej dokłada samo. Ale pudło
   bywa pełniejsze niż zgłoszenie:

     - paczka NIEODEBRANA zarejestrowana bez numeru zamówienia nie ma ani
       jednej pozycji, więc nie ma czego oceniać — a towar leży na biurku,
     - klient dokłada do paczki rzecz, której nie zgłosił (blizna 0.184.0),
     - zwrot bywa u nas szybciej niż jego kopia z Allegro.

   We wszystkich trzech wypadkach jedyną drogą towaru z biurka na półkę było
   dotąd czekanie. Teraz jest skan.

   ── CZEGO TAKI WIERSZ NIE NIESIE ────────────────────────────────────────
   Nie ma za sobą zwrotu, więc nie ma ceny, nie wnosi nic do rozliczenia
   z klientem i NIE WCHODZI do bramki korekt (`brakujaceKorekty` pyta po
   `zwrot_pozycja_id`). Przesuwa wyłącznie TOWAR: na MM wchodzi tak samo jak
   pozostałe wiersze, a po rozłożeniu wraca z bufora tą samą drogą. Pieniądze
   zostają tam, gdzie były — przy zwrocie, korekcie albo przy decyzji biura.

   Tym różni się od `zaznaczSkladnik`, który dopisywać kartotek nie pozwala
   i nie będzie: tamten rusza wiersze POZYCJI ZWROTU, gdzie cena i sztuki mają
   pochodzić z dokumentu sprzedaży, a nie z pola tekstowego.                  */

/** Ile sztuk wolno dołożyć jednym ruchem. Kosz to pudło, nie dostawa. */
export const MAX_SZTUK_RECZNIE = 999;

export interface DolozonyTowar {
  koszId: number;
  kod: string;
  pozycjaId: number;
  symbol: string;
  nazwa: string;
  /** Ile sztuk stoi w koszyku PO dołożeniu — skan po skanie to widać. */
  ilosc: number;
}

/**
 * Dokłada do otwartego koszyka towar wskazany ręką. Oddaje stan wiersza.
 *
 * DRUGI SKAN TEGO SAMEGO TOWARU DOLICZA SZTUKĘ, nie zakłada drugiego wiersza.
 * Magazynier liczy sztuki skanowaniem — to jest ten sam ruch co przy dostawie
 * i ta sama odpowiedź: licznik rośnie na oczach. Osobne wiersze kazałyby
 * potem sumować je wzrokiem.
 *
 * Kartoteka jest źródłem symbolu i nazwy. Towaru spoza niej nie dokładamy:
 * na dokument MM idzie `tw_id`, a wiersz bez kartoteki nie ma czym się tam
 * przedstawić.
 */
export function dolozTowar(
  database: Db, twId: number, ile: number, kto: { id: number; name: string },
  teraz = new Date(), rodzaj: RodzajKosza = "zwroty", doKosza?: number | null,
): DolozonyTowar {
  const sztuk = Math.floor(Number(ile) || 0);
  if (sztuk < 1) throw new Error("Podaj, ile sztuk dokładasz — mniej niż jedna to nic.");
  if (sztuk > MAX_SZTUK_RECZNIE) {
    throw new Error(`Najwyżej ${MAX_SZTUK_RECZNIE} sztuk naraz — tyle mieści się w pudle.`);
  }
  if (magazynDocelowy(rodzaj) <= 0) {
    throw new Error("Ten rodzaj koszyka nie ma magazynu docelowego — sprawdź wertis.env.");
  }
  const t = database.prepare("SELECT tw_id, symbol, nazwa FROM sgt_towar WHERE tw_id = ?")
    .get(twId) as { tw_id: number; symbol: string; nazwa: string } | undefined;
  if (!t) throw new Error("Nie znam takiej kartoteki — wskaż towar ze skanu albo z listy.");
  /* ZDANIE, NIE KOD. Człowiek stoi z przedmiotem w ręku i ma wiedzieć, co
     z nim zrobić zamiast wkładać go do pudła — symbol w treści, bo skan
     pokazuje kod kreskowy, a nie to, co kartoteka o sobie mówi. */
  const powod = powodPozaMagazynem(database, twId);
  if (powod) throw new Error(`„${t.symbol}" nie wejdzie do pudła: ${powod}.`);

  return transaction(database, () => {
    const koszId = koszDoDolozenia(database, kto, teraz, rodzaj, doKosza);
    const kod = (database.prepare("SELECT kod FROM kosz WHERE id=?").get(koszId) as
      { kod: string }).kod;
    /* Wyłącznie wiersz DOŁOŻONY RĘKĄ (`zwrot_pozycja_id IS NULL`). Doliczenie
       sztuki do wiersza ze zwrotu rozjechałoby dokument MM ze zgłoszeniem
       klienta — a tamta liczba pochodzi z tego, co wróciło w paczce. */
    const stoi = database.prepare(
      `SELECT id, ilosc FROM kosz_pozycja
        WHERE kosz_id=? AND tw_id=? AND zwrot_pozycja_id IS NULL ORDER BY id LIMIT 1`)
      .get(koszId, twId) as { id: number; ilosc: number } | undefined;

    let pozycjaId: number;
    let ilosc: number;
    if (stoi) {
      ilosc = Number(stoi.ilosc) + sztuk;
      pozycjaId = Number(stoi.id);
      database.prepare("UPDATE kosz_pozycja SET ilosc=? WHERE id=?").run(ilosc, pozycjaId);
    } else {
      ilosc = sztuk;
      pozycjaId = Number(database.prepare(
        `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
         VALUES (?,?,?,?,?,NULL)`)
        .run(koszId, t.tw_id, t.symbol, t.nazwa, sztuk).lastInsertRowid);
    }
    logEvent("kosz_zwrotow_towar_dolozony", kto.name, t.tw_id,
      { koszId, kod, pozycjaId, symbol: t.symbol, dodano: sztuk, ilosc, rodzaj },
      kto.id, database);
    return { koszId, kod, pozycjaId, symbol: t.symbol, nazwa: t.nazwa, ilosc };
  })();
}

/**
 * Zdejmuje z koszyka wiersz dołożony ręką (0.365.0).
 *
 * TYLKO TAKI. Wiersz ze zwrotu schodzi cofnięciem oceny i to zostaje jedyną
 * jego drogą: ocena jest faktem o towarze, a nie zawartością pudła, więc
 * kasowanie jej z drugiej strony rozjechałoby kartę zwrotu z koszykiem.
 *
 * Pomyłka przy skanie jest normalnym elementem tej pracy, nie wyjątkiem —
 * dlatego bez roli i bez pytania „czy na pewno".
 *
 * BRAMKĄ JEST DOKUMENT, NIE ZAMKNIĘCIE (0.371.0). Do tego wydania stało tu
 * `status === "otwarty"` — węziej niż wszędzie indziej w tym pliku, z granicy
 * postawionej przez właściciela w 0.365.0: „tylko z poziomu obsługi zwrotów,
 * jak jeszcze nie jest zamknięty". Nowe zgłoszenie właściciela zdejmuje tamtą
 * granicę: „pozwól mi edytować koszyki zwrotowe, z których nie zostały jeszcze
 * utworzone MM".
 *
 * Kosztowała dokładnie tyle, ile miała chronić. Do koszyka Z-8 (25 kartotek)
 * wszedł skanem KOSZT PRZESYŁKI — kartoteka bez stanu na magazynie. Kosz się
 * zamknął, MM wyszła i Sfera odrzuciła ją zdaniem „Brak towaru w magazynie",
 * bo usługi nie da się przesunąć. Wiersza nie dało się zdjąć NIGDZIE: tu
 * blokowało zamknięcie, a PRZELICZ ZE ZWROTÓW w biurze rusza wyłącznie wiersze
 * ze zwrotów i dołożony ręką zostawia na miejscu.
 *
 * Uzasadnienie z 0.365.0 („pudło zamknięte odjechało od biurka") trzyma się
 * wyłącznie wtedy, gdy WYSZEDŁ PAPIER. Bez dokumentu nikt tego towaru nigdzie
 * nie posłał — pudło stoi, a poprawka jest zwykłą pracą, nie przepisywaniem
 * historii. To ten sam wniosek, który 0.334.0 wyciągnęło dla `zdejmijZKosza`.
 */
export function zdejmijTowar(
  database: Db, pozycjaId: number, kto: { id: number; name: string },
): { koszId: number; kod: string; symbol: string } {
  return transaction(database, () => {
    const w = database.prepare(
      `SELECT kp.id, kp.kosz_id, kp.tw_id, kp.symbol, kp.zwrot_pozycja_id, k.kod, k.rodzaj
         FROM kosz_pozycja kp JOIN kosz k ON k.id = kp.kosz_id
        WHERE kp.id = ?`).get(pozycjaId) as
      { id: number; kosz_id: number; tw_id: number; symbol: string;
        zwrot_pozycja_id: number | null; kod: string; rodzaj: string | null } | undefined;
    if (!w) throw new Error("Nie znam takiej pozycji koszyka.");
    /* KARTON NIE JEST KOSZYKIEM ZWROTÓW i po zdjęciu bramki zamknięcia trzeba
       to powiedzieć wprost. Karton nie jedzie na MM w ogóle (0.122.0), więc
       `koszDoEdycji` przepuszcza go zawsze — a pudło dostawy stojące na hali
       z listą do rozłożenia nie jest niczyją pomyłką przy skanie. */
    if ((w.rodzaj ?? "zwroty") !== "zwroty" && (w.rodzaj ?? "zwroty") !== "odpad") {
      throw new Error(`Koszyk ${w.kod} nie jest koszykiem zwrotów ani odpadu.`);
    }
    const koszId = Number(w.kosz_id);
    /* TA SAMA BRAMKA CO WSZĘDZIE W TYM PLIKU (0.371.0). Własny warunek
       rozjechałby się z `zdejmijZKosza` i `przeliczKosz` przy pierwszej zmianie
       jednej z nich — a rozjazd znaczyłby tu wiersz zdjęty z dokumentu, który
       już pojechał na halę. */
    if (!koszDoEdycji(database, koszId)) {
      throw new Error(`Koszyk ${w.kod} ma już dokument MM — jego zawartości aplikacja nie zmieni.`);
    }
    /* ── WIERSZ ZE ZWROTU SCHODZI TAKŻE STĄD (0.379.0) ─────────────────
       Do tego wydania odmawiał: „zdejmuje się ją cofnięciem oceny". Reguła
       była słuszna w zamyśle — jedna droga na jeden skutek — a w praktyce
       zostawiła koszyki bez wyjścia. Z-8 na produkcji odbił się od Sfery na
       kartotece usługowej, nie miał ani jednego wiersza dołożonego ręką
       i przez to ani jednego krzyżyka: żeby go odetkać, trzeba było odnaleźć
       zwrot, z którego przyszedł feralny wiersz. Zgłoszenie właściciela
       brzmiało „pozwól edytować te koszyki".

       OCENA SCHODZI RAZEM Z WIERSZEM, i to jest warunek spójności, nie dodatek.
       To ocena „na stan" wsadziła towar do pudła, więc wyjęcie go bez zdjęcia
       oceny zostawiłoby kartę zwrotu mówiącą, że sztuka jedzie na regał,
       którego dokument jej nie niesie. Zwrot wraca do kubełka DO OCENY i ktoś
       podejmuje decyzję jeszcze raz — tym razem wiedząc, czego Sfera nie
       przyjmie.

       SUROWY SQL, bo `zwroty.ts` importuje ten plik; import w drugą stronę
       zamknąłby cykl modułów. Ten sam wzorzec co w `zw-automat.ts`. */
    if (w.zwrot_pozycja_id !== null) {
      const poz = Number(w.zwrot_pozycja_id);
      const z = database.prepare(
        `SELECT p.zwrot_id, p.nazwa FROM zwrot_klienta_pozycja p WHERE p.id=?`)
        .get(poz) as { zwrot_id: number; nazwa: string } | undefined;
      database.prepare(`DELETE FROM kosz_pozycja
        WHERE kosz_id=? AND zwrot_pozycja_id=?`).run(koszId, poz);
      database.prepare(`UPDATE zwrot_klienta_pozycja
        SET ocena=NULL, ocena_at=NULL, ocena_przez=NULL WHERE id=?`).run(poz);
      if (z) {
        const at = new Date().toISOString();
        database.prepare(`UPDATE zwrot_klienta SET wersja=wersja+1 WHERE id=?`)
          .run(Number(z.zwrot_id));
        database.prepare(`INSERT INTO zwrot_zdarzenie
          (zwrot_id, rodzaj, tresc, dane_json, kiedy_at, kto, kto_user_id)
          VALUES (?,'ocena_cofnieta',?,?,?,?,?)`)
          .run(Number(z.zwrot_id), `${z.nazwa} — zdjęty z koszyka ${w.kod}, ocena cofnięta`,
            JSON.stringify({ pozycjaId: poz, koszId, kod: w.kod }), at, kto.name, kto.id);
      }
    } else {
      database.prepare("DELETE FROM kosz_pozycja WHERE id=?").run(pozycjaId);
    }
    /* Zadanie MM ułożone dla starej zawartości traci ważność — tak samo jak
       przy zdjęciu pozycji ze zwrotu. */
    uniewaznijZadanieMm(database, koszId, kto);
    logEvent("kosz_zwrotow_towar_zdjety", kto.name, Number(w.tw_id),
      { koszId, kod: w.kod, pozycjaId, symbol: w.symbol,
        zeZwrotu: w.zwrot_pozycja_id !== null }, kto.id, database);
    return { koszId, kod: w.kod, symbol: w.symbol };
  })();
}

/**
 * Koszyk ZAMKNIĘTY, na którym siedzi ta pozycja — albo `null`.
 *
 * Bramka dla zmiany i cofnięcia oceny (0.202.0). Do tego wydania zmiana oceny
 * na pozycji z zamkniętego kosza przechodziła po cichu: `zdejmijZKosza` szuka
 * wyłącznie kosza otwartego i przy braku trafienia oddaje `false`, którego
 * nikt nie czytał. Towar zostawał na dokumencie MM, który pojechał na halę,
 * a w bazie nie było już oceny, która go tam posłała.
 *
 * Oddajemy KOD, nie samo „tak": człowiek ma wiedzieć, na którym papierze
 * szukać, a nie tylko że się nie da.
 */
export function zamknietyKoszPozycji(
  database: Db, pozycjaId: number,
): { id: number; kod: string } | null {
  /* BRAMKĄ JEST DOKUMENT, NIE STATUS (0.334.0). Do tego wydania blokowało samo
     zamknięcie kosza — a kosz bywa zamknięty tygodniami, bo MM czeka na komplet
     korekt. Zgłoszenie właściciela: „dodałem zestaw, a powinienem rozbić go
     przed dodaniem do MM" — i nie dało się tego poprawić, choć żaden dokument
     jeszcze nie wyszedł. Pomyłka była nie do odkręcenia w aplikacji, a towar
     leżał w pudle przy biurku.

     Zadanie w toku blokuje tak samo jak gotowy numer: worker mógł już zacząć
     wystawiać dokument, a wtedy edycja rozjechałaby papier z zawartością.
     `pending` i `error` są bezpieczne — pierwsze jeszcze nie ruszyło, drugie
     się nie udało. */
  const w = database.prepare(
    `SELECT k.id, k.kod, k.mm_numer, q.status AS q_status
       FROM kosz_pozycja kp
       JOIN kosz k ON k.id = kp.kosz_id
       LEFT JOIN sfera_queue q ON q.id = k.mm_queue_id
      WHERE kp.zwrot_pozycja_id=? AND k.status<>'otwarty'
        AND (k.mm_dok_id IS NOT NULL OR k.mm_numer IS NOT NULL
             OR q.status IN ('processing','waiting_for_doc','done'))
      ORDER BY k.id LIMIT 1`)
    .get(pozycjaId) as { id: number; kod: string } | undefined;
  return w ? { id: Number(w.id), kod: w.kod } : null;
}

/**
 * Czy z tego kosza wolno jeszcze wyjmować i dokładać (0.334.0).
 *
 * Ta sama bramka co wyżej, tylko pytana o KOSZ, nie o pozycję — potrzebuje jej
 * ekran biura, żeby nie pokazywać przycisków, których serwer i tak nie przyjmie.
 */
export function koszDoEdycji(database: Db, koszId: number): boolean {
  const w = database.prepare(
    `SELECT k.mm_dok_id, k.mm_numer, q.status AS q_status
       FROM kosz k LEFT JOIN sfera_queue q ON q.id = k.mm_queue_id
      WHERE k.id=?`).get(koszId) as
    { mm_dok_id: number | null; mm_numer: string | null; q_status: string | null } | undefined;
  if (!w) return false;
  if (w.mm_dok_id != null || w.mm_numer != null) return false;
  return !["processing", "waiting_for_doc", "done"].includes(String(w.q_status ?? ""));
}

/**
 * Zdejmuje pozycję z koszyka po cofnięciu albo zmianie oceny.
 *
 * TYLKO Z KOSZA BEZ DOKUMENTU (0.334.0). Kosz z wystawioną MM pojechał już na
 * halę z papierem — wyjęcie z niego wiersza rozjechałoby dokument z zawartością,
 * a magazynier szukałby towaru, którego nikt nie wyjął z kartonu.
 */
export function zdejmijZKosza(
  database: Db, pozycjaId: number, kto: { id: number; name: string },
): number | null {
  /* WSZYSTKIE wiersze tej pozycji, nie pierwszy z brzegu: od 0.328.0 komplet
     wchodzi do koszyka kilkoma kartotekami. Zdjęcie jednej zostawiłoby resztę
     zestawu na dokumencie MM — czyli towar na papierze, którego nikt nie wyjął
     z pudła. */
  /* KOSZ ZAMKNIĘTY BEZ DOKUMENTU TEŻ (0.334.0). Pudło stoi przy biurku,
     a papieru nie ma — poprawka jest wtedy zwykłą pracą, nie przepisywaniem
     historii. Bramkę trzyma `zamknietyKoszPozycji`: gdy dokument już wyszedł,
     wołający dostaje odmowę, zanim tu dojdzie. */
  const wiersze = database.prepare(
    `SELECT kp.id, kp.kosz_id FROM kosz_pozycja kp
       JOIN kosz k ON k.id = kp.kosz_id
      WHERE kp.zwrot_pozycja_id=?`)
    .all(pozycjaId) as Array<{ id: number; kosz_id: number }>;
  if (!wiersze.length) return null;
  const koszId = Number(wiersze[0].kosz_id);
  /* JEDNA BRAMKA NA OBU DROGACH. Gdyby ta funkcja miała własny warunek,
     rozjechałaby się z `zamknietyKoszPozycji` przy pierwszej zmianie jednej
     z nich — a rozjazd znaczyłby tu wiersz zdjęty z dokumentu, który już
     pojechał na halę. */
  if (!koszDoEdycji(database, koszId)) return null;
  const usun = database.prepare("DELETE FROM kosz_pozycja WHERE id=?");
  for (const w of wiersze) usun.run(w.id);
  /* Zadanie MM ułożone dla STAREJ zawartości traci ważność. Kasujemy je
     i zerujemy `mm_queue_id`, bo tylko kosz bez zadania wraca pod
     `wypuscGotoweKoszyki` — inaczej papier pojechałby z tym, co już zdjęto. */
  uniewaznijZadanieMm(database, koszId, kto);
  logEvent("kosz_zwrotow_zdjeto", kto.name, null,
    { koszId, pozycjaId, kartotek: wiersze.length },
    kto.id, database);
  return koszId;
}

/**
 * Skład pozycji z zaznaczeniem: co WEJDZIE i co już LEŻY w koszyku (0.335.0).
 *
 * Zgłoszenie właściciela: „powinno rozbijać na komponenty do zaznaczania,
 * które idą do MM". Komplet wchodził dotąd w całości albo wcale, a wracają
 * z niego nieraz same części — reszta zostaje u klienta albo nadaje się
 * wyłącznie na odpad.
 *
 * SUMA DWÓCH LIST, nie sam `skladPozycji`. Koszyk bywa starszy niż dzisiejsze
 * reguły: kosz złożony przed 0.328.0 niesie zestaw jednym wierszem, którego
 * rozbicie z paragonu już nie zaproponuje. Pominięcie takiego wiersza znaczyłoby
 * ptaszek, którego nie da się odznaczyć — czyli towar na dokumencie, o którym
 * ekran milczy.
 */
export interface SkladDoZaznaczenia extends Omit<SkladPozycji, "skladniki"> {
  skladniki: Array<Skladnik & { wKoszyku: boolean }>;
}

export function skladDoZaznaczenia(database: Db, pozycjaId: number): SkladDoZaznaczenia {
  const sklad = skladPozycji(database, pozycjaId);
  const wKoszyku = database.prepare(
    `SELECT tw_id, symbol, nazwa, ilosc FROM kosz_pozycja
      WHERE zwrot_pozycja_id=? ORDER BY id`)
    .all(pozycjaId) as Array<{ tw_id: number; symbol: string; nazwa: string; ilosc: number }>;
  const leza = new Map(wKoszyku.map((w) => [Number(w.tw_id), w]));

  const skladniki = sklad.skladniki.map((s) => ({
    ...s,
    /* ILOŚĆ Z KOSZYKA, gdy wiersz tam stoi. To ona pojedzie na dokument MM,
       a rozbieżność z dzisiejszym wyliczeniem jest informacją, nie błędem. */
    ilosc: leza.get(s.twId)?.ilosc ?? s.ilosc,
    wKoszyku: leza.has(s.twId),
  }));
  const znane = new Set(skladniki.map((s) => s.twId));
  for (const w of wKoszyku) {
    if (znane.has(Number(w.tw_id))) continue;
    skladniki.push({
      twId: Number(w.tw_id), symbol: w.symbol, nazwa: w.nazwa,
      ilosc: Number(w.ilosc), wKoszyku: true,
    });
  }
  return { ...sklad, skladniki };
}

/**
 * Zdejmuje z koszyka jeden składnik kompletu albo wkłada go z powrotem (0.335.0).
 *
 * PTASZEK RUSZA WIERSZ KOSZYKA, nie osobną tabelę zaznaczeń, i to jest cała
 * decyzja tej funkcji. `kosz_pozycja` JEST prawdą o tym, co pojedzie na MM —
 * druga lista obok niej znaczyłaby dwa źródła dla jednego dokumentu i pytanie,
 * które z nich wygrywa, zadane w najgorszym momencie.
 *
 * Skutek uboczny jest zamierzony: `przeliczKosz` układa zawartość od nowa
 * z paragonu, więc KASUJE zaznaczenia. Tak ma być — to jedna droga wyjścia
 * z pomyłki w drugą stronę, bez osobnego przycisku „przywróć ptaszki".
 */
export function zaznaczSkladnik(
  database: Db, pozycjaId: number, twId: number, wKoszyku: boolean,
  kto: { id: number; name: string },
): SkladDoZaznaczenia {
  return transaction(database, () => {
    const wiersze = database.prepare(
      `SELECT id, kosz_id, tw_id FROM kosz_pozycja WHERE zwrot_pozycja_id=? ORDER BY id`)
      .all(pozycjaId) as Array<{ id: number; kosz_id: number; tw_id: number }>;
    if (!wiersze.length) {
      throw new Error("Ta pozycja nie leży w żadnym koszyku — najpierw oceń ją „na stan”.");
    }
    const koszId = Number(wiersze[0].kosz_id);
    const kod = (database.prepare("SELECT kod FROM kosz WHERE id=?").get(koszId) as
      { kod: string }).kod;
    /* TA SAMA BRAMKA CO WSZĘDZIE (0.334.0): dokument zamyka drogę, samo
       zamknięcie kosza nie. Własny warunek rozjechałby się z resztą pliku. */
    if (!koszDoEdycji(database, koszId)) {
      throw new Error(`Koszyk ${kod} ma już dokument MM — jego zawartości aplikacja nie zmieni.`);
    }

    const stoi = wiersze.filter((w) => Number(w.tw_id) === twId);
    if (wKoszyku) {
      if (stoi.length) return skladDoZaznaczenia(database, pozycjaId);
      /* WYŁĄCZNIE SKŁADNIK TEJ POZYCJI. Dowolna kartoteka z żądania byłaby
         drugą drogą dopisywania wierszy do MM — obok `skladPozycji` i bez
         żadnego dokumentu za sobą. Towar, którego nikt nie zwrócił, trafiałby
         wtedy na papier przez zwykłą literówkę w numerze. */
      const s = skladPozycji(database, pozycjaId).skladniki.find((x) => x.twId === twId);
      if (!s) throw new Error("Tej kartoteki nie ma w składzie pozycji — nie wolno jej dopisać.");
      /* TA SAMA BRAMKA CO PRZY DOKŁADANIU (0.377.0). Bez niej ptaszek byłby
         obejściem: koszyk napełniony przed 0.374.0 dostawał wiersz usługowy
         z powrotem przez odznaczenie i zaznaczenie go na nowo. */
      const powod = powodPozaMagazynem(database, twId);
      if (powod) throw new Error(`„${s.symbol}" nie wejdzie do pudła: ${powod}.`);
      database.prepare(
        `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
         VALUES (?,?,?,?,?,?)`).run(koszId, s.twId, s.symbol, s.nazwa, s.ilosc, pozycjaId);
    } else {
      if (!stoi.length) return skladDoZaznaczenia(database, pozycjaId);
      /* OSTATNIEGO NIE ZDEJMIEMY, i to nie jest brak funkcji. Pozycja bez
         żadnego wiersza w koszyku znaczy „nic z niej nie jedzie na MM" — a na
         to jest starsza i czytelniejsza droga: cofnięcie oceny. Dwa sposoby na
         ten sam skutek kosztowałyby pytanie, czym się różnią. */
      if (stoi.length === wiersze.length) {
        throw new Error(
          "To ostatni składnik tej pozycji w koszyku — zdejmuje się ją cofnięciem oceny.");
      }
      const usun = database.prepare("DELETE FROM kosz_pozycja WHERE id=?");
      for (const w of stoi) usun.run(w.id);
    }

    /* Zadanie MM ułożone dla starej zawartości traci ważność — tak samo jak
       przy zdjęciu całej pozycji. Bez tego papier pojechałby z ptaszkami
       sprzed poprawki. */
    uniewaznijZadanieMm(database, koszId, kto);
    logEvent("kosz_zwrotow_skladnik", kto.name, null,
      { koszId, kod, pozycjaId, twId, wKoszyku }, kto.id, database);
    return skladDoZaznaczenia(database, pozycjaId);
  })();
}

/**
 * Przelicza zawartość zamkniętego kosza od nowa, ze zwrotów (0.334.0).
 *
 * Zgłoszenie właściciela: „dodałem zestaw, a powinienem rozbić ten zestaw przed
 * dodaniem do MM — nie chce się zrobić". Kosz stał zamknięty, czekając na
 * komplet korekt, a pomyłki nie dało się odkręcić w aplikacji.
 *
 * PRZELICZENIE, A NIE EDYCJA WIERSZY, i to jest cała decyzja tej funkcji.
 * Ręczne dopisywanie kartotek do dokumentu MM znaczyłoby drugą drogę obok
 * `skladPozycji` — i drugie miejsce, w którym na papier może trafić towar,
 * którego nikt nie zwrócił. Tutaj źródłem zostaje to samo co zawsze: ocena
 * „na stan" i rozbicie z paragonu. Zmieniło się tylko to, że od 0.328.0
 * rozbicie jest lepsze niż w dniu, w którym kosz powstał.
 *
 * Pozycje bez zwrotu (kartony, koszyki z dokumentu) NIE SĄ tu ruszane: nie ma
 * ich z czego przeliczyć, a skasowanie zostawiłoby pudło bez zawartości.
 */
export function przeliczKosz(
  database: Db, koszId: number, kto: { id: number; name: string },
): { przed: number; po: number; kartotek: number } {
  return transaction(database, () => {
    const k = database.prepare("SELECT id, kod, status FROM kosz WHERE id=?").get(koszId) as
      { id: number; kod: string; status: string } | undefined;
    if (!k) throw new Error("Nie znam takiego koszyka zwrotów.");
    if (!koszDoEdycji(database, koszId)) {
      throw new Error(`Koszyk ${k.kod} ma już dokument MM — jego zawartości aplikacja nie zmieni.`);
    }

    const wiersze = database.prepare(
      `SELECT id, zwrot_pozycja_id FROM kosz_pozycja WHERE kosz_id=? ORDER BY id`)
      .all(koszId) as Array<{ id: number; zwrot_pozycja_id: number | null }>;
    const przed = wiersze.length;
    /* KOLEJNOŚĆ ZWROTÓW ZOSTAJE. Pozycje wracają w tej samej kolejności, w jakiej
       biuro je oceniało — magazynier rozkłada pudło po kartce, a przestawiona
       lista kazałaby mu szukać. */
    const zwrotowe = [...new Set(wiersze
      .map((w) => w.zwrot_pozycja_id).filter((x): x is number => x != null))];
    if (!zwrotowe.length) {
      throw new Error(`Koszyk ${k.kod} nie ma pozycji ze zwrotów — nie ma czego przeliczyć.`);
    }

    const usun = database.prepare("DELETE FROM kosz_pozycja WHERE id=?");
    for (const w of wiersze) if (w.zwrot_pozycja_id != null) usun.run(w.id);

    const wstaw = database.prepare(
      `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
       VALUES (?,?,?,?,?,?)`);
    let kartotek = 0;
    const pominiete: number[] = [];
    for (const pozycjaId of zwrotowe) {
      const sklad = skladPozycji(database, pozycjaId);
      /* Pozycja, której dziś nie umiemy rozłożyć, NIE WRACA do pudła po cichu:
         zniknięcie z dokumentu jest widoczne, a wiersz z jedną kartoteką
         zamiast trzech — nie. Zdanie o niej idzie do dziennika. */
      if (!sklad.skladniki.length) { pominiete.push(pozycjaId); continue; }
      for (const sk of sklad.skladniki) {
        wstaw.run(koszId, sk.twId, sk.symbol, sk.nazwa, sk.ilosc, pozycjaId);
        kartotek++;
      }
    }

    uniewaznijZadanieMm(database, koszId, kto);
    logEvent("kosz_zwrotow_przeliczony", kto.name, null,
      { koszId, kod: k.kod, przed, po: kartotek, pominiete }, kto.id, database);
    return { przed, po: kartotek, kartotek };
  })();
}

/**
 * Unieważnia zadanie MM ułożone dla poprzedniej zawartości kosza (0.334.0).
 *
 * Zadanie `pending` da się anulować — jeszcze nie ruszyło. `error` zostaje
 * w kolejce jako ślad po nieudanej próbie i tylko odpinamy je od kosza: kosz
 * bez `mm_queue_id` wraca pod `wypuscGotoweKoszyki` i dostanie świeże zadanie
 * z nową zawartością. Zadania w toku tu nie dojdą — blokuje je bramka.
 */
function uniewaznijZadanieMm(
  database: Db, koszId: number, kto: { id: number | null; name: string },
): void {
  const k = database.prepare("SELECT mm_queue_id FROM kosz WHERE id=?").get(koszId) as
    { mm_queue_id: number | null } | undefined;
  if (!k?.mm_queue_id) return;
  const z = database.prepare("SELECT status FROM sfera_queue WHERE id=?")
    .get(k.mm_queue_id) as { status: string } | undefined;
  if (z?.status === "pending") {
    database.prepare(
      `UPDATE sfera_queue SET status='cancelled',
        processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?`).run(k.mm_queue_id);
  }
  database.prepare("UPDATE kosz SET mm_queue_id=NULL WHERE id=?").run(koszId);
  logEvent("kosz_zwrotow_mm_uniewazniona", kto.name, null,
    { koszId, queueId: k.mm_queue_id, stan: z?.status ?? null }, kto.id, database);
}

/** Co leży w otwartym koszyku tego rodzaju. `null`, gdy jeszcze żadnego nie ma. */
export function stanOtwartegoKosza(
  database: Db, kto: { name: string }, rodzaj: RodzajKosza = "zwroty",
): StanKosza | null {
  const k = database.prepare(
    `SELECT id FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? AND rodzaj=? ORDER BY id LIMIT 1`).get(kto.name, rodzaj) as
    { id: number } | undefined;
  return k ? stanKosza(database, Number(k.id), rodzaj) : null;
}

/** Jedno pudło z zawartością — wspólny kształt dla wszystkich odczytów. */
function stanKosza(database: Db, koszId: number, rodzaj: RodzajKosza): StanKosza {
  const k = database.prepare("SELECT id, kod, utworzono_at FROM kosz WHERE id=?")
    .get(koszId) as { id: number; kod: string; utworzono_at: string };
  const pozycje = database.prepare(
    `SELECT id, symbol, nazwa, ilosc, zwrot_pozycja_id FROM kosz_pozycja
      WHERE kosz_id=? ORDER BY id`)
    .all(k.id) as Array<{
    id: number; symbol: string; nazwa: string; ilosc: number; zwrot_pozycja_id: number | null;
  }>;
  return {
    rodzaj,
    id: Number(k.id), kod: k.kod, otwartyOd: k.utworzono_at,
    pozycji: pozycje.length,
    sztuk: pozycje.reduce((s, p) => s + Number(p.ilosc), 0),
    pozycje: pozycje.map((p) => ({
      id: Number(p.id), symbol: p.symbol, nazwa: p.nazwa, ilosc: Number(p.ilosc),
      zeZwrotu: p.zwrot_pozycja_id !== null,
    })),
  };
}

/**
 * WSZYSTKIE otwarte pudła operatora, od najstarszego (0.379.0).
 *
 * Do 0.378.0 oddawało najwyżej jedno na rodzaj, bo tyle wolno było mieć.
 * Decyzja właściciela to odwróciła — a lista, która pokazuje jedno z kilku,
 * kłamałaby o tym, ile kartonów stoi przy biurku.
 */
export function otwarteKoszyki(database: Db, kto: { name: string }): StanKosza[] {
  const rodzaje: RodzajKosza[] = ["zwroty", "odpad"];
  const out: StanKosza[] = [];
  for (const r of rodzaje) {
    if (magazynDocelowy(r) <= 0) continue;
    for (const k of otwarteTegoRodzaju(database, kto, r)) {
      out.push(stanKosza(database, k.id, r));
    }
  }
  return out;
}

/**
 * Zwroty wnoszące pozycje do koszyka, którym BRAKUJE numeru korekty.
 *
 * `LEFT JOIN` świadomie: `zwroty:reset` (0.199.0) kasuje zwroty, zostawiając
 * pozycje zamkniętych koszyków jako snapshot z wiszącym `zwrot_pozycja_id`.
 * Wiersz bez zwrotu NIE BLOKUJE — koszyk czekający wiecznie na dokument, po
 * którym nie ma śladu, jest gorszy niż wypuszczony.
 */
export function brakujaceKorekty(database: Db, koszId: number): Array<{
  zwrotId: number; numer: string;
}> {
  return (database.prepare(
    `SELECT DISTINCT p.zwrot_id AS zwrot_id,
            COALESCE(z.reference_number, z.external_id) AS numer
       FROM kosz_pozycja kp
       JOIN zwrot_klienta_pozycja p ON p.id = kp.zwrot_pozycja_id
       JOIN zwrot_klienta z ON z.id = p.zwrot_id
      WHERE kp.kosz_id = ? AND z.korekta_numer IS NULL
      ORDER BY p.zwrot_id`).all(koszId) as Array<{ zwrot_id: number; numer: string }>)
    .map((w) => ({ zwrotId: Number(w.zwrot_id), numer: w.numer }));
}

/**
 * Wkłada MM koszyka do kolejki. Oddaje `id` zadania.
 *
 * Wydzielone, bo od 0.200.0 wołają to DWIE drogi: zamknięcie koszyka, którego
 * korekty już są, i późniejsze wypuszczenie po dopisaniu ostatniego numeru.
 */
function zakolejkujMm(
  database: Db, k: { id: number; kod: string; rodzaj: RodzajKosza },
  kto: { id: number | null; name: string }, at: string,
): number {
  const pozycje = database.prepare(
    "SELECT tw_id, ilosc FROM kosz_pozycja WHERE kosz_id=?")
    .all(k.id) as Array<{ tw_id: number; ilosc: number }>;

  /* Pozycje SUMUJĄ SIĘ po kartotece. Ten sam towar z dwóch różnych zwrotów
     to jedna linia dokumentu — Subiekt przyjąłby i dwie, ale magazynier
     liczyłby wtedy ten sam symbol dwa razy przy tym samym regale. */
  const wgTowaru = new Map<number, number>();
  for (const p of pozycje) {
    wgTowaru.set(Number(p.tw_id), (wgTowaru.get(Number(p.tw_id)) ?? 0) + Number(p.ilosc));
  }
  const items = [...wgTowaru].map(([twId, qty]) => ({ twId, qty }));

  /* Przez `enqueueMM`, nie własnym INSERT-em. Do 0.201.3 był to DRUGI writer
     kolejki w produkcji — a niezmiennik o kształcie zadania MM stoi przy
     `enqueueMM` i tam się go czyta. Zadanie jest WIELOPOZYCYJNE i bez `twId`:
     jeden koszyk to jeden dokument i jedna kartka dla magazyniera. Guard
     kolejności nic przez to nie traci, bo MM idzie Z magazynu głównego —
     na bufor zwrotów albo na odpad — i sprzedawalnym towaru nie czyni. */
  const odpad = k.rodzaj === "odpad";
  const queueId = enqueueMM(config.magId.MAG, magazynDocelowy(k.rodzaj), items, {
    createdBy: kto.name,
    /* JAWNY `null` automatu ma przeżyć: `wypuscGotoweKoszyki` biegnie także
       z wnętrza żądania, tuż po tym, jak człowiek wpisał numer korekty. */
    createdByRef: kto.id,
    createdAt: at,
    /* Etykieta MÓWI, DOKĄD jedzie. Magazynier bierze kartkę i idzie: „regał
       zwrotów" i „magazyn odpadu" to dwa różne końce hali, a dokument MM sam
       z siebie tego nie powie. */
    label: `${odpad ? "Koszyk odpadu" : "Koszyk zwrotów"} ${k.kod}`,
    detail: `${items.length} kartotek ${odpad ? "na magazyn odpadu" : "na regał zwrotów"}`,
  }, database);

  database.prepare("UPDATE kosz SET mm_queue_id=? WHERE id=?").run(queueId, k.id);
  return queueId;
}

/**
 * Wypuszcza MM koszyków, którym doszedł ostatni brakujący numer korekty.
 *
 * Oddaje liczbę wypuszczonych — takt ma powiedzieć, ile pracy zdjął.
 *
 * IDEMPOTENCJA STOI NA `mm_queue_id`. Koszyk z wypełnioną kolumną jest poza
 * zasięgiem tej funkcji, bo dwa takty w tej samej sekundzie dałyby dwa
 * dokumenty MM na jeden fizyczny kosz — a magazynier dostałby dwie kartki
 * i rozłożyłby towar raz.
 */
export function wypuscGotoweKoszyki(database: Db, teraz = new Date()): number {
  /* OBA RODZAJE (0.211.0). Bramka korekty obowiązuje odpad tak samo jak
     zwroty: towar wraca na magazyn główny dopiero po korekcie, więc MM na
     odpad zdjęłoby stan, którego jeszcze nie ma.

     TAKŻE KOSZ JUŻ ROZŁOŻONY. Zamknięcie jest czynnością fizyczną, więc hala
     rozkłada kosz, zanim biuro wpisze korekty. Do tego wydania automat patrzył
     wyłącznie na `zamkniety`: kosz rozłożony przed korektą tracił swoje MM
     na zawsze, a MM powrotne zdejmowało z regału zwrotów stan, którego tam
     nie było. `powrot_poza_aplikacja` odsiewa kosze rozliczone ręką przez biuro
     — dokument wystawiony dziś przesunąłby ich towar drugi raz. */
  const czekajace = database.prepare(
    `SELECT id, kod, rodzaj FROM kosz
      WHERE status IN ('zamkniety','rozlozony') AND powrot_poza_aplikacja = 0
        AND mm_dok_id IS NULL AND mm_queue_id IS NULL
        AND rodzaj IN ('zwroty','odpad') ORDER BY id`)
    .all() as Array<{ id: number; kod: string; rodzaj: RodzajKosza }>;

  let wypuszczone = 0;
  for (const k of czekajace) {
    if (brakujaceKorekty(database, Number(k.id)).length > 0) continue;
    /* PUSTY KOSZ NIE DOSTAJE DOKUMENTU (0.334.0). Od tego wydania da się
       wyjąć pozycję z kosza zamkniętego bez dokumentu — a kosz opróżniony do
       zera dostałby tu MM bez ani jednej linii, którą Sfera i tak odrzuci. */
    const { n } = database.prepare(
      "SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?").get(k.id) as { n: number };
    if (!n) continue;
    /* Każdy koszyk WŁASNĄ transakcją: jeden wywrócony nie ma prawa zabrać
       pozostałych — ta sama lekcja co przy sygnaturach w 0.169.0. */
    transaction(database, () => {
      const queueId = zakolejkujMm(database,
        { id: Number(k.id), kod: k.kod, rodzaj: k.rodzaj },
        { id: null, name: AUTOMAT_KOREKTY }, teraz.toISOString());
      logEvent("kosz_zwrotow_wypuszczony", AUTOMAT_KOREKTY, null,
        { koszId: Number(k.id), kod: k.kod, queueId }, undefined, database);
    })();
    wypuszczone++;
  }
  return wypuszczone;
}

export interface KoszykCzekajacy {
  id: number;
  kod: string;
  /** Zwroty czy odpad — ekran mówi, na który koniec hali czeka papier. */
  rodzaj: RodzajKosza;
  zamknietoAt: string;
  /** Zwroty bez numeru korekty — człowiek ma wiedzieć, czego szukać. */
  brakuje: Array<{ zwrotId: number; numer: string }>;
  /**
   * Odmowa Sfery, gdy zadanie MM stanęło w błędzie — inaczej `null` (0.371.0).
   *
   * Niepusta wartość znaczy też, że zadanie WCIĄŻ WISI przy koszu: dopóki
   * wisi, nie ma czego wypuszczać i przycisk „wystaw" nie ma tu prawa stać.
   */
  blad: string | null;
  /**
   * CAŁA zawartość pudła, nie tylko wiersze dołożone ręką (0.379.0).
   *
   * Do tego wydania stały tu wyłącznie wiersze ze skanu, bo tylko one dawały
   * się zdjąć. Koszyk Z-8 pokazał cenę tej reguły: odbił się od Sfery na
   * kartotece usługowej przyniesionej OCENĄ, więc nie miał ani jednego
   * krzyżyka i nie było jak go odetkać z tego ekranu.
   *
   * `zeZwrotu` zostaje, bo zdjęcie takiego wiersza cofa przy okazji ocenę —
   * i ekran ma to powiedzieć PRZED kliknięciem, a nie po nim.
   */
  pozycje: Array<{
    pozycjaId: number; symbol: string; nazwa: string; ilosc: number; zeZwrotu: boolean;
    /**
     * Ile TEGO towaru leży na magazynie, z którego MM ma go zabrać (0.381.0).
     *
     * Sfera odrzuca dokument zdaniem „Brak towaru w magazynie" i NIE MÓWI,
     * którego. Zgłoszenie właściciela z produkcji: „dostaję brak towaru
     * w magazynie, ale nie mówi jakiego, abym mógł go usunąć z koszyka".
     * Liczba stąd wskazuje wiersz palcem — a zdejmuje się go tym samym
     * krzyżykiem, który już przy nim stoi.
     */
    stanMag: number;
    /** Czy tego wiersza NIE DA SIĘ przesunąć: na magazynie jest go za mało. */
    brakNaMag: boolean;
  }>;
}

/* ── Jedno pudło, jedno imię (0.376.0) ──────────────────────────────────────
   Do tego wydania karton nosił DWA imiona. Obsługa napełniała koszyk „Z-7",
   a hala rozkładała kosz z jego dokumentu — „1209" — bo `otworzPrzyjecie`
   zakładał wtedy NOWY kosz, pusty i bez związku z tamtym. Jeden fizyczny
   karton był więc dwiema jednostkami pracy: pierwsza nie miała ani jednego
   odłożenia, druga nie miała zamknięcia, a raport cyklu musiał zszywać je
   heurystyką po czasie, bo numery MM powtarzają się co rok.

   Wiązanie robi to, czego brakowało: po wejściu dokumentu do Subiekta koszyk
   DOSTAJE ten dokument, zamiast rodzić sobie sobowtóra. Hala otwiera wtedy ten
   sam kosz — z jego zawartością, jego historią i jego kodem.

   PO PEŁNYM NUMERZE, nie po samej liczbie. `sgt_doc_number` niesie to, co
   oddała Sfera („MM 1209/MAG/2026"), a liczba z numeru powtarza się co rok.
   Dopasowanie po niej zderzyłoby dzisiejszy karton z zeszłorocznym.          */

/**
 * Wiąże koszyki z dokumentami MM, które weszły już do read-modelu.
 *
 * Oddaje liczbę związanych. Woła to worker co minutę, obok numerów ZW —
 * dokument pojawia się w read-modelu dopiero po imporcie, więc chwila między
 * zapisem w Sferze a tym wiązaniem jest normalna, nie awaryjna.
 *
 * IDEMPOTENTNE przez `mm_dok_id IS NULL` w warunku UPDATE: dwa takty w tej
 * samej sekundzie nie mają jak związać kosza dwa razy.
 */
export function zwiazKoszykiZDokumentami(database: Db): number {
  const czekajace = database.prepare(
    `SELECT k.id, k.kod, q.sgt_doc_number AS numer
       FROM kosz k JOIN sfera_queue q ON q.id = k.mm_queue_id
      WHERE k.mm_dok_id IS NULL AND q.type='mm' AND q.status='done'
        AND q.sgt_doc_number IS NOT NULL
      ORDER BY k.id`).all() as Array<{ id: number; kod: string; numer: string }>;

  let zwiazanych = 0;
  for (const k of czekajace) {
    const dok = database.prepare(
      "SELECT dok_id, mag_z FROM sgt_mm_zwrot WHERE nr_pelny = ?").get(k.numer) as
      { dok_id: number; mag_z: number | null } | undefined;
    /* Brak dokumentu w read-modelu NIE jest błędem: import chodzi co minutę,
       a Sfera właśnie go wystawiła. Kosz poczeka do następnego taktu. */
    if (!dok) continue;

    /* WYŚCIG Z HALĄ. Między importem a tym taktem mija do minuty, a w tej
       minucie magazynier może zdążyć zeskanować numer z kartki — wtedy
       `otworzPrzyjecie` założyło już kosz na ten dokument. Drugi kosz z tym
       samym `mm_dok_id` dałby dwa wiersze w liście przyjęć, otwierałby cudze
       pudło i mógłby zamówić DRUGIE MM powrotne na towar, który już wrócił.

       Nie wiążemy wtedy niczego. Kartka z numerem działa jak dotąd, a koszyk
       zostaje bez dokumentu — czyli dokładnie tak, jak przed 0.376.0. */
    const zajety = database.prepare(
      "SELECT id FROM kosz WHERE mm_dok_id=? AND id<>? LIMIT 1")
      .get(dok.dok_id, k.id) as { id: number } | undefined;
    if (zajety) {
      logEvent("kosz_zwrotow_zwiazanie_pominiete", AUTOMAT_KOREKTY, null,
        { koszId: k.id, kod: k.kod, dokId: Number(dok.dok_id), zajetyPrzez: zajety.id },
        undefined, database);
      continue;
    }
    /* `mm_mag_z` RAZEM z dokumentem, nie osobno. Od chwili związania trasę
       powrotu liczy gałąź „kosz z dokumentu" (`trasaPowrotu` w `kosze.ts`),
       a ta bierze magazyn docelowy WYŁĄCZNIE z tej kolumny. Bez niej związany
       koszyk przestałby dostawać MM powrotne i zgłaszałby się w rekoncyliacji
       jako `kosz_bez_powrotu` — towar zostałby na regale zwrotów. */
    const r = database.prepare(
      "UPDATE kosz SET mm_dok_id=?, mm_numer=?, mm_mag_z=? WHERE id=? AND mm_dok_id IS NULL")
      .run(dok.dok_id, k.numer, dok.mag_z, k.id);
    if (Number(r.changes) === 0) continue;
    zwiazanych++;
    logEvent("kosz_zwrotow_zwiazany", AUTOMAT_KOREKTY, null,
      { koszId: k.id, kod: k.kod, dokId: Number(dok.dok_id), numer: k.numer,
        magZ: dok.mag_z },
      undefined, database);
  }
  return zwiazanych;
}

/**
 * Koszyki zamknięte BEZ DOKUMENTU — wszystko, co jeszcze czeka na człowieka
 * albo na papier (0.371.0).
 *
 * Do tego wydania lista pokazywała wyłącznie kosze, którym brakuje korekt,
 * i wyłącznie takie, do których nie przypięto jeszcze zadania. Koszyk Z-8
 * wypadł przez obie dziury naraz: korekty miał komplet, zadanie MM dostał,
 * a Sfera odrzuciła je zdaniem „Brak towaru w magazynie", bo skanem wszedł do
 * niego KOSZT PRZESYŁKI — kartoteka bez stanu, której nie da się przesunąć.
 * Kosz zniknął wtedy z panelu: dokumentu nie ma, pudło stoi, i nikt nie mówi
 * dlaczego. Cisza jest tu gorsza od złej wiadomości.
 *
 * TRZY STANY, JEDEN PASEK. Kosz bez dokumentu czeka dokładnie na jedno z:
 * brakującą korektę, poprawkę zawartości po odmowie Sfery, albo na samo
 * wypuszczenie MM (po poprawce zadanie znika i nikt go nie ponawia aż do
 * następnego taktu wiązań). Osobny ekran na każdy z nich kazałby zgadywać,
 * na który patrzeć.
 *
 * Kosza z zadaniem W TOKU tu nie ma i nie powinno być: papier jest w drodze,
 * a jedyną odpowiedzią byłoby „czekaj".
 */
/**
 * Z którego magazynu miała zabrać towar ta MM (0.381.0).
 *
 * Z ZADANIA, nie z konfiguracji: koszyk odpadu i koszyk zwrotów jadą dziś
 * z tego samego magazynu, ale zadanie zna swój `magFrom` na pewno, a
 * konfiguracja mogła się w międzyczasie zmienić. Kosz bez zadania jeszcze go
 * nie ma — wtedy zostaje magazyn główny, bo stamtąd MM koszyka wychodzi.
 */
function magazynZrodlowy(payload: string | null): number {
  if (!payload) return config.magId.MAG;
  try {
    const p = JSON.parse(payload) as { magFrom?: number };
    return Number(p.magFrom) || config.magId.MAG;
  } catch {
    /* Uszkodzony payload nie ma prawa zabrać paska: pytamy o magazyn główny
       i pokazujemy kosz tak, jak dotąd. */
    return config.magId.MAG;
  }
}

export function koszykiBezDokumentu(database: Db): KoszykCzekajacy[] {
  /* Ten sam zbiór co w `wypuscGotoweKoszyki`, z rozłożonymi włącznie i z jedną
     różnicą: zadanie w BŁĘDZIE nie wyklucza kosza. Tamta funkcja pomija go
     słusznie (nie wolno wystawiać drugiego dokumentu obok wiszącego zadania),
     ale ekran ma go pokazać właśnie dlatego, że sam się już nie odblokuje. */
  const kosze = database.prepare(
    `SELECT k.id, k.kod, k.zamknieto_at, k.rodzaj, q.error_msg AS blad, q.payload
       FROM kosz k LEFT JOIN sfera_queue q ON q.id = k.mm_queue_id
      WHERE k.status IN ('zamkniety','rozlozony') AND k.powrot_poza_aplikacja = 0
        AND k.mm_dok_id IS NULL AND k.rodzaj IN ('zwroty','odpad')
        AND (k.mm_queue_id IS NULL OR q.status = 'error')
      ORDER BY k.id`)
    .all() as Array<{ id: number; kod: string; zamknieto_at: string;
      rodzaj: RodzajKosza; blad: string | null; payload: string | null }>;
  const wiersze = database.prepare(
    `SELECT kp.id, kp.tw_id, kp.symbol, kp.nazwa, kp.ilosc, kp.zwrot_pozycja_id,
            COALESCE(st.stan, 0) AS stan
       FROM kosz_pozycja kp
       LEFT JOIN sgt_stan st ON st.tw_id = kp.tw_id AND st.mag_id = ?
      WHERE kp.kosz_id = ? ORDER BY kp.id`);
  return kosze.map((k) => ({
    id: Number(k.id), kod: k.kod, zamknietoAt: k.zamknieto_at, rodzaj: k.rodzaj,
    brakuje: brakujaceKorekty(database, Number(k.id)),
    blad: k.blad ?? null,
    pozycje: (wiersze.all(magazynZrodlowy(k.payload), k.id) as Array<
      { id: number; symbol: string; nazwa: string; ilosc: number;
        zwrot_pozycja_id: number | null; stan: number }>)
      .map((p) => ({
        pozycjaId: Number(p.id), symbol: p.symbol, nazwa: p.nazwa, ilosc: Number(p.ilosc),
        zeZwrotu: p.zwrot_pozycja_id !== null,
        stanMag: Number(p.stan),
        brakNaMag: Number(p.stan) < Number(p.ilosc),
      })),
  }));
}

/**
 * Koszyki zamknięte, którym brakuje korekt — do pokazania w panelu.
 *
 * Bez tego czekanie byłoby ciszą: kosz stoi zamknięty, dokumentu nie ma,
 * a nikt nie wie, na czym stoi sprawa. Kubełek DO KOREKTY zbiera tę samą
 * pracę, więc to jedno zdanie przy koszyku, nie nowy ekran.
 *
 * WĘŻSZY WIDOK tej samej listy od 0.371.0. Rozjazd zbioru z `wypuscGotoweKoszyki`
 * dałby kosz, który czeka, a o którym nikt nie mówi — więc filtr, nie drugie
 * zapytanie. Czyta to `reconcile`, który mówi „brakuje: ..." i o koszu bez
 * ani jednego brakującego numeru nie miałby co powiedzieć.
 */
export function koszykiCzekajaceNaKorekty(database: Db): KoszykCzekajacy[] {
  return koszykiBezDokumentu(database)
    .filter((k) => k.brakuje.length > 0 && k.blad === null);
}

/**
 * Wypuszcza MM koszyka MIMO BRAKUJĄCYCH KOREKT (0.368.0).
 *
 * Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka, nawet
 * jeśli nie ma wszystkich ZW". Bramka z 0.200.0 zostaje domyślna i zostaje
 * słuszna — to jest wyjście awaryjne obok niej, nie jej zdjęcie.
 *
 * CO TO KOSZTUJE, powiedziane wprost, bo płaci to magazyn. MM zdejmuje towar
 * z magazynu GŁÓWNEGO, a ze zwrotu towar trafia tam dopiero po korekcie
 * wystawionej w Subiekcie. Dokument wypuszczony wcześniej idzie na stan,
 * którego jeszcze nie ma: Sfera odrzuci go przy braku stanu albo — gdy
 * Subiekt dopuszcza ujemne — zepchnie stan pod zero i różnica wyrówna się
 * dopiero z korektą. To dokładnie ten błąd kolejności, który naprawiło
 * 0.200.0, więc droga jest ŚWIADOMA i zostawia ślad z imionami zwrotów.
 *
 * KIEDY MA SENS. Korekta bywa wystawiona poza aplikacją albo wystawi się za
 * chwilę, a kosz fizycznie stoi na drodze i blokuje pracę hali. Człowiek przy
 * biurku wie to, czego baza nie wie — i to on bierze decyzję na siebie.
 *
 * JEDNA DROGA NA OBA STANY. Kosz otwarty zamyka się po drodze; kosz już
 * zamknięty albo rozłożony dostaje sam dokument. Osobna opcja przy zamykaniu
 * i osobny przycisk przy koszu czekającym byłyby dwiema nazwami na jedną
 * decyzję, a kosz, który stoi tygodniami, jest właśnie tym drugim przypadkiem.
 *
 * CZEGO NIE FORSUJE: kosza z dokumentem (papier już wyszedł), kosza pustego
 * (dokument bez linii nie jest dokumentem) i kosza rozliczonego poza
 * aplikacją (jego towar przesunął już ktoś ręką). Te trzy odmowy nie są
 * ostrożnością, tylko brakiem czegokolwiek do zrobienia.
 */
export function wypuscMmMimoKorekt(
  database: Db, koszId: number, kto: { id: number; name: string }, teraz = new Date(),
): { koszId: number; kod: string; queueId: number; pominietoKorekt: number } {
  return transaction(database, () => {
    const k = database.prepare(
      `SELECT id, kod, status, rodzaj, powrot_poza_aplikacja, mm_dok_id, mm_queue_id
         FROM kosz WHERE id=?`).get(koszId) as {
      id: number; kod: string; status: string; rodzaj: RodzajKosza;
      powrot_poza_aplikacja: number; mm_dok_id: number | null; mm_queue_id: number | null;
    } | undefined;
    if (!k) throw new Error("Nie znam takiego koszyka zwrotów.");
    if (k.mm_dok_id !== null || k.mm_queue_id !== null) {
      throw new Error(`Koszyk ${k.kod} ma już dokument MM — nie ma czego wypuszczać.`);
    }
    if (Number(k.powrot_poza_aplikacja) === 1) {
      throw new Error(`Koszyk ${k.kod} rozliczono poza aplikacją — jego towar już wrócił.`);
    }
    /* Karton nie jedzie na MM w ogóle (0.122.0): towar nie opuścił magazynu,
       więc nie ma czego przesuwać i forsowanie niczego by nie odblokowało. */
    if (k.rodzaj !== "zwroty" && k.rodzaj !== "odpad") {
      throw new Error(`Koszyk ${k.kod} nie jedzie na MM — dokumentu nie ma i nie będzie.`);
    }

    const pozycji = (database.prepare(
      "SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id=?")
      .get(koszId) as { n: number }).n;
    if (!pozycji) throw new Error(`Koszyk ${k.kod} jest pusty — nie ma z czego wystawić MM.`);

    const at = teraz.toISOString();
    if (k.status === "otwarty") {
      database.prepare(
        `UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=?
          WHERE id=?`).run(at, kto.name, koszId);
    }

    const braki = brakujaceKorekty(database, koszId);
    const queueId = zakolejkujMm(database,
      { id: koszId, kod: k.kod, rodzaj: k.rodzaj }, kto, at);

    /* ŚLAD Z IMIONAMI, nie samą liczbą. Gdy MM wywróci się na braku stanu,
       pierwsze pytanie brzmi „na czyją korektę nie doczekaliśmy" — i wtedy
       zdarzenie ma na nie odpowiedzieć bez odtwarzania stanu bazy sprzed
       wypuszczenia. Numery zwrotów daną osobową nie są. */
    logEvent("kosz_zwrotow_mm_mimo_korekt", kto.name, null,
      { koszId, kod: k.kod, pozycji, queueId,
        pominietoKorekt: braki.length, zwroty: braki.map((b) => b.numer) },
      kto.id, database);
    return { koszId, kod: k.kod, queueId, pominietoKorekt: braki.length };
  })();
}

/**
 * Zamyka koszyk. Dokument MM wychodzi DOPIERO PO KOREKTACH.
 *
 * Do 0.199.0 zamknięcie kolejkowało MM od razu — i to był błąd kolejności,
 * nie kosmetyka. MM zdejmuje towar z magazynu GŁÓWNEGO, a towar ze zwrotu
 * trafia na ten magazyn dopiero wtedy, gdy biuro wystawi w Subiekcie korektę
 * albo zwrot do paragonu. Dokument szedł więc na stan, którego jeszcze nie
 * było. Właściciel opisał właściwą kolejność sam (`docs/obsluga-klienta.md`):
 * „paczka wraca, korekta, MM na bufor".
 *
 * Kosz staje się `zamkniety` OD RAZU, bo zamknięcie jest czynnością FIZYCZNĄ:
 * kosz się zapełnił, więc odchodzi od biurka. Wiązanie tego z papierologią
 * zatrzymywałoby pracę hali na decyzji, która jej nie dotyczy.
 *
 * Pusty kosz odmawia. Dokument bez pozycji nie jest dokumentem, a Sfera i tak
 * odrzuciłaby go dopiero w workerze — czyli po tym, jak operator odszedłby
 * od biurka.
 */
export function zamknijKosz(
  database: Db, koszId: number, kto: { id: number; name: string }, teraz = new Date(),
): {
  koszId: number; kod: string; pozycji: number;
  queueId: number | null; brakujeKorekt: number;
} {
  return transaction(database, () => {
    const k = database.prepare(
      "SELECT id, kod, status, rodzaj FROM kosz WHERE id=? AND mm_dok_id IS NULL")
      .get(koszId) as
      { id: number; kod: string; status: string; rodzaj: RodzajKosza } | undefined;
    if (!k) throw new Error("Nie znam takiego koszyka zwrotów.");
    if (k.status !== "otwarty") throw new Error(`Koszyk ${k.kod} jest już ${k.status}.`);

    const pozycje = database.prepare(
      "SELECT tw_id, ilosc FROM kosz_pozycja WHERE kosz_id=?")
      .all(koszId) as Array<{ tw_id: number; ilosc: number }>;
    if (!pozycje.length) {
      throw new Error(`Koszyk ${k.kod} jest pusty — nie ma z czego wystawić MM.`);
    }

    const at = teraz.toISOString();
    database.prepare(
      `UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=?
        WHERE id=?`).run(at, kto.name, koszId);

    /* Komplet korekt sprawdzamy PO zamknięciu, na zapisanym już koszu: gdy
       niczego nie brakuje, MM wychodzi w tej samej transakcji i operator nie
       widzi różnicy wobec dawnego zachowania. */
    const braki = brakujaceKorekty(database, koszId);
    const queueId = braki.length === 0
      ? zakolejkujMm(database, { id: koszId, kod: k.kod, rodzaj: k.rodzaj }, kto, at)
      : null;

    logEvent("kosz_zwrotow_zamkniety", kto.name, null,
      { koszId, kod: k.kod, pozycji: pozycje.length, queueId,
        brakujeKorekt: braki.length },
      kto.id, database);
    return {
      koszId, kod: k.kod, pozycji: pozycje.length, queueId, brakujeKorekt: braki.length,
    };
  })();
}
