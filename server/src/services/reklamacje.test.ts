import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import {
  adresZalacznika, BladReklamacji, czyObrazZNazwy, dniDoTerminu, kubelek,
  licznikiKubelkow, listaReklamacji, ReklamacjaConflict, stempelProwadzi, sygnaly,
  szczegolReklamacji, zapiszNotatke,
} from "./reklamacje.js";

/* Ten plik pilnuje reguł, których na ekranie nie widać: że kolejka ustawia się
   po TERMINIE DECYZJI, że kubełek liczy się ze stanu (a nie stoi w kolumnie),
   że każda mutacja zostawia ślad w dzienniku BEZ treści i że konflikt wersji
   wraca jako konflikt, a nie jako cicha nadpisana notatka. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const TERAZ = Date.parse("2026-09-07T12:00:00.000Z");

/** Trzy konta biura; ALA i ALA_IMIENNICZKA mają TO SAMO imię i różne numery. */
const ALA = { id: 1, name: "A. Lewandowska" };
const MAREK = { id: 2, name: "M. Wójcik" };
const ALA_IMIENNICZKA = { id: 3, name: "A. Lewandowska" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  /* Konta PRZED sprawami: od 0.278.0 znacznik „prowadzę" niesie `user_id`,
     a klucz obcy nie wybacza. Dwie Ale stoją tu celowo — to jest scenariusz,
     dla którego kolumna w ogóle powstała. */
  for (const [uid, login, imie] of [
    [1, "ala", "A. Lewandowska"], [2, "marek", "M. Wójcik"], [3, "ala2", "A. Lewandowska"],
  ] as Array<[number, string, string]>) {
    d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (?,?,?,'biuro')")
      .run(uid, login, imie);
  }
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);

  const dodaj = (w: {
    ext: string; status?: string; termin?: string | null; ostatnia?: string | null;
    czat?: number; order?: string | null; zwrot?: number | null;
  }) => Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,reference_number,order_id,kupujacy_login,
     status_allegro,decyzja_do,ostatnia_wiadomosc_status,czat_aktywny,zwrot_wymagany,
     otwarto_at,synced_at)
    VALUES (?,?,?,?,'kupujacy1',?,?,?,?,?,'2026-09-01T08:00:00Z','2026-09-07T11:00:00Z')`)
    .run(konto, w.ext, `nr-${w.ext}`, w.order ?? null,
      w.status ?? "CLAIM_SUBMITTED", w.termin === undefined ? "2026-09-20T10:00:00Z" : w.termin,
      w.ostatnia ?? null, w.czat ?? 1, w.zwrot ?? null).lastInsertRowid);

  return { d, konto, dodaj };
}

const zdarzenia = (d: DatabaseSync, type: string) => d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string | null }>;

test("kolejka ustawia się po TERMINIE DECYZJI, sprawy bez terminu na końcu", () => {
  const { d, dodaj } = stanowisko();
  dodaj({ ext: "pozno", termin: "2026-09-30T10:00:00Z" });
  dodaj({ ext: "bez", termin: null });
  dodaj({ ext: "pilne", termin: "2026-09-08T10:00:00Z" });

  const lista = listaReklamacji(d, TERAZ);
  assert.deepEqual(lista.map((r) => r.externalId), ["pilne", "pozno", "bez"],
    "pytanie biura brzmi „co się dziś przeterminuje”, nie „co przyszło pierwsze”");
  /* Brak terminu to brak liczby. Zero kłamałoby, że decyzja przypada dziś. */
  assert.equal(lista[2].dniDoTerminu, null);
  assert.equal(lista[2].poTerminie, false);
  assert.equal(lista[0].dniDoTerminu, 0, "termin jutro rano to dziś niecały dzień");
});

test("dni do terminu liczą się w obie strony, a zła data nie wywraca ekranu", () => {
  assert.equal(dniDoTerminu("2026-09-10T12:00:00.000Z", TERAZ), 3);
  assert.equal(dniDoTerminu("2026-09-05T12:00:00.000Z", TERAZ), -2);
  assert.equal(dniDoTerminu(null, TERAZ), null);
  assert.equal(dniDoTerminu("kiedyś", TERAZ), null);
});

test("DO DECYZJI trzyma wszystko przed werdyktem, także sprawy z nową wiadomością", () => {
  /* Obowiązek wobec terminu jest jeden i to on rządzi kolejnością pracy.
     Przeniesienie takiej sprawy do DO ODPOWIEDZI zaniżyłoby licznik spraw
     z zegarem — czyli jedyną liczbę, dla której ten ekran powstał. */
  assert.equal(kubelek({
    statusAllegro: "CLAIM_SUBMITTED", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: true,
  }), "decyzja");
  assert.equal(kubelek({
    statusAllegro: "CLAIM_ACCEPTED", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: true,
  }), "odpowiedz");
  assert.equal(kubelek({
    statusAllegro: "CLAIM_REJECTED", ostatniaWiadomoscStatus: "SELLER_REPLIED", czatAktywny: true,
  }), "zamknieta");
  /* Rozstrzygnięta z zamkniętym czatem: klient czeka, ale Allegro nowej
     wiadomości nie przyjmie, więc to nie jest praca do zrobienia. */
  assert.equal(kubelek({
    statusAllegro: "CLAIM_ACCEPTED", ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: false,
  }), "zamknieta");
});

test("sygnały mówią o terminie, kliencie, doradcy i zamkniętym czacie", () => {
  const s = sygnaly({
    statusAllegro: "CLAIM_SUBMITTED", dniDoTerminu: 2,
    ostatniaWiadomoscStatus: "BUYER_REPLIED", czatAktywny: false, zwrotWymagany: true,
  });
  assert.deepEqual(s, ["termin", "klient_czeka", "czat_zamkniety", "zwrot_wymagany"]);

  /* Doradca Allegro w rozmowie zmienia ton odpowiedzi — czyta ją trzecia
     strona. Sonda widziała go w 61 sprawach na 100. */
  assert.ok(sygnaly({
    statusAllegro: "CLAIM_SUBMITTED", dniDoTerminu: 30,
    ostatniaWiadomoscStatus: "ALLEGRO_ADVISOR_REPLIED", czatAktywny: true, zwrotWymagany: null,
  }).includes("doradca"));

  /* Termin przy sprawie ROZSTRZYGNIĘTEJ milczy: decyzji już nie ma. */
  assert.deepEqual(sygnaly({
    statusAllegro: "CLAIM_ACCEPTED", dniDoTerminu: -5,
    ostatniaWiadomoscStatus: "SELLER_REPLIED", czatAktywny: true, zwrotWymagany: null,
  }), []);

  /* Status spoza specyfikacji NIE JEST BŁĘDEM — zapala sygnał i czeka na
     potwierdzenie na żywym koncie. */
  assert.ok(sygnaly({
    statusAllegro: "CLAIM_PENDING_SOMETHING", dniDoTerminu: null,
    ostatniaWiadomoscStatus: null, czatAktywny: true, zwrotWymagany: null,
  }).includes("status_nieznany"));
});

test("liczniki kubełków zgadzają się z tym, co pokazuje lista", () => {
  const { d, dodaj } = stanowisko();
  dodaj({ ext: "a" });
  dodaj({ ext: "b" });
  dodaj({ ext: "c", status: "CLAIM_ACCEPTED", ostatnia: "BUYER_REPLIED" });
  dodaj({ ext: "e", status: "CLAIM_REJECTED", ostatnia: "SELLER_REPLIED" });

  const lista = listaReklamacji(d, TERAZ);
  assert.deepEqual(licznikiKubelkow(lista), { decyzja: 2, odpowiedz: 1, zamknieta: 1 });
});

test("„prowadzę” jest ZNACZNIKIEM: drugie kliknięcie tej samej osoby je zdejmuje", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });

  const po = stempelProwadzi(d, id, ALA);
  assert.equal(po.prowadzi, "A. Lewandowska");
  assert.equal(po.wersja, 2, "każda mutacja podnosi wersję");

  const zdjete = stempelProwadzi(d, id, ALA);
  assert.equal(zdjete.prowadzi, null, "droga wyjścia z pomyłkowego przejęcia");

  /* Kolega bierze sprawę po sobie — to znacznik, nie zamek, więc przechodzi. */
  const kolega = stempelProwadzi(d, id, MAREK);
  assert.equal(kolega.prowadzi, "M. Wójcik");

  const slad = zdarzenia(d, "reklamacja_prowadzi");
  assert.equal(slad.length, 3, "każda mutacja zostawia ślad (blizna 0.137.1)");
  assert.equal(slad[0].user_id, "A. Lewandowska");
});

test("imienniczka NIE zdejmuje cudzego znacznika — cała racja bytu kolumny", () => {
  /* To jest błąd, którego do 0.278.0 nie dało się zauważyć. Przełącznik
     porównywał IMIONA, więc druga A. Lewandowska klikała „prowadzę" i zamiast
     wziąć sprawę — zdejmowała znacznik pierwszej. Bez komunikatu, bez śladu
     w oczach obu, a objawem była sprawa znikająca z cudzego kubełka. */
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });

  stempelProwadzi(d, id, ALA);
  const po = stempelProwadzi(d, id, ALA_IMIENNICZKA);

  assert.equal(po.prowadzi, "A. Lewandowska", "imię na ekranie zostaje to samo");
  assert.equal(po.prowadziId, ALA_IMIENNICZKA.id, "ale sprawę ma teraz DRUGA Ala");

  /* I dopiero ONA ją zdejmuje — pierwsza Ala już nie ma czego zdejmować. */
  assert.equal(stempelProwadzi(d, id, ALA).prowadziId, ALA.id,
    "kliknięcie pierwszej Ali BIERZE sprawę, a nie zdejmuje cudzy znacznik");
});

test("wiersz zastany bez tożsamości traktujemy jak CUDZY, nie jak własny", () => {
  /* Migracja nie dopasowała imienia (dwa konta, jedno imię), więc znacznik
     został z samym `prowadzi`. Kliknięcie ma wtedy ZABRAĆ sprawę, bo zabranie
     cofa się jednym kliknięciem, a ciche zdjęcie cudzego znacznika nie. */
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  d.prepare(`UPDATE reklamacja_klienta
    SET prowadzi='A. Lewandowska', prowadzi_user_id=NULL WHERE id=?`).run(id);

  const po = stempelProwadzi(d, id, ALA);
  assert.equal(po.prowadziId, ALA.id, "bierze sprawę");
  assert.equal(po.prowadzi, "A. Lewandowska");
});

test("notatka zapisuje się, a do dziennika idzie DŁUGOŚĆ, nie treść", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });

  const po = zapiszNotatke(d, id, "  klient dzwonił, oddzwonić w piątek  ", "A. Lewandowska");
  assert.equal(po.notatka, "klient dzwonił, oddzwonić w piątek");

  const slad = zdarzenia(d, "reklamacja_notatka");
  assert.equal(slad.length, 1);
  const payload = JSON.parse(slad[0].payload ?? "{}") as Record<string, unknown>;
  assert.equal(payload.znakow, 34);
  assert.equal(JSON.stringify(payload).includes("klient"), false,
    "treść notatki nie ma prawa trafić do `events` — ta tabela nie ma retencji");

  /* Pusta notatka ZDEJMUJE wpis, a nie zapisuje pustego łańcucha. */
  assert.equal(zapiszNotatke(d, id, "   ", "A. Lewandowska").notatka, null);
});

test("konflikt wersji wraca jako 409 z ładunkiem, a nie jako ciche nadpisanie", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  stempelProwadzi(d, id, MAREK);

  assert.throws(() => zapiszNotatke(d, id, "moja wersja", "A. Lewandowska", 1), (e: unknown) => {
    assert.ok(e instanceof ReklamacjaConflict);
    assert.equal(e.szczegoly.wersja, 2);
    assert.equal(e.szczegoly.prowadzi, "M. Wójcik", "panel ma pokazać, kto był szybszy");
    return true;
  });
  assert.equal((d.prepare("SELECT notatka FROM reklamacja_klienta WHERE id=?")
    .get(id) as { notatka: string | null }).notatka, null);
});

test("szczegół wiąże zwroty i rozmowy PO NUMERZE ZAMÓWIENIA, nie po loginie", () => {
  const { d, konto, dodaj } = stanowisko();
  const id = dodaj({ ext: "a", order: "zam-7" });

  /* Zwrot tego samego zamówienia — mostek z 0.221.0. */
  d.prepare(`INSERT INTO zwrot_klienta(channel_account_id,external_id,order_id,
    created_at,synced_at) VALUES (?,'z-1','zam-7','2026-09-02T08:00:00Z','2026-09-07T08:00:00Z')`)
    .run(konto);
  /* Rozmowa o tym zakupie. Po loginie kupującego dobierać NIE WOLNO —
     blizna 0.56.6: Allegro maskuje rozmówcę jako `client:44300444`. */
  const rozmowa = Number(d.prepare(`INSERT INTO conversation(channel_account_id,
    external_conversation_id,subject) VALUES (?,'w-1','Kupujący 44300444')`)
    .run(konto).lastInsertRowid);
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,related_order_id,sent_at)
    VALUES (?,?,'m-1','incoming','Kiedy naprawa?','zam-7','2026-09-06T09:00:00Z')`)
    .run(rozmowa, konto);
  /* Cudze zamówienie nie ma prawa się doczepić. */
  d.prepare(`INSERT INTO message(conversation_id,channel_account_id,external_message_id,
    direction,body,related_order_id,sent_at)
    VALUES (?,?,'m-2','incoming','Inna sprawa','zam-99','2026-09-06T09:00:00Z')`)
    .run(rozmowa, konto);

  const s = szczegolReklamacji(d, id, TERAZ);
  assert.equal(s.zwroty.length, 1);
  assert.equal(s.zwroty[0].externalId, "z-1");
  assert.equal(s.rozmowy.length, 1);
  assert.equal(s.rozmowy[0].id, rozmowa);
  assert.equal(s.kartoteka, null, "reklamacja bez oferty nie udaje, że zna kartotekę");
});

test("czat wraca w kolejności czasu, z załącznikami przy właściwej wiadomości", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  const wiad = (ext: string, at: string, rola: string) => Number(d.prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc,utworzono_at)
     VALUES (?,?,?,?,?)`).run(id, ext, rola, `treść ${ext}`, at).lastInsertRowid);
  const druga = wiad("w-2", "2026-09-06T12:00:00Z", "ADMIN");
  wiad("w-1", "2026-09-06T10:00:00Z", "BUYER");
  d.prepare("INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,?,?,?)")
    .run(id, druga, "usterka.jpg", "https://api.allegro.pl/sale/issues/attachments/a-1");
  d.prepare("INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,?,?)")
    .run(id, "paragon.pdf", "https://api.allegro.pl/sale/issues/attachments/a-2");

  const s = szczegolReklamacji(d, id, TERAZ);
  assert.deepEqual(s.czat.map((w) => w.externalId), ["w-1", "w-2"]);
  assert.deepEqual(s.czat[1].zalaczniki.map((z) => z.nazwa), ["usterka.jpg"]);
  assert.deepEqual(s.czat[0].zalaczniki, []);
  assert.deepEqual(s.zalaczniki.map((z) => z.nazwa), ["paragon.pdf"],
    "załączniki samej sprawy stoją osobno od tych z rozmowy");
});

test("adres załącznika czyta się Z BAZY i tylko z tej reklamacji", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  const obca = dodaj({ ext: "b" });
  const zid = Number(d.prepare(
    "INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,?,?)")
    .run(id, "paragon.pdf", "https://api.allegro.pl/sale/issues/attachments/a-2").lastInsertRowid);

  assert.deepEqual(adresZalacznika(d, id, zid),
    { url: "https://api.allegro.pl/sale/issues/attachments/a-2", nazwa: "paragon.pdf" });
  /* Załącznik cudzej sprawy nie wychodzi tą trasą — inaczej znajomość samego
     identyfikatora wystarczałaby za uprawnienie. */
  assert.throws(() => adresZalacznika(d, obca, zid), (e: unknown) => {
    assert.ok(e instanceof BladReklamacji);
    assert.equal(e.kod, 404);
    return true;
  });
});

test("nieistniejąca reklamacja to 404, a nie pusty ekran", () => {
  const { d } = stanowisko();
  assert.throws(() => szczegolReklamacji(d, 999), (e: unknown) => {
    assert.ok(e instanceof BladReklamacji);
    assert.equal(e.kod, 404);
    return true;
  });
});

test("wiersz niesie ofertę i kartotekę — obraz jest tożsamością sprawy", () => {
  const { d, konto, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  d.prepare("UPDATE reklamacja_klienta SET offer_id='of-1' WHERE id=?").run(id);
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,
    primary_image_url,synced_at)
    VALUES (?,'of-1','Kosiarka NAC LS 46-450','NAC-4645',
      'https://a.allegroimg.com/x/1.jpg','2026-09-07T08:00:00Z')`).run(konto);
  d.prepare(`INSERT INTO oferta_kartoteka(channel_account_id,offer_id,tw_id,tw_symbol,
    wskazano_at,wskazano_przez) VALUES (?,'of-1',77,'NAC-4645','2026-09-07T08:00:00Z','A. L.')`)
    .run(konto);

  const [r] = listaReklamacji(d, TERAZ);
  assert.equal(r.ofertaNazwa, "Kosiarka NAC LS 46-450");
  assert.equal(r.ofertaZdjecie, "jest");
  assert.equal(r.twId, 77, "kartoteka POTWIERDZONA wchodzi już do kolejki");
  assert.equal(r.twSymbol, "NAC-4645");
  /* Szczegół składa wiersz TĄ SAMĄ funkcją — druga rozjechałaby się z pierwszą
     przy pierwszym nowym polu. */
  assert.equal(szczegolReklamacji(d, id, TERAZ).reklamacja.ofertaNazwa,
    "Kosiarka NAC LS 46-450");
});

test("trzy stany zdjęcia oferty, nie dwa", () => {
  const { d, konto, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  d.prepare("UPDATE reklamacja_klienta SET offer_id='of-2' WHERE id=?").run(id);

  /* Bez snapshotu: „nie wiadomo" — naprawi się samo następną synchronizacją. */
  assert.equal(listaReklamacji(d, TERAZ)[0].ofertaZdjecie, "nieznane");

  /* Snapshot z pustym adresem znaczy TO SAMO, i to jest zgodne ze
     `stanZdjeciaOferty`: NULL w tej kolumnie mówi „jeszcze nie pobrano". */
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,
    primary_image_url,synced_at) VALUES (?,'of-2','Szarpak',NULL,'2026-09-07T08:00:00Z')`)
    .run(konto);
  assert.equal(listaReklamacji(d, TERAZ)[0].ofertaZdjecie, "nieznane");

  /* Dopiero PUSTY ŁAŃCUCH znaczy „Allegro zdjęcia tej oferty nie ma" — i tego
     nie naprawi żadna synchronizacja. Blizna 0.214.0: te trzy stany znaczyły
     wcześniej jedno „bez zdjęcia". */
  d.prepare("UPDATE offer_snapshot SET primary_image_url='' WHERE external_id='of-2'").run();
  assert.equal(listaReklamacji(d, TERAZ)[0].ofertaZdjecie, "brak");
});

test("podgląd obiecuje się z nazwy pliku, a rozstrzygają bajty", () => {
  /* Przecięcie dwóch list: Allegro przyjmuje png, gif, bmp, tiff, jpeg i pdf,
     a przeglądarka rysuje cztery typy rastrowe. Wspólne są trzy. */
  for (const n of ["usterka.jpg", "USTERKA.JPEG", "dowod.png", "film.gif"]) {
    assert.equal(czyObrazZNazwy(n), true, n);
  }
  for (const n of ["paragon.pdf", "skan.tiff", "rysunek.bmp", "notatka.txt", "", null]) {
    assert.equal(czyObrazZNazwy(n), false, String(n));
  }
});

test("flaga podglądu jedzie przy KAŻDYM załączniku, w rozmowie i przy sprawie", () => {
  const { d, dodaj } = stanowisko();
  const id = dodaj({ ext: "a" });
  const w = Number(d.prepare(
    `INSERT INTO reklamacja_wiadomosc(reklamacja_id,external_id,autor_rola,tresc)
     VALUES (?,'w-1','BUYER','patrz zdjęcie')`).run(id).lastInsertRowid);
  d.prepare("INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,?,?,?)")
    .run(id, w, "usterka.jpg", "https://api.allegro.pl/sale/issues/attachments/a-1");
  d.prepare("INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,?,?)")
    .run(id, "paragon.pdf", "https://api.allegro.pl/sale/issues/attachments/a-2");

  const s = szczegolReklamacji(d, id, TERAZ);
  assert.equal(s.czat[0].zalaczniki[0].podglad, true, "zdjęcie rysuje się na osi");
  assert.equal(s.zalaczniki[0].podglad, false, "PDF zostaje przy pobieraniu");
});

test("odnośnik do sprawy niesie UUID, a nie numer czytelny", () => {
  /* Blizna 0.226.1. Do 0.226.0 pierwszeństwo miał `reference_number`, bo
     zgadnięty wzorzec prowadził na LISTĘ z wyszukiwaniem. Sprawa ma własną
     stronę i adresuje się identyfikatorem zasobu — kliknięcie właściciela
     kończyło się na „Ups, nic tu nie ma".

     Numer czytelny zostaje na ekranie jako ETYKIETA odnośnika i to jest cała
     jego rola: dla adresu jest bezużyteczny, dla człowieka niezastąpiony. */
  const { d, dodaj } = stanowisko();
  dodaj({ ext: "067de4cd-015e-4cae-a091-8fb92cb5a558" });
  const r = listaReklamacji(d, TERAZ)[0];
  assert.ok(r.link, "sprawa z identyfikatorem ma odnośnik");
  assert.match(r.link!, /\/claims\/067de4cd-015e-4cae-a091-8fb92cb5a558(\?|$)/,
    "w adresie stoi identyfikator sprawy");
  assert.doesNotMatch(r.link!, /nr-/, "numer czytelny nie ma prawa trafić do adresu");
  /* Numer nadal JEST — tylko gdzie indziej niż w adresie. */
  assert.equal(r.numer, "nr-067de4cd-015e-4cae-a091-8fb92cb5a558");
});
