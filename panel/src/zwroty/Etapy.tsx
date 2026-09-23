import React from "react";
import { Banknote, CircleCheck, CircleX, Eye, FileText, Scale, type LucideIcon } from "lucide-react";
import type { Kubelek } from "../api/typy";
import { KUBELKI } from "./Kolejka";

/* ── Oś etapów zwrotu (0.453.0) ──────────────────────────────────────────────
   Zgłoszenie właściciela po przeglądzie ekranu: „ulżyj przeładowaniu tekstem,
   użyj ikon". Ekran mówił, gdzie jest zwrot, zdaniami rozsianymi po sekcjach —
   „Najpierw przyjmij zwrot — pieniądze oddaje się po werdykcie" pod
   pieniędzmi, pytanie kubełka nad listą. Oś mówi to raz, w jednym miejscu:
   pięć przystanków, ten bieżący podświetlony, a to, co przed nim, wyszarzone.

   NAZWY I PYTANIA Z `KUBELKI`, nie własne. Kubełek jest jednym pojęciem na
   całym ekranie; druga lista jego nazw rozjechałaby się z pierwszą przy
   pierwszej zmianie słowa.

   TO NIE JEST `Os.tsx`. Tamta oś opowiada HISTORIĘ — kto, kiedy, co zrobił.
   Ta pokazuje DROGĘ — gdzie sprawa jest i co jeszcze przed nią. Dwie różne
   odpowiedzi, dlatego dwie różne formy: tamta pionowa lista zdań, ta rząd
   znaczników.

   ODRZUCONY SKRACA DROGĘ. Odmowa wyprowadza zwrot z drabiny, więc oś pokazuje
   wtedy dwa przystanki: decyzję i odmowę. Trzy wyszarzone kroki, na które ta
   sprawa nigdy nie wejdzie, byłyby obietnicą bez pokrycia.                   */

/**
 * Ikona kubełka — JEDNA dla osi etapów i kafli kolejki (0.454.0).
 *
 * Słownik ikon z projektu „Zwroty — mniej tekstu" ma zasadę: jedna ikona,
 * jedno znaczenie w całym panelu. Dwie mapy — tu i przy kaflach — rozjechałyby
 * się przy pierwszej zmianie i ta sama waga znaczyłaby dwie różne rzeczy.
 */
export const IKONA_KUBELKA: Record<Kubelek, LucideIcon> = {
  decyzja: Scale, ocena: Eye, zwrot: Banknote, korekta: FileText,
  zamkniety: CircleCheck, odrzucony: CircleX,
};

/** Krótkie nazwy przystanków — etykiety kubełków mówią „Do …", a oś „gdzie". */
const NAZWY: Record<Kubelek, string> = {
  decyzja: "Decyzja", ocena: "Ocena", zwrot: "Zwrot", korekta: "Korekta",
  zamkniety: "Zamknięty", odrzucony: "Odrzucony",
};

const DROGA: Kubelek[] = ["decyzja", "ocena", "zwrot", "korekta", "zamkniety"];

/* ── PIENIĄDZE PO KOREKCIE (0.479.0) ────────────────────────────────────
   Od 0.476.0 zwrot z korektą wraca do DO ZWROTU, póki pieniądze nie wyjdą.
   Oś rysowała wtedy korektę jako krok PRZED nami, choć numer już stał —
   przegląd zwrotów z 23 września. Kolejność idzie więc za faktem: korekta za
   nami, zwrot pieniędzy teraz. Podpowiedź mówi, na co ten przystanek czeka. */
const DROGA_PO_KOREKCIE: Kubelek[] = ["decyzja", "ocena", "korekta", "zwrot", "zamkniety"];

export function Etapy({ kubelek, poKorekcie = false }: {
  kubelek: Kubelek;
  /** Zwrot ma już korektę, a czeka na wyjście pieniędzy (0.479.0). */
  poKorekcie?: boolean;
}) {
  const droga: Kubelek[] = kubelek === "odrzucony" ? ["decyzja", "odrzucony"]
    : poKorekcie && kubelek === "zwrot" ? DROGA_PO_KOREKCIE : DROGA;
  const teraz = droga.indexOf(kubelek);
  const pytanie = (k: Kubelek) => poKorekcie && k === "zwrot"
    ? "Oddać pieniądze?"
    : KUBELKI.find((b) => b.id === k)?.pytanie ?? "";

  return <ol aria-label="Etapy zwrotu"
    className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-4 py-2">
    {droga.map((k, i) => {
      /* Stan końcowy nie jest „bieżącą pracą", więc nie świeci kolorem
         działania: zamknięty jest zielony, odrzucony szary. */
      const klasa = i < teraz
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : i > teraz
          ? "border-slate-200 bg-white text-slate-600"
          : k === "zamkniety"
            ? "border-emerald-300 bg-emerald-100 font-semibold text-emerald-900"
            : k === "odrzucony"
              ? "border-slate-300 bg-slate-200 font-semibold text-slate-800"
              : "border-sky-700 bg-sky-700 font-semibold text-white";
      return <li key={k} className="flex items-center gap-1">
        {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-slate-300" />}
        <span title={i === teraz ? `Teraz: ${pytanie(k)}` : pytanie(k)}
          aria-current={i === teraz ? "step" : undefined}
          className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs ${klasa}`}>
          {React.createElement(IKONA_KUBELKA[k], { size: 13, "aria-hidden": true })}{NAZWY[k]}
        </span>
      </li>;
    })}
  </ol>;
}
