import { db as defaultDb, type Db } from "../db/db.js";
import { ZDARZENIA } from "./zdarzenia-rejestr.js";

/* ── Czego nikt nie używa (23 września 2026) ─────────────────────────────────
   Panel rośnie o przycisk w każdym wydaniu, a nic z niego nie schodzi, bo
   nikt nie wie, co jest martwe. Zgadywanie kończy się sporem, a dziennik
   zdarzeń ma odpowiedź: każda zmiana w panelu i na kolektorze zapisuje wpis.

   CZYSTY ODCZYT `events`. Żadnej nowej tabeli i żadnego licznika dopisywanego
   przy otwarciu ekranu — zero zapisu przy patrzeniu obowiązuje też tu, więc
   raport widzi CZYNNOŚCI, nie wejścia na ekran. Ekran, na który się tylko
   patrzy, będzie tu zawsze „nieużywany"; mówi to nagłówek raportu.

   AUTOMATY ODPADAJĄ. Wpis z workera, synchronizacji albo kolektora
   meldującego baterię nie jest czyjąś decyzją, więc jego brak nie znaczy,
   że funkcję można zdjąć. */

const AUTOMATY = new Set([
  "copilot_auto_klasyfikacja", "copilot_auto_klasyfikacja_sufit", "copilot_auto_szkic",
  "copilot_auto_szkic_sufit", "copilot_przed_praca", "copilot_szkic_po_rozpoznaniu", "pasowanie_siec", "pasowanie_siec_silnik", "ean_conflict_autoresolved", "http_rejected", "login_failed",
  "privileged", "read_model_po_imporcie", "kopia_bazy", "migawka_dnia", "raport_tygodnia", "aktualizacja_automatyczna", "aktualizacja_wynik", "rekoncyliacja", "wiedza_automat_przebieg", "zwrot_rabat_automat_blad",
  "queue_applied", "queue_failed", "queue_retry", "device_drop", "battery_low", "scan_timing",
  "siec_przerwa", "rozmowa_przeczytana_blad", "rozmowa_wysylka_blad", "rozmowa_wysylka_niepewna",
  "rozmowa_wysylka_konflikt", "rozmowa_wysylka_uzgodniona", "reklamacja_wysylka_konflikt",
  "reklamacja_zalacznik_bez_location", "allegro_zamowienie_brak", "ean_conflict", "location_mismatch",
]);

/* Obszar po PRZEDROSTKU typu. Typy nazywa się od bytu, którego dotyczą,
   więc przedrostek jest ekranem — tańsze niż opis przy każdym z 240 wpisów. */
const OBSZARY: Array<[string, string]> = [
  ["rozmowa_", "Skrzynka"], ["skrzynka_", "Skrzynka"], ["wzmianka_", "Skrzynka"],
  ["obsluga.", "Skrzynka"], ["zamowienie_", "Skrzynka"], ["przesylka_", "Skrzynka"],
  ["klient_notatka", "Profil klienta"], ["klient_", "Skrzynka"], ["copilot_", "Copilot"], ["klasyfikacja_", "Copilot"],
  ["dobor_", "Dobór części"], ["kosz_", "Kosze"], ["zwrot", "Zwroty"],
  ["reklamacj", "Reklamacje"], ["dyskusja_", "Dyskusje"], ["sprawa_tag", "Tagi spraw"],
  ["wiedza_", "Wiedza"], ["pasowanie_", "Wiedza"], ["zabudowa_", "Wiedza"], ["token_", "Wiedza"],
  ["alias_", "Wiedza"], ["wykaz_", "Wiedza"], ["zamiennosc_", "Wiedza"], ["odsylacze_", "Wiedza"], ["oferta_", "Wiedza"],
  ["delivery_", "Dostawy"], ["przyjecie_", "Dostawy"], ["notatka_", "Dostawy"],
  ["zadanie_terenowe", "Zadania"], ["brak_na_serwis", "Zadania"],
  ["putaway", "Kolektor"], ["karton_", "Kolektor"], ["location_", "Kolektor"],
  ["przesuniecie", "Kolektor"], ["scan", "Kolektor"], ["manual_entry", "Kolektor"],
  ["search", "Kolektor"], ["ean_", "Kolektor"], ["zdjecie_", "Kolektor"], ["problem_", "Kolektor"],
  ["user_", "Ustawienia"], ["logo_", "Ustawienia"], ["firma_", "Ustawienia"],
  ["strefa_", "Ustawienia"], ["magazyny_", "Ustawienia"], ["allegro_", "Ustawienia"],
  ["zbiorki_", "Ustawienia"], ["analiza_", "Wgląd"], ["raport_", "Wgląd"], ["migawka_", "Wgląd"], ["audyt_", "Wgląd"], ["queue_", "Stan systemu"],
  ["login", "Logowanie"],
];

export function obszarZdarzenia(typ: string): string {
  return OBSZARY.find(([p]) => typ.startsWith(p))?.[1] ?? "Inne";
}

export interface WpisUzycia {
  typ: string;
  /** Ile razy w oknie. */
  ile: number;
  /** Ostatni raz w całym dzienniku; `null` — nigdy. */
  ostatnio: string | null;
}

export interface RaportUzycia {
  dni: number;
  obszary: Array<{ obszar: string; nieuzywane: WpisUzycia[]; uzywane: WpisUzycia[] }>;
  /** Typy w dzienniku, których rejestr nie zna — dziura w rejestrze albo stary typ. */
  spozaRejestru: WpisUzycia[];
}

/**
 * Raport użycia za ostatnie `dni` dni: co ludzie robili i czego nie ruszyli.
 * „Nieużywane" idą PIERWSZE w każdym obszarze — po to ten raport istnieje.
 */
export function raportUzycia(dni = 30, teraz = new Date(), database: Db = defaultDb()): RaportUzycia {
  const od = new Date(teraz.getTime() - dni * 86_400_000).toISOString();
  const wiersze = database.prepare(`
    SELECT type, SUM(created_at >= ?) AS ile, MAX(created_at) AS ostatnio
      FROM events GROUP BY type`).all(od) as Array<{ type: string; ile: number; ostatnio: string }>;
  const zDziennika = new Map(wiersze.map((w) => [w.type, w]));

  const obszary = new Map<string, { nieuzywane: WpisUzycia[]; uzywane: WpisUzycia[] }>();
  for (const typ of ZDARZENIA) {
    if (AUTOMATY.has(typ)) continue;
    const w = zDziennika.get(typ);
    const wpis: WpisUzycia = { typ, ile: Number(w?.ile ?? 0), ostatnio: w?.ostatnio ?? null };
    const o = obszarZdarzenia(typ);
    if (!obszary.has(o)) obszary.set(o, { nieuzywane: [], uzywane: [] });
    (wpis.ile > 0 ? obszary.get(o)!.uzywane : obszary.get(o)!.nieuzywane).push(wpis);
  }
  const znane = new Set(ZDARZENIA);
  return {
    dni,
    obszary: [...obszary.entries()]
      .map(([obszar, x]) => ({
        obszar,
        nieuzywane: x.nieuzywane.sort((a, b) => (a.ostatnio ?? "").localeCompare(b.ostatnio ?? "")),
        uzywane: x.uzywane.sort((a, b) => b.ile - a.ile),
      }))
      /* Obszar z największą liczbą martwych czynności na górze — tam jest
         najwięcej do zdjęcia. */
      .sort((a, b) => b.nieuzywane.length - a.nieuzywane.length || a.obszar.localeCompare(b.obszar)),
    spozaRejestru: wiersze.filter((w) => !znane.has(w.type) && !AUTOMATY.has(w.type))
      .map((w) => ({ typ: w.type, ile: Number(w.ile), ostatnio: w.ostatnio }))
      .sort((a, b) => b.ile - a.ile),
  };
}
