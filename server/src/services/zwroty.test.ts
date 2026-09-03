import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate, type Db } from "../db/db.js";
import {
  csvZwrotow, dniDoTerminu, kubelekZwrotu, licznikiKubelkow, listaZwrotow, ocenPozycje,
  zapiszPotracenie, zarejestrujNieodebrana,
  rozstrzygnijZwrot, sumaPozycji, sygnalyZwrotu, terminZwrotu, zapiszKorekte, zapiszKwote,
  cofnijKorekte, znajdzZwrotPoKodzie,
  dopiszPozycje, doDopisania, usunDopisanaPozycje,
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

function towar(d: Db, twId: number, symbol: string, ean: string | null = null) {
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, symbol, `Towar ${symbol}`, ean);
}

/** Rozmowa w skrzynce, w której klient wspomniał o tym zamówieniu. */
function rozmowa(d: Db, ext: string, orderId: string | null, temat: string, kiedy: string) {
  d.prepare(`INSERT INTO conversation(channel_account_id,external_conversation_id,subject,status)
    VALUES (1,?,?,'open')`).run(ext, temat);
  const id = Number((d.prepare(
    "SELECT id FROM conversation WHERE external_conversation_id=?").get(ext) as { id: number }).id);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,related_order_id,sent_at)
    VALUES (?,1,?,'incoming','Kiedy zwrot?',?,?)`).run(id, `m-${ext}`, orderId, kiedy);
  return id;
}

let kolejny = 0;
type Poz = { ilosc: number; cena: number; ocena?: string; offerId?: string;
  nazwa?: string; url?: string; twId?: number; twSymbol?: string; twZrodlo?: string };

function dodaj(d: Db, utworzono: string, pola: Record<string, unknown> = {},
               pozycje: Poz[] = [{ ilosc: 1, cena: 4999 }]) {
  const ext = `z${++kolejny}`;
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,created_at,synced_at,
    paczka_at,werdykt,kwota_grosze,korekta_numer,zamkniety_at,rejection_code,
    kupujacy_login,przewoznik)
    VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ext, (pola.order_id as string) ?? null, utworzono, utworzono,
    (pola.paczka_at as string) ?? null, (pola.werdykt as string) ?? null,
    (pola.kwota_grosze as number) ?? null, (pola.korekta_numer as string) ?? null,
    (pola.zamkniety_at as string) ?? null, (pola.rejection_code as string) ?? null,
    (pola.kupujacy_login as string) ?? null, (pola.przewoznik as string) ?? null);
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?").get(ext) as { id: number }).id);
  /* Numer wystąpienia jak w `allegro-zwroty-sync.ts`: ta sama oferta bywa
     w zwrocie dwa razy, a `klucz` jest unikalny w obrębie zwrotu. */
  const licznik = new Map<string, number>();
  for (const p of pozycje) {
    const para = `${p.offerId ?? ""}|${p.nazwa ?? "Sekator"}`;
    const n = (licznik.get(para) ?? 0) + 1;
    licznik.set(para, n);
    d.prepare(`INSERT INTO zwrot_klienta_pozycja(zwrot_id,offer_id,nazwa,ilosc,cena_grosze,waluta,ocena,url,tw_id,tw_symbol,tw_zrodlo,klucz)
      VALUES (?,?,?,?,?,'PLN',?,?,?,?,?,?)`).run(
      id, p.offerId ?? null, p.nazwa ?? "Sekator", p.ilosc, p.cena, p.ocena ?? null,
      p.url ?? null, p.twId ?? null, p.twSymbol ?? null, p.twZrodlo ?? null,
      n === 1 ? para : `${para}|#${n}`);
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
    kubelek: "decyzja", dni: 10, paczkaAt: "2026-08-30T00:00:00Z",
    dostarczonoAt: null, przesylkaStatus: null, rejectionCode: null, ...o,
  } as Parameters<typeof sygnalyZwrotu>[0]);
  assert.deepEqual(w({}), [], "zwrot w terminie z paczką nie żąda niczego");
  assert.deepEqual(w({ dni: 3 }), ["termin"], "trzy dni to już próg");
  assert.deepEqual(w({ dni: -1 }), ["termin"]);
  assert.deepEqual(w({ paczkaAt: null }), ["brak_dowodu"]);
  assert.deepEqual(w({ rejectionCode: "ITEM_FIXED" }), ["odrzucony_w_allegro"]);
  /* Stan końcowy nie ma terminu do pilnowania — czerwień na zamkniętych
     uczyłaby operatora przewijać czerwone wiersze. */
  assert.deepEqual(w({ kubelek: "zamkniety", dni: -30, paczkaAt: null }), []);

  /* ── Dowodem jest DORĘCZENIE, nie nadanie (0.187.0) ──────────────────────
     Do 0.186.0 sygnał gasł, gdy klient nadał paczkę. Zwrot doręczony i ten
     jadący od tygodnia wyglądały w kolejce identycznie, a to jest różnica
     między „mam towar" a „czekam na towar". */
  assert.deepEqual(w({ przesylkaStatus: "IN_TRANSIT" }), ["brak_dowodu"],
    "paczka w drodze to nie paczka u nas");
  assert.deepEqual(w({ przesylkaStatus: "NOTICE_LEFT" }), ["brak_dowodu"],
    "awizo tym bardziej");
  assert.deepEqual(w({ przesylkaStatus: "DELIVERED", dostarczonoAt: "2026-08-31T09:00:00Z" }), [],
    "doręczona gasi sygnał");
  /* Bez trackingu zostaje dawne kryterium: lepszy sygnał z daty nadania niż
     jego brak. Przewoźnik bywa nieznany, a Allegro nie zawsze odpowie. */
  assert.deepEqual(w({ przesylkaStatus: null, dostarczonoAt: null }), [],
    "brak trackingu → data nadania jak dawniej");
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

/* ── Ile sztuk wraca (0.176.0) ───────────────────────────────────────────────
   Zgłoszenie właściciela: „wraca dwie sztuki jest mylące, bo w tym zamówieniu
   wracała jedna". Plakietka niosła sam FAKT powrotu, a stała obok liczby
   KUPIONYCH sztuk — więc czytało się ją jako liczbę wracających.           */

test("pozycja zamówienia niesie osobno sztuki kupione i wracające", () => {
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 1899, offerId: "111" }]);
  zamowienie(d, "ord-1", [
    { offerId: "111", nazwa: "Uchwyt do kosy", sku: "50-025", cena: 1899, ilosc: 2 },
    { offerId: "222", nazwa: "Zraszacz", sku: null, cena: 3490 },
  ]);
  const zam = listaZwrotow(d, TERAZ)[0].zamowienie!;
  assert.equal(zam.pozycje[0].ilosc, 2, "kupione");
  assert.equal(zam.pozycje[0].wracaIlosc, 1, "wracające");
  assert.equal(zam.pozycje[1].wracaIlosc, 0, "pozycja spoza zwrotu");
});

test("ta sama oferta w dwóch wierszach zwrotu SUMUJE sztuki", () => {
  /* Zwrot potrafi wymienić tę samą ofertę dwa razy — `klucz` z przyrostkiem
     w `allegro-zwroty-sync.ts`. Wtedy „wraca 1" byłoby nieprawdą. */
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" },
    [{ ilosc: 1, cena: 1899, offerId: "111" }, { ilosc: 1, cena: 1899, offerId: "111" }]);
  zamowienie(d, "ord-1", [
    { offerId: "111", nazwa: "Uchwyt do kosy", sku: "50-025", cena: 1899, ilosc: 3 },
  ]);
  const zam = listaZwrotow(d, TERAZ)[0].zamowienie!;
  assert.equal(zam.pozycje[0].wracaIlosc, 2);
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

/* ── Decyzje biura: werdykt, ocena, kwota (0.156.0) ──────────────────────────
   Do tego wydania kolejka bramek była DEKORACJĄ. `kubelekZwrotu` routuje po
   czterech kolumnach — `werdykt`, `ocena` pozycji, `kwota_grosze`,
   `korekta_numer` — a żadnej z nich nic nie zapisywało. Każdy zwrot stał więc
   w DO DECYZJI na zawsze, chyba że ktoś odrzucił go w panelu Allegro.

   Ocena wchodzi razem z werdyktem i kwotą nie z rozpędu, tylko dlatego, że bez
   niej nic nie przechodzi z DO OCENY do DO ZWROTU — łańcucha nie dałoby się
   sprawdzić od początku do końca. */

let licznikZwrotow = 0;

function zwrotDoDecyzji(d: Db) {
  /* Konto i numery muszą być UNIKALNE przy każdym wywołaniu: jeden z testów
     stawia dwa zwroty obok siebie, żeby sprawdzić, że zaznaczenie nie sięga
     cudzych pozycji. */
  const n = ++licznikZwrotow;
  d.prepare(`INSERT INTO channel_account(channel,external_account_id)
    VALUES ('allegro',?) ON CONFLICT DO NOTHING`).run(`k-${n}`);
  const konto = Number((d.prepare(
    "SELECT id FROM channel_account WHERE channel='allegro' AND external_account_id=?")
    .get(`k-${n}`) as { id: number }).id);
  const id = Number(d.prepare(`INSERT INTO zwrot_klienta
    (channel_account_id,external_id,order_id,created_at,synced_at)
    VALUES (?,?,?,?,?)`).run(konto, `z-${n}`, `ord-${n}`,
      "2026-09-01T08:00:00Z", "2026-09-01T08:00:00Z").lastInsertRowid);
  const poz = [1, 2].map((i) => Number(d.prepare(`INSERT INTO zwrot_klienta_pozycja
    (zwrot_id,klucz,offer_id,nazwa,ilosc,cena_grosze,waluta)
    VALUES (?,?,?,?,?,?,?)`).run(id, `of-${n}-${i}`, `of-${n}-${i}`, `Część ${i}`, 1, 5000 * i, "PLN")
    .lastInsertRowid));
  return { konto, id, poz };
}

/* Konto MUSI istnieć: `werdykt_user_id` ma klucz obcy do `app_user`, a audyt
   wskazuje na nie przez `user_ref`. Test z wymyślonym identyfikatorem
   sprawdzałby bazę bez kluczy, czyli nie tę, na której chodzi serwer. */
function biuro(d: Db) {
  const id = Number(d.prepare(
    "INSERT INTO app_user(name,role) VALUES ('Biuro','biuro')").run().lastInsertRowid);
  return { id, name: "Biuro" };
}

test("przyjęcie zwrotu przesuwa go z DO DECYZJI do DO OCENY", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id } = zwrotDoDecyzji(d);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "decyzja");

  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);

  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "ocena");
});

test("odrzucenie wymaga powodu — bez niego nie zapisuje niczego", () => {
  /* §25a.5: odmowa jest nieodwracalna, więc musi nieść uzasadnienie. Zwrot
     odrzucony bez powodu nie da się później obronić przed klientem. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id } = zwrotDoDecyzji(d);

  assert.throws(() => rozstrzygnijZwrot(d, id, "odrzucony", "  ", 1, KTO), /powod|powód/i);
  assert.equal((d.prepare("SELECT werdykt FROM zwrot_klienta WHERE id=?")
    .get(id) as { werdykt: string | null }).werdykt, null);
});

test("ocena pozycji przesuwa zwrot dopiero, gdy ocenione są WSZYSTKIE", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);

  ocenPozycje(d, poz[0], "stan", 2, KTO);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "ocena",
    "jedna oceniona pozycja z dwóch to wciąż DO OCENY");

  ocenPozycje(d, poz[1], "utylizacja", 3, KTO);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "zwrot");
});

test("kwotę liczy SERWER z zaznaczenia, nie panel", () => {
  /* §25a.3: „Liczy ją serwer, panel niczego nie zgaduje". Panel przysyła
     ZAZNACZENIE, nie liczbę — inaczej dałoby się zapisać dowolną kwotę
     żądaniem z pominięciem ekranu. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[1], "stan", 3, KTO);

  const wynik = zapiszKwote(d, id, { pozycjeIds: [poz[0]], dostawa: false }, 4, KTO);
  assert.equal(wynik.kwotaGrosze, 5000, "sama pierwsza pozycja");

  const obie = zapiszKwote(d, id, { pozycjeIds: poz, dostawa: false }, 5, KTO);
  assert.equal(obie.kwotaGrosze, 15000, "obie pozycje");
});

test("zaznaczenie obcej pozycji odpada, zamiast po cichu podnieść kwotę", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const a = zwrotDoDecyzji(d);
  const b = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, a.id, "przyjety", null, 1, KTO);
  ocenPozycje(d, a.poz[0], "stan", 2, KTO);
  ocenPozycje(d, a.poz[1], "stan", 3, KTO);

  assert.throws(
    () => zapiszKwote(d, a.id, { pozycjeIds: [a.poz[0], b.poz[0]], dostawa: false }, 4, KTO),
    /pozycj/i);
});

test("stara wersja przegrywa — dwóch agentów nie zamyka zwrotu dwiema kwotami", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);

  assert.throws(() => rozstrzygnijZwrot(d, id, "odrzucony", "duplikat", 1, KTO),
    /wersj|inny agent/i);
});

test("każda decyzja zostawia ślad w audycie", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);

  const typy = (d.prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>)
    .map((e) => e.type);
  assert.ok(typy.some((t) => t.includes("werdykt")), `brak werdyktu w ${typy.join(",")}`);
  assert.ok(typy.some((t) => t.includes("ocena")), `brak oceny w ${typy.join(",")}`);
});

/* ── Korekta domyka kolejkę (0.162.0) ────────────────────────────────────────
   Piąty kubełek był ślepym zaułkiem: `kubelekZwrotu` routuje po
   `korekta_numer`, a tej kolumny nic nie zapisywało. Zwrot z zapisaną kwotą
   stał w DO KOREKTY na zawsze.

   Numer korekty jest PRZEPISYWANY Z SUBIEKTA ręką człowieka, więc pomyłka jest
   tu normalnym zdarzeniem, nie awarią — stąd cofnięcie z §25a.5.            */

function zwrotDoKorekty(d: Db, KTO: { id: number; name: string }) {
  const { id, poz } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[1], "stan", 3, KTO);
  zapiszKwote(d, id, { pozycjeIds: poz, dostawa: false }, 4, KTO);
  return { id, poz, wersja: 5 };
}

test("numer korekty zamyka zwrot i schodzi z kolejki pracy", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, wersja } = zwrotDoKorekty(d, KTO);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "korekta");

  zapiszKorekte(d, id, "KFS 12/2026", wersja, KTO);

  const z = listaZwrotow(d).find((x) => x.id === id)!;
  assert.equal(z.kubelek, "zamkniety");
  assert.equal(z.korektaNumer, "KFS 12/2026");
  /* Zamknięcie jest FAKTEM z godziną, nie wnioskiem z obecności numeru:
     inaczej nie da się powiedzieć, kiedy sprawa zeszła z biurka. */
  assert.notEqual((d.prepare("SELECT zamkniety_at FROM zwrot_klienta WHERE id=?")
    .get(id) as { zamkniety_at: string | null }).zamkniety_at, null);
});

test("korekta bez numeru nie przechodzi — pusty numer nie domyka niczego", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, wersja } = zwrotDoKorekty(d, KTO);
  assert.throws(() => zapiszKorekte(d, id, "   ", wersja, KTO), /numer/i);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.kubelek, "korekta");
});

test("korekta przed kwotą odpada — nie ma czego korygować", () => {
  /* Kolejność bramek jest UMOWĄ kolejki. Numer korekty zapisany przed kwotą
     przeskoczyłby zwrot z DO ZWROTU wprost do zamkniętych, czyli oddałby
     pieniądze, o których nikt nie zdecydował. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz } = zwrotDoDecyzji(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, KTO);
  ocenPozycje(d, poz[0], "stan", 2, KTO);
  ocenPozycje(d, poz[1], "stan", 3, KTO);

  assert.throws(() => zapiszKorekte(d, id, "KFS 12/2026", 4, KTO), /kwot/i);
});

test("cofnięcie korekty otwiera zwrot z powrotem — numer przepisuje człowiek", () => {
  /* §25a.5: potwierdzenie dostają dwie rzeczy nieodwracalne, reszta ma
     cofnięcie. Numer dokumentu przepisany z Subiekta to dokładnie ten rodzaj
     pomyłki, którą trzeba dać odkręcić. */
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, wersja } = zwrotDoKorekty(d, KTO);
  zapiszKorekte(d, id, "KFS 12/2026", wersja, KTO);

  cofnijKorekte(d, id, wersja + 1, KTO);

  const z = listaZwrotow(d).find((x) => x.id === id)!;
  assert.equal(z.kubelek, "korekta", "zwrot wraca do kubełka, nie do decyzji");
  assert.equal(z.korektaNumer, null);
  assert.equal((d.prepare("SELECT zamkniety_at FROM zwrot_klienta WHERE id=?")
    .get(id) as { zamkniety_at: string | null }).zamkniety_at, null);
  /* Kwota i werdykt ZOSTAJĄ: cofamy korektę, nie całą pracę nad zwrotem. */
  assert.equal(z.kwotaGrosze, 15000);
  assert.equal(z.werdykt, "przyjety");
});

test("zamknięty zwrot nie przyjmuje innych zmian niż cofnięcie korekty", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, poz, wersja } = zwrotDoKorekty(d, KTO);
  zapiszKorekte(d, id, "KFS 12/2026", wersja, KTO);

  assert.throws(() => ocenPozycje(d, poz[0], "przecena", wersja + 1, KTO), /zamkni/i);
  assert.throws(() => zapiszKwote(d, id, { pozycjeIds: poz, dostawa: true }, wersja + 1, KTO),
    /zamkni/i);
});

test("korekta i jej cofnięcie zostawiają ślad w dzienniku i na osi zwrotu", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, wersja } = zwrotDoKorekty(d, KTO);
  zapiszKorekte(d, id, "KFS 12/2026", wersja, KTO);
  cofnijKorekte(d, id, wersja + 1, KTO);

  const typy = (d.prepare("SELECT type FROM events WHERE type LIKE 'zwrot_korekta%' ORDER BY id")
    .all() as Array<{ type: string }>).map((w) => w.type);
  assert.deepEqual(typy, ["zwrot_korekta", "zwrot_korekta_cofnieta"]);

  const os = (d.prepare("SELECT rodzaj FROM zwrot_zdarzenie WHERE zwrot_id=? ORDER BY id")
    .all(id) as Array<{ rodzaj: string }>).map((w) => w.rodzaj);
  assert.deepEqual(os.filter((r) => r.startsWith("korekta")), ["korekta", "korekta_cofnieta"]);
});

test("dwóch agentów nie zamyka jednego zwrotu dwoma numerami", () => {
  const d = stanowisko();
  const KTO = biuro(d);
  const { id, wersja } = zwrotDoKorekty(d, KTO);
  zapiszKorekte(d, id, "KFS 12/2026", wersja, KTO);

  assert.throws(() => zapiszKorekte(d, id, "KFS 13/2026", wersja, KTO), /zmienił się|zamkni/i);
  assert.equal(listaZwrotow(d).find((z) => z.id === id)?.korektaNumer, "KFS 12/2026");
});

/* ── Skan etykiety zwrotnej (0.163.0) ────────────────────────────────────────
   Kod z prawdziwej etykiety InPostu, podany przez właściciela. Fikstura używa
   go dosłownie, bo test na wymyślonym „PX1" nie powiedziałby nic o tym, że
   dwadzieścia cztery cyfry przechodzą przez całą drogę. */

const ETYKIETA = "600000367616070023174201";

/** Zwrot z lądowiskiem — numer listu leży TYLKO tam, kolumny na niego nie ma. */
function zwrotZPaczka(d: Db, ext: string, numer: string | null, waybille: string[]) {
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
    created_at,synced_at) VALUES (1,?,?,?,?)`)
    .run(ext, numer, "2026-09-01T08:00:00Z", "2026-09-01T08:00:00Z");
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id=?")
    .get(ext) as { id: number }).id);
  d.prepare(`INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at)
    VALUES (?,?,?,?)`).run(ext, "2026-09-01T08:00:00Z",
      JSON.stringify({ id: ext, parcels: waybille.map((w) => ({ createdAt: "2026-09-02T07:00:00Z", waybill: w })) }),
      "2026-09-01T08:00:00Z");
  return id;
}

test("skan etykiety trafia w zwrot trzema drogami i mówi którą", () => {
  const d = stanowisko();
  const id = zwrotZPaczka(d, "3e895572-1111-4c0a-9f4e-000000000001", "1234/Z04A", [ETYKIETA]);
  zwrotZPaczka(d, "3e895572-2222-4c0a-9f4e-000000000002", "9999/Z04A", ["AD00R28X72"]);

  /* Numer listu — najczęstszy przypadek, bo to on jest na naklejce kuriera. */
  assert.deepEqual(znajdzZwrotPoKodzie(ETYKIETA, d),
    { trafienie: "waybill", zwrotId: id, zwroty: [] });
  /* Numer zwrotu bywa doklejony przez klienta. */
  assert.deepEqual(znajdzZwrotPoKodzie("1234/Z04A", d),
    { trafienie: "numer", zwrotId: id, zwroty: [] });
  /* Identyfikator z panelu Allegro. */
  assert.deepEqual(znajdzZwrotPoKodzie("3e895572-1111-4c0a-9f4e-000000000001", d),
    { trafienie: "external", zwrotId: id, zwroty: [] });
});

test("numer listu drugiego kuriera też otwiera zwrot", () => {
  /* `transportingWaybill` niesie numer przewoźnika, który fizycznie wiezie
     paczkę — przy dwóch kurierach na naklejce bywa właśnie ten. */
  const d = stanowisko();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,created_at,synced_at)
    VALUES (1,'zw-t','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`).run();
  const id = Number((d.prepare("SELECT id FROM zwrot_klienta WHERE external_id='zw-t'")
    .get() as { id: number }).id);
  d.prepare(`INSERT INTO allegro_zwrot(id,created_at,surowe_json,synced_at)
    VALUES ('zw-t','2026-09-01T08:00:00Z',?,'2026-09-01T08:00:00Z')`).run(
      JSON.stringify({ id: "zw-t", parcels: [{ waybill: "PIERWSZY", transportingWaybill: "DRUGI" }] }));

  assert.equal(znajdzZwrotPoKodzie("DRUGI", d).zwrotId, id);
});

test("dwa trafienia to brak trafienia — rozstrzyga człowiek", () => {
  /* Wzorzec `ktoMaTenKod` z `ean-alias.ts`: każde dodatkowe trafienie jest
     powodem odmowy, a nie zachętą do wzięcia pierwszego z brzegu. Przy zwrocie
     pomyłka znaczy cudzego klienta i cudze pieniądze. */
  const d = stanowisko();
  const a = zwrotZPaczka(d, "zw-a", "1111/Z04A", [ETYKIETA]);
  const b = zwrotZPaczka(d, "zw-b", "2222/Z04A", [ETYKIETA]);

  const wynik = znajdzZwrotPoKodzie(ETYKIETA, d);
  assert.equal(wynik.trafienie, "wiele");
  assert.equal(wynik.zwrotId, null, "żaden zwrot nie otwiera się sam");
  assert.deepEqual(wynik.zwroty.map((z) => z.id), [a, b]);
  assert.deepEqual(wynik.zwroty.map((z) => z.numer), ["1111/Z04A", "2222/Z04A"]);
});

test("nieznany kod to nie błąd, tylko brak", () => {
  const d = stanowisko();
  zwrotZPaczka(d, "zw-1", "1234/Z04A", [ETYKIETA]);
  assert.deepEqual(znajdzZwrotPoKodzie("600000000000000000000000", d),
    { trafienie: null, zwrotId: null, zwroty: [] });
  /* Pusty kod nie ma prawa oddać przypadkowego zwrotu. */
  assert.equal(znajdzZwrotPoKodzie("   ", d).trafienie, null);
});

test("dopasowanie jest DOKŁADNE, nigdy po fragmencie", () => {
  /* Fragment numeru listu wskazałby cudzą przesyłkę przy pierwszym kurierze,
     który numeruje po kolei. */
  const d = stanowisko();
  zwrotZPaczka(d, "zw-1", "1234/Z04A", [ETYKIETA]);
  assert.equal(znajdzZwrotPoKodzie(ETYKIETA.slice(0, 20), d).trafienie, null);
  assert.equal(znajdzZwrotPoKodzie("1234", d).trafienie, null);
});

test("zwrot bez lądowiska nie wywraca szukania", () => {
  /* Lądowisko bywa skasowane ręcznie (DEPLOY §0.153.0 każe to zrobić przy
     aktualizacji), a kolejka ma wtedy działać dalej. */
  const d = stanowisko();
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,reference_number,
    created_at,synced_at) VALUES (1,'zw-1','1234/Z04A','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`)
    .run();
  assert.equal(znajdzZwrotPoKodzie(ETYKIETA, d).trafienie, null);
  assert.ok(znajdzZwrotPoKodzie("1234/Z04A", d).zwrotId, "numer zwrotu dalej działa");
});

/* ── Cztery rzeczy, o które prosiło biuro zwrotów (0.169.0) ─────────────── */

test("wiersz niesie kupującego i przewoźnika, bez pobranego zamówienia", () => {
  /* Login przy ZWROCIE, nie tylko przy zamówieniu: zwrot niesie go zawsze,
     a zamówienie bywa jeszcze niepobrane. */
  const d = stanowisko();
  dodaj(d, "2026-08-30T09:00:00Z", { kupujacy_login: "mirek352810", przewoznik: "INPOST" });
  const [z] = listaZwrotow(d, TERAZ);
  assert.equal(z.kupujacyLogin, "mirek352810");
  assert.equal(z.przewoznik, "INPOST");
  assert.equal(z.zamowienie, null, "zamówienia nie ma, a login i tak jest");
});

test("kod towaru: symbol z kartoteki, EAN z kartoteki, SKU z zamówienia", () => {
  /* Allegro EAN-u przy zwrocie nie podaje wcale, a SKU niesie POZYCJA
     ZAMÓWIENIA — pozycja zwrotu ma w specyfikacji samo `offerId`. */
  const d = stanowisko();
  towar(d, 70, "SEK-46", "5901234123457");
  zamowienie(d, "ord-9", [{ offerId: "of-1", nazwa: "Sekator", sku: "SEK-46", cena: 4999 }]);
  dodaj(d, "2026-08-30T09:00:00Z", { order_id: "ord-9" },
    [{ ilosc: 1, cena: 4999, offerId: "of-1", twId: 70, twSymbol: "SEK-46", twZrodlo: "sku" }]);

  const [p] = listaZwrotow(d, TERAZ)[0].pozycje;
  assert.equal(p.twSymbol, "SEK-46");
  assert.equal(p.ean, "5901234123457");
  assert.equal(p.sku, "SEK-46");
});

test("bez potwierdzonej kartoteki EAN-u nie zgadujemy", () => {
  /* EAN wisi przy kartotece, a kartotekę wskazuje człowiek. Propozycja
     automatu nie jest jeszcze faktem i nie ma prawa dokleić kodu. */
  const d = stanowisko();
  towar(d, 70, "SEK-46", "5901234123457");
  dodaj(d, "2026-08-30T09:00:00Z", {}, [{ ilosc: 1, cena: 4999 }]);
  assert.equal(listaZwrotow(d, TERAZ)[0].pozycje[0].ean, null);
});

test("zwrot pokazuje rozmowy o TYM zakupie, po numerze zamówienia", () => {
  /* Mostkiem jest `message.related_order_id` z 0.166.0 — ani jednego nowego
     żądania do Allegro. Jeden zakup potrafi mieć kilka wątków, więc lista. */
  const d = stanowisko();
  rozmowa(d, "w-1", "ord-9", "Pytanie o zwrot", "2026-08-31T10:00:00Z");
  rozmowa(d, "w-2", "ord-9", "Druga wiadomość", "2026-09-01T08:00:00Z");
  rozmowa(d, "w-3", "ord-INNE", "Cudza sprawa", "2026-09-01T09:00:00Z");
  rozmowa(d, "w-4", null, "Bez zamówienia", "2026-09-01T09:30:00Z");
  dodaj(d, "2026-08-30T09:00:00Z", { order_id: "ord-9" });

  const [z] = listaZwrotow(d, TERAZ);
  assert.equal(z.rozmowy.length, 2, "dwie rozmowy o tym zakupie, ani jednej cudzej");
  assert.deepEqual(z.rozmowy.map((r) => r.temat), ["Druga wiadomość", "Pytanie o zwrot"],
    "najnowsza na górze");
  assert.equal(z.rozmowy[0].status, "open", "status rozmowy jedzie razem z nią");
});

test("zwrot bez powiązanych wiadomości ma pustą listę, a nie brak pola", () => {
  /* Puste znaczy „Allegro nic nie powiązało", nie „klient nie pisał" —
     i ekran ma prawo powiedzieć to wprost. */
  const d = stanowisko();
  dodaj(d, "2026-08-30T09:00:00Z", { order_id: "ord-9" });
  assert.deepEqual(listaZwrotow(d, TERAZ)[0].rozmowy, []);
});

test("CSV dla biura ma średniki, jeden wiersz na pozycję i żadnego listu przewozowego", () => {
  /* Separator `;`, bo Excel PL otwiera taki plik bez kreatora importu.
     Numeru listu nie wynosimy na dysk — polityka danych zwrotów z 0.163.0. */
  const d = stanowisko();
  towar(d, 70, "SEK-46", "5901234123457");
  zamowienie(d, "ord-9", [{ offerId: "of-1", nazwa: "Sekator", sku: "SEK-46", cena: 4999 }]);
  dodaj(d, "2026-08-30T09:00:00Z",
    { order_id: "ord-9", kupujacy_login: "mirek352810", przewoznik: "DPD" },
    [{ ilosc: 1, cena: 4999, offerId: "of-1", twId: 70, twSymbol: "SEK-46" },
      { ilosc: 2, cena: 1000, offerId: "of-2", nazwa: "Filtr" }]);

  const csv = csvZwrotow(listaZwrotow(d, TERAZ));
  const linie = csv.trim().split("\r\n");
  assert.equal(linie.length, 3, "nagłówek i dwie pozycje");
  assert.match(linie[0], /^﻿?Zrodlo;Numer zwrotu;/, "BOM i średniki, żeby Excel PL nie pytał");
  assert.match(linie[1], /^zwrot klienta;/, "wiersz mówi, czy to zgłoszenie, czy nieodebrana");
  assert.match(linie[1], /mirek352810;/);
  assert.match(linie[1], /DPD;/);
  assert.match(linie[1], /5901234123457/, "EAN wchodzi do zestawienia");
  assert.match(linie[2], /Filtr;/);
  assert.equal(csv.includes("waybill"), false, "numeru listu w pliku nie ma");
});

test("zwrot bez pozycji też dostaje wiersz w zestawieniu", () => {
  /* Inaczej zniknąłby z pliku i nikt by się nie dowiedział, że jest. */
  const d = stanowisko();
  dodaj(d, "2026-08-30T09:00:00Z", {}, []);
  assert.equal(csvZwrotow(listaZwrotow(d, TERAZ)).trim().split("\r\n").length, 2);
});

/* ── Potrącenie za utratę wartości (0.170.0) ────────────────────────────── */

const KTO = { id: 1, name: "Ala z biura" };

test("potrącenie obniża kwotę do oddania, a liczy ją nadal SERWER", () => {
  /* §25a.3 zostaje: panel przysyła zaznaczenie, nie sumę. Potrącenie jest
     osobnym, walidowanym zapisem przy pozycji. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" },
    [{ ilosc: 1, cena: 10000, ocena: "stan" }]);
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);

  const w = zapiszPotracenie(d, poz, 3000, "ślady użycia na ostrzu", 1, KTO);
  assert.equal(w.potracenieGrosze, 3000);

  const zapis = zapiszKwote(d, id, { pozycjeIds: [poz], dostawa: false }, w.wersja, KTO);
  assert.equal(zapis.kwotaGrosze, 7000, "sto złotych minus trzydzieści potrącenia");
});

test("potrącenie nie może przekroczyć wartości pozycji", () => {
  /* Większe znaczyłoby, że klient nam dopłaca za własny zwrot. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" },
    [{ ilosc: 2, cena: 5000 }]);
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);

  assert.throws(() => zapiszPotracenie(d, poz, 10001, "powód", 1, KTO),
    /nie może przekroczyć wartości pozycji/);
  /* Widełki liczą się z ceny RAZY ilość, więc dziesięć tysięcy przechodzi. */
  assert.equal(zapiszPotracenie(d, poz, 10000, "całość do utylizacji", 1, KTO)
    .potracenieGrosze, 10000);
});

test("potrącenie bez powodu nie przechodzi — powód zobaczy klient", () => {
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" });
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);
  assert.throws(() => zapiszPotracenie(d, poz, 500, "   ", 1, KTO),
    /wymaga powodu/);
  assert.throws(() => zapiszPotracenie(d, poz, -1, "powód", 1, KTO), /nie mniej niż zero/);
});

test("potrącenie ma sens dopiero po przyjęciu zwrotu", () => {
  /* Tak samo jak ocena: obniżanie kwoty przy zwrocie, którego nie
     przyjmujemy, zostawiałoby decyzję o pieniądzach, które i tak nie wyjdą. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z");
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);
  assert.throws(() => zapiszPotracenie(d, poz, 500, "powód", 1, KTO), /Najpierw przyjmij/);
});

test("potrącenie da się cofnąć, razem z powodem i autorem", () => {
  /* Cofnięcie zamiast potwierdzenia — §25a.5, ta sama droga co przy ocenie. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" },
    [{ ilosc: 1, cena: 10000, ocena: "stan" }]);
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);

  const w = zapiszPotracenie(d, poz, 2500, "zarysowana obudowa", 1, KTO);
  assert.equal(listaZwrotow(d, TERAZ)[0].pozycje[0].potraceniePowod, "zarysowana obudowa");

  zapiszPotracenie(d, poz, null, "", w.wersja, KTO);
  const p = listaZwrotow(d, TERAZ)[0].pozycje[0];
  assert.equal(p.potracenieGrosze, null);
  assert.equal(p.potraceniePowod, null, "powód znika razem z kwotą");
});

test("potrącenie zostawia ślad w dzienniku, razem z powodem", () => {
  /* Każda mutacja ma autora — a przy pieniądzach klienta tym bardziej. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" });
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);
  zapiszPotracenie(d, poz, 1500, "brak opakowania", 1, KTO);

  const e = d.prepare("SELECT type, payload FROM events WHERE type='zwrot_potracenie'")
    .get() as { type: string; payload: string };
  assert.ok(e, "zdarzenie jest");
  assert.match(e.payload, /brak opakowania/);
});

test("potrącenie wchodzi do zestawienia CSV razem z powodem", () => {
  const d = stanowisko();
  const id = dodaj(d, "2026-08-30T09:00:00Z", { werdykt: "przyjety" },
    [{ ilosc: 1, cena: 10000, ocena: "stan" }]);
  const poz = Number((d.prepare("SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { id: number }).id);
  zapiszPotracenie(d, poz, 2500, "ślady użycia", 1, KTO);

  const csv = csvZwrotow(listaZwrotow(d, TERAZ));
  assert.match(csv, /Potracenie;Powod potracenia;/);
  assert.match(csv, /25,00;ślady użycia/);
});

/* ── Paczki nieodebrane (0.172.0) ───────────────────────────────────────── */

test("nieodebrana paczka wchodzi w kolejkę, ale nie udaje zgłoszenia klienta", () => {
  /* Allegro takiego bytu nie zna — `CustomerReturn` powstaje z DEKLARACJI
     klienta. Pieniądze i tak trzeba oddać, więc idzie tą samą drogą. */
  const d = stanowisko();
  const w = zarejestrujNieodebrana(d, { waybill: "600000367616070023174201" }, KTO);

  const [z] = listaZwrotow(d, TERAZ);
  assert.equal(z.id, w.zwrotId);
  assert.equal(z.zrodlo, "nieodebrana");
  assert.equal(z.kubelek, "decyzja", "idzie tą samą kolejką co zwrot z Allegro");
  assert.match(z.externalId, /^nieodebrana:/, "identyfikator mówi, skąd jest");
  assert.equal(z.linkZwrotu, null, "w Allegro nie ma czego otworzyć");
  assert.ok(z.paczkaAt, "paczka JEST u nas — inaczej nie byłoby czego rejestrować");
});

test("paczkę nieodebraną znajduje skan po numerze listu", () => {
  /* Numer z etykiety jest tu JEDYNYM uchwytem: nie ma kopii odpowiedzi
     Allegro, w której dałoby się go szukać. Stąd świadomy wyjątek od
     polityki z 0.163.0. */
  const d = stanowisko();
  const w = zarejestrujNieodebrana(d, { waybill: "AD00R28X72" }, KTO);
  const t = znajdzZwrotPoKodzie("AD00R28X72", d);
  assert.equal(t.trafienie, "waybill");
  assert.equal(t.zwrotId, w.zwrotId);
});

test("przyrostek klucza liczy POWTÓRZENIA, nie numery wierszy", () => {
  /* Poprawka 0.174.2. Do niej przyrostek brał numer wiersza z pętli, więc
     druga pozycja zamówienia dostawała `|#2`, choć niczego nie powtarzała.
     Taki napis w kluczu zderzał się potem w migracji z prawdziwym duplikatem
     sąsiada i kładł start aplikacji w pętli restartów. */
  const d = stanowisko();
  zamowienie(d, "ord-dup", [
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
    { offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 },
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
  ]);
  const w = zarejestrujNieodebrana(d, { waybill: "PX9", orderId: "ord-dup" }, KTO);
  const klucze = (d.prepare(
    "SELECT klucz FROM zwrot_klienta_pozycja WHERE zwrot_id=? ORDER BY id")
    .all(w.zwrotId) as Array<{ klucz: string }>).map((r) => r.klucz);

  /* Łopata jest druga w zamówieniu, ale pierwsza swojego rodzaju. */
  assert.deepEqual(klucze, ["111|Sekator", "222|Łopata", "111|Sekator|#2"]);
});

test("ta sama paczka nie rejestruje się dwa razy", () => {
  /* Skan powtórzony przy odkładaniu kartonu jest zdarzeniem normalnym. */
  const d = stanowisko();
  zarejestrujNieodebrana(d, { waybill: "PX1" }, KTO);
  assert.throws(() => zarejestrujNieodebrana(d, { waybill: "PX1" }, KTO),
    /już zarejestrowana/);
});

test("bez numeru listu nie ma czego rejestrować", () => {
  const d = stanowisko();
  assert.throws(() => zarejestrujNieodebrana(d, { waybill: "   " }, KTO),
    /jedynym uchwytem/);
});

test("znane zamówienie oddaje swoje pozycje, żeby było co wycenić", () => {
  /* Operator nie wie, co w paczce jest, dopóki jej nie otworzy — a bez pozycji
     zwrot nie miałby czego wycenić. */
  const d = stanowisko();
  zamowienie(d, "ord-N", [
    { offerId: "of-1", nazwa: "Sekator", sku: "SEK-46", cena: 4999 },
    { offerId: "of-2", nazwa: "Filtr", sku: null, cena: 1000, ilosc: 2 }]);
  const w = zarejestrujNieodebrana(d,
    { waybill: "PX2", orderId: "ord-N", notatka: "awizo dwa razy" }, KTO);
  assert.equal(w.pozycji, 2);

  const [z] = listaZwrotow(d, TERAZ);
  assert.equal(z.notatka, "awizo dwa razy");
  assert.deepEqual(z.pozycje.map((p) => p.nazwa), ["Sekator", "Filtr"]);
  assert.equal(z.sumaPozycjiGrosze, 4999 + 2000, "cena razy ilość, jak wszędzie");
  assert.ok(z.zamowienie, "zamówienie dopina się tą samą drogą co przy zwrocie");
});

test("nieznane zamówienie nie wstrzymuje rejestracji", () => {
  /* Paczka leży na biurku niezależnie od tego, czy zamówienie już pobraliśmy. */
  const d = stanowisko();
  const w = zarejestrujNieodebrana(d, { waybill: "PX3", orderId: "ord-NIEZNANE" }, KTO);
  assert.equal(w.pozycji, 0);
  assert.equal(listaZwrotow(d, TERAZ)[0].pozycje.length, 0);
});

test("rejestracja zostawia ślad w dzienniku", () => {
  const d = stanowisko();
  zarejestrujNieodebrana(d, { waybill: "PX4" }, KTO);
  const e = d.prepare("SELECT type FROM events WHERE type='zwrot_nieodebrana'").get();
  assert.ok(e, "każda mutacja ma autora, także ta");
});

test("zestawienie CSV odróżnia paczkę nieodebraną od zgłoszenia", () => {
  const d = stanowisko();
  zarejestrujNieodebrana(d, { waybill: "PX5" }, KTO);
  assert.match(csvZwrotow(listaZwrotow(d, TERAZ)), /nieodebrana paczka;/);
});

/* ── Login kupującego (0.177.0) ──────────────────────────────────────────────
   Zgłoszenie właściciela: „nie widzę nigdzie w otwartym zwrocie loginu
   klienta". Login niesie Allegro w DWÓCH odpowiedziach — przy zwrocie i przy
   zamówieniu — a ekran czytał wyłącznie pierwszą.                           */

test("login kupującego spada z zamówienia, gdy zwrot go nie niesie", () => {
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" }, [{ ilosc: 1, cena: 4999 }]);
  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator", sku: "SEK-46", cena: 4999 }]);
  d.prepare("UPDATE zamowienie_klienta SET kupujacy_login='mirek352810' WHERE external_id='ord-1'")
    .run();

  assert.equal(listaZwrotow(d, TERAZ)[0].kupujacyLogin, "mirek352810");
});

test("login ze zwrotu ma pierwszeństwo nad loginem z zamówienia", () => {
  /* Zwrot jest bliżej sprawy: to jego kupujący zgłosił zwrot. */
  const d = stanowisko();
  const id = dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" }, [{ ilosc: 1, cena: 4999 }]);
  d.prepare("UPDATE zwrot_klienta SET kupujacy_login='ze_zwrotu' WHERE id=?").run(id);
  zamowienie(d, "ord-1", [{ offerId: "111", nazwa: "Sekator", sku: "SEK-46", cena: 4999 }]);
  d.prepare("UPDATE zamowienie_klienta SET kupujacy_login='z_zamowienia' WHERE external_id='ord-1'")
    .run();

  assert.equal(listaZwrotow(d, TERAZ)[0].kupujacyLogin, "ze_zwrotu");
});

test("bez obu źródeł login zostaje pusty — zgadywania nie ma", () => {
  const d = stanowisko();
  dodaj(d, "2026-08-31T00:00:00Z", { order_id: "ord-1" }, [{ ilosc: 1, cena: 4999 }]);
  assert.equal(listaZwrotow(d, TERAZ)[0].kupujacyLogin, null);
});

/* ── Produkt dopisany przez biuro (0.184.0) ──────────────────────────────────
   Klient zgłasza jedną rzecz, a odsyła dwie. Regulamin Allegro tej zgodności
   nie wymaga — liczy się terminowe oświadczenie o odstąpieniu, nie zgodność
   przesyłki ze zgłoszeniem. Pieniądze i tak trzeba oddać.                    */

test("do dopisania zostaje RÓŻNICA zamówienia i zwrotu, nie całe zamówienie", () => {
  /* Pokazanie pozycji już zgłoszonych kazałoby porównywać dwie listy oczami —
     a to jest praca, którą ekran ma zdjąć (dekalog ergonomii, punkt 5). */
  const d = stanowisko();
  zamowienie(d, "ord-2", [
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
    { offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 },
  ]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-2" },
    [{ ilosc: 1, cena: 4999, offerId: "111", nazwa: "Sekator" }]);

  const lista = doDopisania(id, d);
  assert.equal(lista.length, 1, "Sekator jest już w zwrocie");
  assert.equal(lista[0].nazwa, "Łopata");
  assert.equal(lista[0].cenaGrosze, 2999, "cena idzie z zamówienia, nie z pola");
});

test("dopisana pozycja jest oznaczona jako BIURO i podnosi wersję", () => {
  const d = stanowisko();
  zamowienie(d, "ord-3", [
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
    { offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 },
  ]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-3" },
    [{ ilosc: 1, cena: 4999, offerId: "111", nazwa: "Sekator" }]);

  const kandydat = doDopisania(id, d)[0];
  const w = dopiszPozycje(d, id, kandydat.zamPozycjaId, 1, KTO);
  assert.equal(w.wersja, 2);

  const p = d.prepare("SELECT nazwa, zrodlo, cena_grosze FROM zwrot_klienta_pozycja WHERE id=?")
    .get(w.pozycjaId) as { nazwa: string; zrodlo: string; cena_grosze: number };
  assert.equal(p.nazwa, "Łopata");
  assert.equal(p.zrodlo, "biuro", "ekran ma mówić, że to zapis człowieka (§4.3)");
  assert.equal(Number(p.cena_grosze), 2999);
  /* Każda mutacja zostawia ślad. */
  const ev = d.prepare("SELECT COUNT(*) n FROM events WHERE type='zwrot_pozycja_dopisana'")
    .get() as { n: number };
  assert.equal(Number(ev.n), 1);
});

test("tej samej pozycji nie dopisze się dwa razy", () => {
  /* Ograniczenie jest tańsze od komunikatu (dekalog, punkt 6): po dopisaniu
     pozycja znika z listy kandydatów, więc drugie kliknięcie nie ma czego wziąć. */
  const d = stanowisko();
  zamowienie(d, "ord-4", [{ offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 }]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-4" }, []);
  const kandydat = doDopisania(id, d)[0];
  dopiszPozycje(d, id, kandydat.zamPozycjaId, 1, KTO);

  assert.deepEqual(doDopisania(id, d), []);
  assert.throws(() => dopiszPozycje(d, id, kandydat.zamPozycjaId, 2, KTO),
    /nie ma na liście do dopisania/);
});

test("pozycji z CUDZEGO zamówienia dopisać się nie da", () => {
  const d = stanowisko();
  zamowienie(d, "ord-moje", [{ offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 }]);
  zamowienie(d, "ord-cudze", [{ offerId: "999", nazwa: "Kosa", sku: null, cena: 8999 }]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-moje" }, []);
  const cudza = Number((d.prepare(`SELECT p.id FROM zamowienie_klienta_pozycja p
    JOIN zamowienie_klienta k ON k.id=p.zamowienie_id WHERE k.external_id='ord-cudze'`)
    .get() as { id: number }).id);
  assert.throws(() => dopiszPozycje(d, id, cudza, 1, KTO), /nie ma na liście/);
});

test("dopisaną pozycję da się zdjąć, pozycji klienta NIE", () => {
  /* Cofnięcie zamiast potwierdzenia (§25a.5). Pozycja ze zgłoszenia wróciłaby
     przy najbliższym takcie, więc przycisk obiecywałby skutek, którego nie ma. */
  const d = stanowisko();
  zamowienie(d, "ord-5", [
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
    { offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 },
  ]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-5" },
    [{ ilosc: 1, cena: 4999, offerId: "111", nazwa: "Sekator" }]);
  const zgloszona = Number((d.prepare(
    "SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=?").get(id) as { id: number }).id);

  const w = dopiszPozycje(d, id, doDopisania(id, d)[0].zamPozycjaId, 1, KTO);
  assert.throws(() => usunDopisanaPozycje(d, zgloszona, 2, KTO), /nie dopisało biuro/);

  const po = usunDopisanaPozycje(d, w.pozycjaId, 2, KTO);
  assert.equal(po.wersja, 3);
  const ile = d.prepare("SELECT COUNT(*) n FROM zwrot_klienta_pozycja WHERE zwrot_id=?")
    .get(id) as { n: number };
  assert.equal(Number(ile.n), 1);
});

test("dopisana pozycja wchodzi do kwoty jak każda inna", () => {
  /* §25a.3 zostaje: panel przysyła ZAZNACZENIE, sumę składa serwer. */
  const d = stanowisko();
  zamowienie(d, "ord-6", [
    { offerId: "111", nazwa: "Sekator", sku: null, cena: 4999 },
    { offerId: "222", nazwa: "Łopata", sku: null, cena: 2999 },
  ]);
  const id = dodaj(d, "2026-08-28T09:00:00Z", { order_id: "ord-6" },
    [{ ilosc: 1, cena: 4999, offerId: "111", nazwa: "Sekator" }]);
  /* Werdykt ma klucz obcy do `app_user`, więc autor musi istnieć naprawdę. */
  const agent = biuro(d);
  rozstrzygnijZwrot(d, id, "przyjety", null, 1, agent);
  const w = dopiszPozycje(d, id, doDopisania(id, d)[0].zamPozycjaId, 2, agent);

  const wszystkie = (d.prepare(
    "SELECT id FROM zwrot_klienta_pozycja WHERE zwrot_id=? ORDER BY id").all(id) as
    Array<{ id: number }>).map((r) => Number(r.id));
  const k = zapiszKwote(d, id, { pozycjeIds: wszystkie, dostawa: false }, w.wersja, agent);
  assert.equal(k.kwotaGrosze, 4999 + 2999, "obie pozycje liczą się do kwoty");
});
