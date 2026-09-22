import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  uzupelnijWyplaty, wyplataZOperacji, zwrotyDoSprawdzeniaWyplaty,
} from "./allegro-wyplaty.js";
import { kubelekZwrotu } from "./zwroty.js";

/* ── Czy pieniądze naprawdę wróciły do klienta (0.426.0) ─────────────────────
   Zgłoszenie właściciela: 934 zwroty stały w DO DECYZJI, choć wypłata poszła
   w sierpniu. Kubełek nie kłamał — nie miał skąd wiedzieć: jedyne pole zwrotu
   mówiące o wypłacie (`status = FINISHED`) jest punktem na osi, która biegnie
   dalej, na statusy PROWIZYJNE. Kto nie odpytał w tym oknie, nie dowie się
   nigdy.

   Te testy pilnują trzech rzeczy: co uznajemy za dowód wypłaty, kogo o nią
   pytamy i czy zatrzask naprawdę zdejmuje sprawę z kolejki.                 */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

/** Zwrot z zamówieniem i jego płatnością — najkrótsza droga do stanu z produkcji. */
function zwrotZPlatnoscia(
  d: Db, extId: string, platnoscId: string | null,
  extra: { zamkniety?: string; rozliczony?: string; werdykt?: string; utworzono?: string } = {},
) {
  const order = `ord-${extId}`;
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id, external_id, platnosc_id, synced_at)
    VALUES (1,?,?,?)`).run(order, platnoscId, "2026-09-22T08:00:00Z");
  return Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id, external_id, order_id, created_at, synced_at,
     zamkniety_at, rozliczony_allegro_at, werdykt)
    VALUES (1,?,?,?,?,?,?,?)`)
    .run(extId, order, extra.utworzono ?? "2026-08-20T08:00:00Z", "2026-09-22T08:00:00Z",
      extra.zamkniety ?? null, extra.rozliczony ?? null, extra.werdykt ?? null)
    .lastInsertRowid);
}

const operacja = (type: string, occurredAt: string) => ({ type, occurredAt, group: "REFUND" });

test("dowodem wypłaty jest OBCIĄŻENIE, a cofnięcie po nim ten dowód unieważnia", () => {
  /* Grupa REFUND niesie sześć typów, a schemat nie opisuje żadnego zdaniem.
     Bierzemy jedyny, którego nazwa nie pozostawia wątpliwości co do kierunku
     pieniędzy — i sprawdzamy, czy nie został wycofany. */
  assert.equal(wyplataZOperacji([]), null, "brak operacji to brak dowodu");
  assert.equal(wyplataZOperacji([operacja("REFUND_INCREASE", "2026-08-21T10:00:00Z")]), null,
    "samo uznanie nie jest wypłatą — kierunek pieniędzy jest odwrotny");

  assert.equal(
    wyplataZOperacji([operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z")]),
    "2026-08-21T10:00:00Z");

  /* Zwrot płatności bywa poprawiany: obciążenie, cofnięcie, obciążenie na inną
     kwotę. Liczy się stan KOŃCOWY, więc porównujemy czasy, a nie kolejność
     w tablicy — specyfikacja porządku listy nie obiecuje. */
  assert.equal(wyplataZOperacji([
    operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z"),
    operacja("REFUND_CANCEL", "2026-08-22T10:00:00Z"),
  ]), null, "cofnięcie nowsze od obciążenia znosi dowód");

  assert.equal(wyplataZOperacji([
    operacja("REFUND_CANCEL", "2026-08-22T10:00:00Z"),
    operacja("REFUND_CHARGE", "2026-08-23T10:00:00Z"),
  ]), "2026-08-23T10:00:00Z", "obciążenie po cofnięciu znaczy, że poprawka weszła");

  /* Przy równym czasie nie wiadomo, co było po czym — niewiedza ma zostawić
     zwrot w pracy, a nie zdjąć go z niej. */
  assert.equal(wyplataZOperacji([
    operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z"),
    operacja("REFUND_CANCEL", "2026-08-21T10:00:00Z"),
  ]), null);
});

test("pytamy tylko o zwroty W PRACY, po zamówieniu z identyfikatorem płatności", () => {
  const d = stanowisko();
  const wPracy = zwrotZPlatnoscia(d, "a", "pay-a", { utworzono: "2026-08-10T08:00:00Z" });
  const nowszy = zwrotZPlatnoscia(d, "b", "pay-b", { utworzono: "2026-08-25T08:00:00Z" });
  zwrotZPlatnoscia(d, "c", "pay-c", { zamkniety: "2026-09-01T08:00:00Z" });
  zwrotZPlatnoscia(d, "d", "pay-d", { rozliczony: "2026-09-01T08:00:00Z" });
  zwrotZPlatnoscia(d, "e", "pay-e", { werdykt: "odrzucony" });
  /* Zamówienie bez `platnosc_id` nie ma o co pytać: `payment.id` jest
     PARAMETREM końcówki, a nie polem opcjonalnym. */
  zwrotZPlatnoscia(d, "f", null);

  const lista = zwrotyDoSprawdzeniaWyplaty(d, 1);
  assert.deepEqual(lista.map((z) => z.zwrotId), [wPracy, nowszy],
    "zamknięty, rozliczony, odrzucony i bez płatności odpadają");
  /* NAJSTARSZE PIERWSZE — ta lista odkopuje zaległość, a zwrot po terminie
     boli dziś. Tracking paczek sortuje odwrotnie i z odwrotnego powodu. */
  assert.deepEqual(lista.map((z) => z.platnoscId), ["pay-a", "pay-b"]);
  assert.equal(zwrotyDoSprawdzeniaWyplaty(d, 1, 1).length, 1, "próg tnie budżet taktu");
});

test("potwierdzona wypłata ZDEJMUJE zwrot z kolejki decyzji", () => {
  /* To jest cała wartość tej zmiany: sierpniowy zwrot bez werdyktu stał
     w DO DECYZJI, bo `status_allegro` mówił już o prowizji. Zatrzask z faktu
     odsyła go do zamkniętych tą samą drogą co `FINISHED`. */
  const d = stanowisko();
  const id = zwrotZPlatnoscia(d, "a", "pay-a");

  const przed = kubelekZwrotu({
    rejectionCode: null, werdykt: null, zamknietyAt: null, kwotaGrosze: null,
    korektaNumer: null, pozycje: [], statusAllegro: "COMMISSION_REFUNDED",
    rozliczonyAllegroAt: null,
  });
  assert.equal(przed, "decyzja", "status prowizyjny nie jest dowodem wypłaty");

  return uzupelnijWyplaty(d, zwrotyDoSprawdzeniaWyplaty(d, 1), {
    apiUrl: "https://api.test",
    query: async () => ({ paymentOperations: [operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z")] }),
  }).then((ile) => {
    assert.equal(ile, 1);
    const w = d.prepare("SELECT rozliczony_allegro_at FROM zwrot_klienta WHERE id=?").get(id) as
      { rozliczony_allegro_at: string | null };
    assert.equal(w.rozliczony_allegro_at, "2026-08-21T10:00:00Z", "zatrzask bierze datę OPERACJI");

    assert.equal(kubelekZwrotu({
      rejectionCode: null, werdykt: null, zamknietyAt: null, kwotaGrosze: null,
      korektaNumer: null, pozycje: [], statusAllegro: "COMMISSION_REFUNDED",
      rozliczonyAllegroAt: w.rozliczony_allegro_at,
    }), "zamkniety");
  });
});

test("druga portmonetka dopiero wtedy, gdy pierwsza milczy", async () => {
  /* Schemat ma `wallet.type` z domyślnym AVAILABLE i drugą wartością WAITING,
     a nie mówi, która niesie obciążenie zwrotem. Pytamy obie, ale nie na darmo:
     przy zaległości, która w większości JEST rozliczona, oszczędza to połowę
     żądań. */
  const d = stanowisko();
  zwrotZPlatnoscia(d, "a", "pay-a");
  const pytania: string[] = [];

  await uzupelnijWyplaty(d, zwrotyDoSprawdzeniaWyplaty(d, 1), {
    apiUrl: "https://api.test",
    query: async (url) => {
      pytania.push(url);
      return url.includes("WAITING")
        ? { paymentOperations: [operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z")] }
        : { paymentOperations: [] };
    },
  });
  assert.equal(pytania.length, 2, "cisza pierwszej portmonetki wysyła nas do drugiej");
  assert.ok(pytania[0].includes("AVAILABLE") && pytania[1].includes("WAITING"));
  assert.ok(pytania[0].includes("payment.id=pay-a") && pytania[0].includes("group=REFUND"),
    "pytamy o KONKRETNĄ płatność, nie o historię konta");

  const pytania2: string[] = [];
  const d2 = stanowisko();
  zwrotZPlatnoscia(d2, "b", "pay-b");
  await uzupelnijWyplaty(d2, zwrotyDoSprawdzeniaWyplaty(d2, 1), {
    apiUrl: "https://api.test",
    query: async (url) => {
      pytania2.push(url);
      return { paymentOperations: [operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z")] };
    },
  });
  assert.equal(pytania2.length, 1, "rozstrzygnięcie w pierwszej kończy pytania");
});

test("zatrzask NIE NADPISUJE starszego, a zepsute pytanie nie zabiera reszty", async () => {
  const d = stanowisko();
  const zPolem = zwrotZPlatnoscia(d, "a", "pay-a", { utworzono: "2026-08-01T08:00:00Z" });
  /* Zatrzask ma trzymać PIERWSZĄ zobaczoną datę — ta sama zasada co przy
     COALESCE w synchronizacji zwrotów. Ustawiamy go ręką i sprawdzamy, że
     ponowne potwierdzenie go nie rusza. */
  d.prepare("UPDATE zwrot_klienta SET rozliczony_allegro_at='2026-08-05T10:00:00Z' WHERE id=?")
    .run(zPolem);
  const drugi = zwrotZPlatnoscia(d, "b", "pay-b", { utworzono: "2026-08-02T08:00:00Z" });

  /* Lista i tak pomija zatrzaśnięty, więc do `uzupelnijWyplaty` idzie sam
     drugi. Pierwsze pytanie wywracamy — ma zdegradować, nie przerwać. */
  let pierwsze = true;
  const ile = await uzupelnijWyplaty(d, [
    { zwrotId: zPolem, platnoscId: "pay-a" },
    { zwrotId: drugi, platnoscId: "pay-b" },
  ], {
    apiUrl: "https://api.test",
    query: async () => {
      if (pierwsze) { pierwsze = false; throw new Error("503 od Allegro"); }
      return { paymentOperations: [operacja("REFUND_CHARGE", "2026-08-21T10:00:00Z")] };
    },
  });

  assert.equal(ile, 1, "zepsute pytanie o jedną płatność nie zabiera drugiej");
  assert.equal((d.prepare("SELECT rozliczony_allegro_at FROM zwrot_klienta WHERE id=?")
    .get(zPolem) as { rozliczony_allegro_at: string }).rozliczony_allegro_at,
    "2026-08-05T10:00:00Z", "starszy zatrzask zostaje nietknięty");
});
