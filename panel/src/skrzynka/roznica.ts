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
 *
 * SAMO LCS SŁÓW CZYTA SIĘ ŹLE przy przepisanym zdaniu. Dopasowuje przypadkowe
 * „z” i odstępy, więc zdanie rozsypuje się na pojedyncze słowa, a skreślone
 * punkty listy przeplatają się z nowym tekstem. Stąd sprzątanie po LCS:
 * zdanie zmienione w większości idzie w całości, linia listy też, a drobny
 * wspólny okruch między dwiema zmianami dokleja się do zmiany.
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

/**
 * Najwyżej tyle słów może mieć wspólny okruch między dwiema zmianami, żeby
 * dokleić się do nich. „Ten zestaw ~~z~~ to” czyta się jako szum, a trzy
 * wspólne słowa to już fraza, którą agent rozpozna w obu wersjach.
 */
const OKRUCH_SLOW = 2;

/** Słowa i odstępy na zmianę. Odstęp to dowolny ciąg białych znaków. */
function tokeny(t: string): string[] {
  return t.match(/\s+|\S+/g) ?? [];
}

const bialy = (t: string) => /^\s+$/.test(t);
const slowa = (t: string) => (t.match(/\S+/g) ?? []).length;
/** Koniec zdania: kropka, wykrzyknik, pytajnik albo dwukropek na końcu słowa. */
const konczyZdanie = (slowo: string) => /[.!?:]$/.test(slowo);
/** Znak punktu listy, który model i agent stawiają na początku linii. */
const punktListy = (slowo: string) => /^[-–•*]$/.test(slowo);

/**
 * Różnica `przed` → `po` jako lista kawałków w kolejności czytania.
 *
 * Najpierw odcinamy wspólny początek i koniec, bo poprawka zwykle dotyka
 * jednego zdania w środku. Środek liczy klasyczne LCS na słowach, a potem
 * sprzątanie: zdania, okruchy i odstępy.
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

  /* Kawałki na poziomie POJEDYNCZYCH słów i odstępów. Granice zdań leżą
     między nimi, więc sklejanie czeka do samego końca. */
  const kroki: KawalekRoznicy[] = [
    ...a.slice(0, p).map((tekst) => ({ rodzaj: "wspolne" as const, tekst })),
    ...srodek(sa, sb),
    ...a.slice(a.length - k).map((tekst) => ({ rodzaj: "wspolne" as const, tekst })),
  ];
  return rozsunOdstepy(uporzadkuj(scalOkruchy(caleZdania(kroki))));
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
 * ZDANIE PRZEPISANE W WIĘKSZOŚCI IDZIE W CAŁOŚCI, linia listy przy każdej
 * zmianie też.
 *
 * Tekst dzieli się na odcinki w miejscach, gdzie OBIE wersje stoją na
 * granicy: po odstępie z nową linią albo po odstępie za słowem kończącym
 * zdanie. Odcinek, w którym mniej niż połowa słów dłuższej strony jest
 * wspólna, zamienia się w „całe stare, całe nowe”. Okruchy wspólnych słów
 * w przepisanym zdaniu tylko by je szatkowały.
 *
 * Punkt listy to jedna rzecz: „- łańcuch ~~64~~72 ogniwa” chowa, że zmienił
 * się cały punkt. Odcinek zaczęty punktem listy na początku linii idzie więc
 * w całości przy każdej zmianie i kończy się dopiero z linią.
 */
type Granica = "linia" | "zdanie" | null;

function caleZdania(kroki: KawalekRoznicy[]): KawalekRoznicy[] {
  const wynik: KawalekRoznicy[] = [];
  let start = 0;
  let stara: Granica = "linia";
  let nowa: Granica = "linia";
  let ostatnieStare = "";
  let ostatnieNowe = "";
  let lista = czyLista(kroki, 0);
  /* Granica strony po jednym kawałku: odstęp z nową linią, odstęp za końcem
     zdania albo nic, gdy stoi słowo. */
  const poKawalku = (tekst: string, ostatnie: string): Granica =>
    !bialy(tekst) ? null : tekst.includes("\n") ? "linia" : konczyZdanie(ostatnie) ? "zdanie" : null;
  for (let i = 0; i < kroki.length; i++) {
    const naGranicy = lista ? stara === "linia" && nowa === "linia" : stara !== null && nowa !== null;
    if (i > start && naGranicy) {
      wynik.push(...odcinek(kroki.slice(start, i), lista));
      start = i;
      lista = stara === "linia" && nowa === "linia" && czyLista(kroki, i);
    }
    const k = kroki[i];
    if (k.rodzaj !== "dodane") {
      stara = poKawalku(k.tekst, ostatnieStare);
      if (!bialy(k.tekst)) ostatnieStare = k.tekst;
    }
    if (k.rodzaj !== "usuniete") {
      nowa = poKawalku(k.tekst, ostatnieNowe);
      if (!bialy(k.tekst)) ostatnieNowe = k.tekst;
    }
  }
  wynik.push(...odcinek(kroki.slice(start), lista));
  return wynik;
}

/** Czy odcinek od `start` zaczyna się punktem listy w którejś z wersji. */
function czyLista(kroki: KawalekRoznicy[], start: number): boolean {
  let stare: string | null = null;
  let nowe: string | null = null;
  for (let i = start; i < kroki.length && (stare === null || nowe === null); i++) {
    const k = kroki[i];
    if (bialy(k.tekst)) {
      if (k.rodzaj === "wspolne" && k.tekst.includes("\n")) break;
      continue;
    }
    if (k.rodzaj !== "dodane" && stare === null) stare = k.tekst;
    if (k.rodzaj !== "usuniete" && nowe === null) nowe = k.tekst;
  }
  return (stare !== null && punktListy(stare)) || (nowe !== null && punktListy(nowe));
}

/** Jeden odcinek między granicami: zostaje słowo po słowie albo idzie w całości. */
function odcinek(kroki: KawalekRoznicy[], lista: boolean): KawalekRoznicy[] {
  let wspolne = 0;
  let stare = 0;
  let nowe = 0;
  let zmiana = false;
  for (const k of kroki) {
    const n = slowa(k.tekst);
    if (k.rodzaj === "wspolne") { wspolne += n; stare += n; nowe += n; continue; }
    zmiana = true;
    if (k.rodzaj === "usuniete") stare += n; else nowe += n;
  }
  if (!zmiana) return kroki;
  const wiekszosc = 1 - wspolne / Math.max(stare, nowe, 1) > 0.5;
  if (!lista && !wiekszosc) return kroki;
  const tekstStary = kroki.filter((k) => k.rodzaj !== "dodane").map((k) => k.tekst).join("");
  const tekstNowy = kroki.filter((k) => k.rodzaj !== "usuniete").map((k) => k.tekst).join("");
  const wynik: KawalekRoznicy[] = [];
  if (tekstStary) wynik.push({ rodzaj: "usuniete", tekst: tekstStary });
  if (tekstNowy) wynik.push({ rodzaj: "dodane", tekst: tekstNowy });
  return wynik;
}

/**
 * OKRUCH MIĘDZY DWIEMA ZMIANAMI NALEŻY DO ZMIANY.
 *
 * Wspólny fragment do dwóch słów bez nowej linii, wciśnięty między dwie
 * zmiany, przechodzi na obie strony. Sam odstęp przechodzi zawsze, także
 * z nową linią: inaczej skreślone punkty listy i nowe zdania stoją na
 * przemian, a czyta się je jako jeden blok „było — jest”.
 *
 * Tylko gdy po sklejeniu po obu stronach coś jest. Dwa dopisania rozdzielone
 * wspólnym słowem zostają osobno, bo skreślenie samego „i” byłoby fałszem.
 */
function scalOkruchy(kroki: KawalekRoznicy[]): KawalekRoznicy[] {
  type Pas = { zmiana: boolean; kroki: KawalekRoznicy[] };
  const pasy: Pas[] = [];
  for (const k of kroki) {
    const zmiana = k.rodzaj !== "wspolne";
    const ostatni = pasy[pasy.length - 1];
    if (ostatni && ostatni.zmiana === zmiana) ostatni.kroki.push(k);
    else pasy.push({ zmiana, kroki: [k] });
  }
  const ma = (pas: Pas, rodzaj: RodzajKawalka) => pas.kroki.some((k) => k.rodzaj === rodzaj);
  const wynik: Pas[] = [];
  for (let i = 0; i < pasy.length; i++) {
    const pas = pasy[i];
    const lewy = wynik[wynik.length - 1];
    const prawy = pasy[i + 1];
    if (!pas.zmiana && lewy?.zmiana && prawy?.zmiana) {
      const tekst = pas.kroki.map((k) => k.tekst).join("");
      const okruch = bialy(tekst) || (!tekst.includes("\n") && slowa(tekst) <= OKRUCH_SLOW);
      const obieStrony = (ma(lewy, "usuniete") || ma(prawy, "usuniete"))
        && (ma(lewy, "dodane") || ma(prawy, "dodane"));
      if (okruch && obieStrony) {
        lewy.kroki.push({ rodzaj: "usuniete", tekst }, { rodzaj: "dodane", tekst }, ...prawy.kroki);
        i++;
        continue;
      }
    }
    wynik.push({ zmiana: pas.zmiana, kroki: [...pas.kroki] });
  }
  return wynik.flatMap((p) => p.kroki);
}

/**
 * Skleja zmiany w czytelne bloki: najpierw całe skreślenie, potem całe
 * dopisanie, a wspólne słowa w jeden kawałek.
 */
function uporzadkuj(kroki: KawalekRoznicy[]): KawalekRoznicy[] {
  const wynik: KawalekRoznicy[] = [];
  let i = 0;
  while (i < kroki.length) {
    if (kroki[i].rodzaj === "wspolne") {
      let tekst = "";
      while (i < kroki.length && kroki[i].rodzaj === "wspolne") tekst += kroki[i++].tekst;
      wynik.push({ rodzaj: "wspolne", tekst });
      continue;
    }
    let usuniete = "";
    let dodane = "";
    while (i < kroki.length && kroki[i].rodzaj !== "wspolne") {
      if (kroki[i].rodzaj === "usuniete") usuniete += kroki[i].tekst; else dodane += kroki[i].tekst;
      i++;
    }
    if (usuniete) wynik.push({ rodzaj: "usuniete", tekst: usuniete });
    if (dodane) wynik.push({ rodzaj: "dodane", tekst: dodane });
  }
  return wynik;
}

/**
 * ODSTĘP MIĘDZY SKREŚLENIEM A DOPISANIEM NIE ZNIKA.
 *
 * Skreślenie, po którym od razu stoi dopisanie, rysuje się obok siebie.
 * Gdy żadne z nich nie ma odstępu na styku, słowa się sklejają:
 * „~~Husqvarna~~dziękujemy”. Wspólny odstęp zza bloku (albo sprzed niego)
 * przechodzi więc na obie strony. Obie wersje odbudowują się co do znaku,
 * bo ten sam odstęp jest i w skreśleniu, i w dopisaniu.
 */
function rozsunOdstepy(kroki: KawalekRoznicy[]): KawalekRoznicy[] {
  const k = kroki.map((x) => ({ ...x }));
  for (let i = 0; i + 1 < k.length; i++) {
    const u = k[i];
    const d = k[i + 1];
    if (u.rodzaj !== "usuniete" || d.rodzaj !== "dodane") continue;
    if (/\s$/.test(u.tekst) || /^\s/.test(d.tekst)) continue;
    const za = k[i + 2];
    const przed = k[i - 1];
    const poOdstep = za?.rodzaj === "wspolne" ? /^\s+/.exec(za.tekst)?.[0] : undefined;
    const przedOdstep = przed?.rodzaj === "wspolne" ? /\s+$/.exec(przed.tekst)?.[0] : undefined;
    if (poOdstep) {
      u.tekst += poOdstep;
      d.tekst += poOdstep;
      za.tekst = za.tekst.slice(poOdstep.length);
    } else if (przedOdstep) {
      u.tekst = przedOdstep + u.tekst;
      d.tekst = przedOdstep + d.tekst;
      przed.tekst = przed.tekst.slice(0, przed.tekst.length - przedOdstep.length);
    }
  }
  return k.filter((x) => x.tekst !== "");
}

/** Ile słów doszło i ile odeszło — na jedno zdanie nad różnicą. Odstępy się nie liczą. */
export function liczbaZmian(roznica: KawalekRoznicy[]): { dodane: number; usuniete: number } {
  let dodane = 0;
  let usuniete = 0;
  for (const k of roznica) {
    if (k.rodzaj === "dodane") dodane += slowa(k.tekst);
    if (k.rodzaj === "usuniete") usuniete += slowa(k.tekst);
  }
  return { dodane, usuniete };
}

/**
 * Jedno miejsce zmiany w NOWYM tekście: zakres dopisanego `[od, do)`
 * w jednostkach `String`, czyli tych samych, w których liczy pole tekstowe,
 * i tekst skreślony w tym miejscu. Samo skreślenie ma `od === do`, samo
 * dopisanie pusty `usuniete`.
 */
export type MiejsceZmiany = { od: number; do: number; usuniete: string };

/**
 * Miejsca zmian przeniesione na tekst `po`, do podświetlenia w polu.
 *
 * Liczone z tej samej różnicy co blok w dopytaniu, żeby pole i różnica nie
 * mówiły o dwóch różnych zmianach. Skreślenie z dopisaniem to jedno miejsce,
 * bo agent czyta je jako jedną poprawkę.
 */
export function zakresyWNowym(przed: string, po: string): MiejsceZmiany[] {
  const wynik: MiejsceZmiany[] = [];
  let poz = 0;
  let biezace: MiejsceZmiany | null = null;
  for (const k of roznicaSlow(przed, po)) {
    if (k.rodzaj === "wspolne") {
      biezace = null;
      poz += k.tekst.length;
      continue;
    }
    if (!biezace) {
      biezace = { od: poz, do: poz, usuniete: "" };
      wynik.push(biezace);
    }
    if (k.rodzaj === "usuniete") biezace.usuniete += k.tekst;
    else { poz += k.tekst.length; biezace.do = poz; }
  }
  return wynik;
}
