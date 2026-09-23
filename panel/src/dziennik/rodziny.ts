/* ── Rodzina zdarzenia (z `biuro.html` 0.427.0, w panelu od 0.440.0) ─────
   Kolumna TYP była pogrubionym kluczem technicznym i przy dwustu wierszach
   wszystkie wyglądały tak samo — „co się tu psuło" wymagało przeczytania
   każdego klucza (dekalog pkt 2). Cztery rodziny na ISTNIEJĄCYCH żetonach
   panelu, bez nowej barwy: błędy i urządzenia czerwienią, praca przy
   dostawach bursztynem, zwroty obrysem, reszta szarością.

   KOLEJNOŚĆ MA ZNACZENIE: `queue_failed` jest najpierw błędem, dopiero potem
   czymkolwiek innym. Klucz zostaje tekstem pastylki, bo po nim filtruje się
   TYP i szuka w CSV. */

export type RodzinaZdarzenia = "blad" | "dostawa" | "zwrot" | "inne";

const RODZINY: Array<[RodzinaZdarzenia, RegExp]> = [
  ["blad", /failed|rejected|conflict|konflikt|mismatch|odmowa|blad|device_drop|battery/],
  ["dostawa", /^(putaway|delivery|location|problem|przyjecie|brak_na_serwis|przesuniecie|notatka|zdjecie|manual_entry)/],
  ["zwrot", /^(zwrot|kosz|karton|reklamacja|klient)/],
];

export function rodzinaZdarzenia(typ: string): RodzinaZdarzenia {
  return RODZINY.find(([, wzor]) => wzor.test(typ))?.[0] ?? "inne";
}

/** Barwa pastylki rodziny — pary tło–pismo, każda powyżej 4,5:1. */
export const KLASA_RODZINY: Record<RodzinaZdarzenia, string> = {
  blad: "bg-red-100 text-ranga-zle",
  dostawa: "bg-amber-100 text-ranga-uwaga",
  /* Zwrot OBRYSEM, nie trzecią barwą tła: czwarta barwiona pastylka w jednej
     kolumnie przestaje się różnić od sąsiadek. */
  zwrot: "bg-white text-slate-700 ring-1 ring-inset ring-slate-400",
  inne: "bg-slate-100 text-slate-700",
};
