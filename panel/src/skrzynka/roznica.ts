/**
 * RÓŻNICA SŁÓW DWÓCH WERSJI SZKICU — co Copilot dopisał, a co skreślił.
 *
 * Agent wysyła klientowi tekst, którego w całości nie pisał. Po poprawce
 * Copilota musi zobaczyć, CO się zmieniło, zanim kliknie „Wyślij”. Czytanie
 * dwóch wersji obok siebie każe szukać różnicy wzrokiem, a różnica słów
 * pokazuje ją od razu.
 *
 * Jednostką jest SŁOWO, nie znak. Różnica znaków rozbija „pasuje” na „pas”
 * i „uje” i czyta się gorzej niż obie wersje osobno.
 *
 * Odstępy są osobnymi kawałkami i zostają co do znaku, z nowymi liniami.
 * Szkic ma akapity, a wynik rysuje się jako tekst w `whitespace-pre-wrap`.
 */

export type RodzajKawalka = "wspolne" | "dodane" | "usuniete";
export type KawalekRoznicy = { rodzaj: RodzajKawalka; tekst: string };

/**
 * Powyżej tylu komórek tablicy LCS różnica poddaje się i oddaje „całe
 * usunięte, całe dodane”. Dwa szkice po 4000 znaków po obcięciu wspólnego
 * początku i końca mieszczą się z zapasem. Próg chroni kartę przed
 * zawieszeniem na tekście, którego żaden szkic nie ma.
 */
const PROG_KOMOREK = 6_000_000;

/** Słowa i odstępy na zmianę. Odstęp to dowolny ciąg białych znaków. */
function tokeny(t: string): string[] {
  return t.match(/\s+|\S+/g) ?? [];
}

const bialy = (t: string) => /^\s+$/.test(t);

/**
 * Różnica `przed` → `po` jako lista kawałków w kolejności czytania.
 *
 * Najpierw odcinamy wspólny początek i koniec, bo poprawka zwykle dotyka
 * jednego zdania w środku. Środek liczy klasyczne LCS na słowach.
 */
export function roznicaSlow(przed: string, po: string): KawalekRoznicy[] {
  const a = tokeny(przed);
  const b = tokeny(po);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let k = 0;
  while (k < a.length - p && k < b.length - p && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  const sa = a.slice(p, a.length - k);
  const sb = b.slice(p, b.length - k);

  const kroki: KawalekRoznicy[] = [];
  const dodaj = (rodzaj: RodzajKawalka, tekst: string) => { if (tekst) kroki.push({ rodzaj, tekst }); };
  dodaj("wspolne", a.slice(0, p).join(""));
  for (const krok of srodek(sa, sb)) kroki.push(krok);
  dodaj("wspolne", a.slice(a.length - k).join(""));
  return uporzadkuj(kroki);
}

/** LCS na słowach. Tablica „od końca”, żeby ścieżkę czytać od początku. */
function srodek(sa: string[], sb: string[]): KawalekRoznicy[] {
  const n = sa.length;
  const m = sb.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > PROG_KOMOREK) {
    return [
      ...sa.map((tekst) => ({ rodzaj: "usuniete" as const, tekst })),
      ...sb.map((tekst) => ({ rodzaj: "dodane" as const, tekst })),
    ];
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = sa[i] === sb[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const wynik: KawalekRoznicy[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sa[i] === sb[j]) { wynik.push({ rodzaj: "wspolne", tekst: sa[i] }); i++; j++; }
    /* Przy remisie najpierw skreślenie: przy zamianie słowa czyta się
       „było → jest”, a nie odwrotnie. */
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { wynik.push({ rodzaj: "usuniete", tekst: sa[i] }); i++; }
    else { wynik.push({ rodzaj: "dodane", tekst: sb[j] }); j++; }
  }
  for (; i < n; i++) wynik.push({ rodzaj: "usuniete", tekst: sa[i] });
  for (; j < m; j++) wynik.push({ rodzaj: "dodane", tekst: sb[j] });
  return wynik;
}

/**
 * Skleja zmiany w czytelne bloki: najpierw całe skreślenie, potem całe
 * dopisanie.
 *
 * Samo LCS przy zamianie dwóch słów dopasowuje odstęp między nimi i daje
 * „~~foo~~baz ~~bar~~qux”. Odstęp wspólny, który stoi MIĘDZY dwiema zmianami,
 * należy więc do obu stron, a blok czyta się „~~foo bar~~ baz qux”.
 */
function uporzadkuj(kroki: KawalekRoznicy[]): KawalekRoznicy[] {
  const wynik: KawalekRoznicy[] = [];
  const dopisz = (rodzaj: RodzajKawalka, tekst: string) => {
    if (!tekst) return;
    const ostatni = wynik[wynik.length - 1];
    if (ostatni && ostatni.rodzaj === rodzaj) ostatni.tekst += tekst;
    else wynik.push({ rodzaj, tekst });
  };
  let i = 0;
  while (i < kroki.length) {
    if (kroki[i].rodzaj === "wspolne") { dopisz("wspolne", kroki[i].tekst); i++; continue; }
    let usuniete = "";
    let dodane = "";
    while (i < kroki.length) {
      const k = kroki[i];
      if (k.rodzaj === "usuniete") usuniete += k.tekst;
      else if (k.rodzaj === "dodane") dodane += k.tekst;
      else if (bialy(k.tekst) && kroki[i + 1] && kroki[i + 1].rodzaj !== "wspolne") {
        usuniete += k.tekst;
        dodane += k.tekst;
      } else break;
      i++;
    }
    dopisz("usuniete", usuniete);
    dopisz("dodane", dodane);
  }
  return wynik;
}

/** Ile słów doszło i ile odeszło — na jedno zdanie nad różnicą. Odstępy się nie liczą. */
export function liczbaZmian(roznica: KawalekRoznicy[]): { dodane: number; usuniete: number } {
  const slowa = (t: string) => (t.match(/\S+/g) ?? []).length;
  let dodane = 0;
  let usuniete = 0;
  for (const k of roznica) {
    if (k.rodzaj === "dodane") dodane += slowa(k.tekst);
    if (k.rodzaj === "usuniete") usuniete += slowa(k.tekst);
  }
  return { dodane, usuniete };
}
