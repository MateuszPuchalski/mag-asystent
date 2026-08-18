import { db } from "../db/db.js";
import { parseAdres, pickingLoc } from "../locs.js";
import { poziomyStrefy, wStrefieZlotej } from "./strefa-zlota.js";
import { progGornych } from "./reslot.js";

/* ── Zbiórki z systemu sprzedażowego → kandydaci do strefy złotej ────────────
   CSV eksportowany z Sellasist (dziś wgrywany ręcznie w /biuro, docelowo
   POST z integracji) niesie każdą pozycję koszyka z datą i symbolem. Z tego
   liczy się częstość zbierania per kartoteka, a z niej — adnotacja „przenieś
   do strefy złotej" na karcie towaru i ranking w panelu biura.

   Miara jest ta sama co w rocznym raporcie przeslotowania (services/reslot.ts):
   POBRANIA = LICZBA WYSTĄPIEŃ pozycji, nie suma sztuk. Indeks zbierany 400×
   po sztuce robi więcej pracy niż zbierany 4× po sto. Próg też jest wspólny —
   `progGornych` — żeby obie ścieżki nigdy nie wskazały sprzecznych list.     */

// ── Parser CSV ──────────────────────────────────────────────────────────────

/**
 * Parser CSV z cudzysłowami (RFC 4180) — pierwszy w repo, więc świadomie
 * najmniejszy możliwy: bez strumieni, bez opcji, jeden przebieg po znakach.
 * Eksport Sellasist ma pola z przecinkami I cudzysłowami w środku (HTML-owe
 * linki), więc `split(",")` nie ma tu prawa bytu.
 */
export function parsujCsv(tekst: string): string[][] {
  const wiersze: string[][] = [];
  let pole = "";
  let wiersz: string[] = [];
  let wCudzyslowie = false;
  // BOM z Excela — zjadany, inaczej pierwszy nagłówek to "﻿..."
  const t = tekst.charCodeAt(0) === 0xfeff ? tekst.slice(1) : tekst;
  for (let i = 0; i < t.length; i++) {
    const z = t[i];
    if (wCudzyslowie) {
      if (z === '"') {
        if (t[i + 1] === '"') {
          pole += '"';
          i++;
        } else wCudzyslowie = false;
      } else pole += z;
    } else if (z === '"') {
      wCudzyslowie = true;
    } else if (z === ",") {
      wiersz.push(pole);
      pole = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && t[i + 1] === "\n") i++;
      wiersz.push(pole);
      pole = "";
      if (wiersz.length > 1 || wiersz[0] !== "") wiersze.push(wiersz);
      wiersz = [];
    } else pole += z;
  }
  if (pole !== "" || wiersz.length > 0) {
    wiersz.push(pole);
    wiersze.push(wiersz);
  }
  return wiersze;
}

/** Liczba z HTML-owego linku (`>142393<`) albo z gołej wartości. */
export function liczbaZLinku(v: string): number | null {
  const m = />(\d+)</.exec(v);
  const surowe = m ? m[1] : v.trim();
  const n = Number(surowe);
  return Number.isFinite(n) && surowe !== "" ? n : null;
}

export interface WierszZbiorki {
  koszykId: number;
  symbol: string;
  ean: string;
  data: string;
  ilosc: number;
}

/**
 * Wiersze zbiórek z surowego CSV. Wiersze bez klucza albo daty są POMIJANE
 * i policzone — plik z eksportu bywa ucięty w połowie wiersza.
 */
export function wierszeZbiorek(tekst: string): { wiersze: WierszZbiorki[]; odrzuconych: number } {
  const dane = parsujCsv(tekst);
  if (dane.length < 2) return { wiersze: [], odrzuconych: 0 };
  const naglowek = dane[0].map((h) => h.trim().toLowerCase());
  const kol = (nazwa: string) => naglowek.indexOf(nazwa);
  const iKoszyk = kol("id koszyka");
  const iData = kol("data zebrania");
  const iEan = kol("ean");
  const iSymbol = kol("symbol");
  const iIlosc = kol("ilość");
  if (iKoszyk < 0 || iData < 0 || iSymbol < 0) {
    throw new Error(
      "Plik nie wygląda na eksport zbiórek — brakuje kolumn: " +
        [iKoszyk < 0 ? "ID Koszyka" : null, iData < 0 ? "Data zebrania" : null, iSymbol < 0 ? "Symbol" : null]
          .filter(Boolean)
          .join(", ")
    );
  }
  const wiersze: WierszZbiorki[] = [];
  let odrzuconych = 0;
  for (const w of dane.slice(1)) {
    const koszykId = liczbaZLinku(w[iKoszyk] ?? "");
    const data = (w[iData] ?? "").trim();
    if (!koszykId || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      odrzuconych++;
      continue;
    }
    wiersze.push({
      koszykId,
      symbol: (w[iSymbol] ?? "").trim(),
      ean: iEan >= 0 ? (w[iEan] ?? "").trim() : "",
      data,
      ilosc: Number(w[iIlosc] ?? 1) || 1,
    });
  }
  return { wiersze, odrzuconych };
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface WynikImportu {
  wierszy: number;
  nowych: number;
  pominietychDuplikatow: number;
  dopasowanych: number;
  niedopasowanych: number;
  przykladyNiedopasowanych: string[];
  odrzuconychWierszy: number;
  okres: { od: string; do: string } | null;
}

/** Poniżej tego udziału dopasowań import jest odrzucany w całości. */
export const MIN_UDZIAL_DOPASOWAN = 0.5;

/**
 * Import pliku zbiórek. Idempotentny: kluczem jest `koszyk_id` z eksportu,
 * więc powtórne wgranie tego samego okresu (albo nakładających się) niczego
 * nie dubluje — `INSERT OR IGNORE` po prostu pomija znane wiersze.
 *
 * BEZPIECZNIK, przeniesiony 1:1 z raportu przeslotowania (reslot-run.ts):
 * plik, w którym dopasowała się mniej niż połowa wierszy, jest odrzucany
 * W CAŁOŚCI. Źle zmapowany eksport dawałby kartotece same zera i adnotację
 * „do strefy złotej" rozsypaną po całym magazynie — wynik wyglądałby na
 * zlecenie robocze, a mówiłby tylko tyle, że plik był zły.
 */
export function importujZbiorki(tekst: string): WynikImportu {
  const { wiersze, odrzuconych } = wierszeZbiorek(tekst);
  if (wiersze.length === 0) {
    throw new Error("Plik nie zawiera ani jednego poprawnego wiersza zbiórki");
  }

  const d = db();
  // mapowanie po symbolu (bez wielkości liter), zapasowo po EAN
  const towary = d
    .prepare("SELECT tw_id, upper(symbol) AS sym, ean FROM sgt_towar")
    .all() as Array<{ tw_id: number; sym: string; ean: string | null }>;
  const poSymbolu = new Map<string, number>();
  const poEan = new Map<string, number>();
  for (const t of towary) {
    if (t.sym) poSymbolu.set(t.sym, t.tw_id);
    if (t.ean) poEan.set(t.ean, t.tw_id);
  }

  let dopasowanych = 0;
  const niedopasowane = new Map<string, number>();
  const doWstawienia = wiersze.map((w) => {
    const twId = poSymbolu.get(w.symbol.toUpperCase()) ?? (w.ean ? poEan.get(w.ean) : undefined) ?? null;
    if (twId != null) dopasowanych++;
    else niedopasowane.set(w.symbol || "(pusty symbol)", (niedopasowane.get(w.symbol) ?? 0) + 1);
    return { ...w, twId };
  });

  if (dopasowanych / wiersze.length < MIN_UDZIAL_DOPASOWAN) {
    throw new Error(
      `Dopasowano tylko ${dopasowanych} z ${wiersze.length} wierszy do kartoteki — ` +
        "plik wygląda na eksport z innego katalogu niż ten magazyn. Import odrzucony " +
        "w całości, bo zbiórki bez dopasowania dawałyby fałszywe adnotacje. " +
        `Przykłady niedopasowanych symboli: ${[...niedopasowane.keys()].slice(0, 10).join(", ")}`
    );
  }

  let nowych = 0;
  d.exec("BEGIN IMMEDIATE");
  try {
    const ins = d.prepare(
      "INSERT OR IGNORE INTO zbiorka(koszyk_id, tw_id, symbol_csv, data, ilosc) VALUES (?,?,?,?,?)"
    );
    for (const w of doWstawienia) {
      const r = ins.run(w.koszykId, w.twId, w.symbol, w.data, w.ilosc);
      nowych += Number(r.changes);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  zresetujKandydatow();

  const daty = wiersze.map((w) => w.data).sort();
  return {
    wierszy: wiersze.length,
    nowych,
    pominietychDuplikatow: wiersze.length - nowych,
    dopasowanych,
    niedopasowanych: wiersze.length - dopasowanych,
    przykladyNiedopasowanych: [...niedopasowane.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([s]) => s),
    odrzuconychWierszy: odrzuconych,
    okres: daty.length ? { od: daty[0], do: daty[daty.length - 1] } : null,
  };
}

// ── Kandydaci do strefy złotej ──────────────────────────────────────────────

export interface KandydatStrefy {
  twId: number;
  sym: string;
  nazwa: string;
  /** Wystąpienia (nie sztuki) w oknie. */
  zbiorki: number;
  zbiorekNaDzien: number;
  adres: string | null;
  /** Poziomy strefy dla regału kandydata, np. "2 albo 3"; pusty gdy brak adresu. */
  poziomy: string;
}

export interface RaportKandydatow {
  /** Okno danych: ostatnie N dni OBECNE w tabeli, nie kalendarzowe. */
  okno: { od: string; do: string; dni: number } | null;
  prog: number;
  kandydaci: KandydatStrefy[];
  /** Szybkorotujący już w strefie — do wglądu, nie do ruszania. */
  juzWStrefie: number;
  /** Szybkorotujący na regałach bez reguły strefy — osobno, nie „poza strefą". */
  bezReguly: number;
}

/** Ile ostatnich dni danych bierzemy do rachunku. */
const OKNO_DNI = 30;
/** Ta sama wartość co w raporcie przeslotowania (reslot: DOMYSLNE.gornyUdzial). */
const GORNY_UDZIAL = 0.15;
const CACHE_TTL_MS = 10 * 60_000;

let cacheKandydatow: { raport: RaportKandydatow; mapa: Map<number, KandydatStrefy>; do_: number } | null = null;

export function zresetujKandydatow(): void {
  cacheKandydatow = null;
}

function policzKandydatow(): { raport: RaportKandydatow; mapa: Map<number, KandydatStrefy> } {
  const d = db();
  /* Okno = ostatnie N dni OBECNE w danych. Plik bywa wgrany z opóźnieniem —
     okno kalendarzowe „ostatnie 30 dni od dziś" wyzerowałoby raport tydzień
     po ostatnim imporcie i adnotacje znikałyby bez powodu. */
  const dni = d
    .prepare("SELECT DISTINCT data FROM zbiorka ORDER BY data DESC LIMIT ?")
    .all(OKNO_DNI) as Array<{ data: string }>;
  if (dni.length === 0) {
    return {
      raport: { okno: null, prog: Infinity, kandydaci: [], juzWStrefie: 0, bezReguly: 0 },
      mapa: new Map(),
    };
  }
  const od = dni[dni.length - 1].data;
  const doD = dni[0].data;

  const wystapienia = d
    .prepare(
      `SELECT z.tw_id AS twId, COUNT(*) AS zbiorki, t.symbol AS sym, t.nazwa, t.lokalizacja
         FROM zbiorka z JOIN sgt_towar t ON t.tw_id = z.tw_id
        WHERE z.tw_id IS NOT NULL AND z.data >= ? AND z.data <= ?
        GROUP BY z.tw_id`
    )
    .all(od, doD) as Array<{ twId: number; zbiorki: number; sym: string; nazwa: string; lokalizacja: string }>;

  const prog = progGornych(wystapienia.map((w) => w.zbiorki), GORNY_UDZIAL);
  const kandydaci: KandydatStrefy[] = [];
  let juzWStrefie = 0;
  let bezReguly = 0;

  for (const w of wystapienia) {
    if (w.zbiorki < prog) continue;
    const adres = pickingLoc(w.lokalizacja);
    const rozbior = parseAdres(adres);
    /* Trójwartościowość `wStrefieZlotej` jest tu istotna: `null` (regał bez
       reguły) NIE dostaje adnotacji — „nie wiem" to nie „nie". Towar bez
       adresu regałowego (paleta, brak lokalizacji) też nie: nie wiadomo,
       skąd miałby być przenoszony. */
    const wStrefie = rozbior ? wStrefieZlotej(rozbior) : null;
    if (wStrefie === true) {
      juzWStrefie++;
      continue;
    }
    if (wStrefie === null) {
      if (rozbior) bezReguly++;
      continue;
    }
    const poziomy = rozbior ? poziomyStrefy(rozbior) : null;
    kandydaci.push({
      twId: w.twId,
      sym: w.sym,
      nazwa: w.nazwa,
      zbiorki: w.zbiorki,
      zbiorekNaDzien: Number((w.zbiorki / dni.length).toFixed(1)),
      adres,
      poziomy: poziomy ? poziomy.join(" albo ") : "",
    });
  }
  kandydaci.sort((a, b) => b.zbiorki - a.zbiorki || a.sym.localeCompare(b.sym));

  const raport: RaportKandydatow = {
    okno: { od, do: doD, dni: dni.length },
    prog,
    kandydaci,
    juzWStrefie,
    bezReguly,
  };
  return { raport, mapa: new Map(kandydaci.map((k) => [k.twId, k])) };
}

/**
 * Raport kandydatów — z cache'u. Przeliczany przy imporcie i zmianie reguł
 * strefy (`zresetujKandydatow`) oraz leniwie co 10 min; karta towaru jest
 * odpytywana co 2 s i nie może uruchamiać agregacji przy każdym odczycie.
 */
export function kandydaciStrefy(): RaportKandydatow {
  if (!cacheKandydatow || Date.now() > cacheKandydatow.do_) {
    const { raport, mapa } = policzKandydatow();
    cacheKandydatow = { raport, mapa, do_: Date.now() + CACHE_TTL_MS };
  }
  return cacheKandydatow.raport;
}

/** Adnotacja dla karty towaru albo `null` — O(1), z tego samego cache'u. */
export function adnotacjaStrefy(twId: number): { zbiorekNaDzien: number; poziomy: string } | null {
  kandydaciStrefy();
  const k = cacheKandydatow?.mapa.get(twId);
  return k ? { zbiorekNaDzien: k.zbiorekNaDzien, poziomy: k.poziomy } : null;
}