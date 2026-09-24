import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EnvFileResult } from "../env-file.js";
import { parseEnvFile } from "../env-file.js";
import {
  BladZmiany, bladWartosci, doPliku, konfiguracjaZmienionaPo, scalPlik, sprawdzKandydata, zmienKlucz,
} from "./konfiguracja-zapis.js";
import { podNssm } from "./restart.js";

/* Zapis `wertis.env` z panelu (0.491.0). Najważniejsza gwarancja: plik,
   z którym serwer by nie wstał, NIE trafia na dysk. Reszta to rzemiosło
   tekstu, które ma zostawić plik instalatora w stanie czytelnym dla obu
   parserów — serwera i `source` w bashu. */

const PLIK = [
  "# WERTIS — ustawienia",
  "export SGT_MODE=seeded",
  "export ZWROT_TERMIN_DNI=7   # regulamin Allegro",
  "",
  "# ręczny wpis",
  "export COPILOT_MODEL=claude-opus-5",
].join("\n");

test("scalPlik zmienia jedną linię i zostawia komentarze", () => {
  const n = scalPlik(PLIK, "ZWROT_TERMIN_DNI", "9");
  assert.equal(n, PLIK.replace("export ZWROT_TERMIN_DNI=7   # regulamin Allegro", "export ZWROT_TERMIN_DNI=9"));
  assert.equal(parseEnvFile(n).ZWROT_TERMIN_DNI, "9");
  assert.equal(parseEnvFile(n).COPILOT_MODEL, "claude-opus-5");
});

test("scalPlik dopisuje nowy klucz na końcu i usuwa go przy null", () => {
  const z = scalPlik(PLIK, "WIEDZA_AUTOMAT", "1");
  assert.equal(parseEnvFile(z).WIEDZA_AUTOMAT, "1");
  assert.ok(z.endsWith("export WIEDZA_AUTOMAT=1\n"), z);
  const bez = scalPlik(z, "WIEDZA_AUTOMAT", null);
  assert.equal(parseEnvFile(bez).WIEDZA_AUTOMAT, undefined);
});

test("scalPlik zostawia jedną linię przy duplikacie i trzyma CRLF", () => {
  const crlf = "export A=1\r\nexport ZWROT_TERMIN_DNI=7\r\nZWROT_TERMIN_DNI=8\r\n";
  const n = scalPlik(crlf, "ZWROT_TERMIN_DNI", "9");
  assert.equal(n, "export A=1\r\nexport ZWROT_TERMIN_DNI=9\r\n");
});

test("doPliku cytuje wszystko, co bash by przetłumaczył", () => {
  assert.equal(doPliku("claude-opus-5"), "claude-opus-5");
  assert.equal(doPliku("2026-08-31T22:00:00Z"), "2026-08-31T22:00:00Z");
  assert.equal(doPliku("https://a.pl/x?a=1&b=2"), "'https://a.pl/x?a=1&b=2'");
  assert.equal(doPliku("ha$lo#1"), "'ha$lo#1'");
  assert.equal(doPliku("D:\\kopie wertis"), "'D:\\kopie wertis'");
  assert.equal(doPliku("it's"), "\"it's\"");
  for (const v of ["https://a.pl/x?a=1&b=2", "ha$lo#1", "D:\\kopie wertis", "it's", ""]) {
    assert.equal(parseEnvFile(`export K=${doPliku(v)}`).K, v, v);
  }
});

test("bladWartosci pilnuje rodzaju", () => {
  const liczba = { rodzaj: "liczba" } as const;
  const data = { rodzaj: "data" } as const;
  const wybor = { rodzaj: "wybor", opcje: ["0", "1"] } as const;
  assert.equal(bladWartosci("K", liczba, "7"), null);
  assert.ok(bladWartosci("K", liczba, "siedem"));
  assert.equal(bladWartosci("K", data, "2026-08-31T22:00:00Z"), null);
  assert.equal(bladWartosci("K", data, ""), null, "pusta data to „bez progu”");
  assert.ok(bladWartosci("K", data, "31.08.2026"));
  assert.equal(bladWartosci("K", wybor, "1"), null);
  assert.ok(bladWartosci("K", wybor, "tak"));
  assert.ok(bladWartosci("K", { rodzaj: "tekst" }, "a\nexport SGT_MODE=seeded"), "nowa linia wstrzyknęłaby klucz");
  assert.ok(bladWartosci("K", { rodzaj: "tekst" }, 'a"b'));
});

function instalacja(tresc = PLIK): { env: EnvFileResult; plik: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zapis-"));
  const plik = path.join(dir, "wertis.env");
  fs.writeFileSync(plik, tresc);
  const klucze = Object.keys(parseEnvFile(tresc));
  return { plik, env: { path: plik, applied: klucze, overridden: [], overriddenValues: {} } };
}

test("zmienKlucz zapisuje, zostawia poprzednią wersję i sprząta kandydata", async () => {
  const { env, plik } = instalacja();
  const w = await zmienKlucz(env, "ZWROT_TERMIN_DNI", "9", async () => null);
  assert.equal(w.na, "9");
  assert.equal(parseEnvFile(fs.readFileSync(plik, "utf8")).ZWROT_TERMIN_DNI, "9");
  assert.equal(fs.readFileSync(`${plik}.poprzedni`, "utf8"), PLIK);
  assert.ok(!fs.existsSync(`${plik}.kandydat`));
});

test("odmowa próby startu nie rusza pliku", async () => {
  const { env, plik } = instalacja();
  await assert.rejects(() => zmienKlucz(env, "ZWROT_TERMIN_DNI", "9", async () => "coś nie tak"),
    (e: unknown) => e instanceof BladZmiany && e.message.includes("nie wstałby"));
  assert.equal(fs.readFileSync(plik, "utf8"), PLIK);
  assert.ok(!fs.existsSync(`${plik}.kandydat`));
  assert.ok(!fs.existsSync(`${plik}.poprzedni`));
});

test("zmienKlucz odmawia kluczy spoza panelu, przykrytych i bez pliku", async () => {
  const { env } = instalacja();
  await assert.rejects(() => zmienKlucz(env, "MSSQL_SERVER", "x", async () => null), /nie zmienia się z panelu/);
  await assert.rejects(() => zmienKlucz(env, "MAG_ID_ODP", "4", async () => null), /nie zmienia się z panelu/);
  await assert.rejects(() => zmienKlucz({ ...env, overridden: ["ZWROT_TERMIN_DNI"] }, "ZWROT_TERMIN_DNI", "9",
    async () => null), /przykryty/);
  await assert.rejects(() => zmienKlucz({ ...env, path: null }, "ZWROT_TERMIN_DNI", "9", async () => null),
    /nie ma pliku/);
  await assert.rejects(() => zmienKlucz(env, "ZWROT_TERMIN_DNI", "dużo", async () => null), /liczbę/);
});

test("dwie zmiany naraz: druga dostaje 409, pierwsza się zapisuje", async () => {
  const { env, plik } = instalacja();
  let pusc!: () => void;
  const czeka = new Promise<void>((r) => { pusc = r; });
  const pierwsza = zmienKlucz(env, "ZWROT_TERMIN_DNI", "9", async () => { await czeka; return null; });
  await assert.rejects(() => zmienKlucz(env, "ZWROT_WYGASA_DNI", "40", async () => null),
    (e: unknown) => e instanceof BladZmiany && e.kod === 409);
  pusc();
  await pierwsza;
  assert.equal(parseEnvFile(fs.readFileSync(plik, "utf8")).ZWROT_TERMIN_DNI, "9");
  /* Po zakończeniu pierwszej druga przechodzi — blokada nie zostaje. */
  await zmienKlucz(env, "ZWROT_WYGASA_DNI", "40", async () => null);
});

test("sekret nie trafia do wyniku, który idzie do dziennika", async () => {
  const { env } = instalacja();
  const w = await zmienKlucz(env, "ANTHROPIC_API_KEY", "sk-tajny-klucz", async () => null);
  assert.equal(w.na, "ustawione");
  assert.ok(!JSON.stringify(w).includes("sk-tajny"));
});

test("próba startu na prawdziwym config.ts: reguła krzyżowa odmawia", async () => {
  /* Klucz Allegro bez sekretu — `bledyKonfiguracji` zatrzymuje start. Tę
     regułę zna wyłącznie serwer; walidacja rodzaju jej nie widzi. */
  const { env, plik } = instalacja("export SGT_MODE=seeded\nexport ALLEGRO_CLIENT_ID=abc\n");
  const odmowa = await sprawdzKandydata(plik, env);
  assert.ok(odmowa?.includes("ALLEGRO_CLIENT_SECRET"), String(odmowa));
  const dobry = instalacja("export SGT_MODE=seeded\nexport ZWROT_TERMIN_DNI=9\n");
  assert.equal(await sprawdzKandydata(dobry.plik, dobry.env), null);
});

test("restart sam tylko pod NSSM: Windows, bez sesji człowieka i bez npm", () => {
  assert.equal(podNssm({}, "win32"), true);
  assert.equal(podNssm({ SESSIONNAME: "Console" }, "win32"), false);
  assert.equal(podNssm({ npm_lifecycle_event: "start" }, "win32"), false);
  assert.equal(podNssm({}, "linux"), false);
});

test("worker widzi zmianę konfiguracji młodszą niż jego start", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE events (type TEXT, created_at TEXT)");
  assert.equal(konfiguracjaZmienionaPo("2026-09-24T10:00:00.000Z", d), false);
  d.prepare("INSERT INTO events VALUES ('konfiguracja_zmieniona', '2026-09-24T09:00:00.000Z')").run();
  assert.equal(konfiguracjaZmienionaPo("2026-09-24T10:00:00.000Z", d), false, "starsza niż start");
  d.prepare("INSERT INTO events VALUES ('konfiguracja_zmieniona', '2026-09-24T10:05:00.000Z')").run();
  assert.equal(konfiguracjaZmienionaPo("2026-09-24T10:00:00.000Z", d), true);
});
