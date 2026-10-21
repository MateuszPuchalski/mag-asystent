import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  INSTRUKCJA_DOPYTANIA, INSTRUKCJA_KLASYFIKACJI, INSTRUKCJA_SZKICU,
  PROMPT_DOPYTANIA, PROMPT_KLASYFIKACJI, PROMPT_SZKICU,
} from "./copilot.anthropic.js";
import { DEFINICJE } from "../services/copilot-narzedzia.js";

/* ── Strażnik wersji instrukcji ──────────────────────────────────────────────
   Księga zapisuje przy każdym wywołaniu numer instrukcji, a pomiar dzieli
   wyniki po nim. Numer bez strażnika kłamie po pierwszej zapomnianej
   zmianie: nowy tekst liczy się wtedy razem ze starym i porównanie znika.

   Tabela niżej trzyma skrót tekstu dla KAŻDEJ wersji, także starych. Stare
   wpisy zostają, bo dwie wersje o tym samym skrócie to numer podniesiony
   bez zmiany tekstu, czyli pomiar podzielony na niby-różne połowy.

   Szkic i dopytanie liczą się razem z opisami narzędzi, bo idą w tym samym
   prefiksie żądania i model czyta je jak instrukcję.                        */

const SKROTY: Record<string, Record<string, string>> = {
  PROMPT_KLASYFIKACJI: { k5: "f261e501c1045be0" },
  PROMPT_SZKICU: { s1: "848e05a0269b19e2" },
  PROMPT_DOPYTANIA: { d1: "e65b4bcb03adaa96" },
};

const skrot = (tekst: string) => createHash("sha256").update(tekst).digest("hex").slice(0, 16);
const narzedzia = JSON.stringify(DEFINICJE);

const BIEZACE: Array<{ nazwa: string; wersja: string; tekst: string }> = [
  { nazwa: "PROMPT_KLASYFIKACJI", wersja: PROMPT_KLASYFIKACJI, tekst: INSTRUKCJA_KLASYFIKACJI },
  { nazwa: "PROMPT_SZKICU", wersja: PROMPT_SZKICU, tekst: INSTRUKCJA_SZKICU + narzedzia },
  { nazwa: "PROMPT_DOPYTANIA", wersja: PROMPT_DOPYTANIA, tekst: INSTRUKCJA_DOPYTANIA + narzedzia },
];

for (const { nazwa, wersja, tekst } of BIEZACE) {
  test(`${nazwa}: tekst instrukcji zgadza się ze skrótem swojej wersji`, () => {
    const teraz = skrot(tekst);
    const wpisany = SKROTY[nazwa]?.[wersja];
    assert.ok(wpisany !== undefined,
      `${nazwa} = "${wersja}" nie ma wpisu w tabeli. Dopisz: ${wersja}: "${teraz}".`);
    assert.equal(teraz, wpisany,
      `Zmieniłeś instrukcję ${nazwa}: podnieś wersję i dopisz nowy skrót ("${teraz}"). `
      + `Stary wpis "${wersja}" zostaje w tabeli.`);
  });
}

test("żadne dwie wersje tej samej instrukcji nie mają tego samego skrótu", () => {
  for (const [nazwa, wersje] of Object.entries(SKROTY)) {
    const widziane = new Map<string, string>();
    for (const [wersja, s] of Object.entries(wersje)) {
      const tamta = widziane.get(s);
      assert.equal(tamta, undefined,
        `${nazwa}: wersje ${tamta} i ${wersja} mają ten sam skrót. `
        + "Numer podniesiony bez zmiany tekstu dzieli pomiar na dwie połowy tego samego.");
      widziane.set(s, wersja);
    }
  }
});
