import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, MessageSquare, MessagesSquare, Package, Scale, Search, ShoppingBag,
  Truck, Undo2, UserRound,
} from "lucide-react";
import { useSzukajWszedzie, type RodzajTrafienia, type Trafienie } from "../api/spoiwo";
import { useKartaTowaru } from "../api/rozmowy";
import { Blad, Pusto } from "../ui";
import { PrzyciskTowaru } from "../towar/Szuflada";

/* ── Szukanie ponad kolejkami, Ctrl+K (23 września 2026) ────────────────────
   Każdy ekran miał własne pole szukania i trzeba było wiedzieć, które wybrać.
   Numer przesyłki w ręku nie mówi, czy to zwrot, czy dostawa. Jedno okno
   z każdego ekranu odpowiada na „gdzie to jest" bez znajomości naszego
   podziału na kolejki — punkt 1 dekalogu obsługi.

   OKNO JEST ODCZYTEM. Wynik prowadzi na ekran, gdzie sprawę się załatwia;
   tu nie ma ani jednego przycisku pracy. Towar nie ma ekranu karty, więc jego
   podgląd rysuje się w samym oknie.

   KLAWIATURA NAJPIERW: strzałki po wynikach, Enter otwiera, Esc zamyka.
   Okno otwiera się z każdego ekranu, także z pola tekstowego — Ctrl+K nie
   koliduje z pisaniem, bo żaden edytor panelu go nie używa. */

const RODZAJE: Record<RodzajTrafienia, { nazwa: string; ikona: React.ComponentType<{ size?: number; className?: string }> }> = {
  klient: { nazwa: "Klient", ikona: UserRound },
  rozmowa: { nazwa: "Rozmowa", ikona: MessageSquare },
  zwrot: { nazwa: "Zwrot", ikona: Undo2 },
  reklamacja: { nazwa: "Reklamacja", ikona: Scale },
  dyskusja: { nazwa: "Dyskusja", ikona: MessagesSquare },
  dostawa: { nazwa: "Dostawa", ikona: Truck },
  towar: { nazwa: "Towar", ikona: Package },
  zamowienie: { nazwa: "Zamówienie", ikona: ShoppingBag },
};

export function OknoSzukania({ onZamknij }: { onZamknij: () => void }) {
  const [fraza, setFraza] = useState("");
  /* Pauza w pisaniu, nie każdy znak — ta sama ćwierć sekundy co w archiwum
     dostaw. Serwer przechodzi pięć tabel i kartotekę przy każdym zapytaniu. */
  const [zapytanie, setZapytanie] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setZapytanie(fraza.trim()), 250);
    return () => clearTimeout(t);
  }, [fraza]);
  const wynik = useSzukajWszedzie(zapytanie);
  /* Wpisane TERAZ, nie po pauzie (24 września 2026). Zrzut właściciela:
     pole puste, a okno dalej mówiło „nic nie pasuje do" starej frazy, bo
     komunikat czytał zapytanie sprzed ćwierć sekundy. Stan okna idzie za
     polem; serwer pyta się dalej po pauzie. */
  const wpisane = fraza.trim();
  const czeka = wpisane !== zapytanie || wynik.isFetching;
  const trafienia = useMemo(() => (zapytanie.length >= 3 ? wynik.data?.trafienia ?? [] : []),
    [wynik.data, zapytanie]);
  const [wybrany, setWybrany] = useState(0);
  const [towar, setTowar] = useState<number | null>(null);
  useEffect(() => { setWybrany(0); }, [trafienia]);
  const nawiguj = useNavigate();
  const lista = useRef<HTMLUListElement>(null);

  const otworz = (t: Trafienie) => {
    if (t.rodzaj === "towar") { setTowar(Number(t.id)); return; }
    if (t.cel) { nawiguj(t.cel); onZamknij(); return; }
    if (t.link) window.open(t.link, "_blank", "noopener");
  };

  const naKlawisz = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); if (towar !== null) setTowar(null); else onZamknij(); return; }
    if (towar !== null) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setWybrany((i) => Math.min(trafienia.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setWybrany((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && trafienia[wybrany]) { e.preventDefault(); otworz(trafienia[wybrany]); }
  };
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${wybrany}"]`)?.scrollIntoView({ block: "nearest" });
  }, [wybrany]);

  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
    onClick={onZamknij}>
    <div role="dialog" aria-label="Szukaj wszędzie" onClick={(e) => e.stopPropagation()} onKeyDown={naKlawisz}
      className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <label className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Search size={18} className="shrink-0 text-slate-500" />
        <input autoFocus value={fraza} onChange={(e) => { setFraza(e.target.value); setTowar(null); }}
          aria-label="Szukaj wszędzie" role="combobox" aria-expanded={trafienia.length > 0}
          aria-controls="wyniki-szukania"
          placeholder="Numer zamówienia, login, zwrot, list przewozowy, symbol, EAN…"
          className="min-w-0 flex-1 text-tresc outline-none" />
        <kbd className="rounded border border-slate-300 px-1 font-mono text-podpis text-slate-500">Esc</kbd>
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Blad>{(wynik.error as Error | null)?.message}</Blad>
        {towar !== null
          ? <PodgladTowaru twId={towar} onWstecz={() => setTowar(null)} />
          : wpisane.length < 3
            ? <p className="px-4 py-3 text-sm text-slate-500">Wpisz co najmniej trzy znaki.</p>
            : czeka && trafienia.length === 0
              ? <Pusto waga="lista">Szukam…</Pusto>
              : trafienia.length === 0
                ? <p className="px-4 py-3 text-sm text-slate-500">Nic nie pasuje do „{zapytanie}”.</p>
                : <ul id="wyniki-szukania" ref={lista} role="listbox" aria-label="Wyniki">
                    {trafienia.map((t, i) => {
                      const { nazwa, ikona: Ikona } = RODZAJE[t.rodzaj];
                      return <li key={`${t.rodzaj}-${t.id}`} data-i={i} role="option" aria-selected={i === wybrany}
                        onMouseEnter={() => setWybrany(i)} onClick={() => otworz(t)}
                        /* Zaznaczenie na slate, nie na bursztynie — strażnik
                           `Bursztyn.test.ts`: bursztyn na bieli to ostrzeżenie. */
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                          i === wybrany ? "bg-slate-100" : ""}`}>
                        <Ikona size={16} className="shrink-0 text-slate-500" />
                        <span className="w-24 shrink-0 text-xs font-semibold text-slate-600">{nazwa}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-900">{t.tytul}</span>
                        <span className="shrink-0 text-xs text-slate-500">{t.dlaczego}</span>
                        {!t.cel && t.link && <ExternalLink size={13} className="shrink-0 text-slate-400" />}
                      </li>;
                    })}
                  </ul>}
      </div>
    </div>
  </div>;
}

/* Karta towaru w oknie — panel nie ma ekranu karty, a pytanie przy symbolu
   brzmi zwykle „czy mamy i gdzie leży". Odpowiedź przed danymi, jak w pasmie
   odpowiedzi skrzynki. */
function PodgladTowaru({ twId, onWstecz }: { twId: number; onWstecz: () => void }) {
  const k = useKartaTowaru(twId);
  return <div className="p-4 text-sm">
    <button type="button" onClick={onWstecz}
      className="mb-2 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
      <ArrowLeft size={13} />Wyniki</button>
    {k.isLoading && <Pusto waga="lista">Wczytuję kartę…</Pusto>}
    <Blad>{(k.error as Error | null)?.message}</Blad>
    {k.data && <>
      <p className="font-mono text-xs text-slate-600">
        <PrzyciskTowaru twId={twId}>{k.data.sym}</PrzyciskTowaru></p>
      <p className="font-semibold text-slate-900">{k.data.name}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{k.data.mag.avail}
        <span className="ml-1 text-sm font-normal text-slate-600">{k.data.unit ?? "szt."} dostępne</span></p>
      <p className="text-xs text-slate-600">stan {k.data.mag.stan} · rezerwacje {k.data.mag.rez}</p>
      <p className="mt-2">{k.data.locs.length ? k.data.locs.join(" · ") : "bez lokalizacji"}</p>
      {k.data.ean && <p className="mt-1 font-mono text-xs text-slate-600">EAN {k.data.ean}</p>}
    </>}
  </div>;
}
