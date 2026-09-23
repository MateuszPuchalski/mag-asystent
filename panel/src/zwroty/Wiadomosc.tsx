import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareText } from "lucide-react";
import type { Zwrot } from "../api/typy";
import { zlote } from "../api/zwroty";
import { Skopiuj } from "../ui";

/* ── Gotowa wiadomość do klienta (0.476.0) ─────────────────────────────────
   Wywiad z właścicielem, 23 września 2026: wiadomości do klientów przy
   zwrotach to głównie uszkodzony towar i pomniejszony zwrot. Każdą pisało się
   od zera, przepisując z ekranu nazwy, kwoty i powody.

   SZABLON, NIE WYSYŁKA. Panel odpisuje w istniejących wątkach skrzynki, ale
   nie zakłada nowych — a przy zwrocie wątku zwykle nie ma. Treść idzie więc
   do schowka: operator wkleja ją w wątek albo w Allegro i może ją poprawić.
   Automat piszący do klienta w imieniu firmy to osobna decyzja właściciela.

   TREŚĆ Z FAKTÓW ZWROTU: nazwy, powody potrąceń, kwota, numer zamówienia.
   Szablon pojawia się tylko wtedy, gdy ma o czym mówić — lista pusta, gdy
   zwrot nie dał jeszcze powodu do wiadomości.                              */

export interface SzablonWiadomosci { id: string; tytul: string; tresc: string }

const POZDROWIENIE = "\n\nPozdrawiamy\nObsługa sklepu";

/** Szablony, które mają treść dla TEGO zwrotu — w kolejności przydatności. */
export function szablonyWiadomosci(z: Zwrot): SzablonWiadomosci[] {
  const zamowienie = z.zamowienie?.externalId ?? z.orderId ?? null;
  const doZamowienia = zamowienie ? ` do zamówienia ${zamowienie}` : "";
  const kwota = z.kwotaGrosze !== null ? zlote(z.kwotaGrosze, z.waluta) : null;
  const out: SzablonWiadomosci[] = [];

  const potracone = z.pozycje.filter((p) => (p.potracenieGrosze ?? 0) > 0);
  if (potracone.length) {
    const linie = potracone.map((p) =>
      `– ${p.nazwa}: ${(p.potraceniePowod ?? "").trim() || "ślady użycia"}`
      + ` (potrącenie ${zlote(p.potracenieGrosze ?? 0, z.waluta)})`).join("\n");
    out.push({
      id: "pomniejszony", tytul: "Pomniejszony zwrot",
      tresc: `Dzień dobry,\n\ndziękujemy za odesłanie zwrotu${doZamowienia}. `
        + `Przy rozpakowaniu stwierdziliśmy:\n${linie}\n\n`
        + `Dlatego zwrot pomniejszamy o wartość, o którą zmniejszyła się wartość rzeczy`
        + (kwota ? `, i oddajemy ${kwota}.` : ".")
        + ` Pieniądze wrócą tą samą drogą, którą opłacono zamówienie.`
        + POZDROWIENIE,
    });
  }

  const uszkodzone = z.pozycje.filter((p) => p.ocena === "utylizacja");
  if (uszkodzone.length) {
    out.push({
      id: "uszkodzony", tytul: "Towar dotarł uszkodzony",
      tresc: `Dzień dobry,\n\nodesłany towar${doZamowienia} dotarł do nas uszkodzony: `
        + `${uszkodzone.map((p) => p.nazwa).join(", ")}. `
        + `Czy mogą Państwo napisać, w jakim stanie był przy nadaniu? `
        + `Jeśli mają Państwo zdjęcia paczki, prosimy o nie w odpowiedzi.`
        + POZDROWIENIE,
    });
  }

  if (z.werdykt === "odrzucony") {
    out.push({
      id: "odmowa", tytul: "Odmowa zwrotu",
      tresc: `Dzień dobry,\n\nniestety nie możemy przyjąć zwrotu${doZamowienia}.`
        + (z.werdyktPowod ? ` Powód: ${z.werdyktPowod}.` : "")
        + ` Jeśli chcą Państwo to wyjaśnić, prosimy o odpowiedź na tę wiadomość.`
        + POZDROWIENIE,
    });
  }

  if (z.werdykt === "przyjety" && kwota && !potracone.length) {
    out.push({
      id: "przyjety", tytul: "Zwrot przyjęty",
      tresc: `Dzień dobry,\n\nprzyjęliśmy zwrot${doZamowienia} i oddajemy ${kwota}. `
        + `Pieniądze wrócą tą samą drogą, którą opłacono zamówienie.`
        + POZDROWIENIE,
    });
  }
  return out;
}

export function Wiadomosc({ zwrot }: { zwrot: Zwrot }) {
  const szablony = szablonyWiadomosci(zwrot);
  const [wybrany, setWybrany] = useState<string | null>(null);
  const [tresc, setTresc] = useState("");
  if (!szablony.length) return null;
  const rozmowa = zwrot.rozmowy[0] ?? null;

  const wybierz = (s: SzablonWiadomosci) => { setWybrany(s.id); setTresc(s.tresc); };

  return <div className="border-t border-slate-200 p-2 text-xs">
    <div className="flex flex-wrap items-center gap-1.5">
      <MessageSquareText size={14} aria-hidden="true" className="text-slate-500" />
      <span className="text-slate-600">Wiadomość do klienta:</span>
      {szablony.map((s) => <button key={s.id} type="button" onClick={() => wybierz(s)}
        aria-pressed={wybrany === s.id}
        className={`rounded-full border px-2 py-0.5 ${wybrany === s.id
          ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
        {s.tytul}</button>)}
    </div>
    {wybrany && <div className="mt-2">
      {/* Pole do poprawek — szablon zna fakty, ale nie zna tonu tej rozmowy. */}
      <textarea className="field h-40 w-full text-xs" value={tresc}
        aria-label="Treść wiadomości do klienta" onChange={(e) => setTresc(e.target.value)} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Skopiuj tekst={tresc} tytul="Skopiuj wiadomość" />
        <span className="text-slate-600">Skopiuj i wklej w rozmowę z klientem.</span>
        {rozmowa && <Link to={`/obsluga/skrzynka/${rozmowa.id}`}
          className="text-sky-700 underline underline-offset-2">Otwórz rozmowę</Link>}
      </div>
    </div>}
  </div>;
}
