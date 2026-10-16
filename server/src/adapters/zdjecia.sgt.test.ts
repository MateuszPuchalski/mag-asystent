import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budujZapytanieBezZdjecia,
  budujZapytanieBlob,
  nazwaZeWzorca,
  rozpoznajMime,
  wybierzObraz,
  wzorzecLike,
} from "./zdjecia.sgt.js";

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

test("prawdziwa tabela Subiekta: tw_ZdjecieTw domyka porządek po zd_Id", () => {
  /* Ustalone na bazie firmy: zdjęcia leżą w `tw_ZdjecieTw`, gdzie `zd_IdTowar`
     jest kluczem OBCYM — ten sam dla wszystkich zdjęć jednego towaru. Gdyby
     porządek kończył się na nim, dwa zdjęcia bez flagi „główne" wracałyby
     losowo. Rozstrzyga dopiero `zd_Id`. */
  const q = budujZapytanieBlob({
    tabela: "tw_ZdjecieTw",
    kolumna: "zd_Zdjecie",
    klucz: "zd_IdTowar",
    glowne: "zd_Glowne",
    kolejnosc: "zd_Id",
  });
  assert.match(q, /ORDER BY zd_Glowne DESC, zd_Id, zd_IdTowar$/);
  assert.match(q, /WHERE zd_IdTowar = @id/);
});

test("zapytanie bierze garść wierszy i wiąże id parametrem", () => {
  const q = budujZapytanieBlob({ tabela: "tw__Towar", kolumna: "tw_Zdjecie", klucz: "tw_Id" });
  /* TOP kilka, nie TOP 1: główne zdjęcie bywa kontenerem OLE, a wtedy kartoteka
     wyglądała na pozbawioną zdjęcia mimo normalnych JPEG-ów obok. Liczba ma
     jednak zostać mała — to są BLOB-y. */
  assert.match(q, /^SELECT TOP [1-5] /);
  assert.match(q, /WHERE tw_Id = @id/, "id nigdy nie jest wklejane do tekstu zapytania");
});

// ── Wybór obrazu spośród zdjęć kartoteki ────────────────────────────────────

test("bierze pierwszy kandydat, który jest obrazem", () => {
  const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const w = wybierzObraz([OLE, JPEG]);
  assert.equal(w?.mime, "image/jpeg", "OLE nie narysuje żaden kolektor — bierzemy kolejne");
  assert.equal(w?.bajty, JPEG);
});

test("gdy pierwszy JEST obrazem, dalszych nie ruszamy", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // porządek ustala baza: „główne" idzie pierwsze i ma wygrać
  assert.equal(wybierzObraz([JPEG, PNG])?.bajty, JPEG);
});

test("PDF z zakładki „Opis” nie trafia na kolektor jako zdjęcie", () => {
  /* `rozpoznajMime` zna PDF dla podglądu dokumentu na osi rozmowy. Kolektor
     rysuje wyłącznie obrazy, więc PDF jest tu tym samym, co OLE: pomijamy. */
  const PDF = Buffer.from("%PDF-1.7\n%\u00e2\u00e3", "latin1");
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(wybierzObraz([PDF, JPEG])?.bajty, JPEG);
  assert.equal(wybierzObraz([PDF]), null, "sam PDF to brak zdjęcia");
});

test("same śmieci to brak zdjęcia, nie błąd", () => {
  const RTF = Buffer.from([0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31, 0x00, 0x00]);
  assert.equal(wybierzObraz([RTF, null, Buffer.alloc(0)]), null);
  assert.equal(wybierzObraz([]), null, "kartoteka bez ani jednego wiersza");
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
  /* WebP z Androida: `RIFF` + rozmiar + `WEBP`. Sam `RIFF` (WAV, AVI) nie wystarcza. */
  assert.equal(rozpoznajMime(Buffer.from("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(rozpoznajMime(Buffer.from("RIFF\u0010\u0000\u0000\u0000WAVEfmt ", "latin1")), null);
});

test("PDF rozpoznaje po `%PDF-`, a nie po samym `%PDF`", () => {
  /* Format dla podglądu dokumentu na osi. Myślnik należy do sygnatury:
     bez niego cztery bajty bywają początkiem zwykłego tekstu. */
  assert.equal(rozpoznajMime(Buffer.from("%PDF-1.4\n", "latin1")), "application/pdf");
  assert.equal(rozpoznajMime(Buffer.from("%PDF", "latin1")), null);
  assert.equal(rozpoznajMime(Buffer.from("%PDFx", "latin1")), null);
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

// ── Lista kartotek bez zdjęcia ──────────────────────────────────────────────

test("osobna tabela zdjęć: brak to NOT EXISTS po kluczu obcym", () => {
  const { strona, razem } = budujZapytanieBezZdjecia({
    tabela: "tw_ZdjecieTw", kolumna: "zd_Zdjecie", klucz: "zd_IdTowar", zFiltrem: false,
  });
  assert.match(strona, /NOT EXISTS \(SELECT 1 FROM tw_ZdjecieTw z WITH \(NOLOCK\) WHERE z\.zd_IdTowar = t\.tw_Id\)/);
  assert.match(strona, /t\.tw_Zablokowany = 0/);
  /* Porządek domyka tw_Id: symbol nie jest unikalny, a stronicowanie bez
     pełnego porządku gubi i dubluje wiersze między stronami. */
  assert.match(strona, /ORDER BY t\.tw_Symbol, t\.tw_Id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY$/);
  assert.match(razem, /^SELECT COUNT\(\*\) AS razem FROM tw__Towar t/);
  assert.doesNotMatch(strona, /@q/);
});

test("zdjęcie w samej kartotece: brak to pusta kolumna", () => {
  const { strona } = budujZapytanieBezZdjecia({ tabela: "", kolumna: "tw_Zdjecie", klucz: "tw_Id", zFiltrem: false });
  assert.match(strona, /\(t\.tw_Zdjecie IS NULL OR DATALENGTH\(t\.tw_Zdjecie\) = 0\)/);
  assert.doesNotMatch(strona, /NOT EXISTS/);
});

test("filtr szuka po symbolu, nazwie i EAN-ie, parametrem, w obu zapytaniach", () => {
  const { strona, razem } = budujZapytanieBezZdjecia({
    tabela: "tw_ZdjecieTw", kolumna: "zd_Zdjecie", klucz: "zd_IdTowar", zFiltrem: true,
  });
  for (const z of [strona, razem]) {
    assert.match(z, /t\.tw_Symbol LIKE @q/);
    assert.match(z, /t\.tw_Nazwa LIKE @q/);
    assert.match(z, /t\.tw_PodstKodKresk LIKE @q ESCAPE '!'/);
  }
});

test("nazwa z konfiguracji nie wstrzyknie SQL do listy braków", () => {
  assert.throws(() =>
    budujZapytanieBezZdjecia({ tabela: "x; DROP TABLE y", kolumna: "k", klucz: "id", zFiltrem: false })
  );
  assert.throws(() =>
    budujZapytanieBezZdjecia({ tabela: "t", kolumna: "k", klucz: "id--", zFiltrem: false })
  );
});

test("wieloznaczniki LIKE w tekście szukania są zwykłymi znakami", () => {
  assert.equal(wzorzecLike("W43_05"), "%W43!_05%");
  assert.equal(wzorzecLike("50%"), "%50!%%");
  assert.equal(wzorzecLike("[A]"), "%![A]%");
  assert.equal(wzorzecLike("Hej!"), "%Hej!!%");
  assert.equal(wzorzecLike("a/b\\c"), "%a/b\\c%");
});
