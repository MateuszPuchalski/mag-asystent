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

/** Surowy JSON zamówienia w kształcie, w jakim leży w lądowisku po `oczyscSurowy`. */
const SUROWY_ZAMOWIENIA = {
  id: UUID_ZAM,
  buyer: { id: "23123123", login: "OGRODNIK_77", email: "[usunięte przy pobraniu]", numer: 501234567 },
  delivery: { address: { city: "GDANSK", zipCode: "50-123" }, method: { name: "Kurier DPD" } },
  parcels: [{ waybill: "605500000123" }],
  orderNote: "Jan Kowalczyk płaci gotówką",
  statusDetail: "ul.Lipowa12",
  orderBuyerLogin: "ogrodnik_77",
  orderId: "abc-123",
  checkoutFormId: UUID_ZAM2,
  status: "READY_FOR_PROCESSING",
  createdAt: "2026-09-21T09:00:00.000Z",
  kwota: 12900,
  trackingNumber: 501234568,
};

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

/**
 * Baza z rozpoznawalnymi danymi osobowymi we wszystkich rodzajach kolumn.
 * Trafia do pliku tak jak kopia z serwera: przez `VACUUM INTO`, czyli bez WAL-a.
 * Żywa baza po `migrate()` ma tryb WAL w nagłówku i narzędzie słusznie jej odmawia.
 */
function zbudujBaze(sciezka: string, dodatki?: (d: DatabaseSync) => void) {
  const zrodlo = `${sciezka}.zrodlo`;
  budujZrodlo(zrodlo);
  const d = new DatabaseSync(zrodlo);
  if (dodatki) {
    d.exec("PRAGMA foreign_keys = OFF");
    dodatki(d);
  }
  d.prepare("VACUUM INTO ?").run(sciezka);
  d.close();
  for (const koniec of ["", "-wal", "-shm"]) fs.rmSync(`${zrodlo}${koniec}`, { force: true });
}

function budujZrodlo(sciezka: string) {
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
  /* Numer oferty ma 9 cyfr jak telefon. Klient wpisał go w wiadomość, więc trafia na listę
     telefonów do skanu, a w kolumnie-identyfikatorze zostaje. Skaner nie może się o to przewrócić. */
  wstaw(d, "zamowienie_klienta_pozycja", { external_id: UUID_ZAM2, offer_id: "123456789", nazwa: "Świeca zapłonowa", sku: "SW-1", waluta: "PLN" });
  wstaw(d, "allegro_inbox_message", { id: "m-3", thread_id: "th-1", author_login: "ogrodnik_77", text: "Numer oferty 123456789, proszę sprawdzić", subject: "Oferta", status: "READ", created_at: "2026-09-20T12:00:00.000Z", surowe_json: "{}" });
  wstaw(d, "allegro_zamowienie", { id: UUID_ZAM, surowe_json: JSON.stringify(SUROWY_ZAMOWIENIA), synced_at: "2026-09-21T09:00:00.000Z" });

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
  "23123123", "gdansk", "gotówką", "lipowa12", "501234567",
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
    assert.equal(pol("SELECT COUNT(*) AS n FROM allegro_inbox_thread t JOIN allegro_inbox_message m ON t.id=m.thread_id AND lower(t.interlocutor_login)=lower(m.author_login)"), 2, "dwie wiadomości klienta w jego wątku");
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
    assert.deepEqual(fs.readdirSync(k).sort(), ["a.db", "b.db", "c.db", "kopia.db"], "obok wyniku nie leży żaden plik roboczy");
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
    assert.throws(() => anonimizuj(we, we), /ten sam plik/);
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

/* ── Poprawki po przeglądzie (0.550.3) ──────────────────────────────────────
   Każdy z poniższych testów pilnuje jednej luki, którą znalazł niezależny
   przegląd narzędzia. Powstały PRZED poprawkami i padały na poprzedniej wersji. */

const wynikJson = (wy: string, tabela: string, kolumna: string) => {
  const d = new DatabaseSync(wy);
  const w = d.prepare(`SELECT ${kolumna} AS v FROM ${tabela}`).get() as { v: string };
  d.close();
  return JSON.parse(w.v);
};

test("JSON: pod kluczem osobowym znika wszystko, także identyfikator kupującego i login WIELKIMI literami", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const j = wynikJson(wy, "allegro_zamowienie", "surowe_json");
    assert.notEqual(j.buyer.id, "23123123", "buyer.id to stały identyfikator osoby na platformie");
    assert.equal(j.buyer.id.length, 8);
    assert.match(j.buyer.id, /^\d+$/);
    assert.notEqual(j.buyer.login.toLowerCase(), "ogrodnik_77", "login wielkimi literami nie jest słownikiem");
    assert.notEqual(j.buyer.numer, 501234567, "liczba pod kluczem osobowym też");
    assert.equal(j.buyer.email, "[usunięte przy pobraniu]", "znacznik wycięcia zostaje znacznikiem");
    assert.notEqual(j.delivery.address.city, "GDANSK");
    assert.notEqual(j.delivery.address.zipCode, "50-123");
    assert.notEqual(j.orderNote, SUROWY_ZAMOWIENIA.orderNote, "tekst od człowieka");
    assert.equal(j.orderNote.length, SUROWY_ZAMOWIENIA.orderNote.length);
    assert.notEqual(j.statusDetail, "ul.Lipowa12", "klucz zawierający „status” nie jest słownikiem");
    assert.notEqual(j.orderBuyerLogin.toLowerCase(), "ogrodnik_77", "klucz zawierający „order” nie jest identyfikatorem");
  });
});

test("JSON: identyfikatory, słowniki, czas i liczby poza kluczami osobowymi zostają", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const j = wynikJson(wy, "allegro_zamowienie", "surowe_json");
    assert.equal(j.orderId, "abc-123");
    assert.equal(j.checkoutFormId, UUID_ZAM2);
    assert.equal(j.status, "READY_FOR_PROCESSING");
    assert.equal(j.createdAt, "2026-09-21T09:00:00.000Z");
    assert.equal(j.kwota, 12900);
    assert.equal(j.trackingNumber, 501234568, "liczba 9-cyfrowa poza kluczem osobowym nie jest telefonem");
  });
});

test("ten sam login i ten sam numer listu wyglądają tak samo w JSON-ie i w kolumnie", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    anonimizuj(we, wy, { ziarno: "test" });
    const j = wynikJson(wy, "allegro_zamowienie", "surowe_json");
    const po = new DatabaseSync(wy);
    const kol = po.prepare("SELECT kupujacy_login AS l FROM zamowienie_klienta WHERE status='READY_FOR_PROCESSING'").get() as { l: string };
    const zwrot = po.prepare("SELECT waybill AS w FROM zwrot_klienta").get() as { w: string };
    po.close();
    /* Serwer łączy zwroty z przesyłkami po numerze listu, a drogę klienta po loginie. */
    assert.equal(j.buyer.login.toLowerCase(), kol.l.toLowerCase(), "login z JSON-a = login z kolumny");
    assert.equal(j.orderBuyerLogin.toLowerCase(), kol.l.toLowerCase());
    assert.equal(j.parcels[0].waybill, zwrot.w, "numer listu z JSON-a = numer z kolumny");
  });
});

test("skaner rzuca wyjątkiem: pod docelową nazwą nie zostaje nic i nic nie leży w katalogu tymczasowym", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    const tmpPrzed = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("wertis-anonim-")).length;
    assert.throws(() => anonimizuj(we, wy, { ziarno: "test", skaner: () => { throw new Error("awaria skanera"); } }), /awaria skanera/);
    assert.equal(fs.existsSync(wy), false, "nieprzeskanowany wynik nie ma prawa leżeć pod docelową nazwą");
    assert.deepEqual(fs.readdirSync(k), ["kopia.db"], "ani plik częściowy, ani roboczy");
    assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("wertis-anonim-")).length, tmpPrzed, "katalog tymczasowy sprzątnięty");
  });
});

test("pełna kopia z danymi osobowymi pracuje w katalogu tymczasowym, a resztki po przerwanym przebiegu są zamiatane", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we);
    const stary = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-anonim-"));
    const swiezy = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-anonim-"));
    fs.writeFileSync(path.join(stary, "praca.db"), "resztka");
    const dawno = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(stary, dawno, dawno);
    try {
      /* Skaner dostaje plik, który za chwilę zostanie wynikiem. Jeśli leży obok wyniku
         (pulpit, Dokumenty), nieprzeskanowany plik bywa w chmurze, zanim praca się skończy. */
      let widziany = "";
      anonimizuj(we, path.join(k, "wynik.db"), { ziarno: "test", skaner: (sciezka: string) => { widziany = sciezka; return []; } });
      assert.ok(widziany, "skaner został wywołany");
      assert.ok(path.resolve(widziany).startsWith(path.resolve(os.tmpdir()) + path.sep), "kandydat leży w katalogu tymczasowym systemu");
      assert.ok(!path.resolve(widziany).startsWith(path.resolve(k) + path.sep), "i nie w katalogu wyniku");
      assert.equal(fs.existsSync(stary), false, "godzinna resztka po przerwaniu zniknęła");
      assert.equal(fs.existsSync(swiezy), true, "świeżego katalogu, może cudzego przebiegu, nie ruszamy");
    } finally {
      fs.rmSync(stary, { recursive: true, force: true });
      fs.rmSync(swiezy, { recursive: true, force: true });
    }
  });
});

test("odmawia surowej kopii żywej bazy (WAL w nagłówku) i pliku, który nie jest bazą", () => {
  wKatalogu((k) => {
    const surowa = path.join(k, "wertis.db");
    budujZrodlo(surowa);
    const d = new DatabaseSync(surowa);
    d.close();
    for (const koniec of ["-wal", "-shm"]) fs.rmSync(`${surowa}${koniec}`, { force: true });
    assert.throws(() => anonimizuj(surowa, path.join(k, "w.db")), /trybie WAL/);
    const smiec = path.join(k, "smiec.db");
    fs.writeFileSync(smiec, "to nie jest baza, tylko tekst dłuższy niż nagłówek");
    assert.throws(() => anonimizuj(smiec, path.join(k, "s.db")), /nie jest baza SQLite/);
    assert.deepEqual(fs.readdirSync(k).sort(), ["smiec.db", "wertis.db"], "żadnego wyniku");
  });
});

test("zamienniki są różnowartościowe i nie trafiają w prawdziwy login innego klienta", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    /* Trzyliterowe loginy z małego alfabetu: bez zakazu kolizji z oryginałami
       zamiennik jednego klienta bywa cudzym prawdziwym loginem. */
    const loginy = new Set<string>();
    for (let i = 0; loginy.size < 600; i++) {
      const h = crypto.createHash("sha256").update(`login-${i}`).digest();
      loginy.add(String.fromCharCode(97 + (h[0] % 12), 97 + (h[1] % 12), 97 + (h[2] % 12)));
    }
    zbudujBaze(we, (d) => {
      for (const l of loginy) {
        wstaw(d, "klient_prowadzenie", { login: l, prowadzi: "Anna Lewandowska" });
        wstaw(d, "klient_notatka", { login: l, tresc: "x", przez: "Anna Lewandowska", at: "2026-09-21T08:00:00.000Z" });
      }
    });
    anonimizuj(we, wy, { ziarno: "test" });
    const po = new DatabaseSync(wy);
    const nowe = (po.prepare("SELECT login FROM klient_prowadzenie WHERE length(login) < 8").all() as Array<{ login: string }>).map((r) => r.login);
    po.close();
    assert.equal(new Set(nowe).size, nowe.length, "różnowartościowe");
    const wspolne = nowe.filter((l) => loginy.has(l));
    assert.deepEqual(wspolne, [], "żaden zamiennik nie jest cudzym prawdziwym loginem");
  });
});

test("numer oferty o dziewięciu cyfrach w wiadomości nie zatrzymuje pracy, choć wygląda jak telefon", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    zbudujBaze(we);
    /* Fikstura ma taką liczbę w wiadomości i w kolumnie-identyfikatorze. */
    anonimizuj(we, wy, { ziarno: "test" });
    const po = new DatabaseSync(wy);
    const oferta = po.prepare("SELECT offer_id AS o FROM zamowienie_klienta_pozycja WHERE sku='SW-1'").get() as { o: string };
    po.close();
    assert.equal(oferta.o, "123456789", "identyfikator zostaje");
  });
});

/** Wstawia wiele wierszy jednym przygotowanym zapytaniem, dopełniając NOT NULL jak `wstaw`. */
function wstawSeria(d: DatabaseSync, tabela: string, wiersze: Array<Record<string, unknown>>) {
  const kolumny = d.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
  const podane = Object.keys(wiersze[0]);
  const dodatkowe = kolumny.filter((k) => !podane.includes(k.name) && k.notnull && k.dflt_value === null && !(k.pk === 1 && /INT/i.test(k.type)));
  const nazwy = [...podane, ...dodatkowe.map((k) => k.name)];
  const stale = dodatkowe.map((k) => (/INT|REAL|NUM/i.test(k.type) ? 0 : ""));
  const st = d.prepare(`INSERT INTO ${tabela} (${nazwy.join(",")}) VALUES (${nazwy.map(() => "?").join(",")})`);
  d.exec("BEGIN");
  for (const w of wiersze) st.run(...([...podane.map((n) => w[n]), ...stale] as never[]));
  d.exec("COMMIT");
}

test("losowe cyfry nie trafiają w prawdziwy numer innego klienta, nawet gdy numerów jest dużo", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    const wy = path.join(k, "wynik.db");
    /* Osiem tysięcy siedmiocyfrowych numerów w przestrzeni dziesięciu milionów: bez zakazu
       około sześć zamienników zgodziłoby się z cudzym prawdziwym numerem, a skaner
       odmówiłby każdego przebiegu takiej bazy. */
    const oryginalne = Array.from({ length: 8000 }, (_, i) => String(1000000 + i));
    zbudujBaze(we, (d) => wstawSeria(d, "zamowienie_klienta", oryginalne.map((t, i) => ({
      external_id: `zam-${i}`, status: "SENT", kupujacy_login: `klient${i}`, odbiorca_nazwa: `Osoba ${i}`,
      odbiorca_telefon: t, odbiorca_telefon_cyfry: t, waluta: "PLN",
    }))));
    const raport = anonimizuj(we, wy, { ziarno: "test" });
    assert.deepEqual(raport.skaner, []);
    const po = new DatabaseSync(wy);
    const nowe = (po.prepare("SELECT odbiorca_telefon_cyfry AS c FROM zamowienie_klienta WHERE external_id LIKE 'zam-%'").all() as Array<{ c: string }>).map((r) => r.c);
    po.close();
    const zbior = new Set(oryginalne);
    assert.equal(nowe.length, 8000);
    assert.deepEqual(nowe.filter((c) => zbior.has(c)), [], "żaden zamiennik nie jest prawdziwym numerem");
  });
});

test("firma, adres odbiorcy i konto sprzedawcy trafiają do skanu: błędna reguła kończy się odmową", () => {
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we);
    for (const kolumna of ["firma.nazwa", "firma.adres", "zamowienie_klienta.odbiorca_ulica", "channel_account.display_name"]) {
      let blad: (Error & { raport?: { skaner: Array<{ miejsce: string }> } }) | undefined;
      try {
        anonimizuj(we, path.join(k, `${kolumna}.db`), { ziarno: "test", reguly: { [kolumna]: R.ZOSTAJE } });
      } catch (e) {
        blad = e as typeof blad;
      }
      assert.ok(blad?.raport?.skaner.some((t) => t.miejsce === kolumna), `${kolumna}: skaner musi to wykryć`);
    }
  });
});

test("dobór z rozmowy i warunek zastosowania to tekst od człowieka, numer OEM i symbol zostają", () => {
  for (const kolumna of ["marka", "model", "wariant", "rocznik", "silnik", "nazwa_czesci"]) {
    assert.equal(regulaKolumny("dobor_rozmowy", kolumna).regula, R.TEKST, `dobor_rozmowy.${kolumna}`);
  }
  assert.equal(regulaKolumny("zastosowanie", "warunek").regula, R.TEKST);
  assert.equal(regulaKolumny("dobor_rozmowy", "oem").regula, R.ZOSTAJE);
  assert.equal(regulaKolumny("dobor_rozmowy", "wybrany_symbol").regula, R.ZOSTAJE);
});

test("wiersz poleceń: kod 0 z liczbą sprawdzonych wartości, kod 2 bez ani jednej wartości osobowej na wyjściu", async () => {
  const { uruchom } = narzedzie;
  const przechwyc = (fn: () => number) => {
    const linie: string[] = [];
    const [log, err] = [console.log, console.error];
    console.log = (...a: unknown[]) => { linie.push(a.join(" ")); };
    console.error = (...a: unknown[]) => { linie.push(a.join(" ")); };
    try { return { kod: fn(), tekst: linie.join("\n") }; } finally { console.log = log; console.error = err; }
  };
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we);
    const dobry = przechwyc(() => uruchom([we, path.join(k, "wynik.db")]));
    assert.equal(dobry.kod, 0);
    assert.match(dobry.tekst, /Skaner wycieków sprawdził [1-9]\d* wartości/, "operator widzi, że skaner miał co sprawdzać");
    const kolumny = fs.readFileSync(path.join(k, "wynik.db.kolumny.txt"), "utf8").toLowerCase();
    for (const w of WRAZLIWE) assert.ok(!kolumny.includes(w.toLowerCase()) && !dobry.tekst.toLowerCase().includes(w.toLowerCase()), `wyjście nie zawiera „${w}”`);

    const nieznana = przechwyc(() => uruchom([we, path.join(k, "inny.db"), "--ziarno=stale"]));
    assert.equal(nieznana.kod, 1, "wiersz poleceń nie przyjmuje ziarna");
    assert.equal(fs.existsSync(path.join(k, "inny.db")), false);
  });
  /* Cały przebieg odmowy przez wiersz poleceń: login wpisany do etykiety zespołu, która zostaje. */
  wKatalogu((k) => {
    const we = path.join(k, "kopia.db");
    zbudujBaze(we, (d) => wstaw(d, "reklamacja_tag", { nazwa: "czeka na ogrodnik_77" }));
    const zly = przechwyc(() => uruchom([we, path.join(k, "wynik.db")]));
    assert.equal(zly.kod, 2);
    assert.match(zly.tekst, /reklamacja_tag\.nazwa/, "mówi GDZIE");
    for (const w of WRAZLIWE) assert.ok(!zly.tekst.toLowerCase().includes(w.toLowerCase()), `komunikat nie zawiera „${w}”`);
    assert.deepEqual(fs.readdirSync(k), ["kopia.db"], "po odmowie nie zostaje nic");
  });
});
