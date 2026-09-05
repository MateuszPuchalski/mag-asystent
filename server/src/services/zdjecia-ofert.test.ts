import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Cache zdjęć ofert Allegro (0.213.0) ─────────────────────────────────────
   Stawka tego modułu jest jedna: drugie spojrzenie na tę samą ofertę NIE MA
   dojść do CDN-u. Dlatego źródło wchodzi parametrem i wszystkie testy liczą
   WYWOŁANIA, nie tylko wynik.

   Druga stawka to miniatura. Wariant rozmiarowy adresu (`/s320/`) jest
   konwencją CDN-u Allegro, a nie częścią specyfikacji — więc pobranie ma iść
   najpierw po niego i SAMO wrócić do oryginału, gdy nic z tego nie wyjdzie.
   To jest cała różnica między „korzystamy z konwencji" a „stoimy na niej".  */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zdjof-"));
process.env.DB_PATH = path.join(katalog, "t.db");
process.env.LOG_LEVEL = "silent";

const { migrate } = await import("../db/db.js");
const { adresMiniatury, pobierzZCdn, zapewnijZdjecieOferty } = await import("./zdjecia-ofert.js");
type Db = Parameters<typeof migrate>[0];

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const ORYGINAL = "https://a.allegroimg.com/original/05a2af/929c6dae4fb8721a8539582eb421";

function stanowisko(url: string | null = ORYGINAL) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  d.prepare(`INSERT INTO offer_snapshot
    (channel_account_id,external_id,nazwa,primary_image_url,synced_at)
    VALUES (1,'111','Nóż',?, '2026-09-04T10:00:00Z')`).run(url);
  return d as unknown as Db;
}

const obraz = { bajty: Buffer.from("PNG-udawany"), mime: "image/png" };

test("miniatura jest PRÓBĄ: pierwsze pytanie idzie po `/s320/`", async () => {
  const d = stanowisko();
  const pytane: string[] = [];
  await zapewnijZdjecieOferty(1, "111", d, async (u) => { pytane.push(u); return obraz; });
  assert.deepEqual(pytane, ["https://a.allegroimg.com/s320/05a2af/929c6dae4fb8721a8539582eb421"]);
});

test("gdy miniatury nie ma, TEN SAM przebieg bierze oryginał", async () => {
  const d = stanowisko();
  const pytane: string[] = [];
  const w = await zapewnijZdjecieOferty(1, "111", d, async (u) => {
    pytane.push(u);
    /* Tak wygląda nietrafiona konwencja: CDN nie oddaje obrazu. */
    return u.includes("/s320/") ? null : obraz;
  });
  assert.equal(pytane.length, 2, "próba miniatury, potem oryginał");
  assert.ok(pytane[1].includes("/original/"));
  assert.ok(w?.plik, "obraz jednak jest — konwencja nie jest warunkiem działania");
});

test("drugie spojrzenie NIE dochodzi do CDN-u", async () => {
  const d = stanowisko();
  let ile = 0;
  const zrodlo = async () => { ile++; return obraz; };
  await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  assert.equal(ile, 1);
});

test("ŚWIEŻOŚĆ IDZIE PO ADRESIE: podmienione zdjęcie w ofercie pobiera się od nowa", async () => {
  const d = stanowisko();
  let ile = 0;
  const zrodlo = async () => { ile++; return obraz; };
  await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  /* Sprzedawca podmienił zdjęcie — Allegro wydaje NOWY adres. Bez porównania
     adresu cache trzymałby stary obraz do końca świata albo trzeba by zgadywać
     TTL-em, jak przy kartotekach. */
  d.prepare("UPDATE offer_snapshot SET primary_image_url=? WHERE external_id='111'")
    .run("https://a.allegroimg.com/original/zz/nowe");
  await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  assert.equal(ile, 2);
});

test("oferta bez adresu nie pyta CDN-u wcale", async () => {
  const d = stanowisko(null);
  let ile = 0;
  const w = await zapewnijZdjecieOferty(1, "111", d, async () => { ile++; return obraz; });
  assert.equal(ile, 0);
  assert.equal(w, null, "brak adresu to nie to samo, co nieudane pobranie");
});

test("nieudane pobranie zapisuje POWÓD i nie ponawia w kółko", async () => {
  const d = stanowisko();
  let ile = 0;
  const zrodlo = async () => { ile++; throw new Error("CDN nie odpowiada"); };
  const w = await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  assert.equal(w?.plik, null);
  assert.match(String(w?.blad), /CDN nie odpowiada/);
  const przed = ile;
  await zapewnijZdjecieOferty(1, "111", d, zrodlo);
  assert.equal(ile, przed, "błąd ma przerwę — agent odświeżający ekran nie dobija CDN-u");
});

test("adres spoza allegroimg.com jest odrzucany PRZED wyjściem do sieci", async () => {
  /* Adres przyjeżdża z zewnątrz i ląduje w naszej bazie, a potem serwer sam po
     niego idzie. Bez tej bramki wystarczyłby jeden dziwny wiersz, żeby zamienić
     trasę zdjęć w czytnik cudzej sieci wewnętrznej. */
  await assert.rejects(() => pobierzZCdn("http://169.254.169.254/latest/meta-data/"),
    /spoza allegroimg\.com albo nie-https/);
  await assert.rejects(() => pobierzZCdn("https://allegroimg.com.podszywacz.example/x"),
    /spoza allegroimg\.com albo nie-https/);
  /* Sam https to za mało, a sam sufiks bez https też. */
  await assert.rejects(() => pobierzZCdn("http://a.allegroimg.com/original/aa/bb"),
    /spoza allegroimg\.com albo nie-https/);
});

test("adres miniatury powstaje tylko z adresu, który ma `/original/`", () => {
  assert.equal(adresMiniatury(ORYGINAL, 320),
    "https://a.allegroimg.com/s320/05a2af/929c6dae4fb8721a8539582eb421");
  /* Zero wyłącza konwencję — zostaje sam oryginał. */
  assert.equal(adresMiniatury(ORYGINAL, 0), null);
  /* Adres w innym kształcie niż znany: nie zgadujemy, gdzie wstawić rozmiar. */
  assert.equal(adresMiniatury("https://a.allegroimg.com/s64/aa/bb", 320), null);
});
