import { db } from "../db/db.js";
import { config } from "../config.js";
import { koszykiCzekajaceNaKorekty } from "./kosze-zwrotow.js";
import { listaZwrotow } from "./zwroty.js";
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
    | "zwrot_po_terminie";
  klucz: string;
  opis: string;
  odKiedy: string | null;
}

export interface Rekoncyliacja {
  at: string;
  sprawdzono: { kartotek: number; zadan: number };
  rozjazdy: Rozjazd[];
}

/** 1. Adres w Subiekcie vs ostatni udany zapis aplikacji (24 h). */
function lokalizacje(): { rozjazdy: Rozjazd[]; sprawdzono: number } {
  const zadania = db()
    .prepare(
      `SELECT tw_id, payload, MAX(processed_at) AS at FROM sfera_queue
       WHERE type='set_location' AND status='done' AND tw_id IS NOT NULL
         AND processed_at >= datetime('now','-1 day')
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
       WHERE status='error' AND processed_at < datetime('now','-1 day')
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
       WHERE status='waiting_for_doc' AND created_at < datetime('now','-3 days')
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
 * Kosze z dokumentu MM z Subiekta tu NIE wchodzą — tam dokument powrotny jest
 * robotą biura z założenia (DEPLOY §6a) i alarm uczyłby przewijać raport. Tak
 * samo kosze rozłożone przed 0.266.0: rozliczyło je biuro ręką, więc raport
 * wypisywałby historię jako pracę do zrobienia (`powrot_poza_aplikacja`).
 */
function koszeBezPowrotu(): Rozjazd[] {
  const rows = db()
    .prepare(
      `SELECT kod, rozlozono_at FROM kosz
        WHERE status='rozlozony' AND powrot_queue_id IS NULL AND mm_dok_id IS NULL
          AND powrot_poza_aplikacja = 0
          AND rodzaj NOT IN ('karton','odpad')
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
    .filter((z) => z.dniDoTerminu <= 1)
    .map((z) => ({
      rodzaj: "zwrot_po_terminie" as const,
      klucz: z.numer ?? z.externalId,
      opis: z.dniDoTerminu < 0
        ? `Zwrot ${z.numer ?? z.externalId} jest ${-z.dniDoTerminu} dni PO terminie ` +
          `ustawowym, w kubełku ${z.kubelek}.`
        : `Zwrot ${z.numer ?? z.externalId} ma termin ustawowy za ${z.dniDoTerminu} ` +
          `dni, a stoi w kubełku ${z.kubelek}.`,
      odKiedy: z.terminAt,
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
  return {
    at: new Date().toISOString(),
    sprawdzono: {
      kartotek: loc.sprawdzono,
      zadan: bledy.length + bufor.length + mm.length + kosze.length + powroty.length
        + przelewy.length + terminy.length,
    },
    /* Terminy PIERWSZE: mają skutek prawny, a raport czyta się od góry. */
    /* Terminy PIERWSZE (skutek prawny), zaraz za nimi pieniądze klienta. */
    rozjazdy: [...terminy, ...przelewy, ...loc.rozjazdy, ...bledy, ...bufor, ...mm,
      ...kosze, ...powroty],
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
