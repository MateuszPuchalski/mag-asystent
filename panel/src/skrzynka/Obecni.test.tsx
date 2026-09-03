import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Obecni } from "./Obecni";
import type { Obecnosc } from "../api/zdarzenia";

/* ── Obecność w otwartej rozmowie (§6.3, makieta `Main.dc.html`) ─────────────
   Dane o obecności docierały do panelu od 0.144.0 i nie było ich na żadnym
   ekranie poza wierszem kolejki, który pokazuje SAMEGO trzymającego. Ten
   pasek odpowiada na pytanie zadawane w chwili pisania: „czy ktoś już to
   robi". Dlatego testy pilnują trzech rzeczy — kogo pokazuje, kogo pomija
   i czy odróżnia patrzenie od pisania.                                      */

const kto = (n: Partial<Obecnosc> & { userId: number }): Obecnosc =>
  ({ name: `Agent ${n.userId}`, typing: false, ...n });

describe("Pasek obecności", () => {
  it("pokazuje cudze oglądanie i cudze pisanie osobno", () => {
    render(<Obecni mojeId={1} obecni={[
      kto({ userId: 2, name: "M. Wójcik" }),
      kto({ userId: 3, name: "T. Bąk", typing: true }),
    ]} />);
    expect(screen.getByText(/M\. Wójcik ogląda tę rozmowę/)).toBeInTheDocument();
    expect(screen.getByText(/T\. Bąk pisze…/)).toBeInTheDocument();
  });

  /* SIEBIE się nie ogląda. Własna obecność jedzie tą samą szyną, więc bez
     odsiania pasek mówiłby każdemu agentowi, że ktoś tu jest — zawsze. */
  it("milczy, gdy przy rozmowie jestem tylko ja", () => {
    const { container } = render(<Obecni mojeId={1} obecni={[kto({ userId: 1 })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("milczy przy pustej obecności, zamiast zajmować wiersz na nic", () => {
    const { container } = render(<Obecni mojeId={1} obecni={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  /* Polszczyzna: „ogląda" przy jednym, „oglądają" przy dwóch. Liczba mnoga
     wpisana na sztywno czytałaby się jak błąd i podważała resztę ekranu. */
  it("odmienia czasownik przez liczbę", () => {
    render(<Obecni mojeId={1} obecni={[
      kto({ userId: 2, name: "M. Wójcik" }), kto({ userId: 3, name: "T. Bąk" }),
    ]} />);
    expect(screen.getByText(/M\. Wójcik, T\. Bąk oglądają tę rozmowę/)).toBeInTheDocument();
  });

  /* Piszący NIE jest jednocześnie liczony jako patrzący: „X ogląda · X pisze"
     to jedna osoba udająca dwie. */
  it("piszący znika z listy oglądających", () => {
    render(<Obecni mojeId={1} obecni={[kto({ userId: 2, name: "M. Wójcik", typing: true })]} />);
    expect(screen.queryByText(/ogląda/)).toBeNull();
    expect(screen.getByText(/M\. Wójcik pisze…/)).toBeInTheDocument();
  });
});
