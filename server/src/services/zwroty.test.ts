import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  dniDoTerminu, kubelekZwrotu, licznikiKubelkow, listaZwrotow,
  sumaPozycji, sygnalyZwrotu, terminZwrotu,
} from "./zwroty.js";

/* ── Strażnicy kolejki zwrotów (0.150.0) ─────────────────────────────────────
   Ekran ma zjadać klikanie, a nie je mnożyć. Trzy rzeczy to gwarantują
   i trzy są tu sprawdzane: kubełek WYNIKA z faktów (nie z osobnej kolumny,
   która się rozjedzie), kolejność bierze się z terminu ustawowego (nie
   z daty wpływu), a sygnał zapala się tylko tam, gdzie naprawdę każe
   przeczytać wiersz.                                                       */

const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const TERAZ = Date.parse("2026-09-01T12:00:00Z");

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO channel_account(channel, external_account_id) VALUES ('allegro','k')").run();
  return d as unknown as Db;
}

/** Zamówienie z kosztem dostawy i SKU — kontekst, którego zwrot sam nie ma. */
function zamowienie(d: Db, ext: string, pozycje: Array<{ offerId: string; nazwa: string; sku: string | null; cena: number; ilosc?: number }>) {
  d.prepare(`INSERT INTO zamowienie_klienta(channel_account_id,external_id,status,
    dostawa_grosze,dostawa_metoda,suma_grosze,waluta,synced_at)
    VALUES (1,?,'READY_FOR_PROCESSING',1499,'Kurier InPost',20496,'PLN','2026-09-01T10:00:00Z')`).run(ext);
  const id = Number((d.prepare("SELECT id FROM zamowienie_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  for (const p of pozycje) {
    d.prepare(`INSERT INTO zamowienie_klienta_pozycja
      (zamowienie_id,offer_id,nazwa,sku,ilosc,cena_grosze,waluta)
      VALUES (?,?,?,?,?,?,'PLN')`).run(id, p.offerId, p.nazwa, p.sku, p.ilosc ?? 1, p.cena);
  }
}

function towar(d: Db, twId: number, symbol: string) {
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)").run(twId, symbol, `Towar ${symbol}`);
}

let kolejny = 0;
type Poz = { ilosc: number; cena: number; ocena?: string; offerId?: string;
  nazwa?: string; url?: string; twId?: number; twSymbol?: string; twZrodlo?: string };

function dodaj(d: Db, utworzono: string, pola: Record<string, unknown> = {},
               pozycje: Poz[] = [{ ilosc: 1, cena: 4999 }]) {
  const ext = `z${++kolejny}`;
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at,
    paczka_at,werdykt,kwota_grosze,korekta_numer,zamkniety_at,rejection_code)
    VALUES (1,?,?,?,?,?,?,?,?,?,?)`).run(
    ext, (pola.order_id as string) ?? null, utworzono, utworzono,
    (pola.paczka_at as string) ?? null, (pola.werdykt as string) ?? null,
    (pola.kwota_grosze as number) ?? null, (pola.korekta_numer as string) ?? null,
    (pola.zamkniety_at as string) ?? null, (pola.rejection_code as string) ?? null);
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  for (const p of pozycje) {
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,ocena,url,tw_id,tw_symbol,tw_zrodlo,klucz)
      VALUES (?,?,?,?,?,'PLN',?,?,?,?,?,?)`).run(
      id, p.offerId ?? null, p.nazwa ?? "Sekator", p.ilosc, p.cena, p.ocena ?? null,
      p.url ?? null, p.twId ?? null, p.twSymbol ?? null, p.twZrodlo ?? null,
      `${p.offerId ?? ""}|${p.nazwa ?? "Sekator"}`);
  }
  return id;
}

test("termin ustawowy liczy się od zgłoszenia i domyślnie ma czternaście dni", () => {
  assert.equal(terminZwrotu("2026-08-01T00:00:00Z"), "2026-08-15T00:00:00.000Z");
  assert.equal(terminZwrotu("2026-08-01T00:00:00Z", 30), "2026-08-31T00:00:00.000Z",
    "liczba dni idzie z env, bo to liczba z prawa, nie z kodu");
  assert.equal(dniDoTerminu("2026-09-04T12:00:00Z", TERAZ), 3);
  assert.equal(dniDoTerminu("2026-08-30T12:00:00Z", TERAZ), -2, "po terminie liczymy dalej, na minus");
});

test("kubełek wynika z faktów, a stan końcowy rozstrzyga pierwszy", () => {
  const bazowy = {
    rejectionCode: null, werdykt: null, zamknietyAt: null,
    kwotaGrosze: null, korektaNumer: null, pozycje: [{ ocena: null }],
  };
  assert.equal(kubelekZwrotu(bazowy), "decyzja");
  assert.equal(kubelekZwrotu({ ...bazowy, werdykt: "odrzucony" }), "odrzucony");
  assert.equal(kubelekZwrotu({ ...bazowy, rejectionCode: "REFUND_REJECTED" }), "odrzucony",
    "odrzucenie z panelu Allegro też jest odrzuceniem");
  assert.equal(kubelekZwrotu({ ...bazowy, werdykt: "przyjety" }), "ocena");
  assert.equal(
    kubelekZwrotu({ ...bazowy, werdykt: "przyjety", pozycje: [{ ocena: "stan" }] }), "zwrot");
  assert.equal(
    kubelekZwrotu({ ...bazowy, werdykt: "przyjety", pozycje: [{ ocena: "stan" }], kwotaGrosze: 4999 }),
    "korekta");
  assert.equal(
    kubelekZwrotu({ ...bazowy, werdykt: "przyjety", pozycje: [{ ocena: "stan" }],
      kwotaGrosze: 4999, korektaNumer: "KFS 12/2026" }), "zamkniety");
  /* Zamknięty zwrot nie wraca do kolejki pracy przez pozycję bez oceny. */
  assert.equal(
    kubelekZwrotu({ ...bazowy, werdykt: "przyjety", zamknietyAt: "2026-09-01T00:00:00Z" }),
    "zamkniety");
});

test("zwrot bez pozycji zostaje przy ocenie, a nie przeskakuje do kwoty", () => {
  /* Pusta lista to nie „ocenione wszystko". Zwrot bez pozycji nie ma czego
     wycenić i człowiek ma go zobaczyć, zamiast dostać propozycję zera. */
  assert.equal(kubelekZwrotu({
    rejectionCode: null, werdykt: "przyjety", zamknietyAt: null,
    kwotaGrosze: null, korektaNumer: null, pozycje: [],
  }), "ocena");
});

test("sygnał zapala się tylko tam, gdzie każe przeczytać wiersz", () => {
  const w = (o: Record<string, unknown>) => sygnalyZwrotu({
    kubelek: "decyzja", dni: 10, paczkaAt: "2026-08-30T00:00:00Z", rejectionCode: null, ...o,
  } as Parameters<typeof sygnalyZwrotu>[0]);
  assert.deepEqual(w({}), [], "zwrot w terminie z paczką nie żąda niczego");
  assert.deepEqual(w({ dni: 3 }), ["termin"], "trzy dni to już próg");
  assert.deepEqual(w({ dni: -1 }), ["termin"]);
  assert.deepEqual(w({ paczkaAt: null }), ["brak_dowodu"]);
  assert.deepEqual(w({ rejectionCode: "ITEM_FIXED" }), ["odrzucony_w_allegro"]);
  /* Stan końcowy nie ma terminu do pilnowania — czerwień na zamkniętych
     uczyłaby operatora przewijać czerwone wiersze. */
  assert.deepEqual(w({ kubelek: "zamkniety", dni: -30, paczkaAt: null }), []);
});

test("suma pozycji mnoży cenę przez ilość i zostaje w groszach", () => {
  assert.equal(sumaPozycji([{ cenaGrosze: 4999, ilosc: 2 }, { cenaGrosze: 100, ilosc: 3 }]), 10298);
  assert.equal(sumaPozycji([]), 0);
});

test("kolejność bierze się z terminu, nie z daty wpływu", () => {
  /* Blizna 0.121.0: ustawowy zegar steruje kolejnością pracy. Zwrot
     zgłoszony dawno ma mniej czasu i stoi wyżej niż wczorajszy. */
  const d = stanowisko();
  /* Obu zwrotom dajemy paczkę, żeby ten test mierzył wyłącznie kolejność —
     brak paczki zapala własny sygnał i mieszałby się z terminem. */
  dodaj(d, "2026-08-31T00:00:00Z", { paczka_at: "2026-08-31T10:00:00Z" });  // termin 14.09
  dodaj(d, "2026-08-20T00:00:00Z", { paczka_at: "2026-08-21T10:00:00Z" });  // termin 03.09
  const lista = listaZwrotow(d, TERAZ);
  assert.equal(lista[0].utworzono, "2026-08-20T00:00:00Z", "pilniejszy na górze");
  /* Termin wypada 03.09 o północy, a „teraz" to 01.09 południe — zostaje
     półtorej doby. Zaokrąglamy W DÓŁ, bo termin liczony hojnie to termin
     przekroczony: lepiej pokazać jeden dzień niż obiecać dwa. */
  assert.equal(lista[0].dniDoTerminu, 1);
  assert.deepEqual(lista[0].sygnaly, ["termin"]);
  assert.deepEqual(lista[1].sygnaly, [], "drugi ma czas i milczy");
});

test("liczniki kubełków zgadzają się z kolejką", () => {
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z");
  dodaj(d, "2026-08-31T00:00:00Z", { werdykt: "przyjety" });
  dodaj(d, "2026-08-31T00:00:00Z", { werdykt: "przyjety", kwota_grosze: 4999 },
    [{ ilosc: 1, cena: 4999, ocena: "stan" }]);
  dodaj(d, "2026-08-31T00:00:00Z", { rejection_code: "REFUND_REJECTED" });
  const l = licznikiKubelkow(listaZwrotow(d, TERAZ));
  assert.equal(l.decyzja, 1);
  assert.equal(l.ocena, 1);
  assert.equal(l.korekta, 1);
  assert.equal(l.odrzucony, 1);
  assert.equal(l.zwrot, 0);
});

test("propozycja kwoty to suma pozycji, nie zgadywana kwota pełna", () => {
  /* Koszt dostawy nie przyjeżdża ze zwrotem, więc wariant „bez wysyłki"
     byłby dziś nieodróżnialny od pełnego. Ekran ma mówić, co wie. */
  const d = stanowisko();
  /* Dwie RÓŻNE pozycje — bez `offer_id` rozróżnia je nazwa, bo klucz
     naturalny to `offer_id|nazwa`. */
  dodaj(d, "2026-08-31T00:00:00Z", {},
    [{ ilosc: 2, cena: 4999, nazwa: "Sekator" }, { ilosc: 1, cena: 500, nazwa: "Zraszacz" }]);
  const z = listaZwrotow(d, TERAZ)[0];
  assert.equal(z.sumaPozycjiGrosze, 10498);
  assert.equal(z.waluta, "PLN");
  assert.equal(z.kwotaGrosze, null, "propozycja nie jest decyzją — kwota zostaje pusta");
});

test("kwota pełna dochodzi dopiero z zamówieniem — wcześniej jest brakiem, nie sumą", () => {
  /* Do 0.151.0 ekran musiał pisać zdanie „bez kosztu dostawy", bo ten stoi
     przy zamówieniu, nie przy zwrocie. Teraz albo znamy całość, albo mówimy
     wprost, że jej nie znamy. */
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 2, cena: 8999, offerId: "111" }]);
  assert.equal(listaZwrotow(d, TERAZ)[0].kwotaPelnaGrosze, null, "bez zamówienia nie zgadujemy");

  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", cena: 8999 }]);
  const z = listaZwrotow(d, TERAZ)[0];
  assert.equal(z.sumaPozycjiGrosze, 17998);
  assert.equal(z.kwotaPelnaGrosze, 17998 + 1499, "pozycje plus koszt dostawy");
});

test("panel pokazuje CAŁE zamówienie i zaznacza, co wraca", () => {
  /* Klient kupił trzy rzeczy, oddaje jedną — to jest kontekst, którego
     ekran do 0.151.0 nie miał wcale. */
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 8999, offerId: "111" }]);
  zamowienie(d, "ord-1", [
    { offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", cena: 8999 },
    { offerId: "222", nazwa: "Zraszacz", sku: null, cena: 3490 },
    { offerId: "333", nazwa: "Wąż 20 m", sku: "WAZ-20", cena: 5950 },
  ]);
  const zam = listaZwrotow(d, TERAZ)[0].zamowienie!;
  assert.equal(zam.pozycje.length, 3);
  assert.deepEqual(zam.pozycje.map((p) => p.zwracana), [true, false, false]);
  assert.equal(zam.dostawaMetoda, "Kurier InPost");
  assert.equal(zam.kupujacyLogin, null);
});

test("propozycja kartoteki liczy się z SKU zamówienia i niesie źródło", () => {
  const d = stanowisko();
  towar(d, 10, "SEK-46");
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 8999, offerId: "111" }]);
  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", cena: 8999 }]);
  const p = listaZwrotow(d, TERAZ)[0].pozycje[0];
  assert.equal(p.twId, null, "propozycja to nie potwierdzenie");
  assert.equal(p.propozycja?.pewnosc, "sku");
  assert.equal(p.propozycja?.twId, 10);
  assert.match(p.propozycja!.zrodlo, /SEK-46/);
});

test("przy potwierdzonej kartotece propozycji już nie liczymy", () => {
  /* Podpowiadanie obok wyboru człowieka byłoby podważaniem jego decyzji,
     a §4.3 stawia ją wyżej niż wynik automatu. */
  const d = stanowisko();
  towar(d, 10, "SEK-46");
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 8999, offerId: "111", twId: 10, twSymbol: "SEK-46", twZrodlo: "reczne" }]);
  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator NAC", sku: "SEK-46", cena: 8999 }]);
  const p = listaZwrotow(d, TERAZ)[0].pozycje[0];
  assert.equal(p.twId, 10);
  assert.equal(p.twZrodlo, "reczne");
  assert.equal(p.propozycja, null);
});

test("zwrot niesie odnośniki, a brak numeru nie robi linku donikąd", () => {
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 8999, offerId: "111", url: "https://allegro.pl/oferta/sekator-111" }]);
  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator NAC", sku: null, cena: 8999 }]);
  const z = listaZwrotow(d, TERAZ)[0];
  assert.match(z.linkZwrotu!, /moje-allegro/);
  assert.match(z.zamowienie!.link!, /ord-1$/);
  assert.equal(z.pozycje[0].url, "https://allegro.pl/oferta/sekator-111",
    "adres oferty to jedyny link opisany w specyfikacji");
});
