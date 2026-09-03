/**
 * Wspólny podział opisu kartoteki (`tw_Opis`) na sekcje po etykiecie.
 *
 * Do etapu E3 te reguły mieszkały w `zamienniki.ts` jako prywatne stałe.
 * Parser identyfikatorów (`OEM:`, `Nr. oryg.:`, `Modele:`) potrzebuje
 * DOKŁADNIE tej samej granicy sekcji i tej samej drabiny separatorów —
 * druga kopia rozjechałaby się przy pierwszej poprawce jednej z nich.
 * `zamienniki.test.ts` jest strażnikiem tego refaktoru: przechodzi bez zmian.
 */

/**
 * Koniec listy = pierwsze generyczne „Słowo:", a NIE lista znanych etykiet.
 *
 * Whitelista (`OEM:`, `Modele:`, `W zestawie:`) wyglądała rozsądnie i wpuszczała
 * prozę: `Nr. oryg.: GND-33`, `STIHL: 017`, `HUSQVARNA: 40`, `Odpowiednik
 * oryginału o numerze: 597338`. Na karcie `W24-0807` dawała 19 śmieci zamiast
 * zera. Reguła ogólna ucina je wszystkie naraz i nie wymaga dopisywania każdej
 * nowej marki, którą ktoś kiedyś wklepie w opis (decyzja 0.61.0).
 *
 * Etykieta to od E3 JEDNO DO CZTERECH SŁÓW Z LITER (z kropkami), nie dowolne
 * 25 znaków. Poprzedni kształt dopuszczał cyfry i połykał token stojący PRZED
 * etykietą: w `OEM: 41307131600 Modele: FS200` etykietą było
 * `41307131600 Modele:`, więc sekcja OEM wychodziła pusta, a w
 * `Zamiennik: FTC180 OEM: 1` ginął zamiennik. Cyfry w etykiecie nie
 * występują w danych (`OEM:`, `Nr. oryg.:`, `W zestawie:`, `Castel Garden:`).
 */
export const KONIEC_SEKCJI =
  /(?<=^|\s)[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]*(?:\s[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]*){0,3}\s?:/;

/**
 * Drabina podziału — od separatora najpewniejszego do najbardziej wątpliwego.
 * Na każdym szczeblu najpierw próbujemy CAŁEGO kawałka, dopiero potem dzielimy
 * (maximal munch), bo separatory występują WEWNĄTRZ prawdziwych symboli:
 * `FTC199/FTC206`, `10680/1` (ukośnik), `OLEJ-MIX-0,5L` (przecinek),
 * `DBR A-7540444`, `LT 4S3` (spacja). Naiwny `split` mieli je na sieczkę.
 *
 * `+` nie ma tu wcale i to jest decyzja, nie przeoczenie — patrz `rozbierz`
 * w `zamienniki.ts`.
 */
export const DRABINA = [/\s*\/\/\s*/, /\s*[,;|\\]\s*/, /\s*\/\s*/, /\s+/];

/** Obcina przyklejoną interpunkcję, zostawiając znaki obecne w symbolach. */
export function oczysc(token: string): string {
  return token.trim().replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9*+]+$/, "");
}

/**
 * Kawałki opisu po danej etykiecie — do najbliższego „Słowo:" albo do końca
 * opisu. Pusta sekcja (`OEM:` tuż przed `Zamiennie:`) nie wraca wcale.
 */
export function segmentyPoEtykiecie(desc: string, etykieta: RegExp): string[] {
  const out: string[] = [];
  // regex z flagą /g jest stanowy — własna kopia na każde wywołanie
  const re = new RegExp(etykieta.source, etykieta.flags.includes("g") ? etykieta.flags : `${etykieta.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const reszta = desc.slice(m.index + m[0].length);
    const koniec = KONIEC_SEKCJI.exec(reszta);
    const seg = koniec ? reszta.slice(0, koniec.index) : reszta;
    if (seg.trim()) out.push(seg);
  }
  return out;
}
