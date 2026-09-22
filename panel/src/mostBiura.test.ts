import { describe, expect, it } from "vitest";
import { doBiura, WIDOKI_BIURA } from "./mostBiura";
import { zapiszToken } from "./api/klient";
import biuro from "../../server/src/web/biuro.html?raw";
import tsx from "./main.tsx?raw";

describe("most do starego biura (0.431.0)", () => {
  it("zostawia biuru token, nazwę i zakładkę — człowiek nie loguje się drugi raz", () => {
    zapiszToken("tok-123");
    doBiura("nadzor", "Anna Kowalska");
    expect(localStorage.getItem("wertis.token")).toBe("tok-123");
    expect(localStorage.getItem("wertis.kto")).toBe("Anna Kowalska");
    expect(localStorage.getItem("wertis.widok")).toBe("nadzor");
  });

  it("każda zakładka mostu istnieje w biuro.html — link w pustkę to pusty panel", () => {
    /* `biuro.html` otwiera zapamiętaną zakładkę, a nieznaną zamienia na
       DOSTAWY. Literówka tutaj po cichu prowadziłaby w złe miejsce. */
    for (const w of WIDOKI_BIURA) expect(biuro).toContain(`data-widok="${w}"`);
  });

  it("biuro.html czyta klucze, które zostawia most", () => {
    for (const k of ["wertis.token", "wertis.kto", "wertis.widok"]) {
      expect(biuro).toContain(`localStorage.getItem("${k}")`);
    }
  });

  it("dolny rząd zawija się jak górny — przycisk poza kadrem to przycisk, którego nie ma", () => {
    expect(tsx).toMatch(/<div className="flex flex-wrap items-center gap-3 px-5 pb-3">/);
    // zębatka i wyjście stoją w DOLNYM rzędzie, za drugą bieżnią
    const dolny = tsx.slice(tsx.indexOf("<DrugiRzad />"), tsx.indexOf("</header>"));
    expect(dolny).toContain("<Link to={USTAWIENIA}");
    expect(dolny).toContain("onClick={wyloguj}");
  });
});
