import React from "react";
import { Lock, Send } from "lucide-react";
import { Przycisk } from "../ui";

/**
 * Edytor odpowiedzi (§10.4).
 *
 * Przycisk komentarza i przycisk wysyłki do klienta mają być jednoznacznie
 * rozdzielone (§10.4). Przełącznik komentarza wewnętrznego i reszta paska
 * narzędzi dochodzą w kolejnym etapie — tu ma być miejsce, w które da się je
 * dołożyć bez ruszania kolejki i osi.
 */
export function Edytor({ szkic, cudza, wlasciciel, zapisuje, wysyla, onZmiana, onZapisz, onWyslij }: {
  szkic: string;
  cudza: boolean;
  wlasciciel: string | null;
  zapisuje: boolean;
  wysyla: boolean;
  onZmiana: (v: string) => void;
  onZapisz: () => void;
  onWyslij: () => void;
}) {
  return <div className="border-t p-4">
    {cudza && <p className="mb-2 flex items-center gap-2 text-xs text-slate-500">
      <Lock size={13} />Rozmowę prowadzi {wlasciciel} — szkic zapisze tylko właściciel.</p>}
    <textarea className="field min-h-20" value={szkic} aria-label="Szkic odpowiedzi"
      onChange={(e) => onZmiana(e.target.value)}
      placeholder="Szkic odpowiedzi — współdzielony z zespołem" />
    <div className="mt-2 flex items-center gap-2">
      <Przycisk onClick={onZapisz} disabled={cudza || zapisuje}>
        {zapisuje ? "ZAPISUJĘ…" : "ZAPISZ SZKIC"}</Przycisk>
      {/* Wysyłka jest jedyną drogą, którą treść wychodzi z WERTIS na zewnątrz,
          i idzie WYŁĄCZNIE na kliknięcie człowieka. Automat nie wysyła nic —
          druga zasada nadrzędna projektu panelu. */}
      <Przycisk wariant="glowny" onClick={onWyslij} disabled={cudza || wysyla || !szkic.trim()}>
        <Send size={16} />{wysyla ? "WYSYŁAM…" : "WYŚLIJ DO KLIENTA"}</Przycisk>
      <span className="ml-auto text-xs text-slate-400">{szkic.length} znaków</span>
    </div>
  </div>;
}
