import { describe, expect, it } from "vitest";
import { paryZArkusza, wierszeZXlsx } from "./xlsx";

/* ── Czytnik arkusza (0.441.0) ────────────────────────────────────────────
   W biurze ten kod nie miał testu, a trzy jego pułapki kosztowały realne
   zgłoszenia: prefiks `x:` z Subiekta (plik „pusty" przy 125 wierszach),
   pomijane puste komórki (kolumny przesunięte w lewo) i teksty współdzielone
   (całe kolumny jako liczby). Pliki budujemy tu z bajtów, bez biblioteki —
   stąd własny, mały zapis ZIP-a z wpisami bez kompresji i deflate. */

const enc = new TextEncoder();

async function deflate(dane: Uint8Array): Promise<Uint8Array> {
  const s = new ReadableStream<Uint8Array>({ start(k) { k.enqueue(dane); k.close(); } })
    .pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Minimalny ZIP: nagłówki lokalne, centralny katalog i stopka. CRC = 0 — czytnik go nie sprawdza. */
async function zip(pliki: Array<{ nazwa: string; tresc: string; deflate?: boolean }>): Promise<ArrayBuffer> {
  const czesci: Uint8Array[] = [];
  const katalog: Uint8Array[] = [];
  let offset = 0;
  for (const p of pliki) {
    const nazwa = enc.encode(p.nazwa);
    const surowe = enc.encode(p.tresc);
    const dane = p.deflate ? await deflate(surowe) : surowe;
    const lok = new DataView(new ArrayBuffer(30));
    lok.setUint32(0, 0x04034b50, true); lok.setUint16(8, p.deflate ? 8 : 0, true);
    lok.setUint32(18, dane.length, true); lok.setUint32(22, surowe.length, true);
    lok.setUint16(26, nazwa.length, true);
    const kat = new DataView(new ArrayBuffer(46));
    kat.setUint32(0, 0x02014b50, true); kat.setUint16(10, p.deflate ? 8 : 0, true);
    kat.setUint32(20, dane.length, true); kat.setUint32(24, surowe.length, true);
    kat.setUint16(28, nazwa.length, true); kat.setUint32(42, offset, true);
    czesci.push(new Uint8Array(lok.buffer), nazwa, dane);
    katalog.push(new Uint8Array(kat.buffer), nazwa);
    offset += 30 + nazwa.length + dane.length;
  }
  const rozmiarKat = katalog.reduce((s, c) => s + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, pliki.length, true);
  eocd.setUint16(10, pliki.length, true); eocd.setUint32(12, rozmiarKat, true);
  eocd.setUint32(16, offset, true);
  const wszystko = [...czesci, ...katalog, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(wszystko.reduce((s, c) => s + c.length, 0));
  let i = 0;
  for (const c of wszystko) { out.set(c, i); i += c.length; }
  return out.buffer;
}

describe("czytnik .xlsx", () => {
  it("prefiks x: z Subiekta, puste komórki i wpis deflate", async () => {
    /* Kolumna B pusta w wierszu 2 — Excel jej nie zapisuje, a adres `C2`
       mówi, gdzie leży lokalizacja. */
    const arkusz = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <x:sheetData>
        <x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Symbol</x:t></x:is></x:c>
          <x:c r="B1" t="inlineStr"><x:is><x:t>Nazwa</x:t></x:is></x:c>
          <x:c r="C1" t="inlineStr"><x:is><x:t>Lokalizacja SIE</x:t></x:is></x:c></x:row>
        <x:row r="2"><x:c r="A2"><x:v>440117</x:v></x:c>
          <x:c r="C2" t="inlineStr"><x:is><x:t> R-09-4 </x:t></x:is></x:c></x:row>
      </x:sheetData></x:worksheet>`;
    const bufor = await zip([{ nazwa: "xl/worksheets/sheet1.xml", tresc: arkusz, deflate: true }]);
    expect(paryZArkusza(await wierszeZXlsx(bufor))).toEqual([{ symbol: "440117", lokalizacja: "R-09-4" }]);
  });

  it("teksty współdzielone: komórka t=\"s\" niesie indeks, nie treść", async () => {
    const wsp = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <si><t>Symbol</t></si><si><t>Lokalizacja</t></si><si><t>HM-0410</t></si><si><r><t>P-01</t></r><r><t>-3</t></r></si></sst>`;
    const arkusz = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>`;
    const bufor = await zip([
      { nazwa: "xl/sharedStrings.xml", tresc: wsp },
      { nazwa: "xl/worksheets/sheet1.xml", tresc: arkusz },
    ]);
    expect(paryZArkusza(await wierszeZXlsx(bufor))).toEqual([{ symbol: "HM-0410", lokalizacja: "P-01-3" }]);
  });

  it("plik bez kolumn Symbol i Lokalizacja mówi, czego mu brak", () => {
    expect(() => paryZArkusza([{ A: "Kod", B: "Adres" }])).toThrow(/Symbol.*Lokalizacja/);
    expect(() => paryZArkusza([])).toThrow("Arkusz jest pusty");
  });

  it("coś, co nie jest ZIP-em, nie udaje pustego arkusza", async () => {
    await expect(wierszeZXlsx(enc.encode("symbol;lokalizacja").buffer as ArrayBuffer)).rejects.toThrow(/brak stopki ZIP/);
  });
});

describe("tabelaZWierszy", () => {
  it("kolumny stoją po pozycji, a komórka pominięta przez Excela zostaje pustym tekstem", async () => {
    const { tabelaZWierszy } = await import("./xlsx");
    expect(tabelaZWierszy([{ A: "Indeks", C: "EAN", D: "OEM" }, { A: "W80-2005", D: "6.904-143.0" }, { AA: "x" }]))
      .toEqual([
        ["Indeks", "", "EAN", "OEM", ...new Array(23).fill("")],
        ["W80-2005", "", "", "6.904-143.0", ...new Array(23).fill("")],
        [...new Array(26).fill(""), "x"],
      ]);
  });
});
