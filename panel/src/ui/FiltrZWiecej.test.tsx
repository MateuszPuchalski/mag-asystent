import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FiltrZWiecej } from "./FiltrZWiecej";

/* Kubełki przeglądania pod „Więcej" (0.522.0). Klucz `null` jest tu celowo:
   tak wygląda „Wszystkie" w reklamacjach i dyskusjach, a `<select>` zna
   wyłącznie napisy — pomyłka w przekładzie zgubiłaby właśnie ten kubełek. */
type K = "praca" | "wglad" | null;

function Filtr({ start = "praca" as K }: { start?: K }) {
  const [wybrany, setWybrany] = useState<K>(start);
  return <div>
    <FiltrZWiecej<K> wybrany={wybrany} onWybierz={setWybrany} wiecej={["wglad", null]}
      pozycje={[
        { klucz: "praca", etykieta: "Do decyzji", ile: 3 },
        { klucz: "wglad", etykieta: "Zamknięte", ile: 12, podpowiedz: "Tylko wgląd." },
        { klucz: null, etykieta: "Wszystkie", ile: 15 },
      ]} />
    <output>{String(wybrany)}</output>
  </div>;
}

describe("FiltrZWiecej", () => {
  it("na wierzchu stoi praca, przeglądanie w liście z liczbą", () => {
    render(<Filtr />);
    expect(screen.getByRole("button", { name: "Do decyzji 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zamknięte/ })).not.toBeInTheDocument();
    const lista = screen.getByLabelText("Więcej kubełków");
    expect(lista).toHaveTextContent("Zamknięte · 12");
    expect(lista).toHaveTextContent("Wszystkie · 15");
  });

  it("wybór z listy przełącza kubełek — także ten z kluczem null", async () => {
    render(<Filtr />);
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    await userEvent.selectOptions(lista, "Wszystkie · 15");
    expect(screen.getByRole("status")).toHaveTextContent("null");
    await userEvent.selectOptions(lista, "Zamknięte · 12");
    expect(screen.getByRole("status")).toHaveTextContent("wglad");
  });

  it("wybrany ukryty kubełek widać: nazwa w liście i obwódka", () => {
    render(<Filtr start="wglad" />);
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    expect(lista.selectedOptions[0].textContent).toBe("Zamknięte · 12");
    expect(lista.className).toContain("border-wertis-ink");
    expect(screen.getByRole("button", { name: "Do decyzji 3" })).toHaveAttribute("aria-pressed", "false");
  });

  it("kubełek z wierzchu zostawia listę na „Więcej…” bez obwódki", () => {
    render(<Filtr />);
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    expect(lista.value).toBe("");
    expect(lista.className).not.toContain("border-wertis-ink");
  });

  it("bez kubełków do przeglądania listy nie ma", () => {
    render(<FiltrZWiecej<string> wybrany="a" onWybierz={() => {}} wiecej={[]}
      pozycje={[{ klucz: "a", etykieta: "A" }, { klucz: "b", etykieta: "B" }]} />);
    expect(screen.queryByLabelText("Więcej kubełków")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
