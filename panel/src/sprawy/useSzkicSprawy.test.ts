import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSzkicSprawy } from "./useSzkicSprawy";

/* ── Szkic przeżywa zmianę sprawy (0.423.0) ──────────────────────────────────
   Test pilnuje DWÓCH rzeczy naraz i to jest cały sens tego hooka. Nowa:
   napisana odpowiedź wraca po przełączeniu. Stara, której nie wolno zgubić
   przy naprawianiu nowej: szkic jednej sprawy nigdy nie pojawia się w drugiej.
   Poprawka, która daje pierwsze kosztem drugiego, jest gorsza od usterki.   */

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jak w hooku — magazyn bywa głuchy */ }
});

const daj = (kolejka: string, id: number | null) =>
  renderHook(({ k, i }) => useSzkicSprawy(k, i), { initialProps: { k: kolejka, i: id } });

describe("useSzkicSprawy", () => {
  it("oddaje treść napisaną do TEJ sprawy po powrocie z innej", () => {
    const { result, rerender } = daj("reklamacja", 7);
    act(() => result.current.ustaw("Proszę odesłać towar"));
    expect(result.current.tresc).toBe("Proszę odesłać towar");

    rerender({ k: "reklamacja", i: 9 });
    /* Nowa sprawa zaczyna od pustego pola. */
    expect(result.current.tresc).toBe("");

    rerender({ k: "reklamacja", i: 7 });
    expect(result.current.tresc).toBe("Proszę odesłać towar");
  });

  it("nie wpuszcza szkicu do cudzej sprawy — to jest obrona sprzed poprawki", () => {
    const { result, rerender } = daj("reklamacja", 7);
    act(() => result.current.ustaw("zdanie o szarpaku"));
    rerender({ k: "reklamacja", i: 8 });
    expect(result.current.tresc).toBe("");
    act(() => result.current.ustaw("zdanie o kosiarce"));
    rerender({ k: "reklamacja", i: 7 });
    expect(result.current.tresc).toBe("zdanie o szarpaku");
  });

  it("reklamacja 7 i dyskusja 7 to dwa różne szkice", () => {
    /* Kolejki numerują się niezależnie, więc sam numer nie jest kluczem. */
    const { result, rerender } = daj("reklamacja", 7);
    act(() => result.current.ustaw("z reklamacji"));
    rerender({ k: "dyskusja", i: 7 });
    expect(result.current.tresc).toBe("");
  });

  it("czyści się po UDANEJ wysyłce, nie przy zmianie sprawy", () => {
    const { result } = daj("reklamacja", 7);
    act(() => result.current.ustaw("wysłane zdanie"));
    act(() => result.current.wyczysc());
    expect(result.current.tresc).toBe("");
  });

  it("przeżywa wyjście z ekranu — po to jest magazyn karty, nie pamięć", () => {
    /* Przełączenie na inną kolejkę odmontowuje ekran. To jest dokładnie ten
       ruch, po którym agent wraca dopisać zdanie. */
    const pierwszy = daj("reklamacja", 7);
    act(() => pierwszy.result.current.ustaw("niedokończone zdanie"));
    pierwszy.unmount();

    const drugi = daj("reklamacja", 7);
    expect(drugi.result.current.tresc).toBe("niedokończone zdanie");
  });

  it("bez wybranej sprawy pole jest puste i głuche", () => {
    const { result } = daj("reklamacja", null);
    act(() => result.current.ustaw("donikąd"));
    expect(result.current.tresc).toBe("");
  });

  it("GŁUCHY MAGAZYN nie wywraca ekranu — działa na samej pamięci", () => {
    /* W oknie prywatnym i przy zablokowanych danych witryny `sessionStorage`
       RZUCA, a nie zwraca pusto. Ekran ma wtedy stracić trwałość szkicu,
       nigdy działanie. */
    const rzuc = () => { throw new Error("brak dostępu do magazynu"); };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(rzuc);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(rzuc);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(rzuc);

    const { result, rerender } = daj("reklamacja", 7);
    act(() => result.current.ustaw("zdanie mimo wszystko"));
    expect(result.current.tresc).toBe("zdanie mimo wszystko");
    rerender({ k: "reklamacja", i: 8 });
    expect(result.current.tresc).toBe("");
    rerender({ k: "reklamacja", i: 7 });
    /* Pamięć ekranu trzyma szkic do końca jego życia, choć magazyn milczy. */
    expect(result.current.tresc).toBe("zdanie mimo wszystko");
    vi.restoreAllMocks();
  });
});
