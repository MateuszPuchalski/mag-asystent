import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  faktySprawy, odsiejZnane, SUFIT_OPISU, tekstFaktow, type FaktySprawy,
} from "./copilot-fakty-sprawy.js";

/* ── Fakty ze sprawy i sito na „brakuje" (0.282.0) ───────────────────────────
   Test powstał z karty, którą właściciel wkleił z żywego panelu. Copilot
   prosił agenta o datę zakupu i o numer zamówienia — o rzeczy, które Allegro
   przysłało razem ze sprawą.

   Cztery rzeczy warte testu:

   1. PUSTE POLA NIE WCHODZĄ DO BLOKU. Wiersz „Termin decyzji: —" uczyłby
      model, że wiemy o terminie tyle, ile o kwocie.
   2. ETYKIETA MÓWI, KTÓRY TO ZEGAR. `boughtAt` i `checkoutForm.createdAt` to
      różne momenty i nazwanie jednego drugim to blizna 0.121.0.
   3. SITO WYCINA TO, CO PODALIŚMY — i tylko to.
   4. STRAŻNIK JEST WAŻNIEJSZY OD SITA. Pozycja wycięta za dużo kasuje
      najcenniejszą część karty, bo to „brakuje" trzyma sprawę w miejscu.   */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  return { d, konto };
}

const sprawa = (
  d: DatabaseSync, konto: number, n: Record<string, unknown> = {},
) => Number(d.prepare(`INSERT INTO reklamacja_klienta
  (channel_account_id,external_id,order_id,zamowienie_at,offer_id,powod_typ,
   oczekiwanie,oczekiwana_kwota_grosze,ilosc,decyzja_do,otwarto_at,synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,'2026-09-02T08:00:00Z','2026-09-11T09:00:00Z')`)
  .run(konto, String(n.ext ?? "i-1"), (n.orderId ?? "ord-1") as string | null,
    (n.zamowienieAt ?? "2026-03-14T09:12:00Z") as string | null,
    (n.offerId ?? "1234567890") as string | null,
    (n.powodTyp ?? "DEFECT_FOUND_DURING_USE") as string | null,
    (n.oczekiwanie ?? "REFUND") as string | null,
    (n.kwota ?? 24900) as number | null,
    (n.ilosc ?? 1) as number | null,
    (n.decyzjaDo ?? "2026-09-16T10:00:00Z") as string | null).lastInsertRowid);

const F = (n: Partial<FaktySprawy> = {}): FaktySprawy => ({
  temat: null, opis: null, powodTyp: "DEFECT_FOUND_DURING_USE", powodOpis: null,
  prawo: "COMPLAINT", oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: 24900, waluta: "PLN",
  ilosc: 1, zwrotWymagany: null, orderId: "ord-1", offerId: "1234567890",
  nazwaTowaru: "Gaźnik do kosiarki NAC LS46-450",
  kupionoAt: "2026-03-14T09:12:00Z", kupionoZrodlo: "sprawa",
  otwartoAt: "2026-09-02T08:00:00Z", decyzjaDo: "2026-09-16T10:00:00Z", ...n,
});

test("fakty czyta się jednym zapytaniem, a data z zamówienia BIJE datę ze sprawy", () => {
  /* `LineItem.boughtAt` to kanoniczna data zakupu pozycji; `createdAt`
     z ładunku sprawy to złożenie koszyka i bywa wcześniejszy. */
  const { d, konto } = stanowisko();
  const id = sprawa(d, konto);

  const zeSprawy = faktySprawy(d, id)!;
  assert.equal(zeSprawy.kupionoAt, "2026-03-14T09:12:00Z");
  assert.equal(zeSprawy.kupionoZrodlo, "sprawa");

  d.prepare(`INSERT INTO zamowienie_klienta
    (channel_account_id,external_id,kupiono_at,synced_at)
    VALUES (?,'ord-1','2026-03-15T07:00:00Z','2026-09-11T09:00:00Z')`).run(konto);
  const zZamowienia = faktySprawy(d, id)!;
  assert.equal(zZamowienia.kupionoAt, "2026-03-15T07:00:00Z");
  assert.equal(zZamowienia.kupionoZrodlo, "zamowienie");
});

test("nazwa towaru dochodzi z oferty, a bez oferty zostaje pusta", () => {
  const { d, konto } = stanowisko();
  const id = sprawa(d, konto);
  assert.equal(faktySprawy(d, id)!.nazwaTowaru, null);

  d.prepare(`INSERT INTO offer_snapshot
    (channel_account_id,external_id,nazwa,synced_at)
    VALUES (?,'1234567890','Gaźnik do kosiarki NAC','2026-09-11T09:00:00Z')`).run(konto);
  assert.equal(faktySprawy(d, id)!.nazwaTowaru, "Gaźnik do kosiarki NAC");
});

test("sprawa, której nie ma, oddaje `null`, a nie pusty zestaw faktów", () => {
  const { d } = stanowisko();
  assert.equal(faktySprawy(d, 9999), null);
});

test("blok POMIJA puste pola, zamiast wypisywać je z kreską", () => {
  const t = tekstFaktow(F({ temat: null, decyzjaDo: null, powodOpis: null }));
  assert.ok(!t.includes("Temat"), "pustego tematu nie ma w bloku");
  assert.ok(!t.includes("Termin decyzji"), "pustego terminu nie ma w bloku");
  assert.ok(!t.includes("—"));
  assert.ok(t.includes("Czego klient żąda: REFUND"), "enum idzie KODEM, nie po polsku");
  assert.ok(t.includes("Kwota, o którą prosi: 249,00 PLN"));
});

test("etykieta rozróżnia DWA ZEGARY — to jest blizna 0.121.0", () => {
  assert.ok(tekstFaktow(F({ kupionoZrodlo: "zamowienie" })).includes("Kupiono: 2026-03-14"));
  assert.ok(tekstFaktow(F({ kupionoZrodlo: "sprawa" }))
    .includes("Zamówienie złożone: 2026-03-14"));
});

test("elaborat w opisie jest przycinany i MÓWI, że został przycięty", () => {
  const t = tekstFaktow(F({ opis: "x".repeat(SUFIT_OPISU + 200) }));
  assert.ok(t.includes("dalszy ciąg pominięty"));
  assert.ok(t.length < SUFIT_OPISU + 400);
});

test("sito wycina dokładnie to, co podaliśmy", () => {
  const { brakuje, odsiano } = odsiejZnane([
    "data zakupu",
    "numer zamówienia",
    "kwota zwrotu oczekiwana przez klienta",
    "czy klient chce naprawę czy wymianę",
    "identyfikacja modelu urządzenia",
  ], F());
  assert.deepEqual(brakuje, []);
  assert.equal(odsiano, 5);
});

test("sito NIE RUSZA tego, czego naprawdę nie mamy", () => {
  /* Pole puste w faktach znaczy „nie wiemy", więc prośba o nie jest zasadna. */
  const bez = F({ decyzjaDo: null, oczekiwanaKwotaGrosze: null, nazwaTowaru: null });
  const { brakuje, odsiano } = odsiejZnane(
    ["termin na decyzję", "oczekiwana kwota zwrotu", "identyfikacja modelu"], bez);
  assert.equal(odsiano, 0);
  assert.equal(brakuje.length, 3);
});

test("STRAŻNIK bije sito: dowód zakupu i tabliczka zostają mimo znanej daty", () => {
  /* To jest najważniejszy test tego pliku. Data zakupu NIE zastępuje paragonu
     (dokument, nie data), a numer oferty nie zastępuje tabliczki (mówi, CO
     kupiono, nie KTÓRY egzemplarz). Sito, które utnie te pozycje, kasuje
     najcenniejszą część karty. */
  const { brakuje, odsiano } = odsiejZnane([
    "paragon lub faktura jako dowód zakupu",
    "zdjęcie tabliczki znamionowej",
    "numer seryjny urządzenia",
    "zdjęcia iglicy przed demontażem",
    "kiedy dokładnie wystąpiła usterka",
    "jak często kosiarka była używana",
    "karta gwarancyjna",
  ], F());
  assert.equal(odsiano, 0);
  assert.equal(brakuje.length, 7);
});

test("sito radzi sobie z ogonkami i wielkością liter", () => {
  /* Model pisze „Data Zakupu" albo „daty zakupu" — to ta sama prośba. */
  const { odsiano } = odsiejZnane(["Data Zakupu", "NUMER ZAMÓWIENIA"], F());
  assert.equal(odsiano, 2);
});

test("bez daty w faktach prośba o datę ZOSTAJE", () => {
  const { brakuje, odsiano } = odsiejZnane(["data zakupu"], F({ kupionoAt: null }));
  assert.deepEqual(brakuje, ["data zakupu"]);
  assert.equal(odsiano, 0);
});
