import { useQuery } from "@tanstack/react-query";
import { api } from "./klient";
import type { OdpowiedzDrogi } from "./typy";

/* ── Droga klienta po numerze zamówienia ─────────────────────────────────────
   Odczyt, nigdy zapis: otwarcie ekranu nie ma prawa niczego mutować, a pasek
   drogi stoi na pięciu ekranach naraz. Klucz zaczyna się od `droga-sprawy`,
   więc zapis, który zmienia sprawę zakupu, może unieważnić wszystkie paski
   jednym prefiksem.

   Adres stoi w całości w jednym literale, bez `method`: strażnik adresów
   panelu (`server/src/routes/panel-adresy.test.ts`) czyta go z tego pliku. */

export const KLUCZ_DROGI = "droga-sprawy";

/** `null` wyłącza zapytanie: sprawa bez numeru zamówienia nie ma czego pytać. */
export function useDrogaSprawy(orderId: string | null) {
  return useQuery({
    queryKey: [KLUCZ_DROGI, orderId] as const,
    queryFn: () => api<OdpowiedzDrogi>(`/api/obsluga/droga/${encodeURIComponent(orderId ?? "")}`),
    enabled: orderId !== null && orderId !== "",
  });
}
