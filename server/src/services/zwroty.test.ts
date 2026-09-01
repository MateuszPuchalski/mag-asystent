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

let kolejny = 0;
type Poz = { ilosc: number; cena: number; ocena?: string };

function dodaj(d: Db, utworzono: string, pola: Record<string, unknown> = {},
               pozycje: Poz[] = [{ ilosc: 1, cena: 4999 }]) {
  const ext = `z${++kolejny}`;
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at,
    paczka_at,werdykt,kwota_grosze,korekta_numer,zamkniety_at,rejection_code)
    VALUES (1,?,?,?,?,?,?,?,?,?)`).run(
    ext, utworzono, utworzono,
    (pola.paczka_at as string) ?? null, (pola.werdykt as string) ?? null,
    (pola.kwota_grosze as number) ?? null, (pola.korekta_numer as string) ?? null,
    (pola.zamkniety_at as string) ?? null, (pola.rejection_code as string) ?? null);
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  for (const p of pozycje) {
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,nazwa,ilosc,cena_grosze,waluta,ocena)
      VALUES (?,?,?,?,'PLN',?)`).run(id, "Sekator", p.ilosc, p.cena, p.ocena ?? null);
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
  dodaj(d, "2026-08-31T00:00:00Z", {}, [{ ilosc: 2, cena: 4999 }, { ilosc: 1, cena: 500 }]);
  const z = listaZwrotow(d, TERAZ)[0];
  assert.equal(z.sumaPozycjiGrosze, 10498);
  assert.equal(z.waluta, "PLN");
  assert.equal(z.kwotaGrosze, null, "propozycja nie jest decyzją — kwota zostaje pusta");
});
