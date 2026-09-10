import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";
import { config } from "../config.js";

/* ── Granice czasu i encje w zastanych danych (0.152.0) ──────────────────────
   Pierwsza udana synchronizacja wciągnęła całą historię konta, razem
   z encjami HTML w treści. Te dwie migracje sprowadzają bazę do tego, co
   właściciel chce widzieć — i muszą to zrobić OSTROŻNIE: granica stoi na
   wątku, więc rozmowa z jedną wiadomością po progu zostaje razem ze swoim
   wcześniejszym kontekstem.

   Progi bierzemy z `config`, a nie wpisujemy tu daty. Test ma pilnować
   ZACHOWANIA migracji, nie powtarzać wartości domyślnej — inaczej zmiana
   progu w `wertis.env` wywracałaby testy zamiast bazy. */

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const INBOX_OD = config.allegro.inboxOd!;
const ZWROTY_OD = config.allegro.zwrotyOd!;
const przed = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString();
const po = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString();

function baza() {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(id, channel, external_account_id) VALUES (1,'allegro','k')").run();
  return d;
}

const rozmowa = (d: DatabaseSync, ext: string, updated: string) =>
  Number((d.prepare(`INSERT INTO conversation(channel_account_id, external_conversation_id,
    subject, unread, updated_at) VALUES (1,?,?,0,?) RETURNING id`)
    .get(ext, `temat ${ext}`, updated) as { id: number }).id);

const wiadomosc = (d: DatabaseSync, rozm: number, ext: string, sent: string, body = "treść") =>
  d.prepare(`INSERT INTO message(conversation_id, channel_account_id, external_message_id,
    direction, body, sent_at) VALUES (?,1,?,'incoming',?,?)`).run(rozm, ext, body, sent);

test("rozmowa CAŁA sprzed granicy znika razem z wiadomościami", () => {
  const d = baza();
  const stara = rozmowa(d, "c-stara", przed(INBOX_OD));
  wiadomosc(d, stara, "m-stara", przed(INBOX_OD));

  migrate(d);

  assert.equal((d.prepare("SELECT count(*) n FROM conversation").get() as { n: number }).n, 0);
  assert.equal((d.prepare("SELECT count(*) n FROM message").get() as { n: number }).n, 0);
});

test("rozmowa z JEDNĄ wiadomością po granicy zostaje z całym kontekstem", () => {
  /* To jest cała różnica między granicą na wątku a granicą na wiadomości.
     Agent, który widzi pytanie bez jego początku, odpowiada w ciemno. */
  const d = baza();
  const zywa = rozmowa(d, "c-zywa", po(INBOX_OD));
  wiadomosc(d, zywa, "m-kontekst", przed(INBOX_OD));
  wiadomosc(d, zywa, "m-nowa", po(INBOX_OD));

  migrate(d);

  assert.equal((d.prepare("SELECT count(*) n FROM conversation").get() as { n: number }).n, 1);
  assert.equal((d.prepare("SELECT count(*) n FROM message").get() as { n: number }).n, 2,
    "kontekst sprzed granicy został obcięty");
});

test("zwrot sprzed granicy znika, późniejszy zostaje", () => {
  const d = baza();
  for (const [ext, kiedy] of [["z-stary", przed(ZWROTY_OD)], ["z-nowy", po(ZWROTY_OD)]] as const) {
    d.prepare(`INSERT INTO zwrot_klienta(channel_account_id, external_id, created_at, synced_at)
      VALUES (1,?,?,?)`).run(ext, kiedy, kiedy);
    d.prepare("INSERT INTO allegro_zwrot(id, created_at, surowe_json, synced_at) VALUES (?,?,'{}',?)")
      .run(ext, kiedy, kiedy);
  }

  migrate(d);

  const zostalo = (d.prepare("SELECT external_id FROM zwrot_klienta").all() as
    Array<{ external_id: string }>).map((z) => z.external_id);
  assert.deepEqual(zostalo, ["z-nowy"]);
  assert.equal((d.prepare("SELECT count(*) n FROM allegro_zwrot").get() as { n: number }).n, 1);
});

test("sprzątanie zostawia ślad w audycie, bo to kasowanie danych", () => {
  const d = baza();
  const stara = rozmowa(d, "c-stara", przed(INBOX_OD));
  wiadomosc(d, stara, "m-stara", przed(INBOX_OD));

  migrate(d);

  const e = d.prepare("SELECT payload FROM events WHERE type='inbox.granica.sprzatanie'")
    .get() as { payload: string } | undefined;
  assert.ok(e, "brak wpisu w audycie");
  assert.equal(JSON.parse(e.payload).usunieto, 1);
});

test("drugie wejście nie kasuje niczego i nie dopisuje audytu", () => {
  const d = baza();
  const zywa = rozmowa(d, "c-zywa", po(INBOX_OD));
  wiadomosc(d, zywa, "m-nowa", po(INBOX_OD));

  migrate(d);
  migrate(d);

  assert.equal((d.prepare("SELECT count(*) n FROM conversation").get() as { n: number }).n, 1);
  assert.equal((d.prepare(
    "SELECT count(*) n FROM events WHERE type LIKE '%granica%'").get() as { n: number }).n, 0);
});

test("encje w zastanych wierszach schodzą, a drugie wejście ich nie rusza", () => {
  const d = baza();
  const r = rozmowa(d, "c-encje", po(INBOX_OD));
  d.prepare("UPDATE conversation SET subject='Re: zam&oacute;wienie' WHERE id=?").run(r);
  wiadomosc(d, r, "m-encje", po(INBOX_OD), "zwr&oacute;ci&cacute; kt&oacute;ry");

  migrate(d);

  assert.equal((d.prepare("SELECT body FROM message").get() as { body: string }).body,
    "zwrócić który");
  assert.equal((d.prepare("SELECT subject FROM conversation").get() as { subject: string }).subject,
    "Re: zamówienie");

  /* Tekst z `&`, który encją NIE jest, ma przetrwać drugie wejście w całości —
     inaczej migracja zjadałaby znak należący do treści. */
  d.prepare("UPDATE message SET body='Stihl & Husqvarna' WHERE external_message_id='m-encje'").run();
  migrate(d);
  assert.equal((d.prepare("SELECT body FROM message").get() as { body: string }).body,
    "Stihl & Husqvarna");
});

test("encje schodzą też ze SPRAW POSPRZEDAŻOWYCH i ze zwrotów (0.250.0)", () => {
  /* Dwa powody, dla których tamte wiersze zostały z encjami do dziś.
     Po pierwsze: synchronizator spraw nie dekodował NICZEGO. Po drugie —
     i to dotyczy także skrzynki — tablica znała wyłącznie polskie znaki, więc
     `&aacute;` przetrwało nawet tam, gdzie dekoder był wołany. */
  const d = baza();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','s-1')")
    .run().lastInsertRowid);
  const sprawa = Number(d.prepare(`INSERT INTO reklamacja_klienta(channel_account_id,external_id,
      typ,temat,opis,powod_opis,otwarto_at,synced_at)
    VALUES (?,'i-encje','DISPUTE','Z&aacute;silka nebyla doručena',
      'Objedn&aacute;vka &ccaron;. 12','&Scaron;t&iacute;tek chyb&iacute;',
      '2026-09-10T10:00:00Z','2026-09-10T10:00:00Z')`).run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
    VALUES (?,'w-1','BUYER','K&ouml;sz&ouml;n&ouml;m, v&aacute;rok','2026-09-10T10:01:00Z')`)
    .run(sprawa);
  d.prepare("INSERT INTO reklamacja_zalacznik(reklamacja_id,nazwa,url) VALUES (?,?,?)")
    .run(sprawa, "&scaron;t&iacute;tek.jpg", "https://api.allegro.pl/x");
  const zwrot = Number(d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,
      status_allegro,created_at,synced_at)
    VALUES (?,'z-1','CREATED',?,?)`)
    .run(konto, po(ZWROTY_OD), po(ZWROTY_OD)).lastInsertRowid);
  d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,klucz,nazwa,ilosc,
      cena_grosze,waluta,powod_komentarz)
    VALUES (?,'k-1','Nóż',1,12900,'PLN','Nesed&iacute; rozm&ecaron;r')`).run(zwrot);

  migrate(d);

  const s = d.prepare("SELECT temat, opis, powod_opis FROM reklamacja_klienta").get() as
    Record<string, string>;
  assert.equal(s.temat, "Zásilka nebyla doručena");
  assert.equal(s.opis, "Objednávka č. 12");
  assert.equal(s.powod_opis, "Štítek chybí");
  assert.equal((d.prepare("SELECT tresc FROM reklamacja_wiadomosc").get() as { tresc: string })
    .tresc, "Köszönöm, várok");
  assert.equal((d.prepare("SELECT nazwa FROM reklamacja_zalacznik").get() as { nazwa: string })
    .nazwa, "štítek.jpg");
  assert.equal((d.prepare("SELECT powod_komentarz FROM zwrot_klienta_pozycja").get() as
    { powod_komentarz: string }).powod_komentarz, "Nesedí rozměr");
});
