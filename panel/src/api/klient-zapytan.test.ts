import { describe, expect, it } from "vitest";
import { nowyKlientZapytan } from "./klient-zapytan";

/* ── Odświeżenie wspólnych kluczy po każdej mutacji (0.502.0) ──────────────
   Rozstrzygnięty zwrot nie ma prawa wisieć w „Do zrobienia" przez pół minuty.
   Test składa TEN SAM klient, co panel, i sprawdza skutek, nie listę kluczy. */
describe("klient zapytań panelu", () => {
  it("udana mutacja unieważnia „Do zrobienia” i rozmowę; nieudana — nie", async () => {
    const qc = nowyKlientZapytan();
    qc.setQueryData(["do-decyzji"], { pozycje: [] });
    qc.setQueryData(["rozmowa", 7], { id: 7 });
    qc.setQueryData(["zwroty", "kolejka"], []);
    await qc.getMutationCache().build(qc, { mutationFn: async () => "ok" }).execute(undefined);
    expect(qc.getQueryState(["do-decyzji"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["rozmowa", 7])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["zwroty", "kolejka"])?.isInvalidated).toBe(false);

    const qc2 = nowyKlientZapytan();
    qc2.setQueryData(["do-decyzji"], { pozycje: [] });
    await qc2.getMutationCache().build(qc2, { mutationFn: async () => { throw new Error("nie"); } })
      .execute(undefined).catch(() => {});
    expect(qc2.getQueryState(["do-decyzji"])?.isInvalidated).toBe(false);
  });
});
