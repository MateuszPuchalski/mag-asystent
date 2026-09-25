import { urlOperacjiPlatnosci, zapytajAllegro } from "../adapters/allegro.http.js";
import { config } from "../config.js";
import { logEvent } from "./events.js";
import type { Db } from "../db/db.js";

/* ── Czy pieniądze naprawdę wróciły do klienta (0.426.0) ─────────────────────
   Zgłoszenie właściciela: „zwroty pokazuje że są do decyzji mimo że w Allegro
   zwrot został już dawno zrobiony". W kolejce stało 934 takich spraw, wszystkie
   sierpniowe i wszystkie po terminie.

   ── DLACZEGO KUBEŁEK NIE MÓGŁ WIEDZIEĆ ────────────────────────────────────
   W całym modelu `CustomerReturn` jedynym polem mówiącym „wypłata poszła" jest
   `status` o wartości `FINISHED` albo `FINISHED_APT`. Sprawdzone w schemacie:
   `CustomerReturn.refund` niesie WYŁĄCZNIE `bankAccount` — ani kwoty, ani daty,
   ani stanu.

   A `status` to PUNKT NA OSI, nie historia. Oś biegnie dalej:

       DELIVERED → FINISHED → COMMISSION_REFUND_CLAIMED → COMMISSION_REFUNDED

   Dwa ostatnie dotyczą NASZEJ PROWIZJI, nie pieniędzy klienta — mówi to wprost
   opis pola w schemacie i potwierdził to właściciel. Kto nie odpytał Allegro
   dokładnie w oknie `FINISHED`, nie dowie się o wypłacie nigdy. Zatrzask
   `rozliczony_allegro_at` z 0.345.0 istnieje właśnie po to, ale zatrzaskuje
   tylko to, co zobaczył.

   Na sierpniową zaległość złożyły się trzy rzeczy naraz: takt co pięć minut,
   NASZ WŁASNY automat rabatów spychający oś z `FINISHED` zaraz po zaciągnięciu
   odstąpienia (0.320.0) i odświeżanie znanych zwrotów, które powstało dopiero
   15 września. Zwroty sprzed tej daty nie wracały na listę ani razu.

   ── FAKT ZAMIAST ULOTNEGO STATUSU ────────────────────────────────────────
   `GET /payments/payment-operations` oddaje historię operacji płatniczych
   sprzedawcy, a `payment.id` jest jej PARAMETREM. Identyfikator płatności
   trzymamy przy zamówieniu od 0.190.0, więc pytanie jest punktowe: „czy na tej
   płatności jest obciążenie zwrotem". Odpowiedź nie wygasa i nie zależy od
   tego, czy ktoś patrzył we właściwej minucie.

   Skan całej historii konta byłby drugą drogą: dziesiątki żądań na takt,
   własny kursor i własna tabela stanu. Pytanie o płatność nie ma stanu wcale —
   a lista pytanych KURCZY SIĘ sama, bo zatrzaśnięty zwrot z niej wypada.    */

/**
 * Typ operacji, który znaczy „pieniądze zeszły do klienta".
 *
 * Grupa `REFUND` niesie sześć typów (`REFUND_CHARGE`, `REFUND_CANCEL`,
 * `REFUND_INCREASE`, `CORRECTION`, `PROVIDER_REFUND_TRANSFER_CHARGE`,
 * `PROVIDER_REFUND_TRANSFER_INCREASE`), a schemat nie opisuje ani jednego
 * z nich zdaniem. Bierzemy więc WYŁĄCZNIE obciążenie — jedyny, którego nazwa
 * nie pozostawia wątpliwości co do kierunku pieniędzy.
 *
 * `[WERYFIKUJ]` na żywym koncie: czy `REFUND_INCREASE` bywa samodzielnym
 * zwrotem, czy zawsze towarzyszy obciążeniu. Do rozstrzygnięcia wolimy nie
 * zatrzasnąć niż zatrzasnąć na wyrost — zwrot niezatrzaśnięty zostaje w pracy,
 * zatrzaśnięty na wyrost znika z niej z pieniędzmi u nas.
 */
export const OBCIAZENIE_ZWROTEM = "REFUND_CHARGE";

/** Operacja, która obciążenie COFA. Nowsza od niego unieważnia dowód. */
export const COFNIECIE_ZWROTU = "REFUND_CANCEL";

type Operacja = { type?: string; occurredAt?: string };
type Odpowiedz = { paymentOperations?: Operacja[] };

/** Obie portmonetki — schemat nie mówi, w której ląduje obciążenie zwrotem. */
const PORTMONETKI = ["AVAILABLE", "WAITING"] as const;

/**
 * Moment wypłaty wyczytany z operacji jednej płatności — albo `null`.
 *
 * NAJNOWSZE OBCIĄŻENIE, a potem sprawdzenie, czy nie zostało cofnięte. Zwrot
 * płatności bywa poprawiany: obciążenie, cofnięcie, obciążenie na inną kwotę.
 * Liczy się stan końcowy, więc porównujemy czasy, a nie kolejność w tablicy —
 * specyfikacja porządku listy nie obiecuje.
 */
export function wyplataZOperacji(operacje: readonly Operacja[]): string | null {
  const zCzasem = operacje.filter(
    (o): o is Operacja & { occurredAt: string } => typeof o?.occurredAt === "string");
  const najnowsze = (typ: string) => zCzasem
    .filter((o) => o.type === typ)
    .map((o) => o.occurredAt)
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? null;

  const obciazenie = najnowsze(OBCIAZENIE_ZWROTEM);
  if (!obciazenie) return null;
  const cofniecie = najnowsze(COFNIECIE_ZWROTU);
  /* Cofnięcie RÓWNOCZESNE z obciążeniem traktujemy jak cofnięcie: przy równym
     czasie nie wiadomo, co było po czym, a niewiedza ma zostawić zwrot w pracy. */
  return cofniecie && cofniecie >= obciazenie ? null : obciazenie;
}

/** Zwrot do sprawdzenia: sam identyfikator płatności jego zamówienia. */
export interface DoSprawdzeniaWyplaty {
  zwrotId: number;
  platnoscId: string;
}

/**
 * Ile płatności odpytujemy w jednym przebiegu.
 *
 * Jedno żądanie na płatność (dwa, gdy pierwsza portmonetka milczy), więc próg
 * jest wprost budżetem takt. Sto na przebieg co pięć minut przerabia sierpniową
 * zaległość w niecałą godzinę, a potem lista kurczy się do zera sama.
 */
export const WYPLATY_NA_PRZEBIEG = 100;

/**
 * Które zwroty warto odpytać o wypłatę.
 *
 * TYLKO TE W PRACY I BEZ ZATRZASKU — odpowiedź dla zwrotu zamkniętego albo już
 * rozliczonego nic by nie zmieniła, a każde żądanie to koszt u Allegro.
 * Zamknięty, który czeka na pieniądze, jest w pracy — powód niżej. Zwrot
 * odrzucony odpada razem z nimi: tam pieniądze nie miały wyjść.
 *
 * NAJDAWNIEJ SPRAWDZANE PIERWSZE, NIE NAJSTARSZE (0.506.1). Do tego wydania
 * lista szła po dacie zgłoszenia, sto na przebieg, bez pamięci, kogo już
 * pytała. Gdy zwrotów bez rozliczenia jest ponad setka, czoło listy zajmują
 * te, które rozliczenia nie dostaną nigdy — nienadane paczki, sprawy
 * zamknięte regułą wieku — a nowszy zwrot nie doczeka się pytania ani razu.
 * Wyszło to przy zwrocie 6016/2026 (wypłata 23 września, panel dalej „do
 * zwrotu"). Teraz nigdy niepytane idą pierwsze, po dacie zgłoszenia, a potem
 * te, o które pytaliśmy najdawniej.
 */
/**
 * Jak długo pytamy o wypłatę zwrotu ZAMKNIĘTEGO korektą (0.505.0). Dłużej niż
 * termin i dzień automatu Allegro, bo pobranie i paczka nieodebrana czekają
 * na pieniądze dłużej (`pieniadzeCzekaja`). Dalej to już historia.
 */
const ZAMKNIETY_PYTAMY_DNI = 60;

export function zwrotyDoSprawdzeniaWyplaty(
  database: Db, konto: number, limit = WYPLATY_NA_PRZEBIEG, teraz = new Date(),
): DoSprawdzeniaWyplaty[] {
  /* ZAMKNIĘTY, A NIEZAPŁACONY TEŻ JEST W PRACY (0.505.0). Od 0.476.0 zwrot
     zamknięty korektą wraca do DO ZWROTU, dopóki pieniądze nie wyjdą — ZW
     automatem zamyka go minutę po kwocie. Ta lista brała jednak tylko
     zwroty BEZ zamknięcia, więc o wypłatę zrobioną ręką w Allegro nie pytała
     nikogo. Zgłoszenie właściciela, zwrot X5XY/2026: „dlaczego pokazuje do
     zwrotu, mimo że pieniądze zostały zwrócone?".

     Warunek to lustro `pieniadzeCzekaja`: przyjęty, z kwotą, bez naszego
     zlecenia, bez zapisanego przelewu i bez odmowy. Reszta zamkniętych to
     historia i nie kosztuje żądania. */
  const wiersze = database.prepare(`
    SELECT z.id AS zwrot_id, m.platnosc_id AS platnosc_id
      FROM zwrot_klienta z
      JOIN zamowienie_klienta m
        ON m.channel_account_id = z.channel_account_id AND m.external_id = z.order_id
     WHERE z.channel_account_id = ?
       AND (z.zamkniety_at IS NULL
            OR (z.werdykt = 'przyjety' AND z.kwota_grosze > 0
                AND z.zwrot_pieniedzy_id IS NULL AND z.zwrot_pieniedzy_command_id IS NULL
                AND z.przelew_at IS NULL AND z.odmowa_kod IS NULL
                AND z.zamkniety_at >= ?))
       AND z.rozliczony_allegro_at IS NULL
       AND (z.werdykt IS NULL OR z.werdykt <> 'odrzucony')
       AND m.platnosc_id IS NOT NULL
     ORDER BY z.wyplata_sprawdzono_at IS NOT NULL, z.wyplata_sprawdzono_at ASC,
              z.created_at ASC, z.id ASC
     LIMIT ?`)
    .all(konto, new Date(teraz.getTime() - ZAMKNIETY_PYTAMY_DNI * 86_400_000).toISOString(),
      Math.max(0, Math.trunc(limit))) as Array<{ zwrot_id: number; platnosc_id: string }>;
  return wiersze.map((w) => ({ zwrotId: Number(w.zwrot_id), platnoscId: String(w.platnosc_id) }));
}

export interface WyplatyDeps {
  query?: (url: string) => Promise<unknown | null>;
  apiUrl?: string;
}

/**
 * Odpytuje Allegro o operacje płatności i zatrzaskuje rozliczenie.
 *
 * DEGRADUJE, NIE PRZERYWA — tak samo jak tracking. Nieudane pytanie o jedną
 * płatność nie ma prawa zabrać pozostałych ani reszty synchronizacji; zwrot
 * poczeka na następny takt, bo fakt o wypłacie nie wygasa.
 *
 * ZAPIS TYLKO GDY PUSTO (`rozliczony_allegro_at IS NULL` w `WHERE`). Zatrzask
 * ma trzymać PIERWSZĄ zobaczoną datę — ta sama zasada co przy `COALESCE`
 * w synchronizacji zwrotów, tylko wyrażona warunkiem, bo tu piszemy wprost.
 *
 * Oddaje liczbę zatrzaśniętych zwrotów.
 */
export async function uzupelnijWyplaty(
  database: Db, zwroty: readonly DoSprawdzeniaWyplaty[], deps: WyplatyDeps = {},
): Promise<number> {
  const query = deps.query ?? zapytajAllegro;
  const apiUrl = deps.apiUrl ?? config.allegro.apiUrl;

  let zatrzasnietych = 0;
  const odnotuj = database.prepare("UPDATE zwrot_klienta SET wyplata_sprawdzono_at=? WHERE id=?");
  for (const z of zwroty) {
    let wyplata: string | null = null;
    let odpowiedziano = false;
    for (const portmonetka of PORTMONETKI) {
      let odp: Odpowiedz | null = null;
      try {
        odp = (await query(urlOperacjiPlatnosci(apiUrl, z.platnoscId, portmonetka))) as
          Odpowiedz | null;
        odpowiedziano = true;
      } catch (e) {
        console.warn(`[wyplaty] płatność ${z.platnoscId} (${portmonetka}):`,
          e instanceof Error ? e.message : e);
        break;
      }
      wyplata = wyplataZOperacji(odp?.paymentOperations ?? []);
      /* Druga portmonetka tylko wtedy, gdy pierwsza nie rozstrzygnęła. Przy
         zaległości, która W WIĘKSZOŚCI jest rozliczona, oszczędza to połowę
         żądań — a przy zwrocie bez wypłaty i tak pytamy obie. */
      if (wyplata) break;
    }
    /* Stempel TYLKO po odpowiedzi Allegro. Nieudane pytanie nie przesuwa
       zwrotu na koniec kolejki — inaczej przerwa po stronie Allegro
       odsuwałaby właśnie te zwroty, o które nie zdążyliśmy zapytać. */
    if (odpowiedziano) odnotuj.run(new Date().toISOString(), z.zwrotId);
    if (!wyplata) continue;

    const r = database.prepare(
      `UPDATE zwrot_klienta SET rozliczony_allegro_at=?
        WHERE id=? AND rozliczony_allegro_at IS NULL`).run(wyplata, z.zwrotId);
    if (Number(r.changes) === 0) continue;
    zatrzasnietych++;
    /* Dziennik dostaje ŹRÓDŁO, nie samą datę. Zwrot zamknięty bez naszej
       korekty wychodzi w rekoncyliacji (`zwrot_rozliczony_bez_korekty`),
       a wtedy pierwsze pytanie brzmi „skąd wiemy, że pieniądze poszły". */
    logEvent("zwrot_wyplata_potwierdzona", "automat (operacje płatnicze)", null,
      { zwrotId: z.zwrotId, wyplataAt: wyplata, zrodlo: "payment-operations" },
      undefined, database);
  }
  return zatrzasnietych;
}
