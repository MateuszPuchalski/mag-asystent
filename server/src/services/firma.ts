import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import { logEvent } from "./events.js";

/* ── Dane firmy (0.444.0) ──────────────────────────────────────────────────
   Nagłówek wydruków biura. Przeniesione z localStorage na serwer, bo dane
   jednej firmy trzymane osobno w każdej przeglądarce rozjeżdżały się po
   cichu: nowe biurko drukowało protokół z pustym nagłówkiem.

   ZAPIS PODMIENIA CAŁOŚĆ, jak reguły strefy: formularz zawsze wysyła sześć
   pól, więc „łatka" pojedynczego pola nie ma czytelnika, a miałaby własny
   przypadek brzegowy (pole pominięte kontra pole wyczyszczone).

   LIMIT 200 ZNAKÓW NA POLE. Najdłuższa realna wartość to adres z nazwą
   ulicy, ~80 znaków. Limit nie jest walidacją treści, tylko zaporą przed
   wklejeniem całego dokumentu w pole, które potem stoi na każdym wydruku. */

export const POLA_FIRMY = ["nazwa", "nip", "adres", "miejscowosc", "osoba", "telefon"] as const;
export type PoleFirmy = (typeof POLA_FIRMY)[number];
export type DaneFirmy = Record<PoleFirmy, string>;

export const MAKS_ZNAKOW = 200;

export interface StanFirmy {
  dane: DaneFirmy;
  /** `null`, dopóki nikt nie zapisał — panel wtedy proponuje przeniesienie z przeglądarki. */
  zmieniono: { at: string; przez: string } | null;
}

const PUSTE: DaneFirmy = { nazwa: "", nip: "", adres: "", miejscowosc: "", osoba: "", telefon: "" };

export function daneFirmy(database: DatabaseSync = db()): StanFirmy {
  const w = database.prepare(
    `SELECT nazwa, nip, adres, miejscowosc, osoba, telefon, zmieniono_at, zmieniono_przez
     FROM firma WHERE id = 1`,
  ).get() as (DaneFirmy & { zmieniono_at: string; zmieniono_przez: string }) | undefined;
  if (!w) return { dane: { ...PUSTE }, zmieniono: null };
  const dane = { ...PUSTE };
  for (const p of POLA_FIRMY) dane[p] = w[p];
  return { dane, zmieniono: { at: w.zmieniono_at, przez: w.zmieniono_przez } };
}

export class BladFirmy extends Error {}

/** Zapis całego kompletu. Rzuca `BladFirmy` na złe dane — trasa zamienia to na 400. */
export function zapiszDaneFirmy(
  wejscie: Partial<Record<PoleFirmy, unknown>>,
  autor: string,
  database: DatabaseSync = db(),
): StanFirmy {
  const dane = { ...PUSTE };
  for (const p of POLA_FIRMY) {
    const v = wejscie[p];
    if (v != null && typeof v !== "string") throw new BladFirmy(`Pole ${p} musi być tekstem`);
    const t = (v ?? "").trim();
    if (t.length > MAKS_ZNAKOW) throw new BladFirmy(`Pole ${p} ma ${t.length} znaków — najwyżej ${MAKS_ZNAKOW}`);
    dane[p] = t;
  }
  const teraz = new Date().toISOString();
  database.prepare(
    `INSERT INTO firma (id, nazwa, nip, adres, miejscowosc, osoba, telefon, zmieniono_at, zmieniono_przez)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET nazwa = excluded.nazwa, nip = excluded.nip, adres = excluded.adres,
       miejscowosc = excluded.miejscowosc, osoba = excluded.osoba, telefon = excluded.telefon,
       zmieniono_at = excluded.zmieniono_at, zmieniono_przez = excluded.zmieniono_przez`,
  ).run(dane.nazwa, dane.nip, dane.adres, dane.miejscowosc, dane.osoba, dane.telefon, teraz, autor);
  /* Ślad mówi, KTÓRE pola były wypełnione, a nie ich treść: NIP i telefon
     firmy nie są tajne, ale dziennik nie jest miejscem na kopię danych. */
  logEvent("firma_zapis", autor, null, { wypelnione: POLA_FIRMY.filter((p) => dane[p] !== "") },
    undefined, database);
  return { dane, zmieniono: { at: teraz, przez: autor } };
}
