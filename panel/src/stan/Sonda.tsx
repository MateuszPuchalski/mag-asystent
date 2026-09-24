import React from "react";
import { FlaskConical } from "lucide-react";
import { useSonda, useSondujTeraz, type KrokSondy, type WynikSondy } from "../api/stan";
import { Blad, Przycisk, czas } from "../ui";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Test na żywym Allegro (@wydanie) ─────────────────────────────────────
   Zgłoszenie właściciela po rozmowie o metodzie Feynmana: „build it”. Nasze
   bramki sprawdzają kod wobec kodu; ta karta pokazuje, czy drogi produkcji
   działają wobec prawdziwego Allegro. Serwer przechodzi je raz dziennie, bez
   atrap. Błąd kroku stoi też w DO DECYZJI i prowadzi tutaj.

   Trzy stany, nie dwa. „Pominięty” to brak danych albo limit Allegro, czyli
   nie wada drogi — czerwień zapalana przy nim uczyłaby ją ignorować. */

export const NAZWA_KROKU: Record<KrokSondy, string> = {
  watki: "wątki skrzynki", sprawa: "sprawa posprzedażowa", zdjecie_rozmowy: "zdjęcie z rozmowy",
  zdjecie_reklamacji: "zdjęcie ze sprawy", zdjecia_copilota: "zdjęcia w szkicach z doby",
};

function Wynik({ w }: { w: WynikSondy["wynik"] }) {
  const [tekst, klasa] = w === "ok" ? ["działa", "bg-emerald-100 text-ranga-ok"]
    : w === "blad" ? ["nie działa", "bg-red-100 text-ranga-zle"]
    : ["pominięty", "bg-slate-100 text-slate-600"];
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-bold ${klasa}`}>{tekst}</span>;
}

export function KartaSondy() {
  const s = useSonda();
  const teraz = useSondujTeraz();
  const d = s.data;
  return <KartaWgladu id="karta-sonda" tytul="Test na żywym Allegro"
    opis="Raz dziennie serwer przechodzi drogi produkcji wobec prawdziwego Allegro, bez atrap: wątki, sprawę i zdjęcia tak, jak pobiera je Copilot. Tylko czyta."
    akcje={<Przycisk disabled={teraz.isPending} onClick={() => teraz.mutate()}>
      <FlaskConical size={16} />{teraz.isPending ? "Testuję…" : "Przetestuj teraz"}</Przycisk>}>
    <Blad>{s.error?.message ?? teraz.error?.message}</Blad>
    {d && (d.przebieg === null
      ? <p className="text-sm text-slate-600">Test jeszcze nie szedł. Pierwszy przebieg przyjdzie w ciągu doby albo po „Przetestuj teraz”.</p>
      : <>
        <p className="mb-2 text-sm text-slate-600">Ostatni przebieg {czas(d.przebieg)}.</p>
        <Tabela naglowki={["Krok", "Wynik", "Co zobaczył", "Czas"]} pusto="Brak kroków.">
          {d.kroki.map((k) => <tr key={k.krok}>
            <Td className="font-semibold">{NAZWA_KROKU[k.krok] ?? k.krok}</Td>
            <Td><Wynik w={k.wynik} /></Td>
            <Td>{k.szczegol ?? "—"}</Td>
            <Td className="whitespace-nowrap tabular-nums text-slate-600">{k.ms} ms</Td>
          </tr>)}
        </Tabela>
      </>)}
  </KartaWgladu>;
}
