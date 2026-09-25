import { describe, expect, it } from "vitest";
import type { KandydatZamowienia, Kopilot, OsRozmowy } from "../api/typy";
import { podwojneZakupy, soczewka } from "./soczewki-reguly";

/* ── Która soczewka staje (@wydanie) ─────────────────────────────────────────
   Soczewka stoi na domyśle klasyfikatora, więc testy pilnują przede wszystkim
   tego, kiedy NIE ma prawa stanąć: kategoria awaryjna, nieudane rozpoznanie,
   człowiek poprawił na kategorię bez soczewki.                             */

const kopilot = (n: Partial<Kopilot> = {}): Kopilot => ({
  kategoria: "OTHER", dodatkowe: [], akcja: "HUMAN_REVIEW", akcjaModelu: null, wymagaCzlowieka: false,
  brakDanychZamowienia: false, brakDanychProduktu: false, pewnosc: null, zrodlo: "MODEL", status: "SUCCESS",
  kody: [], uzasadnienie: null, nieaktualna: false, kategoriaCzlowieka: null, kategoriaModelu: null, ...n,
} as Kopilot);
const dane = (k: Kopilot | null) => ({ rozmowa: { kopilot: k } } as unknown as OsRozmowy);

describe("soczewka", () => {
  it("kategoria modelu z soczewką ją stawia; bez rozpoznania — nic", () => {
    expect(soczewka(dane(kopilot({ kategoria: "INVOICE" })))?.rodzaj).toBe("faktura");
    expect(soczewka(dane(kopilot({ kategoria: "CANCEL_ORDER" })))?.rodzaj).toBe("anulowanie");
    expect(soczewka(dane(kopilot({ kategoria: "WRONG_PRODUCT" })))?.rodzaj).toBe("inny_towar");
    expect(soczewka(dane(kopilot({ kategoria: "MISSING_PRODUCT" })))?.rodzaj).toBe("inny_towar");
    expect(soczewka(dane(kopilot({ kategoria: "ORDER_STATUS" })))).toBeNull();
    expect(soczewka(dane(null))).toBeNull();
  });

  it("kategoria awaryjna i nieudane rozpoznanie nie przestawiają kolumny", () => {
    expect(soczewka(dane(kopilot({ kategoria: "INVOICE", zrodlo: "FALLBACK" })))).toBeNull();
    expect(soczewka(dane(kopilot({ kategoria: "INVOICE", status: "FAILED" })))).toBeNull();
  });

  it("dodatkowa kategoria modelu działa, gdy główna nie ma soczewki", () => {
    const s = soczewka(dane(kopilot({ kategoria: "ORDER_STATUS", dodatkowe: ["CANCEL_ORDER"] })));
    expect(s).toMatchObject({ rodzaj: "anulowanie", kategoria: "CANCEL_ORDER", zCzlowieka: false });
  });

  it("kategoria człowieka wygrywa i nie wpuszcza domysłu modelu bocznymi drzwiami", () => {
    expect(soczewka(dane(kopilot({ kategoria: "OTHER", kategoriaCzlowieka: "INVOICE" }))))
      .toMatchObject({ rodzaj: "faktura", zCzlowieka: true });
    expect(soczewka(dane(kopilot({ kategoria: "INVOICE", dodatkowe: ["CANCEL_ORDER"],
      kategoriaCzlowieka: "PRODUCT_QUESTION" })))).toBeNull();
    /* Człowiek potwierdził nawet przy awaryjnym źródle — jego słowo wystarcza. */
    expect(soczewka(dane(kopilot({ zrodlo: "FALLBACK", kategoriaCzlowieka: "WRONG_PRODUCT" })))?.rodzaj)
      .toBe("inny_towar");
  });

  it("nieaktualność rozpoznania jedzie do nagłówka soczewki", () => {
    expect(soczewka(dane(kopilot({ kategoria: "INVOICE", nieaktualna: true })))?.nieaktualna).toBe(true);
  });
});

describe("podwójny zakup", () => {
  const zakup = (id: string, kiedy: string, n: Partial<KandydatZamowienia> = {}): KandydatZamowienia => ({
    externalId: id, link: null, status: "READY_FOR_PROCESSING", kupionoAt: kiedy, sumaGrosze: 12900,
    waluta: "PLN", pozycje: "Nóż do kosiarki AL-KO Comfort 46", maTeOferte: false, ...n,
  });

  it("te same pozycje w 72 godzinach to para, niezależnie od wielkości liter", () => {
    const p = podwojneZakupy([zakup("a", "2026-09-22T10:00:00Z"),
      zakup("b", "2026-09-22T13:00:00Z", { pozycje: "NÓŻ DO KOSIARKI AL-KO COMFORT 46", status: "FILLED_IN" })]);
    expect(p.get("a")).toBe("b");
    expect(p.get("b")).toBe("a");
  });

  it("anulowany zakup, inne pozycje i zakup po tygodniu — nie para", () => {
    expect(podwojneZakupy([zakup("a", "2026-09-22T10:00:00Z"),
      zakup("b", "2026-09-22T11:00:00Z", { status: "CANCELLED" })]).size).toBe(0);
    expect(podwojneZakupy([zakup("a", "2026-09-22T10:00:00Z"),
      zakup("b", "2026-09-22T11:00:00Z", { pozycje: "Cewka zapłonowa" })]).size).toBe(0);
    expect(podwojneZakupy([zakup("a", "2026-09-10T10:00:00Z"), zakup("b", "2026-09-22T10:00:00Z")]).size).toBe(0);
  });
});
