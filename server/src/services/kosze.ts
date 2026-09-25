import { db, nowIso, transaction, type Db } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueMM, enqueueSetLocation } from "./queue.js";
import {
  adresyOczekiwane,
  adresyWszystkie,
  porownajAlejkowo,
  validateDeliveryLocation,
} from "./delivery.js";
import { stanyNiezerowe, type StanMagazynu } from "./magazyny.js";
import { adnotacjaStrefy } from "./zbiorki.js";
import type { ZlotaStrefa } from "../types.js";
import { aliasKodu } from "./ean-alias.js";
import { parseLocs } from "../locs.js";
import { logEvent } from "./events.js";
import { sladZKosza } from "./zwrot-slad.js";
import { koszDoEdycji } from "./kosze-zwrotow.js";
import { naGlob, naLike, sqlZwinSymbol, tokeny } from "../tekst.js";

/* ── Cyfrowe kosze zwrotowe (Etap 3) ─────────────────────────────────────────
   Kosz zastępuje papierową kartkę wożoną z towarem. Cykl życia:

     biuro: przypina zwroty skanem kodu kosza (wymóg: dokumenty już zlecone,
            bo kosz wiąże się z korektą i MM — nie z „może kiedyś")
     biuro: zamyka kosz → SNAPSHOT pozycji (co fizycznie leży w środku)
     hala:  kolektor pokazuje zamknięte kosze; skan towaru wskazuje pozycję,
            skan regału ją odkłada — jak przy dostawach
     hala:  ZAKOŃCZ → JEDNO MM ZWROTY→MAG cofa bufor (kosz z aplikacji)

   POWRÓT Z BUFORA JEST JEDNYM DOKUMENTEM (0.266.0, decyzja właściciela).
   Wersja z 0.59.0 zakładała MM jednopozycyjne, bo guard „adres przed
   sprzedawalnością" w obu workerach porządkuje zadania po kolumnie `tw_id`,
   a wielopozycyjne wypada spod niego. Niezmiennik zostaje w mocy, tylko
   pilnuje go teraz KOD, a nie guard: zadanie powstaje dopiero wtedy, gdy
   wszystkie adresy z tego kosza są już zapisane w Subiekcie
   (`zakolejkujPowrot`). Zależność jest więc rozstrzygnięta przed wstawieniem
   wiersza, a nie przy jego wyborze — i dlatego jeden dokument wystarczy.

   Kosz Z DOKUMENTU MM z Subiekta kolejkuje powrót TAK SAMO — od 0.277.0.
   Do 0.276.x punkt 4 obiegu (DEPLOY §6a) należał do biura i kosztował to samo,
   co kosze z panelu przed 0.266.0: towar leżał na półce i nie był sprzedawalny,
   dopóki ktoś nie pamiętał o drugim dokumencie. Różnica została jedna i jest
   nią KIERUNEK: powrót kosza z dokumentu jest odwrotnością TEGO dokumentu
   (`kosz.mm_mag_z`), a nie trasą z konfiguracji. Karton nie przesuwa niczego,
   bo towar nie opuścił magazynu. */

export class BladKosza extends Error {
  constructor(
    public kod: number,
    msg: string
  ) {
    super(msg);
  }
}

interface WierszKosza {
  id: number;
  kod: string;
  status: string;
  utworzono_at: string;
  utworzono_przez: string;
  zamknieto_at: string | null;
  zamknieto_przez: string | null;
  rozlozono_at: string | null;
  rozlozono_przez: string | null;
  /** Dokument MM, z którego kosz powstał; NULL = kosz złożony w aplikacji. */
  mm_dok_id: number | null;
  mm_numer: string | null;
  /** Magazyn, Z KTÓREGO dokument wysłał towar na regał — snapshot z importu. */
  mm_mag_z: number | null;
  /** Zadanie MM NA regał (MAG→ZWROTY) kosza z aplikacji; NULL = jeszcze nie zamówione. */
  mm_queue_id: number | null;
  /** Zadanie MM powrotnego (ZWROTY→MAG); NULL = jeszcze nie zamówione. */
  powrot_queue_id: number | null;
  /** 1 = powrót rozliczyło biuro poza aplikacją (kosz sprzed 0.266.0/0.277.0). */
  powrot_poza_aplikacja: number | null;
  /** `zwroty` albo `karton` — patrz `RODZAJ_KARTON`. */
  rodzaj: string;
  anulowano_at: string | null;
  anulowano_przez: string | null;
}

/**
 * Karton (0.122.0) — kosz, do którego pakujący odkładają towar źle zebrany.
 *
 * Ten sam byt co kosz zwrotowy i celowo ta sama tabela: rozkładanie kartonu
 * jest co do znaku tym samym, co rozkładanie kosza (skan towaru, skan półki,
 * pominięcie, cofanie, ZAKOŃCZ). Różnice są dwie i obie pilnuje ta stała:
 * zawartość zbiera HALA zamiast biura, a po rozłożeniu NIE POWSTAJE żaden
 * dokument — towar nie opuścił magazynu, więc nie ma czego przesuwać.
 */
export const RODZAJ_KARTON = "karton";

/**
 * Odpad (0.211.0) — koszyk oceniony „utylizacja", z własnym magazynem
 * docelowym (`services/kosze-zwrotow.ts`). Hala go NIE rozkłada; stała stoi
 * tu, bo to ten sam byt w tej samej tabeli, a lista kolektora musi umieć go
 * nazwać, żeby odsiać.
 */
export const RODZAJ_ODPAD = "odpad";

export interface PozycjaKosza {
  /**
   * Wiersze SKLEJONE z tym w jeden (0.359.0) — ten sam towar z innych zwrotów.
   *
   * Pusta lista znaczy „wiersz jest sam". Kolektor nie musi o tym wiedzieć:
   * widzi jedną pozycję z sumaryczną ilością i odkłada ją jednym ruchem.
   * Lista jest tu dla biura i dla testów, bo bez niej nie da się sprawdzić,
   * że za jedną linijką stoją trzy zwroty.
   */
  sklejone: number[];
  id: number;
  twId: number;
  symbol: string;
  nazwa: string;
  ilosc: number;
  status: string;
  /** Jednostka z kartoteki (`szt.`, `kpl.`) — kolektor przestaje zgadywać. */
  unit: string;
  /**
   * Gdzie ten towar jeszcze leży — magazyny z niezerowym stanem, malejąco.
   *
   * Przy zwrocie to pytanie pada częściej niż przy dostawie: towar wraca
   * pojedynczo i bywa wycofany ze sprzedaży, więc „na regale zwrotów zostały
   * jeszcze 3" rozstrzyga, czy kosz jest już rozniesiony w całości.
   */
  stany: StanMagazynu[];
  /** Podpowiedź przeslotowania — ta sama, którą niesie karta towaru. */
  zlotaStrefa?: ZlotaStrefa;
  /** Adres ŻYWY z kartoteki skorygowany o kolejkę — nie snapshot. */
  lokOczekiwana: string | null;
  /**
   * WSZYSTKIE adresy tego towaru, pickingowy pierwszy (0.118.0).
   *
   * Zwrot wraca pojedynczo i najtaniej dołożyć go tam, gdzie ten towar już
   * leży — a półka pickingowa bywa pełna albo daleko od miejsca, w którym
   * magazynier akurat stoi. Do tej wersji kolektor znał tylko ją i człowiek
   * musiał otwierać kartę towaru, żeby zobaczyć resztę.
   */
  lokalizacje: string[];
  lokFaktyczna: string | null;
  odlozonoPrzez: string | null;
  /** Kiedy odłożona (0.84.0). Sama osoba to pół odpowiedzi na to samo pytanie. */
  odlozonoAt: string | null;
  /** Sprawa pominięcia zamknięta przez biuro (0.77.0). */
  zalatwioneAt: string | null;
  zalatwionePrzez: string | null;
  zalatwioneNotatka: string | null;
  /** Dlaczego pozycja została pominięta; null poza statusem `skipped`. */
  powod: string | null;
  /** Odłożona na PÓŹNIEJ — zjeżdża na koniec listy, ale zostaje do zrobienia. */
  pozniejAt: string | null;
  /** Stan zadania MM cofającego bufor; null przed zakończeniem kosza. */
  mmStatus: string | null;
  mmNumer: string | null;
}

export interface SzczegolKosza {
  id: number;
  kod: string;
  status: string;
  utworzonoAt: string;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  rozlozonoAt: string | null;
  /** Kto rozłożył (0.84.0) — patrz komentarz przy `WierszListyKoszy`. */
  rozlozonoPrzez: string | null;
  pozycje: PozycjaKosza[];
  odlozonych: number;
  /**
   * Numer przesunięcia MM z Subiekta, gdy kosz powstał z dokumentu; NULL =
   * kosz złożony w aplikacji. Kolektor po tym pozna, że po ZAKOŃCZ nie ma
   * żadnego dokumentu do obiecywania — ten wystawia biuro.
   */
  mmNumer: string | null;
  /**
   * Powrót z bufora (0.266.0): stan zadania MM ZWROTY→MAG i numer dokumentu,
   * gdy już wyszedł. `null` znaczy „temu koszowi powrót się nie należy albo
   * jeszcze nie wyszedł" — biuro czyta to na karcie kosza, bo inaczej pytanie
   * „czy stan wrócił na halę" wymagałoby zajrzenia do Subiekta.
   */
  powrot: { status: string; numer: string | null } | null;
  /** `zwroty` albo `karton` — kolektor po tym wie, którą fazę pokazać. */
  rodzaj: string;
  /** Kto i kiedy anulował karton (0.123.0); NULL przy każdym innym koszu. */
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
  /**
   * Czy zawartość wolno jeszcze poprawić (0.334.0) — czyli czy dokumentu MM
   * jeszcze nie ma i żadne zadanie go nie wystawia. Ekran po tym wie, czy
   * pokazać PRZELICZ ZE ZWROTÓW; regułę trzyma `koszDoEdycji`.
   */
  doEdycji: boolean;
  /**
   * Zwroty wnoszące pozycje do tego kosza (0.333.0).
   *
   * Panel biura czytał to pole od dawna (`k.zwroty.length`), a serwer go NIGDY
   * nie oddawał — kosz złożony w aplikacji wywracał podgląd zdaniem „cannot
   * read properties of undefined". Nie wyszło to wcześniej, bo kosze z Subiekta
   * mają `mmNumer` i trafiają w drugą gałąź tego samego zdania.
   */
  zwroty: Array<{ id: number; numer: string; korektaNumer: string | null }>;
}

/**
 * Kłopot z dokumentem MM kosza (0.501.0).
 *
 * Zgłoszenie właściciela: „w koszykach zwrotów zaznacz koszyki, w których był
 * problem z MM — muszę sprawdzić stany z Subiektem". Wiersz kolejki mówi
 * wyłącznie, jak skończyło się OSTATNIE podejście. MM odrzucona i przepuszczona
 * PONÓW-em wygląda w nim jak każda inna udana, a właśnie po takiej stany
 * bywają rozjechane: Sfera potrafi odmówić w pół zapisu albo worker padnie po
 * `Zapisz()`. Pamięć o tym trzyma dziennik zdarzeń (`queue_retry`,
 * `queue_failed`, `queue_ponowione_recznie`), więc stamtąd czytamy.
 */
export interface ProblemMm {
  /** Ile nieudanych podejść zapisał dziennik (bez czekania na otwarty dokument). */
  prob: number;
  /** Treść ostatniej odmowy — pierwsze, czego szuka się w Subiekcie. */
  ostatniBlad: string | null;
  ostatnioAt: string;
  /** Zadanie MM kosza stoi TERAZ w błędzie — nic jeszcze nie weszło. */
  nierozwiazany: boolean;
}

/** Jak daleko wstecz szukamy kłopotów z MM. Starsze sprawdził już remanent. */
const PROBLEM_MM_DNI = 90;

/**
 * Kosze, których zadania MM miały kłopot (0.501.0) — mapa po id kosza.
 *
 * Zadanie należy do kosza przez trzy kolumny: MM koszyka wirtualnego
 * (`kosz.mm_queue_id`), MM powrotne z bufora (`kosz.powrot_queue_id`) i MM
 * pojedynczych pozycji na regał (`kosz_pozycja.mm_queue_id`). Każda z nich to
 * ruch stanu w Subiekcie, więc każda się liczy.
 *
 * CZEKANIE NA OTWARTY DOKUMENT (`blokada`) NIE JEST KŁOPOTEM. Worker ponawia
 * wtedy bez zużycia próby i nic w Subiekcie się nie zmienia — liczone
 * zalewałoby listę koszami, przy których nie ma czego sprawdzać.
 */
export function problemyMm(database: Db = db(), teraz = new Date()): Map<number, ProblemMm> {
  const kosz = new Map<number, number>();
  for (const k of database.prepare(
    "SELECT id, mm_queue_id, powrot_queue_id FROM kosz").all() as Array<Record<string, unknown>>) {
    if (k.mm_queue_id != null) kosz.set(Number(k.mm_queue_id), Number(k.id));
    if (k.powrot_queue_id != null) kosz.set(Number(k.powrot_queue_id), Number(k.id));
  }
  for (const p of database.prepare(
    "SELECT kosz_id, mm_queue_id FROM kosz_pozycja WHERE mm_queue_id IS NOT NULL")
    .all() as Array<Record<string, unknown>>) {
    kosz.set(Number(p.mm_queue_id), Number(p.kosz_id));
  }
  const wynik = new Map<number, ProblemMm>();
  if (!kosz.size) return wynik;

  const od = new Date(teraz.getTime() - PROBLEM_MM_DNI * 86_400_000).toISOString();
  const zdarzenia = database.prepare(
    `SELECT type, payload, created_at FROM events
      WHERE type IN ('queue_retry','queue_failed','queue_ponowione_recznie') AND created_at >= ?
      ORDER BY created_at ASC, id ASC`).all(od) as Array<{ type: string; payload: string | null; created_at: string }>;
  for (const e of zdarzenia) {
    let d: Record<string, unknown>;
    try { d = JSON.parse(e.payload ?? "{}") as Record<string, unknown>; } catch { continue; }
    const koszId = kosz.get(Number(d.queueId));
    if (koszId === undefined || d.blokada === true) continue;
    /* Ręczne PONÓW nie niesie typu zadania — należy do kosza przez numer. */
    if (e.type !== "queue_ponowione_recznie" && d.typ !== "mm") continue;
    const byl = wynik.get(koszId);
    wynik.set(koszId, {
      prob: (byl?.prob ?? 0) + (e.type === "queue_ponowione_recznie" ? 0 : 1),
      ostatniBlad: typeof d.blad === "string" ? d.blad : byl?.ostatniBlad ?? null,
      ostatnioAt: e.created_at,
      nierozwiazany: false,
    });
  }
  /* STAN TERAZ z wiersza kolejki, nie z dziennika: błąd sprzed zapisu
     zdarzeń (sierpień 2026) też jest kłopotem, a ostatnie zdarzenie nie mówi,
     czy ktoś potem kliknął PONÓW. */
  const idy = [...kosz.keys()];
  for (const q of database.prepare(
    `SELECT id, error_msg, processed_at FROM sfera_queue
      WHERE type='mm' AND status='error' AND id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(idy)) as Array<{ id: number; error_msg: string | null; processed_at: string | null }>) {
    const koszId = kosz.get(Number(q.id))!;
    const byl = wynik.get(koszId);
    wynik.set(koszId, {
      prob: Math.max(byl?.prob ?? 0, 1),
      ostatniBlad: byl?.ostatniBlad ?? q.error_msg,
      ostatnioAt: byl?.ostatnioAt ?? q.processed_at ?? teraz.toISOString(),
      nierozwiazany: true,
    });
  }
  return wynik;
}

/**
 * Treść, którą worker Sfery zostawia na zadaniu zastanym w trakcie zapisu.
 * Po niej `Zapisz()` mógł zdążyć — ponowienie bez sprawdzenia dubluje MM.
 */
const PRZERWANE_W_ZAPISIE = /przerwany w trakcie zapisu/i;

/**
 * Ponowienie wszystkich MM kosza, które stoją w błędzie (@wydanie).
 *
 * Zgłoszenie właściciela, przy kubełku „Problem z MM": „dodaj, abym mógł
 * wywołać ponownie". Kosz z dokumentu miewa MM na każdą pozycję osobno, więc
 * PONÓW z kolejki kazał szukać kilku zadań po numerach. Tu jeden ruch na kosz.
 * Zadanie wraca do kolejki dokładnie tak, jak po PONÓW w kolejce: próby od
 * zera, bez treści błędu, z wpisem `queue_ponowione_recznie` w dzienniku.
 *
 * PRZERWANE W ZAPISIE WYMAGAJĄ POTWIERDZENIA. Worker po restarcie oznacza tak
 * zadanie, przy którym Subiekt mógł zdążyć zapisać dokument, a nasza baza nie.
 * Ślepe ponowienie wystawiłoby drugie MM i drugi raz przesunęło stany — czyli
 * dokładnie to, czego biuro szuka w tym kubełku. Odmowa mówi więc, co
 * sprawdzić, a drugi ruch z `sprawdzono` bierze odpowiedzialność na człowieka.
 */
export function ponowMmKosza(
  database: Db, koszId: number, kto: string, sprawdzono = false,
): { ponowione: number } {
  const kosz = database.prepare("SELECT id, kod, mm_queue_id, powrot_queue_id FROM kosz WHERE id=?")
    .get(koszId) as { id: number; kod: string; mm_queue_id: number | null; powrot_queue_id: number | null } | undefined;
  if (!kosz) throw new BladKosza(404, "Nie ma takiego kosza");
  const idy = [kosz.mm_queue_id, kosz.powrot_queue_id,
    ...(database.prepare("SELECT mm_queue_id FROM kosz_pozycja WHERE kosz_id=? AND mm_queue_id IS NOT NULL")
      .all(koszId) as Array<{ mm_queue_id: number }>).map((p) => p.mm_queue_id)]
    .filter((x): x is number => x != null);
  const bledne = idy.length === 0 ? [] : database.prepare(
    `SELECT id, error_msg FROM sfera_queue
      WHERE type='mm' AND status='error' AND id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify([...new Set(idy)])) as Array<{ id: number; error_msg: string | null }>;
  if (!bledne.length) throw new BladKosza(409, "Żadne MM tego kosza nie stoi w błędzie — nie ma czego ponawiać.");
  const przerwane = bledne.filter((z) => PRZERWANE_W_ZAPISIE.test(z.error_msg ?? ""));
  if (przerwane.length && !sprawdzono) {
    throw new BladKosza(409,
      `${przerwane.length === 1 ? "Jedno MM przerwano" : `${przerwane.length} MM przerwano`} w trakcie zapisu. ` +
      "Sprawdź w Subiekcie, czy dokument nie powstał — ponowienie wystawiłoby go drugi raz.");
  }
  transaction(database, () => {
    const wznow = database.prepare(
      `UPDATE sfera_queue SET status='pending', attempts=0, error_msg=NULL,
         next_attempt_at=NULL, processed_at=NULL WHERE id=? AND status='error'`);
    for (const z of bledne) {
      wznow.run(z.id);
      /* Ten sam wpis co PONÓW z kolejki — `problemyMm` liczy po nim ślad. */
      logEvent("queue_ponowione_recznie", kto, null, { queueId: z.id }, undefined, database);
    }
    logEvent("kosz_mm_ponowione", kto, null,
      { koszId, kod: kosz.kod, zadan: bledne.length, przerwanych: przerwane.length }, undefined, database);
  })();
  return { ponowione: bledne.length };
}

export interface WierszListyKoszy {
  id: number;
  kod: string;
  status: string;
  pozycji: number;
  odlozonych: number;
  /**
   * Ile pozycji hala pominęła (0.77.0) — dla biura to jedyny sygnał, że kosz
   * wrócił NIEKOMPLETNY. Bez tej liczby „3/6 poz." wyglądałoby jak praca
   * w toku, a nie jak sprawa do wyjaśnienia.
   */
  pominietych: number;
  /** Numer przesunięcia MM; null = kosz złożony w aplikacji, nie z dokumentu. */
  mmNumer: string | null;
  utworzonoAt: string;
  zamknietoAt: string | null;
  zamknietoPrzez: string | null;
  /**
   * Kto i kiedy rozłożył kosz (0.84.0). Dane leżały w bazie od pierwszego
   * zakończenia, ale nie miały drogi na ekran — biuro pytało „kto to zrobił"
   * i szło po odpowiedź do dziennika. NULL do chwili zakończenia, i znowu
   * NULL po COFNIJ ZAKOŃCZENIE: kosz, który wrócił do rozkładania, nie jest
   * rozłożony przez nikogo.
   */
  rozlozonoAt: string | null;
  rozlozonoPrzez: string | null;
  /** `zwroty` albo `karton` — kolektor po tym wie, którą fazę pokazać. */
  rodzaj: string;
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
  /** Ile ZWROTÓW wniosło pozycje do kosza. Panel czytał to pole, serwer go nie oddawał. */
  zwrotow: number;
  /**
   * Ile zwrotów z tego kosza NIE MA jeszcze numeru korekty (0.333.0).
   *
   * To jest odpowiedź na pytanie „dlaczego nie ma MM": dokument wychodzi
   * dopiero, gdy korekty są komplet (`wypuscGotoweKoszyki`). Do tego wydania
   * ekran o tym MILCZAŁ, więc kosz zamknięty i bez numeru wyglądał na awarię
   * zamiast na czekanie.
   */
  brakujeKorekt: number;
  /**
   * Na czym stoi dokument MM tego kosza:
   * `gotowa` — numer jest; `zamowiona` — zadanie czeka w kolejce Sfery;
   * `blad` — kolejka odmówiła; `czeka_na_korekte` — brakuje numerów korekt;
   * `brak` — kosz otwarty albo z dokumentu Subiekta, więc MM mu się nie należy.
   */
  mmStan: "gotowa" | "zamowiona" | "blad" | "czeka_na_korekte" | "brak";
  /**
   * Koszyk wirtualny (0.350.0): złożony w panelu, bez dokumentu MM pod sobą.
   * Zbiera towar ze zwrotów, po zamknięciu rodzi MM i na tym się kończy —
   * halę rozkłada kosz z TAMTEGO dokumentu. Kolektor go nie dostaje.
   */
  wirtualny: boolean;
  /** Kłopot z MM tego kosza; `null` = wszystkie MM weszły za pierwszym razem (0.501.0). */
  problemMm: ProblemMm | null;
}

/** Kosz, do którego trafił towar jednego zwrotu — lekki wiersz do wiązania. */
export interface KoszZwrotu { id: number; kod: string; status: string }

/**
 * Kosze, do których trafił towar TEGO zwrotu (0.438.0).
 *
 * Druga połowa wiązania, którego pierwsza stoi w `szczegolKosza` (`zwroty`).
 * Kosz wiedział, czyje zwroty wiezie; zwrot nie wiedział, w którym koszu
 * jedzie jego towar — karta pisała „w koszyku zwrotów" bez nazwy i bez drogi.
 * Wiązanie jednostronne to wiązanie, którego nie ma (`CLAUDE.md`), a pytanie
 * „gdzie jest towar z tego zwrotu" pada przy zwrocie, nie przy koszu.
 *
 * TO SAMO ZŁĄCZENIE co tamto, tylko czytane od drugiej strony — dwa różne
 * zapytania o jedno wiązanie rozjechałyby się przy pierwszej zmianie schematu.
 */
export function koszeZwrotu(zwrotId: number, database: Db = db()): KoszZwrotu[] {
  return (database.prepare(
    `SELECT DISTINCT k.id AS id, k.kod AS kod, k.status AS status
       FROM kosz_pozycja p
       JOIN zwrot_klienta_pozycja zp ON zp.id = p.zwrot_pozycja_id
       JOIN kosz k ON k.id = p.kosz_id
      WHERE zp.zwrot_id = ? ORDER BY k.id`).all(zwrotId) as Array<Record<string, unknown>>)
    .map((k) => ({ id: Number(k.id), kod: String(k.kod), status: String(k.status) }));
}

/** Kod z etykiety kosza — po trim/upper, żeby skan i wpis ręczny się spotkały. */
function normalizujKod(raw: string): string {
  const kod = raw.trim().toUpperCase();
  if (!kod) throw new BladKosza(400, "Zeskanuj albo wpisz kod kosza");
  return kod;
}

function wierszKosza(id: number): WierszKosza {
  const k = db().prepare("SELECT * FROM kosz WHERE id = ?").get(id) as WierszKosza | undefined;
  if (!k) throw new BladKosza(404, `Kosz ${id} nie istnieje`);
  return k;
}

/**
 * Aktywny (nierozłożony) kosz o tym kodzie — kod wraca do obiegu po rozłożeniu.
 *
 * KARTONÓW ta funkcja nie widzi i to jest jej rola, nie przeoczenie. Szukają
 * po niej dwie rzeczy: biuro przypinające zwrot i kolektor skanujący etykietę
 * z kosza. Karton nie ma ani zwrotów, ani fizycznej etykiety — trafienie
 * w niego kodem znaczyłoby pomyłkę udającą sukces.
 */
export function koszPoKodzie(raw: string): WierszKosza | undefined {
  return db()
    .prepare("SELECT * FROM kosz WHERE kod = ? AND status <> 'rozlozony' AND rodzaj <> ?")
    .get(normalizujKod(raw), RODZAJ_KARTON) as WierszKosza | undefined;
}

/* ── Koszyk wirtualny (0.350.0) ─────────────────────────────────────────────
   Decyzja właściciela z 15 września 2026: „wirtualny koszyk powinien być
   tworzony w celu agregowania towarów ze zwrotów i po jego zamknięciu
   stworzona MM, a ten wirtualny koszyk zamknięty".

   Dane z produkcji pokazały, dlaczego to wróciło. MM wystawione dla Z-7 wraca
   importem jako przyjęcie 1352 i hala rozkłada KOSZ Z TEGO DOKUMENTU — a Z-7
   wisiał obok na kolektorze jako drugi kosz do rozłożenia, z zerem odłożonych
   pozycji. Jeden fizyczny towar, dwie jednostki pracy.

   Wirtualny to kosz z przedrostkiem `Z-` (nadaje go `kosze-zwrotow.ts`) i bez
   `mm_dok_id`. Sam przedrostek nie wystarcza: kod kosza z dokumentu to liczba
   z numeru MM, więc się z nim nie zderzy — ale warunek na dokumencie mówi
   wprost, o co chodzi.                                                        */

export const KOD_KOSZA_WIRTUALNEGO = /^Z-\d+$/i;

export function jestKoszemWirtualnym(k: { kod: string; mm_dok_id?: number | null }): boolean {
  return (k.mm_dok_id ?? null) === null && KOD_KOSZA_WIRTUALNEGO.test(String(k.kod ?? "").trim());
}

/**
 * Zdanie dla hali, która zeskanowała etykietę koszyka wirtualnego.
 *
 * Mówi, CO rozłożyć zamiast niego: numer MM, który przyjdzie importem. Gołe
 * „nie ma takiego kosza" kazałoby magazynierowi szukać usterki, a to jest
 * zwykła pomyłka etykiety.
 */
export function odmowaKoszaWirtualnego(raw: string): string {
  const kod = String(raw ?? "").trim().toUpperCase();
  const k = db().prepare(
    `SELECT q.status AS mm_status, q.sgt_doc_number AS mm_numer
       FROM kosz k LEFT JOIN sfera_queue q ON q.id = k.mm_queue_id
      WHERE k.kod = ? AND k.mm_dok_id IS NULL ORDER BY k.id DESC LIMIT 1`)
    .get(kod) as { mm_status: string | null; mm_numer: string | null } | undefined;
  const poczatek = `${kod} to koszyk wirtualny — nie rozkłada się go na hali.`;
  if (k?.mm_status === "done" && k.mm_numer) {
    const liczba = /(\d+)\s*\//.exec(k.mm_numer)?.[1] ?? k.mm_numer;
    return `${poczatek} Rozłóż kosz z dokumentu ${k.mm_numer}: wpisz ${liczba}.`;
  }
  return `${poczatek} Jego MM jeszcze nie weszło do Subiekta — rozłożysz kosz z tego dokumentu, gdy się pojawi.`;
}

/* ── Czym kosz NIE jest od 0.140.0 ───────────────────────────────────────────
   Do tej wersji kosz napełniało się dwiema drogami: dokumentem MM ZWROTY
   z Subiekta (`otworzPrzyjecie` w `przyjecia.ts`) albo przypięciem zwrotu
   z rejestru w aplikacji. Rejestr zwrotu zniknął razem z całą obsługą klienta,
   więc zostaje pierwsza droga — i tylko ona.

   Zniknęły stąd `przypnijZwrot`, `odepnijZwrot` i `zamknijKosz`. Ta trzecia
   robiła snapshot pozycji z korekt zwrotu i żądała, żeby dokumenty naprawdę
   weszły do Subiekta; kosz z dokumentu MM powstaje od razu ZAMKNIĘTY
   (`otworzPrzyjecie`), więc nie ma czego zamykać. Decyzje o towarze podejmuje
   się teraz w Subiekcie, a aplikacja rozkłada to, co przyjechało.          */

export function listaKoszy(): WierszListyKoszy[] {
  const problemy = problemyMm();
  /* Rozłożone tylko świeże: lista służy pracy, historię trzyma audyt.
     WYJĄTEK: kosz z kłopotem MM (0.501.0) stoi na liście, dopóki kłopot
     mieści się w oknie `PROBLEM_MM_DNI` — biuro sprawdza stany także po
     koszach rozłożonych dawno. */
  const wiersze = db()
    .prepare(
      `SELECT k.id, k.kod, k.status, k.utworzono_at,
              k.zamknieto_at, k.zamknieto_przez, k.rozlozono_at, k.rozlozono_przez,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id) AS pozycji,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id AND p.status='done') AS odlozonych,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id AND p.status='skipped') AS pominietych,
              /* Zwroty wnoszące pozycje — liczone PO ZWROCIE, nie po pozycji:
                 jeden zwrot bywa kilkoma kartotekami, a od 0.328.0 komplet
                 wchodzi do kosza kilkoma wierszami naraz. */
              (SELECT COUNT(DISTINCT zp.zwrot_id) FROM kosz_pozycja p
                 JOIN zwrot_klienta_pozycja zp ON zp.id = p.zwrot_pozycja_id
                WHERE p.kosz_id = k.id) AS zwrotow,
              /* Zwroty BEZ numeru korekty — to one trzymają dokument MM.
                 Ten sam warunek co w brakujaceKorekty(); gdyby się rozjechał,
                 ekran tłumaczyłby czekanie inaczej, niż wygląda naprawdę. */
              (SELECT COUNT(DISTINCT zp.zwrot_id) FROM kosz_pozycja p
                 JOIN zwrot_klienta_pozycja zp ON zp.id = p.zwrot_pozycja_id
                 JOIN zwrot_klienta z ON z.id = zp.zwrot_id
                WHERE p.kosz_id = k.id AND z.korekta_numer IS NULL) AS brakuje_korekt,
              (SELECT q.status FROM sfera_queue q WHERE q.id = k.mm_queue_id) AS mm_status,
              k.mm_numer, k.mm_queue_id, k.rodzaj, k.anulowano_at, k.anulowano_przez, k.mm_dok_id
       FROM kosz k
       WHERE k.status NOT IN ('rozlozony', 'anulowany')
          -- granica ISO, nie datetime(): powód przy GRANICA_OKNA w raporty.ts
          OR COALESCE(k.rozlozono_at, k.anulowano_at) >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')
          OR k.id IN (SELECT value FROM json_each(?))
       ORDER BY CASE k.status WHEN 'otwarty' THEN 0 WHEN 'zamkniety' THEN 1 ELSE 2 END, k.id DESC`
    )
    .all(JSON.stringify([...problemy.keys()])) as Array<Record<string, unknown>>;
  return wiersze.map((w) => ({
    id: w.id as number,
    kod: w.kod as string,
    status: w.status as string,
    pozycji: w.pozycji as number,
    odlozonych: w.odlozonych as number,
    pominietych: w.pominietych as number,
    mmNumer: (w.mm_numer as string) ?? null,
    utworzonoAt: w.utworzono_at as string,
    zamknietoAt: (w.zamknieto_at as string) ?? null,
    zamknietoPrzez: (w.zamknieto_przez as string) ?? null,
    rozlozonoAt: (w.rozlozono_at as string) ?? null,
    rozlozonoPrzez: (w.rozlozono_przez as string) ?? null,
    rodzaj: (w.rodzaj as string) ?? "zwroty",
    anulowanoAt: (w.anulowano_at as string) ?? null,
    anulowanoPrzez: (w.anulowano_przez as string) ?? null,
    zwrotow: Number(w.zwrotow ?? 0),
    brakujeKorekt: Number(w.brakuje_korekt ?? 0),
    mmStan: stanMm(w),
    wirtualny: jestKoszemWirtualnym({ kod: String(w.kod), mm_dok_id: (w.mm_dok_id as number) ?? null }),
    problemMm: problemy.get(Number(w.id)) ?? null,
  }));
}

/**
 * Na czym stoi dokument MM kosza (0.333.0).
 *
 * Kolejność pytań jest treścią: numer bije wszystko, bo dokument już jest;
 * błąd kolejki bije czekanie na korektę, bo to inna praca i innego człowieka.
 * Kosz otwarty ani kosz Z DOKUMENTU nie czekają na nic — tam MM albo dopiero
 * będzie zamawiana, albo nigdy jej nie było.
 */
function stanMm(w: Record<string, unknown>): WierszListyKoszy["mmStan"] {
  if (w.mm_numer) return "gotowa";
  /* Kosz ROZŁOŻONY też bywa w czekaniu: hala rozkłada go przed korektą, a MM
     na regał wychodzi dopiero po niej (`wypuscGotoweKoszyki`). Poza tym jednym
     przypadkiem rozłożony kosz o dokument już nie pyta. */
  if (w.status === "rozlozony") {
    return !w.mm_queue_id && Number(w.brakuje_korekt ?? 0) > 0 ? "czeka_na_korekte" : "brak";
  }
  if (w.status !== "zamkniety") return "brak";
  if (w.mm_queue_id) return w.mm_status === "error" ? "blad" : "zamowiona";
  return Number(w.brakuje_korekt ?? 0) > 0 ? "czeka_na_korekte" : "brak";
}

/** Kosze do rozłożenia — to, co widzi kolektor na zakładce ZWROTY. */
/**
 * Co hala ma dziś do rozłożenia.
 *
 * ODPAD NIE JEST PRACĄ HALI (0.266.0). Koszyk oceniony „utylizacja" jedzie MM
 * na magazyn odpadu i ma ze stanu ZEJŚĆ — odłożony na regał wróciłby do
 * sprzedaży, a przy okazji wpisałby złomowi adres pickingowy do kartoteki.
 * Do 0.264.0 lista odsiewała wyłącznie kartony, więc kosz odpadu wyglądał na
 * kolektorze jak każdy inny: usterka z 0.211.0, która dołożyła rodzaj koszy
 * i nie ruszyła tej jednej linijki.
 *
 * Co dalej dzieje się z odpadem, zostaje decyzją procesową biura: dokumentu
 * zejścia ze stanu (RW) ta aplikacja nie wystawia.
 */
export function koszeDlaKolektora(): WierszListyKoszy[] {
  /* KOSZYK WIRTUALNY TEŻ NIE (0.350.0). Po zamknięciu rodzi MM, a halę
     rozkłada kosz z tego dokumentu — obecny tu dawał dwie jednostki pracy na
     jeden towar (Z-7 obok 1352 na produkcji). Biuro widzi go dalej w
     `listaKoszy`, bo tam śledzi jego dokument. */
  return listaKoszy().filter(
    (k) => k.status === "zamkniety" && k.rodzaj !== RODZAJ_KARTON && k.rodzaj !== RODZAJ_ODPAD
      && !k.wirtualny
  );
}

/**
 * Kartony na zakładce KARTON — otwarte RAZEM z zatwierdzonymi.
 *
 * Zakładka pokazuje obie fazy jednej roboty: pudło, do którego się jeszcze
 * dokłada, i pudło czekające na półki. Rozdzielenie ich na dwie listy kazałoby
 * szukać własnego kartonu w dwóch miejscach zależnie od tego, czy ktoś zdążył
 * go zatwierdzić.
 */
export function kartonyDlaKolektora(): WierszListyKoszy[] {
  return listaKoszy().filter(
    (k) => k.rodzaj === RODZAJ_KARTON && k.status !== "rozlozony" && k.status !== "anulowany"
  );
}

export function szczegolKosza(koszId: number): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  const wiersze = db()
    .prepare(
      `SELECT p.*, q.status AS mm_status, q.sgt_doc_number AS mm_numer
       FROM kosz_pozycja p LEFT JOIN sfera_queue q ON q.id = p.mm_queue_id
       WHERE p.kosz_id = ?`
    )
    .all(koszId) as Array<Record<string, unknown>>;

  /* Komplet jednym zapytaniem na każdą z trzech rzeczy — kosz odświeża się
     po KAŻDYM odłożeniu, więc pytanie per wiersz zjadałoby budżet trasy. */
  const twIds = wiersze.map((w) => w.tw_id as number);
  const adresy = adresyOczekiwane(twIds);
  const wszystkieAdresy = adresyWszystkie(twIds);
  const jednostki = subiekt.jednostkiDlaTowarow(twIds);
  const stany = stanyNiezerowe(twIds);
  const rozbite: PozycjaKosza[] = wiersze.map((w) => ({
    sklejone: [],
    id: w.id as number,
    twId: w.tw_id as number,
    symbol: w.symbol as string,
    nazwa: w.nazwa as string,
    ilosc: w.ilosc as number,
    status: w.status as string,
    unit: jednostki.get(w.tw_id as number) ?? "",
    stany: stany.get(w.tw_id as number) ?? [],
    /* W pętli po pozycjach jak przy dostawach: `adnotacjaStrefy` czyta mapę
       w pamięci, więc jest O(1). Gdyby zaczęła dotykać bazy, to miejsce
       zamieni się w N+1 — wtedy trzeba wariantu zbiorczego. */
    ...(() => {
      const a = adnotacjaStrefy(w.tw_id as number);
      return a ? { zlotaStrefa: a } : {};
    })(),
    /* Pozycja tknięta pokazuje SWÓJ zapis — to, co człowiek zrobił; reszta
       adres żywy. Ten sam podział co `adresLinii` przy dostawach. */
    lokOczekiwana: (w.lok_faktyczna as string) ?? adresy.get(w.tw_id as number) ?? null,
    /* Komplet adresów jedzie NIEZALEŻNIE od tego, czy pozycja jest tknięta:
       to nie jest zapis pracy, tylko odpowiedź na pytanie „gdzie ten towar
       jeszcze leży" — a ono nie przestaje mieć sensu po odłożeniu. */
    lokalizacje: wszystkieAdresy.get(w.tw_id as number) ?? [],
    lokFaktyczna: (w.lok_faktyczna as string) ?? null,
    odlozonoPrzez: (w.odlozono_przez as string) ?? null,
    odlozonoAt: (w.odlozono_at as string) ?? null,
    powod: (w.powod as string) ?? null,
    pozniejAt: (w.pozniej_at as string) ?? null,
    zalatwioneAt: (w.zalatwione_at as string) ?? null,
    zalatwionePrzez: (w.zalatwione_przez as string) ?? null,
    zalatwioneNotatka: (w.zalatwione_notatka as string) ?? null,
    mmStatus: (w.mm_status as string) ?? null,
    mmNumer: (w.mm_numer as string) ?? null,
  }));
  /* ── Ten sam towar z dwóch zwrotów to JEDNA linijka (0.359.0) ─────────────
     Zgłoszenie z hali brzmiało tak: „ten sam symbol trzy razy pod rząd, trzy
     razy ta sama półka". Koszyk trzyma wiersz na każdą pozycję zwrotu, bo tym
     wierszem wraca ślad na oś zwrotu — ale magazynier niesie te trzy sztuki
     w jednej ręce i idzie z nimi RAZ. Na dokument MM i tak wchodzą zsumowane
     (`kosze-zwrotow.ts`), więc rozbicie żyło wyłącznie na ekranie.

     Sklejamy WYŁĄCZNIE wiersze nieodróżnialne: ten sam towar, ten sam stan,
     ten sam adres, ten sam powód pominięcia, ta sama odpowiedź na „później"
     i TA SAMA ODPOWIEDŹ BIURA na pominięcie (0.358.0). Ostatni człon nie jest
     ozdobny: kolektor pokazuje przy pominięciu zdanie biura, a sklejenie dwóch
     wierszy z różnymi odpowiedziami schowałoby jedną z nich — czyli wróciłoby
     do stanu, który tamto wydanie właśnie naprawiło.

     Dzięki temu licznik ODŁOŻONE x/y nie skacze w trakcie pracy — gdyby
     sklejać tylko czekające, mianownik rósłby z każdym odłożeniem.

     Sklejona linijka rusza się CAŁA: odłożenie, pominięcie, „później"
     i cofnięcie biorą rodzeństwo z `rodzenstwo()`. Inaczej ekran pokazywałby
     trzy sztuki, a zapisywałby jedną.                                        */
  const klucz = (w: Record<string, unknown>): string => [
    w.tw_id, w.status, (w.lok_faktyczna as string) ?? "",
    w.pozniej_at ? "P" : "", (w.powod as string) ?? "",
    (w.zalatwione_at as string) ?? "", (w.zalatwione_notatka as string) ?? "",
    (w.zalatwione_przez as string) ?? "",
  ].join("|");
  const grupy = new Map<string, PozycjaKosza>();
  for (let i = 0; i < rozbite.length; i++) {
    const k = klucz(wiersze[i]);
    const lider = grupy.get(k);
    if (!lider) { grupy.set(k, rozbite[i]); continue; }
    lider.ilosc += rozbite[i].ilosc;
    lider.sklejone.push(rozbite[i].id);
  }
  const pozycje: PozycjaKosza[] = [...grupy.values()];

  /* ── Kolejność listy kosza ────────────────────────────────────────────────
     Trzy grupy, od tego, co jeszcze do zrobienia, po to, co już zrobione:

       1. pozycje CZEKAJĄCE w kolejności alejkowej — to trasa przez halę,
       2. odłożone NA PÓŹNIEJ, w kolejności klikania „później",
       3. ZROBIONE (odłożone i pominięte) w kolejności wykonania.

     Grupa trzecia zjeżdża na dół od 0.81.0 i to jest ta sama decyzja, którą
     rozkładanie dostaw podjęło w 0.35.0: zwinięty pasek dalej zajmuje ekran,
     więc przy koszu na dwadzieścia pozycji do roboty trzeba się PRZEWIJAĆ
     przez robotę już wykonaną. Lista przestaje wtedy odpowiadać na jedyne
     pytanie, które magazynier jej zadaje — „co jeszcze zostało".

     Znacznik czasu zamiast flagi (jak przy „później"), więc ostatnio odłożona
     stoi na samym końcu — tam, gdzie szuka się jej, żeby cofnąć zły skan.

     Sortujemy TU, a nie na kolektorze, bo tę samą listę czyta panel biura
     (`/api/biuro/kosze/:id`). Dwa niezależne sortowania rozjechałyby się przy
     pierwszej zmianie jednego z nich — powód i cena tej zasady stoją przy
     `porownajAlejkowo` w services/delivery.ts.                              */
  const zrobionaAt = new Map(
    wiersze.map((w) => [
      w.id as number,
      ((w.odlozono_at as string) ?? (w.pominieto_at as string) ?? "") as string,
    ])
  );
  const grupa = (p: PozycjaKosza): number => (p.status === "todo" ? (p.pozniejAt ? 1 : 0) : 2);
  pozycje.sort((a, b) => {
    if (grupa(a) !== grupa(b)) return grupa(a) - grupa(b);
    if (grupa(a) === 2) {
      const kiedy = (zrobionaAt.get(a.id) ?? "").localeCompare(zrobionaAt.get(b.id) ?? "");
      if (kiedy !== 0) return kiedy;
    } else if (a.pozniejAt && b.pozniejAt) {
      const kiedy = a.pozniejAt.localeCompare(b.pozniejAt);
      if (kiedy !== 0) return kiedy;
    }
    return porownajAlejkowo(
      { locExpected: a.lokOczekiwana, sym: a.symbol },
      { locExpected: b.lokOczekiwana, sym: b.symbol }
    );
  });
  const powrot = kosz.powrot_queue_id
    ? (db()
        .prepare("SELECT status, sgt_doc_number AS numer FROM sfera_queue WHERE id=?")
        .get(kosz.powrot_queue_id) as { status: string; numer: string | null } | undefined)
    : undefined;
  /* Zwroty wnoszące pozycje — z numerem korekty, bo to on trzyma dokument MM.
     Panel czytał `k.zwroty` od dawna; serwer nie oddawał go nigdy. */
  const zwroty = (db().prepare(
    `SELECT DISTINCT z.id AS id,
            COALESCE(z.reference_number, z.external_id) AS numer,
            z.korekta_numer AS korekta
       FROM kosz_pozycja p
       JOIN zwrot_klienta_pozycja zp ON zp.id = p.zwrot_pozycja_id
       JOIN zwrot_klienta z ON z.id = zp.zwrot_id
      WHERE p.kosz_id = ? ORDER BY z.id`).all(koszId) as
    Array<{ id: number; numer: string; korekta: string | null }>)
    .map((z) => ({ id: Number(z.id), numer: String(z.numer), korektaNumer: z.korekta ?? null }));

  return {
    mmNumer: kosz.mm_numer ?? null,
    doEdycji: kosz.status !== "otwarty" && (kosz.rodzaj ?? "zwroty") !== RODZAJ_KARTON
      && koszDoEdycji(db(), koszId),
    zwroty,
    powrot: powrot ? { status: powrot.status, numer: powrot.numer ?? null } : null,
    rodzaj: kosz.rodzaj ?? "zwroty",
    anulowanoAt: kosz.anulowano_at ?? null,
    anulowanoPrzez: kosz.anulowano_przez ?? null,
    id: kosz.id,
    kod: kosz.kod,
    status: kosz.status,
    utworzonoAt: kosz.utworzono_at,
    zamknietoAt: kosz.zamknieto_at,
    zamknietoPrzez: kosz.zamknieto_przez,
    rozlozonoAt: kosz.rozlozono_at,
    rozlozonoPrzez: kosz.rozlozono_przez,
    pozycje,
    odlozonych: pozycje.filter((p) => p.status === "done").length,
  };
}

/**
 * Skan towaru w otwartym koszu na kolektorze → która pozycja.
 *
 * Ta sama drabinka co globalny skan (EAN → alias → symbol), ale wynik szuka
 * się wyłącznie WŚRÓD POZYCJI KOSZA: skan cudzego towaru ma powiedzieć
 * „nie z tego kosza", a nie otworzyć przypadkową kartę.
 */
/**
 * Kod z ręki albo ze skanera → towar. EAN, alias EAN, symbol — w tej kolejności.
 *
 * Jedno miejsce dla kosza i dla kartonu (0.122.0), bo to JEDNA gramatyka:
 * magazynier robi ten sam ruch przy obu pudłach i rozjazd w rozpoznawaniu
 * znaczyłby, że ten sam kod raz działa, a raz nie.
 */
export function towarZKodu(code: string) {
  const raw = code.trim();
  const p = subiekt.getProductByEan(raw) ?? (aliasKodu(raw) ? subiekt.getProductById(aliasKodu(raw)!.twId) : undefined);
  return p ?? subiekt.getProductBySymbol(raw.toUpperCase()) ?? subiekt.getProductBySymbol(raw);
}

export function skanTowaruKosza(
  koszId: number,
  code: string
): { pozycjaId: number } | { poza: true; symbol: string } | { nieznany: true } {
  const tw = towarZKodu(code);
  if (!tw) return { nieznany: true };
  const poz = db()
    .prepare(
      "SELECT id FROM kosz_pozycja WHERE kosz_id = ? AND tw_id = ? AND status='todo' ORDER BY id LIMIT 1"
    )
    .get(koszId, tw.tw_id) as { id: number } | undefined;
  if (!poz) return { poza: true, symbol: tw.symbol };
  return { pozycjaId: poz.id };
}

/**
 * Odłożenie pozycji kosza pod zeskanowany adres.
 *
 * Zapis adresu do kartoteki idzie TYLKO przy zmianie i PRZED zadaniem MM
 * (kolejność wstawienia + guard po tw_id) — towar nie ma prawa stać się
 * sprzedawalny pod adresem, którego jeszcze nie ma w Subiekcie.
 */
/**
 * Czym potwierdzono adres odłożenia (0.189.0).
 *
 *   polka → zeskanowano etykietę regału; adres jest ZWERYFIKOWANY fizycznie,
 *   towar → drugi skan tego samego towaru; adres wzięty z ekranu, bez półki,
 *   wpis  → adres wpisany albo zatwierdzony przyciskiem ODŁÓŻ TUTAJ.
 */
export type Potwierdzenie = "polka" | "towar" | "wpis";

export const POTWIERDZENIA: readonly Potwierdzenie[] = ["polka", "towar", "wpis"] as const;

/**
 * Wiersze kosza NIEODRÓŻNIALNE na ekranie od tego jednego (0.359.0).
 *
 * Ten sam klucz co przy sklejaniu w `szczegolKosza` — i to jest cała treść tej
 * funkcji. Gdyby oba miejsca liczyły grupę własnym warunkiem, rozjechałyby się
 * przy pierwszej poprawce jednego z nich, a objawem byłaby linijka „3 szt."
 * zapisująca jedną sztukę. Wynik zawiera wiersz pytany i jest po `id`, więc
 * pierwszy element jest zawsze liderem widocznym na ekranie.
 */
function rodzenstwo(p: Record<string, unknown>): Array<{ id: number; ilosc: number }> {
  return db()
    .prepare(
      `SELECT id, ilosc FROM kosz_pozycja
        WHERE kosz_id = ? AND tw_id = ? AND status = ?
          AND COALESCE(lok_faktyczna, '') = ?
          AND (CASE WHEN pozniej_at IS NULL THEN 0 ELSE 1 END) = ?
          AND COALESCE(powod, '') = ?
          AND COALESCE(zalatwione_at, '') = ?
          AND COALESCE(zalatwione_notatka, '') = ?
          AND COALESCE(zalatwione_przez, '') = ?
        ORDER BY id`
    )
    .all(
      p.kosz_id as number, p.tw_id as number, p.status as string,
      (p.lok_faktyczna as string) ?? "", p.pozniej_at ? 1 : 0, (p.powod as string) ?? "",
      (p.zalatwione_at as string) ?? "", (p.zalatwione_notatka as string) ?? "",
      (p.zalatwione_przez as string) ?? "",
    ) as Array<{ id: number; ilosc: number }>;
}

export function odlozPozycje(
  pozycjaId: number,
  lokalizacja: string,
  autor: string,
  potwierdzenie: Potwierdzenie = "polka"
): { ok: true; mismatch: boolean } {
  const p = db().prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") {
    throw new BladKosza(400, "Kosz nie jest w rozkładaniu — otwarty dokłada, rozłożony skończył");
  }
  /* Pozycja odłożona daje się POPRAWIĆ — to nie jest to samo co cofnięcie.
     Zły regał zeskanowany pomyłkowo prostuje się skanem właściwego: nowy adres
     nadpisuje stary i w koszu, i w kartotece. Odmowa zostawiałaby magazyniera
     z towarem na złej półce i bez wyjścia, bo COFNIJ po zapisie do Subiekta
     jest zamknięte. Dopóki kosz jest w rozkładaniu, poprawianie własnej
     pomyłki nie wymaga niczyjej zgody — tak samo jak korekta ilości przy
     dostawie. */
  const poprawka = p.status === "done";

  const code = lokalizacja.trim().toUpperCase();
  const locErr = validateDeliveryLocation(code);
  if (locErr) throw new BladKosza(400, locErr);

  const twId = p.tw_id as number;
  const oczekiwany = adresyOczekiwane([twId]).get(twId) ?? null;
  const mismatch = !!oczekiwany && oczekiwany !== code;

  const t = subiekt.getProductById(twId);
  const current = parseLocs(t?.lokalizacja);
  let locQueueId: number | null = null;
  if (current[0] !== code) {
    // towar wraca na INNĄ półkę niż zna kartoteka → nowy adres pickingowy
    const newLocs = Array.from(new Set([code, ...current.slice(1)]));
    locQueueId = enqueueSetLocation(
      twId,
      newLocs.join(" ").slice(0, config.locFieldLimit),
      {
        createdBy: autor,
        twId,
        /* Symbol z kosza, gdy kartoteki nie znamy: towar zablokowany
           w Subiekcie nie wchodzi do importu, a biuro czytające kolejkę ma
           zobaczyć symbol z dokumentu, nie goły identyfikator. */
        label: "Lokalizacja · " + (t?.symbol || (p.symbol as string) || twId),
        detail: `${code} (kosz ${kosz.kod})`,
      },
      { locsPrzed: t?.lokalizacja ?? "", zrodlo: "kosz" }
    );
  }

  /* CAŁA SKLEJONA LINIJKA (0.359.0). Zadanie adresu powstało WYŻEJ i jest
     jedno na cały ruch — po drugie i trzecie kartoteka i tak miałaby już nowy
     adres, więc byłyby to zadania bez treści. Wiersze dostają jeden `loc_queue_id`,
     dzięki czemu cofnięcie anuluje ten sam zapis, który odłożenie zamówiło. */
  const grupa = rodzenstwo(p);
  const teraz = nowIso();
  /* `powod=NULL` cofa pominięcie: magazynier, który jednak znalazł towar,
     ma go po prostu odłożyć, a nie szukać osobnego „cofnij". */
  const zapis = db().prepare(
    `UPDATE kosz_pozycja SET status='done', powod=NULL, pominieto_at=NULL, pozniej_at=NULL,
            zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL,
            lok_faktyczna=?, odlozono_at=?, odlozono_przez=?, loc_queue_id=? WHERE id=?`);
  for (const w of grupa) {
    zapis.run(code, teraz, autor, locQueueId, w.id);
    /* ŚLAD NA OSI ZWROTU (0.269.0) idzie PER WIERSZ, bo każdy z nich należy do
       innego zwrotu. Biuro patrzące na zwrot widzi, że towar wrócił na półkę
       i na którą — bez tego pytanie „gdzie to leży" kończyło się w Subiekcie
       albo telefonem na halę. Kosz bez zwrotu (z dokumentu MM, karton) nie ma
       gdzie tego dopisać i to nie jest awaria. */
    sladZKosza(db(), w.id, "rozlozenie",
      `Towar wrócił na półkę ${code} (kosz ${kosz.kod})`,
      { koszId: kosz.id, kod: kosz.kod, lokalizacja: code, twId, poprawka },
      autor, teraz);
  }

  /* `manual_entry` WYŁĄCZNIE przy wpisie z klawiatury. To zdarzenie zasila
     dwa raporty (`services/raporty.ts`): udział wejść ręcznych per kod, czyli
     etykiety do przedruku, oraz kolumnę „ręczne" w raporcie wydajności
     pracownika. Drugi skan towaru (0.189.0) nie jest ani wpisem, ani nieudanym
     skanem etykiety — a jest drogą wygodną, więc wpadając tam zgłaszałby
     półki, których nikt nie dotykał, i robił z magazyniera maszynistkę. */
  if (potwierdzenie === "wpis") {
    logEvent("manual_entry", autor, twId, { code, kind: "LOC", zrodlo: "kosz" });
  }
  /* JEDNO ZDARZENIE NA RUCH CZŁOWIEKA, nie na wiersz bazy. Trzy wpisy w tej
     samej sekundzie zawyżyłyby tempo w raporcie wydajności — a tam kierunek
     błędu jest wybrany świadomie: zaniżamy, bo zawyżone tempo trafia do
     rozmowy o pracy (`services/raporty.ts`). Wiersze stoją w `pozycje`, więc
     audyt dalej wie, czego ten ruch dotyczył. */
  logEvent(poprawka ? "kosz_putaway_poprawka" : "kosz_putaway", autor, twId, {
    koszId: kosz.id,
    pozycjaId,
    ...(grupa.length > 1 ? { pozycje: grupa.map((w) => w.id) } : {}),
    qty: grupa.reduce((n, w) => n + Number(w.ilosc), 0),
    location: code,
    expected: oczekiwany,
    /* CZYM potwierdzono adres. Bez tego pola dziennik nie odróżnia odłożenia
       SPRAWDZONEGO skanem półki od potwierdzonego bez patrzenia na etykietę —
       a to jest pierwsze pytanie po „towar leży na złej półce". Klucz nie
       nazywa się `zrodlo`, bo tamten w sąsiednich zdarzeniach znaczy EKRAN
       (`kosz`, `dostawa`, `przesuniecie`) i jedno słowo niosłoby dwa sensy. */
    potwierdzenie,
    ...(poprawka ? { poprzedni: (p.lok_faktyczna as string) ?? null } : {}),
  });
  if (mismatch) {
    // częstotliwość per lokalizacja = ten sam raport przepełnionych gniazd
    logEvent("location_mismatch", autor, twId, { pozycjaId, expected: oczekiwany, actual: code, zrodlo: "kosz" });
  }
  return { ok: true, mismatch };
}

/* ── Cofanie pomyłek (0.79.0) ────────────────────────────────────────────────
   Rozkładanie to praca w rękawicy, przy koszu, jedną ręką — pomyłka jest
   normalnym elementem tej pracy, nie wyjątkiem. Do 0.79.0 kolektor nie miał
   ani jednej drogi powrotnej: zły skan regału zamykał pozycję na zawsze,
   a przedwczesne ZAKOŃCZ — cały kosz.

   Granica jest jedna i przechodzi przez SUBIEKTA. Dopóki zapis czeka
   w kolejce, aplikacja go anuluje i cofa wszystko bez śladu w bazie firmy.
   Gdy zapis już poszedł, cofnięcia NIE MA: aplikacja nie ma prawa udawać, że
   dokument albo adres w Subiekcie nie istnieje. Zostaje wtedy droga wprzód —
   poprawienie adresu kolejnym skanem (`odlozPozycje` na pozycji odłożonej)
   albo dokument z biura.                                                     */

/**
 * Zadanie kolejki da się jeszcze anulować — czyli nie dotknęło Subiekta.
 *
 * `null` znaczy „nie było zadania" i jest równie dobre jak anulowane: przy
 * odkładaniu na własną półkę zapis adresu w ogóle nie powstaje.
 */
function anulujJesliCzeka(queueId: number | null | undefined, coTo: string): void {
  if (queueId == null) return;
  const d = db();
  const z = d.prepare("SELECT status FROM sfera_queue WHERE id = ?").get(queueId) as
    | { status: string }
    | undefined;
  if (!z || z.status === "cancelled") return;
  if (z.status !== "pending") {
    throw new BladKosza(
      400,
      `${coTo} jest już w Subiekcie (${z.status}) — tego aplikacja nie cofnie. ` +
        "Popraw skanem właściwego regału albo dokumentem w biurze."
    );
  }
  d.prepare(
    "UPDATE sfera_queue SET status='cancelled', processed_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=?"
  ).run(queueId);
}

/**
 * Cofnięcie ODŁOŻENIA pozycji — pomyłka przy skanie regału.
 *
 * Bez bramki roli, wzorem korekty ilości przy dostawie: to poprawianie
 * WŁASNEJ pomyłki w trakcie pracy, nie orzeczenie o niczym. Ślad z nazwiskiem
 * i oboma adresami zostaje w dzienniku.
 */
export function cofnijOdlozenie(pozycjaId: number, autor: string): SzczegolKosza {
  const d = db();
  const p = d.prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.status !== "done") throw new BladKosza(400, "Ta pozycja nie jest odłożona");
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") {
    throw new BladKosza(400, "Kosz jest już zakończony — najpierw cofnij zakończenie");
  }

  anulujJesliCzeka(p.loc_queue_id as number | null, "Zapis adresu");
  /* CAŁA SKLEJONA LINIJKA (0.359.0) — magazynier cofa to, co widzi, a widzi
     jeden wiersz z sumaryczną ilością. Cofnięcie samego lidera zostawiłoby
     resztę odłożoną i rozbiło linijkę na dwie, bez żadnego ruchu na hali. */
  const grupa = rodzenstwo(p);
  transaction(d, () => {
    const cofnij = d.prepare(
      `UPDATE kosz_pozycja SET status='todo', lok_faktyczna=NULL,
              odlozono_at=NULL, odlozono_przez=NULL, loc_queue_id=NULL WHERE id=?`);
    for (const w of grupa) cofnij.run(w.id);
    logEvent("kosz_putaway_cofniete", autor, p.tw_id as number, {
      koszId: kosz.id,
      pozycjaId,
      ...(grupa.length > 1 ? { pozycje: grupa.map((w) => w.id) } : {}),
      symbol: p.symbol,
      byloNa: p.lok_faktyczna,
    });
  })();
  return szczegolKosza(kosz.id);
}

/** Cofnięcie POMINIĘCIA — pozycja wraca do pracy, bez śladu po powodzie. */
export function cofnijPominiecie(pozycjaId: number, autor: string): SzczegolKosza {
  const d = db();
  const p = d.prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.status !== "skipped") throw new BladKosza(400, "Ta pozycja nie jest pominięta");
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") {
    throw new BladKosza(400, "Kosz jest już zakończony — najpierw cofnij zakończenie");
  }

  /* Cała sklejona linijka, jak przy odłożeniu (0.359.0): pominięcie dotyczyło
     wszystkich sztuk tego towaru, więc cofa się je razem. */
  const grupa = rodzenstwo(p);
  const wroc = d.prepare(
    `UPDATE kosz_pozycja SET status='todo', powod=NULL, pominieto_at=NULL,
            zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL
     WHERE id=?`);
  for (const w of grupa) wroc.run(w.id);
  logEvent("kosz_pominiecie_cofniete", autor, p.tw_id as number, {
    koszId: kosz.id,
    pozycjaId,
    ...(grupa.length > 1 ? { pozycje: grupa.map((w) => w.id) } : {}),
    symbol: p.symbol,
    bylPowod: p.powod,
  });
  return szczegolKosza(kosz.id);
}

/**
 * Cofnięcie ZAKOŃCZENIA kosza — kliknięte za wcześnie albo nie na tym koszu.
 *
 * Kosz wraca do rozkładania, a pozycje zostają tam, gdzie były: odłożone
 * odłożonymi, pominięte pominiętymi. Cofa się STAN KOSZA, nie cudzą pracę.
 *
 * Kosz z dokumentu MM nie kolejkuje niczego, więc cofa się zawsze. Kosz
 * WERTIS ma po jednym MM na pozycję i tu obowiązuje granica Subiekta:
 * wszystkie muszą jeszcze czekać w kolejce. Jedno przetworzone MM znaczy stan
 * już przesunięty i cofnięcie zostawiłoby aplikację w niezgodzie z bazą firmy.
 */
export function cofnijZakonczenie(koszId: number, autor: string): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  if (kosz.status !== "rozlozony") throw new BladKosza(400, "Ten kosz nie jest zakończony");

  const d = db();
  const pozycje = d
    .prepare("SELECT id, symbol, mm_queue_id FROM kosz_pozycja WHERE kosz_id = ?")
    .all(koszId) as Array<{ id: number; symbol: string; mm_queue_id: number | null }>;

  /* Najpierw SPRAWDZAMY wszystkie zadania, dopiero potem anulujemy. Inaczej
     odmowa przy trzeciej pozycji zostawiłaby dwa MM anulowane, a kosz nadal
     zakończony — stan gorszy niż przed kliknięciem. */
  for (const p of pozycje) {
    if (p.mm_queue_id == null) continue;
    const z = d.prepare("SELECT status FROM sfera_queue WHERE id = ?").get(p.mm_queue_id) as
      | { status: string }
      | undefined;
    if (z && z.status !== "pending" && z.status !== "cancelled") {
      throw new BladKosza(
        400,
        `MM na ${p.symbol || p.id} jest już w Subiekcie (${z.status}) — zakończenia nie cofnie ` +
          "aplikacja. Dokument odwrotny wystawia biuro."
      );
    }
  }

  /* MM POWROTNE (0.266.0) siedzi przy KOSZU, nie przy pozycji. Do 15 września
     2026 cofnięcie go nie widziało: kosz wracał do rozkładania z dokumentem
     już zamówionym, a drugie ZAKOŃCZ oddawało to samo stare zadanie
     (`zakolejkujPowrot` patrzy na `powrot_queue_id`). Granica Subiekta jest
     ta sama co wyżej: czekające anulujemy, wykonanego nie ruszamy. */
  if (kosz.powrot_queue_id != null) {
    const z = d.prepare("SELECT status FROM sfera_queue WHERE id = ?").get(kosz.powrot_queue_id) as
      | { status: string }
      | undefined;
    if (z && z.status !== "pending" && z.status !== "cancelled") {
      throw new BladKosza(
        400,
        `MM powrotne kosza ${kosz.kod} jest już w Subiekcie (${z.status}) — zakończenia nie ` +
          "cofnie aplikacja. Dokument odwrotny wystawia biuro."
      );
    }
  }

  transaction(d, () => {
    for (const p of pozycje) anulujJesliCzeka(p.mm_queue_id, "MM");
    anulujJesliCzeka(kosz.powrot_queue_id, "MM powrotne");
    d.prepare("UPDATE kosz_pozycja SET mm_queue_id=NULL WHERE kosz_id=?").run(koszId);
    d.prepare(
      `UPDATE kosz SET status='zamkniety', rozlozono_at=NULL, rozlozono_przez=NULL,
                       powrot_queue_id=NULL WHERE id=?`
    ).run(koszId);
    logEvent("kosz_zakonczenie_cofniete", autor, null, {
      koszId,
      kod: kosz.kod,
      pozycji: pozycje.length,
      mmAnulowanych: pozycje.filter((p) => p.mm_queue_id != null).length,
      powrotAnulowany: kosz.powrot_queue_id != null,
    });
  })();
  return szczegolKosza(koszId);
}

/**
 * „Wrócę do tego" — pozycja zjeżdża na koniec listy i tyle.
 *
 * To NIE jest pominięcie i różnica jest istotna dla biura: pominięcie znaczy
 * „tego towaru w koszu nie ma" i trafia na listę spraw do wyjaśnienia, a to
 * znaczy tylko „nie teraz" — regał zastawiony, towar na dnie kosza, po drodze
 * coś pilniejszego. Kosz nadal czeka na tę pozycję i ZAKOŃCZ jej nie przepuści.
 *
 * Znacznik czasu zamiast flagi: druga pozycja odłożona na później staje ZA
 * pierwszą, a ponowne kliknięcie tej samej przesuwa ją na sam koniec.
 */
export function przesunNaKoniec(pozycjaId: number, autor: string): SzczegolKosza {
  const d = db();
  const p = d.prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.status !== "todo") {
    throw new BladKosza(400, "Na koniec listy odkłada się pozycję, która wciąż czeka");
  }
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") throw new BladKosza(400, "Kosz nie jest w rozkładaniu");

  /* Cała sklejona linijka i TEN SAM znacznik czasu (0.359.0): rodzeństwo ma
     zostać razem także na końcu listy, a dwa znaczniki rozbiłyby je na dwie
     pozycje stojące obok siebie. */
  const grupa = rodzenstwo(p);
  const teraz = nowIso();
  const przesun = d.prepare("UPDATE kosz_pozycja SET pozniej_at=? WHERE id=?");
  for (const w of grupa) przesun.run(teraz, w.id);
  logEvent("kosz_pozycja_na_pozniej", autor, p.tw_id as number, {
    koszId: kosz.id,
    pozycjaId,
    ...(grupa.length > 1 ? { pozycje: grupa.map((w) => w.id) } : {}),
    symbol: p.symbol,
  });
  return szczegolKosza(kosz.id);
}

/**
 * Jedno „cofnij" na pozycję — serwer sam wie, co cofa.
 *
 * Magazynier nie ma obowiązku pamiętać, czy pomylił się przy odkładaniu, czy
 * przy pomijaniu; widzi jeden przycisk i klika. Rozróżnienie jest tu, a nie
 * w kolektorze, bo stan pozycji zna baza.
 */
export function cofnijPozycje(pozycjaId: number, autor: string): SzczegolKosza {
  const p = db().prepare("SELECT status FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | { status: string }
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  return p.status === "skipped"
    ? cofnijPominiecie(pozycjaId, autor)
    : cofnijOdlozenie(pozycjaId, autor);
}

/** Powody pominięcia, które kolektor podaje z listy; „inny" niesie wpis ręczny. */
/**
 * Pominięcie pozycji, której magazynier nie ma jak odłożyć.
 *
 * Do 0.77.0 jedyną drogą było zostawienie kosza nierozłożonego — jedna
 * pozycja bez towaru blokowała ZAKOŃCZ, a razem z nim cały obieg. Kosz
 * wracał wtedy do biura bez żadnego śladu, CZEGO w nim zabrakło.
 *
 * Powód jest OBOWIĄZKOWY, bo to jedyna treść tego zgłoszenia: biuro dostanie
 * kosz niekompletny i musi wiedzieć, czy szukać towaru, czy reklamacji.
 * Idempotentne — drugi klik na tej samej pozycji zmienia wyłącznie powód.
 */
export function pominPozycjeKosza(
  pozycjaId: number,
  powod: string,
  autor: string
): { ok: true } {
  const tresc = (powod ?? "").trim().slice(0, 200);
  if (!tresc) throw new BladKosza(400, "Podaj powód pominięcia — biuro dostanie kosz niekompletny");

  const d = db();
  const p = d.prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  const kosz = wierszKosza(p.kosz_id as number);
  if (kosz.status !== "zamkniety") {
    throw new BladKosza(400, "Kosz nie jest w rozkładaniu — otwarty dokłada, rozłożony skończył");
  }
  if (p.status === "done") {
    throw new BladKosza(400, "Pozycja jest odłożona — pomijanie dotyczy towaru, którego nie ma");
  }

  /* Pominięcie ZERUJE załatwienie: skoro hala zgłasza brak drugi raz, sprawa
     wraca na listę biura, choćby ktoś zamknął ją wcześniej. */
  const grupa = rodzenstwo(p);
  const teraz = nowIso();
  const pomin = d.prepare(
    `UPDATE kosz_pozycja SET status='skipped', powod=?, pominieto_at=?,
            zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL
     WHERE id=?`);
  for (const w of grupa) {
    pomin.run(tresc, teraz, w.id);
    /* Pominięcie mówi biuru rzecz, o którą samo by nie zapytało: towaru,
       który zwrot zapowiadał, w koszu nie było. Ślad idzie PER WIERSZ, bo
       każdy należy do innego zwrotu i każdy z tych klientów czeka na
       rozstrzygnięcie. */
    sladZKosza(db(), w.id, "kosz_pominiety",
      `Hala nie znalazła towaru w koszu ${kosz.kod}: ${tresc}`,
      { koszId: kosz.id, kod: kosz.kod, powod: tresc, twId: p.tw_id }, autor, teraz);
  }
  logEvent("kosz_pozycja_pominieta", autor, p.tw_id as number, {
    koszId: kosz.id,
    kod: kosz.kod,
    pozycjaId,
    ...(grupa.length > 1 ? { pozycje: grupa.map((w) => w.id) } : {}),
    symbol: p.symbol,
    powod: tresc,
  });
  return { ok: true };
}

/**
 * Zakończenie rozkładania: bufor cofa się SAM.
 *
 * To jest krok 9 procesu — dotąd ktoś przy komputerze musiał pamiętać
 * o dokumencie cofającym. Teraz zatwierdzenie rozłożenia na kolektorze
 * kolejkuje MM ZWROTY→MAG per pozycja i nikt niczego nie pilnuje ręką.
 */
/* ── Powrót z bufora: MM ZWROTY→MAG (0.266.0) ────────────────────────────────
   Do 0.264.0 łańcuch urywał się na przedostatnim kroku. Kosz złożony
   w panelu wysyłał towar na regał zwrotów własnym MM (0.192.0), hala
   rozkładała go na półki i zapisywała adresy — a STAN zostawał na regale
   zwrotów. Towar leżał w hali i nie był sprzedawalny, dopóki biuro nie
   wystawiło drugiego dokumentu ręką w Subiekcie. Nic o tym nie
   przypominało: rekoncyliacja znała sześć rozjazdów i tego wśród nich
   nie było.

   ZADANIE POWSTAJE PO ADRESACH, nie przed nimi. Niezmiennik „adres przed
   sprzedawalnością" (`services/queue.ts`, `sfera-worker/sql/pick_mm_*.sql`)
   pilnuje po kolumnie `tw_id`, więc MM wielopozycyjne przechodzi obok
   bramki. Dlatego zależność rozstrzygamy WCZEŚNIEJ: dopóki choć jedno
   zadanie adresu z tego kosza czeka, jest w robocie albo stoi w błędzie,
   dokument nie powstaje wcale. Kosz czeka wtedy na `wypuscPowrotyKoszy`.

   `cancelled` NIE blokuje — człowiek świadomie wycofał zapis adresu, tak samo
   jak w guardzie workera.

   POMINIĘTE POZYCJE NIE WRACAJĄ. Magazynier zgłosił, że towaru w koszu nie
   było; przesunięcie zdjęłoby z regału zwrotów stan, którego nikt nie
   przeniósł. Zostają na regale i na liście pominięć dla biura. */

/** Zadania adresów z tego kosza, które jeszcze nie weszły do Subiekta. */
function adresyWDrodze(koszId: number): number {
  return Number(
    (
      db()
        .prepare(
          `SELECT COUNT(*) AS n FROM kosz_pozycja p
             JOIN sfera_queue q ON q.id = p.loc_queue_id
            WHERE p.kosz_id = ? AND q.status IN ('pending','processing','error')`
        )
        .get(koszId) as { n: number }
    ).n
  );
}

/**
 * Dokąd cofa się bufor — i czy w ogóle wiadomo dokąd.
 *
 * Kosz złożony w aplikacji ma trasę z konfiguracji: sam wysłał towar
 * MAG→ZWROTY (`kosze-zwrotow.ts`), więc wraca tą samą drogą w drugą stronę.
 * Kosz z dokumentu wraca TAM, SKĄD PRZYJECHAŁ — magazynem docelowym jest
 * `mm_mag_z`, czyli `dok_MagId` tamtego przesunięcia. Wzięcie zamiast tego
 * `config.magId.MAG` byłoby zgadywaniem: filtr importu pilnuje wyłącznie
 * ODBIORCY dokumentu (`MAG_ID_ZWROTY`), o nadawcy nie mówi nic.
 *
 * Źródłem jest `config.magId.ZWROTY` także dla kosza z dokumentu i to nie jest
 * skrót — importer bierze wyłącznie dokumenty z tym odbiorcą, więc towar leży
 * na tym regale z definicji.
 *
 * Brak `mm_mag_z` (kosz otwarty przed 0.277.0, dokument dawno poza oknem
 * importu) oddaje `null` i to jest decyzja: dokument wystawiony na zgadnięty
 * magazyn przesuwa towar naprawdę, a MM nie cofa się jednym kliknięciem.
 * Kosz zgłosi się wtedy w rekoncyliacji jako `kosz_bez_powrotu` i zamknie go
 * biuro ręką — czyli dokładnie tak, jak działał cały ten obieg do 0.276.x.
 */
function trasaPowrotu(k: WierszKosza): { zMagazynu: number; doMagazynu: number } | null {
  /* KOSZYK Z PANELU MA TRASĘ Z KONFIGURACJI, także po związaniu z dokumentem
     (0.377.0). To MY zleciliśmy tamto MM i wiemy, że poszło MAG→ZWROTY
     (`zakolejkujMm`), więc `mm_mag_z` niczego tu nie dodaje — a bywa PUSTE,
     bo kolumna read-modelu jest nullowalna. Bez tego warunku związanie
     odbierałoby koszykowi trasę, którą przed nim miał pewną: powrót nie
     wychodziłby wcale, a towar zostawał na regale zwrotów. */
  if (k.mm_queue_id !== null) {
    return { zMagazynu: config.magId.ZWROTY, doMagazynu: config.magId.MAG };
  }
  if (k.mm_dok_id === null) {
    return { zMagazynu: config.magId.ZWROTY, doMagazynu: config.magId.MAG };
  }
  const magZ = Number(k.mm_mag_z ?? 0);
  if (!magZ || magZ === config.magId.ZWROTY) {
    console.warn(
      `[kosz] powrót ${k.kod}: nie znam magazynu źródłowego dokumentu ` +
        `${k.mm_numer ?? k.mm_dok_id} — dokument wystawia biuro.`
    );
    return null;
  }
  return { zMagazynu: config.magId.ZWROTY, doMagazynu: magZ };
}

/**
 * Zamawia MM powrotne dla rozłożonego kosza.
 *
 * Oddaje `id` zadania albo `null`, gdy powrót temu koszowi się nie należy
 * (karton, odpad, sam pominięty towar, nieznany kierunek) albo gdy adresy
 * jeszcze nie weszły. Idempotentne: drugi przebieg widzi `powrot_queue_id`.
 */
export function zakolejkujPowrot(koszId: number, autor: string): number | null {
  const k = wierszKosza(koszId);
  if (k.powrot_queue_id) return k.powrot_queue_id;
  if (k.powrot_poza_aplikacja) return null;
  if (k.status !== "rozlozony") return null;
  if (k.rodzaj === RODZAJ_KARTON || k.rodzaj === RODZAJ_ODPAD) return null;
  const trasa = trasaPowrotu(k);
  if (!trasa) return null;
  if (adresyWDrodze(koszId) > 0) return null;
  /* POWRÓT PO PRZYJEŹDZIE. Kosz złożony w aplikacji wysyła towar na regał
     WŁASNYM MM (`kosze-zwrotow.ts`), a to MM czeka na komplet korekt. Hala
     rozkłada kosz wcześniej, bo zamknięcie jest czynnością fizyczną.

     Do 15 września 2026 ZAKOŃCZ zamawiało powrót od razu. Dokument zdejmował
     z regału zwrotów stan, którego tam nie było, a MM na regał nie wychodziło
     już nigdy. Teraz powrót czeka, aż tamto MM wejdzie do Subiekta, i wychodzi
     z `wypuscPowrotyKoszy`. Kosz z dokumentu przyjechał cudzym MM i nie czeka. */
  if (k.mm_dok_id === null) {
    const naRegal = k.mm_queue_id === null ? undefined
      : db().prepare("SELECT status FROM sfera_queue WHERE id = ?").get(k.mm_queue_id) as
        | { status: string }
        | undefined;
    if (naRegal?.status !== "done") return null;
  }

  const odlozone = db()
    .prepare("SELECT tw_id, ilosc FROM kosz_pozycja WHERE kosz_id = ? AND status='done'")
    .all(koszId) as Array<{ tw_id: number; ilosc: number }>;
  if (odlozone.length === 0) return null;

  /* Pozycje SUMUJĄ SIĘ po kartotece — ten sam towar z dwóch zwrotów to jedna
     linia dokumentu, tak samo jak przy MM na bufor (`kosze-zwrotow.ts`). */
  const wgTowaru = new Map<number, number>();
  for (const p of odlozone) {
    wgTowaru.set(Number(p.tw_id), (wgTowaru.get(Number(p.tw_id)) ?? 0) + Number(p.ilosc));
  }
  const items = [...wgTowaru].map(([twId, qty]) => ({ twId, qty }));

  const queueId = enqueueMM(trasa.zMagazynu, trasa.doMagazynu, items, {
    createdBy: autor,
    label: `MM powrót · kosz ${k.kod}`,
    detail: `${items.length} kartotek z regału zwrotów na magazyn ${trasa.doMagazynu}`,
  });
  db().prepare("UPDATE kosz SET powrot_queue_id=? WHERE id=?").run(queueId, koszId);
  logEvent("kosz_powrot_mm", autor, null, {
    koszId,
    kod: k.kod,
    queueId,
    kartotek: items.length,
    mmDokId: k.mm_dok_id,
    doMagazynu: trasa.doMagazynu,
  });
  return queueId;
}

/** Kto podpisuje powrót wypuszczony po zapisaniu adresów. Nie człowiek. */
export const AUTOMAT_POWROTU = "automat (adresy zapisane)";

/**
 * Kosze rozłożone, którym powrót jeszcze się nie należał — próba druga.
 *
 * Woła to worker po każdym zapisanym adresie: to jedyny moment, w którym
 * warunek może się zmienić. Osobnego tickera nie zakładamy, bo zależność
 * jest zdarzeniem, a nie upływem czasu.
 */
export function wypuscPowrotyKoszy(autor = AUTOMAT_POWROTU): number {
  const kosze = db()
    .prepare(
      `SELECT id FROM kosz
        WHERE status='rozlozony' AND powrot_queue_id IS NULL
          AND powrot_poza_aplikacja = 0
          AND rodzaj NOT IN (?, ?)`
    )
    .all(RODZAJ_KARTON, RODZAJ_ODPAD) as Array<{ id: number }>;
  let wypuszczonych = 0;
  for (const k of kosze) {
    /* Kosz idzie WŁASNĄ próbą: jeden wywrócony (skasowana kartoteka, zepsuty
       wiersz) nie ma prawa zabrać pozostałych — ta sama lekcja co przy
       wiązaniu zaległości w 0.220.0. */
    try {
      if (zakolejkujPowrot(k.id, autor) !== null) wypuszczonych++;
    } catch (e) {
      console.error(`[kosz] powrót ${k.id} nie doszedł:`, e instanceof Error ? e.message : e);
    }
  }
  return wypuszczonych;
}

export function zakonczKosz(koszId: number, autor: string): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  if (kosz.status === "rozlozony") return szczegolKosza(koszId); // drugie kliknięcie
  if (kosz.status !== "zamkniety") throw new BladKosza(400, "Kosz nie jest w rozkładaniu");
  const pozycje = db()
    .prepare("SELECT id, tw_id, symbol, ilosc, status FROM kosz_pozycja WHERE kosz_id = ?")
    .all(koszId) as Array<{ id: number; tw_id: number; symbol: string; ilosc: number; status: string }>;
  /* Pominięta jest stanem KOŃCOWYM, tak samo jak przy dostawach. Blokowanie
     nią zakończenia karałoby zgłaszającego brak — a wtedy nikt by go nie
     zgłaszał i kosz wracałby do biura bez śladu, czego zabrakło. */
  const braki = pozycje.filter((p) => p.status !== "done" && p.status !== "skipped");
  if (braki.length > 0) {
    throw new BladKosza(400, `Nieodłożone pozycje: ${braki.map((b) => b.symbol || b.tw_id).join(", ")}`);
  }
  const odlozone = pozycje.filter((p) => p.status === "done");
  const pominiete = pozycje.length - odlozone.length;

  const d = db();
  /* KTÓRY KOSZ KOLEJKUJE DOKUMENT — dwie drogi, nie trzy.

     KARTON (0.122.0): towar w ogóle nie opuścił magazynu. Ktoś zebrał go pod
     zamówienie, pakujący odłożył do pudła, a teraz wraca na półkę. Tu nie ma
     czego przesuwać i nigdy nie będzie.

     Każdy inny kosz cofa bufor sam: złożony w panelu od 0.266.0, z dokumentu
     MM od 0.277.0. Różni je wyłącznie kierunek (`trasaPowrotu`), bo jeden
     wysłał towar na regał własnym dokumentem, a drugi cudzym. Zamówienie idzie
     PO zapisaniu koszyka jako rozłożonego i POZA transakcją: wstawienie wiersza
     kolejki nie ma prawa wywrócić zamknięcia pracy hali, a gdy adresy jeszcze
     nie weszły, dokument zamówi `wypuscPowrotyKoszy`. */
  transaction(d, () => {
    d.prepare("UPDATE kosz SET status='rozlozony', rozlozono_at=?, rozlozono_przez=? WHERE id=?")
      .run(nowIso(), autor, koszId);
    logEvent("kosz_rozlozony", autor, null, {
      koszId,
      kod: kosz.kod,
      pozycji: pozycje.length,
      pominietych: pominiete,
      mmDokId: kosz.mm_dok_id,
    });
  })();
  /* Poza transakcją i pod parasolem: kosz jest już rozłożony, a nieudane
     zamówienie dokumentu ma zostawić ślad w logu, nie cofnąć pracy hali.
     Rekoncyliacja i tak wypisze kosz bez powrotu. */
  try {
    zakolejkujPowrot(koszId, autor);
  } catch (e) {
    console.error(`[kosz] powrót ${koszId} nie doszedł:`, e instanceof Error ? e.message : e);
  }
  return szczegolKosza(koszId);
}

/* ── Wgląd biura: co zostało pominięte i gdzie jechał towar ──────────────────
   Dwa pytania, które biuro zadaje po fakcie, a na które karta kosza sama nie
   odpowiada: „czego zabrakło" i „w którym koszu to było". Pierwsze jest listą
   pracy, drugie wyszukiwaniem — oba czytają tę samą tabelę pozycji.          */

export interface PominietaPozycja {
  pozycjaId: number;
  koszId: number;
  kod: string;
  /** Numer przesunięcia MM; null = kosz złożony w aplikacji. */
  mmNumer: string | null;
  twId: number;
  symbol: string;
  nazwa: string;
  ilosc: number;
  powod: string;
  at: string | null;
  /** Ile dni sprawa czeka; liczone od pominięcia, a nie od powstania kosza. */
  dni: number;
}

/**
 * Pominięte pozycje ze WSZYSTKICH koszy — lista pracy biura.
 *
 * Pominięcie znaczy „tego towaru nie było", więc ktoś musi rozstrzygnąć: szukać
 * dalej, reklamować u przewoźnika czy poprawić dokument. Do 0.78.0 widać to
 * było wyłącznie po otwarciu konkretnego kosza, czyli praktycznie wcale.
 *
 * Okno jest takie samo jak na liście koszy i z tego samego powodu: lista służy
 * PRACY, historię trzyma audyt. Kosz nierozłożony zostaje niezależnie od wieku,
 * bo jego sprawa wciąż jest otwarta.
 */
export function pominietePozycje(): PominietaPozycja[] {
  const wiersze = db()
    .prepare(
      `SELECT p.id AS pozycja_id, p.kosz_id, p.tw_id, p.symbol, p.nazwa, p.ilosc,
              p.powod, p.pominieto_at, k.kod, k.mm_numer, k.status AS kosz_status
       FROM kosz_pozycja p
       JOIN kosz k ON k.id = p.kosz_id
       WHERE p.status = 'skipped'
         AND p.zalatwione_at IS NULL
         -- granica ISO, nie datetime(): powód przy GRANICA_OKNA w raporty.ts
         AND (k.status <> 'rozlozony' OR k.rozlozono_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))
       ORDER BY COALESCE(p.pominieto_at, k.zamknieto_at, k.utworzono_at)`
    )
    .all() as Array<Record<string, unknown>>;

  const teraz = Date.now();
  return wiersze.map((w) => {
    const at = (w.pominieto_at as string) ?? null;
    return {
      pozycjaId: w.pozycja_id as number,
      koszId: w.kosz_id as number,
      kod: w.kod as string,
      mmNumer: (w.mm_numer as string) ?? null,
      twId: w.tw_id as number,
      symbol: w.symbol as string,
      nazwa: w.nazwa as string,
      ilosc: w.ilosc as number,
      powod: (w.powod as string) ?? "",
      at,
      /* Pominięcia sprzed 0.78.0 nie mają znacznika — zero zamiast zgadywania,
         bo wymyślona liczba dni wyglądałaby dokładnie jak prawdziwa. */
      dni: at ? Math.floor((teraz - Date.parse(at)) / 86_400_000) : 0,
    };
  });
}

export interface ZnalezionaPozycja {
  koszId: number;
  kod: string;
  mmNumer: string | null;
  koszStatus: string;
  symbol: string;
  nazwa: string;
  ilosc: number;
  status: string;
  lokFaktyczna: string | null;
  powod: string | null;
  kiedy: string | null;
}

/**
 * „W którym koszu jechał ten towar?" — po symbolu, nazwie albo kodzie kreskowym.
 *
 * Pytanie pada, gdy towar zniknął między regałem a Subiektem albo gdy klient
 * dopomina się o zwrot. Bez tego biuro mogło tylko otwierać kosze po kolei.
 *
 * Szuka po SNAPSHOCIE z kosza (symbol i nazwa zapisane przy zamknięciu), bo to
 * on mówi, co naprawdę w koszu leżało — kartoteka mogła się od tego czasu
 * zmienić albo zostać zablokowana. EAN dochodzi z kartoteki, bo w koszu go nie
 * ma, a magazynier ma go pod ręką na opakowaniu.
 *
 * ── SŁOWA, NIE CAŁA FRAZA (0.484.3) ──────────────────────────────────────────
 * Zgłoszenie właściciela: „dodaj szukanie produktu w koszyku po nazwie,
 * symbolu etc.". Szukanie było — ale jako JEDEN `LIKE` na całej frazie
 * i przez `UPPER`, który w SQLite zna tylko ASCII. „Sekator felco" nie
 * trafiało w „Sekator ogrodowy Felco 2", a „łopata" nie trafiała w „Łopata".
 *
 * Teraz każde słowo musi trafić w KTÓREŚ pole — ta sama reguła co w szukaniu
 * spraw (`panel/src/sprawy/szukanie.ts`). Nazwa idzie przez `naGlob` (ogonki
 * i wielkość liter), symbol przez `sqlZwinSymbol` (myślnik i spacja nic nie
 * znaczą). Oba narzędzia są z `tekst.ts`, gdzie symetrię JS ↔ SQL pilnuje test.
 *
 * „ETC" TO KOD KOSZA, NUMER MM I NUMER ZWROTU. Tymi uchwytami biuro
 * rozmawia o koszu, a numer zwrotu odpowiada na „gdzie pojechał towar
 * z tej paczki". EAN zostaje dokładny i całą frazą — to kod, nie słowo.
 */
export function szukajWKoszach(fraza: string): ZnalezionaPozycja[] {
  const q = (fraza ?? "").trim();
  if (q.length < 2) throw new BladKosza(400, "Podaj co najmniej dwa znaki — symbol, nazwę albo kod kreskowy");
  const toks = tokeny(q);
  /* Sama interpunkcja nie ma słów, a koniunkcja po pustym zbiorze jest
     prawdziwa — bez tego strażnika „--" oddałoby sto pierwszych wierszy. */
  if (!toks.length) return [];

  const slowo = `(p.nazwa GLOB ?
      OR ${sqlZwinSymbol("p.symbol")} LIKE ? ESCAPE '\\'
      OR ${sqlZwinSymbol("k.kod")} LIKE ? ESCAPE '\\'
      OR ${sqlZwinSymbol("COALESCE(k.mm_numer, '')")} LIKE ? ESCAPE '\\'
      OR ${sqlZwinSymbol("COALESCE(z.reference_number, '')")} LIKE ? ESCAPE '\\')`;
  const wiersze = db()
    .prepare(
      `SELECT p.kosz_id, p.symbol, p.nazwa, p.ilosc, p.status, p.lok_faktyczna, p.powod,
              COALESCE(p.odlozono_at, p.pominieto_at) AS kiedy,
              k.kod, k.mm_numer, k.status AS kosz_status
       FROM kosz_pozycja p
       JOIN kosz k ON k.id = p.kosz_id
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
       LEFT JOIN zwrot_klienta_pozycja zp ON zp.id = p.zwrot_pozycja_id
       LEFT JOIN zwrot_klienta z ON z.id = zp.zwrot_id
       WHERE (${toks.map(() => slowo).join(" AND ")})
          OR (t.ean <> '' AND t.ean = ?)
       ORDER BY k.id DESC, p.id
       LIMIT 100`
    )
    .all(...toks.flatMap((t) => {
      const like = `%${naLike(t)}%`;
      return [naGlob(t), like, like, like, like];
    }), q) as Array<Record<string, unknown>>;

  return wiersze.map((w) => ({
    koszId: w.kosz_id as number,
    kod: w.kod as string,
    mmNumer: (w.mm_numer as string) ?? null,
    koszStatus: w.kosz_status as string,
    symbol: w.symbol as string,
    nazwa: w.nazwa as string,
    ilosc: w.ilosc as number,
    status: w.status as string,
    lokFaktyczna: (w.lok_faktyczna as string) ?? null,
    powod: (w.powod as string) ?? null,
    kiedy: (w.kiedy as string) ?? null,
  }));
}

/**
 * Zamknięcie sprawy pominiętej pozycji — decyzja BIURA, nie hali.
 *
 * Pominięcie zostaje pominięciem: hala zgłosiła, że towaru nie ma, i tego się
 * nie przepisuje. Zmienia się tylko to, czy sprawa wisi na liście pracy.
 * Bez tego przycisku lista rosłaby w nieskończoność, aż przestano by ją
 * czytać — a wtedy nowe zgłoszenie ginęłoby wśród załatwionych.
 *
 * Notatka jest DOBROWOLNA, odwrotnie niż powód pominięcia. Powód to jedyna
 * treść zgłoszenia i bez niego nie ma o czym rozmawiać; tutaj najczęstszym
 * zakończeniem jest „znalazło się", a wymuszanie zdania na każde kliknięcie
 * kosztowałoby więcej, niż warte jest to zdanie.
 */
export function zalatwPominiecie(
  pozycjaId: number,
  autor: string,
  notatka = ""
): { ok: true } {
  const d = db();
  const p = d.prepare("SELECT * FROM kosz_pozycja WHERE id = ?").get(pozycjaId) as
    | Record<string, unknown>
    | undefined;
  if (!p) throw new BladKosza(404, `Pozycja ${pozycjaId} nie istnieje`);
  if (p.status !== "skipped") {
    throw new BladKosza(400, "Załatwia się POMINIĘCIE — ta pozycja nie jest pominięta");
  }
  if (p.zalatwione_at) return { ok: true }; // drugie kliknięcie nic nie zmienia

  const tresc = String(notatka ?? "").trim().slice(0, 200);
  d.prepare(
    "UPDATE kosz_pozycja SET zalatwione_at=?, zalatwione_przez=?, zalatwione_notatka=? WHERE id=?"
  ).run(nowIso(), autor, tresc || null, pozycjaId);
  logEvent("kosz_pominiecie_zalatwione", autor, p.tw_id as number, {
    pozycjaId,
    koszId: p.kosz_id,
    symbol: p.symbol,
    powod: p.powod,
    notatka: tresc,
  });
  return { ok: true };
}
