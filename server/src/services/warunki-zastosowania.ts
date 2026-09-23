import { zwin } from "../tekst.js";

/**
 * Warunki na zastosowaniu — kwalifikatory w rozumieniu ACES i TecDoc.
 *
 * „Pasuje do STIHL MS 250" rzadko jest pełną prawdą. Katalog producenta mówi
 * raczej „od numeru seryjnego X" albo „roczniki 2014–2018", bo w połowie
 * produkcji zmienia się gaźnik, obudowa filtra albo mocowanie. Wpis bez
 * warunku twierdzi wtedy za dużo i kończy się zwrotem „nie pasuje".
 *
 * Trzy rodzaje, bo tyle da się sprawdzić albo przeczytać:
 *   - LATA: od–do, obie granice opcjonalne, domknięte;
 *   - NUMER SERYJNY: od–do, porównywany TYLKO, gdy da się porównać uczciwie;
 *   - WARUNEK SŁOWNY: „tylko z gaźnikiem Zama". Kod go nie ocenia nigdy —
 *     czyta go agent i pyta klienta.
 *
 * Maszynę klienta bierzemy WYŁĄCZNIE z danych doboru, które wpisał agent
 * (rocznik, numer seryjny) — nigdy z treści wiadomości (blizna szarpaka).
 *
 * Ocena ma TRZY wyniki, nie dwa. „Nie wiem" to osobna prawda: bez rocznika
 * w doborze wpis „2014–2018" nie jest ani spełniony, ani złamany. Zrównanie
 * go z którymś kończy się albo milczącą pewnością, albo zgubionym kandydatem.
 */

export interface WarunkiZastosowania {
  rokOd: number | null;
  rokDo: number | null;
  seryjnyOd: string | null;
  seryjnyDo: string | null;
  warunek: string | null;
}

export const BEZ_WARUNKOW: WarunkiZastosowania = { rokOd: null, rokDo: null, seryjnyOd: null, seryjnyDo: null, warunek: null };

/* Granice roku: sprzęt ogrodowy z silnikiem spalinowym nie jest starszy niż
   połowa XX wieku. Szerzej to przepuszczanie literówek („201" zamiast
   „2016"), węziej — odrzucanie prawdziwych zabytków z warsztatu. */
const ROK_MIN = 1950;
const ROK_MAX = 2100;
/* Tabliczki znamionowe mają kilkanaście znaków; czterdzieści to zapas na
   myślniki i spacje przepisane z ręki, nie na wklejony akapit. */
const MAX_SERYJNY = 40;
/* Warunek to zdanie, nie opis. Dłuższy tekst należy do komentarza albo dowodu. */
const MAX_WARUNEK = 200;

const oczysc = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

function rok(v: unknown, co: string): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < ROK_MIN || n > ROK_MAX) {
    throw new Error(`${co} to rok z czterech cyfr, od ${ROK_MIN} do ${ROK_MAX}`);
  }
  return n;
}

/* ── Numer seryjny ──────────────────────────────────────────────────────────
   Porównujemy wyłącznie kształt „litery z przodu + cyfry": STIHL pisze
   same cyfry (175123456), Honda przedrostek i numer (GJAAA-1234567),
   Husqvarna same cyfry z rokiem i tygodniem na czele. Wszystko inne —
   litera na końcu, litery w środku — jest „nie da się porównać", a nie
   porównaniem po alfabecie. Alfabet ustawiłby „9" za „10" i wykluczył
   dobrą część po cichu.

   RÓŻNA LICZBA CYFR TO TEŻ „NIE DA SIĘ PORÓWNAĆ". Producent trzyma długość
   numeru stałą, więc numer krótszy o cyfrę to niemal zawsze literówka albo
   inne pole z tabliczki (numer modelu, kod daty). Porównanie liczbowe
   uznałoby go za „mniejszy" i wyrzuciło część z listy.                      */
const KSZTALT = /^([a-z]*)(\d+)$/;

function rozbierz(numer: string): { przedrostek: string; cyfry: string } | null {
  const m = KSZTALT.exec(zwin(numer));
  return m ? { przedrostek: m[1], cyfry: m[2] } : null;
}

/** −1, 0, 1 — albo `null`, gdy numerów nie da się uczciwie porównać. */
export function porownajSeryjne(a: string, b: string): -1 | 0 | 1 | null {
  const x = rozbierz(a); const y = rozbierz(b);
  if (!x || !y || x.przedrostek !== y.przedrostek || x.cyfry.length !== y.cyfry.length) return null;
  return x.cyfry === y.cyfry ? 0 : x.cyfry < y.cyfry ? -1 : 1;
}

function seryjny(v: unknown, co: string): string | null {
  const s = oczysc(v);
  if (!s) return null;
  if (s.length > MAX_SERYJNY) throw new Error(`${co}: numer seryjny ma najwyżej ${MAX_SERYJNY} znaków`);
  if (!rozbierz(s)) {
    throw new Error(`${co}: numer seryjny to cyfry, ewentualnie z literami na początku — np. 175123456 albo GJAAA-1234567`);
  }
  return s;
}

/**
 * Warunki z żądania — sprawdzone, oczyszczone, z zakresami w dobrą stronę.
 * Pusty obiekt albo brak to „bez warunków", nie błąd: większość wpisów
 * warunków nie ma i mieć nie musi.
 */
export function sprawdzWarunki(w: Partial<Record<keyof WarunkiZastosowania, unknown>> | null | undefined): WarunkiZastosowania {
  if (!w) return BEZ_WARUNKOW;
  const rokOd = rok(w.rokOd, "Rok od"); const rokDo = rok(w.rokDo, "Rok do");
  if (rokOd !== null && rokDo !== null && rokOd > rokDo) throw new Error("Rok od jest późniejszy niż rok do");
  const seryjnyOd = seryjny(w.seryjnyOd, "Numer seryjny od");
  const seryjnyDo = seryjny(w.seryjnyDo, "Numer seryjny do");
  if (seryjnyOd && seryjnyDo) {
    const p = porownajSeryjne(seryjnyOd, seryjnyDo);
    /* Zakres, którego granic nie da się ze sobą porównać, nie da się też
       porównać z tabliczką klienta — byłby warunkiem wiecznie „nie wiem". */
    if (p === null) throw new Error("Granice numeru seryjnego mają różny kształt — ten sam przedrostek i ta sama liczba cyfr");
    if (p > 0) throw new Error("Numer seryjny od jest większy niż numer seryjny do");
  }
  const warunek = oczysc(w.warunek);
  if (warunek && warunek.length > MAX_WARUNEK) throw new Error(`Warunek ma najwyżej ${MAX_WARUNEK} znaków — dłuższy tekst to komentarz`);
  return { rokOd, rokDo, seryjnyOd, seryjnyDo, warunek };
}

export const maWarunki = (w: WarunkiZastosowania) =>
  w.rokOd !== null || w.rokDo !== null || w.seryjnyOd !== null || w.seryjnyDo !== null || w.warunek !== null;

const zakres = (od: string | number | null, doo: string | number | null) =>
  od !== null && doo !== null ? (od === doo ? `${od}` : `${od}–${doo}`) : od !== null ? `od ${od}` : `do ${doo}`;

const zdanieLat = (w: WarunkiZastosowania) => {
  if (w.rokOd === null && w.rokDo === null) return null;
  return w.rokOd !== null && w.rokDo !== null && w.rokOd !== w.rokDo
    ? `roczniki ${zakres(w.rokOd, w.rokDo)}` : `rocznik ${zakres(w.rokOd, w.rokDo)}`;
};
const zdanieSeryjnego = (w: WarunkiZastosowania) =>
  w.seryjnyOd === null && w.seryjnyDo === null ? null : `nr seryjny ${zakres(w.seryjnyOd, w.seryjnyDo)}`;

/**
 * Warunki jednym zdaniem: „roczniki 2014–2018, nr seryjny od 175000000,
 * tylko z gaźnikiem Zama". `null`, gdy wpis warunków nie ma. Pisze je
 * SERWER — kandydat, ekran wiedzy, sieć i szkic mówią to samo.
 */
export function zdanieWarunkow(w: WarunkiZastosowania): string | null {
  const czesci = [zdanieLat(w), zdanieSeryjnego(w), w.warunek].filter(Boolean);
  return czesci.length ? czesci.join(", ") : null;
}

export type OcenaWarunkow = "bez_warunkow" | "spelnione" | "niespelnione" | "nieznane";

/** Maszyna klienta z danych doboru. Wolny tekst — tak jak wpisał agent. */
export interface MaszynaKlienta { rocznik: string | null; nrSeryjny: string | null }

/* Rocznik bywa „2019", „2019 r.", „ok. 2015" albo „2018/2019". Bierzemy
   wszystkie lata z czterech cyfr; dwa różne to niepewność agenta i tak ją
   traktujemy — spełnione tylko, gdy oba mieszczą się w zakresie. */
export function rokiZTekstu(t: string | null): number[] {
  const lata = [...String(t ?? "").matchAll(/(?<!\d)(19|20)\d{2}(?!\d)/g)].map((m) => Number(m[0]))
    .filter((n) => n >= ROK_MIN && n <= ROK_MAX);
  return [...new Set(lata)];
}

/**
 * Czy wpis dotyczy TEJ maszyny. `czyje` mówi, czyj numer i rok porównujemy:
 * przy zastosowaniu do SILNIKA granice dotyczą silnika, a dobór zna tylko
 * tabliczkę maszyny — wtedy wynik to zawsze „nie wiem" z prośbą o tabliczkę
 * silnika. Rocznik kosiarki bywa o rok młodszy od silnika z magazynu
 * producenta, a numer seryjny maszyny nie mówi nic o numerze silnika.
 *
 * Złamany warunek wygrywa nad „nie wiem": jedna pewna niezgodność wystarczy,
 * żeby wpis nie podpierał tej maszyny.
 */
export function ocenWarunki(
  w: WarunkiZastosowania, maszyna: MaszynaKlienta, czyje: "maszyny" | "silnika" = "maszyny",
): { ocena: OcenaWarunkow; zdanie: string | null } {
  if (!maWarunki(w)) return { ocena: "bez_warunkow", zdanie: null };
  const zlamane: string[] = []; const nieznane: string[] = []; const spelnione: string[] = [];

  const lata = zdanieLat(w);
  if (lata) {
    const roki = czyje === "maszyny" ? rokiZTekstu(maszyna.rocznik) : [];
    const wZakresie = (r: number) => (w.rokOd === null || r >= w.rokOd) && (w.rokDo === null || r <= w.rokDo);
    if (roki.length === 0) {
      nieznane.push(czyje === "silnika" ? `${lata} silnika — sprawdź z tabliczki silnika`
        : `${lata} — w doborze brak rocznika, zapytaj klienta`);
    } else if (roki.every(wZakresie)) spelnione.push(`rocznik ${roki.join("/")} mieści się w: ${lata}`);
    else if (!roki.some(wZakresie)) zlamane.push(`wpis obejmuje ${lata}, a w doborze rocznik ${roki.join("/")}`);
    else nieznane.push(`${lata} — rocznik ${roki.join("/")} niejednoznaczny, zapytaj klienta`);
  }

  const seryjne = zdanieSeryjnego(w);
  if (seryjne) {
    const nr = czyje === "maszyny" ? oczysc(maszyna.nrSeryjny) : null;
    if (!nr) {
      nieznane.push(czyje === "silnika" ? `${seryjne} silnika — sprawdź z tabliczki silnika`
        : `${seryjne} — w doborze brak numeru seryjnego, zapytaj o tabliczkę`);
    } else {
      const od = w.seryjnyOd === null ? 1 : porownajSeryjne(nr, w.seryjnyOd);
      const doo = w.seryjnyDo === null ? -1 : porownajSeryjne(nr, w.seryjnyDo);
      if (od === null || doo === null) {
        nieznane.push(`${seryjne} — numeru ${nr} nie da się z tym porównać, sprawdź ręcznie`);
      } else if (od >= 0 && doo <= 0) spelnione.push(`nr seryjny ${nr} mieści się w: ${seryjne}`);
      else zlamane.push(`wpis obejmuje ${seryjne}, a w doborze nr ${nr}`);
    }
  }

  if (w.warunek) nieznane.push(`warunek: ${w.warunek} — sprawdź z klientem`);

  if (zlamane.length) return { ocena: "niespelnione", zdanie: zlamane.join("; ") };
  if (nieznane.length) return { ocena: "nieznane", zdanie: nieznane.join("; ") };
  return { ocena: "spelnione", zdanie: spelnione.join("; ") };
}
