import { describe, expect, it } from "vitest";
import { pasujeDoFrazy, rozbij } from "./szukanie";

/* Zgłoszenie właściciela: „szukanie nieodebranych paczek odbywa się głównie za
   pomocą loginu użytkownika i innych informacji na przesyłce". Cała zmiana jest
   w spacji — operator z kartonem w ręku ma kilka drobnych uchwytów naraz. */

const KODY = ["1111/z04a", "ord-77", "jan_kowalski", "jan kowalski", "inpost", "paczkomat"];

describe("Dopasowanie frazy do sprawy", () => {
  it("dwa człony ZAWĘŻAJĄ, choć trafiają w różne pola", () => {
    /* To jest cała rzecz: „kowalski inpost" nie stoi w żadnym jednym polu,
       a razem opisuje dokładnie jedną paczkę. */
    expect(pasujeDoFrazy(KODY, "kowalski inpost")).toBe(true);
    expect(pasujeDoFrazy(KODY, "kowalski dpd")).toBe(false);
  });

  it("człon bez trafienia WYKLUCZA całą sprawę", () => {
    /* Reguła odwrotna („którykolwiek człon") byłaby gorsza niż brak filtru:
       dopisanie drugiego słowa rozszerzałoby wynik, więc im więcej człowiek
       wie o paczce, tym dłuższą dostawałby listę. */
    expect(pasujeDoFrazy(KODY, "ord-77 nieznane")).toBe(false);
  });

  it("pusta fraza nie filtruje niczego", () => {
    expect(pasujeDoFrazy(KODY, "")).toBe(true);
    expect(pasujeDoFrazy(KODY, "   ")).toBe(true);
    expect(rozbij("   ")).toEqual([]);
  });

  it("wielkość liter i nadmiarowe spacje nie mają znaczenia", () => {
    /* Fraza przyjeżdża przeklejona z wiadomości albo przepisana z naklejki. */
    expect(pasujeDoFrazy(KODY, "  KOWALSKI   InPost ")).toBe(true);
    expect(rozbij("  a   b ")).toEqual(["a", "b"]);
  });

  it("pojedynczy człon działa dokładnie jak przed zmianą", () => {
    /* Stary filtr był fragmentem w dowolnym miejscu — i tak ma zostać, bo po
       tym szuka się numeru doklejonego na paczce. */
    expect(pasujeDoFrazy(KODY, "z04")).toBe(true);
    expect(pasujeDoFrazy(KODY, "z05")).toBe(false);
  });

  it("sprawa bez uchwytów nie pasuje do niczego poza pustą frazą", () => {
    expect(pasujeDoFrazy([], "cokolwiek")).toBe(false);
    expect(pasujeDoFrazy([], "")).toBe(true);
  });

  it("ogonki nie dzielą — „gaznik” trafia w „Gaźnik” (0.486.2)", () => {
    /* Magazynier pisze bez polskich znaków, nazwy z Allegro je mają. */
    const kody = ["gaźnik ohv t375", "łopata ogrodowa"];
    expect(pasujeDoFrazy(kody, "gaznik")).toBe(true);
    expect(pasujeDoFrazy(kody, "ŁOPATA")).toBe(true);
    expect(pasujeDoFrazy(kody, "lopata gaźnik")).toBe(true);
    expect(pasujeDoFrazy(kody, "sekator")).toBe(false);
  });
});
