import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../db/db.js";
import {
  KATEGORIE, AKCJE, poprawKlasyfikacje, pomiarCopilota, sklasyfikujRozmowy, wilson,
  type NadawcaKlasyfikacji, type OdpowiedzModelu,
} from "./copilot-klasyfikacja.js";
import {
  BladKluczaCopilota, BladLimituCopilota, BladOdpowiedziCopilota, BladPrzeciazeniaCopilota,
} from "../adapters/copilot.js";

/* ── Klasyfikacja wiadomości (specyfikacja z 20 września 2026) ───────────────
   Testy pilnują pięciu rzeczy, po których poznaje się, że wolno to wypuścić:
   nic osobowego nie wychodzi ŚCIEŻKĄ, automat niczego nie rozstrzyga o sprawie,
   za tę samą treść nie płacimy dwa razy, limit dostawcy zatrzymuje partię bez
   gubienia tego, co zapłacone — i żadna wiadomość nie ginie po cichu: awaria
   i sam załącznik też zostawiają decyzję, która woła człowieka.            */

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

function dopisz(d: DatabaseSync, rozmowaId: number, tresc: string, kierunek = "incoming",
  at = "2026-09-03T09:00:00Z"): number {
  return Number(d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,?,?,?,?)`).run(rozmowaId, `m-${Math.random()}`, kierunek, tresc, at).lastInsertRowid);
}

type Surowa = Record<string, unknown>;
const surowa = (n: Surowa = {}): Surowa => ({
  kategoria: "PRODUCT_COMPATIBILITY", dodatkowe: [], akcja: "CHECK_COMPATIBILITY",
  wymagaCzlowieka: false, prosiOCzlowieka: false,
  brakDanychZamowienia: false, brakDanychProduktu: false,
  pewnosc: "wysoka", powodInne: null, uzasadnienie: "pyta, czy część pasuje", ...n,
});

const odpowiedz = (s: Surowa = {}, n: Partial<OdpowiedzModelu> = {}): OdpowiedzModelu => ({
  surowa: surowa(s), model: "claude-opus-5", promptWersja: "k2", ms: 120,
  zuzycie: { wej: 900, wyj: 200, cacheZapis: 0, cacheOdczyt: 0 }, ...n,
});

const nadawca = (s: Surowa = {}, n: Partial<OdpowiedzModelu> = {}): NadawcaKlasyfikacji =>
  async () => odpowiedz(s, n);

const aktywna = (d: DatabaseSync, rozmowaId: number) => d.prepare(`SELECT * FROM decyzja_klasyfikacji
  WHERE conversation_id=? AND aktywna=1 ORDER BY message_id DESC LIMIT 1`).get(rozmowaId) as any;

test("słownik ma piętnaście kategorii i dwanaście akcji — tyle, ile specyfikacja", () => {
  assert.equal(KATEGORIE.length, 15);
  assert.equal(AKCJE.length, 12);
});

test("ścieżka szczęśliwa: decyzja z wersjami, księga i zdarzenie w jednej transakcji", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy nóż pasuje do NAC LS 46-450?");

  const w = await sklasyfikujRozmowy(d, [id], KTO, nadawca());
  assert.equal(w.sklasyfikowane, 1);
  assert.equal(w.przerwane, null);

  const k = aktywna(d, id);
  assert.equal(k.kategoria, "PRODUCT_COMPATIBILITY");
  assert.equal(k.kategoria_modelu, "PRODUCT_COMPATIBILITY");
  assert.equal(k.kategoria_czlowieka, null, "akceptacja niczego nie jest etykietą człowieka");
  assert.equal(k.akcja, "CHECK_COMPATIBILITY");
  assert.equal(k.zrodlo, "MODEL");
  assert.equal(k.status, "SUCCESS");
  assert.equal(k.wersja, 1);
  assert.equal(k.przez, "A. Lewandowska");
  assert.equal(k.model, "claude-opus-5");
  assert.equal(k.prompt_wersja, "k2");
  assert.equal(k.taksonomia_wersja, "v2");
  assert.equal(k.tryb, "HUMAN_APPROVED");
  assert.ok(k.kontekst_hash, "zapisujemy skrót wejścia — audyt ma wiedzieć, NA CZYM liczono");
  assert.equal(JSON.parse(k.kontekst_wiadomosci).length, 1);

  const ks = d.prepare("SELECT * FROM copilot_wywolanie").get() as any;
  assert.equal(ks.wynik, "ok");
  assert.equal(Number(ks.tokeny_wej), 900);

  const zd = d.prepare("SELECT type FROM events WHERE type='copilot_klasyfikacja'").get();
  assert.ok(zd, "mutacja bez zdarzenia w dzienniku to mutacja bez autora");
});

/* ── Prywatność: bramka na ŚCIEŻCE, nie tylko w funkcji maskującej ─────── */

test("do dostawcy nie idzie e-mail, telefon ani login kupującego — z całego wątku", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Tu zielony_ogrod. Kontakt: jan@example.com albo 601 234 567.");
  dopisz(d, id, "Czy jest nóż?");

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

test("login z wątku jest maskowany także wtedy, gdy temat rozmowy to tytuł oferty", async () => {
  const d = stanowisko();
  d.prepare(`INSERT INTO allegro_inbox_thread(id,read,interlocutor_login,surowe_json,synced_at)
    VALUES ('w-oferta',1,'zielony_ogrod','{}','2026-09-03T08:00:00Z')`).run();
  const id = Number(d.prepare(`INSERT INTO conversation
    (channel_account_id,external_conversation_id,subject) VALUES (1,'w-oferta','Gaźnik Honda GX160')`)
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO message
    (conversation_id,channel_account_id,external_message_id,direction,body,sent_at)
    VALUES (?,1,'m-oferta','incoming','Tu zielony_ogrod, czy pasuje do GX160?','2026-09-03T08:00:00Z')`).run(id);

  let widziane = "";
  await sklasyfikujRozmowy(d, [id], KTO, async (tresc) => { widziane = String(tresc); return odpowiedz(); });
  assert.equal(/zielony_ogrod/i.test(widziane), false, "login z wątku wyszedł poza firmę");
  assert.match(widziane, /GX160/, "temat-tytuł NIE jest maskowany jako login — treść ma przeżyć");
});

/* Specyfikacja wymienia z nazwy „krótkie dopiski". Samo „tak, ten model" nie
   mówi niczego — dopiero pytanie, na które odpowiada. */
test("model dostaje WĄTEK i nagłówek z faktów, a nie samą ostatnią wiadomość", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy gaźnik pasuje do mojej kosiarki?");
  dopisz(d, id, "Jaki to model kosiarki?", "outgoing", "2026-09-03T08:30:00Z");
  dopisz(d, id, "Tak, to ten model", "incoming", "2026-09-03T09:00:00Z");
  d.prepare("UPDATE message SET related_order_id='zam-1' WHERE conversation_id=? AND body LIKE 'Czy%'").run(id);

  let widziane = "";
  await sklasyfikujRozmowy(d, [id], KTO, async (t) => { widziane = String(t); return odpowiedz(); });
  assert.match(widziane, /KLIENT: Czy gaźnik pasuje/);
  assert.match(widziane, /MY: Jaki to model/);
  assert.match(widziane, /KLIENT: Tak, to ten model/);
  assert.match(widziane, /zamówienie powiązane z rozmową: tak/);
  assert.doesNotMatch(widziane, /zam-1/, "numer zamówienia nie jest potrzebny modelowi — idzie sam fakt");

  const k = aktywna(d, id);
  assert.deepEqual(JSON.parse(k.zamowienia), ["zam-1"], "numer zostaje u nas, przy decyzji");
  assert.equal(JSON.parse(k.kontekst_wiadomosci).length, 3);
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

  await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "ORDER_STATUS", akcja: "GET_SHIPMENT" }));

  const po = d.prepare("SELECT status, priorytet, version FROM conversation WHERE id=?").get(id);
  assert.deepEqual(po, przed,
    "podniesiona wersja wywróciłaby komuś szkic na 409 w trakcie pisania");
});

test("prośba o człowieka zamienia akcję na przegląd, a akcja modelu zostaje obok", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Proszę o telefon od kierownika");
  await sklasyfikujRozmowy(d, [id], KTO,
    nadawca({ kategoria: "ORDER_STATUS", akcja: "GET_ORDER", prosiOCzlowieka: true }));
  const k = aktywna(d, id);
  assert.equal(k.akcja, "HUMAN_REVIEW");
  assert.equal(k.akcja_modelu, "GET_ORDER");
  assert.equal(k.wymaga_czlowieka, 1);
  assert.equal(k.status, "SUCCESS", "prośba o człowieka to dobrze rozpoznana sprawa, nie niepewność");
  assert.deepEqual(JSON.parse(k.kody_polityki), ["PROSBA_O_CZLOWIEKA"]);
});

/* ── Niepoprawne odpowiedzi to decyzje FAILED, nie cisza (AC3) ───────────── */

test("kategoria spoza słownika daje decyzję FAILED, a słownik rośnie przez zdarzenie", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Pytanie o coś dziwnego");

  const w = await sklasyfikujRozmowy(d, [id], KTO, nadawca({ kategoria: "gwarancja_rozszerzona" }));

  assert.equal(w.sklasyfikowane, 0);
  assert.equal(w.bledy.length, 1);
  const k = aktywna(d, id);
  assert.equal(k.status, "FAILED");
  assert.equal(k.kategoria, "OTHER", "awaria używa OTHER z jawnym statusem błędu");
  assert.equal(k.akcja, "HUMAN_REVIEW");
  assert.equal(k.kategoria_modelu, null, "model nie powiedział nic ze słownika — nie udajemy, że powiedział");
  assert.match(String(k.surowa_odpowiedz), /gwarancja_rozszerzona/, "surowa odpowiedź zostaje do wglądu");

  const zd = d.prepare("SELECT payload FROM events WHERE type='copilot_klasyfikacja_niepoprawna'")
    .get() as { payload: string } | undefined;
  assert.ok(zd, "brak śladu znaczy, że słownik nigdy nie urośnie");
  assert.match(String(zd!.payload), /gwarancja_rozszerzona/);

  const ks = d.prepare("SELECT wynik FROM copilot_wywolanie").get() as any;
  assert.equal(ks.wynik, "blad", "wywołanie było płatne — ma być w księdze");
});

test("błąd jednej rozmowy nie zabija partii — rozmowa dostaje FAILED, nie znika", async () => {
  const d = stanowisko();
  const a = rozmowa(d, "Pierwsze");
  const b = rozmowa(d, "Drugie");
  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [a, b], KTO, async () => {
    wolane += 1;
    if (wolane === 1) throw new BladOdpowiedziCopilota("Model nie oddał rozstrzygnięcia", 200);
    return odpowiedz();
  });
  assert.equal(w.sklasyfikowane, 1);
  assert.equal(w.bledy.length, 1);
  assert.equal(aktywna(d, a).status, "FAILED");
  assert.deepEqual(JSON.parse(aktywna(d, a).kody_polityki), ["BLAD_MODELU"]);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM copilot_wywolanie WHERE wynik='blad'").get() as any).n, 1);
});

/* Specyfikacja: „do not silently treat an attachment-only message as understood". */
test("sam załącznik nie idzie do dostawcy, ale dostaje decyzję wołającą człowieka", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "");
  const m = Number((d.prepare("SELECT id FROM message WHERE conversation_id=?").get(id) as any).id);
  d.prepare("INSERT INTO message_attachment(message_id,file_name,status) VALUES (?,'foto.jpg','SAFE')").run(m);

  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, [id], KTO, async () => { wolane++; return odpowiedz(); });
  assert.equal(wolane, 0, "zdjęć klasyfikacja nie czyta, więc nie ma za co płacić");
  const k = aktywna(d, id);
  assert.equal(k.zrodlo, "FALLBACK");
  assert.equal(k.status, "NEEDS_REVIEW");
  assert.equal(k.wymaga_czlowieka, 1);
  assert.equal(k.zalacznikow, 1);
  assert.deepEqual(JSON.parse(k.kody_polityki), ["TYLKO_ZALACZNIK"]);
  assert.match(w.pominiete[0].powod, /sam załącznik/);
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

test("decyzja FAILED wraca tylko na jawne ponowienie — jako NOWA wersja", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, async () => { throw new Error("odmowa"); });
  assert.equal(aktywna(d, id).status, "FAILED");

  let wolane = 0;
  await sklasyfikujRozmowy(d, [id], KTO, async () => { wolane++; return odpowiedz(); });
  assert.equal(wolane, 0, "bez jawnego ponowienia awaria nie wraca na koszt firmy");

  await sklasyfikujRozmowy(d, [id], KTO, nadawca(), new Date(), { ponowNieudane: true });
  const k = aktywna(d, id);
  assert.equal(k.status, "SUCCESS");
  assert.equal(k.wersja, 2);
  const wszystkie = d.prepare("SELECT wersja, aktywna FROM decyzja_klasyfikacji WHERE message_id=? ORDER BY wersja")
    .all(k.message_id) as any[];
  assert.deepEqual(wszystkie.map((x) => [x.wersja, x.aktywna]), [[1, 0], [2, 1]],
    "historia zostaje, aktywna jest jedna");
});

test("dopisek klienta dostaje WŁASNĄ decyzję, a stara zostaje przy swojej wiadomości", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());
  dopisz(d, id, "A jednak chcę zwrot");

  const w = await sklasyfikujRozmowy(d, [id], KTO,
    nadawca({ kategoria: "RETURN", akcja: "START_RETURN" }));
  assert.equal(w.sklasyfikowane, 1);
  assert.equal(aktywna(d, id).kategoria, "RETURN");
  const ile = d.prepare("SELECT COUNT(*) n FROM decyzja_klasyfikacji WHERE conversation_id=? AND aktywna=1")
    .get(id) as any;
  assert.equal(ile.n, 2, "decyzja pierwszej wiadomości nie ginie — opisuje TAMTĄ wiadomość");
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

/* ── Limity i błędy dostawcy ───────────────────────────────────────────── */

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
  /* Rozmowa trafiona limitem NIE dostaje decyzji — ma wrócić w następnym
     przebiegu. Decyzja FAILED zdjęłaby ją z taktu na zawsze. */
  assert.equal(aktywna(d, b), undefined);
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

test("przeciążenie dostawcy zatrzymuje partię, zamiast bić w ten sam mur", async () => {
  const d = stanowisko();
  const ids = [rozmowa(d, "a"), rozmowa(d, "b"), rozmowa(d, "c")];

  let wolane = 0;
  const w = await sklasyfikujRozmowy(d, ids, KTO, async () => {
    wolane += 1;
    throw new BladPrzeciazeniaCopilota(
      "Anthropic jest chwilowo przeciążone (529). "
      + "Nic nie zostało policzone ani opłacone — spróbuj za chwilę.",
      529, "overloaded_error 529 req_011Ce");
  });

  assert.equal(wolane, 1, "529 opisuje stan DOSTAWCY, więc druga rozmowa nie ma po co lecieć");
  assert.equal(w.sklasyfikowane, 0);
  assert.match(String(w.przerwane), /przeciążone/);
  assert.equal(w.bledy.length, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM copilot_wywolanie").get() as any).n, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM decyzja_klasyfikacji").get() as any).n, 0,
    "stan dostawcy nie jest decyzją o rozmowie");
});

test("do księgi idzie ślad dostawcy, na ekran zdanie — nie odwrotnie", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "gdzie paczka");

  const w = await sklasyfikujRozmowy(d, [id], KTO, async () => {
    throw new BladPrzeciazeniaCopilota(
      "Anthropic jest chwilowo przeciążone (529).", 529, "overloaded_error 529 req_011Ce");
  });

  const k = d.prepare("SELECT blad FROM copilot_wywolanie").get() as { blad: string };
  assert.match(k.blad, /req_011Ce/, "księga ma nieść identyfikator żądania");
  assert.doesNotMatch(String(w.przerwane), /req_011Ce/);
  assert.doesNotMatch(String(w.przerwane), /[{}]/, "żadnego surowego JSON-a na ekranie");
});

/* ── Poprawka człowieka i pomiar ───────────────────────────────────────── */

test("poprawka to nowa wersja: model zostaje, człowiek dostaje swoje pole", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());

  const r = poprawKlasyfikacje(d, id, "WRONG_PRODUCT", "przyszła inna część", KTO);
  assert.equal(r.kategoria, "WRONG_PRODUCT");
  const k = aktywna(d, id);
  assert.equal(k.kategoria, "WRONG_PRODUCT");
  assert.equal(k.kategoria_czlowieka, "WRONG_PRODUCT");
  assert.equal(k.kategoria_modelu, "PRODUCT_COMPATIBILITY", "zdanie modelu przeżywa poprawkę");
  assert.equal(k.poprawka_powod, "przyszła inna część");
  assert.equal(k.wersja, 2);
  assert.ok(k.poprzednia_id, "wersja wskazuje, co poprawiła");
  assert.ok(d.prepare("SELECT 1 FROM events WHERE type='copilot_korekta'").get());

  assert.throws(() => poprawKlasyfikacje(d, id, "dobor", null, KTO), /Nieznana kategoria/);
});

test("drugie potwierdzenie tego samego niczego nie zapisuje", async () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  await sklasyfikujRozmowy(d, [id], KTO, nadawca());
  poprawKlasyfikacje(d, id, "PRODUCT_COMPATIBILITY", null, KTO);
  const przed = (d.prepare("SELECT COUNT(*) n FROM decyzja_klasyfikacji").get() as any).n;
  poprawKlasyfikacje(d, id, "PRODUCT_COMPATIBILITY", null, KTO);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM decyzja_klasyfikacji").get() as any).n, przed,
    "podwójne kliknięcie nie ma prawa podwoić etykiety w pomiarze");
});

test("poprawka bez rozpoznania odmawia zdaniem", () => {
  const d = stanowisko();
  const id = rozmowa(d, "Czy pasuje?");
  assert.throws(() => poprawKlasyfikacje(d, id, "OTHER", null, KTO), /nie ma jeszcze rozpoznanej/);
});

test("pomiar: precyzja i czułość z przedziałem, a nieoznaczone stoją obok", async () => {
  const d = stanowisko();
  const ids = [rozmowa(d, "a"), rozmowa(d, "b"), rozmowa(d, "c")];
  await sklasyfikujRozmowy(d, ids, KTO, nadawca());
  poprawKlasyfikacje(d, ids[0], "PRODUCT_COMPATIBILITY", null, KTO);
  poprawKlasyfikacje(d, ids[1], "WRONG_PRODUCT", null, KTO);

  const p = pomiarCopilota(d).klasyfikacja;
  assert.equal(p.decyzji, 3);
  assert.equal(p.oznaczonych, 2);
  assert.equal(p.nieoznaczonych, 1);
  assert.equal(p.poprawionych, 1);
  const zgodnosc = p.wgKategorii.find((k) => k.kategoria === "PRODUCT_COMPATIBILITY")!;
  assert.equal(zgodnosc.przewidzianych, 3);
  assert.equal(zgodnosc.precyzja!.k, 1);
  assert.equal(zgodnosc.precyzja!.n, 2);
  assert.equal(zgodnosc.czulosc!.n, 1);
  const zly = p.wgKategorii.find((k) => k.kategoria === "WRONG_PRODUCT")!;
  assert.equal(zly.czulosc!.k, 0, "kategoria, której model nie trafił ani razu, ma czułość zero");
  assert.equal(zly.precyzja, null, "model jej nie przewidział — precyzji nie ma z czego liczyć");
});

test("przedział Wilsona mówi, ile wie mała próbka", () => {
  const w = wilson(3, 3)!;
  assert.equal(w.p, 1);
  assert.ok(w.dolna < 0.5, "trzy trafienia na trzy to nie jest pewność");
  assert.equal(wilson(0, 0), null);
});

test("pomiar liczy udział cache — zero w całej partii znaczy, że prefiks nie działa", async () => {
  const d = stanowisko();
  const a = rozmowa(d, "a");
  const b = rozmowa(d, "b");
  await sklasyfikujRozmowy(d, [a], KTO, nadawca({}, {
    zuzycie: { wej: 1000, wyj: 100, cacheZapis: 800, cacheOdczyt: 0 } }));
  await sklasyfikujRozmowy(d, [b], KTO, nadawca({}, {
    zuzycie: { wej: 200, wyj: 100, cacheZapis: 0, cacheOdczyt: 800 } }));

  const p = pomiarCopilota(d);
  assert.ok(p.udzialCache !== null && p.udzialCache > 0);
  assert.ok(p.kosztUsd > 0, "dwa wywołania nie mogą kosztować zera");
});
