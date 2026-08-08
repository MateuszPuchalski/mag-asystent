import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Cache zdjęć kartotek ────────────────────────────────────────────────────
   Ten serwis stoi między kolektorem a bazą firmy i jego jedynym zadaniem jest
   sprawić, żeby blob NIE jechał stamtąd drugi raz. Prawie każdy test niżej
   mierzy dokładnie to: ile razy źródło zostało zapytane i kiedy.

   Źródło wchodzi PARAMETREM (tak jak adapter Sfery w worker/kolejka.ts), więc
   atrapa liczy wywołania. Bez tego licznika „nie zapytał ponownie" byłoby nie
   do odróżnienia od „zapytał i dostał to samo".                               */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdj-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.ZDJECIA_ZRODLO = "plik";
process.env.ZDJECIA_KATALOG = path.join(katalog, "zrodlo");
process.env.ZDJECIA_MAX_KB = "64";
process.env.ZDJECIA_TTL_H = "168";
process.env.ZDJECIA_BLAD_TTL_MIN = "5";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zdjecia.js");

/** Same nagłówki — `rozpoznajMime` czyta pierwsze bajty, reszta jest nieistotna. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zdjecia.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM zdjecie_cache").run();
  db()
    .prepare(
      `INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja)
       VALUES (1,'W32-0203','Kosa','590',''),(2,'50-111','Wal','591','')`
    )
    .run();
  for (const f of fs.readdirSync(Z.katalogZdjec())) {
    fs.unlinkSync(path.join(Z.katalogZdjec(), f));
  }
});

/** Atrapa źródła z licznikiem — liczba wywołań JEST tu przedmiotem testu. */
function zrodlo(wynik: Buffer | null | Error, mime = "image/jpeg") {
  let wywolan = 0;
  const fn: import("./zdjecia.js").Zrodlo = async () => {
    wywolan++;
    if (wynik instanceof Error) throw wynik;
    return wynik ? { bajty: wynik, mime } : null;
  };
  return { fn, ile: () => wywolan };
}

/** Postarza wpis, żeby minął TTL bez czekania. */
const postarz = (twId: number, godzin: number) =>
  db()
    .prepare("UPDATE zdjecie_cache SET pobrano_at = ? WHERE tw_id = ?")
    .run(new Date(Date.now() - godzin * 3600_000).toISOString(), twId);

// ── Sedno: drugi odczyt nie rusza źródła ────────────────────────────────────

test("drugi odczyt tego samego towaru NIE pyta źródła", async () => {
  const z = zrodlo(JPEG);
  await Z.zapewnijZdjecie(1, z.fn);
  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 1, "cache istnieje po to, żeby drugie pytanie nie doszło do bazy firmy");
});

test("potwierdzony brak zdjęcia też jest cache'owany", async () => {
  const z = zrodlo(null);
  const a = await Z.zapewnijZdjecie(1, z.fn);
  const b = await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 1, "kartotek bez zdjęcia są setki — każda pytałaby przy każdym otwarciu karty");
  assert.equal(a?.plik, null);
  assert.equal(b?.blad, null, "brak zdjęcia to nie jest błąd");
});

test("po TTL zdjęcie jest rewalidowane", async () => {
  const z = zrodlo(JPEG);
  await Z.zapewnijZdjecie(1, z.fn);
  postarz(1, 200); // TTL to 168 h
  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 2);
});

/* ── Brak zdjęcia starzeje się SZYBCIEJ niż zdjęcie ──────────────────────────
   To jest cała poprawka po zgłoszeniu z magazynu. Kolektor pamięta własny
   „brak" przez dobę i obiecuje, że zdjęcie dodane dziś w Subiekcie pokaże
   najdalej jutro. Gdy serwer trzymał swój brak tak długo jak zdjęcia — tydzień —
   kolektor po dobie pytał, dostawał 404 ze starego wpisu i uzbrajał negatyw na
   kolejną dobę. Obietnica była pusta, a zdjęcie pojawiało się po tygodniu.    */

test("brak zdjęcia jest sprawdzany ponownie przed upływem doby", async () => {
  const z = zrodlo(null);
  await Z.zapewnijZdjecie(1, z.fn);
  postarz(1, 13); // BRAK_TTL to 12 h, doba jeszcze nie minęła
  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 2, "kolektor pyta po dobie i musi wtedy dostać świeżą odpowiedź");
});

test("zdjęcie, które JEST, nie jest ponawiane w tym samym oknie", async () => {
  const z = zrodlo(JPEG);
  await Z.zapewnijZdjecie(1, z.fn);
  postarz(1, 13); // ten sam wiek, inny stan wpisu
  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 1, "krótszy próg dotyczy WYŁĄCZNIE braku — obraz zmienia się rzadko");
});

test("zapomnijBrakiZdjec kasuje braki i błędy, zostawia zdjęcia", async () => {
  await Z.zapewnijZdjecie(1, zrodlo(JPEG).fn); // ma plik
  await Z.zapewnijZdjecie(2, zrodlo(null).fn); // potwierdzony brak

  assert.equal(Z.zapomnijBrakiZdjec(), 1, "kasujemy wyłącznie wpisy bez pliku");

  const z = zrodlo(JPEG);
  await Z.zapewnijZdjecie(2, z.fn);
  assert.equal(z.ile(), 1, "po skasowaniu braku następne wejście na kartę pyta źródło");

  const dalej = zrodlo(JPEG);
  await Z.zapewnijZdjecie(1, dalej.fn);
  assert.equal(dalej.ile(), 0, "zdjęcia w cache'u zostają — inaczej wszystkie kolektory pobrałyby je od nowa");
});

// ── Błąd źródła to nie brak zdjęcia ─────────────────────────────────────────

test("błąd źródła NIE zapisuje trwałego negatywu — ponawia po przerwie", async () => {
  const z = zrodlo(new Error("brak GRANT SELECT"));
  const w = await Z.zapewnijZdjecie(1, z.fn);
  assert.match(w?.blad ?? "", /GRANT/);

  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 1, "w oknie ZDJECIA_BLAD_TTL_MIN nie dobijamy się do padniętego źródła");

  postarz(1, 1); // godzina to więcej niż 5 minut przerwy
  await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 2, "awaria sieci nie może udawać kartoteki bez zdjęcia na zawsze");
});

test("po błędzie źródła zostaje STARY plik, jeśli był", async () => {
  const ok = zrodlo(JPEG);
  const w = await Z.zapewnijZdjecie(1, ok.fn);
  const plikPrzed = w?.plik;
  assert.ok(plikPrzed);

  postarz(1, 400);
  const pada = zrodlo(new Error("padło"));
  const po = await Z.zapewnijZdjecie(1, pada.fn);
  assert.equal(po?.plik, plikPrzed, "nieaktualne zdjęcie śruby jest nieszkodliwe, brak zdjęcia nie");
});

// ── ETag ────────────────────────────────────────────────────────────────────

test("ta sama treść daje ten sam ETag, inna — inny", async () => {
  const a = await Z.zapewnijZdjecie(1, zrodlo(JPEG).fn);
  const b = await Z.zapewnijZdjecie(2, zrodlo(JPEG).fn);
  assert.equal(a?.etag, b?.etag, "ETag z treści — po to, żeby rewalidacja kończyła się na 304");

  db().prepare("DELETE FROM zdjecie_cache WHERE tw_id = 2").run();
  const c = await Z.zapewnijZdjecie(2, zrodlo(PNG, "image/png").fn);
  assert.notEqual(a?.etag, c?.etag);
});

// ── Granice ─────────────────────────────────────────────────────────────────

test("zdjęcie ponad ZDJECIA_MAX_KB nie trafia do cache'u i zostawia zdanie", async () => {
  const wielkie = Buffer.concat([JPEG, Buffer.alloc(100 * 1024)]);
  const w = await Z.zapewnijZdjecie(1, zrodlo(wielkie).fn);
  assert.equal(w?.plik, null, "serwer nie umie zmniejszać obrazów — jedyną obroną jest odmowa");
  assert.match(w?.blad ?? "", /limit ZDJECIA_MAX_KB/);
});

test("plik skasowany spod cache'u → pobranie ponowne, nie 404", async () => {
  const z = zrodlo(JPEG);
  const w = await Z.zapewnijZdjecie(1, z.fn);
  fs.unlinkSync(path.join(Z.katalogZdjec(), w!.plik!));

  const po = await Z.zapewnijZdjecie(1, z.fn);
  assert.equal(z.ile(), 2, "cache wyczyszczony ręką nie ma prawa zabić funkcji");
  assert.ok(po?.plik && Z.sciezkaZdjecia(po.plik));
});

test("eviction wyrzuca najdawniej UŻYTE, nie najdawniej pobrane", async () => {
  await Z.zapewnijZdjecie(1, zrodlo(JPEG).fn);
  await Z.zapewnijZdjecie(2, zrodlo(JPEG).fn);

  /* Po 600 kB przy limicie 1 MB: nadmiar zdejmuje JEDEN wpis, więc widać
     KTÓRY. Przy wpisach po 900 kB wypadłyby oba (żaden nie mieści się
     w 80% limitu) i test nie mierzyłby już kolejności, tylko arytmetykę. */
  const d = db();
  d.prepare("UPDATE zdjecie_cache SET uzyto_at = ?, bajtow = 600000 WHERE tw_id = 1").run(new Date().toISOString());
  d.prepare("UPDATE zdjecie_cache SET uzyto_at = ?, bajtow = 600000 WHERE tw_id = 2").run(
    new Date(Date.now() - 86400_000).toISOString()
  );

  const { config } = await import("../config.js");
  const bylo = config.zdjecia.cacheMb;
  (config.zdjecia as { cacheMb: number }).cacheMb = 1; // 1 MB przy 1,2 MB w cache
  try {
    Z.przytnijCache();
  } finally {
    (config.zdjecia as { cacheMb: number }).cacheMb = bylo;
  }

  const zostaly = (d.prepare("SELECT tw_id FROM zdjecie_cache ORDER BY tw_id").all() as Array<{ tw_id: number }>).map(
    (r) => r.tw_id
  );
  assert.deepEqual(zostaly, [1], "wypaść ma to, czego nikt nie ogląda");
});

// ── Reszta ──────────────────────────────────────────────────────────────────

test("statystyki rozróżniają cache, brak zdjęcia i błąd", async () => {
  await Z.zapewnijZdjecie(1, zrodlo(JPEG).fn);
  await Z.zapewnijZdjecie(2, zrodlo(null).fn);

  const s = Z.statystykiZdjec();
  assert.equal(s.wCache, 1);
  assert.equal(s.bezZdjecia, 1);
  assert.equal(s.wBledzie, 0);
});

test("nieznany towar nie zakłada wpisu ani nie pyta źródła", async () => {
  const z = zrodlo(JPEG);
  assert.equal(await Z.zapewnijZdjecie(999, z.fn), null);
  assert.equal(z.ile(), 0);
});

test("nazwa pliku z bazy nie wyprowadza odczytu poza katalog", () => {
  assert.equal(Z.sciezkaZdjecia("../../../etc/passwd"), null);
});
