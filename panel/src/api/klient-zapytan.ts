import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { BrakSesji, zglosBrakSesji } from "./klient";

/* Jeden cache zapytań na cały panel zastępuje ręczne odświeżanie co
   piętnaście sekund. To jest ta część wyceny z `docs/obsluga-klienta.md` §7,
   za którą płacimy TanStackiem: ekrany dzielą stan zamiast każdy swój.

   Budowa mieszka tu, a nie w `main.tsx` (0.502.0), żeby test mógł złożyć
   ten sam klient i sprawdzić odświeżenie wspólnych kluczy niżej. */

/* ── ODŚWIEŻENIE PO KAŻDEJ ZMIANIE, NA KAŻDYM EKRANIE (0.502.0) ────────────
   Mutacja w zwrotach, reklamacjach albo dyskusjach odświeżała tylko swoją
   kolejkę. „Do zrobienia" i otwarta rozmowa dowiadywały się o niej dopiero
   po 10–30 sekundach, więc wiersz „do decyzji" wisiał nad sprawą już
   rozstrzygniętą. Te dwa klucze czyta pośrednio KAŻDY ekran (licznik
   w nagłówku, blok zwrotu przy rozmowie), więc dostają je wszystkie
   mutacje naraz. Ręczna lista przy każdym hooku zapominała o nowych.
   Odświeża się tylko to, na co ktoś patrzy — zapytania aktywne. */
export const WSPOLNE_KLUCZE = [["do-decyzji"], ["rozmowa"]] as const;

export function nowyKlientZapytan(): QueryClient {
  const klient: QueryClient = new QueryClient({
    /* Wygasła sesja w dowolnym zapytaniu albo mutacji wraca do logowania
       (0.431.0) — szczegół przy `zglosBrakSesji` w `api/klient.ts`. */
    queryCache: new QueryCache({ onError: zglosBrakSesji }),
    mutationCache: new MutationCache({
      onError: zglosBrakSesji,
      onSuccess: () => {
        for (const k of WSPOLNE_KLUCZE) void klient.invalidateQueries({ queryKey: [...k] });
      },
    }),
    defaultOptions: {
      queries: {
        /* Sesja wygasła nie jest błędem do ponowienia — ekran ma wrócić do
           logowania. Bez tego panel próbowałby trzy razy i pokazał błąd. */
        retry: (proba, blad) => !(blad instanceof BrakSesji) && proba < 2,
        staleTime: 10_000,
        refetchOnWindowFocus: true,
      },
    },
  });
  return klient;
}
