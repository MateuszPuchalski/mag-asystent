import React, { useState } from "react";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Kopilot, Rozmowa, StanCopilota, WynikPartii } from "../api/typy";
import { NAZWA_KATEGORII, NAZWA_PEWNOSCI } from "./statusy";

/* ── Copilot nad kolejką (§14, etap F) ───────────────────────────────────────
   PRZYCISK STOI NAD KOLEJKĄ, NIE W ROZMOWIE, i to jest decyzja. W rozmowie
   etykietowałby treść, którą agent WŁAŚNIE PRZECZYTAŁ — wartość bliska zeru,
   a koszt byłby kroplówką: każde otwarcie zaprasza do kliknięcia, nikt tych
   kliknięć nie liczy i po miesiącu nie wiadomo, na co poszły pieniądze.
   Kroplówka psuje pomiar, dla którego cały ten przyrost powstał.

   Nad kolejką przycisk wiąże wydatek z zamiarem: „mam przerobić nieprzypisane
   — powiedz mi, co w nich jest". Bierze rozmowy z kubełka, na który agent
   właśnie patrzy, więc liczba w napisie jest liczbą, którą agent widzi.

   Osobny plik, żeby `Kolejka.tsx` nie puchła: kolejka ma jedno zadanie i to
   nie jest rozmawianie z dostawcą.

   Komponenty są CZYSTE — żadnego `useQuery` ani `useMutation`. Cały katalog
   `skrzynka/` tak stoi: haki mieszkają w `ekrany/`, a widoki dostają dane
   i wywołania w propsach. Hak wciągnięty tutaj kazałby każdemu testowi
   kolejki stawiać `QueryClientProvider` — czyli podnosiłby koszt testu
   komponentowi, który z zapytaniami nie ma nic wspólnego.

   Dekalog ergonomii, punkt 2 (mniej decyzji) i 10 (powiedz, co się stało):
   przycisk niesie LICZBĘ, potwierdzenie mówi wprost, że to kosztuje, a
   podsumowanie partii podaje wynik zdaniem, nie odznaką na każdym wierszu. */

/** Rozmowy, które partia W OGÓLE weźmie: nierozpoznane albo z etykietą starą. */
export const doRozpoznania = (rozmowy: Rozmowa[]): Rozmowa[] =>
  rozmowy.filter((r) => r.kopilot === null || r.kopilot.nieaktualna);

function podsumowanie(w: WynikPartii): string {
  const czesci = [`Rozpoznano ${w.sklasyfikowane}`];
  /* Pominięte i błędne LICZYMY OSOBNO: pominięta rozmowa nic nie kosztowała,
     błędna kosztowała i nic nie dała. Zlanie ich w „nie wyszło" zabrałoby
     człowiekowi jedyną informację, po której pozna, czy dopłacił za nic. */
  if (w.pominiete.length) czesci.push(`${w.pominiete.length} pominięto`);
  if (w.bledy.length) czesci.push(`${w.bledy.length} bez rozstrzygnięcia`);
  return `${czesci.join(", ")}.`;
}

/**
 * Pasek nad kolejką: przycisk, potwierdzenie, podsumowanie partii.
 *
 * `stan` przyjeżdża z serwera, bo to serwer wie, czy klucz jest — panel nie
 * zgaduje tego z ciszy. Zdanie „dlaczego nie" pisze serwer z tego samego
 * powodu: przyczyn jest kilka (tryb, brak klucza), a panel nie ma prawa
 * wybierać, którą pokaże.
 */
export function PasekCopilota({ stan, kandydaci, trwa = false, wynik = null, blad = null,
  onRozpoznaj }: {
  stan: StanCopilota | undefined;
  /** Nierozpoznane rozmowy z OGLĄDANEGO kubełka — liczy je kolejka. */
  kandydaci: Rozmowa[];
  trwa?: boolean;
  /** Wynik OSTATNIEJ partii. `null` = jeszcze nic nie klikano. */
  wynik?: WynikPartii | null;
  blad?: string | null;
  onRozpoznaj: (rozmowyId: number[]) => void;
}) {
  const [pyta, setPyta] = useState(false);

  /* ── PASMO POJAWIA SIĘ, GDY MA CO POWIEDZIEĆ (0.251.0) ────────────────────
     Do 0.249.1 pasek stał ZAWSZE. Wyłączony Copilot zajmował pełne pasmo
     zdaniem o pliku konfiguracyjnym — przy każdym otwarciu skrzynki, na
     zawsze, bo to fakt wdrożenia, nie treść kolejki. Rozpoznany kubełek
     zajmował drugie tyle martwym przyciskiem „Wszystkie rozmowy w tym
     kubełku są rozpoznane", czyli pasmem na donos o BRAKU roboty.

     Dwa pasma na dwa niezdarzenia, w kolumnie, która istnieje po to, żeby
     pokazywać PYTANIA (dekalog ergonomii, punkt 2: pierwszeństwo ma to, co
     rozstrzyga bieżącą czynność). Fakt nie ginie — niesie go `ZnakCopilota`
     w nagłówku kolejki, w tym samym miejscu co zawsze i za darmo. */
  if (!stan || !stan.wlaczony) return null;

  const partia = kandydaci.slice(0, stan.maxPartia).map((r) => r.id);
  const nadmiar = kandydaci.length - partia.length;

  /* Nie ma czego rozpoznawać i nie ma czego rozliczyć — cisza. Wynik i błąd
     ostatniej partii ZOSTAJĄ, bo za nie zapłacono i agent ma prawo wiedzieć,
     co dostał; to jest zdarzenie, a nie jego brak. */
  if (partia.length === 0 && !wynik && !blad && !trwa) return null;

  if (trwa) {
    return <p className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
      Rozpoznaję {partia.length} rozmów…</p>;
  }

  if (pyta) {
    return <div className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
      {/* Potwierdzenie mówi TRZY rzeczy, bo bez każdej z nich agent klika
          w ciemno: ile, co wychodzi na zewnątrz i że to kosztuje. */}
      <p>Rozpoznam <b>{partia.length}</b> rozmów. Treść pytań — bez danych
        osobowych — pójdzie do dostawcy i <b>to kosztuje</b>.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary text-xs"
          onClick={() => { setPyta(false); onRozpoznaj(partia); }}>Rozpoznaj</button>
        <button type="button" className="btn-secondary text-xs"
          onClick={() => setPyta(false)}>Nie teraz</button>
      </div>
    </div>;
  }

  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
    {partia.length > 0 && <button type="button" className="btn-secondary flex items-center gap-1 text-xs"
      onClick={() => setPyta(true)}>
      <Sparkles size={14} />
      Rozpoznaj {partia.length} {partia.length === 1 ? "rozmowę" : "rozmów"}
    </button>}
    {/* Reszta kubełka nie znika po cichu: limit jest hamulcem na wydatek,
        a nie obietnicą, że to już wszystko. */}
    {nadmiar > 0 && <span className="text-slate-500">
      pozostanie {nadmiar} — limit partii to {stan.maxPartia}</span>}
    {/* PRZERWANA PARTIA POKAZUJE OBIE POŁOWY, i to jest cała racja zwracania
        200 zamiast błędu. Do 0.191.0 zdanie o przerwie WYPIERAŁO podsumowanie,
        więc po limicie w połowie czternastu agent nie wiedział, że osiem jest
        już rozpoznanych — a to za nie zapłaciliśmy. Człowiek, który nie wie,
        co się udało, klika jeszcze raz i płaci drugi raz. */}
    {wynik?.przerwane && <span className="font-semibold text-amber-800">{wynik.przerwane}</span>}
    {wynik && <span className="text-slate-600">{podsumowanie(wynik)}</span>}
    {blad && <span className="font-semibold text-ranga-zle">{blad}</span>}
  </div>;
}

/**
 * Znak Copilota w NAGŁÓWKU kolejki (0.251.0).
 *
 * Przejmuje to, co do 0.249.1 zajmowało całe pasmo nad listą: powód, dla
 * którego Copilot nie działa, oraz wiadomość, że w kubełku nie ma już czego
 * rozpoznawać. Obie rzeczy są STANAMI SPOCZYNKU — mówią, że nic się nie
 * dzieje — a stan spoczynku nie ma prawa zajmować pasma w kolumnie, która
 * pokazuje pytania klientów.
 *
 * Nie jest przyciskiem, bo nie ma czego wywołać. Klikalny znak, który nic nie
 * robi, uczy nie klikać — tę naukę plik nosi od 0.191.1 i ona zostaje.
 *
 * Milczy, gdy JEST co rozpoznawać: wtedy mówi pasmo, i to głośniej, bo tam
 * stoi liczba i przycisk.
 */
export function ZnakCopilota({ stan, kandydaci }: {
  stan: StanCopilota | undefined;
  kandydaci: Rozmowa[];
}) {
  if (!stan) return null;
  if (stan.wlaczony && kandydaci.length > 0) return null;
  const powod = stan.wlaczony
    ? "Wszystkie rozmowy w tym kubełku są rozpoznane"
    : stan.powod ?? "Copilot jest wyłączony";
  return <span role="img" title={powod} aria-label={powod}
    className="shrink-0 text-slate-400">
    <Sparkles size={15} /></span>;
}

/**
 * Plakietka kategorii na wierszu kolejki.
 *
 * Wyszarzona, gdy etykieta dotyczy STARSZEJ wiadomości: milczenie o tym byłoby
 * gorsze niż brak etykiety, bo agent czytałby przypuszczenie o zdaniu, którego
 * klient już nie zadaje. Regułę liczy serwer (`nieaktualna`).
 */
export function PlakietkaKategorii({ kopilot }: { kopilot: Kopilot }) {
  /* `nie_wiadomo` też dostaje plakietkę, i to jest celowe: wiersz w bazie
     ISTNIEJE, więc rozmowa nie wróci do partii i nie zapłacimy drugi raz za
     tę samą odpowiedź. Szara plakietka mówi „Copilot nie rozstrzygnął". */
  const szara = kopilot.nieaktualna || kopilot.kategoria === "nie_wiadomo"
    || kopilot.ocena === "nietrafna";
  return <span title={kopilot.nieaktualna
    ? "Rozpoznano starszą wiadomość — klient dopisał później"
    : `Copilot: ${NAZWA_PEWNOSCI[kopilot.pewnosc]}`}
    className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
      szara ? "bg-slate-100 text-slate-600" : "bg-violet-100 text-violet-800"}`}>
    <Sparkles size={11} />{NAZWA_KATEGORII[kopilot.kategoria]}</span>;
}

/**
 * Werdykt człowieka przy otwartej rozmowie.
 *
 * Dwa przyciski i ani jednego więcej. To one, a nie liczba klasyfikacji, są
 * pomiarem — bez nich decyzja „po pomiarze zejdź na tańszy model" nie ma na
 * czym stanąć. Po „nietrafna" plakietka szarzeje i przestaje być wskazówką,
 * ale ZOSTAJE w bazie: skasowana ocena to skasowany pomiar.
 */
export function OcenaKategorii({ kopilot, zapisuje = false, onOcen }: {
  kopilot: Kopilot;
  zapisuje?: boolean;
  onOcen: (ocena: "trafna" | "nietrafna") => void;
}) {
  return <span className="flex items-center gap-1 text-xs">
    <PlakietkaKategorii kopilot={kopilot} />
    {kopilot.ocena
      ? <span className="text-slate-500">
        ocena: {kopilot.ocena === "trafna" ? "trafna" : "nietrafna"}</span>
      : <>
        <button type="button" title="Trafna" aria-label="Trafna" disabled={zapisuje}
          className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
          onClick={() => onOcen("trafna")}>
          <ThumbsUp size={13} /></button>
        <button type="button" title="Nietrafna" aria-label="Nietrafna" disabled={zapisuje}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-ranga-zle"
          onClick={() => onOcen("nietrafna")}>
          <ThumbsDown size={13} /></button>
      </>}
  </span>;
}
