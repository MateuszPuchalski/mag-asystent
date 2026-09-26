import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Keyboard, Search, X } from "lucide-react";
import { OknoSzukania } from "./Szukaj";
/* „Czy klawisz padł w polu" pyta jeden strażnik (0.515.0): własna kopia
   w tym pliku była tą samą funkcją pod inną nazwą. */
import { polePisania } from "./fokus";
import { Klawisz } from "./Klawisz";

/* ── Jedna lista skrótów i klawisze całego panelu (23 września 2026) ────────
   Każda kolejka miała swoją pomoc pod „?", widoczną dopiero po najechaniu
   i tylko na tym jednym ekranie. Kto chciał wiedzieć, czym chodzi się po
   zwrotach, musiał na nie wejść. Dekalog p. 2 — rozpoznanie tańsze od
   pamiętania — wymaga jednego miejsca na wszystkie.

   KLAWISZ `?` otwiera listę z każdego ekranu, a sekcja bieżącego ekranu stoi
   na górze. Lista jest DANYMI, nie opisem: ta sama tablica, z której czyta
   test, więc skrót dopisany w kodzie ekranu i pominięty tutaj jest widoczną
   luką w jednym pliku, a nie ciszą rozsianą po czterech.

   TE SAME KLAWISZE NA KAŻDEJ KOLEJCE: `j`/`k`, cyfry kubełków i Ctrl+Enter
   przy odpowiedzi. `Z` zostaje różny i to jest świadome: w skrzynce kończy
   rozmowę, w zwrotach oddaje pieniądze od 0.284.0. Przestawienie pieniędzy
   pod inną literę uczyłoby biuro od nowa czynności nieodwracalnej. */

export interface SekcjaSkrotow {
  tytul: string;
  /** Przedrostek adresu, na którym sekcja jest „tu jesteś"; `null` — wszędzie. */
  sciezka: string | null;
  klawisze: ReadonlyArray<readonly [string, string]>;
}

export const SKROTY: ReadonlyArray<SekcjaSkrotow> = [
  { tytul: "Wszędzie", sciezka: null, klawisze: [
    ["Ctrl K", "szukaj: zamówienie, login, zwrot, list, symbol, EAN"],
    ["?", "ta lista"],
    ["Esc", "zamknij okno"],
  ] },
  { tytul: "Każda kolejka", sciezka: null, klawisze: [
    ["j k", "następna / poprzednia sprawa"],
    ["1–9", "kubełek"],
  ] },
  { tytul: "Skrzynka", sciezka: "/obsluga/skrzynka", klawisze: [
    ["Ctrl Enter", "wyślij odpowiedź"],
    ["Ctrl Shift Enter", "wyślij i zakończ"],
    ["Z", "zakończ / otwórz rozmowę"],
    /* Opis idzie za napisem przycisku, który od 0.500.0 mówi „Wstaw do
       odpowiedzi" (0.515.0): stary opis obiecywał poprawianie. */
    ["E", "wstaw szkic do odpowiedzi"],
    ["R", "odrzuć szkic Copilota"],
  ] },
  { tytul: "Reklamacje", sciezka: "/obsluga/reklamacje", klawisze: [
    ["Ctrl Enter", "wyślij odpowiedź"],
    ["m", "moje sprawy"],
    ["n", "niczyje sprawy"],
  ] },
  { tytul: "Dyskusje", sciezka: "/obsluga/dyskusje", klawisze: [
    ["Ctrl Enter", "wyślij odpowiedź"],
    ["m", "moje sprawy"],
    ["n", "niczyje sprawy"],
  ] },
  { tytul: "Zwroty", sciezka: "/obsluga/zwroty", klawisze: [
    ["P", "przyjmij zwrot"],
    ["O", "odmów (w ocenie: outlet)"],
    ["s u", "ocena: na stan / utylizacja"],
    ["Shift S", "wszystkie na stan"],
    ["Z", "oddaj pieniądze"],
    ["Enter", "zapisz kwotę / numer korekty"],
    ["R", "cofnij korektę"],
  ] },
];

export function ListaSkrotow({ onZamknij }: { onZamknij: () => void }) {
  const { pathname } = useLocation();
  /* Sekcja bieżącego ekranu na górze, zaraz po klawiszach „wszędzie" —
     o nią agent zwykle pyta. Reszta w stałej kolejności. */
  const tutaj = SKROTY.filter((s) => s.sciezka && pathname.startsWith(s.sciezka));
  const kolejnosc = [...SKROTY.filter((s) => !s.sciezka), ...tutaj,
    ...SKROTY.filter((s) => s.sciezka && !tutaj.includes(s))];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onZamknij(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onZamknij]);
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[10vh]"
    onClick={onZamknij}>
    {/* `text-slate-900` jawnie (0.515.0): okno rysuje się wewnątrz nagłówka,
        który ma `text-white`. Tytuł i ikona dziedziczyły biel na białym tle
        i nie było ich widać — zmierzone w przeglądarce przy uproszczeniu. */}
    <div role="dialog" aria-label="Skróty klawiszowe" onClick={(e) => e.stopPropagation()}
      className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-2xl">
      <div className="mb-3 flex items-center gap-2">
        <Keyboard size={18} /><b className="mr-auto text-naglowek">Skróty klawiszowe</b>
        <button type="button" onClick={onZamknij} aria-label="Zamknij listę skrótów"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {kolejnosc.map((s) => <section key={s.tytul} aria-label={s.tytul}>
          <p className={`mb-1 text-xs font-bold ${tutaj.includes(s) ? "text-slate-900" : "text-slate-600"}`}>
            {s.tytul}{tutaj.includes(s) && " · tu jesteś"}</p>
          <ul className="space-y-1">
            {s.klawisze.map(([k, opis]) => <li key={k + opis} className="flex items-center gap-2 text-sm">
              <span className="flex w-36 shrink-0 flex-wrap gap-0.5">
                {k.split(" ").map((c) => <Klawisz key={c}>{c}</Klawisz>)}</span>
              <span className="text-slate-700">{opis}</span>
            </li>)}
          </ul>
        </section>)}
      </div>
    </div>
  </div>;
}

/**
 * Przycisk szukania w nagłówku i oba okna — szukanie (Ctrl+K) i lista
 * skrótów (`?`). Jeden nasłuch na cały panel, stąd jeden komponent.
 */
export function SzukajIKlawisze() {
  const [szukanie, setSzukanie] = useState(false);
  const [lista, setLista] = useState(false);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      /* Ctrl+K działa TAKŻE w polu: agent pisze odpowiedź, a numer zamówienia
         chce sprawdzić teraz, nie po wyjściu z pola. Przeglądarka pod Ctrl+K
         trzyma własne szukanie w sieci — tu wygrywa panel. */
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); setLista(false); setSzukanie(true); return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey && !polePisania(e.target)) {
        e.preventDefault(); setSzukanie(false); setLista((o) => !o);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  return <>
    <button type="button" onClick={() => setSzukanie(true)} aria-keyshortcuts="Control+K"
      className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/15">
      <Search size={16} />Szukaj
      {/* kontrast: pasek stoi na #303030, gdzie slate-400 daje 5.14:1 */}
      <kbd className="rounded border border-white/20 px-1 font-mono text-podpis text-slate-400">Ctrl K</kbd>
    </button>
    {szukanie && <OknoSzukania onZamknij={() => setSzukanie(false)} />}
    {lista && <ListaSkrotow onZamknij={() => setLista(false)} />}
  </>;
}
