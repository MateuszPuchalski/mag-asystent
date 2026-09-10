import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrzyciskZalacznika, ZalacznikiWysylki, poLudzku } from "./ZalacznikiWysylki";
import type { ZalacznikSzkicu } from "../api/rozmowy";

/* ── Załączniki do odpowiedzi (0.195.0) ──────────────────────────────────────
   Odczyt załączników klienta stał od 0.155.0, wysyłka nie istniała wcale —
   agent szedł po zdjęcie do panelu Allegro, czyli tam, skąd panel miał go
   zabrać (§25: „agent obsłuży typowe pytanie bez otwierania panelu Allegro").

   Lista pokazuje pliki, które SĄ JUŻ w Allegro: wgranie dzieje się przy
   dodaniu, nie przy WYŚLIJ. Dlatego nazwa i rozmiar to fakty, nie zapowiedzi. */

const plik = (n: Partial<ZalacznikSzkicu> = {}): ZalacznikSzkicu => ({
  id: 1, allegroId: "att-1", nazwa: "gwint.jpg", typ: "image/jpeg", rozmiar: 245_760,
  dodal: "A. Lewandowska", ...n,
});

/* Od 0.249.0 spinacz i lista to DWA komponenty, bo mają różne miejsca na
   ekranie: przycisk w rzędzie działań, lista przy komponowanej wiadomości.
   Test renderuje oba razem, bo tak stoją w edytorze — rozdzielenie było
   o układ, nie o zachowanie. */
type Props = {
  lista: ZalacznikSzkicu[]; dodaje: boolean; blad: string; wylaczone: boolean;
  onDodaj: (p: File) => void; onUsun: (id: number) => void;
};
const oba = (p: Props) => <>
  <ZalacznikiWysylki lista={p.lista} blad={p.blad} onUsun={p.onUsun} wylaczone={p.wylaczone} />
  <PrzyciskZalacznika dodaje={p.dodaje} onDodaj={p.onDodaj} wylaczone={p.wylaczone} />
</>;
const domyslne = (): Props => ({
  lista: [], dodaje: false, blad: "", wylaczone: false, onDodaj: vi.fn(), onUsun: vi.fn(),
});
const pasek = (n: Partial<Props> = {}) => render(oba({ ...domyslne(), ...n }));

describe("Załączniki DO WYSYŁKI (pasek pod edytorem)", () => {
  it("bez plików mówi, CO wolno dołączyć", () => {
    /* Puste miejsce nie odpowiada na pytanie „czy tu w ogóle można". */
    pasek();
    /* Ograniczenie formatu ZOSTAJE, ale w podpowiedzi (0.247.0) — czyli tam,
       gdzie się go szuka w chwili wątpliwości, a nie w osobnym zdaniu przy
       każdym otwarciu rozmowy. Test pilnuje, że nie zniknęło z ekranu. */
    expect(screen.getByRole("button", { name: /Dołącz plik/ }))
      .toHaveAttribute("title", expect.stringMatching(/zdjęcie albo PDF/i));
  });

  it("plik niesie nazwę, rozmiar i autora", () => {
    /* Autor, bo szkic jest WSPÓLNY: plik kolegi wygląda inaczej niż własny
       dopiero wtedy, gdy przy nim stoi imię (§6.4). */
    pasek({ lista: [plik()] });
    expect(screen.getByText("gwint.jpg")).toBeInTheDocument();
    expect(screen.getByText("240 kB")).toBeInTheDocument();
    expect(screen.getByText(/A. Lewandowska/)).toBeInTheDocument();
  });

  it("zdjęcie pliku woła wołającego z jego numerem", async () => {
    const usun = vi.fn();
    pasek({ lista: [plik({ id: 42 })], onUsun: usun });
    await userEvent.click(screen.getByRole("button", { name: /Zdejmij gwint.jpg/ }));
    expect(usun).toHaveBeenCalledWith(42);
  });

  it("przy cudzej rozmowie nie da się ani dodać, ani zdjąć", () => {
    /* Ta sama reguła co przy szkicu: rozmowę prowadzi kto inny. */
    pasek({ lista: [plik()], wylaczone: true });
    expect(screen.getByRole("button", { name: /Dołącz plik/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Zdejmij/ })).toBeDisabled();
  });

  it("w trakcie wgrywania widać, KTÓRY plik idzie", async () => {
    /* „Wgrywam…" bez nazwy przy pięciu plikach nie mówi nic. */
    const { rerender } = pasek();
    const wejscie = screen.getByLabelText(/Wybierz plik/);
    await userEvent.upload(wejscie,
      new File(["x"], "tabliczka.png", { type: "image/png" }));
    rerender(oba({ ...domyslne(), dodaje: true }));
    /* W trakcie wgrywania spinacz ODZYSKUJE słowa: sama ikona nie powiedziałaby,
       że coś trwa i który plik idzie. */
    expect(screen.getByText(/Wgrywam tabliczka\.png/)).toBeInTheDocument();
  });

  it("odmowa Allegro staje przy pasku, nie w konsoli", () => {
    pasek({ blad: "Allegro przyjmuje przy wiadomości tylko PNG, GIF, BMP, TIFF, JPEG, PDF" });
    expect(screen.getByText(/Allegro przyjmuje przy wiadomości/)).toBeInTheDocument();
  });

  it("rozmiar czyta się po ludzku, nie w bajtach", () => {
    expect(poLudzku(512)).toBe("512 B");
    expect(poLudzku(245_760)).toBe("240 kB");
    expect(poLudzku(2_516_582)).toBe("2.4 MB");
  });
});
