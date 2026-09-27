import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dosylka-")), "t.db");
process.env.SGT_MODE = "seeded";

/* ── Dosyłka ze śledzeniem (0.536.0, drugi przyrost S6) ─────────────────────
   Pilnujemy projektu punkt po punkcie:
   - odmowa z kodem dosyłki zakłada, wznawia albo przestawia sprawę TĄ SAMĄ
     drogą co „Ustaw krok”, nie potwierdza „nowego” i jest idempotentna;
   - odmowa przejmuje dosyłkę, która należy do zwrotu, a zastępuje starszą;
   - wznowienie zakończonej sprawy odkłada jej dosyłki do historii;
   - zapisy z profilu sprawdzają wersję i odcisk, a potwierdzają odcisk PO zapisie;
   - numer wpisany ręką: przycięty, do 64 znaków, zamówienie tego klienta,
     ten sam numer drugi raz to nic;
   - wykrycie numeru woli nie zgadnąć niż zgadnąć źle;
   - ticker: tylko sprawy w toku, okno trzydziestu dni, compare-and-set ze
     strażą sprawy, COALESCE, 429 wyżej, reszta błędów zabiera jedną dosyłkę,
     wersji nie podnosi;
   - doręczenie i kłopot budzą sprawę licznikami PRZEJŚĆ, a zapamiętany
     odcisk bez klucza nie;
   - „Moje” stawia na dziś dosyłkę bez numeru i z kłopotem;
   - dziennik nie niesie numeru przesyłki, loginu ani kroku. */

let db: typeof import("../db/db.js").db;
let D: typeof import("./dosylka.js");
let P: typeof import("./prowadzenie-klienta.js");
let ZP: typeof import("./zwrot-pieniedzy.js");
let PK: typeof import("./profil-klienta.js");
let PZ: typeof import("./przesylka-zamowienia.js");
let BladLimitu: typeof import("../adapters/allegro.js").BladLimituAllegro;
let BladOdpowiedzi: typeof import("../adapters/allegro.js").BladOdpowiedziAllegro;
let konto = 0;
let ala = { id: 0, name: "A. Lewandowska" };
let bob = { id: 0, name: "B. Nowak" };
let licznik = 0;

/* 28.09.2026 to poniedziałek, 10:00 w magazynie. */
const TERAZ = new Date("2026-09-28T08:00:00Z");
const za = (godzin: number, od = TERAZ) => new Date(od.getTime() + godzin * 3_600_000);
const iso = (godzin: number, od = TERAZ) => za(godzin, od).toISOString();
const API = "https://api.test";

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./dosylka.js");
  P = await import("./prowadzenie-klienta.js");
  ZP = await import("./zwrot-pieniedzy.js");
  PK = await import("./profil-klienta.js");
  PZ = await import("./przesylka-zamowienia.js");
  ({ BladLimituAllegro: BladLimitu, BladOdpowiedziAllegro: BladOdpowiedzi } = await import("../adapters/allegro.js"));
});

beforeEach(() => {
  const d = db();
  /* `klient_prowadzenie` pierwszy: kaskadą zabiera `klient_dosylka`, a przed
     `app_user` musi odejść, bo prowadzący to klucz obcy bez kaskady. */
  for (const t of ["klient_prowadzenie", "reklamacja_wiadomosc", "reklamacja_klienta", "zwrot_zdarzenie",
    "zwrot_klienta", "allegro_zwrot", "zamowienie_klienta_pozycja", "zamowienie_klienta", "message",
    "conversation", "allegro_inbox_thread", "channel_account", "events", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  konto = Number(d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s')")
    .run().lastInsertRowid);
  ala = { id: Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('ala','A. Lewandowska','biuro')")
    .run().lastInsertRowid), name: "A. Lewandowska" };
  bob = { id: Number(d.prepare("INSERT INTO app_user(login,name,role) VALUES ('bob','B. Nowak','biuro')")
    .run().lastInsertRowid), name: "B. Nowak" };
});

function zamowienie(id: string, login: string, przewoznik: string | null = "DPD"): number {
  return Number(db().prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,kupujacy_login,
      kupiono_at,suma_grosze,waluta,przesylka_przewoznik,synced_at)
    VALUES (?,?,'READY_FOR_PROCESSING',?,?,5000,'PLN',?,'x')`)
    .run(konto, id, login, iso(-24 * 20), przewoznik).lastInsertRowid);
}

type Paczka = { waybill?: string; transportingWaybill?: string | null; carrierId?: string };

/** Zwrot z lądowiskiem: odmowa z kodem, chwila zgłoszenia według Allegro i paczki. */
function zwrot(login: string, n: {
  zamowienie?: string | null; kod?: string | null; rejection?: string | null; zgloszono?: string | null;
  paczki?: Paczka[]; odmowaAt?: string; odrzucono?: string;
} = {}): number {
  const ext = `zw-${++licznik}`;
  const zgloszono = n.zgloszono === undefined ? iso(-24 * 4) : n.zgloszono;
  const zamowienieId = n.zamowienie === undefined ? "z-1" : n.zamowienie;
  db().prepare("INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at) VALUES (?,?,?,'x')").run(ext,
    zgloszono ?? iso(0), JSON.stringify({ id: ext, orderId: zamowienieId, parcels: n.paczki ?? [],
      ...(zgloszono ? { createdAt: zgloszono } : {}),
      ...(n.rejection ? { rejection: { code: n.rejection, createdAt: n.odrzucono ?? iso(-24) } } : {}) }));
  const kod = n.kod === undefined ? "NEW_ITEM_SENT" : n.kod;
  return Number(db().prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,order_id,
      kupujacy_login,created_at,odmowa_kod,odmowa_at,rejection_code,waybill,zrodlo,synced_at)
    VALUES (?,?,'ZW',?,?,?,?,?,?,?,'allegro','x')`)
    .run(konto, ext, zamowienieId, login, zgloszono ?? iso(0), kod, kod ? n.odmowaAt ?? iso(-1) : null,
      n.rejection ?? null, n.paczki?.[0]?.waybill ?? null).lastInsertRowid);
}

const zmiany = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const wpisy = (wzor = "klient_%") => db().prepare(`SELECT type, payload FROM events WHERE type LIKE ? ORDER BY id`)
  .all(wzor) as Array<{ type: string; payload: string }>;
const wiersz = (zamowienieId = "z-1") => db().prepare("SELECT * FROM klient_dosylka WHERE zamowienie = ?")
  .get(zamowienieId) as Record<string, unknown> | undefined;
const sprawa = (login = "kl", teraz = TERAZ) => P.sprawaKlienta(login, teraz, db())!;

/** Ruch człowieka potwierdzający wszystko, co widać — krok od nowa z bieżącym odciskiem. */
function potwierdz(login: string, teraz: Date) {
  const s = sprawa(login, teraz);
  return P.ustawKrok(login, { krok: s.krok, krokDo: iso(72, teraz), wersja: s.wersja, odcisk: s.odcisk }, ala, teraz, db());
}

/**
 * Fakt z trackingu wpisany wprost — obudzenie testujemy bez sieci. Licznik
 * przejścia rośnie tak jak w tickerze: raz, przy pierwszym doręczeniu.
 */
function doreczona(zamowienieId: string, at: string) {
  db().prepare(`UPDATE klient_dosylka SET waybill = COALESCE(waybill, 'W-' || zamowienie),
    przewoznik = COALESCE(przewoznik, 'DPD'), status = 'DELIVERED', doreczen = doreczen + (dostarczono_at IS NULL), dostarczono_at = COALESCE(dostarczono_at, ?),
    sprawdzono_at = ? WHERE zamowienie = ?`).run(at, at, zamowienieId);
}

/** Status przewoźnika wpisany wprost; wejście w kłopot z innego stanu podbija licznik jak ticker. */
function status(zamowienieId: string, kod: string, at: string) {
  db().prepare(`UPDATE klient_dosylka SET problemow = problemow + (?1 IN ('ISSUE','RETURNED') AND status IS NOT ?1),
    status = ?1, sprawdzono_at = ?2 WHERE zamowienie = ?3`).run(kod, at, zamowienieId);
}

/** Atrapa Allegro: przesyłki zamówień i historia trackingu po numerze. Liczy każde żądanie. */
function allegro(o: {
  przesylki?: Record<string, Array<{ waybill: string; carrierId: string; createdAt?: string }>>;
  statusy?: Record<string, Array<{ code: string; occurredAt: string }>>;
  blad?: (url: string) => unknown;
  przy?: (url: string) => void;
} = {}) {
  const wolane: string[] = [];
  const query = async (url: string): Promise<unknown> => {
    wolane.push(url);
    const b = o.blad?.(url);
    if (b) throw b;
    o.przy?.(url);
    const m = url.match(/checkout-forms\/([^/]+)\/shipments$/);
    if (m) return { shipments: o.przesylki?.[decodeURIComponent(m[1])] ?? [] };
    const numery = new URL(url).searchParams.getAll("waybill");
    return { waybills: numery.map((waybill) => ({ waybill,
      trackingDetails: o.statusy?.[waybill] ? { statuses: o.statusy[waybill] } : null })) };
  };
  return { deps: (teraz = TERAZ) => ({ query, apiUrl: API, teraz: () => teraz }), wolane };
}

/* ── Założenie przy odmowie ─────────────────────────────────────────────── */

test("odmowa zakłada sprawę: krok „dosłać” na trzy dni robocze, prowadzi autor, dziennik bez loginu", () => {
  zamowienie("z-1", "Kowalski_Jan");
  const zw = zwrot("Kowalski_Jan");
  const w = D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  /* Poniedziałek 10:00 → czwartek 8:00 w magazynie. */
  assert.deepEqual(w, { zalozona: true, login: "Kowalski_Jan", krok: "Dosłać nowy towar (etykieta w Sellasist)",
    krokDo: "2026-10-01T06:00:00.000Z", zastapil: null });

  const s = sprawa("kowalski_jan");
  assert.deepEqual([s.stan, s.krok, s.krokDo, s.prowadziId, s.wersja],
    ["w_toku", "Dosłać nowy towar (etykieta w Sellasist)", "2026-10-01T06:00:00.000Z", ala.id, 1]);
  assert.deepEqual(s.nowe, [], "nowa sprawa zapamiętuje odcisk z chwili odmowy");
  assert.equal(s.dosylki.length, 1);
  assert.deepEqual({ ...s.dosylki[0] }, {
    zamowienie: "z-1", zwrotId: zw, waybill: null, przewoznik: null, przewoznikZamowienia: "DPD", zrodlo: null,
    status: null,
    dostarczonoAt: null, sprawdzonoAt: null, zalozonoAt: TERAZ.toISOString(), bezNumeru: false,
    opis: "Czekamy na numer dosyłki z Allegro", ton: null,
  });
  assert.equal(wiersz()!.zwrot_id, zw);
  assert.equal(wiersz()!.konto, konto, "konto wynika ze zwrotu, nie z żądania");

  const [krok, zalozona] = wpisy();
  assert.equal(krok.type, "klient_sprawa_krok");
  assert.deepEqual(JSON.parse(krok.payload),
    { sprawa: s.id, znakow: 40, termin: "2026-10-01T06:00:00.000Z", nowa: true, domyslny: true });
  assert.deepEqual([zalozona.type, JSON.parse(zalozona.payload)], ["klient_dosylka_zalozona", { sprawa: s.id, zrodlo: "odmowa" }]);
  for (const e of wpisy()) assert.doesNotMatch(e.payload.toLowerCase(), /kowalski|dosłać|sellasist/);
});

test("sprawa w toku: krok zastąpiony, `zastapil` niesie stary, „nowe” zostaje niepotwierdzone", () => {
  zamowienie("z-1", "kl");
  P.ustawKrok("kl", { krok: "czekamy na zwrot", krokDo: iso(24 * 5), wersja: 0, odcisk: "" }, bob, za(-24 * 6), db());
  const zw = zwrot("kl", { kod: "MISSING_PART_SENT" });
  const przed = sprawa();
  assert.deepEqual(przed.nowe.map((n) => n.rodzaj), ["zwrot_nowy"], "zwrot przyszedł po ruchu człowieka");
  const zmienionoAt = (db().prepare("SELECT zmieniono_at FROM klient_prowadzenie").get() as { zmieniono_at: string })
    .zmieniono_at;

  const w = D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  assert.equal(w.zalozona && w.zastapil, "czekamy na zwrot");
  const s = sprawa();
  assert.equal(s.krok, "Dosłać brakującą część (etykieta w Sellasist)");
  assert.equal(s.wersja, przed.wersja + 1, "odmowa podnosi wersję — ekran sprawy sprzed niej dostanie 409");
  assert.equal(s.prowadziId, bob.id, "prowadzący zostaje");
  assert.deepEqual(s.nowe, przed.nowe, "agent na ekranie zwrotu nie widział profilu — nic nie potwierdzone");
  assert.equal((db().prepare("SELECT zmieniono_at FROM klient_prowadzenie").get() as { zmieniono_at: string })
    .zmieniono_at, zmienionoAt, "chwila ruchu też zostaje — to granica wiadomości klienta");

  /* Ten sam krok drugi raz to nie zastąpienie. */
  const zw2 = zwrot("kl", { kod: "MISSING_PART_SENT", zamowienie: "z-2" });
  zamowienie("z-2", "kl");
  const w2 = D.zalozDosylkeZOdmowy(db(), zw2, ala, TERAZ);
  assert.equal(w2.zalozona && w2.zastapil, null);
  assert.equal(sprawa().dosylki.length, 2);
});

test("zakończona sprawa: odmowa ją wznawia, niczego nie zastępując", () => {
  zamowienie("z-1", "kl");
  const s0 = P.ustawKrok("kl", { krok: "odpisać", krokDo: iso(24), wersja: 0, odcisk: "" }, ala, za(-48), db());
  P.zakonczSprawe("kl", { wersja: s0.wersja, odcisk: s0.odcisk }, ala, za(-47), db());
  const w = D.zalozDosylkeZOdmowy(db(), zwrot("kl"), bob, TERAZ);
  assert.equal(w.zalozona && w.zastapil, null, "zakończona nie miała biegnącego kroku");
  const s = sprawa();
  assert.deepEqual([s.stan, s.zakonczonoAt, s.krok, s.prowadziId], ["w_toku", null, "Dosłać nowy towar (etykieta w Sellasist)", ala.id]);
  assert.throws(() => P.wznowSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db()), P.KonfliktSprawy,
    "zapas dla „Cofnij” zdjęty jak przy każdym nowym kroku");
});

test("zwrot bez zamówienia, bez loginu albo bez kodu dosyłki: stałe zdanie i zero zapisu", () => {
  zamowienie("z-1", "kl");
  const bez = zwrot("kl", { zamowienie: null });
  const inny = zwrot("kl", { kod: "REFUND_REJECTED" });
  const bezLoginu = zwrot("kl");
  db().prepare("UPDATE zwrot_klienta SET kupujacy_login = NULL WHERE id = ?").run(bezLoginu);
  const przed = zmiany();
  for (const [id, zdanie] of [[bez, /numeru zamówienia/], [inny, /kodem dosyłki/], [bezLoginu, /loginu/], [99999, /Nie znaleziono/]] as const) {
    assert.throws(() => D.zalozDosylkeZOdmowy(db(), id, ala, TERAZ),
      (e: unknown) => e instanceof P.BladSprawy && zdanie.test(e.message));
  }
  assert.equal(zmiany(), przed);
});

test("ponowienie jest idempotentne; odmowa zwrotu sprzed dosyłki ją przejmuje, a zgłoszonego po niej — zastępuje", () => {
  zamowienie("z-1", "kl");
  const zw = zwrot("kl");
  D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  db().prepare("UPDATE klient_dosylka SET waybill = 'W1', przewoznik = 'DPD', zrodlo = 'allegro', status = 'IN_TRANSIT'")
    .run();
  const przed = zmiany();
  const drugi = D.zalozDosylkeZOdmowy(db(), zw, ala, za(1));
  assert.deepEqual(drugi, { zalozona: true, login: "kl", krok: "Dosłać nowy towar (etykieta w Sellasist)",
    krokDo: "2026-10-01T06:00:00.000Z", zastapil: null });
  assert.deepEqual(D.sledzDosylkeZwrotu(db(), zw, ala, za(1)), drugi);
  assert.equal(zmiany(), przed, "ponowienie nie zastępuje dosyłki, którą ticker zdążył wykryć");
  assert.equal(wiersz()!.waybill, "W1");

  /* Drugi zwrot tego zamówienia zgłoszony PRZED dosyłką — np. dwie sztuki
     dwoma zwrotami. Dosyłka wysłana po obu odpowiada na oba: „Śledź dosyłkę”
     nic nie robi, a odmowa przejmuje wiersz, nie kasując numeru ani stanu. */
  const zw2 = zwrot("kl", { zgloszono: iso(-72) });
  const zaMoment = zmiany();
  assert.equal(D.sledzDosylkeZwrotu(db(), zw2, ala, za(2)).zalozona, true);
  assert.equal(zmiany(), zaMoment);
  assert.equal(ZP.stanZwrotuPieniedzy(db(), zw2, za(2)).sledzicDosylke, false);
  D.zalozDosylkeZOdmowy(db(), zw2, ala, za(2));
  assert.deepEqual([wiersz()!.zwrot_id, wiersz()!.waybill, wiersz()!.status, wiersz()!.zalozono_at],
    [zw2, "W1", "IN_TRANSIT", TERAZ.toISOString()]);
  assert.equal(ZP.stanZwrotuPieniedzy(db(), zw, za(2)).dosylka?.opis, "Dosyłka nadana — czekamy na pierwszy stan",
    "pierwszy zwrot dalej widzi swoją dosyłkę");

  /* Zwrot zgłoszony PO dosyłce: klient odesłał i ją, biuro wysyła kolejną
     paczkę. Stara nie należy do nowego zwrotu, więc odmowa ją zastępuje. */
  const zw3 = zwrot("kl", { zgloszono: iso(30) });
  assert.equal(ZP.stanZwrotuPieniedzy(db(), zw3, za(40)).sledzicDosylke, true);
  D.zalozDosylkeZOdmowy(db(), zw3, ala, za(40));
  assert.deepEqual([wiersz()!.zwrot_id, wiersz()!.waybill, wiersz()!.status, wiersz()!.zalozono_at],
    [zw3, null, null, iso(40)]);
});

test("numer wpisany przed odmową zostaje: odmowa przejmuje wiersz z numerem, stanem i doręczeniem", () => {
  /* Agent wysłał dosyłkę i wpisał jej numer, zanim klient zgłosił zwrot złego
     towaru. Odmowa tylko nazywa paczkę, którą biuro już wysłało — skasowanie
     numeru i doręczenia kazałoby wpisywać numer drugi raz. */
  zamowienie("z-1", "kl");
  P.ustawKrok("kl", { krok: "czekamy na zwrot, dosłane", krokDo: iso(72), wersja: 0, odcisk: "" }, ala, TERAZ, db());
  const zw = zwrot("kl", { kod: null, zgloszono: iso(10) });
  const s = sprawa("kl", za(1));
  D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "SELLASIST-1", przewoznik: "INPOST", wersja: s.wersja,
    odcisk: s.odcisk }, ala, za(1), db());
  doreczona("z-1", iso(20));
  db().prepare("UPDATE zwrot_klienta SET odmowa_kod = 'NEW_ITEM_SENT', odmowa_at = ? WHERE id = ?").run(iso(22), zw);
  assert.equal(ZP.stanZwrotuPieniedzy(db(), zw, za(22)).sledzicDosylke, false,
    "wpisana dosyłka bieżącego epizodu już jest dosyłką tego zwrotu");

  const w = D.zalozDosylkeZOdmowy(db(), zw, ala, za(22));
  assert.equal(w.zalozona, true);
  const r = wiersz()!;
  assert.deepEqual([r.zwrot_id, r.waybill, r.przewoznik, r.zrodlo, r.status, r.dostarczono_at, r.doreczen],
    [zw, "SELLASIST-1", "INPOST", "recznie", "DELIVERED", iso(20), 1]);
  assert.equal(sprawa("kl", za(22)).dosylki[0].opis, "Dosyłka doręczona 29.09");
});

/* ── Obudzenie ──────────────────────────────────────────────────────────── */

test("doręczenie i kłopot budzą sprawę swoim zdaniem; druga doręczona po potwierdzeniu pierwszej też", () => {
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  zamowienie("z-3", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2" }), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-3" }), ala, TERAZ);
  potwierdz("kl", za(1));
  assert.deepEqual(sprawa("kl", za(1)).nowe, []);

  doreczona("z-1", "2026-09-30T09:00:00.000Z");
  assert.deepEqual(sprawa("kl", za(60)).nowe.map((n) => [n.rodzaj, n.tekst, n.cel]),
    [["dosylka_doreczona", "Dosyłka doręczona 30.09", null]]);
  potwierdz("kl", za(60));
  assert.deepEqual(sprawa("kl", za(61)).nowe, [], "potwierdzone doręczenie gaśnie");

  /* Druga dosyłka doręczona — licznik, nie flaga, więc budzi mimo pierwszej. */
  doreczona("z-2", "2026-10-01T09:00:00.000Z");
  assert.deepEqual(sprawa("kl", za(80)).nowe.map((n) => n.tekst), ["Dosyłka doręczona 01.10"]);
  potwierdz("kl", za(80));

  status("z-3", "ISSUE", iso(81));
  assert.deepEqual(sprawa("kl", za(82)).nowe.map((n) => [n.rodzaj, n.tekst]),
    [["dosylka_problem", "Problem z dosyłką: przewoźnik zgłosił kłopot"]]);
  potwierdz("kl", za(82));
  status("z-3", "IN_TRANSIT", iso(83));
  assert.deepEqual(sprawa("kl", za(83)).nowe, [], "„w drodze” po kłopocie to nie kłopot");
  potwierdz("kl", za(83));
  status("z-3", "RETURNED", iso(84));
  assert.deepEqual(sprawa("kl", za(84)).nowe.map((n) => n.tekst), ["Dosyłka wraca do nadawcy"]);
});

test("nowa dosyłka zastępuje doręczoną: zastąpienie nie budzi, następne doręczenie — tak", () => {
  /* Liczniki liczą PRZEJŚCIA i nie maleją, więc zastąpiony wiersz nie
     odejmuje doręczenia, a następne doręczenie znów podnosi licznik. */
  zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  doreczona("z-1", iso(30));
  potwierdz("kl", za(31));
  /* Klient odsyła i dosyłkę — nowy zwrot, zgłoszony po niej. */
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zgloszono: iso(35) }), ala, za(40));
  assert.equal(wiersz()!.dostarczono_at, null, "to nowa paczka");
  assert.equal(sprawa("kl", za(41)).nowe.some((n) => n.rodzaj === "dosylka_doreczona"), false,
    "zastąpienie samo nie udaje doręczenia");
  doreczona("z-1", iso(60));
  assert.ok(sprawa("kl", za(61)).nowe.some((n) => n.rodzaj === "dosylka_doreczona"));
});

test("zastąpiona doręczona dosyłka budzi za siebie, nie za potwierdzoną wcześniej", () => {
  /* A doszła i agent ją widział. B doszła bez potwierdzenia, a potem klient
     odesłał i ją, więc odmowa ją zastąpiła. Liczba z odejmowania przypisywała
     obudzenie A — z datą, którą agent już widział. */
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2" }), ala, TERAZ);
  doreczona("z-1", "2026-09-29T09:00:00.000Z");
  potwierdz("kl", za(30));
  doreczona("z-2", "2026-10-01T09:00:00.000Z");
  assert.deepEqual(sprawa("kl", za(76)).nowe.map((n) => n.tekst), ["Dosyłka doręczona 01.10"]);

  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: iso(78) }), ala, za(80));
  const doreczenia = () => sprawa("kl", za(81)).nowe.filter((n) => n.rodzaj === "dosylka_doreczona").map((n) => n.tekst);
  assert.deepEqual(doreczenia(), ["Dosyłka doręczona"],
    "obudzenie należy do B, której daty już nie ma — nie do A z 29.09");
  potwierdz("kl", za(82));
  assert.deepEqual(sprawa("kl", za(83)).nowe, []);
  doreczona("z-2", "2026-10-05T09:00:00.000Z");
  assert.deepEqual(sprawa("kl", za(24 * 8)).nowe.map((n) => n.tekst), ["Dosyłka doręczona 05.10"]);
});

test("sprawa sprzed wydania (odcisk bez `k` i `q`): odmowa dopisuje klucze, więc doręczenie budzi", () => {
  zamowienie("z-1", "kl");
  P.ustawKrok("kl", { krok: "czekamy na zwrot", krokDo: iso(48), wersja: 0, odcisk: "" }, ala, za(-24), db());
  db().prepare("UPDATE klient_prowadzenie SET znane_json = json_remove(znane_json, '$.k', '$.q')").run();
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const znane = JSON.parse((db().prepare("SELECT znane_json FROM klient_prowadzenie").get() as { znane_json: string })
    .znane_json);
  assert.deepEqual([znane.k, znane.q], [0, 0]);
  doreczona("z-1", iso(30));
  assert.ok(sprawa("kl", za(31)).nowe.some((n) => n.rodzaj === "dosylka_doreczona"));
});

test("klucz nieobecny w odcisku nie budzi — ani w sicie „Moje”, ani w „nowe”; obecny budzi w obu", () => {
  const zakonczona = (login: string, zam: string) => {
    zamowienie(zam, login);
    D.zalozDosylkeZOdmowy(db(), zwrot(login, { zamowienie: zam }), ala, TERAZ);
    const s = sprawa(login, za(1));
    P.zakonczSprawe(login, { wersja: s.wersja, odcisk: s.odcisk }, ala, za(1), db());
  };
  zakonczona("zkluczem", "z-a");
  zakonczona("bezklucza", "z-b");
  db().prepare(`UPDATE klient_prowadzenie SET znane_json = json_remove(znane_json, '$.k', '$.q')
    WHERE login = 'bezklucza'`).run();
  assert.deepEqual(P.mojaLista(db(), ala.id, za(2)), [], "zakończone i ciche");
  /* Licznik zakończonej sprawy rośnie tu WPISEM WPROST. Ticker jej nie pyta,
     a spóźniony wynik odrzuca straż zapisu (test „wynik spóźniony…” niżej).
     Sito i „nowe” czytają jednak jedną definicję liczników, więc na tych
     samych danych muszą powiedzieć to samo. */
  doreczona("z-a", iso(3));
  doreczona("z-b", iso(3));
  assert.deepEqual(sprawa("zkluczem", za(4)).nowe.map((n) => n.rodzaj), ["dosylka_doreczona"]);
  assert.deepEqual(sprawa("bezklucza", za(4)).nowe, []);
  const lista = P.mojaLista(db(), ala.id, za(4));
  assert.deepEqual(lista.map((w) => [w.login, w.nowe]), [["zkluczem", `Dosyłka doręczona ${
    new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", timeZone: "Europe/Warsaw" })
      .format(za(3)).replace(/\.$/, "")}`]]);
});

/* ── „Moje” ─────────────────────────────────────────────────────────────── */

test("„Moje”: bez numeru dwa dni robocze albo z kłopotem — na dziś, ze zdaniem dosyłki zamiast terminu", () => {
  zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const wiersz1 = (teraz: Date) => P.mojaLista(db(), ala.id, teraz).find((w) => w.kolejka === "klient")!;
  const wtorek = new Date("2026-09-29T10:00:00Z");
  assert.deepEqual([wiersz1(wtorek).czeka, wiersz1(wtorek).dzis, wiersz1(wtorek).dosylka],
    [true, false, "Czekamy na numer dosyłki z Allegro"]);
  const sroda = new Date("2026-09-30T10:00:00Z");
  assert.deepEqual([wiersz1(sroda).czeka, wiersz1(sroda).dzis, wiersz1(sroda).dosylka],
    [false, true, "Allegro nie ma numeru dosyłki od 2 dni roboczych — wpisz go z Sellasist"]);

  db().prepare("UPDATE klient_dosylka SET waybill = 'W1', przewoznik = 'DPD', status = 'ISSUE', sprawdzono_at = ?")
    .run("2026-09-29T09:00:00.000Z");
  potwierdz("kl", wtorek);
  const w = wiersz1(wtorek);
  assert.deepEqual([w.czeka, w.dzis, w.dosylka, w.nowe], [false, true, "Przewoźnik zgłosił problem z dosyłką", null]);
  assert.equal(w.opis, "kl: Dosłać nowy towar (etykieta w Sellasist)", "opis kroku bez doklejonej dosyłki");

  /* Doręczona po ostatnim ruchu mówi zamiast terminu; po nowym kroku agenta
     — już nie, bo „czeka do …” jego kroku mówi więcej niż stare doręczenie. */
  db().prepare("UPDATE klient_dosylka SET status = 'DELIVERED', dostarczono_at = ?").run("2026-09-29T11:00:00.000Z");
  assert.equal(wiersz1(sroda).dosylka, "Dosyłka doręczona 29.09");
  potwierdz("kl", sroda);
  assert.equal(wiersz1(sroda).dosylka, null);
});

/* ── Zapisy z profilu ───────────────────────────────────────────────────── */

test("propozycja z profilu: wersja i odcisk ekranu, 409 przy starych, zapis potwierdza odcisk PO zapisie", () => {
  zamowienie("z-1", "kl");
  zamowienie("z-9", "ktos");
  const zw = zwrot("kl");
  const cudzy = zwrot("ktos", { zamowienie: "z-9" });
  const przed = zmiany();
  assert.throws(() => D.zalozDosylkeZProfilu("kl", { zwrotId: cudzy, wersja: 0, odcisk: "" }, ala, TERAZ, db()),
    (e: unknown) => e instanceof P.BladSprawy && e.message === "Zwrot nie należy do tego klienta");
  assert.throws(() => D.zalozDosylkeZProfilu("kl", { zwrotId: zw, wersja: 3, odcisk: "" }, ala, TERAZ, db()),
    P.KonfliktSprawy);
  assert.throws(() => D.zalozDosylkeZProfilu("kl", { zwrotId: 1.5, wersja: 0, odcisk: "" }, ala, TERAZ, db()),
    P.BladSprawy);
  assert.equal(zmiany(), przed);

  const s = D.zalozDosylkeZProfilu("kl", { zwrotId: zw, wersja: 0, odcisk: "" }, ala, TERAZ, db());
  assert.deepEqual([s.wersja, s.krok, s.dosylki.length, s.nowe], [1, "Dosłać nowy towar (etykieta w Sellasist)", 1, []]);
  assert.deepEqual(JSON.parse(wpisy("klient_dosylka%")[0].payload), { sprawa: s.id, zrodlo: "profil" });
  assert.equal(JSON.parse(wpisy("klient_sprawa_krok")[0].payload).domyslny, true);

  /* Drugi raz to 409: dosyłkę tego zamówienia już śledzimy. */
  const juz = zmiany();
  assert.throws(() => D.zalozDosylkeZProfilu("kl", { zwrotId: zw, wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db()),
    (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Dosyłkę tego zamówienia już śledzimy"
      && e.sprawa?.wersja === s.wersja);
  assert.equal(zmiany(), juz);
  /* Stary odcisk przegrywa jak w każdym zapisie sprawy — nowy zwrot przyszedł po otwarciu ekranu. */
  zamowienie("z-2", "kl");
  const zw2 = zwrot("kl", { zamowienie: "z-2" });
  const poZwrocie = zmiany();
  assert.throws(() => D.zalozDosylkeZProfilu("kl", { zwrotId: zw2, wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ,
    db()), (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Klient dopisał coś po otwarciu ekranu");
  assert.equal(zmiany(), poZwrocie);
  const swieza = sprawa();
  const po = D.zalozDosylkeZProfilu("kl", { zwrotId: zw2, wersja: swieza.wersja, odcisk: swieza.odcisk }, bob, za(1), db());
  assert.deepEqual([po.wersja, po.dosylki.length, po.nowe], [swieza.wersja + 1, 2, []],
    "jedna wersja w górę i nowy zwrot potwierdzony — agent go widział");
});

test("numer wpisany ręką: przycięty, do 64 znaków, zamówienie klienta, sprawa w toku; dziennik bez numeru", () => {
  zamowienie("z-1", "kl");
  zamowienie("z-9", "ktos");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const s = sprawa();
  const wpisz = (b: Partial<{ zamowienie: string; waybill: string; przewoznik: string }>, e = s) =>
    D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "AD-1", przewoznik: "INPOST", wersja: e.wersja,
      odcisk: e.odcisk, ...b }, bob, za(1), db());
  const przed = zmiany();
  for (const zle of [{ waybill: "   " }, { waybill: "x".repeat(65) }, { przewoznik: " " }, { zamowienie: "z-9" },
    { zamowienie: "" }]) {
    assert.throws(() => wpisz(zle), P.BladSprawy, JSON.stringify(zle));
  }
  assert.throws(() => wpisz({}, { ...s, wersja: 9 }), P.KonfliktSprawy);
  assert.equal(zmiany(), przed);

  const po = wpisz({ waybill: "  AD-TAJNY-64  " });
  assert.equal(po.wersja, s.wersja + 1);
  assert.deepEqual([po.dosylki[0].waybill, po.dosylki[0].przewoznik, po.dosylki[0].zrodlo, po.dosylki[0].opis],
    ["AD-TAJNY-64", "INPOST", "recznie", "Dosyłka nadana — czekamy na pierwszy stan"]);
  assert.equal(po.prowadziId, ala.id, "numer nie zmienia prowadzącego");
  const e = wpisy("klient_dosylka_numer");
  assert.deepEqual(JSON.parse(e[0].payload), { sprawa: s.id });
  assert.doesNotMatch(JSON.stringify(wpisy()), /TAJNY/);

  /* Dosyłka bez odmowy: numer do innego zamówienia klienta zakłada wiersz. */
  zamowienie("z-2", "kl");
  const trzy = D.wpiszNumerDosylki("kl", { zamowienie: "z-2", waybill: "AD-2", przewoznik: "OTHER",
    wersja: po.wersja, odcisk: po.odcisk }, bob, za(2), db());
  assert.equal(trzy.dosylki.find((d) => d.zamowienie === "z-2")?.opis, "Przewoźnik spoza Allegro — nie śledzimy");

  /* Zakończonej sprawy numer nie wznawia — to robi krok. */
  const z = P.zakonczSprawe("kl", { wersja: trzy.wersja, odcisk: trzy.odcisk }, ala, za(3), db());
  assert.throws(() => wpisz({}, z), (x: unknown) => x instanceof P.KonfliktSprawy && x.message === "Sprawa nie jest w toku");
});

test("nowy numer zeruje stan śledzenia, ten sam go zostawia; odcisk po zapisie nie budzi agenta jego ruchem", () => {
  zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const s = sprawa();
  const a = D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "A1", przewoznik: "DPD", wersja: s.wersja,
    odcisk: s.odcisk }, ala, za(1), db());
  doreczona("z-1", iso(2));
  const b = sprawa("kl", za(3));
  assert.equal(b.nowe.length, 1);
  const przed = [zmiany(), wpisy().length];
  const tenSam = D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "A1", przewoznik: "DPD", wersja: b.wersja,
    odcisk: b.odcisk }, ala, za(3), db());
  assert.equal(tenSam.dosylki[0].dostarczonoAt, iso(2), "ten sam numer nie kasuje doręczenia");
  assert.deepEqual([zmiany(), wpisy().length, tenSam.wersja], [...przed, b.wersja],
    "ten sam numer drugi raz to nic: bez zapisu, bez wersji i bez wpisu w dzienniku");
  assert.equal(tenSam.nowe.length, 1, "nic też nie potwierdza");
  const inny = D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "A2", przewoznik: "DPD",
    wersja: tenSam.wersja, odcisk: tenSam.odcisk }, ala, za(4), db());
  assert.deepEqual([inny.dosylki[0].dostarczonoAt, inny.dosylki[0].status, inny.dosylki[0].sprawdzonoAt], [null, null, null]);
  assert.deepEqual(inny.nowe, [], "zniknięcie doręczenia to ruch agenta, nie klienta");
  assert.ok(a.wersja < inny.wersja);
});

/* ── Wykrycie numeru ────────────────────────────────────────────────────── */

test("wybór numeru: wykluczone, zarejestrowane przed zwrotem, doręczone przed zwrotem, jedna, kilka, bez daty", () => {
  const zwrotAt = "2026-09-20T10:00:00Z";
  const p = (waybill: string, createdAt: string | null) => ({ waybill, carrierId: "DPD", createdAt });
  const nic = new Map();
  assert.equal(D.wybierzNumer([p("ORYG", "2026-09-10T10:00:00Z"), p("NOWA", "2026-09-26T10:00:00Z")], new Set(), nic,
    zwrotAt)?.waybill, "NOWA", "oryginał zarejestrowany przed zwrotem odpada");
  assert.equal(D.wybierzNumer([p("ZWROT", "2026-09-22T10:00:00Z"), p("NOWA", "2026-09-26T10:00:00Z")],
    new Set(["ZWROT"]), nic, zwrotAt)?.waybill, "NOWA", "numer paczki zwrotnej odpada");
  /* Bez daty rejestracji oryginał łapie doręczenie sprzed zwrotu, a nową
     paczkę — ruch u przewoźnika po zgłoszeniu zwrotu. */
  const stany = new Map([
    ["ORYG", { dostarczonoAt: "2026-09-15T10:00:00Z", status: "DELIVERED", ostatnioAt: "2026-09-15T10:00:00Z" }],
    ["NOWA", { dostarczonoAt: null, status: "IN_TRANSIT", ostatnioAt: "2026-09-26T10:00:00Z" }],
  ]);
  assert.equal(D.wybierzNumer([p("ORYG", null), p("NOWA", null)], new Set(), stany, zwrotAt)?.waybill, "NOWA");
  assert.equal(D.wybierzNumer([p("ORYG", null)], new Set(), stany, zwrotAt), null, "sam oryginał to brak dosyłki");
  /* Samotny numer bez daty i bez ruchu po zwrocie NIE jest dosyłką: to bywa
     oryginał w drodze albo paczka u przewoźnika spoza Allegro. */
  const cicha = new Map([["X", { dostarczonoAt: null, status: "IN_TRANSIT", ostatnioAt: "2026-09-18T10:00:00Z" }]]);
  assert.equal(D.wybierzNumer([p("X", null)], new Set(), cicha, zwrotAt), null, "ruch tylko sprzed zwrotu");
  assert.equal(D.wybierzNumer([p("X", null)], new Set(), new Map(), zwrotAt), null, "bez historii — np. OTHER");
  assert.equal(D.wybierzNumer([{ waybill: "O", carrierId: "OTHER", createdAt: null }], new Set(), new Map(), zwrotAt),
    null);
  /* Kilka po odsiewie: najpóźniej zarejestrowana — a bez daty NIE zgadujemy. */
  assert.equal(D.wybierzNumer([p("A", "2026-09-26T10:00:00Z"), p("B", "2026-09-27T10:00:00Z")], new Set(), nic,
    zwrotAt)?.waybill, "B");
  const bRusza = new Map([["B", { dostarczonoAt: null, status: "IN_TRANSIT", ostatnioAt: "2026-09-27T10:00:00Z" }]]);
  assert.equal(D.wybierzNumer([p("A", "2026-09-26T10:00:00Z"), p("B", null)], new Set(), bRusza, zwrotAt), null);
  assert.equal(D.wybierzNumer([p("A", "2026-09-26T10:00:00Z"), p("B", null)], new Set(), nic, zwrotAt)?.waybill, "A",
    "numer bez daty i bez ruchu po zwrocie w ogóle nie jest kandydatem");
  assert.equal(D.wybierzNumer([], new Set(), nic, zwrotAt), null);
});

test("ticker wykrywa numer: paczki zwrotu z lądowiska i `transportingWaybill` odpadają, dziennik bez numeru", async () => {
  zamowienie("z-1", "kl");
  const zw = zwrot("kl", { zgloszono: "2026-09-22T10:00:00.000Z",
    paczki: [{ waybill: "ZW-A", carrierId: "ALLEGRO", transportingWaybill: "ZW-A-ORLEN" }, { waybill: "ZW-B", carrierId: "DPD" }] });
  D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  const wersja = sprawa().wersja;
  const a = allegro({
    przesylki: { "z-1": [
      { waybill: "ORYG", carrierId: "DPD", createdAt: "2026-09-10T10:00:00Z" },
      { waybill: "ZW-A-ORLEN", carrierId: "ORLEN" }, { waybill: "ZW-B", carrierId: "DPD" },
      { waybill: "DOSYLKA-1", carrierId: "INPOST", createdAt: "2026-09-28T09:00:00Z" },
    ] },
    statusy: { "DOSYLKA-1": [{ code: "IN_TRANSIT", occurredAt: "2026-09-28T09:30:00Z" }] },
  });
  const w = await D.sledzDosylki(db(), a.deps(za(2)));
  assert.deepEqual(w, { wykryte: 1, doreczone: 0, problemy: 0 });
  assert.deepEqual([wiersz()!.waybill, wiersz()!.przewoznik, wiersz()!.zrodlo, wiersz()!.status, wiersz()!.sprawdzono_at],
    ["DOSYLKA-1", "INPOST", "allegro", "IN_TRANSIT", iso(2)]);
  assert.equal(sprawa("kl", za(2)).wersja, wersja, "ticker nie podnosi wersji — ekran nie ma czego przegrać");
  assert.deepEqual(wpisy("klient_dosylka_wykryta").map((e) => JSON.parse(e.payload)), [{ sprawa: sprawa().id }]);
  assert.deepEqual(wpisy("klient_dosylka_numer"), [], "numer wpisany ręką to osobny typ — miara je porównuje");
  assert.equal(wiersz()!.numer_at, iso(2), "od wykrycia biegnie okno śledzenia numeru");
  assert.doesNotMatch(JSON.stringify(wpisy("%")), /DOSYLKA-1|ZW-A|ORYG/);
  /* Numer jest — następny takt tylko śledzi, o przesyłki zamówienia nie pyta. */
  a.wolane.length = 0;
  await D.sledzDosylki(db(), a.deps(za(3)));
  assert.deepEqual(a.wolane.map((u) => u.includes("/tracking")), [true]);
});

test("wykrycie: pusta odpowiedź zapisuje samo sprawdzenie i czeka pół godziny; bez daty zwrotu nie pyta wcale", async () => {
  zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const a = allegro();
  await D.sledzDosylki(db(), a.deps(za(1)));
  assert.equal(wiersz()!.sprawdzono_at, iso(1));
  assert.equal(sprawa("kl", za(1)).dosylki[0].opis, "Allegro nie ma jeszcze numeru dosyłki (stan z 11:00)");
  await D.sledzDosylki(db(), a.deps(za(1.25)));
  assert.equal(a.wolane.length, 1, "kwadrans po pustej odpowiedzi nie pytamy znowu");
  await D.sledzDosylki(db(), a.deps(za(1.5)));
  assert.equal(a.wolane.length, 2);

  /* Zwrot bez `createdAt` w lądowisku: oryginału nie da się odróżnić od dosyłki. */
  zamowienie("z-2", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: null }), ala, za(2));
  a.wolane.length = 0;
  await D.sledzDosylki(db(), a.deps(za(3)));
  assert.deepEqual(a.wolane.filter((u) => u.includes("z-2")), []);
  assert.equal(wiersz("z-2")!.sprawdzono_at, null, "nie pytaliśmy, więc nie ma „stanu z”");
});

/* ── Śledzenie ──────────────────────────────────────────────────────────── */

/** Sprawa w toku z dosyłką o znanym numerze — punkt wyjścia testów śledzenia. */
function zNumerem(login: string, zam: string, waybill: string, przewoznik = "DPD", zalozono = TERAZ) {
  zamowienie(zam, login);
  D.zalozDosylkeZOdmowy(db(), zwrot(login, { zamowienie: zam }), ala, zalozono);
  db().prepare("UPDATE klient_dosylka SET waybill = ?, przewoznik = ?, zrodlo = 'recznie' WHERE zamowienie = ?")
    .run(waybill, przewoznik, zam);
}

test("śledzenie: doręczenie raz, kłopot raz na przejście, potem cisza; wersja stoi", async () => {
  zNumerem("kl", "z-1", "P1");
  zNumerem("kl", "z-2", "P2", "INPOST");
  const wersja = sprawa().wersja;
  const statusy: Record<string, Array<{ code: string; occurredAt: string }>> = {
    P1: [{ code: "IN_TRANSIT", occurredAt: iso(1) }], P2: [{ code: "ISSUE", occurredAt: iso(1) }] };
  const a = allegro({ statusy });
  assert.deepEqual(await D.sledzDosylki(db(), a.deps(za(2))), { wykryte: 0, doreczone: 0, problemy: 1 });
  assert.deepEqual(await D.sledzDosylki(db(), a.deps(za(3))), { wykryte: 0, doreczone: 0, problemy: 0 },
    "ten sam kłopot przy kolejnym takcie to nie zdarzenie");
  statusy.P1 = [...statusy.P1, { code: "DELIVERED", occurredAt: "2026-09-28T13:00:00.000Z" }];
  assert.deepEqual(await D.sledzDosylki(db(), a.deps(za(4))), { wykryte: 0, doreczone: 1, problemy: 0 });
  assert.deepEqual([wiersz("z-1")!.status, wiersz("z-1")!.dostarczono_at], ["DELIVERED", "2026-09-28T13:00:00.000Z"]);
  /* Każda zmiana statusu ma wpis (mutacja), ale samo sprawdzenie bez zmiany — nie. */
  assert.deepEqual(wpisy("klient_dosylka_%").filter((e) => e.type !== "klient_dosylka_zalozona")
    .map((e) => [e.type, JSON.parse(e.payload)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [
    ["klient_dosylka_doreczona", { sprawa: sprawa().id }],
    ["klient_dosylka_problem", { sprawa: sprawa().id, status: "ISSUE" }],
    ["klient_dosylka_stan", { sprawa: sprawa().id, status: "IN_TRANSIT" }],
  ]);
  assert.deepEqual([wiersz("z-1")!.doreczen, wiersz("z-2")!.problemow], [1, 1]);
  assert.equal(sprawa("kl", za(4)).wersja, wersja);

  /* Doręczona i wracająca do nadawcy wypadają ze śledzenia. */
  statusy.P2 = [{ code: "RETURNED", occurredAt: iso(4) }];
  await D.sledzDosylki(db(), a.deps(za(5)));
  a.wolane.length = 0;
  await D.sledzDosylki(db(), a.deps(za(6)));
  assert.deepEqual(a.wolane, [], "nie ma już czego pytać");
});

test("śledzenie: zakończonej sprawy, dosyłki starszej niż 30 dni ani przewoźnika OTHER nie pytamy", async () => {
  zNumerem("stara", "z-s", "S1", "DPD", za(-24 * 31));
  zNumerem("inna", "z-o", "O1", "OTHER");
  zNumerem("konczy", "z-k", "K1");
  const s = sprawa("konczy");
  P.zakonczSprawe("konczy", { wersja: s.wersja, odcisk: s.odcisk }, ala, TERAZ, db());
  const a = allegro();
  await D.sledzDosylki(db(), a.deps(za(1)));
  assert.deepEqual(a.wolane, []);
  assert.equal(sprawa("inna", za(1)).dosylki[0].opis, "Przewoźnik spoza Allegro — nie śledzimy");
});

test("compare-and-set: numer zmieniony w czasie żądania wygrywa, a data doręczenia nie jest nadpisywana", async () => {
  zNumerem("kl", "z-1", "P1");
  const a = allegro({
    statusy: { P1: [{ code: "DELIVERED", occurredAt: iso(1) }] },
    /* Agent wpisuje nowy numer, zanim przewoźnik odpowie o starym. */
    przy: () => db().prepare("UPDATE klient_dosylka SET waybill = 'P1-POPRAWIONY' WHERE zamowienie = 'z-1'").run(),
  });
  assert.deepEqual(await D.sledzDosylki(db(), a.deps(za(2))), { wykryte: 0, doreczone: 0, problemy: 0 });
  assert.deepEqual([wiersz()!.waybill, wiersz()!.status, wiersz()!.dostarczono_at], ["P1-POPRAWIONY", null, null]);

  /* Doręczenie zapisane w międzyczasie zostaje — COALESCE, nie nadpisanie. */
  db().prepare("UPDATE klient_dosylka SET waybill = 'P1'").run();
  const b = allegro({
    statusy: { P1: [{ code: "DELIVERED", occurredAt: iso(5) }] },
    przy: () => db().prepare("UPDATE klient_dosylka SET dostarczono_at = ? WHERE zamowienie = 'z-1'").run(iso(1)),
  });
  await D.sledzDosylki(db(), b.deps(za(6)));
  assert.equal(wiersz()!.dostarczono_at, iso(1));
  assert.equal(wpisy("klient_dosylka_doreczona").length, 0, "przejścia nie było — ktoś zapisał doręczenie przed nami");
});

test("429 idzie wyżej, żeby takt odczekał; każdy inny błąd zabiera jedną dosyłkę, nie przebieg", async () => {
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zgloszono: "2026-09-20T10:00:00Z" }), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: "2026-09-20T10:00:00Z" }), ala, TERAZ);
  const przesylki = { "z-2": [{ waybill: "N2", carrierId: "DPD", createdAt: "2026-09-28T09:00:00Z" }] };
  const zepsuta = allegro({ przesylki,
    blad: (u) => (u.includes("z-1") ? new Error("Allegro odpowiedziało 503: {\"adres\":\"ul. Tajna 1\"}") : null) });
  const ostrzezenia: unknown[] = [];
  const warn = console.warn;
  console.warn = (...x: unknown[]) => { ostrzezenia.push(x); };
  try {
    assert.equal((await D.sledzDosylki(db(), zepsuta.deps(za(1)))).wykryte, 1, "z-2 przeszło mimo błędu z-1");
  } finally { console.warn = warn; }
  assert.equal(wiersz("z-1")!.sprawdzono_at, null, "nieudane pytanie to nie „stan z”");
  assert.doesNotMatch(JSON.stringify(ostrzezenia), /Tajna/, "treść odpowiedzi Allegro nie trafia do logu");

  const limit = allegro({ przesylki, blad: (u) => (u.includes("/tracking") ? new BladLimitu("limit", 900_000) : null) });
  await assert.rejects(D.sledzDosylki(db(), limit.deps(za(2))), BladLimitu);
  const limitPrzesylek = allegro({ blad: (u) => (u.includes("/shipments") ? new BladLimitu("limit", 900_000) : null) });
  await assert.rejects(D.sledzDosylki(db(), limitPrzesylek.deps(za(5))), BladLimitu);
});

/* ── Zwrot pieniędzy i odczyty ──────────────────────────────────────────── */

test("stan zwrotu pieniędzy: dosyłka pod odmową albo propozycja „Śledź dosyłkę”", () => {
  zamowienie("z-1", "kl");
  const zw = zwrot("kl");
  const bez = zwrot("kl", { zamowienie: null });
  const inny = zwrot("kl", { kod: "ITEM_FIXED", zamowienie: "z-3" });
  const przed = ZP.stanZwrotuPieniedzy(db(), zw, TERAZ);
  assert.deepEqual([przed.odmowa!.kod, przed.dosylka, przed.sledzicDosylke], ["NEW_ITEM_SENT", null, true]);
  assert.equal(ZP.stanZwrotuPieniedzy(db(), bez, TERAZ).sledzicDosylke, false, "bez zamówienia nie ma czego śledzić");
  assert.equal(ZP.stanZwrotuPieniedzy(db(), inny, TERAZ).sledzicDosylke, false, "naprawa to nie dosyłka");

  D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  const po = ZP.stanZwrotuPieniedzy(db(), zw, TERAZ);
  assert.deepEqual([po.dosylka, po.sledzicDosylke],
    [{ opis: "Czekamy na numer dosyłki z Allegro", login: "kl", ton: null }, false]);
});

test("odczyty niczego nie zapisują: sprawa z dosyłkami, „Moje”, stan zwrotu pieniędzy", () => {
  zamowienie("z-1", "kl");
  const zw = zwrot("kl");
  D.zalozDosylkeZOdmowy(db(), zw, ala, TERAZ);
  doreczona("z-1", iso(1));
  const przed = zmiany();
  sprawa("kl", za(2));
  P.mojaLista(db(), ala.id, za(2));
  ZP.stanZwrotuPieniedzy(db(), zw, za(2));
  assert.equal(zmiany(), przed);
});

/* ── Poprawki po przeglądzie (@wydanie) ─────────────────────────────────── */

test("wznowienie zakończonej sprawy odkłada jej dosyłki do historii: karta, „Moje” i ticker ich nie widzą", async () => {
  /* Dosyłka dotarła, numeru nikt nie wpisał, sprawę zakończono. Miesiąc
     później klient wraca w innej sprawie — stara dosyłka nie może wołać
     „brak numeru od 20 dni” w nowej. */
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  const bezNumeru = zwrot("kl");
  const doszla = zwrot("kl", { zamowienie: "z-2" });
  D.zalozDosylkeZOdmowy(db(), bezNumeru, ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), doszla, ala, TERAZ);
  doreczona("z-2", iso(20));
  let s = sprawa("kl", za(24));
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(24), db());

  const pozniej = za(24 * 20);
  s = sprawa("kl", pozniej);
  P.ustawKrok("kl", { krok: "odpisać w sprawie faktury", krokDo: iso(24 * 5, pozniej), wersja: s.wersja,
    odcisk: s.odcisk }, ala, pozniej, db());
  const t = za(1, pozniej);
  assert.deepEqual(sprawa("kl", t).dosylki, []);
  const m = P.mojaLista(db(), ala.id, t).find((w) => w.kolejka === "klient")!;
  assert.deepEqual([m.dosylka, m.dzis, m.czeka], [null, false, true]);
  assert.equal(PK.profilKlienta("kl", t, db())!.podpowiedzPowod, null);
  const a = allegro();
  await D.sledzDosylki(db(), a.deps(t));
  assert.deepEqual(a.wolane, [], "dosyłka poprzedniego epizodu nie jest już pytana");

  /* Historia zostaje historią: fakt z datą albo „nie śledzimy”, nigdy prośba o numer. */
  assert.deepEqual(ZP.stanZwrotuPieniedzy(db(), doszla, t).dosylka,
    { opis: "Dosyłka doręczona 29.09", login: "kl", ton: "ok" });
  assert.deepEqual(ZP.stanZwrotuPieniedzy(db(), bezNumeru, t).dosylka,
    { opis: "Dosyłki już nie śledzimy.", login: "kl", ton: null });
  assert.equal(ZP.stanZwrotuPieniedzy(db(), bezNumeru, t).sledzicDosylke, false, "ta dosyłka była śledzona");

  /* Wznowienie odmową robi to samo — każda droga kroku. */
  s = sprawa("kl", t);
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, t, db());
  zamowienie("z-3", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-3", zgloszono: iso(-1, t) }), ala, za(2, t));
  assert.deepEqual(sprawa("kl", za(3, t)).dosylki.map((d) => d.zamowienie), ["z-3"]);
});

test("numer wpisany po czasie dostaje własne okno śledzenia", async () => {
  zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zgloszono: iso(-24 * 35) }), ala, za(-24 * 31));
  const s = sprawa("kl");
  D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "P1", przewoznik: "DPD", wersja: s.wersja,
    odcisk: s.odcisk }, ala, TERAZ, db());
  assert.equal(wiersz()!.numer_at, TERAZ.toISOString());
  const a = allegro({ statusy: { P1: [{ code: "IN_TRANSIT", occurredAt: iso(0.5) }] } });
  await D.sledzDosylki(db(), a.deps(za(1)));
  assert.deepEqual(a.wolane.map((u) => u.includes("/tracking")), [true], "okno liczy się od numeru, nie od założenia");
  assert.equal(wiersz()!.status, "IN_TRANSIT");
});

test("kłopot, „w drodze” i znów kłopot budzi dwa razy; ISSUE, potem RETURNED — też", async () => {
  zNumerem("kl", "z-1", "P1");
  const statusy: Record<string, Array<{ code: string; occurredAt: string }>> = {
    P1: [{ code: "ISSUE", occurredAt: iso(1) }] };
  const a = allegro({ statusy });
  const nowe = (t: Date) => sprawa("kl", t).nowe.map((n) => n.tekst);
  await D.sledzDosylki(db(), a.deps(za(2)));
  assert.deepEqual(nowe(za(2)), ["Problem z dosyłką: przewoźnik zgłosił kłopot"]);
  potwierdz("kl", za(2));

  statusy.P1 = [...statusy.P1, { code: "IN_TRANSIT", occurredAt: iso(20) }];
  await D.sledzDosylki(db(), a.deps(za(21)));
  assert.deepEqual(nowe(za(21)), []);

  statusy.P1 = [...statusy.P1, { code: "ISSUE", occurredAt: iso(40) }];
  await D.sledzDosylki(db(), a.deps(za(41)));
  assert.deepEqual(nowe(za(41)), ["Problem z dosyłką: przewoźnik zgłosił kłopot"], "drugi kłopot to nowe zdarzenie");
  assert.equal(P.mojaLista(db(), ala.id, za(41)).find((w) => w.kolejka === "klient")?.nowe,
    "Problem z dosyłką: przewoźnik zgłosił kłopot", "sito „Moje” mówi to samo co „nowe”");
  potwierdz("kl", za(41));

  statusy.P1 = [...statusy.P1, { code: "RETURNED", occurredAt: iso(50) }];
  await D.sledzDosylki(db(), a.deps(za(51)));
  assert.deepEqual(nowe(za(51)), ["Dosyłka wraca do nadawcy"], "powrót do nadawcy po kłopocie też budzi");
  assert.deepEqual([wiersz()!.problemow, wpisy("klient_dosylka_problem").length, wpisy("klient_dosylka_stan").length],
    [3, 3, 1]);
});

test("wynik spóźniony za zakończeniem sprawy albo jej wznowieniem nie zapisuje się i nie budzi", async () => {
  /* Ticker czyta wiersze PRZED żądaniem. Człowiek, który w tym czasie
     zamknął sprawę, nie dostaje jej z powrotem na „Moje” przez paczkę. */
  zNumerem("kl", "z-1", "P1");
  let zamknieta = false;
  const a = allegro({ statusy: { P1: [{ code: "DELIVERED", occurredAt: iso(1) }] },
    przy: () => {
      if (zamknieta) return;
      zamknieta = true;
      const s = sprawa("kl", za(2));
      P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(2), db());
    } });
  assert.deepEqual(await D.sledzDosylki(db(), a.deps(za(2))), { wykryte: 0, doreczone: 0, problemy: 0 });
  assert.deepEqual([wiersz()!.status, wiersz()!.dostarczono_at, wiersz()!.doreczen, wiersz()!.sprawdzono_at],
    [null, null, 0, null]);
  assert.deepEqual(wpisy("klient_dosylka_doreczona"), []);
  assert.deepEqual(sprawa("kl", za(3)).nowe, []);

  /* Wykrycie numeru, gdy w czasie żądania sprawę zakończono i wznowiono
     krokiem: dosyłka jest już historią poprzedniego epizodu. */
  zamowienie("z-2", "kl2");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl2", { zamowienie: "z-2", zgloszono: "2026-09-20T10:00:00Z" }), ala, TERAZ);
  let wznowiona = false;
  const b = allegro({
    przesylki: { "z-2": [{ waybill: "N2", carrierId: "DPD", createdAt: "2026-09-28T09:00:00Z" }] },
    przy: () => {
      if (wznowiona) return;
      wznowiona = true;
      let s = sprawa("kl2", za(4));
      P.zakonczSprawe("kl2", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(4), db());
      s = sprawa("kl2", za(4));
      P.ustawKrok("kl2", { krok: "inna sprawa", krokDo: iso(48), wersja: s.wersja, odcisk: s.odcisk }, ala, za(4), db());
    } });
  assert.equal((await D.sledzDosylki(db(), b.deps(za(4)))).wykryte, 0);
  assert.deepEqual([wiersz("z-2")!.waybill, wiersz("z-2")!.archiwalna], [null, 1]);
  assert.deepEqual(wpisy("klient_dosylka_wykryta"), []);
});

test("nakładka zamówienia i szkic: dosyłki, której nie śledzimy, nie ma — chyba że doszła", async () => {
  /* Etykieta wydrukowana, sprawę zakończono tego samego dnia, numeru nikt nie
     wpisał. „Czeka na nadanie” w szkicu Copilota byłoby kłamstwem o paczce,
     która dawno doszła. */
  const id = zamowienie("z-1", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  const zywa = PZ.przesylkaZamowienia(db(), id, za(1));
  assert.equal(PZ.stanPrzesylkiKrotko(zywa), "dosyłka: numer jeszcze nieznany");
  const s = sprawa("kl", za(2));
  P.zakonczSprawe("kl", { wersja: s.wersja, odcisk: s.odcisk }, ala, za(2), db());
  const zamrozona = PZ.przesylkaZamowienia(db(), id, za(24 * 20));
  assert.equal(zamrozona.dosylka, null);
  assert.equal(PZ.stanPrzesylkiKrotko(zamrozona), null);
  assert.equal(PZ.zdaniePrzesylki(zamrozona), null);

  /* Doręczenie to fakt z datą — zostaje także przy zakończonej sprawie. */
  doreczona("z-1", iso(20));
  assert.equal(PZ.stanPrzesylkiKrotko(PZ.przesylkaZamowienia(db(), id, za(24 * 20))),
    "dosyłka: doręczona 2026-09-29");
});

test("przewoźnik bez statusu: zdanie z tonem uwagi, nie „w drodze”", async () => {
  zNumerem("kl", "z-1", "LITEROWKA");
  const a = allegro();
  await D.sledzDosylki(db(), a.deps(za(1)));
  assert.deepEqual([sprawa("kl", za(1)).dosylki[0].opis, sprawa("kl", za(1)).dosylki[0].ton],
    ["Przewoźnik nie zna jeszcze tej paczki (stan z 11:00)", "uwaga"]);
  assert.deepEqual(wpisy("klient_dosylka_stan"), [], "samo sprawdzenie bez statusu to nie zdarzenie");
});

test("samotny numer bez daty rejestracji i bez ruchu po zwrocie nie zostaje dosyłką", async () => {
  /* Jedyny numer zamówienia bez `createdAt`: oryginał, który ruszał się
     tylko przed zwrotem, albo paczka u przewoźnika spoza Allegro. */
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zgloszono: "2026-09-22T10:00:00.000Z" }), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: "2026-09-22T10:00:00.000Z" }), ala, TERAZ);
  const a = allegro({
    przesylki: { "z-1": [{ waybill: "ORYG", carrierId: "DPD" }], "z-2": [{ waybill: "INNY", carrierId: "OTHER" }] },
    statusy: { ORYG: [{ code: "IN_TRANSIT", occurredAt: "2026-09-18T10:00:00.000Z" }] },
  });
  assert.equal((await D.sledzDosylki(db(), a.deps(za(1)))).wykryte, 0);
  assert.deepEqual([wiersz("z-1")!.waybill, wiersz("z-1")!.sprawdzono_at], [null, iso(1)]);
  assert.deepEqual([wiersz("z-2")!.waybill, wiersz("z-2")!.sprawdzono_at], [null, iso(1)]);
});

test("jeden źle wpisany numer nie zatrzymuje śledzenia pozostałych", async () => {
  zNumerem("kl", "z-1", "DOBRY");
  zNumerem("kl", "z-2", "ZLY-NUMER");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const a = allegro({
      statusy: { DOBRY: [{ code: "DELIVERED", occurredAt: iso(1) }] },
      blad: (u) => (u.includes("ZLY-NUMER") ? new BladOdpowiedzi("Allegro odpowiedziało 400: ul. Tajna", 400) : null),
    });
    assert.equal((await D.sledzDosylki(db(), a.deps(za(2)))).doreczone, 1);
  } finally { console.warn = warn; }
  assert.equal(wiersz("z-1")!.dostarczono_at, iso(1));
  assert.equal(wiersz("z-2")!.sprawdzono_at, null, "nieudane pytanie to nie „stan z”");
});

test("odmowa z panelu Allegro: ekran zwrotu proponuje „Śledź dosyłkę”, a dosyłka niesie numer zwrotu", () => {
  zamowienie("z-1", "kl");
  const zw = zwrot("kl", { kod: null, rejection: "NEW_ITEM_SENT" });
  const przed = ZP.stanZwrotuPieniedzy(db(), zw, TERAZ);
  assert.deepEqual([przed.odmowa, przed.dosylka, przed.sledzicDosylke], [null, null, true],
    "kod z synchronizacji wystarcza, choć naszej odmowy nie ma");
  const w = D.sledzDosylkeZwrotu(db(), zw, ala, TERAZ);
  assert.equal(w.zalozona && w.krok, "Dosłać nowy towar (etykieta w Sellasist)");
  const po = ZP.stanZwrotuPieniedzy(db(), zw, TERAZ);
  assert.deepEqual([po.dosylka?.opis, po.sledzicDosylke], ["Czekamy na numer dosyłki z Allegro", false]);
  assert.equal(sprawa().dosylki[0].zwrotId, zw);
});

test("409 tylko przez dosyłkę mówi o dosyłce, nie o kliencie", () => {
  zNumerem("kl", "z-1", "P1");
  const s = sprawa();
  doreczona("z-1", iso(1));
  assert.throws(() => P.ustawKrok("kl", { krok: "x", krokDo: iso(48), wersja: s.wersja, odcisk: s.odcisk }, ala, za(2), db()),
    (e: unknown) => e instanceof P.KonfliktSprawy
      && e.message === "Dosyłka zmieniła stan po otwarciu ekranu — sprawdź i zapisz jeszcze raz.");
  /* Nowy zwrot to ruch klienta — zdanie zostaje stare. */
  const s2 = sprawa("kl", za(2));
  zwrot("kl", { zamowienie: "z-1" });
  assert.throws(() => P.ustawKrok("kl", { krok: "x", krokDo: iso(48), wersja: s2.wersja, odcisk: s2.odcisk }, ala, za(3),
    db()), (e: unknown) => e instanceof P.KonfliktSprawy && e.message === "Klient dopisał coś po otwarciu ekranu");
});

test("rytm tickera dosyłek stoi w konfiguracji: siedemnaście minut, inny niż rabaty", async () => {
  const { config } = await import("../config.js");
  assert.equal(config.allegro.dosylkiSyncMs, 1_020_000);
  assert.notEqual(config.allegro.dosylkiSyncMs, config.allegro.rabatySyncMs);
});

test("źródło numeru stoi i znika razem z numerem na każdej drodze zapisu", async () => {
  /* Historia klienta przy źródle dostaje `waybill: null` zawsze, więc panel
     poznaje brak numeru po `zrodlo`. Rozjazd dwóch pól to „numer jest”
     przy dosyłce bez numeru albo odwrotnie. */
  const rozjazd = () => (db().prepare(`SELECT count(*) AS n FROM klient_dosylka
    WHERE (waybill IS NULL) <> (zrodlo IS NULL)`).get() as { n: number }).n;
  zamowienie("z-1", "kl");
  zamowienie("z-2", "kl");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl"), ala, TERAZ);
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: "2026-09-20T10:00:00Z" }), ala, TERAZ);
  assert.equal(rozjazd(), 0, "założenie");
  const s = sprawa();
  D.wpiszNumerDosylki("kl", { zamowienie: "z-1", waybill: "R1", przewoznik: "DPD", wersja: s.wersja,
    odcisk: s.odcisk }, ala, za(1), db());
  assert.equal(rozjazd(), 0, "numer wpisany ręką");
  await D.sledzDosylki(db(), allegro({
    przesylki: { "z-2": [{ waybill: "N2", carrierId: "DPD", createdAt: "2026-09-28T09:00:00Z" }] } }).deps(za(2)));
  assert.equal(wiersz("z-2")!.zrodlo, "allegro");
  assert.equal(rozjazd(), 0, "numer wykryty");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zgloszono: iso(3) }), ala, za(4));
  assert.deepEqual([wiersz()!.waybill, wiersz()!.zrodlo], [null, null]);
  assert.equal(rozjazd(), 0, "zastąpienie");
  D.zalozDosylkeZOdmowy(db(), zwrot("kl", { zamowienie: "z-2", zgloszono: iso(-72) }), ala, za(5));
  assert.deepEqual([wiersz("z-2")!.waybill, wiersz("z-2")!.zrodlo], ["N2", "allegro"]);
  assert.equal(rozjazd(), 0, "przejęcie");
});
