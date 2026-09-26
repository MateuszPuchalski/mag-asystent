import { zwin } from "../tekst.js";

/* ── Metoda SZPERACZA w kodzie (@wydanie) ─────────────────────────────────────

   SZPERACZ to paczka skilli do claude.ai, której biuro używa do ręcznego
   researchu części. Ma dobrą metodę, ale jej wyniki zostawały w czacie.
   Ten plik przenosi do automatu te części metody, które da się sprawdzić
   deterministycznie — bez modelu i bez kosztu:

   - POZIOMY ŹRÓDEŁ: T1 katalog producenta, T2 baza części z rysunkami,
     T3 reszta (sklepy). Listy domen przepisane z `search-patterns.md`
     i `evidence-protocol.md` SZPERACZA.
   - PEWNOŚĆ: „potwierdzone” to dwa niezależne źródła, w tym co najmniej jedno
     T1 albo T2 — dokładnie reguła SZPERACZA. Niezależność po domenie; kopia
     tego samego tekstu nie wchodzi w ogóle (`dowodDoPropozycjiAutomatu`).
   - RÓWNOWAŻNE NUMERY: pary MTD 7xx/9xx i przyrostek wersji serwisowej „S”
     (B&S, Kohler). SZPERACZ podkreśla, że to TA SAMA część, nie zamiennik.
   - UKRYTE WARUNKI: zdania w rodzaju „will not fit manual gearbox”, które
     unieważniają listę modeli, jeśli ich nie widać. */

/* Domeny katalogów producentów (T1). Subdomeny się liczą. */
const T1 = [
  "husqvarna.com", "stihl.com", "honda.com", "briggsandstratton.com", "genuinefactoryparts.com",
  "cubcadet.com", "troybilt.com", "rehlkoenginesparts.com", "kohlerpower.it", "kawasakienginesusa.com",
  "toro.com", "murray.com", "snapper.com", "al-ko.com", "hecht.cz", "werco.cz", "loncinindustries.com",
  "rato-europe.com", "oregonproducts.com", "oregon.pl", "stens.com", "walbro.com", "zamacorp.com",
];
/* Bazy części z rysunkami i tabelami (T2). */
const T2 = [
  "partstree.com", "jackssmallengines.com", "ereplacementparts.com", "searspartsdirect.com",
  "lawnmowerpros.com", "motoruf.de", "motoruf.com", "wolfswinkel.shop", "lsengineers.co.uk",
  "ceruticenter.it", "ersatzteil-shop24.de", "der-rasenmaeher.de", "mtd-serwis.pl", "czesci-do-nac.pl",
  "alko-serwis.pl", "sierraparts.com",
];

const pasuje = (host: string, lista: string[]) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return lista.some((d) => h === d || h.endsWith(`.${d}`));
};

export type PoziomZrodla = 1 | 2 | 3;
export function poziomZrodla(host: string): PoziomZrodla {
  return pasuje(host, T1) ? 1 : pasuje(host, T2) ? 2 : 3;
}

/* Domena „rejestrowa” — do niezależności źródeł. `a.partstree.com`
   i `partstree.com` to jedno źródło; `co.uk` bierze trzy człony. */
function domena(host: string): string {
  const cz = host.toLowerCase().replace(/^www\./, "").split(".");
  const ile = cz.length >= 3 && ["co", "com", "org"].includes(cz[cz.length - 2]!) && cz[cz.length - 1]!.length === 2 ? 3 : 2;
  return cz.slice(-ile).join(".");
}

export type PewnoscZSieci = "potwierdzone" | "prawdopodobne" | "slabe";

/** Pewność propozycji z adresów jej dowodów — reguła SZPERACZA. */
export function pewnoscZSieci(linki: Array<string | null>): PewnoscZSieci {
  const hosty = linki.flatMap((l) => {
    try { return l ? [new URL(l).hostname] : []; } catch { return []; }
  });
  const niezalezne = new Set(hosty.map(domena)).size;
  const mocne = hosty.some((h) => poziomZrodla(h) <= 2);
  if (niezalezne >= 2 && mocne) return "potwierdzone";
  if (mocne || niezalezne >= 2) return "prawdopodobne";
  return "slabe";
}

/* Pary MTD: numer fabryczny 7xx i serwisowy 9xx to ta sama część. */
const PARY_MTD: Array<[string, string]> = [["742", "942"], ["754", "954"], ["738", "938"], ["618", "918"], ["683", "783"]];

/**
 * Postaci zwinięte, pod którymi ten sam numer bywa zapisany. Dla dopasowania,
 * NIE do generowania numerów w odpowiedzi — ta sama zasada co w SZPERACZU.
 */
export function wariantyNumeru(norm: string): string[] {
  const w = new Set([norm]);
  /* MTD pisze się „754-0430”; po zwinięciu to 3 cyfry prefiksu i reszta. */
  if (/^\d{3}\d{4,5}[a-z]?$/.test(norm)) {
    for (const [a, b] of PARY_MTD) {
      if (norm.startsWith(a)) w.add(b + norm.slice(3));
      if (norm.startsWith(b)) w.add(a + norm.slice(3));
    }
  }
  /* Wersja serwisowa „S” (B&S 491588S, Kohler 12 050 01-S): z i bez. */
  if (/^\d{6,}s$/.test(norm)) w.add(norm.slice(0, -1));
  else if (/^\d{6,}$/.test(norm)) w.add(`${norm}s`);
  return [...w];
}

/* Zdania, które zawężają listę modeli. Z `hidden-conditions.md` SZPERACZA,
   po polsku, angielsku i niemiecku. */
const WARUNEK = new RegExp([
  "will not fit", "does not fit", "not for", "only for", "only fits", "hydrostatic", "hydro\\b",
  "manual (?:transmission|gearbox)", "prior to", "serial (?:no\\.? ?)?(?:from|after|before|up to)",
  "deck\\s?\\d{2}", "nicht passend", "passt nicht", "nur für", "ab seriennummer", "bis seriennummer",
  "nie pasuje do", "tylko do", "pasuje tylko", "od numeru seryjnego", "do numeru seryjnego",
].join("|"), "i");

/**
 * Zdanie strony z warunkiem, blisko miejsca, o którym mowa (cytatu albo
 * numeru). Najwyżej 200 znaków — tyle przyjmuje warunek w bazie wiedzy.
 */
export function warunekZeStrony(tekst: string, okolica: string): string | null {
  const t = tekst.replace(/\s+/g, " ");
  const i = okolica ? t.toLowerCase().indexOf(okolica.toLowerCase().replace(/\s+/g, " ").slice(0, 60)) : -1;
  const wycinek = i >= 0 ? t.slice(Math.max(0, i - 400), i + 600) : t.slice(0, 1500);
  const m = WARUNEK.exec(wycinek);
  if (!m) return null;
  const od = Math.max(0, wycinek.lastIndexOf(".", m.index) + 1);
  const doo = wycinek.indexOf(".", m.index + m[0].length);
  const zdanie = wycinek.slice(od, doo < 0 ? undefined : doo + 1).trim();
  return `strona: „${zdanie.slice(0, 180)}”`;
}

/** Numery do sita w postaciach równoważnych — jedna lista, zwinięte. */
export const numeryZWariantami = (numery: string[]) => [...new Set(numery.flatMap((n) => wariantyNumeru(zwin(n))))];
