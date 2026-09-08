import { test } from "node:test";
import assert from "node:assert/strict";
import { zamaskuj, zostalyDaneOsobowe } from "./copilot-maskowanie.js";

/* ── Maskowanie treści przed wyjściem do dostawcy (§14.4) ────────────────────
   To jest bramka prywatności etapu F i jedyny test, którego czerwień znaczy
   „nie wypuszczaj tego wydania". Pilnuje trzech rzeczy: co ma zniknąć, co ma
   PRZEŻYĆ (bo bez tego klasyfikacja przestaje działać) i gdzie świadomie
   płacimy fałszywym trafieniem.                                              */

const bez = (t: string, login: string | null = null) => String(zamaskuj(t, login));

test("e-mail znika, ślad zostaje", () => {
  const t = bez("Proszę o kontakt: jan.kowalski+allegro@example.com, pilne");
  assert.equal(t.includes("jan.kowalski"), false);
  assert.equal(t.includes("example.com"), false);
  assert.match(t, /\[e-mail\]/);
  /* Reszta zdania MUSI przeżyć — to ona niesie, o co klient pyta. */
  assert.match(t, /Proszę o kontakt/);
});

test("telefon znika w trzech kształtach, w jakich ludzie go piszą", () => {
  for (const numer of ["+48 601 234 567", "601234567", "601-234-567", "0048 601 234 567"]) {
    const t = bez(`Mój numer to ${numer} proszę dzwonić`);
    assert.equal(/\d{3}/.test(t.replace("[telefon]", "")), false,
      `numer przeszedł w kształcie ${numer}: ${t}`);
    assert.match(t, /\[telefon\]/);
  }
});

test("kod pocztowy zabiera ze sobą miasto", () => {
  const t = bez("Wysyłka na 62-030 Luboń, płatne przy odbiorze");
  assert.equal(t.includes("62-030"), false);
  assert.equal(t.includes("Luboń"), false);
  assert.match(t, /\[adres\]/);
});

/* NAJTRUDNIEJSZA decyzja tego pliku: polski kod pocztowy i numer modelu
   kosiarki mają ten sam kształt (`62-030` to Luboń, `46-450` to NAC LS).
   Wzorzec na samo `dd-ddd` zjadał numer modelu z każdego pytania o dobór. */
test("kod pocztowy BEZ miasta i bez markera przechodzi — zapisana cena", () => {
  const t = bez("mam 62-030 w formularzu");
  assert.match(t, /62-030/,
    "gołe pięć cyfr wskazuje miejscowość liczoną w tysiącach; numer modelu wskazuje pytanie");
});

test("marker „kod pocztowy\u201d zabiera cyfry, choć nie ma po nich miasta", () => {
  const t = bez("mój kod pocztowy 62-030");
  assert.equal(t.includes("62-030"), false);
  assert.match(t, /\[adres\]/);
});

test("linia adresowa znika od markera do końca linii", () => {
  const t = bez("Adres: ul. Kwiatowa 3/5 m. 12\nDrugie zdanie zostaje");
  assert.equal(t.includes("Kwiatowa"), false);
  assert.match(t, /Drugie zdanie zostaje/, "maskowanie nie ma prawa zjeść całej wiadomości");
});

test("numer konta znika w całości, nie po kawałku", () => {
  const t = bez("Zwrot na konto PL61 1090 1014 0000 0712 1981 2874");
  assert.equal(/\d{4}/.test(t), false, `zostały cyfry konta: ${t}`);
  assert.match(t, /\[konto\]/);
});

/* Login to PODMIANA ZNANEJ WARTOŚCI. Wzorca na „login Allegro" nie ma —
   `mmm123` i `NAC-serwis` to zwykłe słowa. */
test("znany login znika, także zapisany inną wielkością liter", () => {
  const t = bez("Pisałem wcześniej jako Zielony_Ogrod i nikt nie odpisał", "zielony_ogrod");
  assert.equal(/zielony_ogrod/i.test(t), false);
  assert.match(t, /\[login\]/);
});

test("login krótszy niż trzy znaki nie jest podmieniany", () => {
  /* Inaczej „ab" wyjadałoby środek słowa „tabela" i maskowanie zjadałoby
     wiadomość zamiast danych osobowych. */
  const t = bez("tabela parametrów w instrukcji", "ab");
  assert.equal(t, "tabela parametrów w instrukcji");
});

test("jest idempotentna — drugi przebieg nie mnoży znaczników", () => {
  const raz = bez("kontakt: a@b.pl oraz 601 234 567");
  const dwa = String(zamaskuj(raz, null));
  assert.equal(dwa, raz);
});

/* ── Co MUSI przeżyć ─────────────────────────────────────────────────────
   Klasyfikacja bez tych danych przestaje odróżniać pytanie o dobór od pytania
   o dostępność. Fałszywe trafienie w te kształty jest droższe niż wyciek,
   którego tu nie ma. */
test("dane techniczne przeżywają maskowanie", () => {
  const t = bez("Szukam noża do NAC LS 46-450, rozstaw 148 mm, silnik B&S 450E");
  for (const zostaje of ["NAC LS 46-450", "148 mm", "B&S 450E"]) {
    assert.equal(t.includes(zostaje), true, `zniknęło „${zostaje}": ${t}`);
  }
});

/* ── Cena, którą płacimy świadomie ───────────────────────────────────────
   Numer OEM bywa nieodróżnialny od telefonu: dziewięć cyfr ze spacjami
   i myślnikiem. Klasyfikacji numer nie jest potrzebny — wystarczy jej ślad.
   PRZYROST EKSTRAKCJI BĘDZIE MUSIAŁ TĘ REGUŁĘ ZAWĘZIĆ i ten test jest po to,
   żeby odkrył to na zielono, a nie po trzech wydaniach na produkcji. */
test("numer OEM w kształcie telefonu znika — cena zapisana jako umowa", () => {
  const t = bez("Czy pasuje numer 532 19 93-77 do mojej kosiarki");
  assert.match(t, /\[telefon\]/);
  assert.match(t, /Czy pasuje numer/);
  assert.match(t, /do mojej kosiarki/);
});

test("asercja końcowa nie znajduje niczego w zamaskowanym tekście", () => {
  const brudny = "jan@example.com, 601 234 567, ul. Polna 7, 62-030 Luboń, " +
    "PL61 1090 1014 0000 0712 1981 2874";
  assert.equal(zostalyDaneOsobowe(brudny), true, "brudny tekst ma się zapalić");
  assert.equal(zostalyDaneOsobowe(bez(brudny)), false, "po maskowaniu ma być czysto");
});

/* ── Cały wątek (0.231.0, szkic odpowiedzi) ─────────────────────────────────
   Decyzja właściciela: do dostawcy idzie cały wątek, nie jedna wiadomość.
   Pilnujemy trzech rzeczy: maskowanie obejmuje TAKŻE nasze wychodzące (agent
   bywa cytuje klienta), sufit tnie od najstarszej z JEDNYM znacznikiem,
   a kolejność zostaje chronologiczna. */
import { SUFIT_WATKU, ZNACZNIK_POMINIETYCH, zamaskujWatek } from "./copilot-maskowanie.js";

test("wątek: nasze wychodzące też są maskowane, a login znika w obu kierunkach", () => {
  const t = String(zamaskujWatek([
    { odKlienta: true, tresc: "Tu zielony_ogrod, mój telefon 601 234 567" },
    { odKlienta: false, tresc: "Dzień dobry zielony_ogrod, oddzwonię na 601 234 567" },
  ], "zielony_ogrod"));
  assert.equal(t.includes("601"), false, "telefon wyszedł w naszej odpowiedzi");
  assert.equal(/zielony_ogrod/i.test(t), false, "login wyszedł");
  assert.match(t, /^KLIENT: .*\nMY: /, "kolejność chronologiczna z etykietami stron");
});

test("wątek: sufit tnie od najstarszej i zostawia jeden znacznik", () => {
  const wiadomosci = Array.from({ length: SUFIT_WATKU.wiadomosci + 3 }, (_, i) =>
    ({ odKlienta: i % 2 === 0, tresc: `wiadomość ${i}` }));
  const t = String(zamaskujWatek(wiadomosci, null));
  assert.equal(t.startsWith(ZNACZNIK_POMINIETYCH), true);
  assert.equal(t.split(ZNACZNIK_POMINIETYCH).length, 2, "znacznik ma być jeden");
  assert.equal(t.includes("wiadomość 0"), false, "najstarsza miała wypaść");
  assert.match(t, new RegExp(`wiadomość ${SUFIT_WATKU.wiadomosci + 2}$`), "najnowsza zostaje na końcu");
});

test("wątek: sufit znaków też liczy się od najnowszej", () => {
  const dluga = "x".repeat(SUFIT_WATKU.znakow - 10);
  const t = String(zamaskujWatek([
    { odKlienta: true, tresc: dluga }, { odKlienta: false, tresc: "krótko" }, { odKlienta: true, tresc: "i jeszcze" },
  ], null));
  assert.equal(t.includes("xxxx"), false, "stara długa wiadomość miała wypaść");
  assert.match(t, /krótko/);
  assert.match(t, /i jeszcze/);
});
