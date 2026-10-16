import { useRef } from "react";

/* ── KURSOR KOLEJKI PRZEŻYWA ZEJŚCIE SPRAWY Z LISTY ─────────────────────────
   Po werdykcie, odpowiedzi czy przyjęciu sprawa schodzi z listy widocznej,
   a kursor zostaje na sprawie, której już nie ma. Liczenie od zera plus jeden
   przeskakiwało wtedy sprawę, która wskoczyła na zwolnione miejsce — praca
   klawiszem `j` gubiła co drugą. Dlatego kursor pamięta ostatnią pozycję
   widzianą, a wszystkie kolejki biorą go stąd, żeby poprawka nie żyła
   w jednej z nich.

   Kursor chodzi po liście WIDOCZNEJ, nie po kubełku: przy filtrze `j` idzie
   do następnego wyniku, a nie do sprawy schowanej przed oczami. */

/** Indeks celu ruchu o `o` albo `null` przy pustej liście. */
export function celKursora(dlugosc: number, miejsce: number, ostatnie: number, o: number): number | null {
  if (dlugosc === 0) return null;
  /* Sprawy nie ma już na liście: następna STOI na jej miejscu, poprzednia
     o jedno wyżej. */
  const cel = miejsce >= 0 ? miejsce + o : (o > 0 ? ostatnie : ostatnie - 1);
  return Math.min(dlugosc - 1, Math.max(0, cel));
}

/** Zwraca `idz(o)`, które przechodzi o `o` pozycji po liście widocznej. */
export function useKursorListy<T extends { id: unknown }>(
  widoczne: readonly T[], wybrany: unknown, otworz: (el: T) => void,
): (o: number) => void {
  const ostatnie = useRef(0);
  const miejsce = widoczne.findIndex((el) => el.id === wybrany);
  if (miejsce >= 0) ostatnie.current = miejsce;
  return (o: number) => {
    const i = celKursora(widoczne.length, widoczne.findIndex((el) => el.id === wybrany), ostatnie.current, o);
    const nast = i == null ? undefined : widoczne[i];
    if (nast) otworz(nast);
  };
}
