import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { BladReklamacji, ReklamacjaConflict } from "./reklamacje.js";
import {
  LIMIT_ZNAKOW, odpowiedzWSprawie, stanKolejkiOdpowiedzi,
} from "./reklamacje-wysylka.js";

/* Ten plik pilnuje rzeczy, których na ekranie nie widać: że odrzucona treść
   nie dotyka sieci ani kolejki, że podwójne kliknięcie daje JEDNĄ wiadomość,
   że niejednoznaczny timeout nazywa się po imieniu i nie jest ponawiany, oraz
   że dopisek DORADCY zatrzymuje wysyłkę tak samo jak dopisek klienta.

   Adapter jest zawsze wstrzykiwany — żaden test nie strzela do Allegro. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const AUTOR = { id: 1, name: "A. Lewandowska" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')")
    .run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const id = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
    reference_number,status_allegro,czat_aktywny,wiadomosci_ile,otwarto_at,synced_at)
    VALUES (?,'i-1','123/2026','CLAIM_SUBMITTED',1,1,
      '2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`).run(konto).lastInsertRowid);
  const wiad = (ext: string, rola: string, tresc = "treść") => Number(d.prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
     VALUES (?,?,?,?,'2026-09-06T10:01:00Z')`).run(id, ext, rola, tresc).lastInsertRowid);
  const pytanie = wiad("w-1", "BUYER", "Kosiarka przestała ciąć");
  return { d, id, wiad, pytanie };
}

const outbox = (d: DatabaseSync) => (d.prepare(
  "SELECT status, external_message_id, blad FROM reklamacja_outbox ORDER BY id")
  .all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));

const zdarzenia = (d: DatabaseSync, type: string) => d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string | null }>;

/** Zadanie z domyślnym, udanym adapterem; `n` nadpisuje co trzeba. */
const zadanie = (d: DatabaseSync, id: number, pytanie: number, n = {}) => ({
  reklamacjaId: id, autor: AUTOR, tresc: "Proszę o zdjęcie noża.",
  expectedWersja: 1, expectedLastMessageId: pytanie, database: d,
  wyslij: async () => ({ id: "m-1", createdAt: "2026-09-07T12:00:00.000Z" }),
  ...n,
});

test("za długa treść odpada PRZED siecią i nie zostawia wiersza w kolejce", async () => {
  const { d, id, pytanie } = stanowisko();
  let strzalow = 0;
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    tresc: "x".repeat(LIMIT_ZNAKOW + 1),
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  })), /20000 znaków/);
  assert.equal(strzalow, 0, "za długa treść nie ma prawa dotknąć Allegro");
  assert.equal(outbox(d).length, 0, "odrzucona odpowiedź nie zostawia śladu w kolejce");
});

test("pusta treść odpada tak samo", async () => {
  const { d, id, pytanie } = stanowisko();
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, { tresc: "   " })),
    (e: unknown) => e instanceof BladReklamacji);
  assert.equal(outbox(d).length, 0);
});

test("zamknięta rozmowa odpada PRZED siecią — Allegro i tak oddałoby 409", async () => {
  const { d, id, pytanie } = stanowisko();
  d.prepare("UPDATE reklamacja_klienta SET czat_aktywny=0 WHERE id=?").run(id);
  let strzalow = 0;
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  })), (e: unknown) => {
    assert.ok(e instanceof ReklamacjaConflict);
    assert.equal(e.szczegoly.czatAktywny, false);
    assert.match(e.message, /nie przyjmie/);
    return true;
  });
  assert.equal(strzalow, 0);
});

test("udana wysyłka dopisuje oś, podnosi licznik i stempluje prowadzącego", async () => {
  const { d, id, pytanie } = stanowisko();
  const w = await odpowiedzWSprawie(zadanie(d, id, pytanie));

  assert.equal(w.status, "sent");
  assert.equal(w.externalMessageId, "m-1");
  assert.match(w.kluczIdempotencji, /^rkl-/);

  const wiadomosci = d.prepare(
    "SELECT external_id, autor_rola, tresc FROM reklamacja_wiadomosc ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  assert.equal(wiadomosci.length, 2);
  assert.equal(wiadomosci[1].autor_rola, "SELLER", "własną wiadomość podpisujemy rolą Allegro");

  const r = d.prepare(`SELECT wiadomosci_ile, ostatnia_wiadomosc_status, prowadzi
    FROM reklamacja_klienta WHERE id=?`).get(id) as Record<string, unknown>;
  /* Licznik z Allegro jest snapshotem SPRZED naszej wysyłki. Bez podniesienia
     ekran natychmiast powiedziałby „ta rozmowa jest niepełna". */
  assert.equal(r.wiadomosci_ile, 2);
  assert.equal(r.ostatnia_wiadomosc_status, "SELLER_REPLIED");
  assert.equal(r.prowadzi, "A. Lewandowska", "odpowiedź JEST prowadzeniem sprawy");
  /* Statusu Allegro nie ruszamy — należy do Allegro, a kubełek liczy się sam. */
  assert.equal((d.prepare("SELECT status_allegro FROM reklamacja_klienta WHERE id=?")
    .get(id) as { status_allegro: string }).status_allegro, "CLAIM_SUBMITTED");
});

test("cudzego znacznika „prowadzę” odpowiedź NIE zabiera", async () => {
  const { d, id, pytanie } = stanowisko();
  d.prepare("UPDATE reklamacja_klienta SET prowadzi='M. Wójcik' WHERE id=?").run(id);
  await odpowiedzWSprawie(zadanie(d, id, pytanie));
  assert.equal((d.prepare("SELECT prowadzi FROM reklamacja_klienta WHERE id=?")
    .get(id) as { prowadzi: string }).prowadzi, "M. Wójcik",
    "to znacznik dla reszty biura, nie własność — cudza sprawa nie blokuje odpowiedzi");
});

test("podwójne kliknięcie daje JEDEN strzał i jedną wiadomość", async () => {
  const { d, id, pytanie } = stanowisko();
  let strzalow = 0;
  const zad = zadanie(d, id, pytanie, {
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  });
  const a = await odpowiedzWSprawie(zad);
  const b = await odpowiedzWSprawie(zad);

  assert.equal(strzalow, 1);
  assert.equal(a.kluczIdempotencji, b.kluczIdempotencji);
  assert.equal(b.status, "sent", "druga próba oddaje stan pierwszej");
  assert.equal(outbox(d).length, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_wiadomosc").get() as { n: number }).n, 2);
});

test("timeout to `send_uncertain`, a ponowienie NIE strzela drugi raz", async () => {
  const { d, id, pytanie } = stanowisko();
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => {
      throw new Error("Brak połączenia z Allegro — (The operation was aborted due to timeout)");
    },
  })));
  assert.equal(outbox(d)[0].status, "send_uncertain");

  let strzalow = 0;
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  })), /zsynchronizuj/);
  assert.equal(strzalow, 0, "§8.5: takiej wysyłki nie ponawiamy automatycznie");
});

test("odmowa Allegro to `send_failed` z treścią odpowiedzi, i wolno ponowić", async () => {
  const { d, id, pytanie } = stanowisko();
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => { throw new Error("Allegro odpowiedziało 422: nieznane pole `body`"); },
  })));
  const po = outbox(d)[0];
  assert.equal(po.status, "send_failed");
  assert.match(String(po.blad), /nieznane pole/,
    "zapisany błąd ma sam podać właściwy kształt żądania");
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_wiadomosc").get() as { n: number }).n, 1);

  /* Wiadomo, że nic nie poszło — więc ten jeden stan wolno wznowić. */
  const w = await odpowiedzWSprawie(zadanie(d, id, pytanie));
  assert.equal(w.status, "sent");
  assert.equal(outbox(d).length, 1, "wznowienie wraca do TEGO SAMEGO wiersza");
});

test("sukces bez identyfikatora to `send_uncertain`, BEZ wiersza na osi", async () => {
  const { d, id, pytanie } = stanowisko();
  const w = await odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => ({ createdAt: "2026-09-07T12:00:00.000Z" }),
  }));
  assert.equal(w.status, "send_uncertain");
  assert.equal(w.externalMessageId, null);
  /* Wpis bez identyfikatora nie ma jak być idempotentny — wróciłby duplikatem
     przy najbliższej synchronizacji. */
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_wiadomosc").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT wiadomosci_ile FROM reklamacja_klienta WHERE id=?")
    .get(id) as { wiadomosci_ile: number }).wiadomosci_ile, 1, "licznik też nie rośnie");
});

test("dopisek DORADCY zatrzymuje wysyłkę tak samo jak dopisek klienta", async () => {
  const { d, id, wiad, pytanie } = stanowisko();
  /* Doradca Allegro odpisał w 61 sprawach na 100 w sondzie. Jego zdanie
     zmienia to, co należy napisać — więc świeżość liczy się od NIE NASZEJ
     wiadomości, a nie od wiadomości kupującego. */
  const doradca = wiad("w-2", "ADMIN", "Proszę sprzedawcę o stanowisko");
  let strzalow = 0;
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  })), (e: unknown) => {
    assert.ok(e instanceof ReklamacjaConflict);
    assert.equal(e.szczegoly.lastMessageId, doradca);
    const nowa = e.szczegoly.nowaWiadomosc as { rola: string; tresc: string };
    assert.equal(nowa.rola, "ADMIN");
    assert.equal(nowa.tresc, "Proszę sprzedawcę o stanowisko");
    assert.match(String(e.szczegoly.kluczIdempotencji), /^rkl-/);
    return true;
  });
  assert.equal(strzalow, 0, "nic nie poszło do Allegro");

  /* Jawna zgoda przepuszcza — blizna 0.110.0: nigdy po cichu. */
  const w = await odpowiedzWSprawie(zadanie(d, id, pytanie, {
    expectedLastMessageId: doradca, mimoNowejWiadomosci: true,
  }));
  assert.equal(w.status, "sent");
});

test("WŁASNA wiadomość świeżości NIE narusza", async () => {
  const { d, id, pytanie } = stanowisko();
  await odpowiedzWSprawie(zadanie(d, id, pytanie));
  /* Druga odpowiedź z rzędu ma przejść: punkt odniesienia przesuwa wyłącznie
     wiadomość NIE nasza, więc własna nie robi z kolejnej „spóźnionej". */
  const w = await odpowiedzWSprawie(zadanie(d, id, pytanie, {
    expectedWersja: 1, tresc: "Dopisuję jeszcze jedno.",
    wyslij: async () => ({ id: "m-2", createdAt: "2026-09-07T12:05:00.000Z" }),
  }));
  assert.equal(w.status, "sent");
});

test("konflikt wersji wraca z ładunkiem, a treść nie idzie do Allegro", async () => {
  const { d, id, pytanie } = stanowisko();
  d.prepare("UPDATE reklamacja_klienta SET wersja=5, prowadzi='M. Wójcik' WHERE id=?").run(id);
  let strzalow = 0;
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    wyslij: async () => { strzalow += 1; return { id: "m-1" }; },
  })), (e: unknown) => {
    assert.ok(e instanceof ReklamacjaConflict);
    assert.equal(e.szczegoly.wersja, 5);
    assert.equal(e.szczegoly.prowadzi, "M. Wójcik");
    return true;
  });
  assert.equal(strzalow, 0);
});

test("audyt niesie DŁUGOŚĆ, nigdy treść", async () => {
  const { d, id, pytanie } = stanowisko();
  await odpowiedzWSprawie(zadanie(d, id, pytanie, {
    tresc: "Numer seryjny klienta LS19-0042",
    wyslij: async () => ({ id: "m-1" }),
  }));
  const proba = zdarzenia(d, "reklamacja_wysylka_proba");
  const wyslana = zdarzenia(d, "reklamacja_odpowiedz");
  assert.equal(proba.length, 1);
  assert.equal(wyslana.length, 1);
  assert.equal(wyslana[0].user_id, "A. Lewandowska");
  for (const e of [...proba, ...wyslana]) {
    assert.equal(String(e.payload).includes("LS19-0042"), false,
      "treść odpowiedzi nie ma prawa trafić do `events` — ta tabela nie ma retencji");
    assert.match(String(e.payload), /znakow/);
  }
});

test("stan kolejki liczy to, co wymaga oka człowieka", async () => {
  const { d, id, pytanie } = stanowisko();
  await odpowiedzWSprawie(zadanie(d, id, pytanie));
  assert.deepEqual(stanKolejkiOdpowiedzi(d), { wyslane: 1, doSprawdzenia: 0 });

  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, id, pytanie, {
    tresc: "Inna treść, inny klucz.",
    wyslij: async () => { throw new Error("Allegro odpowiedziało 500: awaria"); },
  })));
  assert.deepEqual(stanKolejkiOdpowiedzi(d), { wyslane: 1, doSprawdzenia: 1 });
});

test("nieistniejąca reklamacja to 404, nie cicha porażka", async () => {
  const { d, pytanie } = stanowisko();
  await assert.rejects(() => odpowiedzWSprawie(zadanie(d, 999, pytanie)), (e: unknown) => {
    assert.ok(e instanceof BladReklamacji);
    assert.equal(e.kod, 404);
    return true;
  });
});
