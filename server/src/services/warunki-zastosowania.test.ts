import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEZ_WARUNKOW, ocenWarunki, porownajSeryjne, rokiZTekstu, sprawdzWarunki, zdanieWarunkow,
} from "./warunki-zastosowania.js";

/* ── Warunki na zastosowaniu: lata, numer seryjny, warunek słowny ───────────
   Czysta logika bez bazy. Pilnujemy trzech rzeczy: numer seryjny porównuje
   się tylko wtedy, gdy da się uczciwie (inaczej „nie wiem", nigdy alfabet),
   ocena ma trzy wyniki, a zapis odbija zakres postawiony na głowie.        */

const W = (n: Partial<typeof BEZ_WARUNKOW>) => ({ ...BEZ_WARUNKOW, ...n });

test("numery seryjne: cyfry z cyframi, przedrostek z przedrostkiem — inaczej `null`, nie alfabet", () => {
  assert.equal(porownajSeryjne("175123456", "175000000"), 1);
  assert.equal(porownajSeryjne("175 000 000", "175000000"), 0, "spacje i myślniki to ozdobnik");
  assert.equal(porownajSeryjne("GJAAA-1234567", "gjaaa 2000000"), -1);
  /* Alfabet ustawiłby „9" za „10". Różna długość to zwykle literówka albo
     inne pole z tabliczki — odmawiamy porównania, zamiast wyrzucić część. */
  assert.equal(porownajSeryjne("99999999", "175000000"), null);
  assert.equal(porownajSeryjne("GJAAA-1234567", "GJAAB-1234567"), null, "inny przedrostek to inna seria");
  assert.equal(porownajSeryjne("1751234A", "17500000"), null, "litera na końcu — nie zgadujemy jej znaczenia");
});

test("zapis: puste to „bez warunków”, a zakres na głowie i obcy kształt odbijają się ze zdaniem", () => {
  assert.deepEqual(sprawdzWarunki(null), BEZ_WARUNKOW);
  assert.deepEqual(sprawdzWarunki({ rokOd: "", seryjnyOd: "  ", warunek: " " }), BEZ_WARUNKOW);
  assert.deepEqual(sprawdzWarunki({ rokOd: "2014", rokDo: 2018, seryjnyOd: " 175000000 ", warunek: " tylko z gaźnikiem Zama " }),
    { rokOd: 2014, rokDo: 2018, seryjnyOd: "175000000", seryjnyDo: null, warunek: "tylko z gaźnikiem Zama" });
  assert.throws(() => sprawdzWarunki({ rokOd: 2019, rokDo: 2014 }), /późniejszy/);
  assert.throws(() => sprawdzWarunki({ rokOd: 201 }), /czterech cyfr/);
  assert.throws(() => sprawdzWarunki({ rokOd: 2014.5 }), /czterech cyfr/);
  assert.throws(() => sprawdzWarunki({ seryjnyOd: "od 175 mln" }), /cyfry, ewentualnie z literami na początku/);
  assert.throws(() => sprawdzWarunki({ seryjnyOd: "176000000", seryjnyDo: "175000000" }), /większy/);
  /* Granice, których nie da się porównać ze sobą, nie dadzą się porównać
     z tabliczką — warunek byłby wiecznym „nie wiem". */
  assert.throws(() => sprawdzWarunki({ seryjnyOd: "17500000", seryjnyDo: "175000000" }), /różny kształt/);
  assert.throws(() => sprawdzWarunki({ warunek: "x".repeat(201) }), /komentarz/);
});

test("zdanie warunków mówi zakres po ludzku — i milczy, gdy warunków nie ma", () => {
  assert.equal(zdanieWarunkow(BEZ_WARUNKOW), null);
  assert.equal(zdanieWarunkow(W({ rokOd: 2014, rokDo: 2018 })), "roczniki 2014–2018");
  assert.equal(zdanieWarunkow(W({ rokOd: 2014, rokDo: 2014 })), "rocznik 2014");
  assert.equal(zdanieWarunkow(W({ rokDo: 2013, seryjnyOd: "175000000", warunek: "tylko z gaźnikiem Zama" })),
    "rocznik do 2013, nr seryjny od 175000000, tylko z gaźnikiem Zama");
});

test("rocznik z wolnego tekstu: lata z czterech cyfr, bez numerów, które je tylko zawierają", () => {
  assert.deepEqual(rokiZTekstu("2019 r."), [2019]);
  assert.deepEqual(rokiZTekstu("ok. 2018/2019"), [2018, 2019]);
  assert.deepEqual(rokiZTekstu("nr 1752019001"), [], "rok wewnątrz dłuższej liczby to nie rok");
  assert.deepEqual(rokiZTekstu(null), []);
});

test("ocena: trzy wyniki, a złamany warunek wygrywa nad „nie wiem”", () => {
  const w = W({ rokOd: 2014, rokDo: 2018, seryjnyOd: "175000000" });
  assert.deepEqual(ocenWarunki(BEZ_WARUNKOW, { rocznik: "2020", nrSeryjny: null }), { ocena: "bez_warunkow", zdanie: null });

  const ok = ocenWarunki(w, { rocznik: "2016", nrSeryjny: "175 123 456" });
  assert.equal(ok.ocena, "spelnione");
  assert.match(ok.zdanie!, /rocznik 2016 mieści się w: roczniki 2014–2018; nr seryjny 175 123 456 mieści się w/);

  const nie = ocenWarunki(w, { rocznik: "2016", nrSeryjny: "174999999" });
  assert.equal(nie.ocena, "niespelnione");
  assert.equal(nie.zdanie, "wpis obejmuje nr seryjny od 175000000, a w doborze nr 174999999");

  const brak = ocenWarunki(w, { rocznik: null, nrSeryjny: null });
  assert.equal(brak.ocena, "nieznane");
  assert.match(brak.zdanie!, /w doborze brak rocznika, zapytaj klienta; .*brak numeru seryjnego, zapytaj o tabliczkę/);

  /* Rok poza zakresem przy braku numeru: jedna pewna niezgodność wystarczy. */
  assert.equal(ocenWarunki(w, { rocznik: "2020", nrSeryjny: null }).ocena, "niespelnione");
  /* „2018/2019" przy zakresie do 2018 — agent sam nie wie, więc my też nie. */
  assert.equal(ocenWarunki(W({ rokDo: 2018 }), { rocznik: "2018/2019", nrSeryjny: null }).ocena, "nieznane");
  /* Numer w innym kształcie niż granica: pytamy człowieka, nie wyrzucamy części. */
  const obcy = ocenWarunki(W({ seryjnyOd: "175000000" }), { rocznik: null, nrSeryjny: "SN-12" });
  assert.equal(obcy.ocena, "nieznane");
  assert.match(obcy.zdanie!, /numeru SN-12 nie da się z tym porównać/);
});

test("warunek słowny jest zawsze „nie wiem”, a warunki silnika nigdy nie łamią się tabliczką maszyny", () => {
  const slowny = ocenWarunki(W({ warunek: "tylko z gaźnikiem Zama" }), { rocznik: "2016", nrSeryjny: "175123456" });
  assert.deepEqual(slowny, { ocena: "nieznane", zdanie: "warunek: tylko z gaźnikiem Zama — sprawdź z klientem" });

  const silnik = ocenWarunki(W({ rokOd: 2014, rokDo: 2018 }), { rocznik: "2022", nrSeryjny: null }, "silnika");
  assert.equal(silnik.ocena, "nieznane", "rocznik kosiarki to nie rocznik silnika");
  assert.match(silnik.zdanie!, /sprawdź z tabliczki silnika/);
});
