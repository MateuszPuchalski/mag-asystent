import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ImportStats } from "../adapters/subiekt.mssql.js";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-health-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

/* `/api/health` nie miała testu do 0.149.0, choć to po niej instalator poznaje,
   że system żyje: `Test-WertisHealth` odpytuje ją kilkadziesiąt razy i po
   ostatnim wyjątku melduje „API nie odpowiedziało".

   1 września 2026 wyszło, ile to kosztuje. Trasa zdrowia zbiera kilkanaście
   liczb z bazy i z adapterów; każda z nich potrafi rzucić, a rzut jednej
   zabierał całą odpowiedź. Człowiek widział wtedy „API nie odpowiedziało"
   i nie miał jak odróżnić martwego procesu od jednego zepsutego licznika. */

/* Import, którego używa przycisk resync. Test trasy podstawia własny,
   bo prawdziwy strzelałby do MSSQL biura. */
let importTrasy: () => Promise<ImportStats> = async () => {
  throw new Error("test nie ustawił importu trasy");
};

let app: FastifyInstance;
before(async () => {
  app = await (await import("../index.js")).buildApp({ importSubiekta: () => importTrasy() });
});

/* Wyniki importu bez MSSQL. Testy odświeżenia sprawdzają, KTÓRY wynik doszedł
   do wołającego, a nie, ile czego zaimportowano. */
const STATS = { towary: 1, stany: 2 } as unknown as ImportStats;
const PIERWSZY = { towary: 10 } as unknown as ImportStats;
const DRUGI = { towary: 20 } as unknown as ImportStats;

/* Obietnica, którą test puszcza ręcznie — import „w toku" bez zegara. */
function wstrzymany(): { czekaj: Promise<void>; pusc: () => void } {
  let pusc!: () => void;
  const czekaj = new Promise<void>((r) => { pusc = r; });
  return { czekaj, pusc };
}

/* Import sterowany z testu. N-te wywołanie czeka na n-tą bramę, o ile jest,
   i oddaje n-ty wynik albo rzuca n-ty błąd. Liczy wywołania i najwięcej naraz. */
function sterowanyImport(wyniki: Array<ImportStats | Error>, bramy: Array<Promise<void>> = []) {
  const stan = { importow: 0, wLocie: 0, najwiecejNaraz: 0 };
  const imp = async (): Promise<ImportStats> => {
    const n = stan.importow++;
    stan.wLocie++;
    stan.najwiecejNaraz = Math.max(stan.najwiecejNaraz, stan.wLocie);
    try {
      await bramy[n];
      const w = wyniki[Math.min(n, wyniki.length - 1)]!;
      if (w instanceof Error) throw w;
      return w;
    } finally {
      stan.wLocie--;
    }
  };
  return { stan, imp };
}

const problemyZdrowia = async (): Promise<string[]> =>
  (await app.inject({ method: "GET", url: "/api/health" })).json().problemy;

async function sesjaBiura(login: string): Promise<string> {
  const { db } = await import("../db/db.js");
  const { createUser } = await import("../services/users.js");
  const u = createUser(`Biuro ${login}`, "biuro", login, "tajnehaslo");
  const token = `tok-${u.userId}-${login}`;
  const teraz = new Date().toISOString();
  db().prepare(
    "INSERT INTO device_session(token, user_id, device_id, created_at, last_seen) VALUES (?,?,?,?,?)",
  ).run(token, u.userId, "test-device", teraz, teraz);
  return token;
}

/* Wpisy `privileged` przycisku. Trasa woła `autoryzuj` i odświeżenie w jednym
   synchronicznym kroku, więc nowy wpis znaczy, że przycisk już zgłosił import. */
async function ratunkow(): Promise<number> {
  const { db } = await import("../db/db.js");
  return (db().prepare(
    "SELECT COUNT(*) AS n FROM events WHERE type = 'privileged' AND payload LIKE '%ratunek_serwera%'",
  ).get() as { n: number }).n;
}

/* Resync odpowiada tylko w trybie `mssql`; plik stoi na `seeded`. */
async function wTrybieMssql<T>(fn: () => Promise<T>): Promise<T> {
  const { config } = await import("../config.js");
  const tryb = config.sgtMode;
  (config as { sgtMode: string }).sgtMode = "mssql";
  try {
    return await fn();
  } finally {
    (config as { sgtMode: string }).sgtMode = tryb;
  }
}

test("zdrowie odpowiada 200 i niesie to, po czym poznaje się instalację", async () => {
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200, r.body);

  const h = r.json();
  /* Te pola czyta instalator i pasek kolektora. Rozjazd wersji serwera
     i APK to najczęstsze pytanie po aktualizacji. */
  assert.ok(h.wersja, "brak wersji serwera");
  assert.equal(h.mode, "seeded");
  assert.ok(h.configZPliku !== undefined, "brak źródła konfiguracji");
  assert.ok(Array.isArray(h.problemy), "problemy mają być listą zdań");
  assert.equal(typeof h.ok, "boolean");
});

test("trasa jest publiczna — poznaje się po niej stan PRZED zalogowaniem", async () => {
  /* Bez sesji i tak ma być: ostrzeżenie „to jest dev" musi być widoczne
     zanim człowiek się zaloguje, bo właśnie wtedy myli serwery. */
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200);
  assert.notEqual(r.statusCode, 401);
});

test("blok obsługi klienta niesie liczby z §21, bez treści i bez klientów", async () => {
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(typeof h.obsluga.rozmowyOczekujace, "number");
  assert.equal(typeof h.obsluga.zadaniaTerenowe, "number");
  /* Do 0.172.0 stała tu stała „wysyłka wyłączona" — zdanie nieprawdziwe od
     0.148.0, czyli od wydania, w którym wysyłka zaczęła działać. Teraz pole
     opisuje STAN kolejki, a pusta baza znaczy „nic jeszcze nie poszło". */
  assert.equal(h.obsluga.kolejkaWysylek, "pusta — nic jeszcze nie poszło");
  assert.equal(h.obsluga.wysylkiDoSprawdzenia, 0);

  /* Trasa jest publiczna, więc do payloadu nie ma wstępu nic poza liczbami. */
  const surowy = JSON.stringify(h);
  assert.ok(!/klient|tresc|oferta/i.test(JSON.stringify(h.obsluga)),
    "blok obsługi przemycił coś poza liczbami");
  assert.ok(!surowy.includes("MSSQL_PASSWORD"), "hasło w trasie publicznej");
});

test("blok synchronizacji Allegro niesie status z §7", async () => {
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(["current", "delayed", "rate_limited", "authentication_error", "failed"]
    .includes(h.allegroInbox.status), `nieznany status: ${h.allegroInbox.status}`);
  assert.equal(typeof h.allegroInbox.alarm, "boolean");
});

test("padnięty blok NIE kasuje odpowiedzi, tylko melduje się zdaniem", async () => {
  /* Sedno tej trasy. Psujemy jeden licznik i sprawdzamy, że zdrowie nadal
     odpowiada — bo `Test-WertisHealth` nie odróżnia 500 od martwego procesu,
     a człowiek dostaje wtedy komunikat, który nie mówi nic. */
  const { db } = await import("../db/db.js");
  db().exec("ALTER TABLE zadanie_terenowe RENAME TO zadanie_terenowe_schowane");
  try {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(r.statusCode, 200, "zdrowie padło razem z jednym licznikiem");

    const h = r.json();
    assert.equal(h.obsluga, null, "padnięty blok ma zwrócić null");
    assert.equal(h.ok, false, "awaria bloku musi zdejmować `ok`");
    assert.ok(h.problemy.some((p: string) => p.includes("obsługa klienta")),
      `awaria nie zameldowała się zdaniem: ${JSON.stringify(h.problemy)}`);
    /* Reszta odpowiedzi ma przeżyć — po niej instalator poznaje instalację. */
    assert.ok(h.wersja);
    assert.equal(h.mode, "seeded");
  } finally {
    db().exec("ALTER TABLE zadanie_terenowe_schowane RENAME TO zadanie_terenowe");
  }
});

test("awaria importu z Subiekta NIE kładzie serwera, tylko melduje się w zdrowiu", async () => {
  /* 1 września 2026 `main()` czekał na `importFromMssql()` przed
     `app.listen()`, a wyjątek kończył proces. NSSM restartował, import padał
     znowu — z zewnątrz martwe API. Read-model ma prawo być nieświeży;
     API nie ma prawa nie wstać. */
  const { odswiezReadModel } = await import("../index.js");

  await odswiezReadModel("start", async () => {
    throw new Error("FOREIGN KEY constraint failed");
  });

  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal(h.ok, false);
  const zdanie = h.problemy.find((p: string) => p.includes("Import z Subiekta"));
  assert.ok(zdanie, `awaria importu nie zameldowała się: ${JSON.stringify(h.problemy)}`);
  /* Zdanie ma mówić, co teraz widzi kolektor — sam komunikat błędu tego nie mówi. */
  assert.match(zdanie, /ostatniego udanego odświeżenia/);
  assert.match(zdanie, /FOREIGN KEY constraint failed/);
});

test("udane odświeżenie zdejmuje zdanie o nieświeżym read-modelu", async () => {
  const { odswiezReadModel } = await import("../index.js");
  await odswiezReadModel("cykl", async () => { throw new Error("padło"); });
  await odswiezReadModel("cykl", async () => STATS);

  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(!h.problemy.some((p: string) => p.includes("Import z Subiekta")),
    "zdanie o awarii zostało po udanym imporcie");
});

test("dwa takty naraz to JEDEN import z Subiekta", async () => {
  /* Każdy import czyta całą kartotekę z MSSQL biura, którego architektura
     każe nie obciążać. Takt nie czeka na poprzedni przebieg, więc ten, który
     trafi w biegnący import, ma dostać jego wynik zamiast stawiać drugi. */
  const { odswiezReadModel } = await import("../index.js");
  const brama = wstrzymany();
  const { stan, imp } = sterowanyImport([STATS], [brama.czekaj]);

  const start = odswiezReadModel("start", imp);
  const takt = odswiezReadModel("cykl", imp);
  assert.equal(takt, start, "takt w trakcie ma dostać tę samą obietnicę");
  brama.pusc();

  const [a, b] = await Promise.all([start, takt]);
  assert.equal(stan.importow, 1, "drugi import ruszył obok biegnącego");
  assert.deepEqual(a, { ok: true, stats: STATS });
  assert.equal(b, a);
});

test("przycisk w trakcie taktu czeka na WŁASNY import, a trzy kliknięcia to jeden", async () => {
  /* Biuro klika, żeby zobaczyć Subiekt PO swojej zmianie. Import biegnący
     w chwili kliknięcia mógł ruszyć przed nią, więc wynik taktu przyciskowi
     nie wystarcza. Kliknięcia w trakcie sklejają się w JEDEN import po takcie,
     inaczej niecierpliwe biuro ustawiłoby kolejkę pełnych odczytów kartoteki. */
  const { odswiezReadModel } = await import("../index.js");
  const bramy = [wstrzymany(), wstrzymany()];
  const { stan, imp } = sterowanyImport([PIERWSZY, DRUGI], bramy.map((b) => b.czekaj));

  const takt = odswiezReadModel("cykl", imp);
  /* Kto czekał na takt sprzed kliknięcia, dostaje głos pierwszy. Gdyby ręczny
     ruszał dopiero po wyniku taktu, ten takt zastałby pustkę i postawił
     drugi import obok ręcznego. */
  const poTakcie = takt.then(() => odswiezReadModel("cykl", imp));
  const klik = [
    odswiezReadModel("reczny", imp),
    odswiezReadModel("reczny", imp),
    odswiezReadModel("reczny", imp),
  ];
  assert.notEqual(klik[0], takt, "przycisk dołączył do importu sprzed kliknięcia");
  assert.equal(klik[1], klik[0], "drugie kliknięcie dostało osobny import");
  assert.equal(klik[2], klik[0], "trzecie kliknięcie dostało osobny import");
  assert.equal(odswiezReadModel("cykl", imp), takt, "takt w trakcie dołącza do biegnącego");
  assert.equal(stan.importow, 1, "kliknięcie ruszyło import obok biegnącego");

  bramy[0]!.pusc();
  assert.deepEqual(await takt, { ok: true, stats: PIERWSZY });
  assert.equal(stan.importow, 2, "ręczny nie ruszył zaraz po takcie");
  bramy[1]!.pusc();

  for (const w of await Promise.all([...klik, poTakcie])) {
    assert.deepEqual(w, { ok: true, stats: DRUGI });
  }
  assert.equal(stan.importow, 2, "trzy kliknięcia w trakcie dały więcej niż jeden import");
  assert.equal(stan.najwiecejNaraz, 1, "dwa importy biegły naraz");
});

test("awaria wraca zdaniem ze zdrowia, a następny udany import je zdejmuje", async () => {
  /* Przycisk i lista problemów mają mówić jednym zdaniem. Wyjątek zamiast
     wyniku dałby na przycisku goły błąd 500, którego nikt nie przeczyta. */
  const { odswiezReadModel } = await import("../index.js");
  const w = await odswiezReadModel("reczny", async () => {
    throw new Error("Login failed for user 'wertis'");
  });
  assert.ok(!w.ok, "awaria importu wróciła jako sukces");
  assert.match(w.error, /Import z Subiekta nie powiódł się \(ręczny\)/);
  assert.match(w.error, /Login failed for user 'wertis'/);
  assert.ok((await problemyZdrowia()).includes(w.error),
    "zdrowie i przycisk mówią różnymi zdaniami");

  assert.deepEqual(await odswiezReadModel("cykl", async () => STATS), { ok: true, stats: STATS });
  assert.ok(!(await problemyZdrowia()).some((p) => p.includes("Import z Subiekta")),
    "udany import nie zdjął zdania o awarii");
});

test("po zakończonym odświeżeniu następne znów importuje", async () => {
  /* Obietnica w toku musi zniknąć po wyniku, także po awarii. Inaczej każdy
     kolejny takt oddawałby stary wynik i read-model zamarzłby po cichu. */
  const { odswiezReadModel } = await import("../index.js");
  let importow = 0;
  const udany = async () => { importow++; return STATS; };
  const nieudany = async (): Promise<ImportStats> => { importow++; throw new Error("padło"); };

  await odswiezReadModel("cykl", udany);
  await odswiezReadModel("cykl", nieudany);
  const w = await odswiezReadModel("cykl", udany);
  assert.equal(importow, 3, "odświeżenie po zakończonym nie uruchomiło importu");
  assert.deepEqual(w, { ok: true, stats: STATS });
});

test("przycisk resync w trakcie taktu oddaje wynik WŁASNEGO importu, choćby takt padł", async () => {
  /* Przycisk idzie drogą taktu, żeby wiązać korekty i nie stawiać importu
     obok biegnącego. Wyniku taktu nie bierze, bo ten mógł powstać przed
     zmianą, po którą biuro kliknęło. */
  const { odswiezReadModel } = await import("../index.js");
  const token = await sesjaBiura("biuro-resync");
  const brama = wstrzymany();
  const { stan, imp } = sterowanyImport(
    [new Error("Login failed for user 'wertis'"), DRUGI], [brama.czekaj]);
  importTrasy = imp;

  const takt = odswiezReadModel("cykl", imp);
  const r = await wTrybieMssql(async () => {
    const przed = await ratunkow();
    const odp = app.inject({ method: "POST", url: "/api/admin/resync", headers: { "x-session": token } });
    for (let i = 0; i < 1000 && (await ratunkow()) === przed; i++) {
      await new Promise((dalej) => setImmediate(dalej));
    }
    assert.equal(await ratunkow(), przed + 1, "trasa nie doszła do odświeżenia");
    assert.equal(stan.importow, 1, "przycisk ruszył import obok taktu");
    brama.pusc();
    return odp;
  });

  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { ok: true, stats: DRUGI });
  assert.equal(stan.importow, 2, "po takcie miał pójść dokładnie jeden import przycisku");
  assert.equal(stan.najwiecejNaraz, 1, "dwa importy biegły naraz");
  assert.ok(!(await takt).ok, "takt miał paść, żeby było widać, że przycisk czeka mimo to");
  assert.ok(!(await problemyZdrowia()).some((p) => p.includes("Import z Subiekta")),
    "udany import przycisku nie zdjął zdania po takcie");
});

test("awaria przycisku resync to 502 ze zdaniem ze zdrowia, nie goły 500", async () => {
  /* Panel czyta 502 Z polem `error` jako zdanie naszej trasy, nie jako bramę. */
  const { odswiezReadModel } = await import("../index.js");
  const token = await sesjaBiura("biuro-resync-awaria");
  importTrasy = async () => { throw new Error("Login failed for user 'wertis'"); };

  const r = await wTrybieMssql(() =>
    app.inject({ method: "POST", url: "/api/admin/resync", headers: { "x-session": token } }));

  assert.equal(r.statusCode, 502, r.body);
  const { error } = r.json() as { error: string };
  assert.match(error, /Import z Subiekta nie powiódł się \(ręczny\)/);
  assert.match(error, /Login failed for user 'wertis'/);
  assert.ok((await problemyZdrowia()).includes(error), "przycisk i zdrowie mówią różnymi zdaniami");

  /* Kolejne testy patrzą na zdrowie bez zdania o awarii. */
  await odswiezReadModel("cykl", async () => STATS);
});

test("zdrowie mówi o synchronizacji SPRAW POSPRZEDAŻOWYCH, nie tylko skrzynki", async () => {
  /* ── Zgłoszenie właściciela (0.409.0) ────────────────────────────────────
     „Reklamacje w aplikacji mają nieaktualny stan." Przysłał wynik tej trasy,
     żeby to pokazać — a odpowiedzi w nim nie było: `/api/health` niósł
     `allegroInbox` i milczał o sprawach posprzedażowych, choć
     `stanReklamacjiHealth` istnieje od 0.222.0 i ta trasa go nie wołała.

     Blok jest dokładnie tam, gdzie człowiek zagląda, gdy coś nie działa —
     i niesie `pozostaloDoPobrania`, czyli jedyny ślad po sprawach, których
     bezpiecznik stron nie dociągnął i których status się NIE odświeża. */
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(h.allegroReklamacje, "brak bloku o synchronizacji spraw");
  assert.ok("pozostaloDoPobrania" in h.allegroReklamacje,
    "ogon spraw to jedyna liczba mówiąca, czego przebieg nie wziął");
  assert.ok("ostatniaUdanaSynchronizacja" in h.allegroReklamacje);
  assert.ok("status" in h.allegroReklamacje);
});

test("zdrowie mówi, kiedy powstały kopie bazy (0.487.0)", async () => {
  /* Kopie robi sam serwer, więc to tutaj człowiek sprawdza, że je robi.
     Na świeżej bazie testowej nocnej jeszcze nie ma — pole jest, z `null`. */
  const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.ok(h.kopie, `brak bloku kopii: ${JSON.stringify(h)}`);
  assert.equal(h.kopie.nocna, null);
  assert.ok("przedAktualizacja" in h.kopie);
  /* Demo nie melduje zaległej kopii — patrz `problemyKopii`. */
  assert.ok(!h.problemy.some((p: string) => p.includes("nocnej kopii")), JSON.stringify(h.problemy));
});
