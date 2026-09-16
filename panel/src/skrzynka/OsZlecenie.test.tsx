import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WpisOsi } from "../api/typy";
import { czas } from "../ui";

/* ── Zlecenie dla hali na osi (0.226.0) ──────────────────────────────────────
   Zgłoszenie właściciela: „zlecenie zmierzenia też powinno zostać pokazane
   jako blok w wiadomości". Do 0.224.0 oś pokazywała sam WYNIK, a prośba, która
   go wywołała, nie zostawiała po sobie nic poza kreskami zmiany statusu.

   Testy pilnują czterech rzeczy, i każda odpowiada na inne pytanie agenta:
   co zlecono, czy jeszcze czekamy, od kiedy, i czy zlecenie nie udaje
   wypowiedzi.                                                               */

vi.mock("../towar/useZdjecie", () => ({
  useZdjecie: () => null,
  useZdjecieOferty: () => null,
}));

const { Os } = await import("./Os");

const zlecenie = (n: Record<string, unknown> = {}): WpisOsi => ({
  id: "zlecenie-3", rodzaj: "zlecenie", autor: "A. Lewandowska", odKlienta: false,
  tresc: "Zmierz szerokość ostrza suwmiarką, w mm.",
  at: "2026-09-07T10:31:00Z", ofertaId: null, zadanieId: 3,
  zlecenie: {
    rodzaj: "pomiar", tytul: "Zmierz szerokość noża", status: "nowe", priorytet: "normalny",
    przypisanoPrzez: null, twId: 14, symbol: "NOZ-S460", nazwaTowaru: "Nóż do kosiarki NAC S460",
  },
  ...n,
});

const pokaz = (wpisy: WpisOsi[]) => render(
  <Os rozmowaId={1} wpisy={wpisy} zrodloPomiaru={null} mozeZlecac={false}
    onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);

describe("Zlecenie dla hali na osi", () => {
  it("niesie tytuł, instrukcję i kartotekę — czyli to, co pojechało na kolektor", () => {
    pokaz([zlecenie()]);
    expect(screen.getByText("Zmierz szerokość noża")).toBeInTheDocument();
    /* Instrukcja słowo w słowo: po niej widać, czy wynik odpowiada na zadane
       pytanie. Sam tytuł tego nie rozstrzyga. */
    expect(screen.getByText(/suwmiarką, w mm/)).toBeInTheDocument();
    expect(screen.getByText("NOZ-S460")).toBeInTheDocument();
    expect(screen.getByText(/Zlecono pomiar/)).toBeInTheDocument();
  });

  it("mówi, CZY JESZCZE CZEKAMY, i kto wziął zadanie", () => {
    pokaz([zlecenie()]);
    expect(screen.getByText("czeka na halę")).toBeInTheDocument();

    pokaz([zlecenie({ zlecenie: { ...zlecenie().zlecenie!, status: "w_toku",
      przypisanoPrzez: "M. Kowal" } })]);
    expect(screen.getByText("hala pracuje")).toBeInTheDocument();
    expect(screen.getByText(/M\. Kowal/)).toBeInTheDocument();
  });

  it("zlecenie wykonane gaśnie — to wynik niżej ma przyciągać wzrok", () => {
    /* Rola prośby kończy się w chwili, gdy przyszła odpowiedź. Gdyby oba bloki
       świeciły tak samo, oś czytałaby się jak dwa równorzędne fakty. */
    const { container } = render(
      <Os rozmowaId={1} wpisy={[zlecenie({ zlecenie: { ...zlecenie().zlecenie!, status: "wykonane" } })]}
        zrodloPomiaru={null} mozeZlecac={false} onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
    expect(screen.getByText("wykonane")).toBeInTheDocument();
    expect(container.querySelector("article")?.className).not.toMatch(/bg-amber-50/);
  });

  it("niesie godzinę — otwarte zlecenie ma wiek, a wiek to decyzja", () => {
    /* Wynik godziny nie ma, bo jest ostatnim, co się wydarzyło. Zlecenie bez
       odpowiedzi CZEKA, a czekanie od dziesięciu minut i od wczoraj to dwie
       różne rozmowy z klientem. */
    pokaz([zlecenie()]);
    expect(screen.getByText(czas("2026-09-07T10:31:00Z"))).toBeInTheDocument();
  });

  it("ikona idzie z rodzaju zadania, nie jedna na wszystko", () => {
    /* Agent przewija długą rozmowę wzrokiem. Gdyby pomiar i zdjęcie miały ten
       sam kształt, trzeba by przeczytać nagłówek, żeby je rozróżnić. */
    const ikona = (rodzaj: string) => {
      const { container } = render(
        <Os rozmowaId={1} wpisy={[zlecenie({ zlecenie: { ...zlecenie().zlecenie!, rodzaj } })]}
          zrodloPomiaru={null} mozeZlecac={false} onZrodlo={() => {}} onWstawDoSzkicu={() => {}} />);
      return container.querySelector("article svg")?.getAttribute("class") ?? "";
    };
    expect(ikona("pomiar")).not.toEqual(ikona("zdjecie"));
    expect(ikona("weryfikacja")).not.toEqual(ikona("inne"));
  });

  it("nie udaje wypowiedzi: bez wstawiania do szkicu", () => {
    /* Do szkicu trafia WYNIK, nie prośba o niego — przycisk przy zleceniu
       wstawiłby klientowi naszą własną instrukcję dla magazynu. */
    pokaz([zlecenie()]);
    expect(screen.queryByRole("button", { name: /szkicu/i })).toBeNull();
  });
});

/* ── Odesłanie z hali na osi (0.352.0) ───────────────────────────────────────
   Usterka złapana przy przeglądzie własnego diffu: `STAN_ZLECENIA` nie znało
   piątego stanu, więc kafelek wypisywał surowy klucz „odeslane" w szarości,
   a karta zostawała bursztynowa — czyli mówiła „hala pracuje" dokładnie
   wtedy, gdy hala właśnie odmówiła.                                         */
describe("Zlecenie odesłane przez halę", () => {
  it("mówi po polsku, że hala odesłała — a nie wypisuje klucza z bazy", () => {
    pokaz([zlecenie({ zlecenie: { ...zlecenie().zlecenie, status: "odeslane" } })]);
    expect(screen.getByText("hala odesłała")).toBeInTheDocument();
    expect(screen.queryByText("odeslane")).not.toBeInTheDocument();
  });

  it("nie udaje, że hala nad tym pracuje", () => {
    /* Kryterium bursztynu jest jedno: czy zlecenie stoi w kolejce magazynu.
       Odesłane nie stoi — ruch wrócił do biura. „Realizuje: Halina" przy
       zadaniu, które Halina właśnie oddała, byłoby zdaniem nieprawdziwym. */
    pokaz([zlecenie({ zlecenie: {
      ...zlecenie().zlecenie, status: "odeslane", przypisanoPrzez: "Halina",
    } })]);
    expect(screen.queryByText(/realizuje: Halina/i)).not.toBeInTheDocument();
  });

  it("wpis odesłania NIE udaje wypowiedzi do klienta", () => {
    /* Najgorszy możliwy wynik tej zmiany: `Os.tsx` rysuje nieznany rodzaj
       w gałęzi domyślnej, czyli jak wiadomość w rozmowie. Notatka wewnętrzna
       „brak towaru, półka pusta" wyglądałaby wtedy na zdanie wysłane
       kupującemu. Pierwsza wersja 0.352.0 miała dokładnie tę usterkę. */
    pokaz([{
      id: "odeslanie-9", rodzaj: "odeslanie_zadania", autor: "Halina", odKlienta: false,
      tresc: "brak towaru: Półka A01 pusta.", at: "2026-09-07T11:02:00Z",
      ofertaId: null, zadanieId: 3,
    }]);
    expect(screen.getByText(/Hala odesłała/)).toBeInTheDocument();
    /* Treść wewnętrzna nie ma drogi do szkicu odpowiedzi jednym kliknięciem —
       inaczej niż wynik pomiaru, który jest odpowiedzią na pytanie klienta. */
    expect(screen.queryByRole("button", { name: /szkicu/i })).not.toBeInTheDocument();
  });

  it("wpis odesłania niesie powód po polsku i autora z hali", () => {
    pokaz([{
      id: "odeslanie-9", rodzaj: "odeslanie_zadania", autor: "Halina", odKlienta: false,
      tresc: "brak towaru: Półka A01 pusta.", at: "2026-09-07T11:02:00Z",
      ofertaId: null, zadanieId: 3,
    }]);
    expect(screen.getByText(/brak towaru: Półka A01 pusta/)).toBeInTheDocument();
    expect(screen.getByText(/Halina/)).toBeInTheDocument();
  });
});
