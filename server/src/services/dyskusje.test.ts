import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Dyskusje Allegro — rejestr pracy biura ──────────────────────────────────
   Sedno: synchronizacja jest upsertem, który odświeża pola Allegro i NIE TYKA
   naszej pracy (status, prowadzący, notatka); sprawa zamknięta w panelu
   schodzi z worklisty automatem; CLAIM dostaje termin ustawowy liczony tą
   samą arytmetyką co reklamacje ze zwrotów.                                  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-dysk-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let D: typeof import("./dyskusje.js");
let zresetujAdapterAllegro: typeof import("../adapters/allegro.js").zresetujAdapterAllegro;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ zresetujAdapterAllegro } = await import("../adapters/allegro.js"));
  D = await import("./dyskusje.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", "dyskusja", "zwrot_pozycja", "zwrot", "events", "watek_meta"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  /* Świeży adapter dev na każdy test — wysłana wiadomość z jednego testu nie
     ma prawa pokazać się w rozmowie w następnym. */
  zresetujAdapterAllegro();
});

const dniTemu = (n: number) => new Date(Date.now() - n * 86_400_000 - 1000).toISOString();

function zwrotDlaZamowienia(orderId: string, waybill: string): number {
  const w = db()
    .prepare(
      `INSERT INTO zwrot(allegro_order_id, waybill, status, utworzono_at, utworzono_przez)
       VALUES (?, ?, 'nowy', ?, 'Test')`
    )
    .run(orderId, waybill, dniTemu(0));
  return Number(w.lastInsertRowid);
}

test("sync: nowe sprawy wchodzą jako `nowa`, zamknięta w panelu schodzi automatem", async () => {
  const wynik = await D.synchronizujDyskusje("Biuro");
  /* Adapter dev daje trzy sprawy; trzecia ma status CLOSED i ma zostać
     zamknięta w tym samym przebiegu, podpisana przez `allegro`. */
  assert.equal(wynik.nowych, 3);
  assert.equal(wynik.zamknietychPrzezAllegro, 1);
  assert.equal(wynik.przejrzanych, 3);

  const worklista = D.listaDyskusji();
  assert.equal(worklista.length, 2, "CLOSED nie jest robotą do zrobienia");
  assert.ok(worklista.every((y) => y.status === "nowa"));

  const wszystkie = D.listaDyskusji({ status: "wszystkie" });
  const zamknieta = wszystkie.find((y) => y.statusAllegro === "CLOSED")!;
  assert.equal(zamknieta.status, "zamknieta");
  assert.equal(zamknieta.zamknietoPrzez, "allegro");
});

test("sync jest upsertem: pola Allegro się odświeżają, nasza praca zostaje", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];
  D.zmienStatusDyskusji(sprawa.id, "w_toku", "Ala");
  D.zapiszNotatkeDyskusji(sprawa.id, "czekamy na zdjęcia od klienta", "Ala");

  const drugi = await D.synchronizujDyskusje("Biuro");
  assert.equal(drugi.nowych, 0, "te same sprawy nie wchodzą drugi raz");

  const po = D.szczegolDyskusji(sprawa.id);
  assert.equal(po.status, "w_toku", "status naszej pracy przeżywa sync");
  assert.equal(po.prowadzi, "Ala");
  assert.equal(po.notatka, "czekamy na zdjęcia od klienta");
});

test("wiązanie ze zwrotem po numerze zamówienia — także spóźnione", async () => {
  /* Zwrot zeskanowany PRZED pierwszym pobraniem dyskusji. */
  const zwrotId = zwrotDlaZamowienia("dev-ord-1", "DEVWB0001");
  await D.synchronizujDyskusje("Biuro");
  const zWczesniejszym = D.listaDyskusji().find((y) => y.orderId === "dev-ord-1")!;
  assert.equal(zWczesniejszym.zwrotId, zwrotId);

  /* Druga sprawa nie ma jeszcze zwrotu; paczka przyjeżdża PO dyskusji
     i wiązanie ma dołożyć następny przebieg, nie ręka człowieka. */
  const bezZwrotu = D.listaDyskusji().find((y) => y.orderId === "dev-ord-2")!;
  assert.equal(bezZwrotu.zwrotId, null);
  const pozniejszy = zwrotDlaZamowienia("dev-ord-2", "DEVWB0002");
  await D.synchronizujDyskusje("Biuro");
  assert.equal(D.szczegolDyskusji(bezZwrotu.id).zwrotId, pozniejszy);
});

test("CLAIM ma termin ustawowy, DISCUSSION nie ma zegara; CLAIM idzie na górę", async () => {
  await D.synchronizujDyskusje("Biuro");
  const lista = D.listaDyskusji();
  const claim = lista.find((y) => y.typ === "CLAIM")!;
  const rozmowa = lista.find((y) => y.typ === "DISCUSSION")!;
  assert.ok(claim.termin !== null && claim.dniDoTerminu !== null);
  /* Adapter dev stempluje „dzień temu" bez sekundy zapasu, więc na szybkim
     runnerze odczyt potrafi wypaść w TEJ SAMEJ milisekundzie (wtedy floor
     daje 13, nie 12) — ta sama pułapka co w reklamacje.test.ts. */
  assert.ok(
    claim.dniDoTerminu === 12 || claim.dniDoTerminu === 13,
    `dzień temu + 14 dni ustawowych ≈ 12–13 dni zapasu, było ${claim.dniDoTerminu}`
  );
  assert.equal(rozmowa.termin, null);
  assert.equal(lista[0].typ, "CLAIM", "sprawa z zegarem stoi przed rozmową");
});

test("statusy: guardy 404/409, zamknięcie stempluje, licznik się zgadza", async () => {
  await D.synchronizujDyskusje("Biuro");
  const przed = D.licznikDyskusji();
  assert.equal(przed.nowe, 2);
  assert.equal(przed.wToku, 0);

  const sprawa = D.listaDyskusji()[0];
  D.zmienStatusDyskusji(sprawa.id, "w_toku", "Ola");
  const wToku = D.szczegolDyskusji(sprawa.id);
  assert.equal(wToku.prowadzi, "Ola", "wzięcie sprawy stempluje prowadzącego");

  const zamknieta = D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Ola");
  assert.equal(zamknieta.zamknietoPrzez, "Ola");
  assert.throws(() => D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Ola"), /już w statusie/);
  assert.throws(() => D.zmienStatusDyskusji(999999, "w_toku", "Ola"), /Nie ma takiej/);
  assert.throws(() => D.zmienStatusDyskusji(sprawa.id, "dziwny", "Ola"), /Nieznany status/);

  const po = D.licznikDyskusji();
  assert.equal(po.nowe, 1);
  assert.equal(po.wToku, 0);
});

test("notatka bierze sprawę na piszącego; pusta zdejmuje treść, nie właściciela", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];
  D.zapiszNotatkeDyskusji(sprawa.id, "ustalone: dosyłamy śrubę", "Ewa");
  const po = D.szczegolDyskusji(sprawa.id);
  assert.equal(po.notatka, "ustalone: dosyłamy śrubę");
  assert.equal(po.prowadzi, "Ewa");
  D.zapiszNotatkeDyskusji(sprawa.id, "   ", "Jan");
  const pusta = D.szczegolDyskusji(sprawa.id);
  assert.equal(pusta.notatka, null);
  assert.equal(pusta.prowadzi, "Jan", "ostatni pracujący podmienia nazwisko — znacznik, nie zamek");
});

/* ── Rozmowa i odpowiedź (0.104.0) ─────────────────────────────────────────── */

test("rozmowa: czytana z API na klik, nieznana sprawa uczciwie daje null", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji().find((y) => y.allegroId === "dev-issue-1")!;
  const wiadomosci = await D.wiadomosciDyskusji(sprawa.id);
  assert.ok(wiadomosci && wiadomosci.length >= 2);
  assert.equal(wiadomosci![0].odNas, false);

  // sprawa spoza API dyskusji — rejestr działa, rozmowa degraduje do panelu
  db()
    .prepare(
      `INSERT INTO dyskusja(allegro_id, typ, status, widziano_at, utworzono_at)
       VALUES ('obca-sprawa', 'DISCUSSION', 'nowa', ?, ?)`
    )
    .run(dniTemu(0), dniTemu(0));
  const obca = D.listaDyskusji().find((y) => y.allegroId === "obca-sprawa")!;
  assert.equal(await D.wiadomosciDyskusji(obca.id), null);
});

test("zapis odpowiedzi: stempluje prowadzącego i liczy redakcję względem szkicu", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];
  assert.throws(() => D.zapiszOdpowiedzDyskusji(sprawa.id, "   ", "Ala"), /pusta/);

  const szkic = await D.generujSzkicDyskusji(sprawa.id, "Ala");
  assert.ok(szkic.szkicAi && szkic.odpowiedz === szkic.szkicAi);
  assert.equal(szkic.edytowano, false);

  // ta sama treść co szkic → bez redakcji; zmieniona → redakcja
  assert.equal(D.zapiszOdpowiedzDyskusji(sprawa.id, szkic.szkicAi!, "Ola").edytowano, false);
  const po = D.zapiszOdpowiedzDyskusji(sprawa.id, "Dzień dobry, dosyłamy śrubę M6.", "Ola");
  assert.equal(po.edytowano, true);
  assert.equal(po.prowadzi, "Ola", "pisanie odpowiedzi JEST braniem sprawy");
});

test("wysyłka: guardy zamknięcia, pustki i limitu — nic nie leci do Allegro", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji()[0];

  await assert.rejects(D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro"), /napisz odpowiedź/);

  D.zapiszOdpowiedzDyskusji(sprawa.id, "x".repeat(2001), "Biuro");
  await assert.rejects(D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro"), /limit Allegro/);

  D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Biuro");
  await assert.rejects(D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro"), /zamknięta/);

  // sprawa zamknięta PO STRONIE ALLEGRO — nasze zdanie zamiast ich błędu
  const zamknietaAllegro = D.listaDyskusji({ status: "wszystkie" }).find(
    (y) => y.statusAllegro === "CLOSED"
  )!;
  db()
    .prepare("UPDATE dyskusja SET status='w_toku', odpowiedz='Dzień dobry' WHERE id = ?")
    .run(zamknietaAllegro.id);
  await assert.rejects(
    D.wyslijOdpowiedzDyskusji(zamknietaAllegro.id, "Biuro"),
    /Allegro zamknęło/
  );
});

test("wysyłka: happy path — nowa idzie w toku, nadawca zostaje właścicielem", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji().find((y) => y.allegroId === "dev-issue-1")!;
  D.zapiszOdpowiedzDyskusji(sprawa.id, "Dzień dobry, dosyłamy brakującą śrubę.", "Ala");

  const po = await D.wyslijOdpowiedzDyskusji(sprawa.id, "Ala");
  assert.equal(po.status, "w_toku", "wysyłka nie zamyka sprawy — koniec ogłasza Allegro");
  assert.ok(po.wyslanoAt);
  assert.equal(po.odpowiedzial, "Ala");
  assert.equal(po.prowadzi, "Ala", "prowadzi ZOSTAJE — to nadawca czeka teraz na klienta");
  assert.ok(po.szkicAi === null || typeof po.szkicAi === "string", "szkic nie jest czyszczony");

  const zdarzenie = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type='dyskusja_wyslana'")
    .get() as { n: number };
  assert.equal(zdarzenie.n, 1);

  // rozmowa w adapterze dev od razu niesie naszą wiadomość — pełna pętla
  const wiadomosci = await D.wiadomosciDyskusji(sprawa.id);
  const nasza = wiadomosci!.at(-1)!;
  assert.equal(nasza.odNas, true);
  assert.match(nasza.tresc, /śrubę/);
});

test("załącznik: MIME i rozmiar sprawdzane U NAS, wysłany jedzie z wiadomością", async () => {
  await D.synchronizujDyskusje("Biuro");
  const sprawa = D.listaDyskusji().find((y) => y.allegroId === "dev-issue-2")!;
  D.zapiszOdpowiedzDyskusji(sprawa.id, "W załączniku protokół oględzin.", "Biuro");

  await assert.rejects(
    D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro", {
      nazwa: "wirus.exe", mime: "application/x-msdownload", dane: "QUJD",
    }),
    /dozwolone/
  );
  await assert.rejects(
    D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro", {
      nazwa: "za-duze.png", mime: "image/png", dane: "A".repeat(6 * 1024 * 1024),
    }),
    /limit to 4 MB/
  );

  const po = await D.wyslijOdpowiedzDyskusji(sprawa.id, "Biuro", {
    nazwa: "protokol.pdf", mime: "application/pdf",
    dane: "data:application/pdf;base64,JVBERi0xLjQ=",
  });
  assert.ok(po.wyslanoAt);
  const wiadomosci = await D.wiadomosciDyskusji(sprawa.id);
  assert.deepEqual(wiadomosci!.at(-1)!.zalacznik, { nazwa: "protokol.pdf", url: null });
});

test("szkic: kontekst niesie sprawę i zwrot, sprawa zamknięta nie dostaje szkicu", async () => {
  // zwrot powiązany po numerze zamówienia — szkic ma go widzieć w kontekście
  const z = db()
    .prepare(
      `INSERT INTO zwrot(allegro_order_id, waybill, status, utworzono_at, utworzono_przez)
       VALUES ('dev-ord-1', 'DEVWB0001', 'oceniony', ?, 'Test')`
    )
    .run(dniTemu(0));
  db()
    .prepare(
      `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, powod, decyzja)
       VALUES (?, 'Zestaw montażowy', 1, 'Niekompletny', 'reklamacja')`
    )
    .run(Number(z.lastInsertRowid));
  await D.synchronizujDyskusje("Biuro");

  const sprawa = D.listaDyskusji().find((y) => y.allegroId === "dev-issue-1")!;
  const szkic = await D.generujSzkicDyskusji(sprawa.id, "Ala");
  assert.ok(szkic.szkicAi!.length > 0);
  assert.equal(szkic.prowadzi, "Ala");

  D.zmienStatusDyskusji(sprawa.id, "zamknieta", "Ala");
  await assert.rejects(D.generujSzkicDyskusji(sprawa.id, "Ala"), /zamknięta/);
});

/* ── Świeżość przy wysyłce (0.110.0) ───────────────────────────────────────── */

test("wysyłka dyskusji na nieświeżą rozmowę odmawia; wymus i brak punktu odniesienia wysyłają", async () => {
  await D.synchronizujDyskusje("test");
  const sprawa = D.listaDyskusji({}).find((x) => x.typ === "DISCUSSION")!;
  D.zapiszOdpowiedzDyskusji(sprawa.id, "Dzień dobry, odsyłamy środki.", "anna");

  /* Panel widział rozmowę do wiadomości, której w wątku NIE MA na końcu —
     czyli po jego odczycie doszło coś nowego. */
  await assert.rejects(
    () => D.wyslijOdpowiedzDyskusji(sprawa.id, "anna", undefined, {
      ostatniaWidzianaId: "wiadomosc-sprzed-dopisku",
    }),
    (e: unknown) => {
      assert.ok(e instanceof D.BladSwiezosciDyskusji);
      assert.equal((e as InstanceType<typeof D.BladSwiezosciDyskusji>).kod, 409);
      assert.ok(
        (e as InstanceType<typeof D.BladSwiezosciDyskusji>).wiadomosci.length > 0,
        "409 niesie to, czego panel nie pokazał"
      );
      return true;
    }
  );

  /* Bez punktu odniesienia kontroli nie ma (rozmowa bywa niedostępna przez
     API — degradacja 0.104.0), a wymus to świadoma decyzja człowieka. */
  const bez = await D.wyslijOdpowiedzDyskusji(sprawa.id, "anna");
  assert.ok(bez.wyslanoAt, "brak id z panelu nie blokuje wysyłki");
});

/* ── Nieznane statusy Allegro (0.127.0) ──────────────────────────────────────
   Lista statusów końcowych jest [WERYFIKUJ] — mechanizmem weryfikacji jest
   zliczanie wartości spoza znanych list i pokazanie ich biuru. Funkcja jest
   czysta, więc dziwny status fabrykujemy listą, nie adapterem.               */

test("podzielStatusy: wartość spoza list ląduje w nieznanych, znane nie", () => {
  const { statusy, nieznane } = D.podzielStatusy([
    { status: "ONGOING" },
    { status: "ONGOING" },
    { status: "CLOSED" },
    { status: "UNDER_REVIEW" },
    { status: null },
  ]);
  assert.deepEqual(nieznane, ["UNDER_REVIEW"], "znane i (brak) nie są nowością");
  assert.equal(statusy.ONGOING, 2);
  assert.equal(statusy["(brak)"], 1);
});

test("sync niesie nieznane statusy w stanie i loguje je raz na wartość", async () => {
  await D.synchronizujDyskusje("Biuro");
  const stan = D.stanSynchronizacjiDyskusji();
  assert.ok(stan);
  assert.deepEqual(stan.nieznaneStatusy, [], "adapter dev daje wyłącznie znane statusy");
  const zdarzen = db()
    .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'dyskusja_status_nieznany'")
    .get() as { n: number };
  assert.equal(zdarzen.n, 0, "bez nieznanych wartości dziennik milczy");
});

/* ── Metadane wątku przy dyskusjach (0.127.0) ────────────────────────────────
   Odczyt na klik i wysyłka zostawiają w `watek_meta` piłkę bez treści;
   świeżość wysyłki ma odtąd punkt odniesienia po stronie serwera, więc panel
   bez id nie wyłącza już kontroli.                                           */

test("odczyt rozmowy na klik zostawia metadane piłki", async () => {
  const M = await import("./watek-meta.js");
  await D.synchronizujDyskusje("test");
  const sprawa = D.listaDyskusji({}).find((x) => x.typ === "DISCUSSION")!;
  assert.equal(M.metaWatku("dyskusja", sprawa.allegroId), null, "przed odczytem meta nie ma");
  const rozmowa = await D.wiadomosciDyskusji(sprawa.id);
  assert.ok(rozmowa && rozmowa.length > 0);
  const meta = M.metaWatku("dyskusja", sprawa.allegroId);
  assert.ok(meta, "odczyt wypełnia watek_meta");
  assert.equal(meta.zrodlo, "odczyt");
  assert.equal(meta.wiadomosci, rozmowa.length);
  assert.ok(meta.ostatniaKlientId, "id ostatniej wiadomości klienta zapisane");
});

test("stale meta blokuje wysyłkę bez id z panelu; wysyłka stempluje `my`", async () => {
  const M = await import("./watek-meta.js");
  await D.synchronizujDyskusje("test");
  const sprawa = D.listaDyskusji({}).find((x) => x.typ === "DISCUSSION")!;
  D.zapiszOdpowiedzDyskusji(sprawa.id, "Dzień dobry, zwracamy środki.", "anna");

  /* Serwer pamięta id klienta, którego w rozmowie nie ma na końcu — czyli po
     ostatnim odczycie klient dopisał coś nowego. Panel id nie przysłał. */
  db()
    .prepare(
      `INSERT INTO watek_meta (rodzaj, allegro_id, ostatnia_klient_id, zrodlo, aktualizowano_at)
       VALUES ('dyskusja', ?, 'wiadomosc-sprzed-dopisku', 'odczyt', datetime('now'))`
    )
    .run(sprawa.allegroId);
  await assert.rejects(
    () => D.wyslijOdpowiedzDyskusji(sprawa.id, "anna"),
    D.BladSwiezosciDyskusji,
    "meta zastępuje id z panelu jako punkt odniesienia"
  );

  /* Człowiek przeczytał rozmowę (odczyt odświeża meta) i wysyła. */
  await D.wiadomosciDyskusji(sprawa.id);
  const po = await D.wyslijOdpowiedzDyskusji(sprawa.id, "anna");
  assert.ok(po.wyslanoAt);
  const meta = M.metaWatku("dyskusja", sprawa.allegroId);
  assert.equal(meta?.ostatniGlos, "my", "po wysyłce piłka jest u klienta naszym głosem");
  assert.equal(meta?.zrodlo, "wysylka");
  assert.ok(meta?.ostatniaKlientId, "punkt odniesienia klienta przeżywa stempel");
});
