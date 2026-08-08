import { test } from "node:test";
import assert from "node:assert/strict";
import { budujZapytanieBlob, nazwaZeWzorca, rozpoznajMime } from "./zdjecia.sgt.js";

/* ── Części czyste adaptera zdjęć ────────────────────────────────────────────
   Reszta modułu to wejście/wyjście, którego bez serwera MSSQL i bez udziału
   sieciowego nie da się przetestować (ta sama granica co w
   `budujFiltryDokumentow`). Tutaj jest to, co się da — i akurat to jest
   miejsce, w którym błąd kosztuje najwięcej: wstrzyknięcie przez nazwę
   z konfiguracji, niedeterministyczny wybór zdjęcia i ścieżka wychodząca
   poza katalog.                                                              */

// ── Wybór zdjęcia: kartoteka może mieć ich kilka ────────────────────────────

test("bez kolumn głównej i kolejności porządkiem zostaje sam klucz", () => {
  const q = budujZapytanieBlob({ tabela: "tw_Zdjecie", kolumna: "zdj_Dane", klucz: "zdj_TowId" });
  assert.match(q, /ORDER BY zdj_TowId$/, "arbitralny, ale STAŁY — inaczej ETag skacze przy każdym odczycie");
});

test("główne idzie przed kolejnością, kolejność przed kluczem", () => {
  const q = budujZapytanieBlob({
    tabela: "tw_Zdjecie",
    kolumna: "zdj_Dane",
    klucz: "zdj_TowId",
    glowne: "zdj_Glowne",
    kolejnosc: "zdj_Lp",
  });
  // DESC, bo „główne" to 1, a ma iść pierwsze
  assert.match(q, /ORDER BY zdj_Glowne DESC, zdj_Lp, zdj_TowId$/);
});

test("zapytanie bierze DOKŁADNIE jeden wiersz i wiąże id parametrem", () => {
  const q = budujZapytanieBlob({ tabela: "tw__Towar", kolumna: "tw_Zdjecie", klucz: "tw_Id" });
  assert.match(q, /^SELECT TOP 1 /);
  assert.match(q, /WHERE tw_Id = @id/, "id nigdy nie jest wklejane do tekstu zapytania");
});

// ── Wstrzyknięcie przez nazwy z wertis.env ──────────────────────────────────

for (const zla of ["tw_Zdjecie; DROP TABLE tw__Towar", "zdj Dane", "zdj_Dane--", "'x'"]) {
  test(`nazwa „${zla}" jest odrzucana, nie cytowana`, () => {
    assert.throws(() => budujZapytanieBlob({ tabela: "t", kolumna: zla, klucz: "id" }), /Niebezpieczna/);
    assert.throws(() => budujZapytanieBlob({ tabela: zla, kolumna: "k", klucz: "id" }), /Niebezpieczna/);
    assert.throws(
      () => budujZapytanieBlob({ tabela: "t", kolumna: "k", klucz: "id", glowne: zla }),
      /Niebezpieczna/
    );
  });
}

// ── Rozpoznanie formatu z bajtów ────────────────────────────────────────────

test("rozpoznaje formaty, które kolektor umie narysować", () => {
  assert.equal(rozpoznajMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(rozpoznajMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(rozpoznajMime(Buffer.from([0x42, 0x4d, 0x00, 0x00])), "image/bmp");
  assert.equal(rozpoznajMime(Buffer.from([0x47, 0x49, 0x46, 0x38])), "image/gif");
});

test("kontener OLE i RTF są ODRZUCANE, nie przepuszczane jako obraz", () => {
  // Zakładka „Opis" w Subiekcie to edytor RTF-owy; kolumna binarna może nieść
  // obiekt OLE z obrazem w środku. Wysłanie tego na kolektor daje pusty
  // prostokąt bez żadnego powodu na ekranie.
  assert.equal(rozpoznajMime(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), null);
  assert.equal(rozpoznajMime(Buffer.from("{\\rtf1", "latin1")), null);
  assert.equal(rozpoznajMime(Buffer.from([0x00])), null, "za krótkie to też nie obraz");
});

// ── Wzorzec nazwy pliku ─────────────────────────────────────────────────────

test("podstawia symbol i tw_id", () => {
  assert.equal(nazwaZeWzorca("{symbol}.jpg", 7, "W32-0203"), "W32-0203.jpg");
  assert.equal(nazwaZeWzorca("t{twId}.png", 7, "W32-0203"), "t7.png");
});

test("symbol z kartoteki nie wyprowadza odczytu poza katalog", () => {
  // symbol jest dowolnym łańcuchem wpisanym przez lata ręką — `W43-0506(K)`
  // jest prawdziwy, więc ../ też może się kiedyś trafić
  assert.equal(nazwaZeWzorca("{symbol}.jpg", 1, "../../etc/passwd"), "passwd.jpg");
  assert.equal(nazwaZeWzorca("{symbol}.jpg", 1, "W43-0506(K)"), "W43-0506(K).jpg");
});
