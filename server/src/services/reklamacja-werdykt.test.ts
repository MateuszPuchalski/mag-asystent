import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { BladOdpowiedziAllegro } from "../adapters/allegro.js";
import { BladReklamacji, ReklamacjaConflict, kubelek, listaReklamacji, sygnaly } from "./reklamacje.js";
import {
  LIMIT_WIADOMOSCI, ODMOWY, UZNANIA, WERDYKTY, sufitKwoty, wydajWerdykt, zdecydujZwrotTowaru,
} from "./reklamacja-werdykt.js";

/* Ten plik pilnuje rzeczy, których na ekranie nie widać: że odrzucony werdykt
   nie dotyka ani sieci, ani wiersza; że jeden werdykt na sprawę to JEDEN strzał
   także po timeoucie; że porażka kodem pozwala spróbować raz jeszcze;
   że dziennik niesie długości i kody, nigdy treść; że sprawa wychodzi
   z DO DECYZJI od razu po wysłaniu; i że krok o towarze idzie dopiero po
   uznaniu, raz, przez tę samą kolejkę z własnym `typ`.

   Adapter jest zawsze wstrzykiwany — żaden test nie strzela do Allegro. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const KTO = { id: 1, name: "A. Lewandowska" };

function stanowisko(n: {
  oczekiwanie?: string; kwota?: number | null; cena?: number | null; ilosc?: number | null;
  status?: string;
} = {}) {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  if (n.cena !== null) {
    d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,cena_grosze,synced_at)
      VALUES (?,'of-1','Kosiarka',?,'2026-09-07T10:00:00Z')`).run(konto, n.cena ?? 12_999);
  }
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
      reference_number,offer_id,status_allegro,oczekiwanie,oczekiwana_kwota_grosze,ilosc,
      czat_aktywny,wiadomosci_ile,decyzja_do,otwarto_at,synced_at)
    VALUES (?,'i-1','123/2026','of-1',?,?,?,?,1,1,'2026-09-20T10:00:00Z',
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`).run(
    konto, n.status ?? "CLAIM_SUBMITTED", n.oczekiwanie ?? "REFUND",
    n.kwota ?? null, n.ilosc === undefined ? 1 : n.ilosc).lastInsertRowid);
  const pytanie = Number(d.prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
     VALUES (?,'w-1','BUYER','Kosiarka przestała ciąć','2026-09-06T10:01:00Z')`).run(id).lastInsertRowid);
  return { d, id, pytanie };
}

const wiersz = (d: DatabaseSync, id: number) => ({ ...(d.prepare(
  `SELECT werdykt, werdykt_wiadomosc, werdykt_kwota_grosze, werdykt_status, werdykt_blad,
          werdykt_przez, werdykt_user_id, prowadzi, wersja, status_allegro, zwrot_towaru
     FROM reklamacja_klienta WHERE id=?`).get(id) as Record<string, unknown>) });

const zdarzenia = (d: DatabaseSync, type: string): Array<Record<string, unknown>> => (d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string | null }>).map((z) => ({
  user: z.user_id, ...(JSON.parse(z.payload ?? "{}") as Record<string, unknown>),
}));

/** Atrapa Allegro: liczy strzały i pamięta ostatnie ciało. */
function allegro(zachowanie: () => Promise<void> = async () => {}) {
  const s = { strzalow: 0, ostatnie: null as unknown };
  const wyslij = async (_id: string, cialo: unknown) => {
    s.strzalow += 1; s.ostatnie = cialo; await zachowanie();
  };
  return { s, wyslij };
}

test("listy werdyktów: cztery uznania, siedem odrzuceń, razem jedenaście ze schematu", () => {
  assert.equal(UZNANIA.length, 4);
  assert.equal(ODMOWY.length, 7);
  assert.equal(new Set(WERDYKTY).size, 11);
  assert.ok(UZNANIA.every((w) => w.startsWith("ACCEPTED_")) && ODMOWY.every((w) => w.startsWith("REJECTED_")));
});

test("odrzucone dane nie dotykają sieci ani wiersza — bez `sending` udającego próbę", async () => {
  const { d, id } = stanowisko({ oczekiwanie: "PARTIAL_REFUND", kwota: 5_000 });
  const { s, wyslij } = allegro();
  const przypadki: Array<[Record<string, unknown>, RegExp]> = [
    [{ werdykt: "ACCEPTED_WHATEVER", wiadomosc: "x" }, /Nieznany werdykt/],
    [{ werdykt: "ACCEPTED_REFUND", wiadomosc: "   " }, /wymagana/],
    [{ werdykt: "ACCEPTED_REFUND", wiadomosc: "x".repeat(LIMIT_WIADOMOSCI + 1) }, /20000 znaków/],
    [{ werdykt: "ACCEPTED_REFUND", wiadomosc: "x", kwotaGrosze: 100 }, /tylko przy częściowym/],
    [{ werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "x" }, /większej od zera/],
    [{ werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "x", kwotaGrosze: 0 }, /większej od zera/],
    [{ werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "x", kwotaGrosze: 12.5 }, /większej od zera/],
    /* Sufit NAZWANY: agent ma wiedzieć, skąd wzięła się liczba. */
    [{ werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "x", kwotaGrosze: 5_001 },
      /50\.01 zł przekracza sufit 50\.00 zł \(kwota, o którą prosił klient\)/],
  ];
  for (const [zadanie, wzor] of przypadki) {
    await assert.rejects(() => wydajWerdykt(d, id, zadanie as never, KTO, wyslij), (e: unknown) => {
      assert.ok(e instanceof BladReklamacji, `${JSON.stringify(zadanie)} → BladReklamacji`);
      assert.match(e.message, wzor);
      return true;
    });
  }
  assert.equal(s.strzalow, 0, "odrzucone dane nie mają prawa dotknąć Allegro");
  assert.equal(wiersz(d, id).werdykt_status, null, "ani zostawić śladu na wierszu");
  assert.equal(zdarzenia(d, "reklamacja_werdykt_proba").length, 0);
  await assert.rejects(() => wydajWerdykt(d, 999, { werdykt: "REJECTED_OTHER", wiadomosc: "x" }, KTO, wyslij),
    (e: unknown) => e instanceof BladReklamacji && e.kod === 404);
});

test("sufit: kwota klienta, potem cena × ilość, bez ilości brak sufitu", () => {
  assert.deepEqual(sufitKwoty({ oczekiwanie: "PARTIAL_REFUND", oczekiwanaKwotaGrosze: 5_000, cenaGrosze: 12_999, ilosc: 3 }),
    { grosze: 5_000, zrodlo: "kwota, o którą prosił klient" });
  assert.deepEqual(sufitKwoty({ oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 5_000, cenaGrosze: 12_999, ilosc: 3 }),
    { grosze: 38_997, zrodlo: "cena oferty × 3 szt." });
  assert.equal(sufitKwoty({ oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, cenaGrosze: 12_999, ilosc: null }), null,
    "bez ilości nie zgadujemy jednej sztuki");
  assert.equal(sufitKwoty({ oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, cenaGrosze: null, ilosc: 2 }), null);
});

test("200 → `sent`: kolumny, wersja+1, stempel prowadzącego, ciało ze schematu, dziennik bez treści", async () => {
  const { d, id } = stanowisko({ ilosc: 2 });
  const { s, wyslij } = allegro();
  const wynik = await wydajWerdykt(d, id, {
    werdykt: "ACCEPTED_PARTIAL_REFUND", wiadomosc: "Zwracamy 40 zł za pękniętą osłonę.",
    kwotaGrosze: 4_000, wersja: 1,
  }, KTO, wyslij);
  assert.deepEqual(wynik, {
    werdykt: "ACCEPTED_PARTIAL_REFUND", werdyktNazwa: "Uznana — częściowy zwrot pieniędzy",
    status: "sent", blad: null, wersja: 2,
  });
  assert.equal(s.strzalow, 1);
  assert.deepEqual(s.ostatnie, {
    status: "ACCEPTED_PARTIAL_REFUND", message: "Zwracamy 40 zł za pękniętą osłonę.",
    kwotaGrosze: 4_000, waluta: "PLN",
  });
  const w = wiersz(d, id);
  assert.equal(w.werdykt, "ACCEPTED_PARTIAL_REFUND");
  assert.equal(w.werdykt_wiadomosc, "Zwracamy 40 zł za pękniętą osłonę.", "kopia zostaje — Allegro nie odda jej w czacie");
  assert.equal(w.werdykt_kwota_grosze, 4_000);
  assert.equal(w.werdykt_status, "sent");
  assert.equal(w.werdykt_przez, "A. Lewandowska");
  assert.equal(w.werdykt_user_id, 1);
  assert.equal(w.prowadzi, "A. Lewandowska", "werdykt jest prowadzeniem sprawy");
  assert.equal(w.wersja, 2);
  assert.equal(w.status_allegro, "CLAIM_SUBMITTED", "status Allegro należy do Allegro");

  const proba = zdarzenia(d, "reklamacja_werdykt_proba");
  const los = zdarzenia(d, "reklamacja_werdykt");
  assert.deepEqual(proba, [{ user: "A. Lewandowska", id, werdykt: "ACCEPTED_PARTIAL_REFUND", znakow: 34, kwotaGrosze: 4_000 }]);
  assert.deepEqual(los, [{ user: "A. Lewandowska", id, werdykt: "ACCEPTED_PARTIAL_REFUND", status: "sent", kod: null }]);
  const dziennik = (d.prepare("SELECT payload FROM events").all() as Array<{ payload: string }>).map((e) => e.payload).join(" ");
  assert.equal(dziennik.includes("osłon"), false, "treść do kupującego nie idzie do dziennika");

  /* Sprawa wychodzi z DO DECYZJI OD RAZU, z sygnałem „niepotwierdzony". */
  const [r] = listaReklamacji(d, Date.parse("2026-09-07T12:00:00Z"));
  assert.equal(r!.kubelek, "zamknieta");
  assert.deepEqual(r!.sygnaly, ["werdykt_niepotwierdzony", "towar_do_decyzji"]);
  assert.equal(r!.werdyktNazwa, "Uznana — częściowy zwrot pieniędzy");
  assert.equal(r!.ilosc, 2);
});

test("drugi werdykt to 409 — po `sent` i po `send_uncertain`; wersja z ekranu też pilnowana", async () => {
  const { d, id } = stanowisko();
  const { s, wyslij } = allegro();
  await assert.rejects(() => wydajWerdykt(d, id, { werdykt: "REJECTED_OTHER", wiadomosc: "x", wersja: 7 }, KTO, wyslij),
    (e: unknown) => e instanceof ReklamacjaConflict && e.szczegoly.wersja === 1);
  await wydajWerdykt(d, id, { werdykt: "REJECTED_OTHER", wiadomosc: "Nie." }, KTO, wyslij);
  await assert.rejects(() => wydajWerdykt(d, id, { werdykt: "ACCEPTED_REFUND", wiadomosc: "Jednak tak." }, KTO, wyslij),
    (e: unknown) => {
      assert.ok(e instanceof ReklamacjaConflict);
      assert.match(e.message, /już wyszedł albo jest w drodze/);
      return true;
    });
  assert.equal(s.strzalow, 1, "podwójne kliknięcie daje JEDEN strzał");
  assert.equal(wiersz(d, id).werdykt, "REJECTED_OTHER", "pierwszy werdykt zostaje");

  /* Timeout: `send_uncertain`, żadnego ponowienia z panelu. */
  const t = stanowisko();
  const timeout = allegro(async () => { throw new Error("fetch failed: timeout"); });
  const wynik = await wydajWerdykt(t.d, t.id, { werdykt: "ACCEPTED_REPAIR", wiadomosc: "Naprawimy." }, KTO, timeout.wyslij);
  assert.equal(wynik.status, "send_uncertain");
  assert.match(String(wynik.blad), /timeout/);
  assert.equal(wiersz(t.d, t.id).werdykt_status, "send_uncertain");
  await assert.rejects(() => wydajWerdykt(t.d, t.id, { werdykt: "ACCEPTED_REPAIR", wiadomosc: "Naprawimy." }, KTO, timeout.wyslij),
    (e: unknown) => e instanceof ReklamacjaConflict);
  assert.equal(timeout.s.strzalow, 1);
  assert.deepEqual(zdarzenia(t.d, "reklamacja_werdykt").map((z) => z.status), ["send_uncertain"]);
  const [r] = listaReklamacji(t.d, Date.parse("2026-09-07T12:00:00Z"));
  assert.equal(r!.kubelek, "zamknieta", "mogło dojść, drugiego strzału nie będzie — sprawa nie wraca do decyzji");
});

test("odmowa kodem → `send_failed` z kodem i zdaniem; ponowienie dozwolone i wtedy `sent`", async () => {
  const { d, id } = stanowisko();
  let raz = true;
  const { s, wyslij } = allegro(async () => {
    if (raz) { raz = false; throw new BladOdpowiedziAllegro("Allegro odpowiedziało 400: bad status", 400); }
  });
  const pierwszy = await wydajWerdykt(d, id, { werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna." }, KTO, wyslij);
  assert.equal(pierwszy.status, "send_failed");
  assert.match(String(pierwszy.blad), /400/);
  let w = wiersz(d, id);
  assert.equal(w.werdykt_status, "send_failed");
  assert.match(String(w.werdykt_blad), /400/);
  const [r] = listaReklamacji(d, Date.parse("2026-09-07T12:00:00Z"));
  assert.equal(r!.kubelek, "decyzja", "nic nie poszło — sprawa dalej czeka na decyzję");
  assert.ok(r!.sygnaly.includes("werdykt_nieudany"));
  assert.deepEqual(zdarzenia(d, "reklamacja_werdykt")[0], {
    user: "A. Lewandowska", id, werdykt: "REJECTED_MINOR_DEFECT", status: "send_failed", kod: 400,
  });

  const drugi = await wydajWerdykt(d, id, { werdykt: "REJECTED_MINOR_DEFECT", wiadomosc: "Wada nieistotna." }, KTO, wyslij);
  assert.equal(drugi.status, "sent");
  assert.equal(s.strzalow, 2);
  w = wiersz(d, id);
  assert.equal(w.werdykt_status, "sent");
  assert.equal(w.werdykt_blad, null);
  assert.equal(w.wersja, 3, "każda próba podnosi wersję");
});

test("sprawa rozstrzygnięta przez Allegro nie przyjmuje werdyktu z panelu", async () => {
  const { d, id } = stanowisko({ status: "CLAIM_ACCEPTED" });
  const { s, wyslij } = allegro();
  await assert.rejects(() => wydajWerdykt(d, id, { werdykt: "REJECTED_OTHER", wiadomosc: "x" }, KTO, wyslij),
    (e: unknown) => e instanceof ReklamacjaConflict && /poza panelem/.test(e.message));
  assert.equal(s.strzalow, 0);
});

test("kubełek i sygnały: lokalny werdykt zamyka, `send_failed` nie; towar do decyzji tylko po uznaniu", () => {
  const baza = { statusAllegro: "CLAIM_SUBMITTED", ostatniaWiadomoscStatus: null, czatAktywny: true };
  assert.equal(kubelek({ ...baza, werdyktStatus: "sent" }), "zamknieta");
  assert.equal(kubelek({ ...baza, werdyktStatus: "send_uncertain" }), "zamknieta");
  assert.equal(kubelek({ ...baza, werdyktStatus: "send_failed" }), "decyzja");
  assert.equal(kubelek({ ...baza, werdyktStatus: "sending" }), "decyzja");
  /* Klient dopisał po naszym werdykcie — jak po werdykcie Allegro: DO ODPOWIEDZI. */
  assert.equal(kubelek({ ...baza, ostatniaWiadomoscStatus: "BUYER_REPLIED", werdyktStatus: "sent" }), "odpowiedz");

  const s = (n: Record<string, unknown>) => sygnaly({
    statusAllegro: "CLAIM_SUBMITTED", dniDoTerminu: 1, ostatniaWiadomoscStatus: null,
    czatAktywny: true, zwrotWymagany: null, ...n,
  });
  assert.deepEqual(s({}), ["termin"]);
  /* Po wysłaniu termin przestaje palić — decyzja zapadła. */
  assert.deepEqual(s({ werdykt: "REJECTED_OTHER", werdyktStatus: "sent" }), ["werdykt_niepotwierdzony"]);
  assert.deepEqual(s({ werdykt: "ACCEPTED_REFUND", werdyktStatus: "sent" }), ["werdykt_niepotwierdzony", "towar_do_decyzji"]);
  assert.deepEqual(s({ werdykt: "ACCEPTED_REFUND", werdyktStatus: "sent", zwrotTowaru: "wymagany" }), ["werdykt_niepotwierdzony"]);
  /* Allegro potwierdziło i samo zna stanowisko o towarze — ani jednego sygnału o werdykcie. */
  assert.deepEqual(s({ statusAllegro: "CLAIM_ACCEPTED", werdykt: "ACCEPTED_REFUND", werdyktStatus: "sent", zwrotWymagany: false }), []);
  assert.deepEqual(s({ werdykt: "ACCEPTED_REFUND", werdyktStatus: "send_failed" }), ["termin", "werdykt_nieudany"]);
});

test("towar do odesłania: dopiero po uznaniu, raz, przez outbox z `typ`, z decyzją na wierszu", async () => {
  const { d, id, pytanie } = stanowisko();
  const wyslano: Array<{ tekst: string; typ: string }> = [];
  const wyslij = async (_id: string, tekst: string, typ: string) => {
    wyslano.push({ tekst, typ }); return { id: `m-${wyslano.length}`, createdAt: "2026-09-07T12:00:00.000Z" };
  };
  const zadanie = (n: Record<string, unknown> = {}) => ({
    reklamacjaId: id, decyzja: "wymagany", tresc: "Proszę odesłać kosiarkę na nasz adres.",
    expectedWersja: 1, expectedLastMessageId: pytanie, autor: KTO, database: d, wyslij, ...n,
  });

  /* Przed werdyktem — 409 ze stanem, żadnej wysyłki. */
  await assert.rejects(() => zdecydujZwrotTowaru(zadanie()), (e: unknown) =>
    e instanceof ReklamacjaConflict && /dopiero po uznaniu/.test(e.message));
  /* Po ODRZUCENIU — tak samo. */
  await wydajWerdykt(d, id, { werdykt: "REJECTED_OTHER", wiadomosc: "Nie." }, KTO, allegro().wyslij);
  await assert.rejects(() => zdecydujZwrotTowaru(zadanie({ expectedWersja: 2 })), (e: unknown) => e instanceof ReklamacjaConflict);
  assert.equal(wyslano.length, 0);

  const u = stanowisko();
  await wydajWerdykt(u.d, u.id, { werdykt: "ACCEPTED_EXCHANGE", wiadomosc: "Wymienimy." }, KTO, allegro().wyslij);
  await assert.rejects(() => zdecydujZwrotTowaru({ ...zadanie({ expectedWersja: 2 }), reklamacjaId: u.id, database: u.d, decyzja: "moze" }),
    (e: unknown) => e instanceof BladReklamacji);
  const wynik = await zdecydujZwrotTowaru({ ...zadanie({ expectedWersja: 2 }), reklamacjaId: u.id, database: u.d, expectedLastMessageId: u.pytanie });
  assert.equal(wynik.status, "sent");
  assert.deepEqual(wyslano, [{ tekst: "Proszę odesłać kosiarkę na nasz adres.", typ: "RETURN_REQUIRED_CUSTOM" }]);
  const outbox = { ...(u.d.prepare("SELECT typ, status FROM reklamacja_outbox").get() as Record<string, unknown>) };
  assert.deepEqual(outbox, { typ: "RETURN_REQUIRED_CUSTOM", status: "sent" });
  const w = wiersz(u.d, u.id);
  assert.equal(w.zwrot_towaru, "wymagany");
  assert.equal(w.wersja, 3, "werdykt +1, wysyłka nie rusza wersji, decyzja +1");
  assert.deepEqual(zdarzenia(u.d, "reklamacja_zwrot_towaru"),
    [{ user: "A. Lewandowska", id: u.id, decyzja: "wymagany", znakow: 38, status: "sent" }]);
  const [r] = listaReklamacji(u.d, Date.parse("2026-09-07T12:00:00Z"));
  assert.equal(r!.zwrotTowaru, "wymagany");
  assert.deepEqual(r!.sygnaly, ["werdykt_niepotwierdzony"], "towar rozstrzygnięty — sygnał gaśnie");

  /* Drugi raz — 409, bez wysyłki. */
  await assert.rejects(() => zdecydujZwrotTowaru({ ...zadanie({ expectedWersja: 3, decyzja: "niewymagany" }), reklamacjaId: u.id, database: u.d }),
    (e: unknown) => e instanceof ReklamacjaConflict && /już wyszła/.test(e.message));
  assert.equal(wyslano.length, 1);
});

test("towar: odmowa Allegro kodem zostawia decyzję pustą — wolno spróbować raz jeszcze", async () => {
  const { d, id, pytanie } = stanowisko();
  await wydajWerdykt(d, id, { werdykt: "ACCEPTED_REFUND", wiadomosc: "Zwracamy." }, KTO, allegro().wyslij);
  let raz = true;
  const wyslij = async () => {
    if (raz) { raz = false; throw new BladOdpowiedziAllegro("Allegro odpowiedziało 400", 400); }
    return { id: "m-1", createdAt: "2026-09-07T12:00:00.000Z" };
  };
  const zadanie = { reklamacjaId: id, decyzja: "niewymagany", tresc: "Towaru nie trzeba odsyłać.",
    expectedWersja: 2, expectedLastMessageId: pytanie, autor: KTO, database: d, wyslij };
  await assert.rejects(() => zdecydujZwrotTowaru(zadanie), /400/);
  assert.equal(wiersz(d, id).zwrot_towaru, null);
  const wynik = await zdecydujZwrotTowaru(zadanie);
  assert.equal(wynik.status, "sent");
  assert.equal(wiersz(d, id).zwrot_towaru, "niewymagany");
  assert.equal((d.prepare("SELECT typ FROM reklamacja_outbox").get() as { typ: string }).typ, "RETURN_NOT_REQUIRED");
});
