import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Reklamacja, SzczegolReklamacji } from "../api/typy";
import { Fakty } from "../test/fakty";

/* Źródła przez `?raw`, jak w strażnikach z `src/`: wywołanie, które ekran
   wpiąłby kiedyś bez karty, nie narysuje się w teście, a w tekście stanie. */
import zrodloDowodow from "./Fakty.tsx?raw";
import zrodloEdytora from "./Edytor.tsx?raw";
import zrodloEkranu from "../ekrany/Reklamacje.tsx?raw";
import zrodloApi from "../api/reklamacje.ts?raw";

/* Kolumna dowodów pyta o cennik kartoteki (`useKartaTowaru`), a ten plik nie
   stawia klienta TanStacka — pilnuje tego, czego w kolumnie NIE MA. */
vi.mock("../api/rozmowy", () => ({
  useKartaTowaru: () => ({ data: undefined, isLoading: false, error: null }),
}));

/* ── Ekran reklamacji bez Copilota ───────────────────────────────────────────
   Decyzja właściciela przy przebudowie ekranu: na razie bez karty „Co
   wyczytał Copilot", bez jego rady, bez „Przeczytaj sprawę" i bez szkicu
   odpowiedzi. Zapisane karty zostają w bazie i serwer dalej je wysyła,
   więc test podaje kolumnie kartę z radą. Gdyby ekran znów zaczął ją czytać,
   ten plik ma odmówić.

   Strażnik zastępuje testy samej karty. Reguła, której tamte broniły —
   maszyna nie wydaje werdyktu za człowieka — jest spełniona w całości,
   bo maszyny na tym ekranie nie ma wcale. */

const rek = (): Reklamacja => ({
  id: 1, externalId: "i-1", numer: "123/2026", orderId: null, offerId: null,
  kupujacyLogin: "kupujacy1", prawo: "COMPLAINT", powodTyp: "DEFECT_FOUND_DURING_USE",
  powodOpis: "Pękła obudowa", temat: null, opis: null,
  oczekiwanie: "REFUND", oczekiwanaKwotaGrosze: null, waluta: "PLN",
  statusAllegro: "CLAIM_SUBMITTED", decyzjaDo: null, dniDoTerminu: null, poTerminie: false,
  zwrotWymagany: null, czatAktywny: true, wiadomosciIle: 2, czatUrwany: false,
  ostatniaWiadomoscStatus: null, ostatniaWiadomoscAt: null,
  otwartoAt: "2026-09-06T10:00:00.000Z", prowadzi: null, prowadziAt: null,
  notatka: null, wersja: 1, kubelek: "decyzja", sygnaly: [], tagi: [],
  link: null, linkZamowienia: null, linkOferty: null,
  ofertaNazwa: null, ofertaZdjecie: "nieznane", twId: null, twSymbol: null,
} as unknown as Reklamacja);

/** Karta zapisana przed zmianą — z faktami, brakami i radą. */
const KARTA: SzczegolReklamacji["karta"] = {
  usterka: { tresc: "Kosiarka przestała ciąć", zrodlo: "W1" },
  kiedy: { tresc: "po tygodniu", zrodlo: "W1" },
  oczekiwanie: { tresc: "wymiana", zrodlo: "W1" },
  dowody: [{ tresc: "zdjęcie noża", zrodlo: "W3" }],
  brakuje: ["data zakupu", "numer seryjny"],
  rada: {
    co: "ACCEPTED_REFUND", pewnosc: "srednia",
    uzasadnienie: { tresc: "Usterka zgłoszona w pierwszym tygodniu", zrodlo: "W1" },
    czegoNieWiem: ["czy towar był używany zgodnie z instrukcją"],
  },
  ocena: null, zdjecia: [{ numer: "Z1", zalacznikId: 9, nazwa: "tabliczka.jpg" }],
  model: "claude-test", przez: "Ala", at: "2026-09-11T09:00:00.000Z",
};

const szczegol = (): SzczegolReklamacji => ({
  reklamacja: rek(), czat: [], zalaczniki: [], zwroty: [], rozmowy: [], sprawy: [], droga: [],
  kartoteka: null, karta: KARTA,
} as unknown as SzczegolReklamacji);

describe("kolumna reklamacji nie ma Copilota", () => {
  it("zapisana karta nie wraca na ekran: ani faktów maszyny, ani rady", () => {
    render(<Fakty szczegol={szczegol()} />);
    expect(screen.queryByText("Co wyczytał Copilot")).not.toBeInTheDocument();
    expect(screen.queryByText("Copilot radzi")).not.toBeInTheDocument();
    expect(screen.queryByText("Brakuje do rozstrzygnięcia")).not.toBeInTheDocument();
    expect(screen.queryByText(/Kosiarka przestała ciąć/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Copilot/)).not.toBeInTheDocument();
  });

  it("nie ma przycisku, który woła model", () => {
    render(<Fakty szczegol={szczegol()} />);
    expect(screen.queryByRole("button", { name: /Przeczytaj|Copilot|Czytam/ })).not.toBeInTheDocument();
  });

  it("ekran, kolumna i haki nie znają już trasy rozpoznania", () => {
    /* Trasę usuwa serwer w tej samej zmianie, a jego strażnik adresów
       (`panel-adresy.test.ts`) odmówiłby hakowi bez trasy. Ten test pilnuje
       drugiej strony: że ekran nie wpina rozpoznania z powrotem. */
    for (const zrodlo of [zrodloDowodow, zrodloEkranu, zrodloApi]) {
      expect(zrodlo).not.toMatch(/useRozpoznaj|\/rozpoznaj\b|onRozpoznaj/);
    }
  });

  it("edytor odpowiedzi w reklamacji nie dostaje szkicu Copilota", () => {
    /* Wspólny edytor skrzynki rysuje przycisk szkicu tylko wtedy, gdy
       wołający poda mu `copilot`. Reklamacja nie podaje i nie ma podawać. */
    expect(zrodloEdytora).not.toMatch(/\bcopilot\s*=/);
    expect(zrodloEdytora).not.toMatch(/SzkicCopilota/);
  });
});
