import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OdczytZdjec } from "./OdczytZdjec";

/* ── Odczyt ze zdjęć ─────────────────────────────────────────────────────────
   Trzy rzeczy, każda jest granicą, nie wyglądem:

   1. Rozmowa bez zdjęć nie zabiera agentowi ani jednego piksela ekranu.
      Nagłówek nad pustą listą to obietnica, że coś odczytano.
   2. NUMER ZDJĘCIA JEST WIDOCZNY. Bez niego agent nie wie, którą miniaturę
      porównać z którym akapitem, a porównanie jest całym sensem tego bloku.
   3. TEKST NIE ŁAMIE SIĘ W AKAPIT. Tabliczka bywa przepisana wierszami
      i zlanie ich w prozę zamienia numer katalogowy w kaszę.               */

describe("odczyt ze zdjęć rozmowy", () => {
  test("bez odczytu nie ma bloku — pusta lista to nie jest „odczytano nic”", () => {
    const { container } = render(<OdczytZdjec odczyt={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("każdy akapit niesie numer zdjęcia, po którym agent trafia do miniatury", () => {
    render(<OdczytZdjec odczyt={[
      { zdjecie: "Z1", tekst: "PARKSIDE PBRM 39 E4" },
      { zdjecie: "Z2", tekst: "pęknięta obudowa filtra" },
    ]} />);

    expect(screen.getByText("Z1")).toBeTruthy();
    expect(screen.getByText("Z2")).toBeTruthy();
    expect(screen.getByText("PARKSIDE PBRM 39 E4")).toBeTruthy();
    expect(screen.getByText("pęknięta obudowa filtra")).toBeTruthy();
  });

  test("wiersze tabliczki zostają wierszami", () => {
    render(<OdczytZdjec odczyt={[{ zdjecie: "Z1", tekst: "IAN 508992_2507\nS/N 55283" }]} />);
    const wiersz = screen.getByText(/IAN 508992_2507/);
    /* `whitespace-pre-wrap` jest tu treścią, nie ozdobą: bez niego numer
       seryjny skleja się z numerem artykułu w jeden ciąg nie do odczytania. */
    expect(wiersz.className).toContain("whitespace-pre-wrap");
  });

  test("blok mówi agentowi, co ma zrobić, a nie tylko co model widzi", () => {
    render(<OdczytZdjec odczyt={[{ zdjecie: "Z1", tekst: "PBRM 39 E4" }]} />);
    /* „Porównaj z miniaturą" to jedyna instrukcja, jakiej ten blok potrzebuje.
       Bez niej wygląda jak wynik, a jest materiałem do sprawdzenia. */
    expect(screen.getByText(/porównaj z miniaturą/i)).toBeTruthy();
  });

  test("ZWINIĘTE domyślnie: szkic jest ważniejszy niż odczyt czterech zdjęć", () => {
    /* Do 0.341.0 blok stał otwarty i wypychał szkic poza krawędź. Nagłówek
       ma nieść tyle, żeby agent wiedział, czy warto rozwijać: liczbę zdjęć
       i zdanie, co z nimi zrobić. */
    render(<OdczytZdjec odczyt={[{ zdjecie: "Z1", tekst: "PARKSIDE PBRM 39 E4" }]} />);

    expect(screen.getByText("Co model odczytał ze zdjęć")).toBeVisible();
    expect(screen.getByText(/1 zdjęcie/)).toBeVisible();
    expect(screen.getByText("PARKSIDE PBRM 39 E4")).not.toBeVisible();
  });

  test("jedno kliknięcie pokazuje odczyt, drugie go chowa", () => {
    render(<OdczytZdjec odczyt={[{ zdjecie: "Z1", tekst: "PARKSIDE PBRM 39 E4" }]} />);
    const przelacz = screen.getByRole("button", { name: /Co model odczytał ze zdjęć/ });

    fireEvent.click(przelacz);
    expect(screen.getByText("PARKSIDE PBRM 39 E4")).toBeVisible();
    expect(przelacz.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(przelacz);
    expect(screen.getByText("PARKSIDE PBRM 39 E4")).not.toBeVisible();
  });

  test("liczebnik jest odmieniony — „5 zdjęć”, nie „5 zdjęcie”", () => {
    render(<OdczytZdjec odczyt={[1, 2, 3, 4, 5].map((n) => ({ zdjecie: `Z${n}`, tekst: `tekst ${n}` }))} />);
    expect(screen.getByText(/5 zdjęć/)).toBeVisible();
  });
});
