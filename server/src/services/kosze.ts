import { db, nowIso, transaction } from "../db/db.js";
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
import { pozycjeDoKorekty } from "./zwroty.js";

/* ── Cyfrowe kosze zwrotowe (Etap 3) ─────────────────────────────────────────
   Kosz zastępuje papierową kartkę wożoną z towarem. Cykl życia:

     biuro: przypina zwroty skanem kodu kosza (wymóg: dokumenty już zlecone,
            bo kosz wiąże się z korektą i MM — nie z „może kiedyś")
     biuro: zamyka kosz → SNAPSHOT pozycji (co fizycznie leży w środku)
     hala:  kolektor pokazuje zamknięte kosze; skan towaru wskazuje pozycję,
            skan regału ją odkłada — jak przy dostawach
     hala:  ZAKOŃCZ → MM ZWROTY→MAG per pozycja cofa bufor automatycznie

   MM cofające są JEDNOPOZYCYJNE świadomie: guard „adres przed
   sprzedawalnością" w obu workerach porządkuje zadania po tw_id, a MM
   wielopozycyjne wypadałoby spod niego. Zapis adresu z odkładania MUSI wejść
   do Subiekta przed zadaniem, które czyni towar sprzedawalnym.               */

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

export interface PozycjaKosza {
  id: number;
  /** NULL przy koszu z dokumentu MM — pozycja nie pochodzi ze zwrotu. */
  zwrotId: number | null;
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
  zwroty: Array<{ id: number; referencja: string | null; waybill: string }>;
  pozycje: PozycjaKosza[];
  odlozonych: number;
  /**
   * Numer przesunięcia MM z Subiekta, gdy kosz powstał z dokumentu; NULL =
   * kosz złożony w aplikacji. Kolektor po tym pozna, że po ZAKOŃCZ nie ma
   * żadnego dokumentu do obiecywania — ten wystawia biuro.
   */
  mmNumer: string | null;
  /** `zwroty` albo `karton` — kolektor po tym wie, którą fazę pokazać. */
  rodzaj: string;
  /** Kto i kiedy anulował karton (0.123.0); NULL przy każdym innym koszu. */
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
}

export interface WierszListyKoszy {
  id: number;
  kod: string;
  status: string;
  zwrotow: number;
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
  /** `zwroty` albo `karton` — biuro ma wiedzieć, że kosz bez zwrotów jest cały. */
  rodzaj: string;
  anulowanoAt: string | null;
  anulowanoPrzez: string | null;
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

/**
 * Przypięcie zwrotu do kosza — skanem kodu na karcie zwrotu.
 *
 * Kosz o nieznanym kodzie POWSTAJE tutaj: rejestr koszy prowadzony osobno
 * byłby drugą listą do pilnowania, a etykieta na fizycznym koszu i tak jest
 * jedynym źródłem prawdy o tym, które kosze istnieją.
 */
export function przypnijZwrot(zwrotId: number, kodRaw: string, autor: string): void {
  const kod = normalizujKod(kodRaw);
  const z = db()
    .prepare("SELECT id, kosz_id, korekta_queue_id FROM zwrot WHERE id = ?")
    .get(zwrotId) as { id: number; kosz_id: number | null; korekta_queue_id: number | null } | undefined;
  if (!z) throw new BladKosza(404, `Zwrot ${zwrotId} nie istnieje`);
  /* Kosz wiąże się z DOKUMENTEM MM (proces, krok 6) — bez zleconych
     dokumentów nie ma czego wiązać, a towar bez korekty nie ma prawa
     jechać na bufor. */
  if (!z.korekta_queue_id) {
    throw new BladKosza(400, "Najpierw wystaw korektę i MM — kosz wiąże się z dokumentem");
  }
  if (pozycjeDoKorekty(zwrotId).length === 0) {
    throw new BladKosza(400, "Zwrot nie ma pozycji pełnowartościowych — nie ma czego włożyć do kosza");
  }

  const d = db();
  transaction(d, () => {
    let kosz = koszPoKodzie(kod);
    if (kosz && kosz.status !== "otwarty") {
      throw new BladKosza(400, `Kosz ${kod} jest zamknięty — do rozłożenia, nie do dokładania`);
    }
    if (!kosz) {
      /* Kod zajęty przez KARTON — `koszPoKodzie` kartonów nie widzi, więc bez
         tego sprawdzenia INSERT rozbiłby się o `ix_kosz_kod_aktywny` i biuro
         zobaczyłoby błąd bazy zamiast zdania o tym, co się stało. */
      const zajety = d
        .prepare("SELECT id FROM kosz WHERE kod = ? AND status <> 'rozlozony'")
        .get(kod) as { id: number } | undefined;
      if (zajety) throw new BladKosza(400, `Kod ${kod} nosi karton z hali — zwrotu nie ma tam czego szukać`);
      const res = d
        .prepare("INSERT INTO kosz(kod, status, utworzono_at, utworzono_przez) VALUES (?, 'otwarty', ?, ?)")
        .run(kod, nowIso(), autor);
      kosz = wierszKosza(Number(res.lastInsertRowid));
    }
    if (z.kosz_id === kosz.id) return; // drugi skan tego samego kosza — nic do zrobienia
    if (z.kosz_id) {
      throw new BladKosza(400, "Zwrot leży już w innym koszu — najpierw go odepnij");
    }
    d.prepare("UPDATE zwrot SET kosz_id = ? WHERE id = ?").run(kosz.id, zwrotId);
    logEvent("kosz_przypiecie", autor, null, { zwrotId, koszId: kosz.id, kod });
  })();
}

export function odepnijZwrot(zwrotId: number, autor: string): void {
  const z = db().prepare("SELECT kosz_id FROM zwrot WHERE id = ?").get(zwrotId) as
    | { kosz_id: number | null }
    | undefined;
  if (!z) throw new BladKosza(404, `Zwrot ${zwrotId} nie istnieje`);
  if (!z.kosz_id) return;
  const kosz = wierszKosza(z.kosz_id);
  if (kosz.status !== "otwarty") {
    throw new BladKosza(400, "Kosz jest już zamknięty — zawartość idzie na halę w komplecie");
  }
  db().prepare("UPDATE zwrot SET kosz_id = NULL WHERE id = ?").run(zwrotId);
  logEvent("kosz_odpiecie", autor, null, { zwrotId, koszId: kosz.id, kod: kosz.kod });
}

/**
 * Zamknięcie kosza — od tej chwili to jednostka pracy dla hali.
 *
 * Snapshot pozycji powstaje TERAZ, nie przy przypinaniu: dokłada się do kosza
 * partiami, a listą do rozłożenia ma być stan z chwili, gdy biuro mówi
 * „komplet". Adres do snapshotu nie wchodzi — liczy się żywy (patrz schema).
 */
export function zamknijKosz(koszId: number, autor: string): SzczegolKosza {
  const kosz = wierszKosza(koszId);
  if (kosz.status !== "otwarty") throw new BladKosza(400, "Kosz nie jest otwarty");
  /* Karton zamyka HALA własną trasą (`zatwierdzKarton`), bo to ona zna jego
     zawartość. Ta funkcja żąda zwrotów z wystawionymi dokumentami i przy
     kartonie odmówiłaby zdaniem o korekcie, którego nikt by nie zrozumiał. */
  if (kosz.rodzaj === RODZAJ_KARTON) {
    throw new BladKosza(400, "Karton zatwierdza się na kolektorze — biuro nie zna jego zawartości");
  }
  const zwroty = db()
    .prepare(
      `SELECT z.id, z.referencja, z.waybill, q.status AS dok_status
       FROM zwrot z LEFT JOIN sfera_queue q ON q.id = z.korekta_queue_id
       WHERE z.kosz_id = ?`
    )
    .all(koszId) as Array<{ id: number; referencja: string | null; waybill: string; dok_status: string | null }>;
  if (zwroty.length === 0) throw new BladKosza(400, "Pusty kosz nie ma czego jechać na halę");
  /* Kosz jedzie na halę dopiero, gdy korekty i MM NAPRAWDĘ weszły do
     Subiekta. Zamknięcie z zadaniem w błędzie skończyłoby się cofnięciem
     bufora, na którym tego towaru nigdy nie było — czyli ujemnym stanem. */
  const czekaja = zwroty.filter((z) => z.dok_status !== "done");
  if (czekaja.length > 0) {
    throw new BladKosza(
      400,
      "Dokumenty jeszcze nie weszły do Subiekta dla: " +
        czekaja.map((z) => z.referencja ?? z.waybill).join(", ") +
        " — sprawdź kolejkę zapisów"
    );
  }

  const d = db();
  transaction(d, () => {
    const ins = d.prepare(
      `INSERT INTO kosz_pozycja(kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc)
       VALUES (?,?,?,?,?,?)`
    );
    let pozycji = 0;
    for (const z of zwroty) {
      for (const p of pozycjeDoKorekty(z.id)) {
        /* Symbol z żywej kartoteki; towar, który wypadł z read-modelu, dostaje
           pustkę — snapshot nazwy i ilości wystarcza, żeby pracować dalej. */
        const t = subiekt.getProductById(p.twId);
        ins.run(koszId, z.id, p.twId, t?.symbol ?? "", p.nazwa, p.ilosc);
        pozycji++;
      }
    }
    if (pozycji === 0) {
      throw new BladKosza(400, "Żaden zwrot w koszu nie ma pozycji pełnowartościowych");
    }
    d.prepare("UPDATE kosz SET status='zamkniety', zamknieto_at=?, zamknieto_przez=? WHERE id=?")
      .run(nowIso(), autor, koszId);
    logEvent("kosz_zamkniety", autor, null, { koszId, kod: kosz.kod, zwrotow: zwroty.length, pozycji });
  })();
  return szczegolKosza(koszId);
}

export function listaKoszy(): WierszListyKoszy[] {
  /* Rozłożone tylko świeże: lista służy pracy, historię trzyma audyt. */
  const wiersze = db()
    .prepare(
      `SELECT k.id, k.kod, k.status, k.utworzono_at,
              k.zamknieto_at, k.zamknieto_przez, k.rozlozono_at, k.rozlozono_przez,
              (SELECT COUNT(*) FROM zwrot z WHERE z.kosz_id = k.id) AS zwrotow,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id) AS pozycji,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id AND p.status='done') AS odlozonych,
              (SELECT COUNT(*) FROM kosz_pozycja p WHERE p.kosz_id = k.id AND p.status='skipped') AS pominietych,
              k.mm_numer, k.rodzaj, k.anulowano_at, k.anulowano_przez
       FROM kosz k
       WHERE k.status NOT IN ('rozlozony', 'anulowany')
          OR COALESCE(k.rozlozono_at, k.anulowano_at) >= datetime('now', '-14 days')
       ORDER BY CASE k.status WHEN 'otwarty' THEN 0 WHEN 'zamkniety' THEN 1 ELSE 2 END, k.id DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return wiersze.map((w) => ({
    id: w.id as number,
    kod: w.kod as string,
    status: w.status as string,
    zwrotow: w.zwrotow as number,
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
  }));
}

/** Kosze do rozłożenia — to, co widzi kolektor na zakładce ZWROTY. */
export function koszeDlaKolektora(): WierszListyKoszy[] {
  return listaKoszy().filter((k) => k.status === "zamkniety" && k.rodzaj !== RODZAJ_KARTON);
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
  const zwroty = db()
    .prepare("SELECT id, referencja, waybill FROM zwrot WHERE kosz_id = ? ORDER BY id")
    .all(koszId) as Array<{ id: number; referencja: string | null; waybill: string }>;
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
  const pozycje: PozycjaKosza[] = wiersze.map((w) => ({
    id: w.id as number,
    zwrotId: w.zwrot_id as number,
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
  return {
    mmNumer: kosz.mm_numer ?? null,
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
    zwroty,
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
export function odlozPozycje(
  pozycjaId: number,
  lokalizacja: string,
  autor: string,
  recznie = false
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

  /* `powod=NULL` cofa pominięcie: magazynier, który jednak znalazł towar,
     ma go po prostu odłożyć, a nie szukać osobnego „cofnij". */
  db()
    .prepare(
      `UPDATE kosz_pozycja SET status='done', powod=NULL, pominieto_at=NULL, pozniej_at=NULL,
              zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL,
              lok_faktyczna=?, odlozono_at=?, odlozono_przez=?, loc_queue_id=? WHERE id=?`
    )
    .run(code, nowIso(), autor, locQueueId, pozycjaId);

  if (recznie) logEvent("manual_entry", autor, twId, { code, kind: "LOC", zrodlo: "kosz" });
  logEvent(poprawka ? "kosz_putaway_poprawka" : "kosz_putaway", autor, twId, {
    koszId: kosz.id,
    pozycjaId,
    qty: p.ilosc,
    location: code,
    expected: oczekiwany,
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
  transaction(d, () => {
    d.prepare(
      `UPDATE kosz_pozycja SET status='todo', lok_faktyczna=NULL,
              odlozono_at=NULL, odlozono_przez=NULL, loc_queue_id=NULL WHERE id=?`
    ).run(pozycjaId);
    logEvent("kosz_putaway_cofniete", autor, p.tw_id as number, {
      koszId: kosz.id,
      pozycjaId,
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

  d.prepare(
    `UPDATE kosz_pozycja SET status='todo', powod=NULL, pominieto_at=NULL,
            zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL
     WHERE id=?`
  ).run(pozycjaId);
  logEvent("kosz_pominiecie_cofniete", autor, p.tw_id as number, {
    koszId: kosz.id,
    pozycjaId,
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

  transaction(d, () => {
    for (const p of pozycje) anulujJesliCzeka(p.mm_queue_id, "MM");
    d.prepare("UPDATE kosz_pozycja SET mm_queue_id=NULL WHERE kosz_id=?").run(koszId);
    d.prepare(
      "UPDATE kosz SET status='zamkniety', rozlozono_at=NULL, rozlozono_przez=NULL WHERE id=?"
    ).run(koszId);
    logEvent("kosz_zakonczenie_cofniete", autor, null, {
      koszId,
      kod: kosz.kod,
      pozycji: pozycje.length,
      mmAnulowanych: pozycje.filter((p) => p.mm_queue_id != null).length,
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

  d.prepare("UPDATE kosz_pozycja SET pozniej_at=? WHERE id=?").run(nowIso(), pozycjaId);
  logEvent("kosz_pozycja_na_pozniej", autor, p.tw_id as number, {
    koszId: kosz.id,
    pozycjaId,
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
export const POWODY_POMINIECIA = ["nie ma w koszu", "uszkodzony", "obcy towar"] as const;

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
  d.prepare(
    `UPDATE kosz_pozycja SET status='skipped', powod=?, pominieto_at=?,
            zalatwione_at=NULL, zalatwione_przez=NULL, zalatwione_notatka=NULL
     WHERE id=?`
  ).run(tresc, nowIso(), pozycjaId);
  logEvent("kosz_pozycja_pominieta", autor, p.tw_id as number, {
    koszId: kosz.id,
    kod: kosz.kod,
    pozycjaId,
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
  /* Dwa kosze NIE kolejkują niczego, każdy z własnego powodu.

     Kosz z dokumentu MM (0.75.0): przesunięcie na regał zwrotów wystawiło już
     biuro, a dokument powrotny (ZWR→MAG) też wystawia biuro — kolektor zapisał
     adresy i to jest cała jego rola. Zakolejkowanie MM tutaj znaczyłoby
     dokument wystawiony DRUGI raz, na towar, który nikomu się nie przesuwał.

     KARTON (0.122.0): towar w ogóle nie opuścił magazynu. Ktoś zebrał go pod
     zamówienie, pakujący odłożył do pudła, a teraz wraca na półkę — stan
     magazynu przez cały ten czas się nie zmienił. MM ZWROTY→MAG zdjęłoby
     z bufora zwrotów towar, którego na tym buforze nigdy nie było, czyli
     zrobiłoby stan ujemny na dokumencie, którego nikt nie zamawiał. */
  if (kosz.mm_dok_id != null || kosz.rodzaj === RODZAJ_KARTON) {
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
    return szczegolKosza(koszId);
  }

  transaction(d, () => {
    /* MM wyłącznie dla ODŁOŻONYCH. Pominięta pozycja nigdzie fizycznie nie
       pojechała, więc przesunięcie na nią zdejmowałoby z bufora towar, który
       dalej leży na regale zwrotów — albo którego nie ma wcale. */
    for (const p of odlozone) {
      const queueId = enqueueMM(config.magId.ZWROTY, config.magId.MAG, [{ twId: p.tw_id, qty: p.ilosc }], {
        createdBy: autor,
        twId: p.tw_id,
        label: "MM zwroty→magazyn · " + (p.symbol || p.tw_id),
        detail: `Kosz ${kosz.kod} rozłożony`,
      });
      d.prepare("UPDATE kosz_pozycja SET mm_queue_id = ? WHERE id = ?").run(queueId, p.id);
    }
    d.prepare("UPDATE kosz SET status='rozlozony', rozlozono_at=?, rozlozono_przez=? WHERE id=?")
      .run(nowIso(), autor, koszId);
    logEvent("kosz_rozlozony", autor, null, {
      koszId,
      kod: kosz.kod,
      pozycji: pozycje.length,
      pominietych: pominiete,
    });
  })();
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
         AND (k.status <> 'rozlozony' OR k.rozlozono_at >= datetime('now', '-30 days'))
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
 */
export function szukajWKoszach(fraza: string): ZnalezionaPozycja[] {
  const q = (fraza ?? "").trim();
  if (q.length < 2) throw new BladKosza(400, "Podaj co najmniej dwa znaki — symbol, nazwę albo kod kreskowy");
  const like = `%${q.toUpperCase()}%`;

  const wiersze = db()
    .prepare(
      `SELECT p.kosz_id, p.symbol, p.nazwa, p.ilosc, p.status, p.lok_faktyczna, p.powod,
              COALESCE(p.odlozono_at, p.pominieto_at) AS kiedy,
              k.kod, k.mm_numer, k.status AS kosz_status
       FROM kosz_pozycja p
       JOIN kosz k ON k.id = p.kosz_id
       LEFT JOIN sgt_towar t ON t.tw_id = p.tw_id
       WHERE UPPER(p.symbol) LIKE @like
          OR UPPER(p.nazwa) LIKE @like
          OR (t.ean <> '' AND t.ean = @dokladnie)
       ORDER BY k.id DESC, p.id
       LIMIT 100`
    )
    .all({ like, dokladnie: q }) as Array<Record<string, unknown>>;

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
