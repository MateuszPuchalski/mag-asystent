import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CenaPoziomu } from "../api/typy";
import { naruszeniaWcag } from "../test/dostepnosc";
import { CenyKartoteki } from "./OsCenKartoteki";

/* ── Cena zakupu na osi cen (reklamacje) ─────────────────────────────────────
   Reklamacja podaje cenę zakupu. Wtedy oś dostaje zielony romb „Kupił za …”,
   inny kształtem od kropki poziomu i pierścienia oferty, a zdanie pod osią
   zaczyna się od tego, ile klient zapłacił. Skrzynka zakupu nie podaje
   i dostaje blok jak dotąd — to pilnują testy w `TowarRozmowy.test.tsx`. */

const c = (poziom: number, nazwa: string, brutto: number | null, netto: number | null): CenaPoziomu =>
  ({ poziom, nazwa, bruttoGrosze: brutto, nettoGrosze: netto, waluta: "PLN" });
const CENY = [c(1, "Hurtowa", 13900, 11301), c(2, "Specjalna", 15900, 12927), c(3, "Detaliczna", 18900, 15366)];
const NAZWA_OSI = "Ceny brutto na osi, od najniższej";
const zl = (grosze: number) => ({ grosze, waluta: "PLN" });

describe("Cena zakupu na osi", () => {
  it("romb „Kupił za” stoi na osi obok poziomów i pierścienia oferty", async () => {
    const { container } = render(<CenyKartoteki ceny={CENY} ramka={false} oferta={zl(18900)} zakup={zl(17900)} />);
    const os = screen.getByRole("list", { name: NAZWA_OSI });
    expect(within(os).getByText("Kupił za")).toBeInTheDocument();
    expect(within(os).getByText("179,00")).toBeInTheDocument();
    /* Inny kształt niż kropka i pierścień: wielokąt, nie koło. */
    expect(container.querySelector('polygon[data-znacznik="zakup"]')).not.toBeNull();
    expect(container.querySelector('circle[data-znacznik="oferta"]')).not.toBeNull();
    expect(screen.getByRole("figure", { name: /Cena oferty 189,00 PLN i cena zakupu 179,00 PLN/ }))
      .toBeInTheDocument();
    expect(await naruszeniaWcag(container)).toBe("");
  });

  it("zdanie pod osią wspomina cenę zakupu przed ofertą", () => {
    render(<CenyKartoteki ceny={CENY} ramka={false} oferta={zl(18900)} zakup={zl(17900)} />);
    expect(screen.getByText("Klient zapłacił 179,00 PLN. Oferta równa poziomowi Detaliczna.")).toBeInTheDocument();
  });

  it("sam zakup bez oferty też rysuje oś — bez pierścienia", () => {
    const { container } = render(<CenyKartoteki ceny={CENY} ramka={false} zakup={zl(17900)} />);
    expect(screen.getByRole("list", { name: NAZWA_OSI })).toBeInTheDocument();
    expect(container.querySelector('circle[data-znacznik="oferta"]')).toBeNull();
    expect(container.querySelector('polygon[data-znacznik="zakup"]')).not.toBeNull();
    /* Jedyny przystanek tabulatora stoi na zakupie, skoro oferty nie ma. */
    const zakup = within(screen.getByRole("list", { name: NAZWA_OSI })).getByText("Kupił za").closest("li")!;
    expect(zakup).toHaveAttribute("tabindex", "0");
  });

  it("bez zakupu i bez oferty zostaje lista, jak dotąd", () => {
    render(<CenyKartoteki ceny={CENY} ramka={false} />);
    expect(screen.queryByRole("list", { name: NAZWA_OSI })).toBeNull();
    expect(screen.queryByText(/Kupił za/)).toBeNull();
  });

  it("zakup w walucie bez poziomów: lista z kwotą zakupu zdaniem, nie zmyślona oś", () => {
    render(<CenyKartoteki ceny={CENY} ramka={false} zakup={{ grosze: 4500, waluta: "EUR" }} />);
    expect(screen.queryByRole("list", { name: NAZWA_OSI })).toBeNull();
    expect(screen.getByText("Klient zapłacił 45,00 EUR.")).toBeInTheDocument();
  });
});
