import { db, transaction } from "../db/db.js";
import { config } from "../config.js";
import { subiekt } from "../context.js";
import { enqueueMM, enqueueSetLocation } from "./queue.js";
import { dostepneW } from "./stock.js";
import { listaMagazynow } from "./magazyny.js";
import { parseLocs } from "../locs.js";
import { logEvent } from "./events.js";
import { putawayLine, validateDeliveryLocation } from "./delivery.js";

/* ── Przesunięcie stanu między magazynami (0.22.0) ───────────────────────────
   Do 0.22.0 dokument MM umiał powstać w JEDNYM miejscu: przy zatwierdzeniu
   wózka w sesji kontenerowej. Cała machineria trybu B — dwie tabele, dziesięć
   funkcji, osiem tras — istniała dla procesu zdarzającego się cztery razy
   w roku, a najzwyklejsze pytanie „towar leży na MGP, jak go przenieść na
   halę" nie miało odpowiedzi w ogóle.

   Teraz jest jedna czynność: przesuń tyle a tyle sztuk z magazynu do magazynu.
   Kontener rozkłada się tak jak każda inna dostawa, a przesunięcie stanu jest
   od niego niezależne.                                                       */

export interface PrzesuniecieInput {
  twId: number;
  qty: number;
  magFrom: number;
  magTo: number;
  /** Kod półki. Wymagany, gdy cel to MAG — i zabroniony, gdy nie jest. */
  location?: string | null;
  /** Pozycja dostawy, gdy przesunięcie wyszło ze skrótu na liście (opcjonalne). */
  lineId?: number | null;
}

export interface PrzesuniecieWynik {
  ok: true;
  queueIds: number[];
  /** Ile było dostępne przed tym przesunięciem — do audytu, patrz `logEvent`. */
  dostepnePrzed: number;
}

type Odmowa = { error: string; status?: number };

/**
 * Przesunięcie stanu.
 *
 * Walidacje idą w kolejności, w jakiej człowiek popełnia błędy — pierwszy
 * komunikat jest tym, który zobaczy. Serwer sprawdza WSZYSTKO, także to, czego
 * pilnuje już ekran: reguły kolektora są uprzejmością wobec człowieka
 * w alejce, a nie bramką. Stary APK albo `curl` z sieci hali trafia tutaj.
 */
export function przesunStan(
  input: PrzesuniecieInput,
  user: string
): PrzesuniecieWynik | Odmowa {
  const towar = subiekt.getProductById(input.twId);
  if (!towar) return { error: "Nieznany towar" };

  const magazyny = listaMagazynow();
  const zrodlo = magazyny.find((m) => m.magId === input.magFrom);
  const cel = magazyny.find((m) => m.magId === input.magTo);
  if (!zrodlo) return { error: `Nie znam magazynu o id ${input.magFrom}` };
  if (!cel) return { error: `Nie znam magazynu o id ${input.magTo}` };
  if (input.magFrom === input.magTo) {
    return { error: "Magazyn źródłowy i docelowy to ten sam magazyn" };
  }
  /* Ukryte odrzuca SERWER, nie ekran. Widoczność jest ustawieniem globalnym
     (patrz `magazyny.ts`), więc filtr po stronie kolektora znaczyłby, że jedna
     osoba może przesunąć tam, gdzie druga nawet nie widzi magazynu. */
  if (zrodlo.ukryty) return { error: `Magazyn ${zrodlo.kod} jest ukryty w ustawieniach` };
  if (cel.ukryty) return { error: `Magazyn ${cel.kod} jest ukryty w ustawieniach` };

  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { error: "Ilość musi być większa od zera" };
  }
  const dostepnePrzed = dostepneW(input.magFrom, input.twId);
  if (input.qty > dostepnePrzed) {
    return {
      error: `Na ${zrodlo.kod} dostępne tylko ${dostepnePrzed} szt`,
      status: 409,
    };
  }

  const naHale = input.magTo === config.magId.MAG;
  const kod = input.location?.trim().toUpperCase() || null;
  /* Adres w kartotece Subiekta to JEDNO pole na towar, bez wymiaru magazynu —
     opisuje regał na hali. Stąd oba warunki:

     cel MAG  → skan obowiązkowy, bo jest jedynym dowodem, że towar trafił tam,
                gdzie system myśli (ta sama reguła co D3 przy rozkładaniu),
     cel inny → kod ZABRONIONY, bo zapisany nadpisałby adres hali adresem,
                którego na hali nie ma. Kompletujący dostałby wtedy zlecenie na
                pustą półkę — ta sama szkoda, przed którą chroni niezmiennik
                niżej, tylko wyrządzona z drugiej strony. */
  if (naHale && !kod) return { error: "Zeskanuj półkę, na którą kładziesz towar" };
  if (!naHale && kod) {
    return { error: `Adres dotyczy hali — przy przesunięciu na ${cel.kod} nie ma czego zapisać` };
  }
  if (kod) {
    const locErr = validateDeliveryLocation(kod);
    if (locErr) return { error: locErr };
  }

  const queueIds: number[] = [];
  const tx = transaction(db(), () => {
    /* NAJPIERW ADRES, DOPIERO POTEM STAN — niezmiennik przeniesiony wprost
       z rundy wózka, którą ta funkcja zastąpiła.

       Worker bierze zadania po `id` rosnąco, więc kolejność wstawienia JEST
       kolejnością wykonania. MM czyni towar dostępnym do sprzedaży
       i kompletacji; zakolejkowane przed `set_location` dawałoby okno, w którym
       towar jest już sprzedawalny, a jego adres w kartotece stary albo pusty —
       a przy nieudanym zapisie lokalizacji stan ten byłby TRWAŁY.

       Po tej kolejności najgorszy możliwy stan odwraca się na bezpieczną
       stronę: towar leży na półce z poprawnym adresem, ale jeszcze nie jest
       sprzedawalny, i naprawia się sam po PONÓW. */
    if (input.lineId) {
      // skrót z listy dostawy: odłożenie linii robi dokładnie to samo co
      // zwykłe rozkładanie, więc wołamy je, zamiast pisać drugą kopię
      const r = putawayLine(input.lineId, kod!, user, { qty: input.qty });
      if ("error" in r) throw new Error(r.error);
      if (r.queueId) queueIds.push(r.queueId);
    } else if (kod) {
      const biezace = parseLocs(towar.lokalizacja);
      // skan jest DOWODEM, nie wyzwalaczem zapisu: kod, który towar już ma,
      // nie potrzebuje zadania do Subiekta
      if (biezace[0] !== kod) {
        const nowe = Array.from(new Set([kod, ...biezace.slice(1)]));
        queueIds.push(
          enqueueSetLocation(
            input.twId,
            nowe.join(" ").slice(0, config.locFieldLimit),
            {
              createdBy: user,
              twId: input.twId,
              label: "Lokalizacja · " + towar.symbol,
              detail: `${kod} (przesunięcie)`,
            },
            { locsPrzed: towar.lokalizacja ?? "", zrodlo: "przesuniecie" }
          )
        );
      }
    }

    queueIds.push(
      enqueueMM(input.magFrom, input.magTo, [{ twId: input.twId, qty: input.qty }], {
        createdBy: user,
        twId: input.twId,
        /* Dokument podajemy TYLKO przy skrócie z dostawy — i to nie jest
           ozdoba. `czekaNaDokument` wstrzymuje MM, dopóki dokument źródłowy
           siedzi w buforze Subiekta. Adres nie czeka na bufor (D1), stan
           czeka: przesunięcie na nieksięgowanym dokumencie nie ma prawa
           wejść. */
        sourceDocId: input.lineId ? dokumentLinii(input.lineId) : null,
        label: `Przesunięcie · ${towar.symbol}`,
        detail: `${input.qty} szt ${zrodlo.kod}→${cel.kod}`,
      })
    );
  });
  try {
    tx();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Nie udało się przesunąć" };
  }

  logEvent("przesuniecie", user, input.twId, {
    magFrom: input.magFrom,
    magTo: input.magTo,
    kodFrom: zrodlo.kod,
    kodTo: cel.kod,
    qty: input.qty,
    // ile było dostępne PRZED zapisem — jeden wiersz ma wystarczyć do
    // odpowiedzi na reklamację, bez odtwarzania całej sekwencji
    dostepnePrzed,
    location: kod,
    lineId: input.lineId ?? null,
    queueIds,
  });
  return { ok: true, queueIds, dostepnePrzed };
}

/** Numer dokumentu SGT, z którego pochodzi linia dostawy (dla `waiting_for_doc`). */
function dokumentLinii(lineId: number): number | null {
  const r = db()
    .prepare(
      `SELECT d.sgt_dok_id AS dok FROM delivery_line l
       JOIN delivery d ON d.id = l.delivery_id
       WHERE l.id = ?`
    )
    .get(lineId) as { dok: number } | undefined;
  return r?.dok ?? null;
}
