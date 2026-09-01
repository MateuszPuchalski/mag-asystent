import React from "react";
import { Lock, Send } from "lucide-react";
import { Przycisk } from "../ui";

/**
 * Edytor odpowiedzi (§10.4).
 *
 * Wysyłka jest wyłączona w tym wydaniu i przycisk mówi to wprost, zamiast
 * udawać, że działa. Przełącznik „komentarz wewnętrzny" i reszta paska
 * narzędzi dochodzą w kolejnych etapach — tu ma być miejsce, w które da się
 * je dołożyć bez ruszania kolejki i osi.
 */
export function Edytor({ szkic, cudza, wlasciciel, zapisuje, onZmiana, onZapisz }: {
  szkic: string;
  cudza: boolean;
  wlasciciel: string | null;
  zapisuje: boolean;
  onZmiana: (v: string) => void;
  onZapisz: () => void;
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
      {/* Wysyłka do Allegro wchodzi w etapie 3 razem z kolejką `outbox`,
          kluczem idempotencji i kontrolą świeżości. Do tego czasu żadna
          treść nie wychodzi z WERTIS na zewnątrz. */}
      <Przycisk disabled title="Wysyłka do Allegro wchodzi w kolejnym wydaniu">
        <Send size={16} />WYŚLIJ (wkrótce)</Przycisk>
      <span className="ml-auto text-xs text-slate-400">{szkic.length} znaków</span>
    </div>
  </div>;
}
