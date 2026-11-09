import React from "react";
import { useZdrowie } from "../api/rozmowy";

/* ── Etykieta instancji w nagłówku ─────────────────────────────────────────
   Dev i produkcja potrafią chodzić na tej samej maszynie (DEPLOY.md, „dev
   obok produkcji"), a oba panele wyglądają identycznie. Kolektor ma swoją
   pastylkę DEV z tego samego powodu.

   STOI W NAGŁÓWKU, nie w stanie systemu: pytanie „czy patrzę na właściwy
   serwer" pada przed każdym innym, z każdej zakładki. Na produkcji nie ma
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
