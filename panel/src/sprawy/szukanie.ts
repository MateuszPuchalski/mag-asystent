/* ── Dopasowanie frazy do sprawy (0.367.0) ──────────────────────────────────
   Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się głównie za
   pomocą loginu użytkownika i innych informacji na przesyłce — usprawnij
   i przebuduj".

   CAŁA ZMIANA JEST W SPACJI. Do 0.366.0 fraza szła do `includes()` w całości,
   więc „kowalski inpost" nie znajdowało NICZEGO — nie dlatego, że tych danych
   nie ma, tylko dlatego, że nie stoją obok siebie w jednym polu. A operator
   trzymający karton ma pod ręką właśnie kilka drobnych uchwytów naraz:
   nazwisko z naklejki, logo przewoźnika, kawałek numeru. Żaden z nich sam nie
   zawęża, wszystkie razem zawężają do jednego wiersza.

   ILOCZYN PO CZŁONACH, SUMA PO POLACH. Każdy człon musi trafić w KTÓREŚ pole;
   nie muszą trafiać w to samo. Odwrotna reguła („którykolwiek człon") byłaby
   gorsza niż dzisiejsza: dopisanie drugiego słowa ROZSZERZAŁOBY wynik, więc
   im więcej człowiek wie o paczce, tym dłuższą dostawałby listę.

   TRZY EKRANY, JEDNA KOPIA. Reklamacje, dyskusje i zwroty trzymały ten sam
   `useMemo` przepisany znak w znak. Pomocnik i tak musiał gdzieś zamieszkać,
   więc trzy kopie schodzą do jednej przy okazji, a nie osobnym wydaniem.     */

/**
 * Czy sprawa o tych uchwytach pasuje do wpisanej frazy.
 *
 * @param kody uchwyty sprawy — numery, login, nazwa odbiorcy, przewoźnik.
 *   Wołający oddaje je JUŻ MAŁYMI literami i bez pustych, bo ta sama lista
 *   służy mu też do dokładnego trafienia.
 * @param fraza surowa treść pola; pusta znaczy „nie filtruj".
 */
export function pasujeDoFrazy(kody: string[], fraza: string): boolean {
  const czlony = rozbij(fraza);
  if (!czlony.length) return true;
  return czlony.every((c) => kody.some((k) => k.includes(c)));
}

/** Człony frazy, małymi literami, bez pustych. Pusta fraza to pusta lista. */
export function rozbij(fraza: string): string[] {
  return fraza.trim().toLowerCase().split(/\s+/).filter(Boolean);
}
