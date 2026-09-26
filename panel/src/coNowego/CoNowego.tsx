import React, { useState } from "react";
import { Sparkles, X } from "lucide-react";
import dane from "virtual:wertis-zmiany";
import { doPokazania, type WydanieZmian } from "./zmiany";

/* ── Pasek „Nowe w panelu" (0.500.0) ────────────────────────────────────────
   Jeden wiersz pod nagłówkiem przy pierwszym wejściu po wydaniu: nagłówki
   zmian, które agent jeszcze nie widział, i „Rozumiem". Powód i dobór wydań
   w `zmiany.ts`.

   PASEK, NIE OKNO. Okno na środku ekranu zatrzymuje pracę i uczy klikać
   „zamknij" bez czytania. Pasek stoi z boku uwagi i czeka, aż agent
   zechce go przeczytać — albo zamknąć.

   PAMIĘĆ W PRZEGLĄDARCE, NIE NA SERWERZE. Otwarcie panelu niczego nie zapisuje
   (zero zapisu przy patrzeniu), a numer zamkniętego wydania to wygoda jednej
   przeglądarki, nie stan firmy. Zapis pada wyłącznie przy „Rozumiem".
   Przeglądarka bez pamięci (tryb prywatny, blokada) pokaże pasek jeszcze
   raz, co jest mniejszym złem niż pasek, którego nie da się zamknąć. */

const KLUCZ = "wertis.coNowego.widziana";

function czytaj(): string | null {
  try { return localStorage.getItem(KLUCZ); } catch { return null; }
}

export function PasekZmian({ zmiany, onZamknij }: { zmiany: WydanieZmian[]; onZamknij: () => void }) {
  /* JEDNO WYDANIE NARAZ, reszta za „+N" (@wydanie). Po tygodniu nieobecności
     pasek wyrastał na trzy wiersze nagłówków nad pracą, a agent czyta
     najnowsze albo nic. Starsze zostają o jedno kliknięcie. */
  const [wszystkie, setWszystkie] = useState(false);
  if (!zmiany.length) return null;
  const [najnowsze, ...starsze] = zmiany;
  const widoczne = wszystkie ? zmiany : [najnowsze];
  return <section aria-label="Nowe w panelu"
    className="flex items-start gap-3 border-b border-sky-200 bg-sky-50 px-5 py-2 text-sm text-sky-950">
    <Sparkles size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      {widoczne.map((z) => <p key={z.wersja}>
        <b>Nowe w {z.wersja}:</b> {z.naglowki.join(" · ")}
        {z === najnowsze && !wszystkie && starsze.length > 0 &&
          <button type="button" onClick={() => setWszystkie(true)}
            title="Pokaż wcześniejsze wydania"
            aria-label={`+${starsze.length}: pokaż wcześniejsze wydania`}
            className="ml-2 rounded px-1.5 font-semibold underline hover:bg-sky-100">
            +{starsze.length}</button>}
      </p>)}
    </div>
    <button type="button" onClick={onZamknij}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-sky-100">
      <X size={14} aria-hidden="true" />Rozumiem</button>
  </section>;
}

/** Pasek dla ramy panelu — dane z budowania, pamięć z przeglądarki. */
export function CoNowego() {
  const [widziana, setWidziana] = useState(czytaj);
  const zmiany = doPokazania(dane.zmiany, widziana);
  return <PasekZmian zmiany={zmiany} onZamknij={() => {
    const najnowsza = dane.zmiany[0]?.wersja ?? dane.wersja;
    try { localStorage.setItem(KLUCZ, najnowsza); } catch { /* bez pamięci pasek wróci — patrz wyżej */ }
    setWidziana(najnowsza);
  }} />;
}
