import React from "react";
import { Check } from "lucide-react";
import type { SzczegolReklamacji } from "../api/typy";
import { dniSlowo, dzienMiesiac, ile, odmien } from "../ui";
import { rozstrzygniecie } from "./statusy";

/* ── DROGA SPRAWY W JEDNYM RZĘDZIE ───────────────────────────────────────────
   Makieta właściciela: sześć kroków od zakupu do rozliczenia, poziomo pod
   głowicą. Agent widzi jednym spojrzeniem, gdzie stoi sprawa i ile zostało
   do terminu, zamiast składać to z dat rozsianych po kolumnach.

   STAN KROKU TRZEMA CECHAMI, nie samą barwą (WCAG 1.4.1). Zrobiony ma pełną
   kropkę z ptaszkiem, bieżący pierścień i pogrubiony napis, przyszły pusty
   okrąg. Czytnik słyszy bieżący przez `aria-current="step"`.

   BRAK DANYCH TO KROK BEZ DATY. Gdy nie znamy dnia doręczenia, krok stoi bez
   daty, a nie z dniem zgadniętym z zakupu. Zmyślona data na drodze sprawy
   byłaby argumentem w rozmowie z klientem, którego nie mamy.

   WĄSKI EKRAN PRZEWIJA RZĄD W POZIOMIE. Sześć kroków po 104 px nie mieści się
   w kolumnie telefonu, a zawinięty rząd przestaje czytać się jak droga.     */

type StanKroku = "zrobiony" | "biezacy" | "przyszly";

export interface KrokDrogi {
  klucz: "zakup" | "doreczono" | "zgloszenie" | "rozmowa" | "decyzja" | "rozliczenie";
  etykieta: string;
  /** Dopisek pod nazwą; pusty, gdy nie ma czego powiedzieć bez zgadywania. */
  podpis: string;
  stan: StanKroku;
}

/* Czym kończy się uznanie — od tego zależy, co jest do rozliczenia. */
const ROZLICZENIE_WERDYKTU: Record<string, string> = {
  ACCEPTED_REPAIR: "naprawa",
  ACCEPTED_EXCHANGE: "wymiana",
  ACCEPTED_REFUND: "zwrot pieniędzy",
  ACCEPTED_PARTIAL_REFUND: "częściowy zwrot",
};

/* Czego chce klient (`PostPurchaseIssueExpectation.name`), zanim zapadł werdykt. */
const ROZLICZENIE_OCZEKIWANIA: Record<string, string> = {
  REPAIR: "naprawa", EXCHANGE: "wymiana", REFUND: "zwrot pieniędzy", PARTIAL_REFUND: "częściowy zwrot",
};

/* Werdykt z panelu liczy się od chwili, gdy mógł wyjść. `send_failed` nie
   wyszedł, więc decyzja dalej czeka. */
const WYSZEDL = new Set(["sending", "sent", "send_uncertain"]);

const sklej = (...czesci: Array<string | null | false | undefined>) =>
  czesci.filter((c): c is string => Boolean(c)).join(" · ");

/** Kroki drogi z danych sprawy — czysta funkcja, żeby test nie potrzebował DOM-u. */
export function krokiDrogi(s: SzczegolReklamacji): KrokDrogi[] {
  const r = s.reklamacja;
  const kupiono = s.zamowienie?.kupionoAt ?? r.kupionoAt;
  const doreczono = s.przesylka?.dostarczonoAt ?? null;
  const naszWerdykt = r.werdykt !== null && WYSZEDL.has(r.werdyktStatus ?? "");
  const zAllegro = rozstrzygniecie(r.statusAllegro);
  const zapadla = naszWerdykt || zAllegro !== null;
  const odrzucona = naszWerdykt ? String(r.werdykt).startsWith("REJECTED") : zAllegro === "odrzucona";

  const poDniach = r.zgloszonoPoDniach;
  const odstep = poDniach == null ? null
    : poDniach === 0 ? "w dniu zakupu"
      : `po ${poDniach} ${odmien(poDniach, "dniu", "dniach", "dniach")}`;

  /* Werdykt z Centrum Sprzedaży nie ma u nas chwili ani autora, więc podpis
     mówi tylko, że zapadł poza panelem. */
  const decyzja = naszWerdykt
    ? sklej(r.werdyktAt && dzienMiesiac(r.werdyktAt), r.werdyktNazwa)
    : zAllegro !== null
      ? `${zAllegro} poza panelem`
      : r.poTerminie
      ? sklej(r.decyzjaDo && `termin minął ${dzienMiesiac(r.decyzjaDo)}`)
      : sklej(r.decyzjaDo && `do ${dzienMiesiac(r.decyzjaDo)}`,
          r.dniDoTerminu !== null && dniSlowo(r.dniDoTerminu));

  const rozliczenie = odrzucona ? "bez rozliczenia"
    : naszWerdykt ? (ROZLICZENIE_WERDYKTU[String(r.werdykt)] ?? "")
      : ROZLICZENIE_OCZEKIWANIA[r.oczekiwanie ?? ""] ?? "";

  /* Rozmowa bez jednej wiadomości nie jest krokiem, który się odbył. Stoi
     więc pusta także przed bieżącą decyzją: werdykt bywa wydany bez słowa. */
  const rozmowaBylo = r.wiadomosciIle > 0;

  return [
    { klucz: "zakup", etykieta: "Zakup", stan: "zrobiony",
      podpis: sklej(kupiono && dzienMiesiac(kupiono), s.zamowienie?.platnoscAt && "opłacono") },
    { klucz: "doreczono", etykieta: "Doręczono", stan: "zrobiony",
      podpis: sklej(doreczono && dzienMiesiac(doreczono), s.przesylka?.przewoznik) },
    { klucz: "zgloszenie", etykieta: "Zgłoszenie", stan: "zrobiony",
      podpis: sklej(r.otwartoAt && dzienMiesiac(r.otwartoAt), odstep) },
    { klucz: "rozmowa", etykieta: "Rozmowa", stan: rozmowaBylo ? "zrobiony" : "przyszly",
      podpis: rozmowaBylo
        ? sklej(ile(r.wiadomosciIle, "wiadomość", "wiadomości", "wiadomości"),
            r.ostatniaWiadomoscAt && `ostatnia ${dzienMiesiac(r.ostatniaWiadomoscAt)}`)
        : "bez wiadomości" },
    { klucz: "decyzja", etykieta: "Decyzja", stan: zapadla ? "zrobiony" : "biezacy", podpis: decyzja },
    /* Po odrzuceniu nie ma czego rozliczać, więc żaden krok nie jest bieżący:
       sprawa skończyła się na decyzji. Końca rozliczenia panel nie zna. */
    { klucz: "rozliczenie", etykieta: "Rozliczenie", stan: zapadla && !odrzucona ? "biezacy" : "przyszly",
      podpis: rozliczenie },
  ];
}

const KROPKA: Record<StanKroku, string> = {
  zrobiony: "bg-ranga-ok",
  biezacy: "border-[3px] border-ranga-uwaga bg-white",
  przyszly: "border-2 border-slate-300 bg-white",
};

const NAPIS: Record<StanKroku, string> = {
  zrobiony: "font-semibold text-wertis-ink",
  biezacy: "font-bold text-ranga-uwaga",
  przyszly: "font-medium text-slate-600",
};

/* Stan dla czytnika: kropka i ptaszek są `aria-hidden`, więc słowo musi
   stać w tekście, inaczej niewidomy dostałby same nazwy kroków. */
const STAN_SLOWEM: Record<StanKroku, string> = {
  zrobiony: "zrobione", biezacy: "teraz", przyszly: "przed nami",
};

export function DrogaSprawy({ szczegol }: { szczegol: SzczegolReklamacji }) {
  const kroki = krokiDrogi(szczegol);
  return <ol aria-label="Droga sprawy"
    className="flex list-none overflow-x-auto border-t border-slate-200 bg-wertis-paper px-5 pb-4 pt-3.5">
    {kroki.map((k, i) => {
      const ostatni = i === kroki.length - 1;
      return <li key={k.klucz} aria-current={k.stan === "biezacy" ? "step" : undefined}
        className="flex min-w-[104px] flex-[1_0_104px] flex-col gap-1.5">
        <span className="flex items-center" aria-hidden="true">
          <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full ${KROPKA[k.stan]}`}>
            {k.stan === "zrobiony" && <Check size={12} strokeWidth={3.2} className="text-white" />}
          </span>
          {/* Linia za krokiem zielenieje, gdy krok jest za nami: droga
              przebyta ma ten sam kolor co jej kropki. */}
          {!ostatni && <span className={`mx-1.5 h-0.5 flex-1 ${
            k.stan === "zrobiony" ? "bg-ranga-ok" : "bg-slate-300"}`} />}
        </span>
        <span className="flex flex-col pr-2">
          <span className={`text-sm ${NAPIS[k.stan]}`}>
            {k.etykieta}<span className="sr-only">, {STAN_SLOWEM[k.stan]}</span></span>
          {k.podpis && <span className="text-xs text-slate-600">{k.podpis}</span>}
        </span>
      </li>;
    })}
  </ol>;
}
