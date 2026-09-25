/* Typ modułu z `wtyczka-zmian.ts` — wyliczany przy budowaniu, więc bez pliku źródłowego. */
declare module "virtual:wertis-zmiany" {
  import type { WydanieZmian } from "./zmiany";
  const dane: { wersja: string; zmiany: WydanieZmian[] };
  export default dane;
}
