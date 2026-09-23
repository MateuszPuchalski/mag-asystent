import React, { useEffect, useState } from "react";
import { Check, Send, X } from "lucide-react";

/* ── WYSYŁKA Z DZIESIĘCIOMA SEKUNDAMI NA COFNIĘCIE (23 września 2026) ─────────
   Decyzja właściciela. Odpowiedź szła do Allegro w chwili kliknięcia i nie
   dało się jej zawrócić — a w kolejce przerabianej z góry na dół pomyłka ma
   trzy znane kształty: zła rozmowa, zły szkic, przypadkowy Enter.

   COFNIĘCIE ZAMIAST POTWIERDZENIA. Okno „czy na pewno?" przy każdej odpowiedzi
   uczy klikać „tak" bez czytania; dziesięć sekund z przyciskiem „Cofnij" nie
   zatrzymuje nikogo, kto się nie pomylił. Ten sam wzór co cofnięcia koszy
   z 0.79.0 (§25a.5).

   CZEKANIE MIESZKA W PRZEGLĄDARCE, NIE NA SERWERZE — i to jest świadoma cena.
   Zamknięcie karty w tych dziesięciu sekundach zatrzymuje wysyłkę; ekran
   pyta wtedy o zgodę (`beforeunload`). Odwrotna usterka byłaby gorsza:
   odpowiedź, która wychodzi sama, gdy agent już jej nie widzi. Serwer
   sprawdza świeżość dopiero przy właściwym wysłaniu, więc dopisek klienta
   w tym czasie zatrzymuje wysyłkę tak jak dotąd.

   Ten komponent jest CZYSTY: licznik sekund i przyciski. Czas, wysyłkę
   i powrót do rozmowy trzyma `ekrany/Skrzynka.tsx`. */

export const OKNO_COFNIECIA_MS = 10_000;

/**
 * Następna rozmowa po wysyłce: kolejna w tym, co WIDAĆ, a przy ostatniej —
 * poprzednia. Rozmowa spoza listy (otwarta z adresu) zostaje na miejscu,
 * bo „następna" po niej nic nie znaczy.
 */
export function nastepnaRozmowa(widoczne: number[], id: number): number | null {
  const i = widoczne.indexOf(id);
  if (i < 0) return null;
  return widoczne[i + 1] ?? widoczne[i - 1] ?? null;
}

export type StanOdlozonej =
  | { rodzaj: "czeka"; doKiedy: number }
  | { rodzaj: "wysyla" }
  | { rodzaj: "wyslana" }
  | { rodzaj: "blad"; komunikat: string };

export interface Odlozona {
  klucz: number;
  rozmowaId: number;
  klient: string;
  stan: StanOdlozonej;
}

function Sekundy({ doKiedy }: { doKiedy: number }) {
  const [teraz, setTeraz] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTeraz(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <b className="tabular-nums">{Math.max(0, Math.ceil((doKiedy - teraz) / 1000))} s</b>;
}

export function Odlozone({ lista, onCofnij, onWroc, onZamknij }: {
  lista: Odlozona[];
  onCofnij: (klucz: number) => void;
  onWroc: (klucz: number) => void;
  onZamknij: (klucz: number) => void;
}) {
  if (lista.length === 0) return null;
  return <div aria-live="polite"
    className="fixed bottom-4 left-1/2 z-40 flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
    {lista.map((o) => {
      const blad = o.stan.rodzaj === "blad";
      return <div key={o.klucz} role={blad ? "alert" : "status"}
        className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
          blad ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-wertis-ink text-white"}`}>
        {o.stan.rodzaj === "wyslana" ? <Check size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          {o.stan.rodzaj === "czeka" && <>Odpowiedź do <b>{o.klient}</b> wyjdzie za <Sekundy doKiedy={o.stan.doKiedy} /></>}
          {o.stan.rodzaj === "wysyla" && <>Wysyłam do <b>{o.klient}</b>…</>}
          {o.stan.rodzaj === "wyslana" && <>Wysłano do <b>{o.klient}</b></>}
          {o.stan.rodzaj === "blad" && <>Nie wysłano do <b>{o.klient}</b>: {o.stan.komunikat}</>}
        </span>
        {o.stan.rodzaj === "czeka" && <button type="button" onClick={() => onCofnij(o.klucz)}
          className="rounded-lg bg-wertis-amber px-3 py-1.5 font-bold text-wertis-ink">Cofnij</button>}
        {blad && <button type="button" onClick={() => onWroc(o.klucz)}
          className="rounded-lg bg-white px-3 py-1.5 font-bold text-red-900 ring-1 ring-red-200">Wróć do rozmowy</button>}
        {(blad || o.stan.rodzaj === "wyslana") && <button type="button" aria-label="Zamknij"
          onClick={() => onZamknij(o.klucz)} className="rounded p-1 opacity-80 hover:opacity-100"><X size={15} /></button>}
      </div>;
    })}
  </div>;
}
