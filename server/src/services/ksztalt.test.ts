import { test } from "node:test";
import assert from "node:assert/strict";
import { opiszKsztalt, raportKoncowki } from "./ksztalt.js";

/* ── Sonda kształtu ──────────────────────────────────────────────────────────
   Jedno zobowiązanie jest tu ważniejsze od wszystkich pozostałych: raport
   wchodzi do repo, więc nie ma prawa nieść treści rozmowy, loginu, nazwiska
   ani numeru. Reszta testów pilnuje, żeby przy tej ostrożności raport dalej
   mówił to, po co powstał — gdzie stoi pole i jak często bywa puste.       */

/** Próbka o kształcie odpowiedzi `/messaging/threads/{id}/messages`. */
const WIADOMOSCI = [
  {
    id: "msg-1",
    author: { login: "mirek352810", role: "BUYER" },
    text: "Dzień Dobry Rozstaw otworów w oferowanym szarpaku to 167 mm. Pozdrawiam",
    relatedObject: { type: "OFFER", id: "18448310205" },
    attachments: [],
    read: false,
  },
  {
    id: "msg-2",
    author: { login: "Wertis-pl", role: "SELLER" },
    text: "Dzień dobry, sprawdzam i wracam.",
    relatedObject: null,
    attachments: [{ fileName: "zdjecie.jpg" }],
    read: true,
  },
];

test("raport nie niesie ani jednej danej od człowieka", () => {
  const raport = raportKoncowki("wiadomości", WIADOMOSCI.length, opiszKsztalt(WIADOMOSCI));
  for (const tajne of [
    "mirek352810",
    "Wertis-pl",
    "szarpaku",
    "Pozdrawiam",
    "18448310205",
    "msg-1",
    "zdjecie.jpg",
  ]) {
    assert.ok(!raport.includes(tajne), `raport wyniósł „${tajne}" — to jest wyciek`);
  }
});

test("wartości słownikowe przechodzą, bo to enum Allegro, a nie czyjeś dane", () => {
  const pola = opiszKsztalt(WIADOMOSCI);
  const rola = pola.find((p) => p.sciezka === "author.role");
  assert.deepEqual(rola?.wartosci.map((w) => w.wartosc).sort(), ["BUYER", "SELLER"]);
  /* Typ powiązania to sedno całej sondy: po nim poznamy, czy numer oferty
     w ogóle przyjeżdża i pod jaką nazwą. */
  const typ = pola.find((p) => p.sciezka === "relatedObject.type");
  assert.deepEqual(typ?.wartosci, [{ wartosc: "OFFER", ile: 1 }]);
});

test("kolumna NIEPUSTE odróżnia pole nieobecne od obecnego i pustego", () => {
  const pola = opiszKsztalt(WIADOMOSCI);
  /* Dokładnie ta pułapka, w którą wpadł numer oferty: `relatedObject` STOI
     w obu wiadomościach, ale w jednej jest nullem. Pole obecne w 100%
     i niepuste w 50% wygląda w kodzie jak pewne, a pewne nie jest. */
  const powiazane = pola.find((p) => p.sciezka === "relatedObject");
  assert.equal(powiazane?.obecne, 2);
  assert.equal(powiazane?.niepuste, 1);
  assert.deepEqual(powiazane?.typy, ["null", "obiekt"]);

  /* Pusta tablica liczy się jako pusta — inaczej „załączniki są zawsze"
     brzmiałoby jak „zawsze coś przysyłają". */
  const zalaczniki = pola.find((p) => p.sciezka === "attachments");
  assert.equal(zalaczniki?.obecne, 2);
  assert.equal(zalaczniki?.niepuste, 1);
});

test("logiczne pokazujemy wprost — bez nich nie widać, czy pole bywa oboma", () => {
  const przeczytane = opiszKsztalt(WIADOMOSCI).find((p) => p.sciezka === "read");
  assert.deepEqual(
    przeczytane?.wartosci.map((w) => w.wartosc).sort(),
    ["false", "true"]
  );
});

test("pole o wielu różnych wartościach przestaje być słownikiem", () => {
  /* Trzynaście różnych kodów WIELKIMI przechodzi wzorzec, ale nie jest już
     enumem — to dane. Sufit chroni przed raportem, który wypisuje zbiór
     identyfikatorów tylko dlatego, że ktoś zapisał je wersalikami. */
  const rekordy = Array.from({ length: 13 }, (_, i) => ({ kod: `KOD_${i}` }));
  const kod = opiszKsztalt(rekordy).find((p) => p.sciezka === "kod");
  assert.deepEqual(kod?.wartosci, [], "13 różnych wartości to nie słownik");
  assert.equal(kod?.niepuste, 13, "ale samo pole dalej widać");
});

test("tablice składają się do jednej ścieżki z gwiazdką", () => {
  const rekordy = [{ parcels: [{ status: "SENT" }, { status: "DELIVERED" }] }];
  const pola = opiszKsztalt(rekordy);
  /* Trzy przesyłki nie mają dawać trzech ścieżek — raport ma opisywać
     KSZTAŁT, a kształt tablicy jest jeden. */
  assert.ok(pola.some((p) => p.sciezka === "parcels[].status"));
  assert.equal(pola.filter((p) => p.sciezka.startsWith("parcels[]")).length, 1);
});

test("nazwa zakazana blokuje wartość nawet zapisaną wersalikami", () => {
  /* Druga zapora: gdyby ktoś nazwał się `JAN`, wzorzec słownika by go
     przepuścił. Lista nazw kluczy nie przepuszcza. */
  const pola = opiszKsztalt([{ author: { login: "JAN" }, status: "NEW" }]);
  assert.deepEqual(pola.find((p) => p.sciezka === "author.login")?.wartosci, []);
  assert.deepEqual(pola.find((p) => p.sciezka === "status")?.wartosci, [
    { wartosc: "NEW", ile: 1 },
  ]);
});

/* ── Numer listu przewozowego wyciekł do raportu (0.155.0) ───────────────────
   Z prawdziwego przebiegu sondy, sekcja zwrotów:

       | `parcels[].waybill` | null, tekst | 94 | 88 |
         `A000H44281` ×1, `A000H5HJB0` ×1, … |

   Numer listu prowadzi do adresu i odbiorcy w systemie kuriera, a raport ma
   z założenia trafić do repo. Zawiodły OBIE zapory naraz: `waybill` nie stał
   na liście zakazanych nazw, a wzorzec słownika nie odróżnia `A000H44281`
   od `INPOST` — jedno i drugie to wersaliki z cyframi.

   Sufit różnorodności też nie pomógł, i to jest najciekawsza część: wzorzec
   odsiał 82 numery, które zaczynały się inaczej, więc mapa nigdy nie urosła
   ponad sześć wartości. Zapora, która wyglądała na drugą, była tą samą co
   pierwsza. */

/* Próbka WIERNA produkcji, i ten szczegół jest tu całym testem: numerów jest
   dwadzieścia, ale tylko SZEŚĆ ma format InPost (wersaliki z cyframi). Reszta
   zaczyna się od cyfry, więc wzorzec słownika je odsiewa — i mapa nigdy nie
   rośnie ponad sufit dwunastu wartości, który miał być drugą zaporą.

   Pierwsze podejście do tego testu dawało dwadzieścia numerów w formacie
   InPost i PRZECHODZIŁO na zepsutym kodzie: sufit się przepełniał i wartości
   znikały same. Test niczego wtedy nie mierzył. */
const ZWROTY = Array.from({ length: 20 }, (_, i) => ({
  id: `ret-${i}`,
  parcels: [{
    carrierId: i < 17 ? "INPOST" : "DPD",
    waybill: i < 6 ? `A000H${String(i).padStart(5, "0")}` : `6${String(i).padStart(9, "0")}`,
  }],
}));

test("numer listu przewozowego NIE trafia do raportu", () => {
  const pola = opiszKsztalt(ZWROTY);
  const list = pola.find((p) => p.sciezka === "parcels[].waybill");
  assert.ok(list, "pole ma być opisane — chodzi o wartości, nie o jego ukrycie");
  assert.deepEqual(list.wartosci, [], "numer listu wyszedł w raporcie");
});

test("przewoźnik dalej się pokazuje — to jest prawdziwy enum", () => {
  /* Poprawka nie ma prawa zabrać raportowi tego, po co powstał. */
  const pola = opiszKsztalt(ZWROTY);
  const carrier = pola.find((p) => p.sciezka === "parcels[].carrierId");
  assert.deepEqual(carrier?.wartosci, [
    { wartosc: "INPOST", ile: 17 }, { wartosc: "DPD", ile: 3 },
  ]);
});

test("wartość widziana RAZ w dużej próbce nie jest słownikiem", () => {
  /* Reguła niezależna od nazwy pola, więc łapie też te, których nikt nie
     wpisał na listę zakazanych. Enum się powtarza; identyfikator nie. */
  const probka = Array.from({ length: 20 }, (_, i) => ({
    /* Sześć różnych wartości na dwadzieścia rekordów — pod sufitem
       dwunastu, więc stara reguła je przepuszcza. */
    kod: i < 6 ? `KOD${i}` : "",
    rodzaj: i % 2 ? "PELNY" : "CZESCIOWY",
  }));
  const pola = opiszKsztalt(probka);
  assert.deepEqual(pola.find((p) => p.sciezka === "kod")?.wartosci, []);
  assert.equal(pola.find((p) => p.sciezka === "rodzaj")?.wartosci.length, 2,
    "prawdziwy enum ma przejść");
});

test("mała próbka nie kasuje słownika — nie ma z czego liczyć powtórzeń", () => {
  /* Przy trzech rekordach każda wartość bywa unikalna z natury. Reguła
     powtarzalności ma tam milczeć, inaczej sonda przestałaby opisywać enumy
     końcówek, które oddają mało rekordów. */
  const pola = opiszKsztalt([{ rodzaj: "PELNY" }, { rodzaj: "CZESCIOWY" }, { rodzaj: "INNY" }]);
  assert.equal(pola.find((p) => p.sciezka === "rodzaj")?.wartosci.length, 3);
});
