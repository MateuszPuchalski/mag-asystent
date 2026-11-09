import { useCallback, useState } from "react";

/* ── Szkic odpowiedzi przeżywa przełączenie sprawy ───────────────────────────
   Agent pisze odpowiedź, wchodzi sprawa pilniejsza, wraca — i pole ma
   dalej jego tekst. Szkic pisany do jednej sprawy nie wyjeżdża przy tym do
   drugiej po strzałce w kolejce, bo jest PRZYPISANY DO SPRAWY, a nie do pola.

   JEDEN HOOK NA WSZYSTKIE KOLEJKI. Szkic żyje po stronie ekranu; serwer
   nie ma na niego kolumny.

   DLACZEGO `sessionStorage`, A NIE PAMIĘĆ KOMPONENTU. Pamięć ginie przy
   wyjściu z ekranu, a przełączenie na inną kolejkę to dokładnie ten ruch,
   po którym agent wraca dopisać zdanie. Karta przeglądarki ma własny magazyn,
   więc ta sama sprawa otwarta w dwóch kartach ma dwa szkice — i tak ma być:
   scalanie dwóch wersji jednego zdania nie jest czymś, co ekran może zgadnąć.

   MAGAZYN BYWA NIEDOSTĘPNY. W oknie prywatnym i przy zablokowanych danych
   witryny odczyt RZUCA, a nie zwraca pusto. Każde dotknięcie jest w `try`,
   a przy niepowodzeniu hook pracuje na samej pamięci — gorzej, ale działa. */

const KLUCZ = "wertis:szkic";

const klucz = (kolejka: string, id: number) => `${KLUCZ}:${kolejka}:${id}`;

function czytaj(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}

function pisz(k: string, v: string): void {
  try {
    if (v === "") sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* Pamięć komponentu i tak trzyma wartość do końca życia ekranu. */
  }
}

/* ── TO SAMO DLA SKRZYNKI, TYLKO BEZ HOOKA ───────────────────────────────────
   Skrzynka zapisuje szkic na serwerze wyłącznie przez „Zapisz szkic", więc
   niezapisana odpowiedź ginęłaby przy j/k. Bierze ten sam magazyn i te same
   klucze, ale bez hooka: jej pole ma więcej źródeł (szkic zespołu, szkic
   Copilota, powrót po „Cofnij") i o tym, co wygrywa, decyduje ekran. */

/** Treść zapamiętana dla sprawy albo `null`, gdy nic nie zapamiętano. */
export function pamietanySzkic(kolejka: string, id: number): string | null {
  return czytaj(klucz(kolejka, id));
}

/** Zapisuje treść dla sprawy; pusty napis kasuje wpis. */
export function zapamietajSzkic(kolejka: string, id: number, v: string): void {
  pisz(klucz(kolejka, id), v);
}

export interface SzkicSprawy {
  /** Treść dla AKTUALNIE wybranej sprawy; pusty napis, gdy nic nie wybrano. */
  tresc: string;
  /** Zapis treści pod wybraną sprawę. Bez wybranej sprawy nie robi nic. */
  ustaw: (v: string) => void;
  /** Kasuje szkic wybranej sprawy — wołane po UDANEJ wysyłce, nie przy zmianie. */
  wyczysc: () => void;
}

/**
 * Szkic odpowiedzi przypisany do sprawy, nie do pola.
 *
 * @param kolejka Człon klucza, żeby reklamacja numer 7 i zwrot numer 7 nie
 *   dzieliły jednego szkicu. Kolejki numerują się niezależnie.
 * @param sprawaId `null`, gdy nic nie wybrano — pole jest wtedy puste i głuche.
 */
export function useSzkicSprawy(kolejka: string, sprawaId: number | null): SzkicSprawy {
  /* Pamięć ekranu jest ŹRÓDŁEM PRAWDY w trakcie pisania, a magazyn kopią.
     Odwrotnie — czytanie z magazynu przy każdym renderze — kosztowałoby odczyt
     na znak i wywracało się tam, gdzie magazyn rzuca. */
  const [szkice, setSzkice] = useState<Record<string, string>>({});
  const k = sprawaId === null ? null : klucz(kolejka, sprawaId);
  const tresc = k === null ? "" : (szkice[k] ?? czytaj(k) ?? "");

  const ustaw = useCallback((v: string) => {
    if (k === null) return;
    setSzkice((s) => ({ ...s, [k]: v }));
    pisz(k, v);
  }, [k]);

  const wyczysc = useCallback(() => {
    if (k === null) return;
    setSzkice((s) => {
      const kopia = { ...s };
      delete kopia[k];
      return kopia;
    });
    pisz(k, "");
  }, [k]);

  return { tresc, ustaw, wyczysc };
}
