import fs from "node:fs";
import path from "node:path";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { koszykiCzekajaceNaKorekty } from "./kosze-zwrotow.js";
import { listaZwrotow } from "./zwroty.js";
import { STATUSY_ODDANE } from "./zwrot-pieniedzy.js";
import { subiekt } from "../context.js";
import { parseLocs } from "../locs.js";
import { wierszCsv, zbudujCsv } from "./csv.js";

/* ── Nocna rekoncyliacja (plan §9) ──────────────────────────────────────────
   Aplikacja pisze do SGT przez kolejkę, ale NIKT nie sprawdzał, czy stan po
   stronie Subiekta odpowiada temu, co aplikacja myśli, że zapisała.

   To jest tania obrona przed cichym błędem: kod się kompiluje, działa, wygląda
   dobrze i przez trzy tygodnie rozjeżdża dane. Wszystkie cztery kontrole
   pytają o to samo — czy deklarowany niezmiennik jeszcze obowiązuje. Bo
   niezmienniki trzeba MIERZYĆ, nie deklarować.

   Zerowy wynik = zero raportu. Raport, który przychodzi codziennie, przestaje
   być czytany po tygodniu — a wtedy nie chroni już przed niczym.             */

export interface Rozjazd {
  rodzaj: "lokalizacja" | "zadanie_w_bledzie" | "utknelo_w_buforze" | "mm_czeka"
    | "kosz_czeka_na_korekte" | "kosz_bez_powrotu" | "zwrot_bez_przelewu"
    | "zwrot_po_terminie" | "zwrot_rozliczony_bez_korekty";
  klucz: string;
  opis: string;
  odKiedy: string | null;
}

export interface Rekoncyliacja {
  at: string;
  sprawdzono: { kartotek: number; zadan: number };
  rozjazdy: Rozjazd[];
}

/* Granice w tym pliku piszemy `strftime(…'Z'…)`, nie `datetime()`: znaczniki
   kolejki mają `T`, a `datetime()` spację, więc `<` gubiło dobę graniczną.
   Powód przy `GRANICA_OKNA` w `raporty.ts` (0.494.1). */

/** 1. Adres w Subiekcie vs ostatni udany zapis aplikacji (24 h). */
function lokalizacje(): { rozjazdy: Rozjazd[]; sprawdzono: number } {
  const zadania = db()
    .prepare(
      `SELECT tw_id, payload, MAX(processed_at) AS at FROM sfera_queue
       WHERE type='set_location' AND status='done' AND tw_id IS NOT NULL
         AND processed_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
       GROUP BY tw_id`
    )
    .all() as Array<{ tw_id: number; payload: string; at: string }>;

  const rozjazdy: Rozjazd[] = [];
  for (const z of zadania) {
    let oczekiwane: string[];
    try {
      oczekiwane = parseLocs((JSON.parse(z.payload) as { newValue?: string }).newValue ?? "");
    } catch {
      continue;
    }
    const t = subiekt.getProductById(z.tw_id);
    if (!t) continue;
    const rzeczywiste = parseLocs(t.lokalizacja);
    // porównanie po ZBIORZE kodów, nie po całym polu: kolejność ma znaczenie
    // tylko dla pierwszego (pickingowego), a jego pilnuje osobno tryb A
    const rowne =
      oczekiwane.length === rzeczywiste.length &&
      oczekiwane.every((c) => rzeczywiste.includes(c));
    if (!rowne) {
      rozjazdy.push({
        rodzaj: "lokalizacja",
        klucz: t.symbol,
        opis: `aplikacja zapisała „${oczekiwane.join(" ") || "(puste)"}”, w Subiekcie „${
          rzeczywiste.join(" ") || "(puste)"
        }”`,
        odKiedy: z.at,
      });
    }
  }
  return { rozjazdy, sprawdzono: zadania.length };
}

/** 2. Zadania w `error` starsze niż 24 h — nikt ich nie ponowił. */
function zadaniaWBledzie(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT id, type, label, error_msg, processed_at FROM sfera_queue
       WHERE status='error' AND processed_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
       ORDER BY id`
    )
    .all() as Array<{
    id: number;
    type: string;
    label: string;
    error_msg: string | null;
    processed_at: string;
  }>;
  return rows.map((r) => ({
    rodzaj: "zadanie_w_bledzie" as const,
    klucz: `#${r.id} ${r.type}`,
    opis: `${r.label} — ${r.error_msg ?? "bez komunikatu"}`,
    odKiedy: r.processed_at,
  }));
}

/** 3. `waiting_for_doc` starsze niż 72 h — dokument raczej nie wyjdzie z bufora. */
function utknieteWBuforze(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT id, label, source_doc_id, created_at FROM sfera_queue
       WHERE status='waiting_for_doc' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
       ORDER BY id`
    )
    .all() as Array<{ id: number; label: string; source_doc_id: number | null; created_at: string }>;
  return rows.map((r) => ({
    rodzaj: "utknelo_w_buforze" as const,
    klucz: `#${r.id}`,
    opis: `${r.label} — dokument ${r.source_doc_id ?? "?"} nie wyszedł z bufora od 3 dni; ktoś musi spojrzeć`,
    odKiedy: r.created_at,
  }));
}

/**
 * 4. MM czekające ponad dobę — worker Sfery nie działa albo zadanie blokuje
 *    guard kolejności (zapis lokalizacji tego samego towaru w błędzie).
 *
 * Ten wpis domyka decyzję z guardu w `sfera-worker/sql/`: poprzednik
 * `set_location` w `error` BLOKUJE MM w nieskończoność — świadomie, bo stan
 * bezpieczny to „adres zapisany, stan czeka". Blokada bez tego pomiaru byłaby
 * jednak cichym zakleszczeniem; tu dostaje nazwisko i instrukcję.
 */
function mmCzekajace(): Rozjazd[] {
  /* Tylko przy SFERA_WORKER=1 — bez przełącznika mm wykonuje (albo ubija
     czytelnym błędem) worker Node, więc wiszący pending znaczy „zatrzymany
     worker", a to melduje już /api/health. Zdanie o Sferze by tu myliło. */
  if (!config.sferaWorker) return [];
  /* strftime w formacie ISO, nie datetime(): created_at ma `T…Z`, datetime()
     spację — leksykalnie kłamią w obrębie tego samego dnia (patrz zaleglosciMm). */
  const rows = db()
    .prepare(
      `SELECT id, label, created_at FROM sfera_queue
       WHERE type='mm' AND status IN ('pending','waiting_for_doc')
         AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
       ORDER BY id`
    )
    .all() as Array<{ id: number; label: string; created_at: string }>;
  return rows.map((r) => ({
    rodzaj: "mm_czeka" as const,
    klucz: `#${r.id}`,
    opis:
      `${r.label} — MM czeka ponad dobę: worker Sfery nie działa albo zadanie ` +
      "blokuje błąd zapisu lokalizacji (PONÓW lokalizację na kolektorze)",
    odKiedy: r.created_at,
  }));
}

/**
 * 5. Koszyki zwrotów zamknięte ponad dobę temu, którym wciąż brakuje korekty.
 *
 * Od 0.200.0 MM koszyka czeka na komplet numerów korekt — bo zdejmuje towar
 * z magazynu głównego, a ten wraca tam dopiero po korekcie. Czekanie jest
 * więc POPRAWNE, ale bezterminowe czekanie jest cichym zakleszczeniem: kosz
 * stoi na hali, magazynier nie ma czego rozłożyć, a nikt nie pyta dlaczego.
 *
 * Próg doby jest ten sam co przy `mm_czeka` — dwa progi to dwa nawyki.
 */
function koszeBezKorekty(): Rozjazd[] {
  return koszykiCzekajaceNaKorekty(db())
    .filter((k) => k.zamknietoAt < new Date(Date.now() - 86400_000).toISOString())
    .map((k) => ({
      rodzaj: "kosz_czeka_na_korekte" as const,
      klucz: k.kod,
      opis:
        `Koszyk ${k.kod} czeka ponad dobę na korekty — bez nich MM zdjęłoby towar ` +
        `z magazynu głównego, na który jeszcze nie wrócił. Brakuje: ` +
        k.brakuje.map((b) => b.numer).join(", "),
      odKiedy: k.zamknietoAt,
    }));
}

/**
 * 6. Kosze rozłożone ponad dobę temu, którym nie wyszedł powrót z bufora.
 *
 * Towar leży wtedy na półce w hali, a stan wisi na regale zwrotów — czyli
 * nie jest sprzedawalny, choć fizycznie jest na miejscu. Do 0.264.0 ten stan
 * nie miał ani automatu, ani alarmu: dokument powrotny wystawiało biuro ręką
 * w Subiekcie i nikt nie liczył, ile razy o nim zapomniano.
 *
 * Od 0.266.0 dokument zamawia aplikacja, ale czeka na zapisanie adresów —
 * i to czekanie może stanąć, gdy zadanie adresu wisi w błędzie. Ten wiersz
 * jest właśnie o tym: warunek, który miał trwać sekundy, trwa dobę.
 *
 * Od 0.277.0 wchodzą tu TAKŻE kosze z dokumentu MM: dokument powrotny przestał
 * być robotą biura, więc jego brak przestał być stanem normalnym. Kosz, którego
 * kierunku aplikacja nie zna (dokument poza oknem importu), zgłasza się tym
 * samym wierszem i to jest jedyne miejsce, w którym biuro się o nim dowie.
 *
 * Nie wchodzą kosze rozłożone przed tymi wydaniami: rozliczyło je biuro ręką,
 * więc raport wypisywałby historię jako pracę (`powrot_poza_aplikacja`).
 *
 * Nie wchodzi też kosz z aplikacji, którego MM NA regał jeszcze nie weszło.
 * Jego powrót czeka wtedy świadomie (`zakolejkujPowrot`), a przyczynę mówi
 * inny wiersz: brak korekty albo MM w kolejce lub w błędzie. Zdanie „sprawdź
 * adresy" kazałoby szukać nie tam.
 */
function koszeBezPowrotu(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT kod, rozlozono_at FROM kosz
        WHERE status='rozlozony' AND powrot_queue_id IS NULL
          AND powrot_poza_aplikacja = 0
          AND rodzaj NOT IN ('karton','odpad')
          AND (mm_dok_id IS NOT NULL
               OR mm_queue_id IN (SELECT id FROM sfera_queue WHERE status='done'))
          AND rozlozono_at < ?
          AND EXISTS (SELECT 1 FROM kosz_pozycja p
                       WHERE p.kosz_id = kosz.id AND p.status='done')
        ORDER BY rozlozono_at`
    )
    .all(new Date(Date.now() - 86400_000).toISOString()) as
    Array<{ kod: string; rozlozono_at: string }>;
  return rows.map((k) => ({
    rodzaj: "kosz_bez_powrotu" as const,
    klucz: k.kod,
    opis:
      `Kosz ${k.kod} rozłożono ponad dobę temu, a stan wisi na regale zwrotów — ` +
      "towar leży na półce i nie jest sprzedawalny. Sprawdź zadania adresów w błędzie.",
    odKiedy: k.rozlozono_at,
  }));
}

/**
 * 7. Zwroty za pobraniem, przy których nie ma śladu po przelewie.
 *
 * Allegro tych pieniędzy nigdy nie trzymało, więc przycisk ODDAJ PIENIĄDZE
 * jest tam zamknięty z definicji — wypłata idzie przelewem z banku firmy.
 * Do 0.268.0 aplikacja nie miała gdzie tego zapisać, a zwrot zamykał się
 * korektą i schodził z kolejki: klient bez pieniędzy wyglądał wtedy dokładnie
 * jak klient rozliczony.
 *
 * Sygnał `przelew_czeka` mówi to na ekranie, ale ekran trzeba otworzyć — ten
 * wiersz mówi to raportowi, który biuro czyta rano. Próg doby jest ten sam co
 * przy pozostałych kontrolach; przelew zlecony wczoraj nie jest zaległością.
 */
function zwrotyBezPrzelewu(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT z.reference_number AS numer, z.external_id, z.kwota_at, z.kwota_grosze
         FROM zwrot_klienta z
         JOIN zamowienie_klienta o ON o.external_id = z.order_id
          AND o.channel_account_id = z.channel_account_id
        WHERE o.platnosc_typ = 'CASH_ON_DELIVERY'
          AND z.werdykt = 'przyjety' AND z.kwota_grosze IS NOT NULL
          AND z.kwota_grosze > 0
          AND z.przelew_at IS NULL AND z.zwrot_pieniedzy_id IS NULL
          AND z.odmowa_kod IS NULL
          AND z.kwota_at < ?
        ORDER BY z.kwota_at`
    )
    .all(new Date(Date.now() - 86400_000).toISOString()) as
    Array<{ numer: string | null; external_id: string; kwota_at: string; kwota_grosze: number }>;
  return rows.map((z) => ({
    rodzaj: "zwrot_bez_przelewu" as const,
    klucz: z.numer ?? z.external_id,
    opis:
      `Zwrot ${z.numer ?? z.external_id} za pobraniem czeka na przelew ` +
      `(${(z.kwota_grosze / 100).toFixed(2)} zł) — Allegro tych pieniędzy nie odda za nas.`,
    odKiedy: z.kwota_at,
  }));
}

/**
 * 8. Zwroty w pracy, którym termin ustawowy minął albo mija w ciągu doby.
 *
 * DO 0.210.0 TERMINU PILNOWAŁ WYŁĄCZNIE KOLOR WIERSZA. Sygnał „termin" zapala
 * się przy trzech dniach, ale zapala się NA EKRANIE — a rekoncyliacja
 * i `/api/health` nie znały zwrotów w ogóle. Czternaście dni ustawowych mijało
 * bez jednego alarmu, jeśli przez tydzień nikt nie otworzył panelu.
 *
 * To jedyna kontrola w tym pliku o skutku PRAWNYM, nie operacyjnym: po
 * terminie kupującemu należą się odsetki, a sprzedawca traci argument
 * w sporze. Dlatego próg jest ostrzejszy niż dobowe progi wyżej — doba przed
 * terminem to ostatni moment, w którym da się zdążyć.
 *
 * Stany końcowe pomija `kubelekZwrotu`: zwrot zamknięty i odrzucony nie mają
 * już terminu do pilnowania, a czerwień na nich uczyłaby przewijać raport.
 */
function zwrotyPoTerminie(): Rozjazd[] {
  return listaZwrotow(db())
    .filter((z) => z.kubelek !== "zamkniety" && z.kubelek !== "odrzucony")
    /* Bez terminu nie ma czego pilnować (0.339.0): paczka jeszcze nie wróciła,
       więc zegar obsługi nie ruszył. Dopisanie ich do raportu kazałoby gonić
       pracę, której nie da się wykonać. */
    .filter((z): z is typeof z & { dniDoTerminu: number } => z.dniDoTerminu !== null)
    .filter((z) => z.dniDoTerminu <= 1)
    .map((z) => ({
      rodzaj: "zwrot_po_terminie" as const,
      klucz: z.numer ?? z.externalId,
      /* TERMIN OBSŁUGI, nie ustawowy (0.339.0) — siedem dni od doręczenia
         paczki, regulamin Allegro. Zdanie mówi to wprost, bo raport czyta
         człowiek, który zna oba zegary i musi wiedzieć, o którym mowa. */
      opis: z.dniDoTerminu < 0
        ? `Zwrot ${z.numer ?? z.externalId} jest ${-z.dniDoTerminu} dni PO terminie ` +
          `obsługi, w kubełku ${z.kubelek}.`
        : `Zwrot ${z.numer ?? z.externalId} ma termin obsługi za ${z.dniDoTerminu} ` +
          `dni, a stoi w kubełku ${z.kubelek}.`,
      odKiedy: z.terminAt,
    }));
}

/**
 * Zwrot rozliczony przez Allegro, po którym została NASZA robota (0.339.0).
 *
 * Od tego wydania status `FINISHED` zdejmuje zwrot z kolejki pracy — decyzja
 * właściciela po zgłoszeniu „pokazuje zwroty, za które pieniądze zostały już
 * zwrócone". Cena tej decyzji jest jednak realna i nie wolno jej zapłacić
 * w ciszy: pieniądze wróciły do klienta, ale korekta w Subiekcie i towar na
 * półce to osobna robota, a zwrot właśnie przestał o nią prosić.
 *
 * Bez korekty NIE WYJDZIE TEŻ MM (bramka 0.200.0), więc koszyk z tym zwrotem
 * stanąłby w miejscu na zawsze — i to jest drugi powód, dla którego ta
 * kontrola istnieje. Raport jest tu jedynym miejscem, w którym taki zwrot
 * jeszcze się odezwie.
 *
 * Odrzuconych NIE liczymy: przy odmowie nie ma czego korygować.
 */
function zwrotyRozliczoneBezKorekty(): Rozjazd[] {
  return listaZwrotow(db())
    /* ZATRZASK, nie wskaźnik „teraz" (0.345.0) — ten sam powód co przy
       kubełku: zwrot rozliczony idzie dalej osią czasu Allegro. */
    .filter((z) => z.rozliczonyAllegroAt
      || STATUSY_ODDANE.has(String(z.statusAllegro ?? "")))
    /* TYLKO OD PROGU (0.340.0). Historia firmy niesie setki zwrotów
       rozliczonych w panelu Allegro, których korekt nikt już wstecz nie
       wystawi — raport o nich uczyłby przewijać raport. Próg stoi
       w `ZWROT_ROZLICZONE_OD` i domyślnie jest dniem wdrożenia 0.340.0.
       Pusty próg (`ZWROT_ROZLICZONE_OD=`) znaczy „wołaj o wszystkie" — tak
       samo jak przy pozostałych progach dat w konfiguracji. */
    .filter((z) => {
      const od = config.allegro.zwrotyRozliczoneOd;
      return od === null || z.utworzono >= od;
    })
    .filter((z) => !z.rejectionCode && z.werdykt !== "odrzucony")
    .map((z) => ({
      z,
      /* DWA BRAKI, JEDEN WIERSZ. Osobne rozjazdy na ten sam zwrot kazałyby
         otwierać go dwa razy, a robi się je za jednym podejściem. */
      braki: [
        z.korektaNumer ? null : "brak numeru korekty",
        z.pozycje.some((p) => !p.ocena) ? "pozycje bez oceny" : null,
      ].filter((x): x is string => x !== null),
    }))
    .filter((x) => x.braki.length > 0)
    .map(({ z, braki }) => ({
      rodzaj: "zwrot_rozliczony_bez_korekty" as const,
      klucz: z.numer ?? z.externalId,
      /* NUMER W ZDANIU, jak w kontrolach wyżej: raport czyta się jako listę
         zdań, a nie jako tabelę z kluczem obok. */
      /* Źródło wypłaty w nawiasie (0.493.0): zatrzask z operacji płatności
         przychodzi bez statusu zwrotu i zdanie mówiło wtedy „(null)". */
      opis: `Zwrot ${z.numer ?? z.externalId}: Allegro oddało pieniądze ` +
        `(${z.statusAllegro ?? "operacje płatności"}), a u nas został${braki.length > 1 ? "y" : ""}: ` +
        `${braki.join(" i ")}.`,
      odKiedy: z.utworzono,
    }));
}

export function reconcile(): Rekoncyliacja {
  const loc = lokalizacje();
  const bledy = zadaniaWBledzie();
  const bufor = utknieteWBuforze();
  const mm = mmCzekajace();
  const kosze = koszeBezKorekty();
  const powroty = koszeBezPowrotu();
  const przelewy = zwrotyBezPrzelewu();
  const terminy = zwrotyPoTerminie();
  const rozliczone = zwrotyRozliczoneBezKorekty();
  return {
    at: new Date().toISOString(),
    sprawdzono: {
      kartotek: loc.sprawdzono,
      zadan: bledy.length + bufor.length + mm.length + kosze.length + powroty.length
        + przelewy.length + terminy.length + rozliczone.length,
    },
    /* Terminy PIERWSZE: mają skutek prawny, a raport czyta się od góry. */
    /* Terminy PIERWSZE (skutek prawny), zaraz za nimi pieniądze klienta. */
    rozjazdy: [...terminy, ...przelewy, ...rozliczone, ...loc.rozjazdy, ...bledy,
      ...bufor, ...mm, ...kosze, ...powroty],
  };
}

/** CSV jak eksport wyjątków: `;` + BOM, żeby Excel PL otworzył bez kreatora. */
export function reconcileCsv(r: Rekoncyliacja): string {
  const linie = [
    ["rodzaj", "klucz", "opis", "od_kiedy"].join(";"),
    ...r.rozjazdy.map((x) => wierszCsv([x.rodzaj, x.klucz, x.opis, x.odKiedy ?? ""], ";")),
  ];
  return zbudujCsv(linie);
}

/**
 * Raport rozjazdów do `reconcile/<data>.csv` obok bazy; `null` przy zerze.
 *
 * Wspólne dla `npm run reconcile` i nocnego przebiegu serwera (0.487.0).
 * Dwie kopie tego kodu pisałyby raport w dwa różne miejsca przy pierwszej
 * zmianie, a człowiek szuka go w jednym.
 */
export function zapiszRaportRekoncyliacji(r: Rekoncyliacja): string | null {
  if (r.rozjazdy.length === 0) return null;
  const dir = path.join(path.dirname(config.dbPath), "reconcile");
  fs.mkdirSync(dir, { recursive: true });
  const plik = path.join(dir, `${r.at.slice(0, 10)}.csv`);
  fs.writeFileSync(plik, reconcileCsv(r), "utf8");
  return plik;
}
