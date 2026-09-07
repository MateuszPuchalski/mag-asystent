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
 * JEDNA etykieta bez dwukropka — i to nie jest powrót whitelisty.
 *
 * `W zestawie uszczelka - W53-0501` (opis gaźnika `10-01022`) stoi w danych
 * BEZ dwukropka, więc `KONIEC_SEKCJI` go nie widzi. Sekcja `Zamiennik:` ciągnie
 * się wtedy do końca opisu, `rozbierz` schodzi do szczebla spacji i uszczelka
 * z kompletu zostaje ogłoszona ZAMIENNIKIEM gaźnika — czyli błędną odpowiedzią
 * udzieloną z przekonaniem. Do tego `520070/1` traci sufiks, bo `/1 W zestawie`
 * zlepia się w jeden kawałek.
 *
 * Zawartość zestawu to osobny rodzaj informacji (co jest W ŚRODKU, nie co
 * ZASTĘPUJE), dlatego dostaje własną etykietę i własny odczyt
 * (`sekcjeZestawu`). Reguła ogólna `KONIEC_SEKCJI` zostaje nietknięta:
 * rozluźnienie jej na słowa bez dwukropka wpuściłoby z powrotem prozę, którą
 * 0.61.0 wyrzuciło.
 */
export const ETYKIETA_ZESTAWU = /\b(?:w\s+zestawie(?:\s+z)?|zawiera|zawarto[sś][cć])\s*:?\s*/gi;

/** Wersja bez flagi `g` do szukania GRANICY — `exec` na globalnym regexie jest stanowy. */
const GRANICA_ZESTAWU = new RegExp(ETYKIETA_ZESTAWU.source, "i");

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
    const seg = reszta.slice(0, koniecSekcji(reszta));
    if (seg.trim()) out.push(seg);
  }
  return out;
}

/**
 * Gdzie kończy się sekcja: na WCZEŚNIEJSZYM z dwóch trafień — generycznego
 * „Słowo:" albo etykiety zestawu bez dwukropka. Brak obu = do końca opisu.
 */
function koniecSekcji(reszta: string): number {
  const slowo = KONIEC_SEKCJI.exec(reszta)?.index ?? reszta.length;
  const zestaw = GRANICA_ZESTAWU.exec(reszta)?.index ?? reszta.length;
  return Math.min(slowo, zestaw);
}

/**
 * Surowe sekcje zawartości zestawu — jak `modeleZOpisu`: bez rozstrzygania,
 * bez rozbioru na symbole. Czytelnik to podpowiedź na ekranie kartoteki.
 * Relacji „X pasuje do Y" automat z tego NIE wyprowadza: z 36 opisów daje się
 * ją wyczytać w trzech, a kierunek zależy od kształtu („W zestawie z: Y" to
 * „ja ⊂ Y", „Zawiera: X" to „X ⊂ ja") — resztę stanowi rodzeństwo
 * (`14-25028+14-25029`) i proza. Zgadywanie kierunku i roli to ta sama pułapka,
 * którą właściciel odrzucił przy `FS350 FS400` (§12).
 */
export function sekcjeZestawu(desc: string): string[] {
  return segmentyPoEtykiecie(desc, ETYKIETA_ZESTAWU).map((s) => s.trim()).filter(Boolean);
}
