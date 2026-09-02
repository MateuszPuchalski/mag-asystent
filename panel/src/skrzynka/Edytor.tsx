import React, { useState } from "react";
import { Lock, MessageSquare, Send } from "lucide-react";
import { Przycisk } from "../ui";

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
}) {
  const [tryb, setTryb] = useState<"odpowiedz" | "komentarz">("odpowiedz");
  const wKomentarzu = tryb === "komentarz";

  const przelacz = (id: number) => onWzmianki(
    wzmianki.includes(id) ? wzmianki.filter((x) => x !== id) : [...wzmianki, id]);

  return <div className={`shrink-0 border-t p-4 ${wKomentarzu ? "bg-amber-50" : ""}`}>
    {/* Przełącznik trybu stoi NAD polem, żeby było widać, gdzie się pisze,
        zanim się zacznie pisać. */}
    <div className="mb-2 flex gap-1 text-xs font-bold">
      <button className={`rounded px-2 py-1 ${!wKomentarzu ? "bg-slate-200" : "text-slate-500"}`}
        onClick={() => setTryb("odpowiedz")}>Odpowiedź do klienta</button>
      <button className={`rounded px-2 py-1 ${wKomentarzu ? "bg-amber-200" : "text-slate-500"}`}
        onClick={() => setTryb("komentarz")}>
        <MessageSquare size={12} className="inline" /> Komentarz wewnętrzny
      </button>
    </div>

    {wKomentarzu
      ? <>
          <textarea className="field min-h-20" value={komentarz}
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
              onClick={onDodajKomentarz}>
              <MessageSquare size={16} />{komentuje ? "ZAPISUJĘ…" : "DODAJ KOMENTARZ"}
            </Przycisk>
            <span className="text-xs text-amber-800">Widoczne tylko dla zespołu.</span>
            <span className="ml-auto text-xs text-slate-400">{komentarz.length} znaków</span>
          </div>
        </>
      : <>
          {cudza && <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <Lock size={13} />Rozmowę prowadzi {wlasciciel} — szkic zapisze tylko właściciel.</p>}
          <textarea className="field min-h-20" value={szkic} aria-label="Szkic odpowiedzi"
            onChange={(e) => onZmiana(e.target.value)}
            placeholder="Szkic odpowiedzi — współdzielony z zespołem" />
          <div className="mt-2 flex items-center gap-2">
            <Przycisk onClick={onZapisz} disabled={cudza || zapisuje}>
              {zapisuje ? "ZAPISUJĘ…" : "ZAPISZ SZKIC"}</Przycisk>
            {/* Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na
                zewnątrz, i idzie WYŁĄCZNIE na kliknięcie człowieka. Automat nie
                wysyła nic — druga zasada nadrzędna projektu panelu. */}
            <Przycisk wariant="glowny" onClick={onWyslij} disabled={cudza || wysyla || !szkic.trim()}>
              <Send size={16} />{wysyla ? "WYSYŁAM…" : "WYŚLIJ DO KLIENTA"}</Przycisk>
            <span className="ml-auto text-xs text-slate-400">{szkic.length} znaków</span>
          </div>
        </>}
  </div>;
}
