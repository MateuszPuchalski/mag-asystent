import type { DatabaseSync } from "node:sqlite";
import { db } from "../db/db.js";
import type { ModelUrzadzenia, PewnoscZastosowania, Polaryzacja } from "./wiedza.js";
import { zyweZastosowania } from "./wiedza.js";
import { kolejkaZabudow, zatwierdzoneZabudowy } from "./silniki.js";
import {
  towar, zamiennikiKartoteki, zywePasowania, type Kartoteka, type RolaPasowania, type ZamiennikKartoteki,
} from "./pasowania.js";

/**
 * Sieć wiedzy: co z czym pasuje, na jednym rysunku (zakładka „Sieć").
 *
 * ── CZTERY WARSTWY, JEDNA SIEĆ ────────────────────────────────────────────
 * Wiedza o zgodności mieszka w trzech tabelach i jednym parserze:
 *   pasowania     część → część           `pasowanie_czesci`
 *   zastosowania  część → maszyna/silnik  `zastosowanie`
 *   zabudowy      silnik → maszyna        `zabudowa_silnika`
 *   zamienniki    część ~ część           opis kartoteki (bez tabeli) i pary
 *                                         przez numer oryginału `zamiennosc_oem`
 * Każdy ekran wiedzy pokazuje jedną z nich. Pytanie klienta chodzi jednak
 * po wszystkich naraz: uszczelka pasuje do gaźnika, gaźnik do silnika GX160,
 * a GX160 stoi w trzech kosiarkach. Dopiero razem widać, że to jeden łańcuch.
 *
 * ── HIERARCHIA PLIKÓW ─────────────────────────────────────────────────────
 * Importuje `wiedza.ts`, `silniki.ts` i `pasowania.ts`; nikt poza trasą nie
 * importuje tego pliku. Sieć jest odczytem nad nimi, nie ich częścią.
 *
 * ── PRZESŁANKI, NIE WNIOSKI ───────────────────────────────────────────────
 * Rysujemy wiersze i odczyty opisów. Wniosków („pasuje też do zamiennika")
 * nie dopisujemy — widać je okiem po drodze krawędzi, a narysowane podwoiłyby
 * linie i zasłoniły to, co ktoś wpisał. Wnioski dla jednej kartoteki panel
 * bierze z `pasowaniaTowaru`, gdy człowiek ją wybierze.
 *
 * ── ZAMIENNIKI: GŁĘBOKOŚĆ JEDEN ───────────────────────────────────────────
 * Nowe węzły wnosi wyłącznie opis kartoteki, która jest końcem wiersza.
 * Opis dołożonego zamiennika czytamy tylko po krawędź do węzła, który już
 * stoi w sieci — inaczej gaźnik z opisem na trzydzieści symboli wciągnąłby
 * pół kartoteki. Ta sama doktryna, co przy odczycie `pasowaniaTowaru`.
 *
 * ── ODRZUCONE I WYCOFANE NIE WCHODZĄ ──────────────────────────────────────
 * Sieć pokazuje to, co dziś obowiązuje, i to, co czeka na decyzję. Historia
 * odmów stoi w dzienniku; na rysunku byłaby krawędzią, której nie ma.
 */

export type RodzajWezla = "kartoteka" | "maszyna" | "silnik";

export interface WezelSieci {
  /** `tw:<tw_id>` albo `model:<id>` — dwie przestrzenie numerów, jeden klucz. */
  klucz: string;
  rodzaj: RodzajWezla;
  twId: number | null;
  /** Krótko, pod węzłem: symbol kartoteki albo „Honda GX160". */
  etykieta: string;
  /** Pełna nazwa do dymka i nagłówka karty. */
  nazwa: string;
}

export type WarstwaSieci = "pasowania" | "zastosowania" | "zabudowy" | "zamienniki";

/**
 * `pasuje` / `nie_pasuje` — zatwierdzone pasowanie albo zastosowanie;
 * `propozycja` — cokolwiek czeka w kolejce; `zabudowa` — zatwierdzony silnik
 * w maszynie; `zamiennik` — odczyt opisu.
 */
export type RodzajKrawedzi = "pasuje" | "nie_pasuje" | "propozycja" | "zabudowa" | "zamiennik";

export interface KrawedzSieci {
  /** Część, silnik albo kartoteka, której opis podaje zamiennik. */
  z: string;
  /** Do czego pasuje, w czym stoi albo symbol wymieniony w opisie. */
  do: string;
  warstwa: WarstwaSieci;
  rodzaj: RodzajKrawedzi;
  /** Polaryzacja wiersza; przy propozycji mówi, czy czeka pozytyw, czy negatyw. */
  polaryzacja: Polaryzacja | null;
  /** Numer wiersza w tabeli warstwy. Przy zamienniku z opisu `null` — on
   *  wiersza nie ma; przy parze przez numer oryginału to numer decyzji. */
  wierszId: number | null;
  rola: RolaPasowania | null;
  pewnosc: PewnoscZastosowania;
  /** Oba opisy wymieniają się nawzajem. Tylko przy zamienniku. */
  obustronnie: boolean;
  /** Zdanie źródła z serwera — panel go nie układa. */
  zdanie: string;
}

export interface SiecWiedzy {
  wezly: WezelSieci[];
  krawedzie: KrawedzSieci[];
}

export const kluczTw = (twId: number) => `tw:${twId}`;
export const kluczModelu = (id: number) => `model:${id}`;

/* Krótka etykieta modelu. `etykieta` z `naModel` niesie przedrostek „silnik"
   i lata — pod węzłem to zbędne, bo rodzaj mówi kształt, a lata dymek. */
const krotko = (m: ModelUrzadzenia) => [m.marka, m.nazwa, m.wariant].filter(Boolean).join(" ");

export function siecWiedzy(database: DatabaseSync = db()): SiecWiedzy {
  const wezly = new Map<string, WezelSieci>();
  const krawedzie: KrawedzSieci[] = [];

  const dodajTw = (k: Kartoteka) => {
    const klucz = kluczTw(k.twId);
    if (!wezly.has(klucz)) wezly.set(klucz, { klucz, rodzaj: "kartoteka", twId: k.twId, etykieta: k.symbol, nazwa: k.nazwa });
    return klucz;
  };
  const dodajModel = (m: ModelUrzadzenia) => {
    const klucz = kluczModelu(m.id);
    if (!wezly.has(klucz)) wezly.set(klucz, { klucz, rodzaj: m.rodzaj, twId: null, etykieta: krotko(m), nazwa: m.etykieta });
    return klucz;
  };

  for (const p of zywePasowania(database)) {
    krawedzie.push({ z: dodajTw(p.czesc), do: dodajTw(p.doCzego), warstwa: "pasowania",
      rodzaj: p.stan === "propozycja" ? "propozycja" : p.polaryzacja, polaryzacja: p.polaryzacja,
      wierszId: p.id, rola: p.rola, pewnosc: p.pewnosc, obustronnie: false, zdanie: p.zdanieZrodla });
  }

  /* Zastosowanie niesie sam symbol; nazwę bierzemy z kartoteki, żeby dymek
     mówił „Uszczelka gaźnika GX160", a nie drugi raz symbol. */
  for (const z of zyweZastosowania(database)) {
    const t = towar(database, z.twId);
    const k = t ? { twId: t.twId, symbol: t.symbol, nazwa: t.nazwa } : { twId: z.twId, symbol: z.symbol, nazwa: z.symbol };
    krawedzie.push({ z: dodajTw(k), do: dodajModel(z.model), warstwa: "zastosowania",
      rodzaj: z.stan === "propozycja" ? "propozycja" : z.polaryzacja, polaryzacja: z.polaryzacja,
      wierszId: z.id, rola: null, pewnosc: z.pewnosc, obustronnie: false, zdanie: z.zdanieZrodla });
  }

  /* Zabudowa nie ma polaryzacji: silnik w maszynie stoi albo nie ma wiersza. */
  for (const b of [...zatwierdzoneZabudowy(database), ...kolejkaZabudow(database).propozycje].sort((x, y) => x.id - y.id)) {
    krawedzie.push({ z: dodajModel(b.silnik), do: dodajModel(b.maszyna), warstwa: "zabudowy",
      rodzaj: b.stan === "propozycja" ? "propozycja" : "zabudowa", polaryzacja: null,
      wierszId: b.id, rola: null, pewnosc: b.pewnosc, obustronnie: false, zdanie: b.zdanieZrodla });
  }

  /* Zamienniki: klucz bez kierunku, bo „A podaje B" i „B podaje A" to jedna
     linia na rysunku. Drugi kierunek zmienia zdanie, nie rysunek. Para przez
     wspólny numer oryginału jest z natury obustronna i niesie numer decyzji —
     rysunek nie daje jej grotu, bo żaden opis „nie mówi" tu za drugi. */
  const zamienniki = new Map<string, KrawedzSieci>();
  const dopisz = (kto: Kartoteka, zam: ZamiennikKartoteki) => {
    const [a, b] = kto.twId < zam.twId ? [kto.twId, zam.twId] : [zam.twId, kto.twId];
    const juz = zamienniki.get(`${a}~${b}`);
    if (!juz) {
      zamienniki.set(`${a}~${b}`, { z: kluczTw(kto.twId), do: kluczTw(zam.twId), warstwa: "zamienniki",
        rodzaj: "zamiennik", polaryzacja: null, wierszId: zam.decyzjaId, rola: null, pewnosc: "prawdopodobne",
        obustronnie: zam.zrodlo === "oem", zdanie: zam.zdanie });
    } else if (zam.zrodlo === "opis" && juz.wierszId === null && juz.z !== kluczTw(kto.twId)) {
      juz.obustronnie = true;
      juz.zdanie = `${wezly.get(juz.z)!.etykieta} i ${wezly.get(juz.do)!.etykieta} podają się nawzajem jako zamienniki w opisach`;
    }
  };
  const konce = [...wezly.values()].filter((w) => w.twId !== null);
  const sKonca = new Set(konce.map((w) => w.klucz));
  for (const w of konce) {
    const t = towar(database, w.twId!);
    if (!t) continue;
    for (const z of zamiennikiKartoteki(database, t)) { dodajTw(z); dopisz(t, z); }
  }
  for (const w of [...wezly.values()].filter((w) => w.twId !== null && !sKonca.has(w.klucz))) {
    const t = towar(database, w.twId!);
    if (!t) continue;
    for (const z of zamiennikiKartoteki(database, t)) if (wezly.has(kluczTw(z.twId))) dopisz(t, z);
  }

  /* Porządek stały: ten sam stan bazy ma dać ten sam rysunek, a układ w panelu
     startuje od kolejności węzłów. */
  return {
    wezly: [...wezly.values()].sort((a, b) => a.etykieta.localeCompare(b.etykieta, "pl") || a.klucz.localeCompare(b.klucz)),
    krawedzie: [...krawedzie, ...zamienniki.values()],
  };
}
