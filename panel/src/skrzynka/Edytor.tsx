import React, { useState } from "react";
import { Lock, MessageSquare, Send } from "lucide-react";
import { Przycisk } from "../ui";
import { PrzyciskZalacznika, ZalacznikiWysylki } from "./ZalacznikiWysylki";
import { KartaSzkicu, PrzyciskSzkicu, type PropsSzkicuCopilota } from "./SzkicCopilota";
import type { ZalacznikSzkicu } from "../api/rozmowy";

/**
 * Edytor odpowiedzi (§10.4).
 *
 * DWA TRYBY, DWA POLA, DWA PRZYCISKI — i to jest tu najważniejsza decyzja.
 * §10.4 żąda, żeby przycisk komentarza i przycisk wysyłki do klienta były
 * jednoznacznie rozdzielone; §6.4 dodaje, że komentarz „nie może przypadkiem
 * trafić do klienta", a §25 stawia to wśród kryteriów gotowości.
 *
 * Rozdzielamy najmocniej, jak się da: w trybie komentarza przycisk wysyłki
 * NIE ISTNIEJE W DRZEWIE. Wyłączony przycisk da się kliknąć, gdy tryb zmieni
 * się o ułamek sekundy za późno albo gdy stan się rozjedzie — przycisku,
 * którego nie ma, nie da się kliknąć nigdy.
 *
 * Pola też są osobne. Gdyby oba tryby dzieliły jeden tekst, notatka „klient
 * bywa trudny" zostawałaby w szkicu po przełączeniu z powrotem i czekała na
 * kliknięcie WYŚLIJ.
 */
export function Edytor({
  szkic, cudza, wlasciciel, zapisuje, wysyla, onZmiana, onZapisz, onWyslij,
  komentarz, onKomentarz, onDodajKomentarz, komentuje, agenci, wzmianki, onWzmianki,
  zalaczniki, dodajeZalacznik, bladZalacznika, onDodajZalacznik, onUsunZalacznik, copilot,
}: {
  szkic: string;
  cudza: boolean;
  wlasciciel: string | null;
  zapisuje: boolean;
  wysyla: boolean;
  onZmiana: (v: string) => void;
  onZapisz: () => void;
  onWyslij: () => void;
  komentarz: string;
  onKomentarz: (v: string) => void;
  onDodajKomentarz: () => void;
  komentuje: boolean;
  agenci: Array<{ userId: number; name: string }>;
  wzmianki: number[];
  onWzmianki: (v: number[]) => void;
  /* Załączniki (0.195.0) — TYLKO w trybie odpowiedzi. Komentarz wewnętrzny
     nigdzie nie wychodzi, więc dołączanie do niego pliku nie miałoby dokąd
     pójść, a przycisk obok notatki sugerowałby, że ma. */
  zalaczniki: ZalacznikSzkicu[];
  dodajeZalacznik: boolean;
  bladZalacznika: string;
  onDodajZalacznik: (plik: File) => void;
  onUsunZalacznik: (id: number) => void;
  /* Szkic z Copilota (0.231.0) — TYLKO w trybie odpowiedzi: propozycja jest
     dla klienta, a w komentarzu nie ma czego układać. Opcjonalny, bo edytor
     reklamacji i testy komentarza nie mają Copilota wcale. */
  copilot?: PropsSzkicuCopilota;
}) {
  const [tryb, setTryb] = useState<"odpowiedz" | "komentarz">("odpowiedz");
  const wKomentarzu = tryb === "komentarz";

  const przelacz = (id: number) => onWzmianki(
    wzmianki.includes(id) ? wzmianki.filter((x) => x !== id) : [...wzmianki, id]);

  /* `max-h-[60vh] overflow-y-auto` to siatka bezpieczeństwa (0.232.1): edytor
     jest `shrink-0`, więc gdy coś go rozepchnie (karta szkicu, załączniki),
     ma się przewinąć sam, a nie zjeść oś rozmowy i obciąć własny dół. */
  return <div className={`max-h-[60vh] shrink-0 overflow-y-auto border-t p-4 ${wKomentarzu ? "bg-amber-50" : ""}`}>
    {/* ── PRZEŁĄCZNIK JEST JEDNYM ELEMENTEM, NIE DWOMA (0.247.0) ──────────────
        Dwa luźne przyciski o tej samej wadze nie mówiły, że wybiera się JEDEN
        z dwóch — mówiły, że są dwie rzeczy do kliknięcia. Bieżnia z tłem
        i wyniesiony kafelek aktywny to ten sam kształt, co przełącznik
        w każdym innym programie, więc nie wymaga czytania.

        Przełącznik stoi NAD polem, żeby było widać, gdzie się pisze, zanim
        się zacznie pisać. */}
    <div className="mb-2.5 flex items-center gap-2">
      <div className={`flex gap-0.5 rounded-lg p-0.5 ${wKomentarzu ? "bg-amber-100" : "bg-slate-100"}`}>
        <button className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${!wKomentarzu
          ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-500"}`}
          onClick={() => setTryb("odpowiedz")}>Odpowiedź do klienta</button>
        <button className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${wKomentarzu
          ? "bg-white font-semibold text-amber-900 shadow-sm" : "font-medium text-slate-500"}`}
          onClick={() => setTryb("komentarz")}>
          <MessageSquare size={13} />Komentarz wewnętrzny
        </button>
      </div>
      {/* ── COPILOT W TYM SAMYM RZĘDZIE (0.249.0) ────────────────────────────
          Zgłoszenie właściciela: „niepotrzebnie ułóż odpowiedź i add
          attachment mają swój własny rząd". 0.247.0 próbowało już tego i
          zostało wycofane, bo z Copilotem WYŁĄCZONYM komponent renderował
          akapit, nie przycisk, i łamał rząd. Naprawiona jest przyczyna:
          `PrzyciskSzkicu` nie zajmuje już nigdy więcej niż jednej linii. */}
      {!wKomentarzu && copilot && <div className="ml-auto flex min-w-0 justify-end">
        <PrzyciskSzkicu p={copilot} /></div>}
    </div>

    {wKomentarzu
      ? <>
          <textarea className="field min-h-[88px] text-tresc" value={komentarz}
            aria-label="Komentarz wewnętrzny — zobaczy go tylko zespół"
            onChange={(e) => onKomentarz(e.target.value)}
            placeholder="Notatka dla zespołu — klient tego nie zobaczy" />
          {agenci.length > 0 && <fieldset className="mt-2">
            <legend className="text-xs font-bold text-slate-600">Wzmianki</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {agenci.map((a) => <label key={a.userId} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={wzmianki.includes(a.userId)}
                  onChange={() => przelacz(a.userId)} />
                {a.name}
              </label>)}
            </div>
          </fieldset>}
          <div className="mt-2 flex items-center gap-2">
            {/* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to
                nie odpowiedź, a kolega ma prawo dopisać „to ten sam klient co
                wczoraj" bez przejmowania sprawy. */}
            <Przycisk wariant="glowny" disabled={komentuje || !komentarz.trim()}
              onClick={onDodajKomentarz} className="px-5 py-2.5 text-tresc shadow-sm">
              <MessageSquare size={17} />{komentuje ? "Zapisuję…" : "Dodaj komentarz"}
            </Przycisk>
            <span className="text-xs text-amber-800">Widoczne tylko dla zespołu.</span>
            <span className="ml-auto text-podpis text-amber-700/70">{komentarz.length} znaków</span>
          </div>
        </>
      : <>
          {cudza && <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <Lock size={13} />Rozmowę prowadzi {wlasciciel} — szkic zapisze tylko właściciel.</p>}
          {/* POLE MA WYGLĄDAĆ NA MIEJSCE DO PISANIA (0.247.0). Miało 80 px
              wysokości i tekst 14 px — tyle samo, co każdy inny wiersz ekranu,
              choć agent spędza w nim najwięcej czasu z całego panelu. */}
          <textarea className="field min-h-[88px] text-tresc" value={szkic}
            aria-label="Szkic odpowiedzi"
            onChange={(e) => onZmiana(e.target.value)}
            placeholder="Szkic odpowiedzi — współdzielony z zespołem" />
          {/* ── JEDNO DZIAŁANIE MA BYĆ NAJGŁOŚNIEJSZE (0.247.0) ───────────────
              Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na
              zewnątrz, i idzie WYŁĄCZNIE na kliknięcie człowieka (druga zasada
              nadrzędna projektu panelu). Wyglądała przy tym jak sąsiad
              „ZAPISZ SZKIC": ta sama wysokość, waga i krój, różnica tylko
              w wypełnieniu. Dostaje większy stopień pisma, wyższy padding
              i cień; zapis szkicu schodzi do zwykłego tekstu.

              Wersaliki znikają, bo spowalniają czytanie: „WYŚLIJ DO KLIENTA"
              to ciąg prostokątów bez wydźwięku liter wystających nad linię. */}
          {/* Lista dołożonych plików stoi NAD rzędem działań (0.247.0): należy
              do komponowanej wiadomości, nie do przycisków. Sam spinacz jedzie
              niżej, w rzędzie działań — nie zasługuje na własny rząd. */}
          <ZalacznikiWysylki lista={zalaczniki} blad={bladZalacznika}
            onUsun={onUsunZalacznik} wylaczone={cudza} />
          <div className="mt-3 flex items-center gap-3">
            <Przycisk wariant="glowny" onClick={onWyslij} disabled={cudza || wysyla || !szkic.trim()}
              className="px-5 py-2.5 text-tresc shadow-sm">
              <Send size={17} />{wysyla ? "Wysyłam…" : "Wyślij do klienta"}</Przycisk>
            <button type="button" onClick={onZapisz} disabled={cudza || zapisuje}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:text-slate-300">
              {zapisuje ? "Zapisuję…" : "Zapisz szkic"}</button>
            <PrzyciskZalacznika dodaje={dodajeZalacznik}
              onDodaj={onDodajZalacznik} wylaczone={cudza} />
            <span className="ml-auto text-podpis text-slate-500">{szkic.length} znaków</span>
          </div>
          {copilot && <KartaSzkicu p={copilot} />}
        </>}
  </div>;
}
