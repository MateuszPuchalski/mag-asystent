import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUFIT_PODGLADU_BAJTOW, czyPdfZNazwy, typPodgladu, typPodgladuOsi,
} from "./typ-podgladu.js";

/* Dwie listy, dwóch czytelników. Oś rozmowy pokazuje obraz albo PDF,
   a Copilot dostaje wyłącznie obrazy. Pomylenie tych funkcji wysłałoby
   paragon w PDF dostawcy modelu. */

test("oś przyjmuje PDF, a lista Copilota go nie zna", () => {
  assert.equal(typPodgladuOsi("application/pdf"), "application/pdf");
  assert.equal(typPodgladuOsi("Application/PDF; charset=binary"), "application/pdf",
    "typ bez parametrów i bez wielkości liter, jak przy obrazach");
  assert.equal(typPodgladu("application/pdf"), null, "PDF nie idzie do Copilota");
});

test("oś dalej przyjmuje obrazy z listy i nic poza nią", () => {
  assert.equal(typPodgladuOsi("image/png"), "image/png");
  assert.equal(typPodgladuOsi("image/svg+xml"), null, "SVG to dokument ze skryptem");
  assert.equal(typPodgladuOsi("image/tiff"), null);
  assert.equal(typPodgladuOsi("application/octet-stream"), null);
  assert.equal(typPodgladuOsi(null), null);
  assert.equal(typPodgladuOsi(undefined), null);
});

test("nazwa obiecuje PDF tylko rozszerzeniem na końcu", () => {
  for (const n of ["paragon.pdf", "FAKTURA.PDF", " skan.Pdf "]) {
    assert.equal(czyPdfZNazwy(n), true, n);
  }
  for (const n of ["paragon.pdf.exe", "pdf", "usterka.jpg", "", null, undefined]) {
    assert.equal(czyPdfZNazwy(n), false, String(n));
  }
});

test("sufit podglądu to 20 MiB", () => {
  /* Liczba stoi w kontrakcie z panelem: 413 powyżej niej. */
  assert.equal(SUFIT_PODGLADU_BAJTOW, 20 * 1024 * 1024);
});
