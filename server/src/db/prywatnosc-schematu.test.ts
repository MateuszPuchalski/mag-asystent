import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db.js";

/* ── PRYWATNOŚĆ STOI W KSZTAŁCIE CAŁEGO SCHEMATU (@wydanie) ──────────────────
   `migracja-zwrotow.test.ts` pilnuje tego samego, ale tylko dla dwóch tabel
   zwrotów. Nowa tabela nie miała strażnika wcale, a CLAUDE.md przedstawiał
   tamten test jako strażnika zasady prywatności. Ten plik przechodzi przez
   KAŻDĄ tabelę po migracji.

   Kolumna, której nazwa niesie zakazany człon, oznacza drogę dla danych,
   których nie pobieramy: konta bankowego, PESEL-u, e-maila, adresu
   z faktury albo danych z `buyer` innych niż login. Nieuważne mapowanie
   wywali się wtedy na SQL-u, zamiast wyciec po cichu.

   WYJĄTKI SĄ JAWNE i każdy ma powód. Adres DOSTAWY przechodzi od 0.422.0
   decyzją właściciela, a jego zakres i uzasadnienie stoją
   w `docs/obsluga-klienta.md`. Dokładając kolumnę do tej listy, dopisujesz
   tam własne uzasadnienie albo kolumny nie dokładasz. */

const ZAKAZANE = ["iban", "swift", "bank", "pesel", "mail", "adres", "address", "telefon", "phone", "nip"];

const WYJATKI: Record<string, string> = {
  "firma.adres": "dane NASZEJ firmy do nagłówka druku, nie klienta",
  "firma.telefon": "dane NASZEJ firmy do nagłówka druku, nie klienta",
  "firma.nip": "dane NASZEJ firmy do nagłówka druku, nie klienta",
  "zamowienie_klienta.odbiorca_telefon": "telefon z adresu DOSTAWY, decyzja z 0.422.0",
  "zamowienie_klienta.odbiorca_telefon_cyfry": "te same cyfry do szukania po końcówce, decyzja z 0.422.0",
};

const schema = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

function kolumnyPoMigracji(): string[] {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  const tabele = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  const wynik = tabele.flatMap(({ name }) =>
    (d.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>)
      .map((k) => `${name}.${k.name}`.toLowerCase()));
  d.close();
  return wynik;
}

test("żadna tabela nie ma kolumny na dane, których nie pobieramy", () => {
  const podejrzane = kolumnyPoMigracji().filter((k) => {
    const kolumna = k.split(".")[1];
    return ZAKAZANE.some((czlon) => kolumna.includes(czlon)) && !WYJATKI[k];
  });
  assert.deepEqual(podejrzane, [],
    "kolumna z zakazanym członem — patrz zasada prywatności w CLAUDE.md i docs/obsluga-klienta.md");
});

test("każdy wyjątek wskazuje kolumnę, która naprawdę istnieje", () => {
  /* Wyjątek po skasowanej kolumnie to furtka czekająca na następną
     kolumnę o tej samej nazwie. */
  const jest = new Set(kolumnyPoMigracji());
  assert.deepEqual(Object.keys(WYJATKI).filter((k) => !jest.has(k)), []);
});
