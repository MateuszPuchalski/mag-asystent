import { parseAdres, pickingLoc } from "../locs.js";
import { poziomyStrefy, wStrefieZlotej } from "./strefa-zlota.js";

/* ── Raport przeslotowania (plan §8) ────────────────────────────────────────
   NIE jest to funkcja aplikacji, tylko wsad uruchamiany 1–2× w roku, przed
   sezonem. Człowiek z wydrukiem robi to w dzień.

   Wcześniejsza rekomendacja mówiła o slottingu ABC po ODLEGŁOŚCI. Przy 342 m²
   ten argument nie broni się liczbowo: przekątna magazynu to ~26 m, czyli ~20 s
   marszu, a różnica między dobrym a złym ułożeniem poziomym to kilka sekund na
   pobranie. Nie warto pisać pod to kodu.

   Co naprawdę kosztuje przy tej wielkości:
     • PION — pobranie z podłogi albo z drabiny to 10–25 s wobec ~3 s ze strefy
       złotej, czyli rząd wielkości więcej niż cała droga po magazynie,
     • MARTWE KARTOTEKI — ~2 600 z ~3 600 jest nieaktywnych; te z nich, które
       siedzą w strefie złotej, blokują jedyny naprawdę ograniczony zasób.     */

/** Kartoteka z adresem i stanem — tyle, ile raport potrzebuje. */
export interface Kartoteka {
  twId: number;
  symbol: string;
  nazwa: string;
  /** Całe pole `tw_Lokalizacja`; picking = pierwszy kod. */
  lokalizacja: string | null;
  stan: number;
  /** Ostatni zakup (ISO) — do listy kandydatów do likwidacji. */
  ostatniZakup?: string | null;
}

/**
 * Historia pobrań per kartoteka.
 *
 * `pobrania` to LICZBA WYSTĄPIEŃ POZYCJI na dokumentach WZ, nie suma ilości.
 * Indeks pobrany 400× po jednej sztuce generuje wielokrotnie więcej pracy niż
 * pobrany 4× po 100 szt., a to praca jest tym, co przeslotowanie ma zmniejszyć.
 * Mylenie tych dwóch liczb to najczęstszy błąd domowych analiz ABC.
 */
export interface Pobrania {
  twId: number;
  pobrania: number;
  sztuki: number;
}

export type Lista = "eksmisja" | "awans" | "likwidacja" | "brak_reguly";

export interface Wiersz {
  lista: Lista;
  symbol: string;
  nazwa: string;
  lokalizacja: string;
  /** Dokąd przenieść — konkretne poziomy albo prośba o decyzję człowieka. */
  cel: string;
  pobrania: number;
  stan: number;
  powod: string;
}

export interface Raport {
  at: string;
  /** Ile kartotek w ogóle dało się ocenić (adres regałowy + znana reguła). */
  ocenionych: number;
  zAdresem: number;
  wiersze: Wiersz[];
  /** Ile kartotek odpadło i dlaczego — cichy spadek byłby gorszy niż brak raportu. */
  pominieto: { bezAdresu: number; adresSpozaWzorca: number };
}

export interface Opcje {
  /** Ułamek najczęściej pobieranych uznawany za „szybkorotujący". */
  gornyUdzial: number;
  /** Miesiące bez zakupu, po których towar jest kandydatem do likwidacji. */
  miesiecyBezZakupu: number;
  /** „Teraz" — wstrzykiwane, żeby test nie zależał od daty uruchomienia. */
  teraz: Date;
}

export const DOMYSLNE: Omit<Opcje, "teraz"> = { gornyUdzial: 0.15, miesiecyBezZakupu: 24 };

/**
 * `dok_Typ` dokumentu WZ. Nie jest zgadywany — oficjalna struktura InsERT dla
 * wersji bazy 1.8731.31.6933 wylicza kody wprost (docs/subiekt-gt-struktura.md).
 */
export const DOK_TYP_WZ = 11;

/**
 * Próg liczby pobrań dla „górnych N%".
 *
 * Liczony WYŁĄCZNIE na kartotekach, które cokolwiek pobierano — inaczej ~2 600
 * martwych indeksów rozcieńczyłoby zbiór tak, że progiem zostałoby zero i cała
 * kartoteka trafiłaby do awansów.
 */
export function progGornych(pobrania: number[], udzial: number): number {
  const ruchome = pobrania.filter((n) => n > 0).sort((a, b) => b - a);
  if (!ruchome.length) return Infinity;
  const ile = Math.max(1, Math.ceil(ruchome.length * udzial));
  return ruchome[ile - 1];
}

export function przeslotowanie(
  kartoteki: Kartoteka[],
  pobrania: Pobrania[],
  opcje: Opcje
): Raport {
  const wgTw = new Map(pobrania.map((p) => [p.twId, p]));
  const prog = progGornych(
    kartoteki.map((k) => wgTw.get(k.twId)?.pobrania ?? 0),
    opcje.gornyUdzial
  );
  const granicaZakupu = new Date(opcje.teraz);
  granicaZakupu.setMonth(granicaZakupu.getMonth() - opcje.miesiecyBezZakupu);

  const wiersze: Wiersz[] = [];
  let bezAdresu = 0;
  let adresSpozaWzorca = 0;
  let ocenionych = 0;
  let zAdresem = 0;

  for (const k of kartoteki) {
    const kod = pickingLoc(k.lokalizacja);
    if (!kod) {
      bezAdresu++;
      continue;
    }
    zAdresem++;
    const adres = parseAdres(kod);
    if (!adres) {
      // paleta albo literówka — patrz docs/adresy-do-poprawy.md
      adresSpozaWzorca++;
      continue;
    }

    const n = wgTw.get(k.twId)?.pobrania ?? 0;
    const wStrefie = wStrefieZlotej(adres);
    const wspolne = { symbol: k.symbol, nazwa: k.nazwa, lokalizacja: kod, pobrania: n, stan: k.stan };

    if (wStrefie === null) {
      // Regał bez reguły. NIE wolno go potraktować jak „poza strefą": martwy
      // towar zniknąłby z eksmisji, a szybkorotujący trafiłby na awanse bez
      // podstaw. Widoczny brak jest lepszy niż niewidoczne zgadywanie.
      wiersze.push({
        ...wspolne,
        lista: "brak_reguly",
        cel: "uzupełnij regułę dla regału " + adres.regal,
        powod: `regał ${adres.regal} nie ma zdefiniowanej strefy złotej`,
      });
      // UWAGA: bez `continue`. Listy 1 i 2 wymagają znanej strefy, ale lista 3
      // jest decyzją HANDLOWĄ i od pionu nie zależy — pominięcie jej tutaj
      // gubiłoby kandydatów do likwidacji tylko dlatego, że leżą na regale,
      // dla którego nikt nie podał reguły.
    } else {
      ocenionych++;
      if (n === 0 && wStrefie) {
        wiersze.push({
          ...wspolne,
          lista: "eksmisja",
          cel: "poza strefę złotą (poziom spoza " + poziomyStrefy(adres)!.join("/") + ")",
          powod: "zero pobrań przez 12 mies., a zajmuje miejsce w strefie złotej",
        });
      } else if (n >= prog && !wStrefie) {
        wiersze.push({
          ...wspolne,
          lista: "awans",
          cel: "poziom " + poziomyStrefy(adres)!.join(" albo "),
          powod: `${n} pobrań przez 12 mies., a leży poza strefą złotą (poziom ${adres.poziom})`,
        });
      }
    }

    // Lista 3 jest niezależna od pionu — to decyzja handlowa, nie magazynowa.
    const zakup = k.ostatniZakup ? new Date(k.ostatniZakup) : null;
    if (n === 0 && k.stan > 0 && (!zakup || zakup < granicaZakupu)) {
      wiersze.push({
        ...wspolne,
        lista: "likwidacja",
        cel: "decyzja handlowa",
        powod: `zero pobrań, stan ${k.stan}, ostatni zakup ${
          k.ostatniZakup?.slice(0, 10) ?? "nieznany"
        }`,
      });
    }
  }

  // Sortowanie po LOKALIZACJI, nie po symbolu: z tą listą chodzi się alejką
  // raz, zamiast biegać po magazynie w kolejności alfabetycznej indeksów.
  const kolejnosc: Lista[] = ["eksmisja", "awans", "likwidacja", "brak_reguly"];
  wiersze.sort(
    (a, b) =>
      kolejnosc.indexOf(a.lista) - kolejnosc.indexOf(b.lista) ||
      a.lokalizacja.localeCompare(b.lokalizacja)
  );

  return {
    at: opcje.teraz.toISOString(),
    ocenionych,
    zAdresem,
    wiersze,
    pominieto: { bezAdresu, adresSpozaWzorca },
  };
}

/** CSV jak pozostałe eksporty: `;` + BOM, żeby Excel PL otworzył bez kreatora. */
export function reslotCsv(r: Raport): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const naglowek = [
    "# WERTIS — raport przeslotowania, " + r.at.slice(0, 10),
    "# KOLEJNOSC MA ZNACZENIE: najpierw EKSMISJA, dopiero potem AWANS.",
    "# Eksmisja martwych indeksow daje ~80% korzysci i jest bezpieczna",
    "# (przenosisz towar, ktorego nikt nie ruszal). Awans wymaga WOLNYCH miejsc",
    "# w strefie zlotej, wiec bez eksmisji utkniesz w polowie listy.",
    "# Lista BRAK_REGULY to nie zadanie magazynowe — to brakujace reguly stref.",
  ];
  const linie = [
    ...naglowek,
    ["lista", "symbol", "nazwa", "lokalizacja", "cel", "pobran_12m", "stan", "powod"].join(";"),
    ...r.wiersze.map((w) =>
      [w.lista, w.symbol, w.nazwa, w.lokalizacja, w.cel, w.pobrania, w.stan, w.powod]
        .map(esc)
        .join(";")
    ),
  ];
  return "﻿" + linie.join("\r\n") + "\r\n";
}

/* ── Ładowanie danych z MSSQL ───────────────────────────────────────────────
   Osobno od logiki, żeby ta ostatnia dała się przetestować bez bazy. Skrypt
   czyta WYŁĄCZNIE — nic nie zapisuje do Subiekta.                            */

/** Kartoteki + historia pobrań, wprost z bazy Subiekta (read-only). */
export async function wczytajZMssql(miesiecy = 12): Promise<{
  kartoteki: Kartoteka[];
  pobrania: Pobrania[];
}> {
  const { mssqlPool, assertSafeColumn } = await import("../db/mssql.js");
  const { config } = await import("../config.js");
  const sql = (await import("mssql")).default;

  const pool = await mssqlPool();
  const locCol = assertSafeColumn(config.mssql.locColumn);
  const c = config.mssql;

  const kartoteki = (
    await pool.request().input("mag", sql.Int, config.magId.MAG).query<{
      tw_Id: number;
      tw_Symbol: string;
      tw_Nazwa: string;
      lokalizacja: string | null;
      stan: number;
      ostatni_zakup: Date | null;
    }>(
      `SELECT t.tw_Id, t.tw_Symbol, t.tw_Nazwa,
              t.${locCol} AS lokalizacja,
              ISNULL(s.st_Stan, 0) AS stan,
              (SELECT MAX(d.dok_DataWyst)
                 FROM dok_Pozycja p JOIN dok__Dokument d ON d.dok_Id = p.ob_DokHanId
                WHERE p.ob_TowId = t.tw_Id AND d.dok_Typ IN (${c.dokTypFZ}, ${c.dokTypPZ})
              ) AS ostatni_zakup
         FROM tw__Towar t
         LEFT JOIN tw_Stan s ON s.st_TowId = t.tw_Id AND s.st_MagId = @mag
        WHERE t.tw_Zablokowany = 0`
    )
  ).recordset;

  /* Pobrania = LICZBA POZYCJI na dokumentach WZ, nie suma ilości. `sztuki`
     idzie obok wyłącznie jako kontekst dla człowieka czytającego raport. */
  const pobrania = (
    await pool
      .request()
      .input("wz", sql.Int, DOK_TYP_WZ)
      .input("mies", sql.Int, miesiecy)
      .query<{ tw_id: number; pobrania: number; sztuki: number }>(
        `SELECT p.ob_TowId AS tw_id, COUNT(*) AS pobrania, SUM(p.ob_IloscMag) AS sztuki
           FROM dok_Pozycja p JOIN dok__Dokument d ON d.dok_Id = p.ob_DokHanId
          WHERE d.dok_Typ = @wz
            AND d.dok_DataWyst >= DATEADD(month, -@mies, GETDATE())
          GROUP BY p.ob_TowId`
      )
  ).recordset;

  return {
    kartoteki: kartoteki.map((r) => ({
      twId: r.tw_Id,
      symbol: r.tw_Symbol,
      nazwa: r.tw_Nazwa,
      lokalizacja: r.lokalizacja,
      stan: Number(r.stan) || 0,
      ostatniZakup: r.ostatni_zakup ? new Date(r.ostatni_zakup).toISOString() : null,
    })),
    pobrania: pobrania.map((r) => ({
      twId: r.tw_id,
      pobrania: Number(r.pobrania) || 0,
      sztuki: Number(r.sztuki) || 0,
    })),
  };
}
