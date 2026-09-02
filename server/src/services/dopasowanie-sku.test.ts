import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import { kartotekaOferty, kartotekaPoSku, zaproponujKartoteke } from "./dopasowanie-sku.js";

/* Mostek oferta → kartoteka jest jedyną drogą do zdjęcia, ale nie ma prawa
   zgadywać: złe dopasowanie wysyła na halę zadanie o cudzym towarze. Te testy
   pilnują dwóch rzeczy naraz — że automat MILCZY tam, gdzie nie jest pewny,
   i że gdy milczy, POWIE DLACZEGO.

   Fikstury celowo ROZJEŻDŻAJĄ przestrzenie identyfikatorów: UUID po stronie
   zwrotu, numer po stronie oferty. Do 0.153.1 testy wstawiały po obu stronach
   tę samą stałą „111" i dlatego przepuściły usterkę, w której złączenie mogło
   nie trafiać nigdy. */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const UUID_POZYCJI = "3e895572-9297-4d80-b151-353deb95bff6";
const NUMER_OFERTY = "3213213";

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','k')").run();
  for (const [id, sym] of [[10, "SEK-46"], [11, "ZRA-01"], [12, "DUBEL"], [13, "dubel"],
                           [14, "SPACJA "]] as const) {
    d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(id, sym, `Towar ${sym}`);
  }
  return d as unknown as Db;
}

/** Zamówienie z pozycjami: `offer_id` numeryczny, `external_id` UUID-owy. */
function zamowienie(d: Db, ext: string, poz: Array<{ offerId: string; lineId: string; nazwa: string; sku: string | null }>) {
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,synced_at)
    VALUES (1,?,'2026-09-01T10:00:00Z')`).run(ext);
  const id = Number((d.prepare("SELECT id FROM zamowienie_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  for (const p of poz) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,external_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,1,1000,'PLN')`).run(id, p.lineId, p.offerId, p.nazwa, p.sku);
  }
}

const propozycja = (d: Db, o: Partial<{ orderId: string | null; offerId: string | null; nazwa: string }> = {}) =>
  zaproponujKartoteke(d, {
    channelAccountId: 1, orderId: "ord-1", offerId: NUMER_OFERTY, nazwa: "Sekator", ...o,
  });

test("złączenie trafia po numerze oferty i mówi, po której kolumnie", () => {
  const d = stanowisko();
  zamowienie(d, "ord-1", [{ offerId: NUMER_OFERTY, lineId: "l-1", nazwa: "Sekator", sku: "SEK-46" }]);
  const w = propozycja(d);
  assert.equal(w.pewnosc, "sku");
  assert.equal(w.twId, 10);
  assert.equal(w.poKolumnie, "offer_id");
  assert.match(w.zrodlo, /SKU oferty/);
});

test("złączenie trafia TAKŻE po identyfikatorze pozycji zamówienia", () => {
  /* Specyfikacja nie rozstrzyga, czy `CustomerReturnItem.offerId` to numer
     oferty, czy identyfikator pozycji: przykłady mówią jedno, schemat nie
     mówi nic. Zamiast zgadywać pytamy o obie kolumny i zapisujemy, która
     trafiła — to jest odpowiedź danymi z produkcji, nie domysłem. */
  const d = stanowisko();
  zamowienie(d, "ord-1", [
    { offerId: NUMER_OFERTY, lineId: UUID_POZYCJI, nazwa: "Sekator", sku: "SEK-46" },
    { offerId: "999", lineId: "inny-uuid", nazwa: "Zraszacz", sku: "ZRA-01" },
  ]);
  const w = propozycja(d, { offerId: UUID_POZYCJI });
  assert.equal(w.twId, 10);
  assert.equal(w.poKolumnie, "external_id", "to jest ślad, którego brakowało do diagnozy");
});

test("zamówienie z jedną pozycją nie ma czego mylić", () => {
  const d = stanowisko();
  zamowienie(d, "ord-1", [{ offerId: "cos-innego", lineId: "l-1", nazwa: "Inna nazwa", sku: "SEK-46" }]);
  const w = propozycja(d, { offerId: "nietrafia" });
  assert.equal(w.pewnosc, "jedyna_pozycja");
  assert.equal(w.twId, 10);
  assert.match(w.zrodlo, /jedynej pozycji/);
});

test("przy wielu pozycjach ratuje zgodna nazwa — ale tylko w tym zamówieniu", () => {
  /* To NIE jest zakazane szukanie po nazwie w kartotece: tamto przegląda
     trzy i pół tysiąca kartotek i prowadzi do cudzego towaru. Tu zbiór ma
     dwie pozycje i obie pochodzą z tej samej transakcji. */
  const d = stanowisko();
  zamowienie(d, "ord-1", [
    { offerId: "a", lineId: "l-1", nazwa: "Sekator", sku: "SEK-46" },
    { offerId: "b", lineId: "l-2", nazwa: "Zraszacz", sku: "ZRA-01" },
  ]);
  const w = propozycja(d, { offerId: "nietrafia", nazwa: "Sekator" });
  assert.equal(w.pewnosc, "nazwa_w_zamowieniu");
  assert.equal(w.twId, 10);
});

test("dwie pozycje o tej samej nazwie nie dają dopasowania", () => {
  const d = stanowisko();
  zamowienie(d, "ord-1", [
    { offerId: "a", lineId: "l-1", nazwa: "Sekator", sku: "SEK-46" },
    { offerId: "b", lineId: "l-2", nazwa: "Sekator", sku: "ZRA-01" },
  ]);
  assert.equal(propozycja(d, { offerId: "nietrafia" }).powod, "oferty_nie_ma_w_zamowieniu");
});

test("każde zerwane ogniwo ma WŁASNY powód, nie wspólne „bez kartoteki”", () => {
  /* To jest sedno tego wydania: do 0.153.1 wszystkie pięć zerwań wyglądało na
     ekranie identycznie, więc nie dało się odróżnić błędu kodu od braku
     danych po stronie Allegro. */
  const d = stanowisko();

  assert.equal(propozycja(d, { orderId: null }).powod, "brak_zamowienia_w_zwrocie");
  assert.equal(propozycja(d).powod, "zamowienie_niepobrane");

  zamowienie(d, "ord-1", [
    { offerId: NUMER_OFERTY, lineId: "l-1", nazwa: "Sekator", sku: "SEK-46" },
    { offerId: "b", lineId: "l-2", nazwa: "Zraszacz", sku: null },
    { offerId: "c", lineId: "l-3", nazwa: "Wąż", sku: "NIE-MA-TAKIEGO" },
    { offerId: "d", lineId: "l-4", nazwa: "Dubel", sku: "DUBEL" },
  ]);
  assert.equal(propozycja(d, { offerId: "brak-takiej", nazwa: "Nieznana" }).powod,
    "oferty_nie_ma_w_zamowieniu");
  assert.equal(propozycja(d, { offerId: "b" }).powod, "oferta_bez_sku");
  assert.equal(propozycja(d, { offerId: "c" }).powod, "sku_nie_trafia");
  assert.equal(propozycja(d, { offerId: "d" }).powod, "symbol_zdublowany");
  assert.equal(propozycja(d).powod, null, "trafienie nie ma powodu braku");
});

test("symbol z białym znakiem w kartotece też trafia", () => {
  /* `subiekt.mssql.ts` nie trimuje `tw_Symbol` przy imporcie, choć
     `mag_Symbol` tuż obok trimuje. Do 0.153.1 trim był jednostronny, więc
     taka kartoteka nie trafiała nigdy. */
  const d = stanowisko();
  zamowienie(d, "ord-1", [{ offerId: NUMER_OFERTY, lineId: "l-1", nazwa: "S", sku: " SPACJA " }]);
  assert.equal(propozycja(d).twId, 14);
  assert.equal(kartotekaPoSku(d, "spacja").twId, 14, "wielkość liter też nie decyduje");
});

test("pamięć wcześniejszego wskazania bije automat i nie potrzebuje zamówienia", () => {
  /* Za pamięcią stoi decyzja człowieka, a §4.3 stawia ją wyżej niż wynik
     automatu. Działa też wtedy, gdy zamówienia w ogóle nie ma. */
  const d = stanowisko();
  d.prepare(`INSERT INTO oferta_kartoteka
    (channel_account_id,offer_id,tw_id,tw_symbol,sku,wskazano_at,wskazano_przez)
    VALUES (1,?,11,'ZRA-01',NULL,'2026-09-01T10:00:00Z','Ala z biura')`).run(NUMER_OFERTY);
  const w = propozycja(d);
  assert.equal(w.pewnosc, "pamiec");
  assert.equal(w.twId, 11);
  assert.match(w.zrodlo, /Ala z biura/);
});

test("propozycja NICZEGO nie zapisuje", () => {
  const d = stanowisko();
  zamowienie(d, "ord-1", [{ offerId: NUMER_OFERTY, lineId: "l-1", nazwa: "Sekator", sku: "SEK-46" }]);
  const licz = () => (d.prepare(`SELECT (SELECT COUNT(*) FROM events)
    + (SELECT COUNT(*) FROM oferta_kartoteka) n`).get() as { n: number }).n;
  const przed = licz();
  propozycja(d);
  propozycja(d, { offerId: "nic" });
  assert.equal(licz(), przed);
});

/* ── Mostek dla SKRZYNKI: oferta → kartoteka BEZ zamówienia (0.179.0) ────────
   Pytanie pada zwykle PRZED zakupem, więc zamówienia nie ma i mieć nie
   będzie. Zostają dwa ogniwa: pamięć wskazań i SKU ze snapshotu oferty.   */

const zeSkrzynki = (d: Db, sku: string | null | undefined) =>
  kartotekaOferty(d, 1, NUMER_OFERTY, sku);

test("skrzynka: SKU oferty trafia w jedną kartotekę", () => {
  const d = stanowisko();
  const w = zeSkrzynki(d, "SEK-46");
  assert.equal(w.pewnosc, "sku");
  assert.equal(w.twId, 10);
  assert.equal(w.symbol, "SEK-46");
  assert.equal(w.powod, null);
  assert.match(w.zrodlo, /SKU oferty/);
});

test("skrzynka: brak snapshotu to co innego niż oferta bez sygnatury", () => {
  const d = stanowisko();
  /* Pierwsze naprawi się samo w kilka minut, drugie wymaga człowieka —
     ekran nie ma prawa pokazać na to jednego zdania. */
  const niepobrana = zeSkrzynki(d, undefined);
  assert.equal(niepobrana.powod, "oferta_niepobrana");
  assert.match(niepobrana.zrodlo, /jeszcze nie pobrano/);

  const bezSku = zeSkrzynki(d, "");
  assert.equal(bezSku.powod, "oferta_bez_sku");
  assert.notEqual(bezSku.zrodlo, niepobrana.zrodlo);
});

test("skrzynka: symbol zdublowany oddaje decyzję człowiekowi", () => {
  const d = stanowisko();
  const w = zeSkrzynki(d, "DUBEL");
  assert.equal(w.pewnosc, "niejednoznaczne");
  assert.equal(w.powod, "symbol_zdublowany");
  assert.equal(w.twId, null, "dwa trafienia to NIE powód do wybrania pierwszego");
});

test("skrzynka: SKU nietrafiające w kartotekę niesie powód", () => {
  const d = stanowisko();
  const w = zeSkrzynki(d, "NIE-MA-TAKIEGO");
  assert.equal(w.pewnosc, "brak");
  assert.equal(w.powod, "sku_nie_trafia");
});

test("skrzynka: pamięć wskazań BIJE automat", () => {
  const d = stanowisko();
  d.prepare(`INSERT INTO oferta_kartoteka
    (channel_account_id,offer_id,tw_id,tw_symbol,sku,wskazano_at,wskazano_przez)
    VALUES (1,?,11,'ZRA-01',NULL,'2026-09-02T10:00:00Z','A. Lewandowska')`).run(NUMER_OFERTY);
  /* SKU wskazuje na SEK-46, człowiek wskazał ZRA-01 — wygrywa człowiek. */
  const w = zeSkrzynki(d, "SEK-46");
  assert.equal(w.pewnosc, "pamiec");
  assert.equal(w.twId, 11);
  assert.match(w.zrodlo, /A\. Lewandowska/);
});

test("skrzynka: bez numeru oferty pamięci nie ma czego szukać", () => {
  const d = stanowisko();
  const w = kartotekaOferty(d, 1, null, "SEK-46");
  assert.equal(w.twId, 10, "sam SKU dalej działa");
});
