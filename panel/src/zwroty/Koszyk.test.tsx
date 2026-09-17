import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Koszyk } from "./Koszyk";
import type { KoszZwrotow } from "../api/typy";

/* ── Pasek koszyka zwrotów (0.192.0) ────────────────────────────────────────
   Obieg właściciela: pusta MM przy zasiadaniu do zwrotów, dokładanie pozycja
   po pozycji, domknięcie gdy kosz się zapełni.

   Te testy pilnują dwóch punktów dekalogu, które obowiązują panel biura:
   2 (pusty kosz nie zajmuje miejsca) i 5 (przycisku „dodaj" NIE MA, bo
   dokłada ocena „na stan").                                                 */

const { odpowiedz } = vi.hoisted(() => ({
  odpowiedz: {
    kosze: [] as KoszZwrotow[],
    czekajace: [] as Array<{
      id: number; kod: string; rodzaj: "zwroty" | "odpad"; zamknietoAt: string;
      brakuje: Array<{ zwrotId: number; numer: string }>;
      blad?: string | null;
      pozycje?: Array<{
        pozycjaId: number; symbol: string; nazwa: string; ilosc: number; zeZwrotu: boolean;
        stanMag?: number; brakNaMag?: boolean;
      }>;
    }>,
  },
}));

vi.mock("../api/zwroty", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useKosz: () => ({ data: odpowiedz }),
  useZamknijKosz: () => ({ mutate: zamknij, isPending: false, error: null }),
  useMmMimoKorekt: () => ({ mutate: mimo, isPending: false, error: null }),
  useZdejmijTowar: () => ({ mutate: zdejmijTowar, isPending: false, error: null }),
  useNowyKoszyk: () => ({ mutate: nowyKoszyk, isPending: false, error: null }),
  useUsunKoszyk: () => ({ mutate: usunKoszyk, isPending: false, error: null }),
}));

const zamknij = vi.fn();
const mimo = vi.fn();
const zdejmijTowar = vi.fn();
const nowyKoszyk = vi.fn();
const usunKoszyk = vi.fn();

const KOSZ = (n: Partial<KoszZwrotow> = {}): KoszZwrotow => ({
  rodzaj: "zwroty",
  id: 3, kod: "Z-7", pozycji: 2, sztuk: 5, otwartyOd: "2026-09-03T08:00:00Z",
  pozycje: [{ id: 91, symbol: "SEK-01", nazwa: "Sekator", ilosc: 2, zeZwrotu: true },
    /* Wiersz dołożony ręką (0.365.0) — ma własną drogę wyjścia. */
    { id: 92, symbol: "LOP-02", nazwa: "Łopata", ilosc: 3, zeZwrotu: false }],
  ...n,
});

const pokaz = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><Koszyk /></QueryClientProvider>);
};

describe("Koszyk zwrotów", () => {
  beforeEach(() => {
    odpowiedz.kosze = []; odpowiedz.czekajace = [];
    zamknij.mockClear(); mimo.mockClear(); zdejmijTowar.mockClear();
    nowyKoszyk.mockClear(); usunKoszyk.mockClear();
  });

  it("bez koszyka pasek proponuje ZAŁOŻENIE pudła i nic poza tym", () => {
    /* Punkt 2 dekalogu, zastosowany po zmianie z 0.378.0, a nie złamany.
       Reguła mówi: pokazuj to, co potrzebne TERAZ. Licznik zerowy nie jest
       potrzebny nigdy, ale wejście do pracy — owszem: zgłoszenie właściciela
       brzmiało „potrzebuję tworzenia koszy zwrotowych jako oddzielna opcja".

       Stąd granica: bez pudła widać JEDEN przycisk i zdanie o tym, czym ono
       jest. Żadnych liczników, żadnych pustych etykiet. */
    const bez = pokaz();
    expect(bez.getByRole("button", { name: /Nowy koszyk zwrotów/ })).toBeInTheDocument();
    expect(bez.queryByText(/poz\./)).toBeNull();
  });

  it("pusty koszyk JEST widoczny, bo to bieżąca praca operatora", () => {
    /* Pudło założone wprost stoi przy biurku i czeka na pierwszą sztukę.
       Niewidoczne kazałoby zgadywać, czy przycisk w ogóle zadziałał. */
    odpowiedz.kosze = [KOSZ({ pozycji: 0, sztuk: 0, pozycje: [] })];
    pokaz();

    expect(screen.getByText(/Koszyk zwrotów Z-7/)).toBeInTheDocument();
    expect(screen.getByText("pusty")).toBeInTheDocument();
    /* ZAMKNĄĆ GO NIE MA JAK: dokument bez linii nie jest dokumentem, więc
       serwer i tak odmówi. Zamiast przycisku, który zawsze odmawia, stoi
       droga wyjścia — i od 0.380.0 schodzi nią także pudło NAPEŁNIONE.
       Pusty nie pyta o nic: nie niesie niczyjej pracy. */
    expect(screen.queryByRole("button", { name: /Zamknij koszyk/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Usuń pusty koszyk/ })).toBeInTheDocument();
  });

  it("przycisk zakładania stoi TAKŻE przy otwartym pudle", () => {
    /* ODWRÓCENIE decyzji z 3 września („jeden koszyk na operatora"), zgłoszone
       przez właściciela w 0.379.0: przy biurku stoi czasem kilka kartonów,
       a zamykanie pierwszego po to, żeby zacząć drugi, wystawia dokument na
       pudło, które jeszcze nie odjechało.

       Zdanie obok przycisku zmienia się razem ze stanem: mówi, że przy kilku
       otwartych pudłach ocena zapyta, do którego. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByRole("button", { name: /Nowy koszyk zwrotów/ })).toBeInTheDocument();
    expect(screen.getByText(/ocena pyta, do którego/)).toBeInTheDocument();
  });

  it("pokazuje kod, licznik i symbole, gdy coś w nim leży", () => {
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByText(/Koszyk zwrotów Z-7/)).toBeInTheDocument();
    expect(screen.getByText(/2 poz\. · 5 szt\./)).toBeInTheDocument();
    /* SYMBOLE, nie nazwy: przy koszu liczy się to, co stoi na opakowaniu
       i na dokumencie MM. */
    expect(screen.getByText(/SEK-01, LOP-02/)).toBeInTheDocument();
  });

  it("dokładanie towaru stoi TAKŻE przy pudle, nie tylko przy zwrocie", () => {
    /* ODWRÓCENIE GRANICY z 0.365.0 („tylko z poziomu obsługi zwrotów"),
       zgłoszone przez właściciela w 0.378.0: „dodawanie produktów do nich jako
       oddzielna opcja".

       Tamto miejsce ZOSTAJE i to nie jest dublowanie wejścia. Przy otwartym
       zwrocie operator stoi nad kartonem konkretnej paczki — ekran idzie za
       czynnością fizyczną. Tutaj chodzi o drugą czynność: zbieranie towaru do
       pudła, które stoi przy biurku niezależnie od tego, co jest na ekranie.

       Ocena „na stan" dalej dokłada sama i nikt jej nie zastępuje przyciskiem. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByRole("button", { name: /Dołóż towar do koszyka/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zamknij koszyk/ })).toBeInTheDocument();
  });

  it("mówi WPROST, co się stanie po domknięciu", () => {
    /* Powstaje dokument w Subiekcie i kosz jedzie na halę. Ta sama zasada co
       przy korekcie: ekran nazywa skutek, zamiast go zaskakiwać. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.getByText(/MM z magazynu głównego na regał zwrotów/)).toBeInTheDocument();
  });

  it("koszyk czekający na korekty MÓWI, na co czeka i dlaczego", () => {
    /* Bez tego zamknięty kosz bez dokumentu wygląda na zaciętą kolejkę.
       MM zdejmuje towar z magazynu głównego, a ze zwrotu wraca on tam dopiero
       po korekcie — ekran ma to powiedzieć, nie kazać się domyślać. */
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    expect(screen.getByText(/Koszyk zwrotów Z-6/)).toBeInTheDocument();
    expect(screen.getByText(/ZW-7/)).toBeInTheDocument();
    expect(screen.getByText(/po korekcie/)).toBeInTheDocument();
  });

  it("czekający pokazuje się BEZ otwartego koszyka", () => {
    /* To praca biura, nie tego biurka: operator może nie mieć otwartego kosza,
       a zaległość i tak jest jego do dopilnowania. */
    odpowiedz.kosze = [];
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }, { zwrotId: 2, numer: "ZW-8" }],
    }];
    pokaz();
    expect(screen.getByText(/czeka na korekty/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zamknij koszyk/ })).toBeNull();
  });

  it("wymuszenie MM wymaga DRUGIEGO kliknięcia i mówi, co kosztuje", async () => {
    /* Decyzja właściciela: „dodaj opcję sforsowania zamknięcia koszyka, nawet
       jeśli nie ma wszystkich ZW". To jedyne miejsce w tym panelu, w którym
       pytamy „czy na pewno" — dekalog zabrania pytania po czynności, którą coś
       już potwierdziło, a tu potwierdzić nie ma czego: skutek widać dopiero
       w Subiekcie, gdy MM się wywróci. */
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }));
    expect(mimo).not.toHaveBeenCalled();
    /* Zdanie mówi KOSZT, nie „operacja nieodwracalna": człowiek ma wiedzieć,
       co konkretnie może pójść źle. */
    expect(screen.getByText(/stan zejdzie pod zero/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Tak, wystaw MM/ }));
    expect(mimo).toHaveBeenCalledWith(9, expect.anything());
  });

  it("wycofanie się z wymuszenia NIE wystawia dokumentu", async () => {
    odpowiedz.czekajace = [{
      id: 9, kod: "Z-6", rodzaj: "zwroty", zamknietoAt: "2026-09-03T09:00:00Z",
      brakuje: [{ zwrotId: 1, numer: "ZW-7" }],
    }];
    pokaz();
    await userEvent.click(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Nie$/ }));
    expect(mimo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Wystaw MM mimo braku korekt/ }))
      .toBeInTheDocument();
  });

  it("wiersz dołożony ręką ma krzyżyk, wiersz z oceny NIE", () => {
    /* Pomyłka przy skanie nie ma oceny, którą dałoby się cofnąć — więc musi
       mieć własną drogę wyjścia. Wiersz z oceny tej drogi mieć nie może:
       kasowanie cudzej oceny z drugiej strony ekranu rozjechałoby kartę
       zwrotu z koszykiem. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();
    expect(screen.queryByRole("button", { name: /Zdejmij SEK-01/ })).toBeNull();
    const krzyzyk = screen.getByRole("button", { name: /Zdejmij LOP-02 z koszyka/ });
    fireEvent.click(krzyzyk);
    expect(zdejmijTowar).toHaveBeenCalledWith(92);
  });

  it("koszyk bez wierszy dołożonych ręką nie pisze o nich ani słowa", () => {
    /* Etykieta „dołożone ręką" nad pustką byłaby napisem o braku — punkt 2
       dekalogu każe pokazywać to, co potrzebne teraz. */
    odpowiedz.kosze = [KOSZ({
      pozycje: [{ id: 91, symbol: "SEK-01", nazwa: "Sekator", ilosc: 2, zeZwrotu: true }],
      pozycji: 1, sztuk: 2,
    })];
    pokaz();
    expect(screen.queryByText(/dołożone ręką/)).toBeNull();
  });

  it("kosz z ODRZUCONĄ MM mówi, co odrzuciła Sfera, i daje krzyżyk przy pomyłce", async () => {
    /* Koszyk Z-8: skanem wszedł do niego KOSZT PRZESYŁKI — kartoteka bez stanu,
       więc Sfera odrzuciła dokument zdaniem „Brak towaru w magazynie". Do
       0.370.0 taki kosz nie pokazywał się w panelu w ogóle i nie było jak go
       poprawić; zgłoszenie właściciela: „pozwól mi edytować koszyki zwrotowe,
       z których nie zostały jeszcze utworzone MM". */
    odpowiedz.czekajace = [{
      id: 8, kod: "Z-8", rodzaj: "zwroty", zamknietoAt: "2026-09-15T09:00:00Z",
      brakuje: [], blad: "Brak towaru w magazynie",
      pozycje: [
        { pozycjaId: 77, symbol: "KOSZT-PRZESYLKI", nazwa: "Koszt przesyłki", ilosc: 1,
          zeZwrotu: false },
        /* Wiersz przyniesiony OCENĄ (0.379.0). Do tego wydania nie miał tu
           krzyżyka i to przez niego Z-8 nie dawał się odetkać z tego ekranu. */
        { pozycjaId: 78, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1, zeZwrotu: true },
      ],
    }];
    pokaz();
    expect(screen.getByText(/Brak towaru w magazynie/)).toBeInTheDocument();
    /* PRZYCISKU „wystaw" NIE MA, dopóki nieudane zadanie wisi przy koszu —
       druga MM obok pierwszej dałaby dwa papiery na jedno pudło. */
    expect(screen.queryByRole("button", { name: /Wystaw MM/ })).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: /Zdejmij KOSZT-PRZESYLKI z koszyka Z-8/ }));
    expect(zdejmijTowar).toHaveBeenCalledWith(77);

    /* WIERSZ ZE ZWROTU TEŻ SCHODZI, a etykieta mówi, co to kosztuje: jego
       zdjęcie cofa ocenę i odsyła zwrot do kubełka DO OCENY. */
    await userEvent.click(screen.getByRole(
      "button", { name: /Zdejmij SEK-01 z koszyka Z-8 i cofnij ocenę/ }));
    expect(zdejmijTowar).toHaveBeenCalledWith(78);
  });

  it("kosz z kompletem korekt wystawia MM JEDNYM kliknięciem", async () => {
    /* Stan po poprawce: zadanie zdjęto razem z pomyłką, a nikt go nie ponawia
       sam. Pytania „czy na pewno" tu nie ma i być nie może — zdanie wyżej mówi
       o koszcie, którego w tym stanie nie ma: stan jest na miejscu. */
    odpowiedz.czekajace = [{
      id: 8, kod: "Z-8", rodzaj: "zwroty", zamknietoAt: "2026-09-15T09:00:00Z",
      brakuje: [], blad: null, pozycje: [],
    }];
    pokaz();
    expect(screen.getByText(/komplet korekt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Wystaw MM$/ }));
    expect(mimo).toHaveBeenCalledWith(8);
  });

  it("usunięcie NAPEŁNIONEGO pudła pyta i mówi, co zniknie", async () => {
    /* Zgłoszenie właściciela (0.380.0): „zrób, żeby można było usunąć cały
       koszyk zwrotowy". Pytamy tylko przy zawartości — pudło puste nie niesie
       niczyjej pracy, więc pytanie byłoby bez treści.

       Zdanie mówi SKUTEK, nie „operacja nieodwracalna": oceny wracają do
       kubełka DO OCENY, a towar zostaje tam, gdzie leży. */
    odpowiedz.kosze = [KOSZ()];
    pokaz();

    await userEvent.click(screen.getByRole("button", { name: /^Usuń koszyk$/ }));
    expect(screen.getByText(/Oceny wrócą do kubełka DO OCENY/)).toBeInTheDocument();
    expect(screen.getByText(/2 pozycjami/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Tak, usuń Z-7/ }));
    expect(usunKoszyk).toHaveBeenCalledWith(3, expect.anything());
  });

  it("zaległy koszyk też da się usunąć w całości", async () => {
    /* To one zajmowały właścicielowi pół ekranu, a zdejmowanie ich wiersz po
       wierszu było jedyną drogą — i dlatego nikt tego nie robił. */
    odpowiedz.czekajace = [{
      id: 8, kod: "Z-8", rodzaj: "zwroty", zamknietoAt: "2026-09-15T09:00:00Z",
      brakuje: [], blad: "Brak towaru w magazynie",
      pozycje: [{ pozycjaId: 77, symbol: "S10111", nazwa: "Usługa", ilosc: 5,
        zeZwrotu: false }],
    }];
    pokaz();

    await userEvent.click(screen.getByRole("button", { name: /^Usuń koszyk$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Tak, usuń Z-8/ }));
    expect(usunKoszyk).toHaveBeenCalledWith(8, expect.anything());
  });

  it("odmowa Sfery WSKAZUJE wiersz, którego na magazynie brakuje", async () => {
    /* Produkcja, 17 września: „dostaję brak towaru w magazynie, ale nie mówi
       jakiego, abym mógł go usunąć z koszyka". Sfera nie nazywa wiersza —
       nazywamy go za nią, stanem z read-modelu. */
    odpowiedz.czekajace = [{
      id: 14, kod: "Z-14", rodzaj: "zwroty", zamknietoAt: "2026-09-17T06:00:00Z",
      brakuje: [], blad: 'Sfera odrzuciła "MM.Zapisz()": Brak towaru w magazynie.',
      pozycje: [
        { pozycjaId: 91, symbol: "S10111", nazwa: "Usługa", ilosc: 5,
          zeZwrotu: false, stanMag: 0, brakNaMag: true },
        { pozycjaId: 92, symbol: "SEK-01", nazwa: "Sekator", ilosc: 1,
          zeZwrotu: true, stanMag: 4, brakNaMag: false },
      ],
    }];
    pokaz();

    expect(screen.getByText(/na magazynie 0 z 5/)).toBeInTheDocument();
    expect(screen.getByText(/Czerwone wiersze niżej/)).toBeInTheDocument();
    /* Wiersz z pokryciem nie jest oskarżany — inaczej lista wskazywałaby
       wszystko naraz, czyli nic. */
    expect(screen.queryByText(/na magazynie 4 z 1/)).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: /Zdejmij S10111 z koszyka Z-14/ }));
    expect(zdejmijTowar).toHaveBeenCalledWith(91);
  });
});
