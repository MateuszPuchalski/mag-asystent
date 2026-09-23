import { describe, expect, it } from "vitest";
import { wygladaNaLogin } from "./zwroty";

/* Lustro `wygladaNaLogin` z serwera. Panel decyduje nim, czy pytać Allegro —
   więc rozjazd z serwerem znaczyłby albo pytania, które serwer odrzuci, albo
   ciszę tam, gdzie Allegro by odpowiedziało. */
describe("wygladaNaLogin", () => {
  it("login bez pseudonimu `client:NNN` IDZIE do Allegro (0.452.0)", () => {
    /* Zgłoszenie właściciela ze zrzutem Sales Center: kupujący stał tam jako
       „Client:124843816", a panel odpowiadał „nie mam paczek", bo dwukropek
       nie mieścił się w liście znaków i pytanie nie wychodziło wcale. */
    expect(wygladaNaLogin("client:124843816")).toBe(true);
    expect(wygladaNaLogin(" Client:124843816 ")).toBe(true);
  });

  it("zwykły login idzie, nazwisko ze spacją i telefon nie", () => {
    expect(wygladaNaLogin("jan_kowalski.77")).toBe(true);
    expect(wygladaNaLogin("Jan Kowalski")).toBe(false);
    expect(wygladaNaLogin("+48 600 100 200")).toBe(false);
  });

  it("dwukropek poza wzorem `client:` nie robi z napisu loginu", () => {
    expect(wygladaNaLogin("12:30")).toBe(false);
    expect(wygladaNaLogin("client:abc")).toBe(false);
  });
});
