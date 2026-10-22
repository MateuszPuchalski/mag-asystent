import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Dopytanie } from "./Dopytanie";
import type { SzkicCopilota, WymianaCopilota } from "../api/typy";

/* ── Dopytanie Copilota ──────────────────────────────────────────────────────
   Jedna granica jest tu ważniejsza od wszystkich razem: NOTKA IDZIE DO
   AGENTA. Przycisk „wstaw” przy notce omijałby wszystkie sita, którymi szkic
   jest sprawdzany przed wysłaniem do klienta. Przycisk ma tylko WERSJA, bo
   serwer przepuścił ją przez te same sita. Pierwszy test pilnuje obu stron
   tej granicy naraz.                                                       */

const w = (n: Partial<WymianaCopilota> = {}): WymianaCopilota => ({
  id: 1, pytanie: "Czy ten nóż pasuje do 46 cm?",
  odpowiedz: "Fakty tego nie rozstrzygają. Rozstrzygnie zdjęcie tabliczki.",
  twierdzenia: [], model: "atrapa", at: "2026-09-14T10:00:00.000Z",
  przez: "A. Lewandowska", ...n,
});

const ORYGINAL = "Dzień dobry, nóż pasuje do kosiarki.";
const szkic = (n: Partial<SzkicCopilota> = {}): SzkicCopilota => ({
  tresc: ORYGINAL, zastrzezenia: [], uzyteFakty: [], messageId: 1, model: "m",
  at: "2026-09-14T09:00:00.000Z", przez: "Copilot", ocena: null, twierdzenia: [], odczytZeZdjec: [], ...n,
});

/** Wymiana-polecenie: model poprawił `przed` na `po`. */
const poprawka = (id: number, przed: string, po: string, n: Partial<WymianaCopilota> = {}) => w({
  id, pytanie: "dodaj model kosiarki", odpowiedz: "Dopisałem model kosiarki.",
  at: `2026-09-14T10:0${id}:00.000Z`, szkicPrzed: przed, szkicPo: po,
  szkicTwierdzenia: [], szkicZastrzezenia: [], szkicOdrzucony: null, ...n,
});

type Props = Parameters<typeof Dopytanie>[0];
const props = (n: Partial<Props> = {}): Props => ({
  wymiany: [] as WymianaCopilota[], szkic: szkic(), pole: "", onWstaw: vi.fn(),
  wylaczony: false, blad: null, pracuje: false, onPytaj: vi.fn(), limitZnakow: 600, ...n,
});

/**
 * Renderuje i ROZWIJA blok.
 *
 * Dopytanie jest zwinięte, dopóki nie ma o co pytać. `getByRole` pomija
 * elementy ukryte, więc test badający pole MUSI je wpierw otworzyć —
 * inaczej sprawdzałby pustkę.
 */
function otworz(p: Props) {
  render(<Dopytanie {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /Dopytaj Copilota/ }));
}

describe("dopytanie Copilota", () => {
  test("notka NIE MA przycisku wstawiania, wersja MA — to jest granica, nie brak", () => {
    /* Blok z odbytą wymianą otwiera się sam, więc nie ma tu czego rozwijać —
       i właśnie dlatego brak przycisku jest tu sprawdzalny, a nie pozorny. */
    const { unmount } = render(<Dopytanie {...props({ wymiany: [w()] })} />);
    for (const slowo of [/wstaw/i, /zastąp/i, /przywróć/i]) {
      expect(screen.queryByRole("button", { name: slowo })).toBeNull();
    }
    unmount();

    const p = props({ wymiany: [poprawka(1, ORYGINAL, `${ORYGINAL} Model LS 46.`)] });
    render(<Dopytanie {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Wstaw do odpowiedzi/ }));
    expect(p.onWstaw).toHaveBeenCalledWith(`${ORYGINAL} Model LS 46.`);
  });

  test("pod odpowiedzią stoi, co Copilot sprawdził w bazie — i nic, gdy nie sięgał", () => {
    render(<Dopytanie {...props({ wymiany: [
      w({ id: 1, narzedzia: [
        { nazwa: "szukaj_towaru", argument: "1123 120 0650", znakow: 120 },
        { nazwa: "karta_towaru", argument: "GAZ-MS250", znakow: 300 },
      ] }),
      w({ id: 2, narzedzia: [] }),
    ] })} />);
    expect(screen.getByText(/Sprawdził w bazie: szukanie w kartotece „1123 120 0650”, karta towaru „GAZ-MS250”/))
      .toBeTruthy();
    expect(screen.getAllByText(/Sprawdził w bazie/)).toHaveLength(1);
  });

  test("zwinięty blok mówi, co da się w nim zrobić", () => {
    render(<Dopytanie {...props()} />);
    expect(screen.getByText(/poprawi szkic albo odpowie/i)).toBeTruthy();
  });

  test("puste pytanie nie da się wysłać", () => {
    const p = props();
    otworz(p);
    const przycisk = screen.getByRole("button", { name: /zapytaj/i });
    expect((przycisk as HTMLButtonElement).disabled).toBe(true);
  });

  test("pytanie leci po kliknięciu, a pole się czyści", () => {
    const p = props();
    otworz(p);
    const pole = screen.getByLabelText(/pytanie do copilota/i);
    fireEvent.change(pole, { target: { value: "  Skąd to wiesz?  " } });
    fireEvent.click(screen.getByRole("button", { name: /zapytaj/i }));

    expect(p.onPytaj).toHaveBeenCalledWith("Skąd to wiesz?", []);
    expect((pole as HTMLTextAreaElement).value).toBe("");
  });

  test("podpowiedź pola pokazuje polecenie, nie tylko pytanie", () => {
    otworz(props());
    expect(screen.getByLabelText(/pytanie do copilota/i))
      .toHaveAttribute("placeholder", expect.stringMatching(/^np\. dodaj .* albo zapytaj:/));
  });

  test("pytanie dłuższe od limitu blokuje przycisk, zanim żądanie poleci", () => {
    const p = props({ limitZnakow: 10 });
    otworz(p);
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i),
      { target: { value: "a".repeat(11) } });

    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("11 / 10")).toBeTruthy();
  });

  test("licznik znaków milczy, dopóki daleko do limitu", () => {
    otworz(props({ limitZnakow: 600 }));
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i), { target: { value: "krótko" } });
    /* Licznik stale widoczny uczy pisać krótko zamiast pisać jasno. */
    expect(screen.queryByText(/\/ 600/)).toBeNull();
  });

  test("wymiany stoją naprzemiennie, z podpisem pytającego", () => {
    render(<Dopytanie {...props({ wymiany: [w(), w({ id: 2, pytanie: "A wersja z rozrusznikiem?" })] })} />);
    expect(screen.getByText(/A\. Lewandowska: Czy ten nóż pasuje do 46 cm\?/)).toBeTruthy();
    expect(screen.getByText(/A\. Lewandowska: A wersja z rozrusznikiem\?/)).toBeTruthy();
  });

  test("cudza rozmowa gasi i pole, i przycisk", () => {
    otworz(props({ wylaczony: true }));
    expect((screen.getByLabelText(/pytanie do copilota/i) as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /zapytaj/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("błąd z serwera stoi przy przycisku, nie w konsoli", () => {
    otworz(props({ blad: "Ta rozmowa ma już 20 dopytań." }));
    expect(screen.getByText(/ma już 20 dopytań/)).toBeTruthy();
  });

  test("stara wymiana, zapisana przed poprawianiem szkicu, renderuje się jak dotąd", () => {
    /* Wiersz z bazy sprzed poprawiania nie ma żadnego pola szkicu. */
    const stara = { id: 7, pytanie: "Skąd wiesz?", odpowiedz: "Z karty towaru.", twierdzenia: [],
      model: "m", at: "2026-09-14T10:00:00.000Z", przez: "A. Lewandowska" } as WymianaCopilota;
    render(<Dopytanie {...props({ wymiany: [stara] })} />);
    expect(screen.getByText("Z karty towaru.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Wersja/ })).toBeNull();
    expect(screen.queryByText(/nie poprawił szkicu/)).toBeNull();
  });
});

describe("wersje szkicu w dopytaniu", () => {
  const V2 = "Dzień dobry, nóż pasuje do kosiarki LS 46.";
  const V3 = "Dzień dobry, nóż pasuje do kosiarki LS 46. Wysyłka dziś.";

  test("różnica słów: dopisane i skreślone mają słowo dla czytnika, nie tylko barwę", () => {
    render(<Dopytanie {...props({ wymiany: [poprawka(1, ORYGINAL, "Dzień dobry, nóż pasuje do LS 46.")] })} />);
    const wersja = screen.getByRole("group", { name: "Wersja 2" });
    fireEvent.click(within(wersja).getByRole("button", { name: "Pokaż zmiany" }));
    const ins = wersja.querySelector("ins");
    const del = wersja.querySelector("del");
    expect(ins).toHaveTextContent("dodano: LS 46.");
    expect(del).toHaveTextContent("usunięto: kosiarki.");
    expect(within(wersja).getByText("dodano:")).toHaveClass("sr-only");
    /* Podsumowanie słowami, odmienione: „+2 słowa”, „−1 słowo”. */
    expect(within(wersja).getByText("· +2 słowa, −1 słowo")).toBeInTheDocument();
  });

  test("wersja w polu mówi „w polu” zamiast przycisku", () => {
    render(<Dopytanie {...props({ pole: `${V2}\n`, wymiany: [poprawka(1, ORYGINAL, V2)] })} />);
    const wersja = screen.getByRole("group", { name: "Wersja 2" });
    expect(within(wersja).getByText("w polu")).toBeInTheDocument();
    for (const slowo of [/wstaw/i, /przywróć/i]) expect(within(wersja).queryByRole("button", { name: slowo })).toBeNull();
  });

  test("starsza wersja ma „Przywróć tę wersję” ze swoją treścią", () => {
    const p = props({ pole: V3, wymiany: [poprawka(1, ORYGINAL, V2), poprawka(2, V2, V3)] });
    render(<Dopytanie {...p} />);
    const starsza = screen.getByRole("group", { name: "Wersja 2" });
    const najnowsza = screen.getByRole("group", { name: "Wersja 3" });
    expect(within(najnowsza).getByText("w polu")).toBeInTheDocument();
    fireEvent.click(within(starsza).getByRole("button", { name: /Przywróć tę wersję/ }));
    expect(p.onWstaw).toHaveBeenCalledWith(V2);
    /* Podpis zwiniętego bloku liczy wymiany i poprawki, odmienione. */
    expect(screen.getByText("2 wymiany · 2 poprawki")).toBeInTheDocument();
  });

  /* ── Wersja to jedna linia, nie drugi szkic ──────────────────────────────
     Zgłoszenie właściciela: nowa wersja stoi już w polu, z poprawką
     podświetloną na miejscu. Pełny tekst z różnicą tutaj był drugim
     szkicem pod polem, więc czeka zwinięty za „Pokaż zmiany”.            */
  test("wersja z wymiany to jedna linia: numer, godzina, ile słów — różnica zwinięta, także w najnowszej", () => {
    render(<Dopytanie {...props({ pole: V3, wymiany: [poprawka(1, ORYGINAL, V2), poprawka(2, V2, V3)] })} />);
    for (const nazwa of ["Wersja 2", "Wersja 3"]) {
      const wersja = screen.getByRole("group", { name: nazwa });
      expect(within(wersja).queryByTestId("roznica-szkicu")).toBeNull();
      expect(within(wersja).getByRole("button", { name: "Pokaż zmiany" })).toHaveAttribute("aria-expanded", "false");
    }
    const najnowsza = screen.getByRole("group", { name: "Wersja 3" });
    expect(within(najnowsza).getByText("· +2 słowa")).toBeInTheDocument();
    /* Pełny tekst wersji nie stoi w bloku drugi raz. */
    expect(najnowsza).not.toHaveTextContent("Wysyłka dziś");

    fireEvent.click(within(najnowsza).getByRole("button", { name: "Pokaż zmiany" }));
    expect(within(najnowsza).getByRole("button", { name: "Ukryj zmiany" })).toHaveAttribute("aria-expanded", "true");
    expect(within(najnowsza).getByTestId("roznica-szkicu").querySelector("ins")).toHaveTextContent("Wysyłka dziś.");
  });

  test("nagłówek wersji niesie numer i godzinę", () => {
    render(<Dopytanie {...props({ wymiany: [poprawka(1, ORYGINAL, V2)] })} />);
    expect(within(screen.getByRole("group", { name: "Wersja 2" })).getByText(/^Wersja 2 · \d{1,2}:\d{2}$/))
      .toBeInTheDocument();
  });

  test("odrzucona poprawka mówi, dlaczego — i nie ma wersji", () => {
    render(<Dopytanie {...props({ wymiany: [poprawka(1, ORYGINAL, "", {
      szkicPo: null,
      szkicOdrzucony: "Copilot użył numeru LC-9999, nie mówiąc, skąd go ma, więc szkic został bez zmian." })] })} />);
    /* Zdanie serwera stoi samo, bez doklejonego wstępu, który je dublował. */
    expect(screen.getByText("Copilot użył numeru LC-9999, nie mówiąc, skąd go ma, więc szkic został bez zmian."))
      .toBeInTheDocument();
    expect(screen.queryByText(/nie poprawił szkicu/)).toBeNull();
    expect(screen.queryByRole("group", { name: /Wersja/ })).toBeNull();
  });

  test("ręczne zmiany agenta przed poleceniem stoją osobno, zwinięte", () => {
    const zMoimi = `${V2} Pozdrawiam, Ania.`;
    render(<Dopytanie {...props({ wymiany: [poprawka(1, ORYGINAL, V2), poprawka(2, zMoimi, V3)] })} />);
    const luka = screen.getByText("Twoje zmiany przed poprawką").closest("details")!;
    expect(luka).not.toHaveAttribute("open");
    expect(luka.querySelector("ins")).toHaveTextContent("dodano: Pozdrawiam, Ania.");
    /* Pierwsza poprawka szła od nietkniętego oryginału — luki nie ma. */
    expect(screen.getAllByText("Twoje zmiany przed poprawką")).toHaveLength(1);
  });

  test("cudza rozmowa gasi też przycisk wersji", () => {
    render(<Dopytanie {...props({ wylaczony: true, wymiany: [poprawka(1, ORYGINAL, V2)] })} />);
    expect(screen.getByRole("button", { name: /Wstaw do odpowiedzi/ })).toBeDisabled();
  });
});

describe("zwijanie dopytania", () => {
  test("bez wymian blok jest ZWINIĘTY — wątpliwość rodzi się po przeczytaniu szkicu", () => {
    render(<Dopytanie {...props()} />);
    expect(screen.queryByRole("button", { name: /zapytaj/i })).toBeNull();
    expect(screen.getByText("Dopytaj Copilota")).toBeVisible();
  });

  test("odbyta wymiana otwiera blok sama — jest tam treść, nie sama możliwość", () => {
    render(<Dopytanie {...props({ wymiany: [w()] })} />);
    expect(screen.getByRole("button", { name: /zapytaj/i })).toBeVisible();
    expect(screen.getByText(/1 wymiana/)).toBeVisible();
  });

  test("liczebnik jest odmieniony — „3 wymian”, nie „3 wymiana”", () => {
    render(<Dopytanie {...props({ wymiany: [w(), w({ id: 2 }), w({ id: 3 })] })} />);
    expect(screen.getByText(/3 wymian/)).toBeVisible();
  });
});

/* ── Zdjęcia agenta przy pytaniu ─────────────────────────────────────────────
   Agent ma kartkę z wymiarami z innego kanału albo zdjęcie części z magazynu
   i chce, żeby Copilot je przeczytał. Testy pilnują trzech rzeczy:

   1. Zdjęcie wchodzi spinaczem i wklejeniem, z podglądem i z „Usuń”.
   2. Plik, którego serwer nie przyjmie, nie wchodzi wcale, a agent dostaje
      zdanie, dlaczego. Lepiej teraz niż po kilku megabajtach w sieci.
   3. Historia pokazuje, co poszło do modelu, także bez miniatury.          */
describe("zdjęcia w dopytaniu", () => {
  let adresy = 0;
  beforeEach(() => {
    adresy = 0;
    /* jsdom nie ma `URL.createObjectURL` — ten sam zastępnik co w `Ustawienia.test.tsx`. */
    URL.createObjectURL = vi.fn(() => `blob:podglad-${++adresy}`);
    URL.revokeObjectURL = vi.fn();
  });

  const zdjecie = (nazwa = "kartka.jpg", typ = "image/jpeg") =>
    new File([new Uint8Array([255, 216, 255])], nazwa, { type: typ });
  const wybierz = (...pliki: File[]) =>
    fireEvent.change(screen.getByLabelText("Wybierz zdjęcia do pytania"), { target: { files: pliki } });
  /** Schowek tak, jak widzi go zdarzenie `paste` — wzór z `WklejenieObrazu.test.tsx`. */
  const schowek = ({ tekst = "", obraz = null as File | null } = {}) => ({
    getData: (typ: string) => (typ === "text/plain" ? tekst : ""),
    items: obraz ? [{ kind: "file", type: obraz.type, getAsFile: () => obraz }] : [],
  });

  test("zdjęcie ze spinacza ma podgląd z nazwą i przycisk „Usuń”, a usunięcie zwalnia podgląd", () => {
    otworz(props());
    expect(screen.getByRole("button", { name: "Dołącz zdjęcie do pytania" })).toBeEnabled();
    wybierz(zdjecie());
    const podglad = screen.getByRole("img", { name: "kartka.jpg" });
    expect(podglad).toHaveAttribute("src", "blob:podglad-1");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie kartka.jpg" }));
    expect(screen.queryByRole("img", { name: "kartka.jpg" })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:podglad-1");
  });

  test("czwarte zdjęcie nie wchodzi, mówi dlaczego, a pełna lista gasi spinacz", () => {
    otworz(props());
    wybierz(zdjecie("a.jpg"), zdjecie("b.png", "image/png"), zdjecie("c.webp", "image/webp"),
      zdjecie("d.gif", "image/gif"));
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByRole("img", { name: "d.gif" })).toBeNull();
    expect(screen.getByText(/„d\.gif” nie weszło: do jednego pytania dołączysz najwyżej 3 zdjęcia/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dołącz zdjęcie do pytania" })).toBeDisabled();
  });

  test("za duże zdjęcie i plik, który nie jest zdjęciem, nie wchodzą — każdy ze swoim zdaniem", () => {
    otworz(props());
    const duze = zdjecie("tabliczka.jpg");
    Object.defineProperty(duze, "size", { value: 7_000_001 });
    wybierz(duze, zdjecie("faktura.pdf", "application/pdf"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText(/„tabliczka\.jpg” nie weszło: ma 7,1 MB, a granica to 7 MB/)).toBeInTheDocument();
    expect(screen.getByText(/„faktura\.pdf” nie wszedł: Copilot czyta zdjęcia JPEG, PNG, WEBP i GIF/))
      .toBeInTheDocument();
  });

  test("zdjęcie, które przebiłoby sumę 20 MB na pytanie, nie wchodzi i mówi dlaczego", () => {
    otworz(props());
    const [a, b, c] = ["a.jpg", "b.jpg", "c.jpg"].map((n) => {
      const z = zdjecie(n);
      Object.defineProperty(z, "size", { value: 6_900_000 });
      return z;
    });
    wybierz(a, b, c);

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /„c\.jpg” nie weszło: razem byłoby 20,7 MB, a granica na pytanie to 20 MB/);
  });

  test("obraz wklejony w trakcie „Pytam…” nie wchodzi, ale agent dostaje zdanie", () => {
    otworz(props({ pracuje: true }));
    fireEvent.paste(screen.getByLabelText(/pytanie do copilota/i),
      { clipboardData: schowek({ obraz: zdjecie("image.png", "image/png") }) });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/poczekaj na odpowiedź Copilota/);
  });

  test("obraz wklejony w pole dołącza się, a tekst wkleja się jak dotąd", () => {
    otworz(props());
    const pole = screen.getByLabelText(/pytanie do copilota/i);
    const zrzut = zdjecie("image.png", "image/png");
    const obraz = fireEvent.paste(pole, { clipboardData: schowek({ obraz: zrzut }) });
    expect(obraz).toBe(false);
    expect(screen.getByRole("img", { name: "image.png" })).toBeInTheDocument();

    /* Akapit z Worda niesie obok siebie swój obrazek — to wciąż tekst. */
    const tekst = fireEvent.paste(pole, { clipboardData: schowek({ tekst: "wymiary 46 cm", obraz: zrzut }) });
    expect(tekst).toBe(true);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  test("„Zapytaj” oddaje pliki razem z pytaniem i czyści listę jak pole", () => {
    const p = props();
    otworz(p);
    const plik = zdjecie();
    wybierz(plik);
    fireEvent.change(screen.getByLabelText(/pytanie do copilota/i), { target: { value: "przepisz wymiary" } });
    fireEvent.click(screen.getByRole("button", { name: /zapytaj/i }));

    expect(p.onPytaj).toHaveBeenCalledWith("przepisz wymiary", [plik]);
    expect(screen.queryByRole("img")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:podglad-1");
  });

  test("samo zdjęcie bez pytania nie wystarcza", () => {
    otworz(props());
    wybierz(zdjecie());
    expect(screen.getByRole("button", { name: /zapytaj/i })).toBeDisabled();
  });

  test("cudza rozmowa gasi spinacz", () => {
    otworz(props({ wylaczony: true }));
    expect(screen.getByRole("button", { name: "Dołącz zdjęcie do pytania" })).toBeDisabled();
  });

  test("historia pokazuje miniaturę z numerem i nazwą, a bez miniatury sam numer z nazwą", () => {
    render(<Dopytanie {...props({ wymiany: [w({ zdjecia: [
      { numer: "Z9", nazwa: "kartka.jpg", typ: "image/jpeg", bajtow: 120_000, miniatura: "QUJD" },
      { numer: "Z10", nazwa: "czesc.png", typ: "image/png", bajtow: 80_000, miniatura: null },
    ] })] })} />);
    expect(screen.getByRole("img", { name: "Zdjęcie Z9 dołączone do pytania: kartka.jpg" }))
      .toHaveAttribute("src", "data:image/jpeg;base64,QUJD");
    expect(screen.getByText("Z10 · czesc.png")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  test("wymiana ze starszego serwera, bez pola zdjęć, nie rysuje listy", () => {
    render(<Dopytanie {...props({ wymiany: [w()] })} />);
    expect(screen.queryByRole("list", { name: "Zdjęcia dołączone do pytania" })).toBeNull();
  });
});
