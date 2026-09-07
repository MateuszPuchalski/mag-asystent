import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { kopiujDoSchowka } from "./kopiuj";

/* Prymitywy stoją na warstwie `@layer components` z `index.css` (`.card`,
   `.btn-primary`, `.field`). Druga, równoległa konwencja klas kosztowałaby
   więcej, niż daje — a ekranów w panelu ma być kilka, nie kilkadziesiąt. */

export const Karta = ({ className = "", ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={`card ${className}`} {...p} />;

type PrzyciskProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  wariant?: "glowny" | "drugi";
};
export const Przycisk = ({ wariant = "drugi", className = "", ...p }: PrzyciskProps) =>
  <button className={`${wariant === "glowny" ? "btn-primary" : "btn-secondary"} ${className}`} {...p} />;

export const Pole = ({ className = "", ...p }: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`field ${className}`} {...p} />;

/** Plakietka statusu — barwy z tokenów, żeby §7 miało jedno źródło. */
export const KLASA_STATUSU: Record<string, string> = {
  "new": "bg-stan-new text-stan-new-tekst",
  "open": "bg-stan-open text-stan-open-tekst",
  "waiting_for_customer": "bg-stan-klient text-stan-klient-tekst",
  /* „Czeka na nas" pożycza barwę stanu wewnętrznego: oba znaczą „piłka po
     naszej stronie", tylko jeden czeka na słowo, a drugi na pomiar. */
  "waiting_for_us": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "waiting_for_internal": "bg-stan-wewnetrzne text-stan-wewnetrzne-tekst",
  "resolved": "bg-stan-zrobione text-stan-zrobione-tekst",
  "snoozed": "bg-stan-odlozona text-stan-odlozona-tekst",
  "closed": "bg-stan-zamknieta text-stan-zamknieta-tekst",
  "spam": "bg-stan-spam text-stan-spam-tekst",
};
export const Plakietka = ({ status, children, className = "" }:
  { status?: string; children: React.ReactNode; className?: string }) =>
  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
    KLASA_STATUSU[status ?? ""] ?? "bg-slate-100 text-slate-600"} ${className}`}>{children}</span>;

/**
 * Zakładki jednej kolumny (0.180.0).
 *
 * Kolumna dowodów przy ZWROCIE ma sekcje jedna pod drugą, bo to jedna lista
 * faktów o jednej sprawie. Kolumna kontekstu przy ROZMOWIE ma zakładki, bo
 * niesie dwa RÓWNORZĘDNE tematy: co klient kupuje i co mamy na półce.
 * Sekcje kazałyby przewijać obok tematu, którego akurat nie czytasz.
 *
 * `aria-pressed` zamiast roli `tab`: pełny wzorzec zakładek żąda strzałek,
 * `aria-controls` i zarządzania ogniskiem, a to są dwa przyciski przełączające
 * treść pod spodem. Ta sama decyzja co przy kubełkach kolejki.
 */
export function Zakladki<T extends string>({ wybrana, onWybierz, pozycje }: {
  wybrana: T;
  onWybierz: (v: T) => void;
  pozycje: Array<{ klucz: T; etykieta: string }>;
}) {
  return <div className="flex gap-1 border-b border-slate-200 px-2 py-2">
    {pozycje.map((z) => <button key={z.klucz} type="button" aria-pressed={wybrana === z.klucz}
      onClick={() => onWybierz(z.klucz)}
      className={`flex-1 rounded px-2 py-1 text-xs font-semibold ${wybrana === z.klucz
        ? "bg-wertis-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
      {z.etykieta}</button>)}
  </div>;
}

export const Pusto = ({ ikona, children }: { ikona: React.ReactNode; children: React.ReactNode }) =>
  <div className="grid flex-1 place-items-center p-16 text-center text-slate-500">
    {ikona}<p className="mt-3 font-semibold">{children}</p>
  </div>;

export const Blad = ({ children }: { children: React.ReactNode }) =>
  children ? <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{children}</p> : null;

/**
 * Trzy kolumny obu ekranów obsługi — JEDNA definicja (0.198.0).
 *
 * §10.1 mówi: „jeden nawyk, nie dwa" i wymienia wprost układ, SZEROKOŚCI
 * kolumn i przewijanie. Mimo to skrzynka miała kolejkę 22 rem, a zwroty
 * 320 px — rozjazd o 32 piksele, którego nikt nie zdecydował. Stoi tu, żeby
 * następna zmiana szerokości nie musiała trafić w dwa pliki.
 *
 * Kolumny ROSNĄ z ekranem, bo do 0.197.4 nie rosły wcale: `<main>` miał
 * `max-w-[1500px]`, więc monitor 1920 oddawał 210 pikseli na margines
 * z każdej strony, a 2560 — po 530. Właściciel nazwał to wprost:
 * „rozszerzenie kolumn, nie zostawiać niepotrzebnych marginesów po bokach".
 *
 * Rosną SKRAJNE, nie środkowa. W kolejce i w kontekście szerokość zamienia
 * się w treść: mniej uciętych nazw, więcej wiersza tabeli, szersze zdjęcie.
 * W środku zamieniłaby się w dłuższą linijkę tekstu, a linijka na sto
 * dwadzieścia znaków czyta się GORZEJ, nie lepiej — dlatego wypowiedzi mają
 * własny próg czytelności (`Os.tsx`), a nie ten z okna.
 */
export const SIATKA_TRZECH_KOLUMN =
  "grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] " +
  "lg:grid-cols-[21rem_minmax(0,1fr)_21rem] " +
  "xl:grid-cols-[23rem_minmax(0,1fr)_24rem] " +
  "2xl:grid-cols-[25rem_minmax(0,1fr)_28rem]";

/** Czas w formacie, który czyta biuro — jedna funkcja na cały panel. */
export const czas = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pl") : "—";

/**
 * Kopiowanie tekstu, którego nikt nie przepisuje z ekranu ręcznie:
 * identyfikatora zamówienia (UUID) i numeru dokumentu z Subiekta.
 *
 * Stało to od 0.166.0 w `zwroty/Dowody.tsx`. Od 0.176.0 numer paragonu też ma
 * ten przycisk — dopóki kliknięcie nie otwiera dokumentu w Subiekcie (byłby
 * do tego potrzebny program na stanowisku, patrz `docs/architektura.md` §4),
 * schowek jest najkrótszą drogą do okna „Znajdź dokument".
 */
export function Skopiuj({ tekst, tytul = "Kopiuj" }: { tekst: string; tytul?: string }) {
  const { stan, kopiuj } = useKopiowanie(tekst);
  return <button type="button" title={stan === "blad" ? "Nie udało się skopiować" : tytul}
    onClick={kopiuj}
    className={`rounded p-1 hover:bg-slate-100 ${
      stan === "blad" ? "text-ranga-zle" : "text-slate-400 hover:text-slate-700"}`}>
    <Copy size={13} />
    <span className="sr-only">{
      stan === "zrobione" ? "Skopiowano" : stan === "blad" ? "Nie udało się skopiować" : "Kopiuj"}</span>
  </button>;
}

/**
 * Wspólny stan kopiowania: „gotowe", „skopiowano" i „nie udało się".
 *
 * TRZECI STAN JEST TU NAJWAŻNIEJSZY. Do 0.227.0 nieudane kopiowanie kończyło
 * się `.catch(() => {})`, więc ekran mrugał „skopiowano" nad pustym schowkiem —
 * a człowiek dowiadywał się o tym dopiero przy wklejaniu, gdzie indziej.
 * Uzasadnienie samego kopiowania po HTTP stoi w `ui/kopiuj.ts`.
 */
function useKopiowanie(tekst: string) {
  const [stan, setStan] = useState<"gotowe" | "zrobione" | "blad">("gotowe");
  const kopiuj = () => {
    void kopiujDoSchowka(tekst).then((udalo) => {
      setStan(udalo ? "zrobione" : "blad");
      setTimeout(() => setStan("gotowe"), udalo ? 1500 : 3000);
    });
  };
  return { stan, kopiuj };
}

/**
 * LOGIN KLIENTA, KTÓRY KOPIUJE SIĘ KLIKNIĘCIEM (0.228.0).
 *
 * Decyzja właściciela: „loginy klientów powinny być kopiowalne przez
 * kliknięcie". Login jest tym, po czym szuka się klienta w panelu Allegro
 * i w Subiekcie, a przepisywany z ekranu bywa przekręcony — `bagslublin`
 * i `bags1ublin` wyglądają na monitorze tak samo.
 *
 * KLIKALNY JEST SAM LOGIN, nie ikona obok. Ikona zostaje jako znak, że da się
 * kliknąć, ale cel dotyku to całe słowo — mniejszy cel to więcej chybień
 * (`docs/ergonomia-magazynu.md` p. 2).
 *
 * `title` mówi, co się stanie PRZED kliknięciem; `sr-only` mówi, co się stało
 * PO nim. Bez tego drugiego czytnik ekranu milczy o skutku.
 */
export function LoginKlienta({ login, className = "" }: { login: string; className?: string }) {
  const { stan, kopiuj } = useKopiowanie(login);
  return <button type="button" onClick={kopiuj}
    title={stan === "blad" ? "Nie udało się skopiować" : `Kopiuj login: ${login}`}
    className={`group inline-flex max-w-full items-center gap-1 rounded hover:bg-slate-100 ${
      stan === "blad" ? "text-ranga-zle" : ""} ${className}`}>
    <span className="truncate">{login}</span>
    {stan === "zrobione"
      ? <Check size={12} className="shrink-0 text-ranga-ok" />
      : <Copy size={12} className="shrink-0 text-slate-300 group-hover:text-slate-500" />}
    <span className="sr-only">{
      stan === "zrobione" ? "Skopiowano login" : stan === "blad"
        ? "Nie udało się skopiować loginu" : "Kopiuj login"}</span>
  </button>;
}
