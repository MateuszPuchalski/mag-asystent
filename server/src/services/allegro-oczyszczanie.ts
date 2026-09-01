/* ── Czyszczenie surowych odpowiedzi Allegro (0.152.0) ───────────────────────
   Lądowiska `allegro_zwrot` i `allegro_zamowienie` trzymają odpowiedź
   w kształcie, w jakim przyszła — po to, żeby przy sporze o kształt było co
   obejrzeć. Do 0.151.0 trzymały ją DOSŁOWNIE, razem z numerem konta
   bankowego kupującego i telefonem nadawcy paczki. Rozdział „Polityka danych
   zwrotów" mówił tymczasem „nie pobieramy" i to zdanie było nieprawdziwe.

   To ta sama pomyłka co w 0.143.0, gdzie szkic polityki twierdził, że treści
   rozmów nie trafiają do bazy. Wtedy poprawiliśmy zdanie, bo kopia treści
   była ceną za działający ekran. Tu jest odwrotnie: konto bankowe nie kupuje
   nam niczego, więc poprawiamy KOD.

   WARTOŚĆ ZNIKA, KLUCZ ZOSTAJE. Kasowanie całej gałęzi zabrałoby lądowisku
   to, po co istnieje — wiedzę, że pole w ogóle przyszło. Podmiana na
   znacznik zostawia kształt i zabiera treść.                                */

/** Widoczny ślad po usuniętej wartości. Ma się rzucać w oczy w podglądzie. */
export const USUNIETE = "[usunięte przy pobraniu]";

/**
 * Nazwy pól, których wartości nie zapisujemy NIGDZIE — ani w modelu pracy,
 * ani w lądowisku.
 *
 * Lista jest po NAZWIE POLA, nie po ścieżce, i to jest decyzja. Ścieżka
 * (`refund.bankAccount`) chroni dokładnie jedno miejsce; nazwa chroni też to,
 * które Allegro doda w przyszłości. Fałszywe trafienie kosztuje tu jedno pole
 * w lądowisku, a przeoczenie — dane osobowe w kopii zapasowej na lata.
 *
 * Skąd te nazwy: `CheckoutForm.buyer` i `CheckoutFormDeliveryReference.address`
 * oraz `CustomerReturnRefund.bankAccount` i `CustomerReturnParcelSender`
 * w `docs/allegro/swagger.yaml`.
 *
 * `login` i `id` kupującego ZOSTAJĄ. Polityka danych skrzynki dopuszcza login
 * rozmówcy wprost, a bez niego nie da się powiązać zwrotu z rozmową.
 */
const WRAZLIWE = new Set([
  "bankAccount",
  "sender",
  "address",
  "email",
  "phoneNumber",
  "personalIdentity",
  "firstName",
  "lastName",
  "companyName",
  /* Wiadomość kupującego do sprzedawcy bywa wszystkim — adresem, numerem
     telefonu, prośbą o fakturę na dane osobowe. Zwrotu nie rozstrzyga. */
  "messageToSeller",
]);

/**
 * Kopia odpowiedzi bez wartości wrażliwych.
 *
 * Nie mutuje wejścia: synchronizator mapuje model pracy z ORYGINAŁU, a do
 * bazy zapisuje wynik tej funkcji. Gdyby czyściła w miejscu, mapowanie
 * dostałoby znacznik zamiast daty paczki.
 */
export function oczyscSurowy<T>(dane: T): T {
  return przejdz(dane) as T;
}

function przejdz(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(przejdz);
  if (v === null || typeof v !== "object") return v;
  const wynik: Record<string, unknown> = {};
  for (const [klucz, wartosc] of Object.entries(v as Record<string, unknown>)) {
    /* Znacznik zamiast wartości — także dla `null`. Inaczej „pole przyszło
       puste" i „pole wycięliśmy" wyglądałyby w lądowisku tak samo. */
    wynik[klucz] = WRAZLIWE.has(klucz) ? USUNIETE : przejdz(wartosc);
  }
  return wynik;
}

/**
 * Czy w tekście została któraś z wrażliwych nazw z wartością.
 *
 * Do testów i do jednorazowego sprawdzenia bazy po wdrożeniu: `grep` po
 * kolumnie `surowe_json` nie odróżni klucza od wartości, a to odróżni.
 */
export function zostalyWrazliwe(json: string): boolean {
  try {
    return szukaj(JSON.parse(json));
  } catch {
    return false;
  }
}

function szukaj(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(szukaj);
  if (v === null || typeof v !== "object") return false;
  return Object.entries(v as Record<string, unknown>).some(
    ([k, w]) => (WRAZLIWE.has(k) ? w !== USUNIETE : szukaj(w))
  );
}
