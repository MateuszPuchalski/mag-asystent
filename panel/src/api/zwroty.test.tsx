import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── Co odświeża zapis zwrotu (audyt zwrotów, 15 września 2026) ──────────────
   Dwie usterki jednej linijki. `["zwroty"]` jest przedrostkiem koszyka
   i rozjazdów, więc każdy klawisz decyzji przeładowywał trzy listy — w tym
   rozjazdy liczone z całej bazy. A szczegół, który niesie blok pieniędzy, nie
   odświeżał się po przyjęciu ani po kwocie: ekran pisał „Najpierw zaznacz, co
   oddajemy" nad już zapisaną kwotą.                                         */

vi.mock("./klient", () => ({ api: vi.fn(async () => ({ wersja: 2 })) }));
const { kluczeZwrotow, useKwota, useWerdykt } = await import("./zwroty");

const ROZJAZDY = ["zwroty", "rozjazdy"] as const;

function stanowisko() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const k of [kluczeZwrotow.kolejka, kluczeZwrotow.zwrot(5), kluczeZwrotow.kosz, ROZJAZDY]) {
    qc.setQueryData(k, {});
  }
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const niewazne = (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated;
  return { wrapper, niewazne };
}

describe("Odświeżenie po decyzji zwrotu", () => {
  it("kwota odświeża kolejkę i szczegół, a rozjazdów ani koszyka nie rusza", async () => {
    const s = stanowisko();
    const { result } = renderHook(() => useKwota(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5, pozycjeIds: [1], dostawa: false, wersja: 1 });
    expect(s.niewazne(kluczeZwrotow.kolejka)).toBe(true);
    expect(s.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    expect(s.niewazne(ROZJAZDY)).toBe(false);
    expect(s.niewazne(kluczeZwrotow.kosz)).toBe(false);
  });

  it("przyjęcie odświeża szczegół — to on pokazuje ODDAJ PIENIĄDZE", async () => {
    const s = stanowisko();
    const { result } = renderHook(() => useWerdykt(), { wrapper: s.wrapper });
    await result.current.mutateAsync({ id: 5, decyzja: "przyjety", powod: null, wersja: 1 });
    expect(s.niewazne(kluczeZwrotow.zwrot(5))).toBe(true);
    expect(s.niewazne(ROZJAZDY)).toBe(false);
  });
});
