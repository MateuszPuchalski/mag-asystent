import React from "react";
import { useZdrowie } from "../api/rozmowy";

/* ── Etykieta instancji w nagłówku (0.446.0, z `biuro.html` 0.69.0) ────────
   Dev i produkcja potrafią chodzić na tej samej maszynie (DEPLOY.md, „dev
   obok produkcji"), a oba panele wyglądają identycznie. Biuro miało na to
   pierwszą linię dymka przy ikonie SYSTEM: „⚠ DEV — to nie jest produkcja".
   Strona zniknęła, a panel tej linii nie przejął — pomyłka instancji była
   znowu możliwa do przeoczenia. Kolektor ma swoją pastylkę DEV od dawna.

   STOI W NAGŁÓWKU, nie w stanie systemu: pytanie „czy patrzę na właściwy
   serwer" pada przed każdym innym, z każdej zakładki. Dolny rząd, obok
   pigułki synchronizacji — górny nie ma na nią miejsca przy 1180 px. Na produkcji nie ma
   jej wcale — wieczny znaczek uczyłby go nie widzieć. Czerwień, bo zapis
   zrobiony na złej instancji jest błędem, którego nikt potem nie znajdzie.

   SAMA NAZWA W PIGUŁCE, zdanie w dymku i w etykiecie. „DEV" na czerwieni
   czyta się tak samo jak pastylka kolektora, a tę ludzie już znają. */
export function EtykietaInstancji() {
  const { data } = useZdrowie();
  const s = data?.srodowisko;
  if (!s || s === "produkcja") return null;
  const zdanie = `${s} — to nie jest produkcja. Zapisy tutaj nie trafiają na produkcję.`;
  return <span role="status" aria-label={zdanie} title={zdanie}
    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
    {s}</span>;
}
