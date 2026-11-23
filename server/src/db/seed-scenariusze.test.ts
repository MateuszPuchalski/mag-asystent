import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── Seed scenariuszy ────────────────────────────────────────────────────────
   Dane demo psują się inaczej niż kod: nic nie rzuca wyjątkiem, po prostu
   scenariusz przestaje istnieć. Wyjątek bez zdjęcia, kolejka bez wiersza
   w `error`, katalog opisany w dokumentacji, której nikt nie dopisał — każde
   z tego wygląda na ekranie jak „u mnie działa".

   Ten plik pilnuje trzech rzeczy, których oko nie upilnuje:
     • katalog scenariuszy jest OPISANY w `docs/scenariusze-testowe.md`,
     • seed jest idempotentny i nie tyka danych spoza swojego zakresu,
     • pokrycie jest pełne — każdy status kolejki i każdy typ wyjątku ma wiersz.

   To ta sama lekcja, co `tools/docs_check.py`: zgodności dokumentacji z repo
   nie pilnuje komentarz, tylko mechanizm.                                    */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KATALOG_MD = path.resolve(__dirname, "../../../docs/scenariusze-testowe.md");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-scen-")), "t.db");

let S: typeof import("./seed-scenariusze.js");
let db: typeof import("./db.js").db;
let config: typeof import("../config.js").config;

before(async () => {
  S = await import("./seed-scenariusze.js");
  ({ db } = await import("./db.js"));
  ({ config } = await import("../config.js"));
  S.zbudujScenariusze();
});

const liczba = (sql: string, ...args: unknown[]): number =>
  (db().prepare(sql).get(...(args as never[])) as { n: number }).n;

const wartosci = (sql: string): string[] =>
  (db().prepare(sql).all() as Array<Record<string, string>>).map((r) => Object.values(r)[0]);

const wiersze = (sql: string, ...args: unknown[]): Array<Record<string, unknown>> =>
  db().prepare(sql).all(...(args as never[])) as Array<Record<string, unknown>>;

/** Tabele, w których seed zostawia sprawy obsługi klienta — wszystkie, nie próbka. */
const TABELE_OBSLUGI = [
  "channel_account", "offer_snapshot", "conversation", "conversation_event", "message",
  "allegro_inbox_thread", "allegro_inbox_message", "zamowienie_klienta",
  "zamowienie_klienta_pozycja", "zwrot_klienta", "zwrot_klienta_pozycja", "zwrot_zdarzenie",
  "reklamacja_klienta", "reklamacja_wiadomosc", "allegro_reklamacja",
];

const stanObslugi = (): Record<string, number> => Object.fromEntries(
  TABELE_OBSLUGI.map((t) => [t, liczba(`SELECT COUNT(*) AS n FROM ${t}`)]));

const kontoScenariuszy = (): number =>
  (db().prepare("SELECT id FROM channel_account WHERE channel='allegro' AND external_account_id=?")
    .get(S.KONTO_KANALU_SCENARIUSZY) as { id: number }).id;

/** Wiersz bez pól, które z definicji różnią się między dwoma zapisami tej samej sprawy. */
const bez = (w: Record<string, unknown>, ...pola: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(w).filter(([k]) => !pola.includes(k)));

test("identyfikatory scenariuszy są unikalne", () => {
  const id = S.KATALOG.map((s) => s.id);
  assert.equal(new Set(id).size, id.length);
});

test("każdy scenariusz z katalogu jest opisany w dokumentacji", () => {
  const doc = fs.readFileSync(KATALOG_MD, "utf8");
  const brakujace = S.KATALOG.filter((s) => !doc.includes(s.id)).map((s) => s.id);
  assert.deepEqual(brakujace, [], `bez opisu w docs/scenariusze-testowe.md: ${brakujace.join(", ")}`);
});

test("dokumentacja nie opisuje scenariuszy, których seed nie buduje", () => {
  const doc = fs.readFileSync(KATALOG_MD, "utf8");
  const znane = new Set(S.KATALOG.map((s) => s.id));
  // nagłówki pozycji katalogu w dokumentacji: `### S07 — …`
  const opisane = [...doc.matchAll(/^### (S\d{2})\b/gm)].map((m) => m[1]);
  const nadmiarowe = opisane.filter((id) => !znane.has(id));
  assert.deepEqual(nadmiarowe, [], `opisane, ale niebudowane: ${nadmiarowe.join(", ")}`);
});

test("kolejka pokrywa wszystkie statusy workera", () => {
  const statusy = new Set(wartosci("SELECT DISTINCT status FROM sfera_queue"));
  for (const s of ["pending", "processing", "waiting_for_doc", "done", "error"]) {
    assert.ok(statusy.has(s), `brak zadania w statusie ${s}`);
  }
});

test("wyjątki pokrywają pięć kategorii formularza i klucze historyczne", async () => {
  const { PROBLEM_TYPES } = await import("../services/problems.js");
  const typy = new Set(wartosci("SELECT DISTINCT typ FROM problem"));
  for (const t of PROBLEM_TYPES) assert.ok(typy.has(t), `brak wyjątku typu ${t}`);
  for (const t of ["qty_short", "qty_over", "no_space", "unknown_barcode", "ean_conflict"]) {
    assert.ok(typy.has(t), `brak historycznego wyjątku ${t}`);
  }
});

test("linie dostawy pokrywają wszystkie statusy", () => {
  const statusy = new Set(wartosci("SELECT DISTINCT status FROM delivery_line"));
  for (const s of ["todo", "done", "partial", "skipped", "problem"]) {
    assert.ok(statusy.has(s), `brak linii w statusie ${s}`);
  }
});

test("wyjątek z linią zawsze wskazuje linię w statusie `problem`", () => {
  /* Reguła serwisu: zgłoszenie wyjątku ustawia linii status `problem`. Seed,
     który tego nie odwzorowuje, produkuje stan nieosiągalny z aplikacji —
     czyli demo kłamiące o własnych regułach. */
  const zle = liczba(
    `SELECT COUNT(*) AS n FROM problem p JOIN delivery_line l ON l.id = p.line_id
      WHERE l.status <> 'problem'`
  );
  assert.equal(zle, 0);
});

test("zdjęcie dowodowe leży na dysku, a jedna referencja celowo nie ma pliku", async () => {
  const { photoRefOf, photoPath } = await import("../services/problems.js");
  const zFoto = (db().prepare("SELECT id, foto_ref FROM problem WHERE foto_ref IS NOT NULL").all() as Array<{
    id: number;
    foto_ref: string;
  }>);
  assert.ok(zFoto.length >= 2);
  const istnieje = zFoto.filter((p) => photoPath(photoRefOf(p.id)!) !== null);
  assert.ok(istnieje.length >= 1, "żadne zdjęcie nie trafiło na dysk");
  assert.equal(zFoto.length - istnieje.length, 1, "dokładnie jedna referencja ma być bez pliku");
});

test("historia pobrań daje raportowi materiał na cztery listy", () => {
  const wz = liczba("SELECT COUNT(*) AS n FROM sgt_dokument WHERE typ = ?", S.TYP_WZ);
  assert.ok(wz > 0, "brak dokumentów WZ");
  // szybkorotujący poza strefą złotą i martwy indeks w strefie — patrz S63
  const rotujacy = liczba(
    `SELECT COUNT(*) AS n FROM sgt_pozycja p JOIN sgt_dokument d ON d.dok_id = p.dok_id
      WHERE d.typ = ? AND p.tw_id = 900029`,
    S.TYP_WZ
  );
  assert.equal(rotujacy, 40);
  const martwy = liczba(
    `SELECT COUNT(*) AS n FROM sgt_pozycja p JOIN sgt_dokument d ON d.dok_id = p.dok_id
      WHERE d.typ = ? AND p.tw_id = 900028`,
    S.TYP_WZ
  );
  assert.equal(martwy, 0);
});

test("konta scenariuszowe pokrywają wszystkie role i jedno jest wyłączone", async () => {
  const { ROLE } = await import("../services/users.js");
  const role = wartosci("SELECT DISTINCT role FROM app_user WHERE login IS NOT NULL");
  // lista ról jest zamknięta — scenariusze mają pokrywać ją w całości,
  // bo różnice między rolami widać wyłącznie na odmowach
  for (const r of ROLE) assert.ok(role.includes(r), `brak konta o roli ${r}`);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM app_user WHERE active = 0"), 1);
  // konto-ślad: audyt ma na co wskazywać, zalogować się nie da
  assert.ok(liczba("SELECT COUNT(*) AS n FROM app_user WHERE login IS NULL") >= 1);
});

test("dziennik niesie zdarzenia bez konta — materiał do migracji historii", () => {
  assert.ok(liczba("SELECT COUNT(*) AS n FROM events WHERE user_ref IS NULL") >= 3);
});

test("ponowne uruchomienie nie mnoży danych", () => {
  const stan = () => ({
    towary: liczba("SELECT COUNT(*) AS n FROM sgt_towar"),
    dokumenty: liczba("SELECT COUNT(*) AS n FROM sgt_dokument"),
    pozycje: liczba("SELECT COUNT(*) AS n FROM sgt_pozycja"),
    dostawy: liczba("SELECT COUNT(*) AS n FROM delivery"),
    linie: liczba("SELECT COUNT(*) AS n FROM delivery_line"),
    problemy: liczba("SELECT COUNT(*) AS n FROM problem"),
    kolejka: liczba("SELECT COUNT(*) AS n FROM sfera_queue"),
    konta: liczba("SELECT COUNT(*) AS n FROM app_user"),
    sesje: liczba("SELECT COUNT(*) AS n FROM device_session"),
    zdarzenia: liczba("SELECT COUNT(*) AS n FROM events"),
    kolizje: liczba("SELECT COUNT(*) AS n FROM ean_conflict"),
    ...stanObslugi(),
  });
  const przed = stan();
  S.zbudujScenariusze();
  assert.deepEqual(stan(), przed);
});

test("seed nie tyka danych spoza swojego zakresu", () => {
  /* Kartoteka z `npm run seed` numeruje się od 1. Podstawiamy wiersze w tym
     zakresie i sprawdzamy, że drugie uruchomienie zostawia je nietknięte —
     bo seed scenariuszy uruchamia się NA istniejącym demo, nie zamiast niego. */
  const d = db();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_towar(tw_id, symbol, nazwa, ean, unit, opis, lokalizacja) VALUES (7,'W32-0203','Towar z eksportu','','szt.','','A01-02-03')"
  ).run();
  d.prepare(
    "INSERT OR REPLACE INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze) VALUES (7,'FZ','FZ 7/08/2026','2026-08-01',?,'Dostawca z eksportu',0)"
  ).run(config.magId.MAG);
  d.prepare(
    "INSERT INTO app_user(login, haslo_hash, name, role, active, created_at) VALUES ('kierownik','x:y','Kierownik firmy','biuro',1,'2026-01-01T00:00:00.000Z')"
  ).run();
  d.prepare(
    "INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref, created_at) VALUES ('scan',7,NULL,'Kierownik firmy',NULL,NULL,'2026-01-01T00:00:00.000Z')"
  ).run();

  S.zbudujScenariusze();

  assert.equal(liczba("SELECT COUNT(*) AS n FROM sgt_towar WHERE tw_id = 7"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM sgt_dokument WHERE dok_id = 7"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM app_user WHERE login = 'kierownik'"), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM events WHERE user_id = 'Kierownik firmy'"), 1);
});

/* ── Obsługa klienta ─────────────────────────────────────────────────────────
   Sprawy skrzynki, zwrotów i reklamacji mają stać w OKREŚLONEJ kolejce
   i przechodzić OKREŚLONĄ bramkę. O jednym i drugim rozstrzygają serwisy, nie
   kolumny, więc pytamy serwisy. Wiersz, który po zmianie reguły kubełka
   przestał stać w „Do zwrotu", wyglądałby w bazie tak samo jak dziś.

   Druga połowa pilnuje, że stan jest OSIĄGALNY Z APLIKACJI: te same ładunki
   idą przez prawdziwy synchronizator, a praca biura przez prawdziwe serwisy,
   i wynik ma być wierszem z seeda. Sprawa zasiana „na oko" przechodziłaby
   pierwszą połowę i kłamała o tym, co aplikacja umie zapisać.               */

test("rozmowy ze scenariuszy czekają na biuro, nikt ich nie prowadzi, ekran ma ofertę i kartotekę", async () => {
  const { listaRozmow, osRozmowy } = await import("../services/skrzynka.js");
  const lista = listaRozmow();
  for (const s of [S.SPRAWY_OBSLUGI.rozmowaWolna, S.SPRAWY_OBSLUGI.rozmowaDopisek]) {
    const r = lista.find((x) => x.klient === s.login);
    assert.ok(r, `brak rozmowy klienta ${s.login}`);
    assert.equal(r.wlascicielId, null, "rozmowa ma być bez prowadzącego");
    assert.equal(r.status, "waiting_for_us");
    assert.equal(r.ostatniaOdKlienta, true);
    const { os, oferta } = osRozmowy(r.id);
    assert.equal(os.filter((w) => w.rodzaj === "wiadomosc").length, 1);
    assert.ok(oferta?.pobrana, "oferta bez snapshotu stałaby na ekranie gołym numerem");
    assert.ok((oferta.kartoteka.twId ?? 0) >= S.TW_OD, "oferta ma trafiać w kartotekę scenariuszy");
  }
});

test("zwroty stoją w „Do decyzji” i w „Do zwrotu”, a tylko drugi przechodzi bramkę wypłaty", async () => {
  const { listaZwrotow } = await import("../services/zwroty.js");
  const { stanZwrotuPieniedzy } = await import("../services/zwrot-pieniedzy.js");
  const { AUTOMAT } = await import("../services/sygnatury.js");
  const lista = listaZwrotow(db());
  const poNumerze = (numer: string) => {
    const z = lista.find((x) => x.numer === numer);
    assert.ok(z, `brak zwrotu ${numer}`);
    return z;
  };

  const decyzja = poNumerze(S.SPRAWY_OBSLUGI.zwrotDoDecyzji.numer);
  assert.equal(decyzja.kubelek, "decyzja");
  assert.equal(decyzja.werdykt, null);
  assert.ok(decyzja.zamowienie, "zwrot bez zamówienia nie ma kwoty pełnej ani płatności");
  assert.equal(decyzja.pozycje.length, 1);
  const bramkaDecyzji = stanZwrotuPieniedzy(db(), decyzja.id);
  assert.equal(bramkaDecyzji.moznaZwrocic, false);
  // odmówić wypłaty wolno przed werdyktem — to osobna droga, nie wariant zwrotu
  assert.equal(bramkaDecyzji.moznaOdmowic, true);

  const wyplata = poNumerze(S.SPRAWY_OBSLUGI.zwrotDoWyplaty.numer);
  assert.equal(wyplata.kubelek, "zwrot");
  assert.equal(wyplata.pieniadzeCzekaja, true);
  assert.equal(wyplata.kwotaGrosze, 2 * 4996 + 1250 + 1299);
  // kwota ma być kwotą pełną: pozycje i dostawa z zamówienia, co do grosza
  assert.equal(wyplata.kwotaGrosze, wyplata.kwotaPelnaGrosze);
  assert.deepEqual(wyplata.sygnaly.filter((s) => s === "kwota_nieaktualna"), []);
  const bramka = stanZwrotuPieniedzy(db(), wyplata.id);
  assert.equal(bramka.powod, null);
  assert.equal(bramka.moznaZwrocic, true);
  assert.equal(bramka.oddane, null);

  // podpis automatu jest w seedzie przepisany — tu ma swojego strażnika
  assert.deepEqual(
    wartosci(`SELECT DISTINCT p.tw_przez FROM zwrot_klienta_pozycja p
               JOIN zwrot_klienta z ON z.id = p.zwrot_id
              WHERE z.channel_account_id = ${kontoScenariuszy()}`),
    [AUTOMAT]);
});

test("reklamacja stoi w „Do decyzji” z zamówieniem i rozmową", async () => {
  const { listaReklamacji, szczegolReklamacji } = await import("../services/reklamacje.js");
  const r = listaReklamacji(db()).find((x) => x.numer === S.SPRAWY_OBSLUGI.reklamacja.numer);
  assert.ok(r, "reklamacja spadła z kolejki — sprawdź próg REKLAMACJE_OD");
  assert.equal(r.kubelek, "decyzja");
  assert.equal(r.kupionoZrodlo, "zamowienie", "data zakupu ma przyjść z zamówienia, nie ze sprawy");
  const szczegol = szczegolReklamacji(db(), r.id);
  assert.equal(szczegol.czat.length, 1);
  assert.ok(szczegol.zamowienie, "szczegół bez zamówienia nie pokaże, co klient kupił");
});

test("rozmowa z seeda jest tym, co synchronizator zrobiłby z jej ładunku", async () => {
  const { synchronizujAllegroInbox } = await import("../services/allegro-inbox-sync.js");
  const d = db();
  const stanRozmow = () => ({
    rozmowy: wiersze(`SELECT c.* FROM conversation c WHERE c.channel_account_id = ?
      ORDER BY c.external_conversation_id`, kontoScenariuszy())
      .map((w) => bez(w, "id", "created_at")),
    wiadomosci: wiersze(`SELECT m.* FROM message m WHERE m.channel_account_id = ?
      ORDER BY m.external_message_id`, kontoScenariuszy())
      .map((w) => bez(w, "id", "conversation_id", "created_at")),
    zdarzenia: wiersze(`SELECT c.external_conversation_id AS watek, e.event_type, e.payload
      FROM conversation_event e JOIN conversation c ON c.id = e.conversation_id
      WHERE c.channel_account_id = ? ORDER BY watek, e.id`, kontoScenariuszy()),
    /* Struktura wątku przychodzi osobnym odczytem w `beta.v1`, którego ten
       przebieg nie robi, więc jej kolumny nie wchodzą do porównania. */
    watki: wiersze(`SELECT id, read, last_message_at, interlocutor_login, surowe_json
      FROM allegro_inbox_thread WHERE id LIKE 'scenariusz-%' ORDER BY id`),
    surowe: wiersze(`SELECT * FROM allegro_inbox_message
      WHERE thread_id LIKE 'scenariusz-%' ORDER BY id`),
  });
  const zasiane = stanRozmow();
  assert.equal(zasiane.rozmowy.length, 2);

  const watki = zasiane.watki.map((w) => JSON.parse(String(w.surowe_json)) as { id: string });
  const wiadomosci = zasiane.surowe.map((w) => ({
    watek: String(w.thread_id), ladunek: JSON.parse(String(w.surowe_json)) as unknown,
  }));
  /* Sprawy znikają, żeby synchronizator zapisał je OD ZERA. Wątek znany
     i niezmieniony pominąłby bez czytania wiadomości, a wtedy porównanie
     nie sprawdzałoby niczego. */
  d.prepare("DELETE FROM conversation WHERE channel_account_id = ?").run(kontoScenariuszy());
  d.prepare("DELETE FROM allegro_inbox_thread WHERE id LIKE 'scenariusz-%'").run();
  d.prepare("DELETE FROM allegro_inbox_sync_state").run();

  await synchronizujAllegroInbox({
    database: d, accountId: S.KONTO_KANALU_SCENARIUSZY, inboxOd: null,
    struktura: null, listaBeta: false,
    query: async (url) => url.includes("/messages")
      ? {
        messages: wiadomosci.filter((w) => url.includes(`/${encodeURIComponent(w.watek)}/`))
          .map((w) => w.ladunek),
        offset: 0, limit: 20,
      }
      : { threads: watki, offset: 0, limit: 20 },
  });

  assert.deepEqual(stanRozmow(), zasiane);
  S.zbudujScenariusze();
});

test("reklamacja z seeda jest tym, co synchronizator zrobiłby z jej ładunku", async () => {
  const { synchronizujAllegroReklamacje } = await import("../services/allegro-reklamacje-sync.js");
  const d = db();
  const sprawa = S.SPRAWY_OBSLUGI.reklamacja.sprawa;
  const stanSprawy = () => ({
    sprawa: wiersze("SELECT * FROM reklamacja_klienta WHERE external_id = ?", sprawa)
      .map((w) => bez(w, "id", "synced_at")),
    czat: wiersze(`SELECT w.external_id, w.autor_login, w.autor_rola, w.tresc, w.utworzono_at
      FROM reklamacja_wiadomosc w JOIN reklamacja_klienta r ON r.id = w.reklamacja_id
      WHERE r.external_id = ?`, sprawa),
    ladowisko: wiersze("SELECT id, created_at, surowe_json FROM allegro_reklamacja WHERE id = ?", sprawa),
  });
  const zasiane = stanSprawy();
  assert.equal(zasiane.sprawa.length, 1);
  const ladunek = JSON.parse(String(zasiane.ladowisko[0].surowe_json)) as unknown;

  d.prepare(`DELETE FROM reklamacja_wiadomosc WHERE reklamacja_id IN
    (SELECT id FROM reklamacja_klienta WHERE external_id = ?)`).run(sprawa);
  d.prepare("DELETE FROM reklamacja_klienta WHERE external_id = ?").run(sprawa);
  d.prepare("DELETE FROM allegro_reklamacja WHERE id = ?").run(sprawa);

  await synchronizujAllegroReklamacje({
    database: d, accountId: S.KONTO_KANALU_SCENARIUSZY, czatow: 0,
    query: async () => ({ issues: [ladunek] }),
  });

  assert.deepEqual(stanSprawy(), zasiane);
  S.zbudujScenariusze();
});

test("zwrot z „Do zwrotu” jest tym, co zapisałoby pięć ruchów biura w serwisach", async () => {
  const Z = await import("../services/zwroty.js");
  const d = db();
  const numer = S.SPRAWY_OBSLUGI.zwrotDoWyplaty.numer;
  const idZwrotu = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE reference_number = ?")
    .get(numer) as { id: number }).id);
  const stanZwrotu = () => ({
    zwrot: bez(wiersze("SELECT * FROM zwrot_klienta WHERE id = ?", idZwrotu)[0]),
    pozycje: wiersze("SELECT * FROM zwrot_klienta_pozycja WHERE zwrot_id = ? ORDER BY id", idZwrotu),
    os: wiersze(`SELECT rodzaj, tresc, dane_json, kiedy_at, kto, kto_user_id
      FROM zwrot_zdarzenie WHERE zwrot_id = ? ORDER BY kiedy_at, id`, idZwrotu),
  });
  const zasiane = stanZwrotu();
  const z = zasiane.zwrot;
  const biuro = { id: Number(z.werdykt_user_id), name: String(z.werdykt_przez) };
  const kiedy = (pole: unknown) => new Date(String(pole));
  const pozycje = zasiane.pozycje.map((p) => Number(p.id));

  /* Cofamy zwrot do stanu sprzed pracy biura: taki, jaki zostawia
     synchronizacja z powiązaniem kartotek. Wszystko dalej robią serwisy. */
  d.prepare("DELETE FROM zwrot_zdarzenie WHERE zwrot_id = ?").run(idZwrotu);
  d.prepare(`UPDATE zwrot_klienta_pozycja SET ocena=NULL, ocena_at=NULL, ocena_przez=NULL,
    outlet_at=NULL, outlet_przez=NULL, w_zwrocie=0 WHERE zwrot_id = ?`).run(idZwrotu);
  d.prepare(`UPDATE zwrot_klienta SET werdykt=NULL, werdykt_at=NULL, werdykt_przez=NULL,
    werdykt_user_id=NULL, kwota_wariant=NULL, kwota_grosze=NULL, kwota_dostawa_grosze=NULL,
    kwota_at=NULL, kwota_przez=NULL, korekta_numer=NULL, korekta_zrodlo=NULL, zamkniety_at=NULL,
    wersja=1 WHERE id = ?`).run(idZwrotu);

  let wersja = 1;
  wersja = Z.rozstrzygnijZwrot(d, idZwrotu, "przyjety", null, wersja, biuro, kiedy(z.werdykt_at)).wersja;
  for (const [i, pozycjaId] of pozycje.entries()) {
    wersja = Z.ocenPozycje(d, pozycjaId, "outlet", wersja, biuro, kiedy(zasiane.pozycje[i].ocena_at)).wersja;
  }
  for (const [i, pozycjaId] of pozycje.entries()) {
    Z.przeniesionoNaOutlet(d, pozycjaId, biuro, kiedy(zasiane.pozycje[i].outlet_at));
  }
  wersja = Z.zapiszKwote(d, idZwrotu, { pozycjeIds: pozycje, dostawa: true }, wersja, biuro,
    kiedy(z.kwota_at)).wersja;
  Z.zapiszKorekte(d, idZwrotu, String(z.korekta_numer), wersja, biuro, kiedy(z.zamkniety_at));

  assert.deepEqual(stanZwrotu(), zasiane);
  S.zbudujScenariusze();
});

test("praca na sprawach ze scenariuszy nie zatrzymuje ponownego seeda", () => {
  /* Kto przeklika sprawę, zostawia wiersze w tabelach potomnych — część
     z kluczem obcym bez kaskady, część wskazującą konto ze scenariuszy.
     Ponowny seed ma je sprzątnąć razem ze sprawą, a nie stanąć w pół drogi. */
  const d = db();
  const przed = stanObslugi();
  const biuro = Number((d.prepare("SELECT user_id FROM app_user WHERE login = 'biuro.test'")
    .get() as { user_id: number }).user_id);
  const kierownik = Number((d.prepare("SELECT user_id FROM app_user WHERE login = 'kierownik'")
    .get() as { user_id: number }).user_id);
  const rozmowa = Number((d.prepare("SELECT id FROM conversation WHERE external_conversation_id = ?")
    .get(S.SPRAWY_OBSLUGI.rozmowaWolna.watek) as { id: number }).id);
  const wiadomosc = Number((d.prepare("SELECT id FROM message WHERE conversation_id = ?")
    .get(rozmowa) as { id: number }).id);
  const pozycja = Number((d.prepare(`SELECT p.id FROM zwrot_klienta_pozycja p
    JOIN zwrot_klienta z ON z.id = p.zwrot_id WHERE z.reference_number = ?`)
    .get(S.SPRAWY_OBSLUGI.zwrotDoDecyzji.numer) as { id: number }).id);
  const reklamacja = Number((d.prepare("SELECT id FROM reklamacja_klienta WHERE external_id = ?")
    .get(S.SPRAWY_OBSLUGI.reklamacja.sprawa) as { id: number }).id);

  // odpowiedź wysłana: rozmowa ma prowadzącego, wiersz w kolejce wysyłek i szkic Copilota
  d.prepare("UPDATE conversation SET assigned_user_id = ?, version = version + 1 WHERE id = ?")
    .run(biuro, rozmowa);
  d.prepare("INSERT INTO conversation_assignment(conversation_id, assigned_to, assigned_by) VALUES (?,?,?)")
    .run(rozmowa, biuro, biuro);
  d.prepare(`INSERT INTO outbox(conversation_id, idempotency_key, body, expected_version,
    expected_last_message_id, status, created_by) VALUES (?,?,?,?,?,'sent',?)`)
    .run(rozmowa, "snd-test-sprzatania", "Dzień dobry", 1, wiadomosc, biuro);
  d.prepare(`INSERT INTO szkic_copilota(conversation_id, tresc, message_id, model, at, przez,
    przez_user_id) VALUES (?,?,?,?,?,?,?)`)
    .run(rozmowa, "szkic", wiadomosc, "model-testowy", "2026-01-01T00:00:00.000Z",
      "Biuro (scenariusze)", biuro);
  // werdykt reklamacji podpisany kontem ze scenariuszy i wiadomość w jej kolejce
  d.prepare("UPDATE reklamacja_klienta SET werdykt_user_id = ?, prowadzi_user_id = ? WHERE id = ?")
    .run(biuro, biuro, reklamacja);
  d.prepare(`INSERT INTO reklamacja_outbox(reklamacja_id, idempotency_key, body, expected_wersja,
    status, created_by) VALUES (?,?,?,1,'sent',?)`)
    .run(reklamacja, "rkl-test-sprzatania", "Dzień dobry", biuro);
  // pozycja zwrotu w czyimś koszyku — numer pozycji stoi tam bez klucza obcego
  const kosz = Number(d.prepare(`INSERT INTO kosz(kod, status, rodzaj, utworzono_at, utworzono_przez)
    VALUES ('K-TEST-SPRZATANIA','otwarty','zwroty','2026-01-01T00:00:00.000Z','Kierownik firmy')`)
    .run().lastInsertRowid);
  d.prepare(`INSERT INTO kosz_pozycja(kosz_id, tw_id, symbol, nazwa, ilosc, zwrot_pozycja_id)
    VALUES (?,?,?,?,?,?)`).run(kosz, 7, "W32-0203", "Towar z eksportu", 1, pozycja);
  // sprawę klienta ze scenariuszy prowadzi konto SPOZA scenariuszy
  d.prepare(`INSERT INTO klient_prowadzenie(login, prowadzi, prowadzi_user_id, krok, krok_do,
    znane_json, zmieniono_at, zmieniono_przez) VALUES (?,?,?,?,?,?,?,?)`)
    .run(S.SPRAWY_OBSLUGI.zwrotDoDecyzji.login.toUpperCase(), "Kierownik firmy", kierownik,
      "oddzwonić", "2026-12-31T00:00:00.000Z", "{}", "2026-01-01T00:00:00.000Z", "Kierownik firmy");

  assert.doesNotThrow(() => S.zbudujScenariusze());
  assert.deepEqual(stanObslugi(), przed);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM outbox"), 0);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM kosz_pozycja WHERE kosz_id = ?", kosz), 0);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM klient_prowadzenie"), 0);
  // sam koszyk należy do kogo innego i zostaje
  assert.equal(liczba("SELECT COUNT(*) AS n FROM kosz WHERE id = ?", kosz), 1);
  d.prepare("DELETE FROM kosz WHERE id = ?").run(kosz);
});

test("seed nie tyka spraw z innego konta kanału", () => {
  /* Prawdziwe sprawy stoją na koncie z `ALLEGRO_CLIENT_ID`. Kasowanie idzie
     po koncie scenariuszy i po przedrostku lądowiska, więc sąsiad zostaje. */
  const d = db();
  const inne = Number(d.prepare(
    "INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','konto-firmy')"
  ).run().lastInsertRowid);
  d.prepare(`INSERT INTO conversation(channel_account_id, external_conversation_id, subject)
    VALUES (?,?,?)`).run(inne, "0f8c1d2e-watek-firmy", "rozmowa firmy");
  d.prepare(`INSERT INTO allegro_inbox_thread(id, read, surowe_json, synced_at)
    VALUES ('0f8c1d2e-watek-firmy', 0, '{}', '2026-01-01T00:00:00.000Z')`).run();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id, external_id, created_at, synced_at)
    VALUES (?,?,?,?)`).run(inne, "zwrot-firmy", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

  S.zbudujScenariusze();

  assert.equal(liczba("SELECT COUNT(*) AS n FROM conversation WHERE channel_account_id = ?", inne), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM zwrot_klienta WHERE channel_account_id = ?", inne), 1);
  assert.equal(liczba("SELECT COUNT(*) AS n FROM allegro_inbox_thread WHERE id = '0f8c1d2e-watek-firmy'"), 1);

  d.prepare("DELETE FROM conversation WHERE channel_account_id = ?").run(inne);
  d.prepare("DELETE FROM zwrot_klienta WHERE channel_account_id = ?").run(inne);
  d.prepare("DELETE FROM allegro_inbox_thread WHERE id = '0f8c1d2e-watek-firmy'").run();
  d.prepare("DELETE FROM channel_account WHERE id = ?").run(inne);
});

test("na bazie ze sparowanym kontem Allegro seed nie zakłada spraw obsługi klienta", () => {
  /* Takty ofert i zamówień wybierają pracę z całej bazy, więc zmyślone numery
     poszłyby do prawdziwego Allegro. Token jest tu jedynym sygnałem, że takie
     Allegro w ogóle jest — bez niego żadne żądanie nie wyjdzie. */
  const d = db();
  d.prepare(`INSERT INTO allegro_token(id, access_token, refresh_token, wygasa_at, srodowisko,
    polaczono_at, polaczono_przez) VALUES (1,'a','r','2099-01-01T00:00:00.000Z','prod',
    '2026-01-01T00:00:00.000Z','test')`).run();
  try {
    const licz = S.zbudujScenariusze();
    assert.deepEqual([licz.rozmowy, licz.zwroty, licz.reklamacje], [0, 0, 0]);
    // sprawy sprzed parowania schodzą — kasowanie własnych wierszy nie zależy od tokena
    assert.equal(liczba("SELECT COUNT(*) AS n FROM conversation"), 0);
    assert.equal(liczba("SELECT COUNT(*) AS n FROM zwrot_klienta"), 0);
    assert.equal(liczba("SELECT COUNT(*) AS n FROM reklamacja_klienta"), 0);
    // i sam token zostaje nietknięty
    assert.equal(liczba("SELECT COUNT(*) AS n FROM allegro_token"), 1);
  } finally {
    d.prepare("DELETE FROM allegro_token").run();
  }
  const licz = S.zbudujScenariusze();
  assert.deepEqual([licz.rozmowy, licz.zwroty, licz.reklamacje], [2, 2, 1]);
});

test("na bazie podpiętej do Subiekta seed odmawia startu", () => {
  /* Konta ze znanym hasłem i gotowe tokeny sesji są tym, czego na produkcji
     robić nie wolno. Odmowa jest tu jedynym zabezpieczeniem, bo `npm run
     seed:scenariusze` wygląda równie niewinnie jak `npm run seed`. */
  const tryb = config.sgtMode;
  try {
    (config as { sgtMode: string }).sgtMode = "mssql";
    assert.throws(() => S.zbudujScenariusze(), /SGT_MODE=mssql/);
  } finally {
    (config as { sgtMode: string }).sgtMode = tryb;
  }
});
