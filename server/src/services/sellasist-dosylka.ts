import {
  mapujListeZamowien, mapujListyPrzewozowe, mapujZamowienie, sciezkaPrzesylek, sciezkaZamowienia,
  sciezkaZamowienKupujacego, sciezkaZamowienPoNumerze, zapytajSellasist, type ZapytanieSellasist,
} from "../adapters/sellasist.http.js";
import { stempelLokalny } from "../czas.js";
import type { PrzesylkaZamowienia } from "./dosylka.js";

/* ── Numer dosyłki z Sellasist ───────────────────────────────────────────────
   Dosyłka to nowa etykieta w Sellasist (fakt właściciela z 27 września 2026).
   Allegro pokazuje jej numer przy zamówieniu po godzinach albo wcale, gdy
   etykieta poszła na kopię zamówienia. Sellasist ma numer od chwili wydruku.

   DWIE DROGI, BO NIE WIEMY, KTÓRĄ IDZIE FIRMA. Etykieta dosyłki ląduje:
   1. przy tym samym zamówieniu Sellasist co pierwsza paczka, albo
   2. przy KOPII zamówienia (`copied_order_id`), którą Sellasist robi pod
      ponowną wysyłkę.
   Sprawdzamy obie. Kopię widać tylko w liście zamówień kupującego od chwili
   zgłoszenia zwrotu, bo lista nie filtruje po `copied_order_id`.

   ZWRACAMY KANDYDATÓW, NIE WYBÓR. Który numer jest dosyłką, rozstrzyga
   `wybierzNumer` w `dosylka.ts` tą samą regułą co dla numerów z Allegro.
   Numer starszy od zgłoszenia zwrotu to pierwsza paczka i tam odpada. */

/** Ile kopii sprawdzamy szczegółem. Klient z pięcioma zamówieniami po zwrocie to rzadkość. */
export const KANDYDATOW = 5;

/**
 * Etykiety zamówienia Allegro i jego kopii z Sellasist, z datą utworzenia.
 * Pusta lista: Sellasist nie zna zamówienia albo nie ma w nim etykiet.
 * Błąd Sellasist idzie do wołającego; `dosylka.ts` go degraduje.
 */
export async function przesylkiDosylkiSellasist(
  zamowienie: string, login: string, zwrotAt: string, query: ZapytanieSellasist = zapytajSellasist,
): Promise<PrzesylkaZamowienia[]> {
  const oryginaly = new Set(mapujListeZamowien(await query(sciezkaZamowienPoNumerze(zamowienie))).map((z) => z.id));
  if (oryginaly.size === 0) return [];

  const doEtykiet = [...oryginaly];
  const kupujacego = mapujListeZamowien(await query(sciezkaZamowienKupujacego(login, stempelLokalny(zwrotAt))))
    .filter((z) => !oryginaly.has(z.id)).slice(0, KANDYDATOW);
  const uslugi = new Map<string, string>();
  for (const k of [...oryginaly].map((id) => ({ id })).concat(kupujacego)) {
    const z = mapujZamowienie(await query(sciezkaZamowienia(k.id)));
    if (!z) continue;
    const nasze = oryginaly.has(z.id) || (z.skopiowaneZ !== null && oryginaly.has(z.skopiowaneZ))
      || z.externalId === zamowienie;
    if (!nasze) continue;
    if (!oryginaly.has(z.id)) doEtykiet.push(z.id);
    for (const p of z.przesylki) uslugi.set(p.waybill, p.przewoznik);
  }

  const daty = new Map<string, string | null>();
  for (const id of doEtykiet) {
    for (const l of mapujListyPrzewozowe(await query(sciezkaPrzesylek(id)))) {
      daty.set(l.waybill, l.utworzonoAt ?? daty.get(l.waybill) ?? null);
    }
  }
  /* Numer ze szczegółu bez listu przewozowego zostaje BEZ daty: reguła
     wyboru weźmie go tylko wtedy, gdy przewoźnik mówi o nim coś po zwrocie. */
  return [...new Set([...daty.keys(), ...uslugi.keys()])].map((waybill) => ({
    waybill, carrierId: uslugi.get(waybill) ?? "OTHER", createdAt: daty.get(waybill) ?? null,
  }));
}
