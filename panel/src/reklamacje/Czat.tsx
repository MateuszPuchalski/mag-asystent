import React from "react";
import { Paperclip } from "lucide-react";
import type { Reklamacja, WiadomoscReklamacji, ZalacznikReklamacji } from "../api/typy";
import { pobierzZalacznik } from "../api/reklamacje";
import { czas } from "../ui";

/* ── Rozmowa w sprawie reklamacyjnej ─────────────────────────────────────────
   Treść zgłoszenia i czat są tym, po co agent otwiera ten ekran, więc stoją
   w GŁÓWNYM oknie — tak samo jak produkty przy zwrocie od 0.167.0. Kolumna
   dowodów niesie fakty o sprawie, nie jej treść.

   ROLA AUTORA JEST PODPISEM, a nie ozdobą. Rozmowa reklamacyjna bywa
   trójstronna: `BUYER`, `SELLER` i `ADMIN`, czyli doradca Allegro. Bez
   wyraźnego podpisu agent odpowiadałby doradcy tak, jak odpowiada klientowi. */

const ROLE: Record<string, { etykieta: string; klasa: string; nasza: boolean }> = {
  BUYER: { etykieta: "Klient", klasa: "bg-white border-slate-200", nasza: false },
  SELLER: { etykieta: "My", klasa: "bg-amber-50 border-amber-200", nasza: true },
  ADMIN: { etykieta: "Doradca Allegro", klasa: "bg-sky-50 border-sky-200", nasza: false },
  SYSTEM: { etykieta: "Allegro (automat)", klasa: "bg-slate-50 border-slate-200", nasza: false },
  FULFILLMENT: { etykieta: "Magazyn Allegro", klasa: "bg-slate-50 border-slate-200", nasza: false },
};

function Zalaczniki({ reklamacjaId, lista }: {
  reklamacjaId: number; lista: ZalacznikReklamacji[];
}) {
  if (!lista.length) return null;
  return <div className="mt-2 flex flex-wrap gap-2">
    {lista.map((z) => (
      /* PRZYCISK, nie odnośnik. Sesja jedzie nagłówkiem `x-session`, którego
         `<a href>` nie niesie — pobranie załącznika rozmowy było z tego powodu
         zepsute od 0.155.0 do 0.219.1 i wyglądało, jakby działało. */
      <button key={z.id} type="button"
        onClick={() => { void pobierzZalacznik(reklamacjaId, z.id, z.nazwa); }}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white
          px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <Paperclip size={12} />{z.nazwa || "załącznik"}
      </button>
    ))}
  </div>;
}

export function Czat({ reklamacja, czat, zalaczniki }: {
  reklamacja: Reklamacja;
  czat: WiadomoscReklamacji[];
  /** Załączniki SAMEJ sprawy — te spoza rozmowy. */
  zalaczniki: ZalacznikReklamacji[];
}) {
  /* Ile wiadomości Allegro widzi, a ilu jeszcze nie mamy. Rozmowa dociąga się
     taktem synchronizacji, więc świeża sprawa bywa przez chwilę niepełna —
     i ekran ma to POWIEDZIEĆ, zamiast pokazywać urwaną rozmowę jak całą. */
  const brakuje = Math.max(0, reklamacja.wiadomosciIle - czat.length);

  return <div className="flex min-h-0 flex-col gap-3">
    {/* Zgłoszenie: powód, oczekiwanie i opis własnymi słowami klienta. */}
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Zgłoszenie</h3>
      <p className="mt-1 text-sm text-slate-800">
        {reklamacja.powodOpis ?? reklamacja.opis ?? "Klient nie opisał sprawy własnymi słowami."}
      </p>
      <Zalaczniki reklamacjaId={reklamacja.id} lista={zalaczniki} />
    </section>

    {brakuje > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <b>Ta rozmowa jest niepełna:</b> Allegro widzi {reklamacja.wiadomosciIle} wiadomości,
      a mamy {czat.length}. Reszta dojdzie następną synchronizacją.
    </p>}

    {czat.length === 0
      ? <p className="p-6 text-center text-sm text-slate-500">
          Rozmowy jeszcze nie pobrano.</p>
      : <ol className="flex flex-col gap-2">
          {czat.map((w) => {
            const rola = ROLE[w.autorRola ?? ""] ?? {
              etykieta: w.autorRola ?? "Nieznany autor",
              klasa: "bg-white border-slate-200", nasza: false,
            };
            return <li key={w.id}
              className={`rounded-lg border p-3 ${rola.klasa} ${rola.nasza ? "ml-8" : "mr-8"}`}>
              <div className="flex items-center gap-2 text-xs">
                <b className="text-slate-700">{rola.etykieta}</b>
                {/* Login bywa PUSTY i to jest udokumentowane: schemat mówi „not
                    present if role is ADMIN, SYSTEM or FULFILLMENT". */}
                {w.autorLogin && <span className="text-slate-500">{w.autorLogin}</span>}
                <span className="ml-auto text-slate-400">{czas(w.utworzonoAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{w.tresc}</p>
              <Zalaczniki reklamacjaId={reklamacja.id} lista={w.zalaczniki} />
            </li>;
          })}
        </ol>}

    {/* Zdanie o tym, czego panel NIE robi, jest tu tak samo potrzebne jak
        sama rozmowa: bez niego pusty ekran pod czatem obiecywałby odpowiedź. */}
    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
      {reklamacja.czatAktywny
        ? "Odpowiedź i formalny werdykt wysyła się na razie w Centrum Sprzedaży Allegro. Ten panel je czyta."
        : "Allegro zamknęło rozmowę w tej sprawie — nowej wiadomości nie przyjmie."}
    </p>
  </div>;
}
