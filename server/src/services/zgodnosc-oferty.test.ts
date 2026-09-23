import { test } from "node:test";
import assert from "node:assert/strict";
import { naLiscieZgodnosci, pozycjaMaszyny, zdanieZgodnosci } from "./zgodnosc-oferty.js";

/* ── Maszyna klienta na liście „Pasuje do" (23 września 2026) ────────────────
   Zrzut właściciela: HECHT 1803S stał na liście zgodności oferty, a nikt tego
   nie powiedział. Pilnujemy dopasowania w obie strony — trafienie, które jest,
   i trafienie, którego być NIE MOŻE, bo kończy się częścią do cudzej kosiarki. */

const LISTA = ["Faworyt 4618", "Hecht 1803S", "Hecht 546 / 546 SX / 546 SH", "Stiga 460",
  "NAC LS 46-450", "1845"];

test("model trafia jako ciąg całych słów, z marką w pozycji", () => {
  assert.equal(pozycjaMaszyny("Hecht 1803S", "HECHT", "1803S"), true);
  assert.equal(pozycjaMaszyny("Hecht 546 / 546 SX / 546 SH", "Hecht", "546 SX"), true);
  assert.equal(pozycjaMaszyny("NAC LS 46-450", "NAC", "LS 46-450"), true);
});

test("„46” nie trafia w „Stiga 460”, a model innej marki nie jest trafieniem", () => {
  assert.equal(pozycjaMaszyny("Stiga 460", "Stiga", "46"), false, "zlepienie dałoby stiga460 ⊃ stiga46");
  assert.equal(pozycjaMaszyny("Hecht 1803S", "Stiga", "1803S"), false);
});

test("pozycja z samym modelem trafia; inny podział zapisu to ten sam model", () => {
  assert.equal(pozycjaMaszyny("1845", "Hecht", "1845"), true);
  assert.equal(pozycjaMaszyny("Hecht 1803 S", "HECHT", "1803S"), true);
});

test("wariant: sprawdzony, gdy któraś pozycja go wymienia; bez wariantu w danych — nie ma czego sprawdzać", () => {
  const z = naLiscieZgodnosci(LISTA, { marka: "HECHT", model: "1803S", wariant: "DYM1182c" });
  assert.deepEqual(z.trafienia, ["Hecht 1803S"]);
  assert.equal(z.wariantSprawdzony, false);
  assert.equal(z.maszyna, "HECHT 1803S DYM1182c");
  assert.equal(naLiscieZgodnosci(LISTA, { marka: "HECHT", model: "1803S", wariant: null }).wariantSprawdzony, true);
});

test("bez marki albo modelu nie ma czego szukać", () => {
  assert.deepEqual(naLiscieZgodnosci(LISTA, { marka: "HECHT", model: null, wariant: null }).trafienia, []);
  assert.equal(naLiscieZgodnosci(LISTA, { marka: null, model: "1803S", wariant: null }).maszyna, null);
});

test("zdanie „JEST” niesie pozycję i wariant; „NIE MA” niesie zastrzeżenie w samym fakcie", () => {
  const jest = zdanieZgodnosci({ lista: LISTA,
    ...naLiscieZgodnosci(LISTA, { marka: "HECHT", model: "1803S", wariant: "DYM1182c" }) }, "DYM1182c")!;
  assert.match(jest, /HECHT 1803S DYM1182c JEST na liście zgodności tej oferty \(pozycja: „Hecht 1803S”\)/);
  assert.match(jest, /wariantu DYM1182c lista nie wymienia — wariant niesprawdzony/);

  const nie = zdanieZgodnosci({ lista: LISTA,
    ...naLiscieZgodnosci(LISTA, { marka: "Honda", model: "HRX 476", wariant: null }) }, null)!;
  assert.match(nie, /Honda HRX 476 NIE MA na liście zgodności tej oferty \(lista ma 6 pozycji\)/);
  assert.match(nie, /NIE znaczy, że część nie pasuje/, "bez zastrzeżenia model napisałby „nie pasuje”");
});
