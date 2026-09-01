import type { DatabaseSync } from "node:sqlite";

/* ── Status rozmowy (0.157.0) ────────────────────────────────────────────────
   Jedno miejsce z regułami przejść. Rozsypane po czterech serwisach
   rozjechałyby się przy pierwszej poprawce jednej z nich, a rozjazd byłby
   niewidoczny: skrzynka po prostu pokazywałaby inną kolejkę niż liczniki.

   AUTOMAT PROWADZI, CZŁOWIEK POPRAWIA. Status wynika z faktów, które i tak
   zapisujemy — przyszła wiadomość, ktoś przejął rozmowę, odpowiedź poszła do
   klienta, zlecono zadanie hali, wrócił wynik. Typowa rozmowa nie wymaga
   ani jednego kliknięcia w status, a to jest kryterium właściciela: minimum
   klikań, maksimum prędkości decyzji.

   CZTERY STATUSY SĄ WYŁĄCZNIE LUDZKIE. Automat nie ma jak wiedzieć, że sprawa
   jest załatwiona, że warto do niej wrócić w czwartek albo że to spam.
   Domyślanie się tego byłoby dokładnie tym gatunkiem zgadywania, po którym
   w 0.140.0 skasowaliśmy cały moduł obsługi klienta.                        */

export const STATUSY = [
  "new", "open", "waiting_for_customer", "waiting_for_internal",
  "snoozed", "resolved", "closed", "spam",
] as const;
export type StatusRozmowy = (typeof STATUSY)[number];

/** Ustawia je wyłącznie człowiek — patrz nagłówek. */
export const LUDZKIE: readonly StatusRozmowy[] = ["snoozed", "resolved", "closed", "spam"];

/** Stany końcowe: praca przy nich się skończyła, dopóki klient nie odpisze. */
export const ZALATWIONE: readonly StatusRozmowy[] = ["resolved", "closed", "spam"];

export function jestStatusem(v: unknown): v is StatusRozmowy {
  return typeof v === "string" && (STATUSY as readonly string[]).includes(v);
}

/**
 * Status, który widzi człowiek.
 *
 * ODŁOŻENIE WYGASA PRZY ODCZYCIE, nie zapisem. Ticker przebudzający rozmowy
 * byłby czwartym tickerem w tym systemie i jedynym, którego całą pracą jest
 * przepisanie kolumny dającej się policzyć. „Zero zapisu przy patrzeniu" to
 * twarda zasada repo — otwarcie skrzynki nie ma prawa niczego mutować.
 *
 * W bazie zostaje więc `snoozed` razem z terminem; do `open` wraca dopiero
 * przy najbliższej mutacji tej rozmowy.
 */
export function statusEfektywny(
  status: string, snoozeDo: string | null, teraz: Date = new Date(),
): StatusRozmowy {
  const s = jestStatusem(status) ? status : "new";
  if (s !== "snoozed") return s;
  if (!snoozeDo) return "open";
  return Date.parse(snoozeDo) > teraz.getTime() ? "snoozed" : "open";
}

/**
 * Status po wiadomości OD KLIENTA. `null` znaczy „nic nie zmieniaj".
 *
 * `spam` jest nietykalny: spamer pisze dalej, a rozmowa wracająca do kolejki
 * przy każdej jego wiadomości czyniłaby oznaczenie bezużytecznym.
 *
 * `waiting_for_internal` też zostaje. Dopisek klienta nie odblokowuje hali —
 * dalej czekamy na pomiar, a to, że przyszło coś nowego, mówi flaga
 * `unread` i sama treść osi. Podmiana statusu na `open` zgubiłaby jedyny
 * ślad tego, że sprawa stoi na kimś u nas.
 */
export function poWiadomosciKlienta(
  obecny: string, maWlasciciela: boolean,
): StatusRozmowy | null {
  const s = jestStatusem(obecny) ? obecny : "new";
  if (s === "spam" || s === "waiting_for_internal") return null;
  const docelowy: StatusRozmowy = maWlasciciela ? "open" : "new";
  return s === docelowy ? null : docelowy;
}

/**
 * Zapisuje status policzony przez automat.
 *
 * NIE PODBIJA `version`. Kolumna wersji pilnuje współbieżnej pracy LUDZI —
 * właściciela, szkicu, wysyłki. Podbicie jej przy wiadomości z synchronizacji
 * dawałoby agentowi 409 „rozmowa się zmieniła" za każdym razem, gdy klient
 * coś dopisał, a od tego jest osobna kontrola świeżości (blizna 0.110.0).
 *
 * NIE RUSZA też `updated_at`: skrzynka pokazuje tę kolumnę jako moment
 * ostatniej wiadomości (`LISTA` w `services/skrzynka.ts`), więc zapis statusu
 * przestawiłby datę na liście, choć nikt nic nie napisał.
 */
export function zapiszStatusAutomatu(
  database: DatabaseSync, conversationId: number, status: StatusRozmowy,
): void {
  database.prepare("UPDATE conversation SET status=?, snooze_do=NULL WHERE id=?")
    .run(status, conversationId);
}

/**
 * Przelicza status po wiadomości od klienta i zostawia ślad po powrocie.
 *
 * Wołane WYŁĄCZNIE dla nowego wiersza wiadomości przychodzącej — `zapiszWiadomosc`
 * ma `ON CONFLICT … DO NOTHING` i oddaje `null`, gdy wiadomość już była
 * (blizna 0.128.0). Bez tego warunku ponowna synchronizacja tej samej
 * wiadomości otwierałaby zamknięte rozmowy w kółko.
 *
 * `reopened_by_customer` idzie do `conversation_event`, a nie do nowej kolumny:
 * to jest FAKT z osi, tak jak ręczne wskazanie oferty i wynik z hali. Ekran
 * liczy z niego znacznik „wróciła po zamknięciu" przy odczycie.
 */
export function statusPoWiadomosciKlienta(
  database: DatabaseSync, conversationId: number,
): void {
  const c = database.prepare(
    "SELECT status, assigned_user_id FROM conversation WHERE id=?",
  ).get(conversationId) as { status: string; assigned_user_id: number | null } | undefined;
  if (!c) return;

  const nowy = poWiadomosciKlienta(c.status, c.assigned_user_id !== null);
  if (!nowy) return;

  if ((ZALATWIONE as readonly string[]).includes(c.status)) {
    database.prepare(`INSERT INTO conversation_event(conversation_id, message_id, event_type, payload)
      VALUES (?, NULL, 'reopened_by_customer', json_object('zStatusu', ?))`)
      .run(conversationId, c.status);
  }
  zapiszStatusAutomatu(database, conversationId, nowy);
}
