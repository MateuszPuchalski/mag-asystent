import fs from "node:fs";
import {
  jestKopia, lista, mapujZamowienie, sciezkaPrzesylek, sciezkaZamowienia, SCIEZKA_STATUSOW, sellasistWlaczony,
  zapytajSellasist,
} from "./adapters/sellasist.http.js";
import { opiszKsztalt, raportKoncowki } from "./services/ksztalt.js";

/* ── Sonda Sellasist ─────────────────────────────────────────────────────────
   Integracja stoi na schemacie z `docs/sellasist/api.yaml`. Cztery rzeczy
   schemat zostawia otwarte i ta sonda odpowiada na nie z żywego konta:
   1. czy `external_data.external_id` zamówień z Allegro to numer formularza
      zakupu (UUID), czyli klucz, po którym wiążemy z `zamowienie_klienta`;
   2. czy daty przychodzą stemplem `RRRR-MM-DD HH:MM:SS` bez strefy;
   3. czy `object_id` przy `order_status_change` to nowy status zamówienia;
   4. jakie statusy firma ma w Sellasist — z nich bierze się
      `SELLASIST_STATUSY_ZEBRANE`.

   WYŁĄCZNIE GET: sonda niczego w Sellasist nie zmienia i nie dotyka bazy.
   Wypisuje KSZTAŁT i liczby, nigdy treści. Reguły ukrywania danych są te
   same co w sondzie Allegro (`services/ksztalt.ts`). Wyjątkiem są nazwy
   statusów: nadaje je firma i są potrzebne do konfiguracji.

   Uruchomienie:  npm run sellasist:sonda             (raport na ekran)
                  npm run sellasist:sonda -- plik.md  (raport do pliku)     */

const PROBKA = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEMPEL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Klasa formatu daty do raportu: liczymy kształty, nie pokazujemy wartości. */
function format(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s === "") return "puste";
  if (STEMPEL.test(s)) return "RRRR-MM-DD HH:MM:SS";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "RRRR-MM-DD";
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return "ISO ze strefą";
  return "inny";
}

const policz = (wartosci: string[]): string => {
  const m = new Map<string, number>();
  for (const w of wartosci) m.set(w, (m.get(w) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => `${k} ×${n}`).join(", ") || "brak próbki";
};

async function main(): Promise<void> {
  if (!sellasistWlaczony()) {
    console.error("Brak SELLASIST_KONTO i SELLASIST_API_KEY w wertis.env — sonda nie ma dokąd pytać.");
    process.exitCode = 1;
    return;
  }
  const raport: string[] = ["# Sonda Sellasist", "", `Data: ${new Date().toISOString()}`, ""];

  /* Schemat `GET /statuses` mówi „tablica liczb", choć statusy mają nazwy.
     Pokazujemy, co przyjdzie: obiekt z nazwą albo gołą liczbę. */
  const statusy = await zapytajSellasist(SCIEZKA_STATUSOW);
  raport.push("## Statusy zamówień konta", "",
    "Numery do `SELLASIST_STATUSY_ZEBRANE` (po przecinku).", "",
    "| id | nazwa |", "|---:|---|",
    ...(Array.isArray(statusy) ? statusy : []).map((s) => (s && typeof s === "object"
      ? `| ${String((s as Record<string, unknown>).id ?? "?")} | ${String((s as Record<string, unknown>).name ?? "?")} |`
      : `| ${String(s)} | ? |`)), "");

  const skroty = lista(await zapytajSellasist(`/orders?limit=${PROBKA}&sort=desc`));
  const szczegoly: Array<Record<string, unknown>> = [];
  for (const s of skroty) {
    const z = await zapytajSellasist(sciezkaZamowienia(Number(s.id)));
    if (z && typeof z === "object") szczegoly.push(z as Record<string, unknown>);
  }
  const zAllegro = szczegoly.filter((z) => z.source === "allegro");
  const ext = zAllegro.map((z) => String((z.external_data as Record<string, unknown> | undefined)?.external_id ?? ""));
  raport.push("## Pytania otwarte", "",
    `1. \`external_id\` zamówień z Allegro: UUID ×${ext.filter((e) => UUID.test(e)).length}, `
      + `inny ×${ext.filter((e) => e && !UUID.test(e)).length}, puste ×${ext.filter((e) => !e).length} `
      + `(z ${zAllegro.length} zamówień Allegro w próbce ${szczegoly.length}).`,
    `2. Format \`date\`: ${policz(szczegoly.map((z) => format(z.date)))}. `
      + `\`last_status_change\`: ${policz(szczegoly.map((z) => format(z.last_status_change)))}. `
      + `\`deadline\`: ${policz(szczegoly.map((z) => format(z.deadline)))}.`);

  const dziennik = lista(await zapytajSellasist("/orders_logs?operation_tag=order_status_change&sort=desc&limit=100"));
  const statusZam = new Map(szczegoly.map((z) => [Number(z.id), Number((z.status as Record<string, unknown>)?.id)]));
  const ostatni = new Map<number, unknown>();
  for (const w of dziennik) if (!ostatni.has(Number(w.order_id))) ostatni.set(Number(w.order_id), w.object_id);
  const pary = [...ostatni.entries()].filter(([id]) => statusZam.has(id));
  raport.push(`3. Ostatnia zmiana statusu w dzienniku a bieżący status zamówienia: zgodne ×${
    pary.filter(([id, o]) => Number(o) === statusZam.get(id)).length}, różne ×${
    pary.filter(([id, o]) => Number(o) !== statusZam.get(id)).length} (zamówień w obu: ${pary.length}).`);
  const kopie = szczegoly.filter((z) => jestKopia(z.is_copied)).length;
  const mapowane = szczegoly.map(mapujZamowienie).filter((z) => z !== null);
  raport.push(`4. Kopii zamówień w próbce: ${kopie}. Zamówień z etykietą: ${
    mapowane.filter((z) => z!.przesylki.length).length}. Usługi przewoźników: ${
    policz(mapowane.flatMap((z) => z!.przesylki.map((p) => `${p.usluga ?? "?"} → ${p.przewoznik}`)))}.`, "");

  raport.push(raportKoncowki("GET /orders/{order_id}", szczegoly.length, opiszKsztalt(szczegoly)));
  raport.push(raportKoncowki("GET /orders_logs", dziennik.length, opiszKsztalt(dziennik)));
  const zEtykieta = mapowane.find((z) => z!.przesylki.length);
  if (zEtykieta) {
    const listy = lista(await zapytajSellasist(sciezkaPrzesylek(zEtykieta.id)));
    raport.push(raportKoncowki("GET /ordersshipments", listy.length, opiszKsztalt(listy)));
  }

  const plik = process.argv[2];
  if (plik) {
    fs.writeFileSync(plik, raport.join("\n"));
    console.log(`Raport zapisany: ${plik}`);
  } else {
    console.log(raport.join("\n"));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Sonda nieudana.");
  process.exitCode = 1;
});
