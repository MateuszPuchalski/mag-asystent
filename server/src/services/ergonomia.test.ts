import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── Ergonomia w liczbach ────────────────────────────────────────────────────
   Pilnuje pięciu tabel raportu i dwóch granic, których nie widać z ekranu:
   - w raporcie nie ma ani jednego nazwiska — mierzy narzędzie, nie ludzi;
   - nazwy zdarzeń poprawek nadal padają w serwisach. Zdarzenie przemianowane
     w serwisie dałoby tu po cichu zero poprawek, czyli fałszywie dobry wynik. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ergonomia-")), "t.db");

let db: typeof import("../db/db.js").db;
let E: typeof import("./ergonomia.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  E = await import("./ergonomia.js");
});

beforeEach(() => db().prepare("DELETE FROM events").run());

const TERAZ = Date.now() - 60_000;

function zdarzenie(type: string, payload: unknown, device: string | null, msTemu = 0, user = "Jan Kowalski"): void {
  db()
    .prepare("INSERT INTO events(type, payload, user_id, device_id, created_at) VALUES (?,?,?,?,?)")
    .run(type, typeof payload === "string" ? payload : JSON.stringify(payload), user, device,
      new Date(TERAZ - msTemu).toISOString());
}

test("wzór trasy i powodu zdejmuje identyfikatory i kody", () => {
  assert.equal(E.wzorTrasy("/api/delivery/12/lines/34/cofnij"), "/api/delivery/:x/lines/:x/cofnij");
  assert.equal(E.wzorTrasy("/api/products/scan/A01-02-03"), "/api/products/scan/:x");
  assert.equal(E.wzorPowodu("Nieznany kod kreskowy: 5901234567890"), "Nieznany kod kreskowy: #");
  assert.equal(E.wzorPowodu(null), "(bez komunikatu)");
});

test("kubełki czasu są te same co w kolektorze", () => {
  /* Rozjazd granic przesunąłby każdą liczbę o przedział — bez błędu, bo
     paczka ma tyle samo pól. Czytamy listę wprost ze źródła Kotlina. */
  const kt = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)),
      "../../../android/core/src/main/kotlin/pl/wertis/kolektor/core/net/CzasyZadan.kt"), "utf8");
  const m = kt.match(/val KUBELKI_MS: List<Long> = listOf\(([^)]*)\)/);
  assert.ok(m, "w CzasyZadan.kt nie ma KUBELKI_MS");
  assert.deepEqual(m![1].split(",").map((v) => Number(v.trim())), E.KUBELKI_MS);
});

test("p95 z kubełków to przedział, nie liczba udająca dokładność", () => {
  assert.equal(E.p95Kubelkow([0, 0, 0, 0, 0, 0]), null);
  assert.equal(E.p95Kubelkow([95, 0, 5, 0, 0, 0]), "≤ 100 ms");
  assert.equal(E.p95Kubelkow([90, 0, 0, 0, 0, 10]), "> 1000 ms");
});

test("czasy każdego żądania: suma paczek per trasa i kolektor, najwięcej wolnych na górze", () => {
  // kubełki: ≤100, ≤150, ≤300, ≤600, ≤1000, >1000
  zdarzenie("czasy_zadan", { czasy: [
    { ekran: "DELIVERY_LINES", trasa: "/api/delivery/:x/lines/:x/putaway", n: 10, kubelki: [4, 2, 1, 2, 1, 0] },
    { ekran: "HOME", trasa: "/api/products/scan/:x", n: 5, kubelki: [5, 0, 0, 0, 0, 0] },
  ] }, "kol-aaaa");
  zdarzenie("czasy_zadan", { czasy: [
    { ekran: "DELIVERY_LINES", trasa: "/api/delivery/:x/lines/:x/putaway", n: 10, kubelki: [0, 0, 0, 0, 0, 10] },
  ] }, "kol-bbbb");
  const c = E.ergonomia(7).czasy;
  assert.equal(c.n, 25);
  assert.equal(c.powyzejProgu, 13);
  const putaway = c.wgTrasy[0];
  assert.equal(putaway.trasa, "/api/delivery/:x/lines/:x/putaway");
  assert.equal(putaway.n, 20);
  assert.equal(putaway.powyzejProgu, 13);
  assert.equal(putaway.p95, "> 1000 ms");
  assert.equal(c.wgKolektora[0].etykieta, "#BBBB", "kolektor z samymi wolnymi odpowiedziami na górze");
  assert.equal(c.wgKolektora[0].udzialPowyzejProgu, 1);
  assert.equal(c.wgKolektora[1].udzialPowyzejProgu, 0.2);
});

test("skan na ekranie głównym: stary pomiar pod własną nazwą, per kolektor", () => {
  for (const ms of [100, 110, 120, 130, 900]) zdarzenie("scan_timing", { ms }, "kol-aaaa");
  zdarzenie("scan_timing", { ms: 80 }, "kol-bbbb");
  const s = E.ergonomia(7).skanGlowny;
  assert.equal(s.n, 6);
  assert.equal(s.wgKolektora[0].etykieta, "#AAAA");
  assert.equal(s.wgKolektora[0].p95, 900);
  assert.equal(s.wgKolektora[0].p50, 120);
});

test("powtórzony skan: ten sam kod z tego samego kolektora w 2 s", () => {
  zdarzenie("scan", { code: "590111", kind: "EAN" }, "kol-aaaa", 10_000);
  zdarzenie("scan", { code: "590111", kind: "EAN" }, "kol-aaaa", 9_000); // powtórka po 1 s
  zdarzenie("scan", { code: "590111", kind: "EAN" }, "kol-aaaa", 5_000); // po 4 s — nowa czynność
  zdarzenie("scan", { code: "590222", kind: "EAN" }, "kol-aaaa", 4_500); // inny kod
  zdarzenie("scan", { code: "590222", kind: "EAN" }, "kol-bbbb", 4_000); // inny kolektor
  zdarzenie("manual_entry", { code: "590222", kind: "EAN" }, "kol-aaaa", 4_400); // wpis, nie skan
  const p = E.ergonomia(7).powtorzoneSkany;
  const a = p.find((x) => x.device === "kol-aaaa")!;
  assert.equal(a.skanow, 4);
  assert.equal(a.powtorzonych, 1);
  assert.equal(a.udzial, 0.25);
  assert.equal(p.find((x) => x.device === "kol-bbbb")!.powtorzonych, 0);
});

test("odrzucenia: jedna trasa i jeden powód to jeden wiersz, z liczbą kolektorów", () => {
  for (const [id, kol] of [[1, "kol-a"], [2, "kol-a"], [3, "kol-b"]] as const) {
    zdarzenie("http_rejected", { metoda: "POST", sciezka: `/api/delivery/${id}/lines/9/putaway`, status: 400,
      powod: `Kod ${id}00123 nie jest etykietą regału` }, kol);
  }
  zdarzenie("http_rejected", { metoda: "GET", sciezka: "/api/kosze/5", status: 404, powod: "Brak kosza" }, "kol-a");
  const o = E.ergonomia(7).odrzucenia;
  assert.equal(o[0].trasa, "/api/delivery/:x/lines/:x/putaway");
  assert.equal(o[0].powod, "Kod # nie jest etykietą regału");
  assert.equal(o[0].ile, 3);
  assert.equal(o[0].urzadzen, 2);
  assert.equal(o[0].status, 400);
  assert.equal(o.length, 2);
});

test("przerwy w łączności: suma i najdłuższa per kolektor, najgorszy na górze", () => {
  zdarzenie("siec_przerwa", { trwanieMs: 30_000 }, "kol-a");
  zdarzenie("siec_przerwa", { trwanieMs: 90_000 }, "kol-a");
  zdarzenie("siec_przerwa", { trwanieMs: 6_000 }, "kol-b");
  const p = E.ergonomia(7).przerwy;
  assert.deepEqual(p[0], { device: "kol-a", etykieta: "#KOLA", przerw: 2, minutRazem: 2, najdluzszaMin: 1.5 });
  assert.equal(p[1].minutRazem, 0.1);
});

test("poprawki na czynność: cofnięcia i korekty względem wykonanej pracy", () => {
  for (let i = 0; i < 8; i++) zdarzenie("putaway_line_done", {}, "kol-a");
  zdarzenie("putaway_cofniete", {}, "kol-a");
  zdarzenie("putaway_qty_fixed", {}, "kol-a");
  zdarzenie("kosz_putaway", {}, "kol-a");
  const p = E.ergonomia(7).poprawki;
  const dostawy = p.find((c) => c.czynnosc === "Rozkładanie dostaw")!;
  assert.equal(dostawy.wykonane, 8);
  assert.equal(dostawy.poprawek, 2);
  assert.equal(dostawy.udzial, 0.25);
  assert.equal(dostawy.rozbicie.putaway_cofniete, 1);
  assert.equal(p.find((c) => c.czynnosc === "Rozkładanie zwrotów (kosze)")!.udzial, 0);
  assert.equal(p.find((c) => c.czynnosc === "Kartony")!.udzial, null, "zero pracy to „nie wiem”, nie 0%");
});

test("ucięty payload i obca paczka nie kładą raportu", () => {
  zdarzenie("scan_timing", "{ucięty", "kol-a");
  zdarzenie("http_rejected", "{ucięty", "kol-a");
  zdarzenie("czasy_zadan", "{ucięty", "kol-a");
  zdarzenie("czasy_zadan", { czasy: [{ ekran: "HOME", trasa: "/api/x", kubelki: [1, 2] }, "śmieć", null] }, "kol-a");
  zdarzenie("scan_timing", { ms: 120 }, "kol-a");
  const r = E.ergonomia(7);
  assert.equal(r.skanGlowny.n, 1);
  assert.equal(r.odrzucenia[0].trasa, "?");
  assert.equal(r.czasy.n, 0, "kubełki o złym kształcie się pomija, nie zgaduje");
});

test("w raporcie nie ma nazwisk — mierzy narzędzie, nie ludzi", () => {
  zdarzenie("scan_timing", { ms: 100 }, "kol-a", 0, "Anna Nowak");
  zdarzenie("czasy_zadan", { czasy: [{ ekran: "HOME", trasa: "/api/x", n: 1, kubelki: [1, 0, 0, 0, 0, 0] }] },
    "kol-a", 0, "Anna Nowak");
  zdarzenie("putaway_line_done", {}, "kol-a", 0, "Anna Nowak");
  zdarzenie("http_rejected", { sciezka: "/api/x", status: 400, powod: "zły kod" }, "kol-a", 0, "Anna Nowak");
  assert.doesNotMatch(JSON.stringify(E.ergonomia(7)), /Anna|Nowak/);
});

test("każde zdarzenie czynności nadal pada gdzieś w serwisach", () => {
  const katalog = path.dirname(fileURLToPath(import.meta.url));
  const zrodla = fs.readdirSync(katalog)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "ergonomia.ts")
    .map((f) => fs.readFileSync(path.join(katalog, f), "utf8"))
    .join("\n");
  for (const c of E.CZYNNOSCI) {
    for (const typ of [...c.wykonane, ...c.poprawki]) {
      assert.ok(zrodla.includes(`"${typ}"`), `zdarzenie ${typ} (${c.czynnosc}) nie pada w żadnym serwisie`);
    }
  }
});
