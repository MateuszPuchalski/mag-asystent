import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Pieniadze } from "./Pieniadze";
import type { AkcjeKlawiszy } from "./klawisze";
import type { StanZwrotuPieniedzy } from "../api/typy";

/* ── Pieniądze przy zwrocie (§25a, 0.190.0) ──────────────────────────────────
   Ten ekran jako pierwszy w panelu rusza cudze pieniądze, więc testy pilnują
   nie wyglądu, tylko czterech rzeczy: że przeszkoda MÓWI, czego brakuje; że
   przycisk nie stoi tam, gdzie serwer i tak odmówi; że odmowa bez powodu nie
   wychodzi; i że po zapłacie nie ma czym kliknąć drugi raz.                 */

const stan = (n: Partial<StanZwrotuPieniedzy> = {}): StanZwrotuPieniedzy => ({
  moznaZwrocic: true, moznaOdmowic: true, powod: null,
  kwotaGrosze: 6498, waluta: "PLN", oddane: null, odmowa: null,
  przelew: null, moznaZapisacPrzelew: false, powodPrzelewu: null,
  dosylka: null, sledzicDosylke: false, ...n,
});

/* Router, bo zdanie o dosyłce prowadzi odnośnikiem do profilu klienta. */
const ekran = (n: Partial<Parameters<typeof Pieniadze>[0]> = {}) =>
  render(<Pieniadze stan={stan()} trwa={false} blad=""
    onZwroc={vi.fn()} onOdmow={vi.fn()} {...n} />, { wrapper: MemoryRouter });

type Odmowa = NonNullable<StanZwrotuPieniedzy["odmowa"]>;
/** Dosyłka i ponowienie stoją OBOK odmowy, nie w niej — tak je oddaje serwer. */
type ZDosylka = Partial<Odmowa> & Partial<Pick<StanZwrotuPieniedzy, "dosylka" | "sledzicDosylke">>;
/** Stan po odmowie — tak go oddaje serwer po odświeżeniu szczegółu. */
const poOdmowie = ({ dosylka = null, sledzicDosylke = false, ...n }: ZDosylka = {}) =>
  stan({ moznaZwrocic: false, moznaOdmowic: false, dosylka, sledzicDosylke,
    odmowa: { kod: "NEW_ITEM_SENT", powod: null, kiedy: "2026-09-27T10:00:00Z", ...n } });
/** Odmowa z panelu Allegro: naszej `odmowa` nie ma, kod przychodzi synchronizacją. */
const zAllegro = (n: Partial<Pick<StanZwrotuPieniedzy, "dosylka" | "sledzicDosylke">>) =>
  stan({ moznaZwrocic: false, moznaOdmowic: false, ...n });
const W_DRODZE = { opis: "Dosyłka w drodze (stan z 14:10)", login: "zielony", ton: null } as const;
/** Odpowiedź udanego założenia — krok podaje serwer, nie ekran. */
const zalozona = (zastapil: string | null) => ({ zalozona: true as const, login: "zielony",
  krokDo: "2026-09-30T06:00:00Z", krok: "Dosłać nowy towar (etykieta w Sellasist)", zastapil });

describe("Pieniądze przy zwrocie", () => {
  it("pokazuje kwotę i przycisk, gdy da się oddać", () => {
    ekran();
    expect(screen.getByText("64,98 PLN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Oddaj pieniądze/ })).toBeInTheDocument();
  });

  /* Wyłączony przycisk bez powodu każe zgadywać, czego brakuje. */
  it("przeszkoda jest zdaniem, a przycisku oddania nie ma wcale", () => {
    ekran({ stan: stan({ moznaZwrocic: false, powod: "Najpierw zaznacz, co oddajemy." }) });
    expect(screen.getByText(/Najpierw zaznacz/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Oddaj pieniądze/ })).toBeNull();
  });

  /* Przed werdyktem przeszkoda jest JEDNA i znana (0.453.0): oś etapów nad
     sekcją już ją pokazuje, więc zdanie schodzi do znacznika z kłódką. Treść
     nie ginie — stoi w podpowiedzi, słowo w słowo z serwera. */
  it("przed werdyktem zamiast zdania stoi kłódka „po werdykcie”", () => {
    const powod = "Najpierw przyjmij zwrot — pieniądze oddaje się po werdykcie.";
    ekran({ przedWerdyktem: true, stan: stan({ moznaZwrocic: false, powod }) });
    expect(screen.getByText("po werdykcie")).toHaveAttribute("title", powod);
    expect(screen.queryByText(powod)).toBeNull();
  });

  it("po werdykcie przeszkoda wraca do zdania — każda inna mówi, co zrobić", () => {
    ekran({ przedWerdyktem: false, stan: stan({ moznaZwrocic: false, powod: "Najpierw zaznacz, co oddajemy." }) });
    expect(screen.getByText(/Najpierw zaznacz/)).toBeInTheDocument();
    expect(screen.queryByText("po werdykcie")).toBeNull();
  });

  /* Pobranie: oddać przez Allegro się nie da, ale odmówić owszem — to dwie
     różne drogi, nie dwa warianty jednej. */
  it("przy pobraniu zostaje sama odmowa", () => {
    ekran({ stan: stan({ moznaZwrocic: false, powod: "Zamówienie za pobraniem — oddaj przelewem." }) });
    expect(screen.queryByRole("button", { name: /Oddaj pieniądze/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Odmów wypłaty/ })).toBeInTheDocument();
  });

  it("po oddaniu pokazuje numer z Allegro i nie oferuje drugiego kliknięcia", () => {
    ekran({ stan: stan({ moznaZwrocic: false,
      oddane: { id: "ref-9", status: "SUCCEEDED", kiedy: null, potwierdzone: true } }) });
    expect(screen.getByText("ref-9")).toBeInTheDocument();
    expect(screen.getByText(/Oddano/)).toBeInTheDocument();
    /* Kwota stoi tylko tutaj (0.516.0) — po oddaniu nie może zniknąć,
       bo zamknięty zwrot nie mówiłby wtedy nigdzie, ile wyszło. */
    expect(screen.getByText("64,98 PLN")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Oddaj pieniądze/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Odmów wypłaty/ })).toBeNull();
  });

  it("przyjęte polecenie NIE UDAJE oddanych pieniędzy", () => {
    /* 0.209.0: do tego wydania stało tu „Oddano" od chwili, w której Allegro
       przyjęło polecenie. Przelew odrzucony godzinę później wyglądał na
       ekranie dokładnie tak samo jak udany. */
    ekran({ stan: stan({ moznaZwrocic: false,
      oddane: { id: "ref-9", status: "SUCCEEDED", kiedy: null, potwierdzone: false } }) });
    expect(screen.getByText(/jeszcze nie potwierdziło/)).toBeInTheDocument();
    expect(screen.queryByText(/Oddano/)).toBeNull();
  });

  /* ŻADEN KOD NIE JEST WYBRANY Z GÓRY (audyt, 15 września 2026). Stał tu
     `REFUND_REJECTED` i wyglądało to bezpiecznie, bo jako jedyny żąda powodu.
     Skutek był odwrotny: uzasadnienie „wysłaliśmy nowy towar" wychodziło do
     klienta pod oświadczeniem, że odmawiamy zwrotu pieniędzy. */
  it("odmowa nie ma kodu wybranego z góry i bez wskazania nie wychodzi", async () => {
    const onOdmow = vi.fn();
    ekran({ onOdmow });
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    expect(screen.getByLabelText("Kod odmowy")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Wyślij odmowę/ })).toBeDisabled();
    /* Sam powód nie odblokowuje: brakuje tego, czego klient nie zgadnie. */
    await userEvent.type(screen.getByLabelText(/Uzasadnienie/), "Towar wrócił uszkodzony");
    expect(screen.getByRole("button", { name: /Wyślij odmowę/ })).toBeDisabled();
    expect(onOdmow).not.toHaveBeenCalled();
  });

  it("odmowa z kodem wymagającym powodu nie wychodzi pusta", async () => {
    const onOdmow = vi.fn();
    ekran({ onOdmow });
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    await userEvent.selectOptions(screen.getByLabelText("Kod odmowy"), "REFUND_REJECTED");
    expect(screen.getByRole("button", { name: /Wyślij odmowę/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Uzasadnienie/), "Towar wrócił uszkodzony");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odmowę/ }));
    expect(onOdmow).toHaveBeenCalledWith("REFUND_REJECTED", "Towar wrócił uszkodzony");
  });

  it("kod bez wymogu powodu wychodzi bez uzasadnienia", async () => {
    const onOdmow = vi.fn();
    ekran({ onOdmow });
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    await userEvent.selectOptions(screen.getByLabelText("Kod odmowy"), "NO_RETURN_RIGHT");
    await userEvent.click(screen.getByRole("button", { name: /Wyślij odmowę/ }));
    expect(onOdmow).toHaveBeenCalledWith("NO_RETURN_RIGHT", null);
  });

  /* Powód czyta KLIENT w Allegro, nie zespół — ekran musi to mówić. */
  it("mówi wprost, że powód trafia do klienta", async () => {
    ekran();
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    expect(screen.getByText(/trafia do klienta w Allegro/)).toBeInTheDocument();
  });

  it("w trakcie żądania przycisk jest zablokowany", () => {
    ekran({ trwa: true });
    expect(screen.getByRole("button", { name: /Oddaję…/ })).toBeDisabled();
  });

  /* ── Klawisz `Z` (audyt, 15 września 2026) ───────────────────────────
     Tabela §25a.2 obiecuje klawisz na kubełek, a ostatni krok — jedyny, który
     rusza pieniędzmi — nie miał żadnego. Testy idą przez REJESTR, bo taką
     drogą chodzi prawdziwy nasłuch z `ekrany/Zwroty.tsx`.                    */
  const rejestr = () => ({ current: {} as AkcjeKlawiszy });

  it("klawisz oddaje pieniądze przez rejestr ekranu", () => {
    const akcje = rejestr();
    const onZwroc = vi.fn();
    ekran({ akcje, onZwroc });
    akcje.current.oddajPieniadze?.();
    expect(onZwroc).toHaveBeenCalled();
  });

  it("klawisz milczy dokładnie tam, gdzie nie ma przycisku", () => {
    /* Gorszy od braku skrótu jest skrót robiący coś, czego nie widać — przy
       pobraniu Allegro tych pieniędzy nie trzymało i żądanie wróciłoby odmową. */
    const akcje = rejestr();
    const onZwroc = vi.fn();
    ekran({ akcje, onZwroc,
      stan: stan({ moznaZwrocic: false, powod: "Zamówienie za pobraniem." }) });
    akcje.current.oddajPieniadze?.();
    expect(onZwroc).not.toHaveBeenCalled();
  });

  it("klawisz nie wysyła drugiego żądania w trakcie pierwszego", () => {
    const akcje = rejestr();
    const onZwroc = vi.fn();
    ekran({ akcje, onZwroc, trwa: true });
    akcje.current.oddajPieniadze?.();
    expect(onZwroc).not.toHaveBeenCalled();
  });

  it("przycisk pokazuje swój klawisz, bo rozpoznanie jest tańsze od pamiętania", () => {
    ekran();
    expect(screen.getByRole("button", { name: /Z Oddaj pieniądze/ })).toBeInTheDocument();
  });

  /* ── Przelew oddany poza Allegro (0.269.0) ─────────────────────────────────
     Przy pobraniu to JEDYNY ślad po wypłacie, jaki może powstać. */
  it("przy pobraniu daje pole na numer przelewu i zapisuje ślad", async () => {
    const onPrzelew = vi.fn();
    ekran({
      stan: stan({
        moznaZwrocic: false, powod: "Zamówienie za pobraniem — oddaj przelewem.",
        moznaZapisacPrzelew: true,
      }),
      onPrzelew,
    });
    await userEvent.type(screen.getByLabelText("Numer przelewu"), "PRZ/2026/09/14");
    await userEvent.click(screen.getByRole("button", { name: /Zapisz przelew/ }));
    expect(onPrzelew).toHaveBeenCalledWith("PRZ/2026/09/14");
  });

  /* Numer bywa znany dopiero z wyciągu — wymóg kazałby wpisać cokolwiek. */
  it("pusty numer nie blokuje zapisu, a idzie jako brak", async () => {
    const onPrzelew = vi.fn();
    ekran({ stan: stan({ moznaZwrocic: false, moznaZapisacPrzelew: true }), onPrzelew });
    await userEvent.click(screen.getByRole("button", { name: /Zapisz przelew/ }));
    expect(onPrzelew).toHaveBeenCalledWith(null);
  });

  it("zapisany przelew widać z numerem i da się go cofnąć", async () => {
    const onCofnijPrzelew = vi.fn();
    ekran({
      stan: stan({
        moznaZwrocic: false, moznaZapisacPrzelew: false,
        przelew: { kiedy: "2026-09-14T10:00:00Z", przez: "Ala", referencja: "PRZ/1" },
      }),
      onCofnijPrzelew,
    });
    expect(screen.getByText(/Oddano przelewem/)).toBeInTheDocument();
    expect(screen.getByText("PRZ/1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Zapisz przelew/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /cofnij/i }));
    expect(onCofnijPrzelew).toHaveBeenCalled();
  });

  /* Przy płatności online ten blok nie ma po co stać: pieniądze oddaje
     Allegro, a druga droga obok pierwszej kazałaby wybierać. */
  it("bez zgody serwera pola przelewu nie ma wcale", () => {
    ekran({ stan: stan({ moznaZapisacPrzelew: false }), onPrzelew: vi.fn() });
    expect(screen.queryByLabelText("Numer przelewu")).toBeNull();
  });

  /* ── Odmowa z kodem dosyłki (0.536.0) ────────────────────────────────────
     Zła paczka wraca, biuro odmawia wypłaty kodem „Wysłaliśmy nowy towar”
     i wysyła właściwy towar. Testy pilnują czterech rzeczy: kod mówi słowami,
     a nie nazwą pola Allegro; formularz odmowy nie dostaje nowego wyboru, tylko
     zdanie o skutku; stan dosyłki prowadzi do profilu; a nieudany zapis u nas
     nie przykrywa odmowy, która już wyszła.                                  */
  it("odmowa mówi etykietą kodu, nie surowym `NEW_ITEM_SENT`", () => {
    ekran({ stan: poOdmowie() });
    expect(screen.getByText("Odmówiono: „Wysłaliśmy nowy towar”")).toBeInTheDocument();
    expect(screen.queryByText(/NEW_ITEM_SENT/)).toBeNull();
  });

  /* Kod spoza listy w `stan.odmowa` nie przychodzi: to pole niesie wyłącznie
     naszą odmowę z listy wyżej. Surowy kod z synchronizacji pilnuje
     `Dowody.test.tsx`, bo tam stoi `rejectionCode`. */
  it("kod z uwagą dla operatora traci ją po wysłaniu i mówi faktem, nie pierwszą osobą", () => {
    ekran({ stan: poOdmowie({ kod: "REFUND_REJECTED", powod: "Uszkodzony" }) });
    expect(screen.getByText("Odmówiono: „Odmowa zwrotu pieniędzy”")).toBeInTheDocument();
    expect(screen.queryByText(/Odmawiam/)).toBeNull();
  });

  it("zdanie o skutku stoi przy kodach dosyłki i tylko przy nich — bez nowego wyboru", async () => {
    ekran();
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    /* Brzmienia kroku tu nie ma: ustawia je serwer, a ekran go nie zgaduje. */
    const skutek = /^Sprawa klienta dostanie krok dosyłki i jej śledzenie\.$/;
    expect(screen.queryByText(skutek)).toBeNull();
    for (const [kod, jest] of [["NEW_ITEM_SENT", true], ["MISSING_PART_SENT", true],
      ["REFUND_REJECTED", false], ["ITEM_FIXED", false], ["NO_RETURN_RIGHT", false]] as const) {
      await userEvent.selectOptions(screen.getByLabelText("Kod odmowy"), kod);
      if (jest) expect(screen.getByText(skutek)).toBeInTheDocument();
      else expect(screen.queryByText(skutek)).toBeNull();
    }
    /* Dekalog p. 5: jedna lista kodów i jedno pole powodu, jak przed dosyłką. */
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("pod odmową stoi stan dosyłki w barwie tonu i odnośnik do profilu", () => {
    ekran({ stan: poOdmowie({ dosylka: { opis: "Przewoźnik zgłosił problem z dosyłką",
      login: "Client:105505227", ton: "zle" } }) });
    const zdanie = screen.getByText("Przewoźnik zgłosił problem z dosyłką");
    expect(zdanie.className).toContain("text-ranga-zle");
    /* Login bywa z dwukropkiem — adres profilu idzie zakodowany. */
    expect(screen.getByRole("link", { name: /profil klienta/ }))
      .toHaveAttribute("href", "/obsluga/klient/Client%3A105505227");
    expect(screen.queryByRole("button", { name: "Śledź dosyłkę" })).toBeNull();
    /* Ciężarówka to ozdoba — czytnik ekranu czyta samo zdanie. */
    expect(zdanie.parentElement!.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  /* ── Odmowa złożona w panelu Allegro ───────────────────────────────────────
     Gdzie biuro odmawia — na naszym ekranie zwrotu czy w panelu Allegro — nie
     wiadomo. Kod z panelu Allegro przychodzi synchronizacją, bez naszej
     `odmowa`, a dosyłkę serwer liczy i wtedy. Linijka stoi więc niezależnie
     od `odmowa`, z faktem odmowy obok, żeby nie wisiała bez powodu. */
  it("odmowa z panelu Allegro dostaje linijkę dosyłki z faktem odmowy obok", () => {
    const przeszkoda = "Odmowa zwrotu pieniędzy jest już zgłoszona w Allegro.";
    ekran({ stan: { ...zAllegro({ dosylka: W_DRODZE }), powod: przeszkoda }, kodAllegro: "NEW_ITEM_SENT" });
    /* Fakt odmowy stoi raz w tej sekcji — zdanie przeszkody go nie powtarza. */
    expect(screen.queryByText(przeszkoda)).toBeNull();
    expect(screen.getByText("Odmówiono w Allegro: „Wysłaliśmy nowy towar”")).toBeInTheDocument();
    expect(screen.getByText("Dosyłka w drodze (stan z 14:10)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /profil klienta/ })).toHaveAttribute("href", "/obsluga/klient/zielony");
    /* Nasza odmowa ma swoje zdanie — tamto się nie dubluje. */
    expect(screen.queryByText(/^Odmówiono: /)).toBeNull();
  });

  it("odmowa z panelu Allegro bez śledzenia daje „Śledź dosyłkę”", async () => {
    const onSledzDosylke = vi.fn();
    ekran({ stan: zAllegro({ sledzicDosylke: true }), kodAllegro: "MISSING_PART_SENT", onSledzDosylke });
    expect(screen.getByText("Odmówiono w Allegro: „Wysłaliśmy brakującą część”")).toBeInTheDocument();
    expect(screen.getByText("Dosyłki nie śledzimy.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Śledź dosyłkę" }));
    expect(onSledzDosylke).toHaveBeenCalledTimes(1);
  });

  it("kod z synchronizacji bez dosyłki nie dostaje tu zdania — stoi w kolumnie dowodów", () => {
    ekran({ stan: zAllegro({}), kodAllegro: "ITEM_FIXED" });
    expect(screen.queryByText(/Odmówiono w Allegro/)).toBeNull();
  });

  it("dosyłki nikt nie śledzi — zdanie i jeden przycisk, który woła ponowienie", async () => {
    const onSledzDosylke = vi.fn();
    ekran({ stan: poOdmowie({ sledzicDosylke: true }), onSledzDosylke });
    expect(screen.getByText("Dosyłki nie śledzimy.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Śledź dosyłkę" }));
    expect(onSledzDosylke).toHaveBeenCalledTimes(1);
    /* Wołanie bez argumentów: ciała trasa nie przyjmuje, zwrot zna ekran. */
    expect(onSledzDosylke).toHaveBeenCalledWith();
  });

  it("w trakcie zapisu „Śledź dosyłkę” jest zablokowane", () => {
    ekran({ stan: poOdmowie({ sledzicDosylke: true }), onSledzDosylke: vi.fn(), trwa: true });
    expect(screen.getByRole("button", { name: "Śledź dosyłkę" })).toBeDisabled();
  });

  it("nieudane założenie mówi najpierw, że odmowa wyszła", () => {
    ekran({ stan: poOdmowie({ sledzicDosylke: true }), onSledzDosylke: vi.fn(),
      wynikDosylki: { zalozona: false, blad: "Zwrot nie ma numeru zamówienia." } });
    expect(screen.getByText(
      "Odmowa wysłana; śledzenia dosyłki nie założono — Zwrot nie ma numeru zamówienia.")).toBeInTheDocument();
    /* Ponowienie stoi obok, z odświeżonego stanu — nie trzeba go szukać. */
    expect(screen.getByRole("button", { name: "Śledź dosyłkę" })).toBeInTheDocument();
  });

  it("zastąpiony krok sprawy klienta dostaje jednorazowe zdanie z krokiem serwera, pusty — żadnego", () => {
    const { unmount } = ekran({ stan: poOdmowie(), wynikDosylki: zalozona("czekamy na zwrot") });
    expect(screen.getByText(
      "Krok sprawy klienta: „Dosłać nowy towar (etykieta w Sellasist)” zamiast „czekamy na zwrot”"))
      .toBeInTheDocument();
    unmount();
    ekran({ stan: poOdmowie(), wynikDosylki: zalozona(null) });
    expect(screen.queryByText(/Krok sprawy klienta/)).toBeNull();
    expect(screen.queryByText(/nie założono/)).toBeNull();
  });

  it("formularz odmowy znika, gdy odmowa już stoi — drugiej Allegro nie przyjmie", async () => {
    const { rerender } = ekran();
    await userEvent.click(screen.getByRole("button", { name: /Odmów wypłaty/ }));
    expect(screen.getByLabelText("Kod odmowy")).toBeInTheDocument();
    rerender(<Pieniadze stan={poOdmowie()} trwa={false} blad="" onZwroc={vi.fn()} onOdmow={vi.fn()} />);
    expect(screen.queryByLabelText("Kod odmowy")).toBeNull();
    expect(screen.queryByRole("button", { name: /Wyślij odmowę/ })).toBeNull();
  });
});
