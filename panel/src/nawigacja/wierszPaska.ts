/** Klasy przycisku w dolnym bloku paska — wspólne dla szukania, zgłoszenia i „Więcej”.
 *  Rozwinięty pasek rysuje wiersz z podpisem; zwinięty, ręcznie albo szerokością
 *  okna, same ikony. Nazwa zostaje w `aria-label`, więc czytnik nic nie traci. */
export const wierszPaska = (zwiniety: boolean) =>
  `flex h-10 shrink-0 items-center rounded-lg text-sm font-semibold ${zwiniety
    ? "mx-auto w-10 justify-center"
    : "w-full gap-2.5 px-2.5 max-[1279px]:mx-auto max-[1279px]:w-10 max-[1279px]:justify-center max-[1279px]:gap-0 max-[1279px]:px-0"}`;
/** Podpis wiersza: widoczny tylko w rozwiniętym pasku. */
export const podpisPaska = (zwiniety: boolean) => zwiniety ? "sr-only" : "max-[1279px]:sr-only";
