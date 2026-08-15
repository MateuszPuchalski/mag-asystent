import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Sesja rozstrzyga, KTO pracuje. Wejściem jest login i hasło; testy niżej
   pilnują dwóch rzeczy naraz — że poprawna para wpuszcza, a każda niepoprawna
   wygląda tak samo z zewnątrz.

   Blokada po bezczynności została usunięta w sierpniu 2026 razem z ekranem
   „Sesja zablokowana". Sesja trwa do jawnego wylogowania — testy niżej
   pilnują właśnie tego, że bezczynność jej NIE rusza.                        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-auth-")), "t.db");

let db: typeof import("../db/db.js").db;
let A: typeof import("./auth.js");
let U: typeof import("./users.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./auth.js");
  U = await import("./users.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
  db().prepare("DELETE FROM delivery_line").run();
  db().prepare("DELETE FROM delivery").run();
});

/** Cofnięcie ostatniej aktywności sesji — symulacja bezczynności bez czekania. */
function bezczynnaOd(token: string, minut: number) {
  const kiedy = new Date(Date.now() - minut * 60_000).toISOString();
  db().prepare("UPDATE device_session SET last_seen = ? WHERE token = ?").run(kiedy, token);
}

const zdarzenia = (typ: string) =>
  db().prepare("SELECT * FROM events WHERE type = ?").all(typ) as Array<{
    user_id: string;
    user_ref: number | null;
    payload: string | null;
  }>;

/* ── Logowanie ───────────────────────────────────────────────────────────── */

const konto = (imie: string, login: string, rola: import("./users.js").Rola = "magazynier") =>
  U.createUser(imie, rola, login, "tajnehaslo");

test("poprawny login i hasło zakładają sesję i zapisują kto", () => {
  const u = konto("Jan Kowalski", "loguje");
  const s = A.zaloguj("loguje", "tajnehaslo", "KOLEKTOR-1");
  assert.ok(s, "poprawna para loguje");
  assert.equal(s.user.userId, u.userId);
  assert.equal(zdarzenia("login").length, 1);
});

test("złe hasło nie loguje i zostawia ślad bez samego hasła", () => {
  konto("Jan Kowalski", "zlehaslo");
  assert.equal(A.zaloguj("zlehaslo", "inne_haslo", null), null);
  assert.equal(zdarzenia("login").length, 0);
  const ev = zdarzenia("login_failed");
  assert.equal(ev.length, 1, "nieudana próba MUSI być widoczna w audycie");
  assert.equal(ev[0].payload!.includes("inne_haslo"), false, "hasło nie ma prawa tam trafić");
});

test("nieznany login odpada tak samo jak złe hasło", () => {
  // z zewnątrz oba przypadki mają być nie do odróżnienia — inaczej lista kont
  // staje się listą celów
  konto("Jan Kowalski", "nierozroznia");
  assert.equal(A.zaloguj("nieistnieje", "tajnehaslo", null), null);
  assert.equal(A.zaloguj("nierozroznia", "zlehaslo", null), null);
});

test("konto bez hasła nie loguje się, choćby ktoś zgadł login", () => {
  // konto-ślad z migracji historii ma login pusty, ale i tak: brak hasza to
  // odmowa, a nie „wpuść bez hasła"
  U.createUser("Historia", "magazynier", "historia", null);
  assert.equal(A.zaloguj("historia", "", null), null);
  assert.equal(A.zaloguj("historia", "cokolwiek", null), null);
});

test("konto wyłączone nie loguje się, choć hasło jest poprawne", () => {
  const u = konto("Były Pracownik", "bpracownik");
  U.setActive(u.userId, false);
  assert.equal(A.zaloguj("bpracownik", "tajnehaslo", null), null);
});

/* ── Dławienie prób ──────────────────────────────────────────────────────── */

test("po serii błędnych haseł logowanie odmawia przez chwilę", () => {
  // plakietka była przedmiotem — żeby jej użyć, trzeba było ją mieć.
  // Hasło się zgaduje, a serwer stoi w tej samej sieci co kolektory.
  konto("Jan Kowalski", "dlawiony");
  for (let i = 0; i < 5; i++) assert.equal(A.zaloguj("dlawiony", "zle", null), null);
  assert.ok(A.karaLogowania("dlawiony") > 0, "piąta próba zamyka drzwi");
  assert.equal(A.zaloguj("dlawiony", "tajnehaslo", null), null, "nawet z dobrym hasłem");
});

test("blokada dotyczy jednego loginu, nie całego magazynu", () => {
  // inaczej jedno urządzenie z pętlą zatrzymuje pracę wszystkim
  konto("Jan Kowalski", "atakowany");
  konto("Anna Nowak", "pracujaca");
  for (let i = 0; i < 5; i++) A.zaloguj("atakowany", "zle", null);
  assert.ok(A.zaloguj("pracujaca", "tajnehaslo", null), "Anna pracuje dalej");
});

test("udane logowanie kasuje licznik nieudanych prób", () => {
  konto("Jan Kowalski", "licznik");
  for (let i = 0; i < 4; i++) A.zaloguj("licznik", "zle", null);
  assert.ok(A.zaloguj("licznik", "tajnehaslo", null), "czwarta pomyłka jeszcze nie blokuje");
  for (let i = 0; i < 4; i++) A.zaloguj("licznik", "zle", null);
  assert.equal(A.karaLogowania("licznik"), 0, "licznik startuje od nowa");
});

/* ── Zmiana hasła ────────────────────────────────────────────────────────── */

test("zmiana własnego hasła wymaga podania starego", () => {
  // sam token nie wystarcza: kolektor jest współdzielony, a sesja nie wygasa
  const u = konto("Jan Kowalski", "zmieniam");
  assert.ok(A.zmienHaslo(u, "nie_to_haslo", "noweeeee1").error);
  assert.equal(A.zmienHaslo(u, "tajnehaslo", "krotkie").error !== undefined, true, "za krótkie");
  assert.equal(A.zmienHaslo(u, "tajnehaslo", "noweeeee1").error, undefined);
  assert.ok(A.zaloguj("zmieniam", "noweeeee1", null), "nowe hasło działa");
});

/* ── Sesja nie wygasa sama ───────────────────────────────────────────────── */

test("bezczynność NIE rusza sesji, choćby trwała dobę", () => {
  // Regresja na usunięty TTL. Kolektor odłożony na regale na całą przerwę
  // ma wrócić do pracy bez żadnego skanu — blokada po 10 minutach kosztowała
  // ten skan i nie kupowała za to niczego, bo urządzenia nie opuszczają hali.
  const u = konto("Jan Kowalski", "bezczynny");
  const s = A.zaloguj("bezczynny", "tajnehaslo", "KOLEKTOR-1")!;
  bezczynnaOd(s.token, 24 * 60);

  const po = A.sesja(s.token);
  assert.ok(po, "sesja ISTNIEJE dalej");
  assert.equal(po.user.userId, u.userId, "i wie, czyja jest");
});

test("`dotknij` odnotowuje aktywność, ale niczego nie bramkuje", () => {
  // `last_seen` został jako jedyny ślad, kiedy dany kolektor się odezwał.
  // Test pilnuje, że zapis nadal działa — po usunięciu blokady nic innego
  // by tego nie zauważyło.
  konto("Jan Kowalski", "dotykany");
  const s = A.zaloguj("dotykany", "tajnehaslo", null)!;
  bezczynnaOd(s.token, 120);
  A.dotknij(s.token);

  const r = db()
    .prepare("SELECT last_seen FROM device_session WHERE token = ?")
    .get(s.token) as { last_seen: string };
  const minutTemu = (Date.now() - new Date(r.last_seen).getTime()) / 60_000;
  assert.ok(minutTemu < 1, `last_seen odświeżone, a jest sprzed ${minutTemu} min`);
  assert.ok(A.sesja(s.token), "i sesja dalej jest");
});

test("wylogowanie kończy sesję i to jest decyzja człowieka", () => {
  konto("Jan Kowalski", "wylogowany");
  const s = A.zaloguj("wylogowany", "tajnehaslo", null)!;
  A.wyloguj(s.token);
  assert.equal(A.sesja(s.token), null);
});

/* ── Operacje uprzywilejowane ────────────────────────────────────────────── */

test("magazynier nie dostaje operacji uprzywilejowanej, choćby był zalogowany", () => {
  const u = konto("Jan Kowalski", "magazynier1");
  const w = A.autoryzuj(u, "domkniecie_dostawy");
  assert.equal(w.ok, false);
  assert.match(w.powod!, /biura/i, "komunikat mówi, czego brakuje");
});

test("rola rozstrzyga operację uprzywilejowaną i zostawia ślad", () => {
  // PIN wyszedł razem z plakietkami: nie ma już czego pożyczyć bez hasła,
  // więc drugi sekret przestał cokolwiek dowodzić
  const u = konto("Ewa Biuro", "ebiuro1", "biuro");
  assert.equal(A.autoryzuj(u, "domkniecie_dostawy").ok, true);
  assert.equal(A.autoryzuj(u, "zarzadzanie_biurem").ok, false, "konta biura to wyłącznie admin");
  const ev = zdarzenia("privileged");
  assert.equal(ev.length, 1, "nieudana próba nie udaje, że operacja była");
  assert.equal(JSON.parse(ev[0].payload!).operacja, "domkniecie_dostawy");
});

/* ── Zarządzanie kontami: tylko biuro ────────────────────────────────────── */

test("magazynier nie zbliża się do kont", () => {
  // to jest jedyna operacja tworząca TOŻSAMOŚĆ: człowiek z hali, który może
  // założyć konto, może założyć konto biura z własnym hasłem — i cała reszta
  // reguł przestaje cokolwiek znaczyć
  const m = konto("Jan Kowalski", "magazynier2");
  assert.equal(A.autoryzuj(m, "zarzadzanie_kontami").ok, false);
});

test("dostawę zdejmuje z listy biuro — hala nie", () => {
  /* To ORZECZENIE, że pracy nie ma: dostawa znika z listy bez ani jednego
     skanu. Należy do roli, która czyta protokoły rozbieżności i odpowiada za
     zgodność z dokumentem, a nie do człowieka przy palecie. */
  const w = A.autoryzuj(konto("Jan", "magazynier3"), "domkniecie_dostawy");
  assert.equal(w.ok, false);
  assert.match(w.powod!, /biura/i, "komunikat mówi, czyich uprawnień brakuje");
  assert.equal(A.autoryzuj(konto("Ewa Biuro", "ebiuro2", "biuro"), "domkniecie_dostawy").ok, true);
});

test("biuro zarządza kontami i ukrywa magazyny", () => {
  const b = konto("Biuro Zakupy", "biuro", "biuro");
  assert.equal(A.autoryzuj(b, "zarzadzanie_kontami").ok, true);
  assert.equal(A.autoryzuj(b, "widocznosc_magazynow").ok, true);
});

/* ── Drugi stopień: czego biuru nie wolno ────────────────────────────────── */

test("biuro NIE dotyka kont biura ani adminów", () => {
  /* Najważniejsza asercja tej roli. Do 0.24.0 „zarządzanie kontami" było jedną
     operacją, więc biuro zakładało konto biura z własnym hasłem — czyli rola
     strzegąca tożsamości rozdawała ją sama sobie. Rozdzielenie na dwa stopnie
     ma sens wyłącznie wtedy, gdy TEN test jest czerwony po scaleniu ich z
     powrotem. */
  const b = konto("Biuro Zakupy", "biuro", "biuro");
  const w = A.autoryzuj(b, "zarzadzanie_biurem");
  assert.equal(w.ok, false);
  assert.match(w.powod!, /administratora/i, "komunikat mówi, czyich uprawnień brakuje");
});

test("admin może wszystko, co biuro, i jeszcze zarządzanie biurem", () => {
  const a = konto("Właściciel", "wlasciciel", "admin");
  for (const op of ["zarzadzanie_kontami", "widocznosc_magazynow", "domkniecie_dostawy"] as const) {
    assert.equal(A.autoryzuj(a, op).ok, true, op);
  }
  assert.equal(A.autoryzuj(a, "zarzadzanie_biurem").ok, true);
});

test("magazynier nie zbliża się do drugiego stopnia", () => {
  const u = konto("Ktoś z hali", "ktos-magazynier", "magazynier");
  assert.equal(A.autoryzuj(u, "zarzadzanie_biurem").ok, false);
});

test("furtka pierwszego konta zamyka się sama", () => {
  // bez niej nie dałoby się założyć ŻADNEGO konta; z nią otwartą na stałe
  // każdy w sieci magazynu zakładałby sobie konto biura
  assert.equal(U.brakKont(), true, "pusta baza — furtka otwarta");
  konto("Biuro Zakupy", "biuro", "biuro");
  assert.equal(U.brakKont(), false, "jedno konto z loginem i furtka zamknięta");
});

/* ── Autor operacji z bufora offline ─────────────────────────────────────── */

/** Minimalne żądanie — `autorOperacji` czyta wyłącznie nagłówki. */
const zadanie = (h: Record<string, string>) => ({ headers: h }) as never;

test("operacja z bufora zostaje przy SWOIM autorze", async () => {
  // Jan odkłada 12 pozycji poza zasięgiem, oddaje kolektor Piotrowi, wraca
  // Wi-Fi. Bez tego wszystkie 12 dostałoby nazwisko Piotra — czyli ta sama
  // cicha podmiana tożsamości, przed którą broni jawne przejęcie pracy.
  const { autorOperacji } = await import("../context.js");
  const jan = U.createUser("Jan Kowalski");
  const a = autorOperacji(zadanie({ "x-buffered-user": String(jan.userId) }));
  assert.equal(a.nazwa, "Jan Kowalski");
  assert.equal(a.ref, jan.userId);
});

test("nagłówek wskazujący nieistniejące konto NIE jest tożsamością", async () => {
  // inaczej byłby to powrót do „podaj się za kogo chcesz" sprzed §7
  const { autorOperacji } = await import("../context.js");
  const a = autorOperacji(zadanie({ "x-buffered-user": "99999", "x-user": "ktoś" }));
  assert.equal(a.ref, null);
  assert.equal(a.nazwa, "ktoś", "zostaje najwyżej podpowiedź z x-user");
});

test("śmieci w nagłówku nie wywracają ścieżki", async () => {
  const { autorOperacji } = await import("../context.js");
  for (const zly of ["", "abc", "-1", "0", "1.5"]) {
    const a = autorOperacji(zadanie({ "x-buffered-user": zly }));
    assert.equal(a.ref, null, zly);
  }
});
