import { useCallback, useEffect, useState } from "react";

/* ── Błędy czynności jednej sprawy w jednym miejscu ─────────────────────────
   Każda czynność na sprawie (wzięcie, notatka, pytanie o paczkę, wysyłka)
   kończy się albo ciszą, albo zdaniem pod swoim przyciskiem. Zdanie należy
   do PRÓBY na tej sprawie, nie do ekranu, więc zmiana sprawy czyści
   wszystkie naraz. Osobny stan na każdą czynność wymagał pamiętania o nim
   w efekcie czyszczącym, a zapomniany zostawiał błąd jednej sprawy na drugiej.

   `zBledem` czyści zdanie czynności przed próbą i łapie błąd po niej, więc
   ekran woła mutację jednym wierszem i nie trzyma własnych `set…`. */

/** Opcje mutacji TanStacka, które ten hak umie złożyć. */
export interface OpcjeZBledem<W> {
  onSuccess?: (w: W) => void;
  onError: (e: unknown) => void;
}

export function useBledy<K extends string>(sprawa: unknown) {
  const [bledy, setBledy] = useState<Partial<Record<K, string>>>({});
  useEffect(() => { setBledy({}); }, [sprawa]);

  const ustaw = useCallback((k: K, tekst: string) => {
    setBledy((b) => (b[k] === tekst ? b : { ...b, [k]: tekst }));
  }, []);

  /** Czyści zdanie czynności i zwraca opcje mutacji, które wpiszą nowe przy porażce. */
  const zBledem = useCallback(<W = unknown>(k: K, onSuccess?: (w: W) => void): OpcjeZBledem<W> => {
    ustaw(k, "");
    return { onSuccess, onError: (e) => ustaw(k, (e as Error).message) };
  }, [ustaw]);

  const blad = (k: K) => bledy[k] ?? "";
  return { blad, ustaw, zBledem };
}
