import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import {
  KATEGORIE, ocenKlasyfikacje, pomiarCopilota, sklasyfikujRozmowy,
  type NadawcaKlasyfikacji, type OdpowiedzModelu,
} from "./copilot-klasyfikacja.js";
import { BladKluczaCopilota, BladLimituCopilota } from "../adapters/copilot.js";

/* ── Copilot: klasyfikacja wiadomości (§14, etap F) ──────────────────────────
   Testy pilnują czterech rzeczy, po których poznaje się, że wolno to wypuścić:
   nic osobowego nie wychodzi ŚCIEŻKĄ (nie tylko z funkcji maskującej), automat
   niczego nie rozstrzyga, za tę samą treść nie płacimy dwa razy, a limit
   dostawcy zatrzymuje partię bez gubienia tego, co już zapłacone.            */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const KTO = { id: 1, name: "A. Lewandowska" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  return d;
}

/** Rozmowa z jedną wiadomością klienta. Zwraca jej identyfikator. */
function rozmowa(d: DatabaseSync, tresc: string, login = "zielony_ogrod"): number {
  const id = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,?,?)`)
    .run(`w-${Math.random()}`, login).lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,?,'incoming',?,'2026-09-03T08:00:00Z')`)
    .run(id, `m-${Math.random()}`, tresc);
  return id;
}

const odpowiedz = (n: Partial<OdpowiedzModelu> = {}): OdpowiedzModelu => ({
  kategoria: "dobor", pewnosc: "wysoka", uzasadnienie: "pyta, czy część pasuje",
  model: "claude-opus-5", ms: 120,
  zuzycie: { wej: 900, wyj: 200, cacheZapis: 0, cacheOdczyt: 0 }, ...n,
});

const nadawca = (odp: Partial<OdpowiedzModelu> = {}): NadawcaKlasyfikacji =>
  async () => odpowiedz(odp);

test("ścieżka szczęśliwa: wiersz, księga wywołań i zdarzenie w jednej transakcji", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy nóż pasuje do NAC LS 46-450?");

  const w = await sklasyfikujRozmowy(d, [id], KTO, nadawca());
  assert.equal(w.sklasyfikowane, 1);
  assert.equal(w.przerwane, null);

  const k = d.prepare("SELECT * FROM klasyfikacja_rozmowy WHERE conversation_id=?").get(id) as any;
  assert.equal(k.kategoria, "dobor");
  assert.equal(k.przez, "A. Lewandowska");
  assert.equal(k.model, "claude-opus-5");
  assert.ok(k.message_id, "zapisujemy, NA CZYM liczono");

  const ks = d.prepare("SELECT * FROM copilot_wywolanie").get() as any;
  assert.equal(ks.wynik, "ok");
  assert.equal(Number(ks.tokeny_wej), 900);

  const zd = d.prepare("SELECT type FROM events WHERE type='copilot_klasyfikacja'").get();
  assert.ok(zd, "mutacja bez zdarzenia w dzienniku to mutacja bez autora");
});

/* ── Prywatność: bramka na ŚCIEŻCE, nie tylko w funkcji maskującej ─────── */

test("do dostawcy nie idzie e-mail, telefon ani login kupującego", async () => {
  const d = stanowisko();
  const id = rozmowa(d,
    "Tu zielony_ogrod. Kontakt: jan@example.com albo 601 234 567. Czy jest nóż?",
    "zielony_ogrod");

  let widziane = "";
  await sklasyfikujRozmowy(d, [id], KTO, async (tresc) => {
    widziane = String(tresc);
    return odpowiedz();
  });

  assert.equal(widziane.includes("jan@example.com"), false, "e-mail wyszedł poza firmę");
  assert.equal(widziane.includes("601"), false, "telefon wyszedł poza firmę");
  assert.equal(/zielony_ogrod/i.test(widziane), false, "login wyszedł poza firmę");
  assert.match(widziane, /Czy jest nóż/, "treść pytania ma przeżyć — bez niej nie ma czego klasyfikować");
});

test("ładunek dziennika niesie identyfikatory, nigdy treści wiadomości", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Sekret: przesyłka miała numer 601 234 567");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());

  const p = String((d.prepare("SELECT payload FROM events WHERE type='copilot_klasyfikacja'")
    .get() as { payload: string }).payload);
  assert.equal(p.includes("Sekret"), false, "treść wiadomości w dzienniku (§19)");
  assert.match(p, /conversationId/);
});

/* ── Automat nie decyduje ──────────────────────────────────────────────── */

test("klasyfikacja nie rusza statusu, priorytetu ani wersji rozmowy", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Kiedy wyślecie paczkę?");
  const przed = d.prepare("SELECT status, priorytet, version FROM conversation WHERE id=?").get(id);

  await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "wysylka" }));

  const po = d.prepare("SELECT status, priorytet, version FROM conversation WHERE id=?").get(id);
  assert.deepEqual(po, przed,
    "podniesiona wersja wywróciłaby komuś szkic na 409 w trakcie pisania");
});

test("kategoria spoza słownika nie zakłada nowej wartości", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Pytanie o coś dziwnego");

  const w = await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "gwarancja_rozszerzona" }));

  assert.equal(w.sklasyfikowane, 0);
  assert.equal(w.bledy.length, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM klasyfikacja_rozmowy").get() as any).n, 0);

  /* Zdarzenie z odrzuconą wartością jest GŁÓWNYM mechanizmem wzrostu słownika
     — dla niego kolumna nie ma CHECK-a. */
  const zd = d.prepare("SELECT payload FROM events WHERE type='copilot_kategoria_spoza_slownika'")
    .get() as { payload: string } | undefined;
  assert.ok(zd, "brak śladu znaczy, że słownik nigdy nie urośnie");
  assert.match(String(zd!.payload), /gwarancja_rozszerzona/);

  /* Wywołanie było płatne — ma być w księdze mimo braku klasyfikacji. */
  const ks = d.prepare("SELECT wynik FROM copilot_wywolanie").get() as any;
  assert.equal(ks.wynik, "blad");
  assert.equal(KATEGORIE.length, 8);
});

test("pewność spoza listy schodzi do „niska”, zamiast wywracać zapis", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy macie ten model?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca({ pewnosc: "bardzo wysoka" }));
  const k = d.prepare("SELECT pewnosc FROM klasyfikacja_rozmowy WHERE conversation_id=?").get(id) as any;
  assert.equal(k.pewnosc, "niska");
});

/* ── Nie płacimy dwa razy za tę samą treść ─────────────────────────────── */

test("rozmowa rozpoznana na tej samej wiadomości jest pomijana bez wyjścia w sieć", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());

  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [id], KTO, async () => { wolane += 1; return odpowiedz(); });
  assert.equal(wolane, 0, "druga płatność za tę samą treść");
  assert.equal(w.pominiete.length, 1);
  assert.match(w.pominiete[0].powod, /już rozpoznana/);
});

test("dopisek klienta czyni etykietę nieaktualną i rozmowa wraca do partii", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "dobor" }));

  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,'m-nowa','incoming','A jednak chcę zwrot','2026-09-03T09:00:00Z')`).run(id);

  const w = await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "zwrot" }));
  assert.equal(w.sklasyfikowane, 1);
  const k = d.prepare("SELECT kategoria FROM klasyfikacja_rozmowy WHERE conversation_id=?").get(id) as any;
  assert.equal(k.kategoria, "zwrot", "nowa treść ma nadpisać starą etykietę");
});

test("rozmowa bez wiadomości klienta jest pomijana, nie wysyłana", async () => {
  const d = stanowisko();
  const id = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,'pusta','klient')`)
    .run().lastInsertRowid);
  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [id], KTO, async () => { wolane += 1; return odpowiedz(); });
  assert.equal(wolane, 0);
  assert.match(w.pominiete[0].powod, /brak wiadomości/);
});

/* ── Limity i błędy ────────────────────────────────────────────────────── */

test("limit dostawcy zatrzymuje partię, ale nie kasuje tego, co zapłacone", async () => {
  const d = stanowisko();
  const a = rozmowa(d, "Pierwsze pytanie");
  const b = rozmowa(d, "Drugie pytanie");
  const c = rozmowa(d, "Trzecie pytanie");

  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [a, b, c], KTO, async () => {
    wolane += 1;
    if (wolane === 2) throw new BladLimituCopilota("429", 120_000);
    return odpowiedz();
  });

  assert.equal(w.sklasyfikowane, 1, "pierwsza rozmowa była zapłacona i ma zostać");
  assert.equal(wolane, 2, "po limicie nie ponawiamy i nie lecimy dalej");
  assert.match(String(w.przerwane), /przerwę/);
  assert.match(String(w.przerwane), /2 min/);
});

test("zły klucz zatrzymuje partię natychmiast", async () => {
  const d = stanowisko();
  const ids = [rozmowa(d, "a"), rozmowa(d, "b"), rozmowa(d, "c")];
  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, ids, KTO, async () => {
    wolane += 1;
    throw new BladKluczaCopilota("Klucz odrzucony — sprawdź ANTHROPIC_API_KEY");
  });
  assert.equal(wolane, 1, "dwadzieścia prób z tym samym złym kluczem to dwadzieścia śladów w logu");
  assert.match(String(w.przerwane), /Klucz odrzucony/);
});

test("błąd jednej rozmowy nie zabija partii i ląduje w księdze", async () => {
  const d = stanowisko();
  const a = rozmowa(d, "Pierwsze");
  const b = rozmowa(d, "Drugie");
  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [a, b], KTO, async () => {
    wolane += 1;
    if (wolane === 1) throw new Error("timeout");
    return odpowiedz();
  });
  assert.equal(w.sklasyfikowane, 1);
  assert.equal(w.bledy.length, 1);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM copilot_wywolanie WHERE wynik='blad'").get() as any).n, 1);
});

/* ── Ocena i pomiar ────────────────────────────────────────────────────── */

test("ocena zapisuje autora i czas, a wartość spoza dwóch jest odrzucana", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());

  ocenKlasyfikacje(d, id, "nietrafna", KTO);
  const k = d.prepare("SELECT ocena, ocenil_user_id FROM klasyfikacja_rozmowy WHERE conversation_id=?")
    .get(id) as any;
  assert.equal(k.ocena, "nietrafna");
  assert.equal(Number(k.ocenil_user_id), 1);

  assert.throws(() => ocenKlasyfikacje(d, id, "moze", KTO), /trafna/);
});

test("ponowne rozpoznanie kasuje starą ocenę — dotyczyła innej propozycji", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());
  ocenKlasyfikacje(d, id, "trafna", KTO);

  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,'m-2','incoming','Zmieniam zdanie, chcę zwrot','2026-09-03T10:00:00Z')`).run(id);
  await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "zwrot" }));

  const k = d.prepare("SELECT ocena FROM klasyfikacja_rozmowy WHERE conversation_id=?").get(id) as any;
  assert.equal(k.ocena, null);
});

test("pomiar podaje NIEOCENIONE, żeby „100 % trafności” z dwóch ocen nie kłamało", async () => {
  const d = stanowisko();
  const ids = [rozmowa(d, "a"), rozmowa(d, "b"), rozmowa(d, "c")];
  await sklasyfikujRozmowy(d, ids, KTO, nadawca());
  ocenKlasyfikacje(d, ids[0], "trafna", KTO);

  const p = pomiarCopilota(d);
  assert.equal(p.wywolan, 3);
  assert.equal(p.ocen, 1);
  assert.equal(p.trafnych, 1);
  assert.equal(p.nieocenionych, 2);
  assert.ok(p.kosztUsd > 0, "trzy wywołania nie mogą kosztować zera");
  assert.equal(p.wgKategorii[0].kategoria, "dobor");
});

test("pomiar liczy udział cache — zero w całej partii znaczy, że prefiks nie działa", async () => {
  const d = stanowisko();
  const a = rozmowa(d, "a");
  const b = rozmowa(d, "b");
  await sklasyfikujRozmowy(d, [a], KTO, nadawca({
    zuzycie: { wej: 1000, wyj: 100, cacheZapis: 800, cacheOdczyt: 0 } }));
  await sklasyfikujRozmowy(d, [b], KTO, nadawca({
    zuzycie: { wej: 200, wyj: 100, cacheZapis: 0, cacheOdczyt: 800 } }));

  const p = pomiarCopilota(d);
  assert.ok(p.udzialCache !== null && p.udzialCache > 0,
    "bez tej liczby nie da się z danych powiedzieć, czy cache w ogóle się włączył");
});
