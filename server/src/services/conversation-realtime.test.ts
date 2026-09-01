import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _wyczyscObecnosc, przyRozmowie, setTyping, trzymajacy, uchwyty, wejdzDoRozmowy, wyjdzZRozmowy,
} from "./conversation-realtime.js";

/* ── Uchwyt rozmowy (0.158.0) ────────────────────────────────────────────────
   Cały ten stan żyje w PAMIĘCI i to jest jego istota (§6.3): wejście na ekran
   niczego nie zapisuje, a restart usługi nie zostawia rozmowy zablokowanej
   przez agenta, który wyszedł z pracy w czwartek. Testy podają czas ręcznie,
   bo inaczej sprawdzałyby cierpliwość, a nie regułę.                        */

const ALA = { id: 1, name: "A. Lewandowska" };
const MAREK = { id: 2, name: "M. Wójcik" };
const T0 = 1_000_000;

test("trzyma PIERWSZY, który wszedł — nie ostatni", () => {
  /* Inaczej kolega otwierający rozmowę „na chwilę" odbierałby ją komuś
     w połowie pisania odpowiedzi. */
  _wyczyscObecnosc();
  wejdzDoRozmowy(7, ALA.id, ALA.name, T0);
  wejdzDoRozmowy(7, MAREK.id, MAREK.name, T0 + 1000);
  assert.deepEqual(trzymajacy(7, T0 + 2000), { userId: ALA.id, name: ALA.name });
  assert.equal(przyRozmowie(7, T0 + 2000).length, 2, "widać obu, trzyma jeden");
});

test("znak życia odświeża uchwyt, ale nie przesuwa kolejki wejść", () => {
  _wyczyscObecnosc();
  wejdzDoRozmowy(7, ALA.id, ALA.name, T0);
  wejdzDoRozmowy(7, MAREK.id, MAREK.name, T0 + 1000);
  /* Marek bije sercem częściej; to nie czyni go pierwszym. */
  wejdzDoRozmowy(7, MAREK.id, MAREK.name, T0 + 20_000);
  assert.equal(trzymajacy(7, T0 + 21_000)?.userId, ALA.id);
});

test("bez znaku życia uchwyt puszcza sam", () => {
  /* Zamknięta zakładka, padnięta sieć, wyłączony komputer — rozmowa nie ma
     prawa zostać zablokowana na zawsze przez nieobecnego. */
  _wyczyscObecnosc();
  wejdzDoRozmowy(7, ALA.id, ALA.name, T0);
  assert.equal(trzymajacy(7, T0 + 44_000)?.userId, ALA.id);
  assert.equal(trzymajacy(7, T0 + 46_000), null);
});

test("wyjście puszcza uchwyt natychmiast, a następny w kolejce go przejmuje", () => {
  _wyczyscObecnosc();
  wejdzDoRozmowy(7, ALA.id, ALA.name, T0);
  wejdzDoRozmowy(7, MAREK.id, MAREK.name, T0 + 1000);
  wyjdzZRozmowy(7, ALA.id, T0 + 2000);
  assert.equal(trzymajacy(7, T0 + 2000)?.userId, MAREK.id,
    "kolega, który już tam siedział, nie musi wchodzić drugi raz");
});

test("uchwyty różnych rozmów nie mieszają się ze sobą", () => {
  _wyczyscObecnosc();
  wejdzDoRozmowy(7, ALA.id, ALA.name, T0);
  wejdzDoRozmowy(8, MAREK.id, MAREK.name, T0);
  const mapa = uchwyty(T0 + 1000);
  assert.equal(mapa.get(7)?.userId, ALA.id);
  assert.equal(mapa.get(8)?.userId, MAREK.id);
  assert.equal(mapa.size, 2);
});

test("pisanie ZNACZY obecność, choćby bicie serca się spóźniło", () => {
  _wyczyscObecnosc();
  setTyping(7, ALA.id, ALA.name, true, T0);
  assert.equal(trzymajacy(7, T0 + 1000)?.userId, ALA.id);
  assert.equal(przyRozmowie(7, T0 + 1000)[0].typing, true);
  /* „Pisze" gaśnie szybciej niż obecność — to sygnał chwilowy, a nie wyjście
     z rozmowy. Uchwyt zostaje. */
  assert.equal(przyRozmowie(7, T0 + 13_000)[0].typing, false);
  assert.equal(trzymajacy(7, T0 + 13_000)?.userId, ALA.id);
});
