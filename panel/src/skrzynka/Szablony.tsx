import React, { useState } from "react";
import { FileText, Pencil, Plus, X as Krzyzyk } from "lucide-react";
import { Przycisk } from "../ui";
import {
  useArchiwizujSzablon, useDodajSzablon, useSzablony, useZmienSzablon, type Szablon,
} from "../api/szablony";

/**
 * Szablony odpowiedzi (0.399.0).
 *
 * Zgłoszenie właściciela: „dodaj ten szablon do szablonów odpowiedzi
 * w skrzynce". Szablonów nie było wcale — §10.4 wymieniał je wśród rzeczy
 * planowanych i sam pisał „Nie ma szablonów". Agenci wklejali te zdania
 * z notatnika, więc każda ich wersja była trochę inna.
 *
 * WSTAWIA DO SZKICU, NIE WYSYŁA. Treść ląduje w polu i dalej wymaga „Wyślij do
 * klienta" — druga zasada nadrzędna projektu panelu mówi, że treść wychodzi
 * z WERTIS wyłącznie na kliknięcie człowieka. Szablon skraca pisanie, nie
 * zastępuje decyzji.
 *
 * DOPISUJE, NIE NADPISUJE — ten sam kontrakt, co każda inna wstawka w tym
 * edytorze (wynik magazyniera, parametry towaru, zdanie doboru). Szkic jest
 * współdzielony z zespołem, więc nadpisanie kasowałoby cudzą pracę bez pytania.
 * Jedyną świadomą drogą nadpisania zostaje „Zastąp" przy szkicu Copilota.
 *
 * BEZ PODSTAWIANIA DANYCH. Treść wchodzi dosłownie, bez `{{numer}}`: zła
 * wartość wjechałaby do wiadomości wysłanej do klienta, a agent zobaczyłby ją
 * dopiero po fakcie.
 */
export function Szablony({ onWstaw, wylaczone = false }: {
  /** Dopisanie treści do szkicu; ekran decyduje, jak ją skleić z tym, co jest. */
  onWstaw: (tresc: string) => void;
  /** Cudza rozmowa — szkicu i tak nie zapiszemy, więc wstawka byłaby obietnicą. */
  wylaczone?: boolean;
}) {
  const [otwarte, setOtwarte] = useState(false);
  const [edytowany, setEdytowany] = useState<Szablon | "nowy" | null>(null);
  const [nazwa, setNazwa] = useState("");
  const [tresc, setTresc] = useState("");
  const [blad, setBlad] = useState("");
  const lista = useSzablony();
  const dodaj = useDodajSzablon();
  const zmien = useZmienSzablon();
  const archiwizuj = useArchiwizujSzablon();
  const szablony = lista.data?.szablony ?? [];
  const trwa = dodaj.isPending || zmien.isPending || archiwizuj.isPending;

  const zamknijEdycje = () => { setEdytowany(null); setNazwa(""); setTresc(""); setBlad(""); };

  const otworzEdycje = (s: Szablon | "nowy") => {
    setEdytowany(s);
    setNazwa(s === "nowy" ? "" : s.nazwa);
    setTresc(s === "nowy" ? "" : s.tresc);
    setBlad("");
  };

  const zapisz = () => {
    setBlad("");
    const po = { onSuccess: () => zamknijEdycje(), onError: (e: unknown) => setBlad((e as Error).message) };
    if (edytowany === "nowy") dodaj.mutate({ nazwa, tresc }, po);
    else if (edytowany) zmien.mutate({ id: edytowany.id, nazwa, tresc }, po);
  };

  return <div className="relative">
    <button type="button" disabled={wylaczone}
      onClick={() => setOtwarte((o) => !o)}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300">
      <FileText size={13} />Szablony
    </button>

    {otwarte && <div className="absolute right-0 z-20 mt-1 w-[28rem] max-w-[90vw] rounded-lg border bg-white p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <b className="text-sm">Szablony odpowiedzi</b>
        <button type="button" onClick={() => otworzEdycje("nowy")}
          className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900">
          <Plus size={12} />Nowy</button>
        <button type="button" aria-label="Zamknij szablony"
          onClick={() => { setOtwarte(false); zamknijEdycje(); }}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <Krzyzyk size={14} /></button>
      </div>

      {edytowany !== null
        ? <div className="mt-2 space-y-2">
            <input className="field text-sm" value={nazwa} aria-label="Nazwa szablonu"
              placeholder="Nazwa — po niej wybierasz z listy"
              onChange={(e) => setNazwa(e.target.value)} />
            <textarea className="field min-h-[160px] text-sm" value={tresc}
              aria-label="Treść szablonu"
              placeholder="Treść, która wejdzie do szkicu — dosłownie, bez podstawiania danych"
              onChange={(e) => setTresc(e.target.value)} />
            <div className="flex items-center gap-2">
              <Przycisk wariant="glowny" disabled={trwa || !nazwa.trim() || !tresc.trim()}
                onClick={zapisz}>{trwa ? "Zapisuję…" : "Zapisz szablon"}</Przycisk>
              <button type="button" onClick={zamknijEdycje}
                className="text-sm text-slate-500 underline underline-offset-2">Anuluj</button>
              {/* Limit Allegro widać PRZY PISANIU, nie po odmowie zapisu. */}
              <span className={`ml-auto text-podpis ${tresc.length > 2000
                ? "font-bold text-red-700" : "text-slate-500"}`}>{tresc.length} / 2000</span>
            </div>
            {blad && <p className="text-xs text-red-700">{blad}</p>}
          </div>
        : <>
            {lista.isLoading && <p className="mt-2 text-xs text-slate-500">Wczytuję…</p>}
            {!lista.isLoading && szablony.length === 0 && <p className="mt-2 text-xs text-slate-500">
              Nie ma jeszcze żadnego szablonu. „Nowy" zakłada pierwszy.</p>}
            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
              {szablony.map((s) => <li key={s.id} className="rounded border border-slate-200 p-2">
                <div className="flex items-baseline gap-2">
                  <b className="min-w-0 flex-1 truncate text-sm">{s.nazwa}</b>
                  <button type="button" aria-label={`Popraw szablon ${s.nazwa}`}
                    onClick={() => otworzEdycje(s)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Pencil size={12} /></button>
                  {/* ZDJĘCIE, NIE KASOWANIE (§25a.5): szablon wraca z archiwum,
                      a przy nim wisi historia tego, co poszło do klientów. */}
                  <button type="button" disabled={trwa}
                    onClick={() => archiwizuj.mutate({ id: s.id, archiwalny: true })}
                    className="text-podpis text-slate-500 underline underline-offset-2 hover:text-slate-800">
                    zdejmij</button>
                </div>
                {/* Podgląd DWÓCH linijek: agent rozpoznaje szablon po początku,
                    a całość i tak przeczyta w szkicu, zanim wyśle. */}
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-slate-600">
                  {s.tresc}</p>
                <button type="button" disabled={wylaczone}
                  onClick={() => { onWstaw(s.tresc); setOtwarte(false); }}
                  className="mt-1 text-xs font-semibold text-wertis-ink underline underline-offset-2 disabled:text-slate-300">
                  Wstaw do szkicu</button>
              </li>)}
            </ul>
          </>}
    </div>}
  </div>;
}
