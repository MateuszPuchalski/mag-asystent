/* ── Czytnik arkusza .xlsx (z `biuro.html` 0.138.0, w panelu od 0.441.0) ──
   ARKUSZ ROZBIERA PRZEGLĄDARKA, nie serwer. Na serwer jedzie STRUKTURA —
   lista `{ symbol, lokalizacja }` — a nigdy bajty pliku. Inaczej serwer
   o dwóch zależnościach musiałby dostać trzecią, do rozpakowywania ZIP-a.

   .xlsx to ZIP z XML-ami w środku, a przeglądarka umie oba:
   `DecompressionStream` rozpakowuje, `DOMParser` czyta. Zero bibliotek.
   W biurze ten kod nie miał ani jednego testu; tutaj ma, na plikach
   zbudowanych w teście — także z prefiksem `x:`, którego używa Subiekt. */

/** Nagłówki, po których poznajemy kolumny. Ta sama reguła, co na serwerze. */
const ARK_SYMBOL = "symbol";
const ARK_LOKALIZACJA = "lokalizacja";

export interface ParaArkusza { symbol: string; lokalizacja: string }

/** Wiersz arkusza: litera kolumny → tekst komórki. */
export type WierszArkusza = Record<string, string>;

/**
 * Rozbiór ZIP-a przez STOPKĘ (EOCD) i centralny katalog, a nie przez skanowanie
 * nagłówków lokalnych od początku pliku.
 *
 * Nagłówek lokalny przy ustawionym bicie 3 flagi ma zera w polach rozmiaru —
 * prawdziwe wartości leżą w deskryptorze ZA danymi. Skan sekwencyjny rozjeżdża
 * się wtedy na pierwszym takim wpisie i zwraca śmieci. Centralny katalog ma
 * rozmiary ZAWSZE.
 */
export async function rozpakujZip(bufor: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const b = new Uint8Array(bufor);
  const dv = new DataView(bufor);
  // EOCD ma sygnaturę PK\x05\x06 i komentarz do 64 kB, więc szukamy od końca.
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65535; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("To nie jest plik .xlsx (brak stopki ZIP)");
  const ile = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const pliki: Record<string, Uint8Array> = {};
  for (let n = 0; n < ile; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Uszkodzony katalog ZIP");
    const metoda = dv.getUint16(p + 10, true);
    const skompr = dv.getUint32(p + 20, true);
    const dlNazwy = dv.getUint16(p + 28, true);
    const dlExtra = dv.getUint16(p + 30, true);
    const dlKom = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const nazwa = new TextDecoder().decode(b.subarray(p + 46, p + 46 + dlNazwy));
    p += 46 + dlNazwy + dlExtra + dlKom;

    // Dane zaczynają się za nagłówkiem LOKALNYM — jego pola długości bywają
    // inne niż w katalogu (extra field), więc czytamy je stąd, nie stamtąd.
    const lokDlNazwy = dv.getUint16(offset + 26, true);
    const lokDlExtra = dv.getUint16(offset + 28, true);
    const od = offset + 30 + lokDlNazwy + lokDlExtra;
    const dane = b.subarray(od, od + skompr);
    // Metoda 0 = bez kompresji. Plik z Subiekta ma OBIE, więc obie obsługujemy.
    pliki[nazwa] = metoda === 0 ? dane : await rozdmuchaj(dane);
  }
  return pliki;
}

/**
 * Deflate bez nagłówka zlib — tak trzyma dane ZIP.
 *
 * Strumień składamy RĘCZNIE, nie przez `new Blob([dane]).stream()` jak biuro:
 * `Blob.stream()` nie istnieje w jsdom, a czytnik bez testu to czytnik, który
 * przestaje działać po cichu przy pierwszej zmianie.
 */
async function rozdmuchaj(dane: Uint8Array): Promise<Uint8Array> {
  const wejscie = new ReadableStream<Uint8Array>({
    start(k) { k.enqueue(dane); k.close(); },
  });
  const s = wejscie.pipeThrough(new DecompressionStream("deflate-raw") as unknown as
    ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Litera kolumny z adresu komórki: `C12` → `C`. */
const kolumnaZAdresu = (ref: string | null) => (ref ?? "").replace(/\d+/g, "");

/**
 * Wiersze arkusza .xlsx jako mapy kolumna → tekst.
 *
 * Numer kolumny bierze się z ADRESU komórki, nie z jej pozycji w wierszu:
 * Excel pomija komórki puste, więc liczenie po kolei przesuwa wszystko w lewo
 * i „Nazwa" ląduje tam, gdzie miał być adres.
 */
export async function wierszeZXlsx(bufor: ArrayBuffer): Promise<WierszArkusza[]> {
  const pliki = await rozpakujZip(bufor);
  const arkusz = Object.keys(pliki).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!arkusz) throw new Error("Plik nie zawiera arkusza");
  const xml = (u8: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(u8), "application/xml");

  /* Szukamy po NAZWIE LOKALNEJ, a nie po nazwie kwalifikowanej. Eksport
     z Subiekta prefiksuje wszystko przestrzenią nazw — `<x:row>`, `<x:c>` —
     i wtedy `getElementsByTagName("row")` nie znajduje NICZEGO. Plik wyglądał
     na pusty, choć miał 125 wierszy. Ta forma obsługuje obie odmiany. */
  const poNazwie = (el: Document | Element, nazwa: string) => [...el.getElementsByTagNameNS("*", nazwa)];

  /* Teksty współdzielone: komórka `t="s"` niesie tylko indeks. Bez nich całe
     kolumny wróciłyby jako liczby. */
  const wsp: string[] = [];
  const wspolne = pliki["xl/sharedStrings.xml"];
  if (wspolne) {
    for (const si of poNazwie(xml(wspolne), "si")) {
      wsp.push(poNazwie(si, "t").map((t) => t.textContent ?? "").join(""));
    }
  }

  const wiersze: WierszArkusza[] = [];
  for (const row of poNazwie(xml(pliki[arkusz]), "row")) {
    const komorki: WierszArkusza = {};
    for (const c of poNazwie(row, "c")) {
      const typ = c.getAttribute("t");
      let v: string;
      if (typ === "inlineStr") {
        v = poNazwie(c, "t").map((t) => t.textContent ?? "").join("");
      } else {
        v = poNazwie(c, "v")[0]?.textContent ?? "";
        // `t="s"` to INDEKS do tablicy tekstów, nie treść komórki.
        if (typ === "s") v = wsp[Number(v)] ?? "";
      }
      komorki[kolumnaZAdresu(c.getAttribute("r"))] = v;
    }
    wiersze.push(komorki);
  }
  return wiersze;
}

/**
 * Znajduje kolumny po nagłówku i wyciąga pary symbol–lokalizacja.
 *
 * Symbol jedzie dalej jako TEKST. Excel podaje „440117" jako liczbę i bez tego
 * wiersz nie dopasowałby się do żadnej kartoteki — po cichu, bo lista
 * nieznanych symboli i tak bywa długa.
 */
export function paryZArkusza(wiersze: WierszArkusza[]): ParaArkusza[] {
  if (!wiersze.length) throw new Error("Arkusz jest pusty");
  let kSym: string | null = null;
  let kLok: string | null = null;
  for (const [kol, wartosc] of Object.entries(wiersze[0])) {
    const h = String(wartosc).trim().toLowerCase();
    if (h === ARK_SYMBOL) kSym = kol;
    // „Lokalizacja SIE" — sufiks bywa różny, więc dopasowanie po przedrostku.
    else if (h.startsWith(ARK_LOKALIZACJA)) kLok = kol;
  }
  if (!kSym || !kLok) {
    throw new Error("Arkusz musi mieć kolumny „Symbol” i „Lokalizacja” w pierwszym wierszu");
  }
  return wiersze.slice(1).map((w) => ({
    symbol: String(w[kSym!] ?? "").trim(),
    lokalizacja: String(w[kLok!] ?? "").trim(),
  }));
}
