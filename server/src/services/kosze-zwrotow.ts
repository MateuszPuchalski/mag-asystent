import { logEvent } from "./events.js";
import { transaction, type Db } from "../db/db.js";
import { config } from "../config.js";
import { enqueueMM } from "./queue.js";
import { iloscLiczona } from "./ilosc-zwrotu.js";

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
  pozycje: Array<{ symbol: string; nazwa: string; ilosc: number }>;
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

/**
 * Otwarty koszyk tego operatora — istniejący albo świeżo założony.
 *
 * Szuka po `utworzono_przez`, bo to jest właściciel fizycznego kosza. Kosze
 * z Subiekta (`mm_dok_id IS NOT NULL`) odpadają: tamte rodzi dokument, a nie
 * praca przy biurku, i nigdy nie stoją otwarte.
 */
export function otwartyKosz(database: Db, kto: { id: number; name: string },
  teraz = new Date(), rodzaj: RodzajKosza = "zwroty"): number {
  /* PO RODZAJU, nie tylko po właścicielu (0.211.0). Operator ma przy biurku
     dwa pudła naraz — zwroty i odpad — a bez tego warunku pozycja do
     utylizacji wpadłaby do pierwszego z brzegu i pojechała na zły magazyn. */
  const juz = database.prepare(
    `SELECT id FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? AND rodzaj=? ORDER BY id LIMIT 1`)
    .get(kto.name, rodzaj) as { id: number } | undefined;
  if (juz) return Number(juz.id);

  const at = teraz.toISOString();
  const kod = nowyKod(database);
  const id = Number(database.prepare(
    `INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez)
     VALUES (?, 'otwarty', ?, ?, ?)`).run(kod, rodzaj, at, kto.name).lastInsertRowid);
  logEvent("kosz_zwrotow_otwarty", kto.name, null, { koszId: id, kod, rodzaj },
    kto.id, database);
  return id;
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
  rodzaj: RodzajKosza = "zwroty",
): number | null {
  /* Odpad bez numeru magazynu w `wertis.env` nie ma dokąd jechać. Koszyka
     wtedy NIE zakładamy: ocena zapisuje się jak przed 0.211.0, a ekran
     powie, że do koszyka nie weszła. */
  if (magazynDocelowy(rodzaj) <= 0) return null;
  const p = database.prepare(
    `SELECT p.id, p.tw_id, p.nazwa, p.ilosc, p.ilosc_zwrocona, t.symbol
       FROM zwrot_klienta_pozycja p
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
      WHERE p.id=?`).get(pozycjaId) as
    { id: number; tw_id: number | null; nazwa: string; ilosc: number;
      ilosc_zwrocona: number | null; symbol: string | null } | undefined;
  if (!p || p.tw_id == null) return null;

  const koszId = otwartyKosz(database, kto, teraz, rodzaj);
  /* Dwa razy ta sama pozycja to jeden wiersz. Operator bywa poprawiany:
     cofnięcie oceny i ponowne „na stan" nie ma prawa podwoić sztuk na MM. */
  const stoi = database.prepare(
    "SELECT id FROM kosz_pozycja WHERE kosz_id=? AND zwrot_pozycja_id=?")
    .get(koszId, pozycjaId) as { id: number } | undefined;
  if (stoi) return koszId;

  /* TO, CO WRÓCIŁO, nie deklaracja klienta (0.212.0). Na dokument MM idzie
     towar, który fizycznie leży w pudle — liczba z Allegro opisuje zamiar
     klienta, a magazynier rozkłada sztuki. */
  const ile = iloscLiczona(p);
  database.prepare(
    `INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
     VALUES (?,?,?,?,?,?)`).run(koszId, Number(p.tw_id),
      p.symbol ?? String(p.tw_id), p.nazwa, ile, pozycjaId);
  logEvent("kosz_zwrotow_dolozono", kto.name, null,
    { koszId, pozycjaId, twId: Number(p.tw_id), ilosc: ile }, kto.id, database);
  return koszId;
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
  const w = database.prepare(
    `SELECT k.id, k.kod FROM kosz_pozycja kp
       JOIN kosz k ON k.id = kp.kosz_id
      WHERE kp.zwrot_pozycja_id=? AND k.status<>'otwarty'
      ORDER BY k.id LIMIT 1`)
    .get(pozycjaId) as { id: number; kod: string } | undefined;
  return w ? { id: Number(w.id), kod: w.kod } : null;
}

/**
 * Zdejmuje pozycję z koszyka po cofnięciu albo zmianie oceny.
 *
 * TYLKO Z OTWARTEGO. Kosz zamknięty pojechał już na halę z wystawionym
 * dokumentem — wyjęcie z niego wiersza rozjechałoby papier z zawartością,
 * a magazynier szukałby towaru, którego nikt nie wyjął z kartonu.
 */
export function zdejmijZKosza(
  database: Db, pozycjaId: number, kto: { id: number; name: string },
): boolean {
  const w = database.prepare(
    `SELECT kp.id, kp.kosz_id FROM kosz_pozycja kp
       JOIN kosz k ON k.id = kp.kosz_id
      WHERE kp.zwrot_pozycja_id=? AND k.status='otwarty'`)
    .get(pozycjaId) as { id: number; kosz_id: number } | undefined;
  if (!w) return false;
  database.prepare("DELETE FROM kosz_pozycja WHERE id=?").run(w.id);
  logEvent("kosz_zwrotow_zdjeto", kto.name, null,
    { koszId: Number(w.kosz_id), pozycjaId }, kto.id, database);
  return true;
}

/** Co leży w otwartym koszyku tego rodzaju. `null`, gdy jeszcze żadnego nie ma. */
export function stanOtwartegoKosza(
  database: Db, kto: { name: string }, rodzaj: RodzajKosza = "zwroty",
): StanKosza | null {
  const k = database.prepare(
    `SELECT id, kod, utworzono_at FROM kosz WHERE status='otwarty' AND mm_dok_id IS NULL
       AND utworzono_przez=? AND rodzaj=? ORDER BY id LIMIT 1`).get(kto.name, rodzaj) as
    { id: number; kod: string; utworzono_at: string } | undefined;
  if (!k) return null;
  const pozycje = database.prepare(
    "SELECT symbol, nazwa, ilosc FROM kosz_pozycja WHERE kosz_id=? ORDER BY id")
    .all(k.id) as Array<{ symbol: string; nazwa: string; ilosc: number }>;
  return {
    rodzaj,
    id: Number(k.id), kod: k.kod, otwartyOd: k.utworzono_at,
    pozycji: pozycje.length,
    sztuk: pozycje.reduce((s, p) => s + Number(p.ilosc), 0),
    pozycje: pozycje.map((p) => ({ ...p, ilosc: Number(p.ilosc) })),
  };
}

/**
 * Wszystkie otwarte koszyki operatora — zwroty i odpad (0.211.0).
 *
 * Odpad wyłączony w konfiguracji nie ma prawa pokazać się na ekranie: koszyka
 * bez magazynu docelowego i tak nie da się zamknąć.
 */
export function otwarteKoszyki(database: Db, kto: { name: string }): StanKosza[] {
  const rodzaje: RodzajKosza[] = ["zwroty", "odpad"];
  return rodzaje
    .filter((r) => magazynDocelowy(r) > 0)
    .map((r) => stanOtwartegoKosza(database, kto, r))
    .filter((k): k is StanKosza => k !== null);
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
     odpad zdjęłoby stan, którego jeszcze nie ma. */
  const czekajace = database.prepare(
    `SELECT id, kod, rodzaj FROM kosz
      WHERE status='zamkniety' AND mm_dok_id IS NULL AND mm_queue_id IS NULL
        AND rodzaj IN ('zwroty','odpad') ORDER BY id`)
    .all() as Array<{ id: number; kod: string; rodzaj: RodzajKosza }>;

  let wypuszczone = 0;
  for (const k of czekajace) {
    if (brakujaceKorekty(database, Number(k.id)).length > 0) continue;
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
}

/**
 * Koszyki zamknięte, którym brakuje korekt — do pokazania w panelu.
 *
 * Bez tego czekanie byłoby ciszą: kosz stoi zamknięty, dokumentu nie ma,
 * a nikt nie wie, na czym stoi sprawa. Kubełek DO KOREKTY zbiera tę samą
 * pracę, więc to jedno zdanie przy koszyku, nie nowy ekran.
 */
export function koszykiCzekajaceNaKorekty(database: Db): KoszykCzekajacy[] {
  const kosze = database.prepare(
    `SELECT id, kod, zamknieto_at, rodzaj FROM kosz
      WHERE status='zamkniety' AND mm_dok_id IS NULL AND mm_queue_id IS NULL
        AND rodzaj IN ('zwroty','odpad') ORDER BY id`)
    .all() as Array<{ id: number; kod: string; zamknieto_at: string; rodzaj: RodzajKosza }>;
  return kosze.map((k) => ({
    id: Number(k.id), kod: k.kod, zamknietoAt: k.zamknieto_at, rodzaj: k.rodzaj,
    brakuje: brakujaceKorekty(database, Number(k.id)),
  })).filter((k) => k.brakuje.length > 0);
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
