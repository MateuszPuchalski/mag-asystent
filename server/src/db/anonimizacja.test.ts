import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { migrate } from "./db.js";

/* ── ANONIMIZACJA KOPII BAZY (0.550.2) ──────────────────────────────────────
   Narzędzie `tools/anonimizuj-baze.mjs` ma jedno zadanie, którego pomyłka
   kosztuje najwięcej: dane klientów nie mogą wyjść z biura. Testy pilnują
   trzech rzeczy.

   1. NIC NIE WYCIEKA. Sprawdzamy to osobnym skanem w teście, a nie skanerem
      narzędzia. Skaner, który sam siebie sprawdza, myli się razem z sobą.
   2. KSZTAŁT ZOSTAJE. Ten sam login ma ten sam zamiennik w każdej tabeli,
      słowniki i identyfikatory stoją, JSON dalej jest JSON-em. Bez tego plik
      bezpieczny, ale bezużyteczny do oceny ekranów.
   3. DOMYŚLNIE ODMOWA. Nowa kolumna tekstowa jest rozsypana. */

// @ts-ignore - moduł .mjs poza `server/`, bez deklaracji typów
const narzedzie: any = await import(pathToFileURL(path.resolve(import.meta.dirname, "../../../tools/anonimizuj-baze.mjs")).href);
const { anonimizuj, regulaKolumny, R, skanujWycieki, Igly, TABELE_DO_OPROZNIENIA } = narzedzie;

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

const UUID_ZAM = "4e3b1f20-1111-4222-8333-000000000001";
const UUID_ZAM2 = "4e3b1f20-1111-4222-8333-000000000002";

/** Wstawia wiersz, dopełniając kolumny NOT NULL bez wartości domyślnej neutralną wartością. */
function wstaw(d: DatabaseSync, tabela: string, wartosci: Record<string, unknown>) {
  const kolumny = d.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
  const pelne: Record<string, unknown> = { ...wartosci };
  for (const k of kolumny) {
    if (k.name in pelne || k.pk === 1 && /INT/i.test(k.type)) continue;
    if (k.notnull && k.dflt_value === null) pelne[k.name] = /INT|REAL|NUM/i.test(k.type) ? 0 : "";
  }
  const nazwy = Object.keys(pelne);
  try {
    d.prepare(`INSERT INTO ${tabela} (${nazwy.join(",")}) VALUES (${nazwy.map(() => "?").join(",")})`)
      .run(...(nazwy.map((n) => pelne[n]) as never[]));
  } catch (e) {
    throw new Error(`fikstura, tabela ${tabela}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Baza z rozpoznawalnymi danymi osobowymi we wszystkich rodzajach kolumn. */
function zbudujBaze(sciezka: string) {
  const d = new DatabaseSync(sciezka);
  d.exec(schema);
  migrate(d);
  /* Fikcyjne dane nie muszą spełniać kluczy obcych. Narzędzie i tak pracuje
     na kopii z wyłączonymi kluczami. */
  d.exec("PRAGMA foreign_keys = OFF");
  wstaw(d, "app_user", { login: "a.lewandowska", haslo_hash: "scrypt$sol$hash0123456789abcdef", name: "Anna Lewandowska", role: "biuro", created_at: "2026-09-01T08:00:00.000Z" });
  wstaw(d, "channel_account", { channel: "allegro", external_account_id: "48151623", display_name: "Sklep Wertis" });
  wstaw(d, "firma", { id: 1, nazwa: "Wertis Ogrodnictwo sp. z o.o.", nip: "5252525252", adres: "ul. Fabryczna 7", miejscowosc: "Poznań", osoba: "Marek Wertis", telefon: "618765432", zmieniono_przez: "Marek Wertis" });
  wstaw(d, "allegro_token", { access_token: "AAAA-secret-access-token-0123456789", refresh_token: "RRRR-secret-refresh-token-9876543210", scope: "allegro:api:sale", srodowisko: "prod", polaczono_przez: "Marek Wertis" });
  wstaw(d, "device_session", { token: "sesja-kolektora-0123456789abcdef", device_id: "kolektor-1" });

  wstaw(d, "allegro_inbox_thread", { id: "th-1", interlocutor_login: "ogrodnik_77", last_message_at: "2026-09-20T10:00:00.000Z", surowe_json: JSON.stringify({ interlocutor: { login: "ogrodnik_77", email: "jan.kowalczyk@example.com" }, orderId: UUID_ZAM }), synced_at: "2026-09-20T10:01:00.000Z", watek_zamowienia: UUID_ZAM });
  wstaw(d, "allegro_inbox_message", { id: "m-1", thread_id: "th-1", author_login: "ogrodnik_77", text: `Dzień dobry, kosiarka z zamówienia ${UUID_ZAM} nie chce zapalić.\nProszę o kontakt: jan.kowalczyk@example.com albo 602-111-222.`, subject: "Kosiarka nie pali", status: "READ", created_at: "2026-09-20T10:00:00.000Z", related_object_type: "ORDER", related_object_id: UUID_ZAM, surowe_json: "{}" });
  wstaw(d, "allegro_inbox_message", { id: "m-2", thread_id: "th-1", author_login: "Sklep_Wertis", text: "Dzień dobry, prosimy o zdjęcie tabliczki znamionowej.", subject: "Re: Kosiarka nie pali", status: "READ", created_at: "2026-09-20T11:00:00.000Z", surowe_json: "{}" });

  wstaw(d, "zamowienie_klienta", { external_id: UUID_ZAM, status: "READY_FOR_PROCESSING", kupujacy_login: "ogrodnik_77", odbiorca_nazwa: "Jan Kowalczyk", odbiorca_telefon: "+48 501 234 567", odbiorca_telefon_cyfry: "48501234567", odbiorca_ulica: "ul. Lipowa 12/4", odbiorca_miasto: "Wrocław", odbiorca_kod: "50-123", dostawa_metoda: "Kurier", platnosc_typ: "ONLINE", waluta: "PLN", kupiono_at: "2026-09-18T09:00:00.000Z", przesylka_waybill: "620123456789", przesylka_przewoznik: "DPD" });
  wstaw(d, "zamowienie_klienta", { external_id: UUID_ZAM2, status: "SENT", kupujacy_login: "Dzialkowiec_PL", odbiorca_nazwa: "Ewa Zielińska-Wróbel", odbiorca_telefon: "600 700 800", odbiorca_telefon_cyfry: "600700800", odbiorca_ulica: "Polna 3", odbiorca_miasto: "Gdańsk", odbiorca_kod: "80-001", dostawa_metoda: "Paczkomat", platnosc_typ: "ONLINE", waluta: "PLN", kupiono_at: "2026-09-19T09:00:00.000Z" });
  wstaw(d, "zamowienie_klienta_pozycja", { external_id: UUID_ZAM, offer_id: "9876543210", nazwa: "Nóż do kosiarki NAC LS 46", sku: "NOZ-LS46", waluta: "PLN" });

  wstaw(d, "reklamacja_klienta", { external_id: "rk-1", reference_number: "RK-OKNA-1", order_id: UUID_ZAM, kupujacy_login: "dzialkowiec_pl", powod_opis: "Silnik traci moc po dziesięciu minutach", opis: "Dzwoniłem do Państwa, pan Zbigniew nic nie wiedział", prowadzi: "Anna Lewandowska", notatka: "Klient nerwowy, oddzwonić do 602111222", notatka_przez: "Anna Lewandowska", zwrot_towaru: "wymagany", status_allegro: "OPEN" });
  wstaw(d, "reklamacja_wiadomosc", { external_id: "rw-1", autor_login: "dzialkowiec_pl", autor_rola: "BUYER", tresc: "Mój numer to 700-800-900, proszę dzwonić po 16.", utworzono_at: "2026-09-20T12:00:00.000Z" });
  wstaw(d, "klient_notatka", { login: "ogrodnik_77", tresc: "Stały klient, lubi rozmawiać z Anną", przez: "Anna Lewandowska", at: "2026-09-21T08:00:00.000Z" });
  wstaw(d, "klient_prowadzenie", { login: "dzialkowiec_pl", prowadzi: "Anna Lewandowska", krok: "Zadzwonić w środę", znane_json: JSON.stringify({ maszyny: ["Honda HRX 537"], uwaga: "ma psa" }) });
  wstaw(d, "zwrot_klienta", { external_id: "zw-1", order_id: UUID_ZAM, kupujacy_login: "ogrodnik_77", odbiorca_nazwa: "Jan Kowalczyk", przewoznik: "InPost", waybill: "605500000123", rejection_code: "NOT_AS_DESCRIBED", notatka: "Zwrot na konto w mBanku", prowadzi: "Anna Lewandowska", status_allegro: "DELIVERED" });
  wstaw(d, "outbox", { conversation_id: 0, idempotency_key: "k-1", body: "Dzień dobry, odsyłamy nóż na adres ul. Lipowa 12/4.", status: "sent", szkic_los: "bez_zmian" });

  /* `events.user_id` to TEXT z NAZWĄ pracownika, mimo nazwy. Zwykła kopia z żywego
     serwera miała tam „Jan Kowalski”, a reguła „_id to identyfikator” ją zostawiała.
     Znalazł to skaner na prawdziwej kopii, nie przegląd kolumn. */
  wstaw(d, "events", { type: "reklamacja.notatka", payload: JSON.stringify({ login: "dzialkowiec_pl", orderId: UUID_ZAM, kwota: 12900, note: "Proszę o fakturę na firmę Kowalczyk", ok: true }), user_id: "Anna Lewandowska", created_at: "2026-09-21T09:00:00.000Z" });
  wstaw(d, "events", { type: "kopia.nocna", payload: "{}", user_id: "system", created_at: "2026-09-21T03:00:00.000Z" });
  wstaw(d, "events", { type: "zamowienie.podglad", payload: "{}", user_id: "anonim", created_at: "2026-09-21T03:01:00.000Z" });
  wstaw(d, "sgt_towar", { symbol: "NOZ-LS46", nazwa: "Nóż do kosiarki NAC LS 46 mm", ean: "5901234567890", unit: "szt", lokalizacja: "A-03-2" });
  wstaw(d, "zdjecie_wlasne", { obraz: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), mime: "image/webp", dodane_by: "Anna Lewandowska" });
  d.close();
}

/** Wszystkie wartości tekstowe pliku jako jeden ciąg, do niezależnego skanu w teście. */
function wszystkieTeksty(sciezka: string): string {
  const d = new DatabaseSync(sciezka);
  const kawalki: string[] = [];
  const tabele = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'towar_fts%' AND sql NOT LIKE 'CREATE VIRTUAL%'").all() as Array<{ name: string }>;
  for (const { name } of tabele) {
    for (const w of d.prepare(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>) {
      for (const v of Object.values(w)) if (typeof v === "string") kawalki.push(v);
    }
  }
  d.close();
  return kawalki.join("\n").toLowerCase();
}

function wKatalogu<T>(fn: (katalog: string) => T): T {
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "anonim-"));
  try { return fn(katalog); } finally { fs.rmSync(katalog, { recursive: true, force: true }); }
}

const skrot = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const WRAZLIWE = [
  "ogrodnik_77", "dzialkowiec_pl", "kowalczyk", "501 234 567", "501234567", "600 700 800", "602-111-222", "602111222",
  "700-800-900", "lipowa", "wrocław", "polna 3", "gdańsk", "jan.kowalczyk", "example.com", "lewandowska", "zielińska",
  "wróbel", "sklep_wertis", "secret-access", "secret-refresh", "sesja-kolektora", "hash0123", "5252525252", "fabryczna",
  "poznań", "marek wertis", "zbigniew", "mbanku", "tabliczki", "kosiarka nie pali",
];

test("żadna rozpoznawalna dana osobowa nie przeżywa, sprawdzone niezależnym skanem", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    const raport = anonimizuj(we, wy, { ziarno: "test" });
    assert.deepEqual(raport.skaner, []);
    const tekst = wszystkieTeksty(wy);
    const przezyly = WRAZLIWE.filter((w) => tekst.includes(w.toLowerCase()));
    assert.deepEqual(przezyly, []);
  });
});

test("kształt zostaje: długości, słowniki, identyfikatory, JSON i UUID w tekście", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const przed = new DatabaseSync(we);
    const po = new DatabaseSync(wy);
    const jeden = (d: DatabaseSync, sql: string) => d.prepare(sql).get() as Record<string, any>;

    const t1 = jeden(przed, "SELECT text FROM allegro_inbox_message WHERE id='m-1'").text as string;
    const t2 = jeden(po, "SELECT text FROM allegro_inbox_message WHERE id='m-1'").text as string;
    assert.equal(t2.length, t1.length, "długość tekstu");
    assert.equal([...t2].filter((c) => c === "\n").length, 1, "łamanie linii");
    assert.ok(t2.includes(UUID_ZAM), "UUID zamówienia w tekście stoi");
    assert.notEqual(t2, t1);

    assert.equal(jeden(po, "SELECT status FROM allegro_inbox_message WHERE id='m-1'").status, "READ");
    assert.equal(jeden(po, "SELECT related_object_type AS t FROM allegro_inbox_message WHERE id='m-1'").t, "ORDER");
    assert.equal(jeden(po, "SELECT zwrot_towaru AS z FROM reklamacja_klienta").z, "wymagany", "słownik z CHECK");
    assert.equal(jeden(po, "SELECT szkic_los AS z FROM outbox").z, "bez_zmian", "słownik z CHECK");
    assert.equal(jeden(po, "SELECT rejection_code AS z FROM zwrot_klienta").z, "NOT_AS_DESCRIBED");
    const tagi = (d: DatabaseSync) => (d.prepare("SELECT nazwa FROM reklamacja_tag ORDER BY id").all() as Array<{ nazwa: string }>).map((t) => t.nazwa);
    assert.ok(tagi(przed).length > 0, "migracja zakłada etykiety, więc jest co porównać");
    assert.deepEqual(tagi(po), tagi(przed), "etykiety zespołu stoją");
    assert.equal(jeden(po, "SELECT nazwa FROM sgt_towar").nazwa, "Nóż do kosiarki NAC LS 46 mm", "kartoteka stoi");
    assert.equal(jeden(po, "SELECT nazwa FROM zamowienie_klienta_pozycja").nazwa, "Nóż do kosiarki NAC LS 46");
    assert.equal(jeden(po, "SELECT external_id FROM zamowienie_klienta WHERE status='SENT'").external_id, UUID_ZAM2);

    const j1 = JSON.parse(jeden(przed, "SELECT payload FROM events WHERE type='reklamacja.notatka'").payload);
    const j2 = JSON.parse(jeden(po, "SELECT payload FROM events WHERE type='reklamacja.notatka'").payload);
    /* Automaty w dzienniku stoją, człowiek dostaje zamiennik. */
    const aktorzy = (d: DatabaseSync) => (d.prepare("SELECT user_id FROM events ORDER BY id").all() as Array<{ user_id: string }>).map((e) => e.user_id);
    assert.deepEqual(aktorzy(po).slice(1), ["system", "anonim"], "automaty w dzienniku");
    assert.notEqual(aktorzy(po)[0], "Anna Lewandowska");
    assert.deepEqual(Object.keys(j2), Object.keys(j1), "klucze JSON");
    assert.equal(j2.kwota, 12900);
    assert.equal(j2.ok, true);
    assert.equal(j2.orderId, UUID_ZAM);
    assert.notEqual(j2.login, j1.login);
    assert.notEqual(j2.note, j1.note);
    assert.equal(j2.note.length, j1.note.length);
    przed.close();
    po.close();
  });
});

test("ten sam login ma ten sam zamiennik w każdej tabeli, także przy innej wielkości liter", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const po = new DatabaseSync(wy);
    const pol = (sql: string) => (po.prepare(sql).get() as { n: number }).n;
    /* Droga klienta łączy sprawy po loginie bez wielkości liter. */
    assert.equal(pol("SELECT COUNT(*) AS n FROM zamowienie_klienta z JOIN reklamacja_klienta r ON lower(z.kupujacy_login)=lower(r.kupujacy_login)"), 1);
    assert.equal(pol("SELECT COUNT(*) AS n FROM zamowienie_klienta z JOIN klient_prowadzenie p ON lower(z.kupujacy_login)=lower(p.login)"), 1);
    assert.equal(pol("SELECT COUNT(*) AS n FROM allegro_inbox_thread t JOIN zwrot_klienta z ON lower(t.interlocutor_login)=lower(z.kupujacy_login)"), 1);
    assert.equal(pol("SELECT COUNT(*) AS n FROM allegro_inbox_thread t JOIN allegro_inbox_message m ON t.id=m.thread_id AND lower(t.interlocutor_login)=lower(m.author_login)"), 1);
    const pracownicy = po.prepare("SELECT DISTINCT prowadzi AS p FROM klient_prowadzenie UNION SELECT DISTINCT prowadzi FROM reklamacja_klienta UNION SELECT DISTINCT prowadzi FROM zwrot_klienta").all();
    assert.equal(pracownicy.length, 1, "ten sam pracownik w trzech tabelach");
    po.close();
  });
});

test("telefon i jego cyfry pozostają zgodne, adres dostawy jest rozsypany", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const po = new DatabaseSync(wy);
    for (const z of po.prepare("SELECT odbiorca_telefon AS t, odbiorca_telefon_cyfry AS c, odbiorca_kod AS kod, odbiorca_ulica AS u FROM zamowienie_klienta").all() as Array<Record<string, string>>) {
      assert.equal(z.t.replace(/\D/g, ""), z.c);
      assert.match(z.kod, /^\d\d-\d\d\d$/, "kod pocztowy ma kształt kodu");
      assert.notEqual(z.kod, "50-123");
      assert.notEqual(z.kod, "80-001");
    }
    po.close();
  });
});

test("tokeny, sesje i hasła nie zostają, obrazy są zastąpione", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const po = new DatabaseSync(wy);
    for (const t of TABELE_DO_OPROZNIENIA) {
      assert.equal((po.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0, t);
    }
    assert.equal((po.prepare("SELECT haslo_hash AS h FROM app_user").get() as { h: string }).h, "!");
    const img = po.prepare("SELECT obraz, mime FROM zdjecie_wlasne").get() as { obraz: Uint8Array; mime: string };
    assert.equal(img.mime, "image/png");
    assert.deepEqual([...img.obraz.slice(1, 4)], [0x50, 0x4e, 0x47], "PNG");
    po.close();
  });
});

test("wejście zostaje nietknięte, ziarno decyduje o wyniku, a wynik jest samodzielnym plikiem", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we);
    const przed = skrot(we);
    anonimizuj(we, path.join(k, "a.db"), { ziarno: "jedno" });
    anonimizuj(we, path.join(k, "b.db"), { ziarno: "jedno" });
    anonimizuj(we, path.join(k, "c.db"), { ziarno: "drugie" });
    assert.equal(skrot(we), przed, "wejście bez zmian");
    assert.equal(fs.existsSync(path.join(k, "a.db.praca")), false, "plik roboczy sprzątnięty");
    assert.equal(fs.existsSync(path.join(k, "a.db-wal")), false, "wynik bez WAL");
    assert.equal(wszystkieTeksty(path.join(k, "a.db")), wszystkieTeksty(path.join(k, "b.db")), "to samo ziarno, ten sam wynik");
    assert.notEqual(wszystkieTeksty(path.join(k, "a.db")), wszystkieTeksty(path.join(k, "c.db")), "inne ziarno, inny wynik");
  });
});

test("odmawia: istniejący wynik, ten sam plik i żywa baza z niepustym WAL-em", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we);
    fs.writeFileSync(path.join(k, "jest.db"), "x");
    assert.throws(() => anonimizuj(we, path.join(k, "jest.db")), /już istnieje/);
    assert.equal(fs.readFileSync(path.join(k, "jest.db"), "utf8"), "x", "cudzego pliku nie ruszamy");
    assert.throws(() => anonimizuj(we, we), /już istnieje|ten sam plik/);
    fs.writeFileSync(`${we}-wal`, "niepusty");
    assert.throws(() => anonimizuj(we, path.join(k, "z-wal.db")), /żywa baza/);
    assert.equal(fs.existsSync(path.join(k, "z-wal.db")), false);
  });
});

test("błędna reguła kończy się odmową: skaner kasuje wynik i nie wypuszcza danych", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    /* Wymuszamy błąd człowieka: treść wiadomości „zostaje bez zmian”. */
    let blad: (Error & { raport?: { skaner: Array<{ miejsce: string }> } }) | undefined;
    try {
      anonimizuj(we, wy, { ziarno: "test", reguly: { "allegro_inbox_message.text": R.ZOSTAJE } });
    } catch (e) {
      blad = e as typeof blad;
    }
    assert.ok(blad, "musi rzucić");
    assert.match(blad!.message, /Skaner znalazł/);
    assert.ok(blad!.raport!.skaner.some((t) => t.miejsce === "allegro_inbox_message.text"), "mówi, GDZIE");
    assert.equal(fs.existsSync(wy), false, "wynik skasowany");
    assert.equal(fs.existsSync(`${wy}.praca`), false, "plik roboczy też");
    /* Skaner nie wypisuje wartości: ani w komunikacie, ani w raporcie. */
    assert.ok(!JSON.stringify(blad!.raport).includes("ogrodnik_77"));
    assert.ok(!blad!.message.includes("ogrodnik_77"));
  });
});

test("skaner wykrywa dane, które zostały, także w bajtach, których nie widać jako tekst", () => {
  wKatalogu((k) => {
    const p = path.join(k, "wyciek.db");
    const d = new DatabaseSync(p);
    d.exec("CREATE TABLE t (a TEXT, b BLOB)");
    d.prepare("INSERT INTO t VALUES (?, ?)").run("Klient ogrodnik_77 pisze", Buffer.from("surowy jan.kowalczyk@example.com w blobie"));
    d.close();
    const igly = new Igly();
    igly.dodaj("ogrodnik_77");
    const trafienia = skanujWycieki(p, igly);
    assert.ok(trafienia.some((t: { miejsce: string }) => t.miejsce === "t.a"), "wartość w komórce");
    const igly2 = new Igly();
    igly2.dodaj("jan.kowalczyk@example.com");
    const surowe = skanujWycieki(p, igly2);
    assert.ok(surowe.some((t: { miejsce: string }) => t.miejsce.includes("surowe bajty")), "bajty w blobie");
    const czysty = new Igly();
    czysty.dodaj("nikogo_takiego");
    assert.deepEqual(skanujWycieki(p, czysty), []);
  });
});

test("skaner nie krzyczy na fragment słowa, tylko na całą wartość", () => {
  wKatalogu((k) => {
    const p = path.join(k, "granice.db");
    const d = new DatabaseSync(p);
    d.exec("CREATE TABLE t (a TEXT)");
    d.prepare("INSERT INTO t VALUES (?)").run("nowakowski przyjechał");
    d.close();
    const igly = new Igly();
    igly.dodaj("nowak");
    assert.deepEqual(skanujWycieki(p, igly), []);
  });
});

test("domyślnie odmowa: nieznana kolumna tekstowa jest rozsypywana, a ludzie nigdy nie zostają", () => {
  assert.equal(regulaKolumny("zamowienie_klienta", "kolumna_z_przyszlosci").regula, R.TEKST);
  assert.equal(regulaKolumny("tabela_z_przyszlosci", "opis_klienta").regula, R.TEKST);
  assert.equal(regulaKolumny("cokolwiek", "kupujacy_login").regula, R.KLIENT);
  assert.equal(regulaKolumny("cokolwiek", "zamknieto_przez").regula, R.PRACOWNIK);
  assert.equal(regulaKolumny("zamowienie_klienta", "odbiorca_kod").regula, R.TEKST, "kod pocztowy to nie słownik");
  assert.equal(regulaKolumny("cokolwiek", "status_x", new Set(["cokolwiek.status_x"])).regula, R.ZOSTAJE, "CHECK ... IN");
});

test("po migracji żadna kolumna z nazwą osoby ani adresu nie ma reguły „zostaje”", () => {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const tabele = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  const KATALOG = /^(sgt_|token_silnika|towar_)/;
  const zostajace: string[] = [];
  for (const { name } of tabele) {
    for (const k of d.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string; type: string }>) {
      if (/INT|REAL|NUM/i.test(k.type) || KATALOG.test(name)) continue;
      if (/login|telefon|odbiorca|haslo|passw|adres|address|email|mail|ulica|miasto/i.test(k.name)
        && regulaKolumny(name, k.name).regula === R.ZOSTAJE) zostajace.push(`${name}.${k.name}`);
    }
  }
  d.close();
  assert.deepEqual(zostajace, []);
});
