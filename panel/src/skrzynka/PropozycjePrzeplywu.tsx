import React, { useState } from "react";
import { Bot } from "lucide-react";
import type { PropozycjaPrzeplywu } from "../api/typy";
import { useWerdyktPrzeplywu } from "../api/copilot";
import { Przycisk } from "../ui";
import { NAZWA_KATEGORII } from "./statusy";

/**
 * „AUTOMAT BY…" — PRZEPŁYW KATEGORII W TRYBIE CIENIA.
 *
 * Automat zapisuje, co BY zrobił przy tym rozpoznaniu, a agent mówi „tak"
 * albo „nie". Nic nie idzie do klienta i nic nie zmienia się samo. Żywe
 * wykonanie wejdzie per kategoria dopiero po liczbach z pomiaru, więc każdy
 * werdykt tutaj jest głosem w tamtej decyzji.
 *
 * KARTA STOI NAD ODPOWIEDZIĄ, obok formularza pomiaru. Zlecenie dla hali
 * i znacznik „pilne" to kroki przed odpowiedzią klientowi, nie po niej.
 *
 * PRZYCISKI TYLKO TAM, GDZIE AGENT JEST SĘDZIĄ. „Wysłałby szkic" ocenia
 * wysyłka: szkic poszedł bez zmian albo z poprawką. Drugi przycisk przy tym
 * samym pytaniu kazałby agentowi decydować dwa razy (dekalog, punkt 5).
 * Wiersz z werdyktem traci przyciski i mówi, kto rozstrzygnął.
 *
 * Hak mutacji stoi w osobnym komponencie, za warunkiem pustej listy, jak
 * w `BrakZakupu`. Rozmowa bez propozycji nie potrzebuje klienta zapytań,
 * a testy nagłówka rysują ją bez niego.
 */
type Wlasciwosci = {
  rozmowaId: number;
  /** `undefined` znosimy jak pustą listę: karta milczy, zamiast wywracać rozmowę. */
  propozycje: PropozycjaPrzeplywu[] | undefined;
};

export function PropozycjePrzeplywu(p: Wlasciwosci) {
  if (!p.propozycje?.length) return null;
  return <Karta rozmowaId={p.rozmowaId} propozycje={p.propozycje} />;
}

/** Czym automat BY się zajął — zdanie w trybie przypuszczającym, bo nic się nie stało. */
function opis(pr: PropozycjaPrzeplywu): string {
  if (pr.rodzaj === "wyslij") return "wysłał szkic bez zmian";
  if (pr.rodzaj === "krok") return `zlecił hali: ${pr.instrukcja ?? "weryfikację"}`;
  return "oznaczył jako pilne";
}

/** Napisy przycisku zgody — mówią, co się stanie, a nie „Tak". */
const ZGODA: Record<"krok" | "pilne", string> = { krok: "Zleć", pilne: "Oznacz" };
/* Pełna nazwa „Nie" dla czytnika ekranu: przy kroku i pilnym naraz dwa
   gołe „Nie" brzmiałyby tak samo. Zaczyna się od napisu z ekranu, żeby
   sterowanie głosem trafiało w przycisk po tym, co widać. */
const SPRZECIW: Record<"krok" | "pilne", string> = { krok: "Nie zlecaj hali", pilne: "Nie oznaczaj jako pilne" };

/**
 * Werdykt zdaniem. Przy wysyłce słowo „zgoda" samo nic nie mówi, więc
 * dopisujemy, co zrobił agent ze szkicem. Przy kroku i pilnym — że krok
 * naprawdę się wykonał, bo zgoda go wykonuje.
 */
function werdyktSlowem(pr: PropozycjaPrzeplywu): string {
  if (pr.rodzaj === "wyslij") return pr.werdykt === "zgoda" ? "zgoda — wysłany bez zmian" : "sprzeciw — poprawiony";
  if (pr.werdykt === "sprzeciw") return "sprzeciw";
  return pr.rodzaj === "krok" ? "zgoda — zlecone hali" : "zgoda — oznaczone jako pilne";
}

function Karta({ rozmowaId, propozycje }: { rozmowaId: number; propozycje: PropozycjaPrzeplywu[] }) {
  const werdykt = useWerdyktPrzeplywu();
  const [blad, setBlad] = useState("");
  /* Wszystkie propozycje dotyczą jednej decyzji, więc i jednej kategorii.
     Nazwa stoi w nagłówku, bo poprawność „pilne" zależy od tego, czy
     rozpoznanie trafiło, a kategoria w nagłówku rozmowy siedzi pod „⋯". */
  const kat = propozycje[0].kategoria;
  const nazwa = (NAZWA_KATEGORII as Record<string, string>)[kat] ?? kat;

  const rozstrzygnij = (pr: PropozycjaPrzeplywu, w: "zgoda" | "sprzeciw") => {
    setBlad("");
    werdykt.mutate({ rozmowaId, propozycjaId: pr.id, werdykt: w },
      { onError: (e) => setBlad((e as Error).message) });
  };

  return <section aria-label="Automat by"
    className="ml-auto w-full max-w-[75ch] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
    <p className="flex flex-wrap items-baseline gap-x-1.5">
      <Bot size={14} className="shrink-0 self-center text-slate-600" aria-hidden="true" />
      <b>Automat by…</b>
      <span className="text-slate-600">{nazwa}</span>
      <span className="text-xs text-slate-600">· tryb cienia — nic nie dzieje się samo</span>
    </p>
    <ul className="mt-1 space-y-1">
      {propozycje.map((pr) => <li key={pr.id} data-rodzaj={pr.rodzaj}
        className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0">{opis(pr)}</span>
        {pr.werdykt
          ? <span className="text-xs text-slate-600">
              {werdyktSlowem(pr)}{pr.werdyktPrzez && ` · ${pr.werdyktPrzez}`}</span>
          : pr.rodzaj === "wyslij"
            ? <span className="text-xs text-slate-600">oceni to wysyłka</span>
            : <span className="ml-auto flex gap-2">
                {/* Martwe w trakcie zapisu: drugi klik dałby 409 za werdykt już wysłany. */}
                <Przycisk className="px-3 py-1 text-xs" disabled={werdykt.isPending}
                  onClick={() => rozstrzygnij(pr, "zgoda")}>{ZGODA[pr.rodzaj]}</Przycisk>
                <Przycisk className="px-3 py-1 text-xs" disabled={werdykt.isPending}
                  aria-label={SPRZECIW[pr.rodzaj]}
                  onClick={() => rozstrzygnij(pr, "sprzeciw")}>Nie</Przycisk>
              </span>}
      </li>)}
    </ul>
    {blad && <p role="alert" className="mt-1 text-xs text-ranga-zle">{blad}</p>}
  </section>;
}
