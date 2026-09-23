import { describe, expect, it } from "vitest";
import { protokol } from "./szablony";
import type { Wyjatek } from "../api/dostawy";

/* ── Szablony protokołu (0.435.0) ──────────────────────────────────────────
   Przyjechały z `biuro.html`, gdzie nie miały ani jednego testu — wybór
   szablonu po nazwie dostawcy i ucieczkę znaków sprawdzał wyłącznie człowiek
   przy drukarce. Tu pilnujemy dwóch rzeczy, których na wydruku nie widać,
   dopóki nie pójdzie on do dostawcy: że GEKO dostaje SWÓJ druk i że nazwa
   z bazy nie wstrzyknie znaczników. */

const p = (o: Partial<Wyjatek> = {}): Wyjatek => ({
  id: 1, deliveryId: 50, lineId: 1, typ: "qty_mismatch", typLabel: "zła ilość", qty: 10,
  symObcy: null, zamiastIlosc: null, qtyDok: 12, opis: null, hasPhoto: false,
  createdAt: "2026-09-21T14:05:00.000Z", createdBy: "m.nowak", resolvedAt: null, resolvedNote: null,
  resolvedBy: null, docNumber: "FZ 1", dokId: 1, sym: "RP-1187", name: "Podstawka", unit: "szt.", ...o,
});

const dok = (dostawca: string) => ({ nrPelny: "FZ 802/MAG/09/2026", dostawca, dataWyst: "2026-09-20" });

describe("protokół dla dostawcy", () => {
  it("dostawca bez własnego druku dostaje protokół WERTIS", () => {
    const d = protokol(dok("Rosa-Pol"), [p()], {});
    expect(d.tytul).toBe("Protokół rozbieżności · FZ 802/MAG/09/2026");
    expect(d.tresc).toContain("Protokół rozbieżności w dostawie");
  });

  it("GEKO rozpoznaje się po FRAGMENCIE pełnej nazwy rejestrowej", () => {
    const d = protokol(dok("GEKO Sp. z o.o. Sp. K"), [p()], { Nazwa: "Ogród-Pol", Nip: "123" });
    expect(d.tytul).toBe("Reklamacja GEKO · FZ 802/MAG/09/2026");
    expect(d.tresc).toContain("(na dokumencie: 12, policzone: 10)");
    expect(d.tresc).toContain("Ogród-Pol<br>NIP 123");
  });

  it("PARTNER dostaje stronę na każdy wyjątek", () => {
    const d = protokol(dok("PARTNER Parts"), [p({ id: 1 }), p({ id: 2 })], {});
    expect(d.tresc.match(/class="strona"/g)).toHaveLength(2);
  });

  it("nazwa z bazy nie wstrzykuje znaczników", () => {
    const d = protokol(dok("Zły <b>dostawca</b>"), [p({ opis: '<img src=x onerror="a()">' })], {});
    expect(d.tresc).not.toContain("<img");
    expect(d.tresc).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(d.tresc).toContain("Zły &lt;b&gt;dostawca&lt;/b&gt;");
  });
});
