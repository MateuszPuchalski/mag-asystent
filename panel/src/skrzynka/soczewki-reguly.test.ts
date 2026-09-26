import { describe, expect, it } from "vitest";
import type { KandydatZamowienia, Kopilot, OsRozmowy } from "../api/typy";
import type { StanPrzesylki } from "../api/typy";
import { SWIEZOSC_PACZKI_MS, paczkaDoSprawdzenia, paczkaWSoczewce, podwojneZakupy, soczewka }
  from "./soczewki-reguly";

/* ── Która soczewka staje (0.499.0) ─────────────────────────────────────────
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
    expect(soczewka(dane(kopilot({ kategoria: "PRODUCT_QUESTION" })))).toBeNull();
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

  /* Paczka (0.531.0): „gdzie moja paczka" to najczęstsze pytanie skrzynki. */
  it("każda kategoria dostawy i status zamówienia stawiają soczewkę paczki; inne — nie", () => {
    for (const kategoria of ["ORDER_STATUS", "DELIVERY_DELAY", "DELIVERY_LOST", "DELIVERY_DAMAGED"] as const) {
      expect(soczewka(dane(kopilot({ kategoria })))?.rodzaj).toBe("paczka");
      expect(soczewka(dane(kopilot({ kategoriaCzlowieka: kategoria })))?.rodzaj).toBe("paczka");
    }
    for (const kategoria of ["PRODUCT_QUESTION", "PRODUCT_COMPATIBILITY", "DAMAGED_PRODUCT", "COMPLAINT",
      "OTHER"] as const) {
      expect(soczewka(dane(kopilot({ kategoria })))?.rodzaj).not.toBe("paczka");
    }
  });

  it("ogólny status ustępuje soczewce dodatkowej kategorii, konkretna dostawa — nie", () => {
    expect(soczewka(dane(kopilot({ kategoria: "ORDER_STATUS", dodatkowe: ["INVOICE"] })))?.rodzaj)
      .toBe("faktura");
    expect(soczewka(dane(kopilot({ kategoria: "DELIVERY_DELAY", dodatkowe: ["CANCEL_ORDER"] })))?.rodzaj)
      .toBe("paczka");
    /* Zwrot, który już jest, ucisza swoją soczewkę — status nie ustępuje wtedy
       w próżnię. Bez statusu zachowanie sprzed paczki zostaje: nic. */
    const zeZwrotem = (k: Kopilot) => ({ rozmowa: { kopilot: k }, zwroty: [{ id: 1 }] } as unknown as OsRozmowy);
    expect(soczewka(zeZwrotem(kopilot({ kategoria: "ORDER_STATUS", dodatkowe: ["RETURN"] })))?.rodzaj)
      .toBe("paczka");
    expect(soczewka(zeZwrotem(kopilot({ kategoria: "RETURN", dodatkowe: ["CANCEL_ORDER"] })))).toBeNull();
    /* Dodatkowy status przy głównej kategorii bez soczewki dalej daje paczkę. */
    expect(soczewka(dane(kopilot({ kategoria: "OTHER", dodatkowe: ["ORDER_STATUS"] })))?.rodzaj)
      .toBe("paczka");
  });

  it("paczka jest „w soczewce” tylko przy zamówieniu — bez niego nic niżej nie milknie", () => {
    const z = (zamowienie: unknown) => ({ rozmowa: { kopilot: kopilot({ kategoria: "DELIVERY_LOST" }) },
      zamowienie } as unknown as OsRozmowy);
    expect(paczkaWSoczewce(z({ externalId: "z1" }))).toBe(true);
    expect(paczkaWSoczewce(z(null))).toBe(false);
    expect(paczkaWSoczewce({ rozmowa: { kopilot: kopilot({ kategoria: "INVOICE" }) },
      zamowienie: { externalId: "z1" } } as unknown as OsRozmowy)).toBe(false);
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

/* „Sprawdź" przy paczce — bliźniak `przesylkaDoOdswiezenia` z serwera. Para:
   stan, przy którym przycisk MUSI stanąć, i stan, przy którym pytanie nic nie da. */
describe("paczka do sprawdzenia", () => {
  const teraz = Date.parse("2026-09-26T12:00:00Z");
  const p = (n: Partial<StanPrzesylki>): StanPrzesylki => ({
    waybill: "X1", przewoznik: "DPD", status: "IN_TRANSIT", dostarczonoAt: null, sprawdzonoAt: null, ...n });
  const temu = (ms: number) => new Date(teraz - ms).toISOString();

  it("nigdy niesprawdzona i stara — tak; świeża i doręczona — nie", () => {
    expect(paczkaDoSprawdzenia(p({}), teraz)).toBe(true);
    expect(paczkaDoSprawdzenia(p({ sprawdzonoAt: temu(SWIEZOSC_PACZKI_MS) }), teraz)).toBe(true);
    expect(paczkaDoSprawdzenia(p({ sprawdzonoAt: temu(SWIEZOSC_PACZKI_MS - 60_000) }), teraz)).toBe(false);
    expect(paczkaDoSprawdzenia(p({ sprawdzonoAt: temu(86_400_000), dostarczonoAt: temu(90_000_000) }), teraz))
      .toBe(false);
  });

  it("próg jest ten sam co na serwerze: pół godziny", () => {
    expect(SWIEZOSC_PACZKI_MS).toBe(30 * 60_000);
  });
});
