import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Kolejka } from "./Kolejka";
import type { Kategoria, Kopilot, Rozmowa } from "../api/typy";

const rozmowa = (n: Partial<Rozmowa> = {}): Rozmowa => ({
  id: 4821, klient: "Kupujący 44300444",
  ostatniaWiadomosc: "Czy ten szarpak pasuje do NAC LS 46-450?",
  ostatniaWiadomoscAt: "2026-09-01T07:12:00.000Z", ostatniaOdKlienta: true,
  nieprzeczytana: false, wlascicielId: null, wlasciciel: null, wersja: 1,
  status: "new", odlozoneDo: null, poTerminie: false, podziekowal: false, oglada: null,
  priorytet: "normalny", czekaOdMs: null, reklamacyjna: false, nowychOdOdpowiedzi: 0, zadanieWToku: false, dobor: "not_started",
  kopilot: null, ...n,
});

const STAN = { ostatniaSynchronizacja: "2026-09-01T07:05:00.000Z", bledy: 0 };

describe("Kolejka", () => {
  it("pusta lista mówi o sobie, ale data synchronizacji zostaje", () => {
    /* Pusta kolejka o 9:41 znaczy co innego, gdy synchronizator stanął o 7:05.
       Ekran nie ma prawa milczeć o tej różnicy. */
    render(<Kolejka rozmowy={[]} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/Brak rozmów/)).toBeInTheDocument();
    /* Od 0.193.0 data stoi PODPISEM pod tytułem kolumny, a nie własnym pasmem
       — pasm sterujących nad listą było pięć. Zdanie ma zostać, nie pasmo. */
    expect(screen.getByText(/synchronizacja/)).toBeInTheDocument();
  });

  it("liczba błędów synchronizacji jest widoczna, gdy jest niezerowa", () => {
    const { rerender } = render(<Kolejka rozmowy={[]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/błędów/)).not.toBeInTheDocument();
    rerender(<Kolejka rozmowy={[]} stan={{ ...STAN, bledy: 3 }} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/błędów: 3/)).toBeInTheDocument();
  });

  it("wiersz niesie klienta, fragment, właściciela i znacznik nowej wiadomości", () => {
    render(<Kolejka rozmowy={[rozmowa({ nieprzeczytana: true, wlasciciel: "M. Wójcik" })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("Kupujący 44300444")).toBeInTheDocument();
    expect(screen.getByText(/szarpak pasuje/)).toBeInTheDocument();
    expect(screen.getByText("M. Wójcik")).toBeInTheDocument();
    expect(screen.getByText("NOWE")).toBeInTheDocument();
  });

  it("podgląd naszej wiadomości jest podpisany, podgląd klienta — nie", () => {
    /* Kolejka pokazuje słowa KLIENTA (0.166.0). Gdy klient nic nie napisał,
       stoi nasze zdanie z podpisem „Biuro" — bez niego autoodpowiedź konta
       Allegro czytała się jak pytanie. */
    const { rerender } = render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/Biuro:/)).not.toBeInTheDocument();
    rerender(<Kolejka rozmowy={[rozmowa({ ostatniaOdKlienta: false,
      ostatniaWiadomosc: "Przesyłka wyszła dziś." })]} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText(/Biuro:/)).toBeInTheDocument();
    expect(screen.getByText(/Przesyłka wyszła dziś/)).toBeInTheDocument();
  });

  it("kliknięcie wiersza oddaje identyfikator rozmowy", async () => {
    const wybierz = vi.fn();
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={wybierz} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByText("Kupujący 44300444"));
    expect(wybierz).toHaveBeenCalledWith(4821);
  });

  it("nieświeża kolejka nie powtarza alarmu, ale mówi, z kiedy jest stan", () => {
    /* Pusta kolejka przy stojącym synchronizatorze to nie „brak pytań",
       tylko „nie wiem". Od 0.522.0 mówi to baner alarmu nad kolumnami
       (`nieswieza` to dokładnie jego warunek), więc plakietka „STAN Z"
       i stopka zeszły. Godzina synchronizacji przy tytule zostaje (0.193.0). */
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={null} laduje={false}
      nieswieza onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText(/STAN Z/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nie zostały jeszcze pobrane/)).not.toBeInTheDocument();
    expect(screen.getByText(/synchronizacja/)).toBeInTheDocument();
  });

  it("wybrany wiersz jest oznaczony dla czytnika ekranu, nie tylko kolorem", () => {
    render(<Kolejka rozmowy={[rozmowa()]} stan={STAN} wybranaId={4821} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByRole("button", { current: true })).toBeInTheDocument();
  });

  /* Kubełki z §10.1. Filtr sprawdzamy PO WIERSZACH, nie po liczniku: licznik
     zgodny z pustą listą byłby błędem, którego test po samym liczniku nie
     zobaczy. */
  const KOMPLET = [
    rozmowa({ id: 1, klient: "Nieprzypisana", status: "open" }),
    rozmowa({ id: 2, klient: "Moja", status: "open", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 3, klient: "Czeka", status: "waiting_for_customer", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 4, klient: "Zapomniana", status: "open", poTerminie: true,
      odlozoneDo: "2026-08-30T06:00:00.000Z" }),
    rozmowa({ id: 5, klient: "Sprawa z archiwum", status: "closed" }),
  ];

  const kubelek = async (etykieta: RegExp) => {
    render(<Kolejka rozmowy={KOMPLET} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: etykieta }));
  };

  it("kubełek MOJE pokazuje wyłącznie rozmowy zalogowanego agenta, przy których ruch jest nasz", async () => {
    await kubelek(/^Moje/);
    expect(screen.getByText("Moja")).toBeInTheDocument();
    /* Od 23 września 2026 czekanie na klienta nie jest pracą — stoi
       w „Oczekujących", nie w „Moje". */
    expect(screen.queryByText("Czeka")).not.toBeInTheDocument();
    expect(screen.queryByText("Nieprzypisana")).not.toBeInTheDocument();
    /* Od 0.506.0 „Oczekujące" i „Zakończone" stoją pod „Więcej". */
    await userEvent.selectOptions(screen.getByLabelText("Więcej kubełków"), "Oczekujące · 1");
    expect(screen.getByText("Czeka")).toBeInTheDocument();
  });

  it("zakończona schodzi z roboczych do „Zakończonych” — także zamknięta sprzed tej wersji", async () => {
    render(<Kolejka rozmowy={KOMPLET} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Więcej kubełków"), "Zakończone · 1");
    expect(screen.getByText("Sprawa z archiwum")).toBeInTheDocument();
    expect(screen.queryByText("Moja")).not.toBeInTheDocument();
  });

  it("kubełka PO TERMINIE nie ma — odszedł z ręcznym odłożeniem (22 września 2026)", () => {
    render(<Kolejka rozmowy={KOMPLET} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Po terminie/ })).not.toBeInTheDocument();
  });

  it("zamknięta rozmowa schodzi z kolejki roboczej, ale zostaje we WSZYSTKICH", async () => {
    /* Ukrycie jej wszędzie znaczyłoby, że pomyłkowego zamknięcia nie da się
       cofnąć — nikt nie szuka sprawy, której nie widać na żadnej liście. */
    await kubelek(/^Nieprzypisane/);
    expect(screen.queryByText("Sprawa z archiwum")).not.toBeInTheDocument();
    /* „Wszystkie" stoi od @wydanie pod „Więcej" — cyfra 6 dalej go wybiera. */
    await userEvent.keyboard("6");
    expect(screen.getByText("Sprawa z archiwum")).toBeInTheDocument();
  });

  it("pusty kubełek nie udaje pustej skrzynki", async () => {
    /* „Nic nie czeka na mnie" i „nic nie przyszło" to dwa różne zdania.
       Jedno z nich kazałoby agentowi sprawdzać synchronizację. */
    render(<Kolejka rozmowy={[rozmowa({ status: "open" })]} stan={STAN} wybranaId={null}
      mojeId={7} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^Moje/ }));
    expect(screen.getByText(/Ten kubełek jest pusty/)).toBeInTheDocument();
    expect(screen.queryByText(/Brak rozmów w zsynchronizowanej skrzynce/)).not.toBeInTheDocument();
  });

  it("wiersz niesie status po polsku i znacznik minionego terminu", () => {
    render(<Kolejka rozmowy={[rozmowa({ status: "open", poTerminie: true })]} stan={STAN}
      wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("Otwarta")).toBeInTheDocument();
    expect(screen.getByText(/po terminie/)).toBeInTheDocument();
  });

  it("wiersz mówi, kto siedzi przy rozmowie — ale nie o mnie samym", () => {
    /* Uchwyt widać ZANIM padnie pierwsze słowo odpowiedzi. Dowiadywanie się
       o koledze dopiero przy wysyłce znaczy dwie napisane odpowiedzi. */
    const { rerender } = render(<Kolejka
      rozmowy={[rozmowa({ oglada: { userId: 9, name: "M. Wójcik" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("M. Wójcik")).toBeInTheDocument();

    rerender(<Kolejka rozmowy={[rozmowa({ oglada: { userId: 7, name: "Ja" } })]} stan={STAN}
      wybranaId={null} laduje={false} mojeId={7} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText("Ja")).not.toBeInTheDocument();
  });
});

/* ── Wiersz z §10.2 (0.181.0) ────────────────────────────────────────────── */

const pokaz = (rozmowy: Rozmowa[]) =>
  render(<Kolejka rozmowy={rozmowy} stan={STAN} wybranaId={null} laduje={false}
    onWybierz={() => {}} onOdswiez={() => {}} />);

/* Wiersze w stanach spoza pracy (czeka na klienta, odłożona, zakończona) stoją
   od @wydanie poza domyślnym „Do odpowiedzi" — test wiersza patrzy więc
   w „Wszystkie", jedyny kubełek, który pokazuje każdy stan. */
const pokazWszystkie = async (rozmowy: Rozmowa[]) => {
  const r = pokaz(rozmowy);
  await userEvent.keyboard("6");
  return r;
};

/* ── RANGA STATUSU W WIERSZU (0.251.0) ───────────────────────────────────────
   Najgłośniejszym elementem wiersza była plakietka statusu — a w kubełkach
   roboczych status jest praktycznie stały, więc emfaza szła na słowo, które
   niczego nie rozróżnia. Te cztery testy pilnują nowego podziału: głośne są
   wyjątki, wyciszone — fakty, które wiersz mówi już czym innym. Żaden fakt
   nie znika (§4.3); zmienia się WAGA.                                       */
describe("plakietka należy się WYJĄTKOWI, nie normie", () => {
  it("„czeka na nas” nie dostaje plakietki, bo zegar mówi to samo", () => {
    /* Serwer zwraca ten status wtedy i tylko wtedy, gdy ostatnia wiadomość
       jest przychodząca (`statusZKierunku`) — a zegar liczy się dokładnie od
       ostatniej wiadomości przychodzącej. Jeden fakt, dwa miejsca. */
    pokaz([rozmowa({ status: "waiting_for_us", czekaOdMs: 3 * 3600_000 })]);
    expect(screen.queryByText("Czeka na nas")).not.toBeInTheDocument();
    expect(screen.getByTitle("czeka 3 g")).toBeInTheDocument();
  });

  it("„czeka na klienta” NIE dostaje zegara, bo nikt nie czeka", async () => {
    /* `czekaOdMs` liczy się od wiadomości KLIENTA, więc po naszej odpowiedzi
       dalej rośnie. Wiersz pisał wtedy „czeka 15 g” o rozmowie, w której
       piłka jest po drugiej stronie. Słowo „czeka” musi być prawdziwe. */
    await pokazWszystkie([rozmowa({ status: "waiting_for_customer", czekaOdMs: 15 * 3600_000 })]);
    expect(screen.queryByText(/czeka 15 g/)).not.toBeInTheDocument();
    /* Ale sam status ZOSTAJE — zszedł do podpisu, nie zniknął. */
    expect(screen.getByText("Czeka na klienta")).toBeInTheDocument();
  });

  it("werdykt człowieka i ruch hali dalej krzyczą plakietką", async () => {
    /* Tych dwóch nie da się odczytać z niczego innego w wierszu: „Odłożona”
       to decyzja agenta, „Czeka na halę” — wystawione zlecenie pomiaru. */
    await pokazWszystkie([rozmowa({ id: 1, status: "snoozed" }), rozmowa({ id: 2, status: "waiting_for_internal" })]);
    expect(screen.getByText("Odłożona")).toBeInTheDocument();
    expect(screen.getByText("Czeka na halę")).toBeInTheDocument();
  });

  it("data ustępuje zegarowi, bo mierzą TĘ SAMĄ wiadomość", async () => {
    /* Przy „czeka na nas” znacznik czasu i zegar opisują jedno zdarzenie.
       Zostaje ten, który odpowiada na pytanie „za co się wziąć” — a data
       wraca wtedy, gdy zegara nie ma i jest jedynym czasem w wierszu. */
    /* Pytamy WIERSZ, nie ekran: data synchronizacji stoi w nagłówku kolejki
       i ma tam zostać — to inny fakt niż wiek ostatniej wiadomości. */
    const wiersz = async (r: Rozmowa) => {
      const { container, unmount } = await pokazWszystkie([r]);
      const tekst = container.querySelector("button[aria-current]")?.textContent ?? "";
      unmount();
      return tekst;
    };
    expect(await wiersz(rozmowa({ status: "waiting_for_us", czekaOdMs: 3 * 3600_000 })))
      .not.toMatch(/2026/);
    expect(await wiersz(rozmowa({ status: "closed", czekaOdMs: 3 * 3600_000 })))
      .toMatch(/2026/);
  });
});

describe("wiersz kolejki niesie to, co §10.2 wymienia", () => {
  it("czas oczekiwania czyta się bez liczenia w głowie — jedna jednostka i kreski", () => {
    /* 23 września 2026: minuty przy godzinach odeszły razem z „za dużo tekstu".
       Kreski mówią „jak bardzo", liczba „ile" — patrz `Czekanie.tsx`. */
    pokaz([rozmowa({ czekaOdMs: 2 * 3600_000 + 14 * 60_000 })]);
    expect(screen.getByTitle("czeka 2 g")).toBeInTheDocument();
    expect(screen.queryByText(/14 min/)).not.toBeInTheDocument();
  });

  it("rozmowa bez pytania klienta nie pokazuje zegara", () => {
    pokaz([rozmowa({ czekaOdMs: null })]);
    /* Od początku wiersza: przełącznik kolejności ma w opcji „czekające". */
    expect(screen.queryByText(/^czeka /)).not.toBeInTheDocument();
  });

  it("PILNE widać w wierszu", () => {
    pokaz([rozmowa({ priorytet: "pilny" })]);
    expect(screen.getByText("PILNE")).toBeInTheDocument();
  });

  /* Nazwa mówi, co ta liczba MIERZY. „Nieprzeczytanych przez agenta" nie
     policzymy — Allegro daje samą flagę wątku — więc ekran tak ich nie nazywa. */
  it("licznik dopisków podpisuje się tym, co liczy", () => {
    /* Znak i liczba na wierszu, pełne zdanie w dymku i dla czytnika ekranu. */
    pokaz([rozmowa({ nowychOdOdpowiedzi: 3 })]);
    expect(screen.getByTitle("3 wiadomości klienta od naszej odpowiedzi")).toHaveTextContent("3");
  });

  it("pojedynczy dopisek nie zaśmieca wiersza licznikiem", () => {
    pokaz([rozmowa({ nowychOdOdpowiedzi: 1 })]);
    expect(screen.queryByText(/dopiski/)).not.toBeInTheDocument();
  });

  it("oczekujące zadanie terenowe widać przy rozmowie", () => {
    pokaz([rozmowa({ zadanieWToku: true })]);
    expect(screen.getByText(/zadanie w toku/)).toBeInTheDocument();
  });

  it("status doboru stoi w wierszu, ale nierozpoczęty i „nie dotyczy” milczą", () => {
    /* §10.2 domknięty w E1: plakietka mówi, na czym stanął dobór. Na wierszu
       bez doboru nie ma czego mówić — „nierozpoczęty" wszędzie to szum. */
    const { rerender } = render(<Kolejka rozmowy={[rozmowa({ dobor: "missing_information" })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByText("Brakuje danych")).toBeInTheDocument();
    rerender(<Kolejka rozmowy={[rozmowa({ dobor: "not_applicable" }), rozmowa({ id: 2, dobor: "not_started" })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText("Nie dotyczy")).not.toBeInTheDocument();
    expect(screen.queryByText("Nierozpoczęty")).not.toBeInTheDocument();
  });
});

/* ── Kategorie Copilota w kolejce (§14, etap F) ──────────────────────────────
   Najważniejszy z tych testów jest pierwszy: KOLEJNOŚĆ SIĘ NIE ZMIENIA.
   Serwer pilnuje tego w `skrzynka.test.ts` po stronie zapytania, tu pilnujemy
   tego po stronie ekranu — bo filtr, licznik i plakietka to trzy okazje, żeby
   niechcący przestawić listę pod ręką agenta.                                */
describe("kategorie Copilota w kolejce", () => {
  const zKategoria = (id: number, kategoria: Rozmowa["kopilot"]) =>
    rozmowa({ id, klient: `Klient ${id}`, kopilot: kategoria });
  const kop = (kategoria: Kategoria, n: Partial<Kopilot> = {}): Kopilot => ({
    kategoria, dodatkowe: [], akcja: "GET_PRODUCT", akcjaModelu: null, wymagaCzlowieka: false,
    brakDanychZamowienia: false, brakDanychProduktu: false, pewnosc: "wysoka",
    zrodlo: "MODEL", status: "SUCCESS", kody: [], uzasadnienie: null, nieaktualna: false,
    kategoriaCzlowieka: null, kategoriaModelu: kategoria, ...n,
  });

  it("plakietka staje na wierszu, a kolejność zostaje TA SAMA", () => {
    const lista = [
      zKategoria(1, null),
      zKategoria(2, kop("PRODUCT_AVAILABILITY")),
      zKategoria(3, kop("COMPLAINT")),
    ];
    pokaz(lista);
    const wiersze = screen.getAllByRole("button", { name: /Klient/ });
    /* Login zszedł w 0.193.0 pod treść pytania, więc kolejności nie da się
       czytać z początku napisu — czytamy ją z tego, KTÓRY login jest w KTÓRYM
       wierszu. Sprawdzana rzecz jest ta sama: kolejność zostaje. */
    expect(wiersze.map((w, i) => w.textContent?.includes(`Klient ${i + 1}`)))
      .toEqual([true, true, true]);
    expect(wiersze[1].textContent).toContain("Dostępność");
    expect(wiersze[2].textContent).toContain("Reklamacja");
    expect(wiersze[0].textContent).not.toContain("Dostępność");
  });

  /* ── PIGUŁEK KATEGORII NIE MA (22 września 2026) ──────────────────────────
     Decyzja właściciela. Kategoria zostaje na wierszu, ale nad listą nie ma
     już paska, który zawężał kolejkę po przypuszczeniu maszyny. */
  it("nad listą nie ma paska kategorii — nazwa pada tylko na wierszu", () => {
    pokaz([
      zKategoria(1, kop("PRODUCT_AVAILABILITY")),
      zKategoria(2, kop("PRODUCT_AVAILABILITY")),
    ]);
    expect(screen.queryByRole("button", { name: /Dostępność 2/ })).not.toBeInTheDocument();
    /* Dostępność jest RZADKA, więc stoi słowem przy kaflu — w każdym wierszu. */
    const wiersze = screen.getAllByRole("button", { name: /Klient/ });
    expect(wiersze.every((w) => w.textContent?.includes("Dostępność"))).toBe(true);
  });
});

/* ── Szukanie w kolejce (0.195.0) ────────────────────────────────────────────
   Zwroty mają wyszukiwarkę od 0.165.0, skrzynka nie miała żadnej: kubełek
   mówi „czyje to", kategoria „o czym to", a pytania „czy TA rozmowa gdzieś tu
   jest" nie zadawał nikt, bo nie było jak.                                  */
describe("Szukanie w kolejce", () => {
  const lista = [
    rozmowa({ id: 1, klient: "mirek352810", ostatniaWiadomosc: "Czy pasuje szarpak do NAC?" }),
    rozmowa({ id: 2, klient: "Kosecka_Ola", ostatniaWiadomosc: "Kiedy wyjdzie przesyłka?",
      wlasciciel: "M. Wójcik", wlascicielId: 9 }),
  ];
  /* Druga rozmowa jest KOLEGI — w „Do odpowiedzi" jej nie ma, więc szukanie
     sprawdzamy w „Wszystkie" (cyfra 6), tam gdzie szuka się cudzych spraw. */
  const pokaz = async () => {
    render(<Kolejka rozmowy={lista} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.keyboard("6");
  };
  const pole = () => screen.getByRole("textbox", { name: /Szukaj w rozmowach/ });

  it("zawęża po loginie klienta", async () => {
    await pokaz();
    await userEvent.type(pole(), "mirek");
    expect(screen.getByText("mirek352810")).toBeInTheDocument();
    expect(screen.queryByText("Kosecka_Ola")).toBeNull();
  });

  it("zawęża po TREŚCI, bo loginu nikt nie pamięta", async () => {
    await pokaz();
    await userEvent.type(pole(), "przesyłka");
    expect(screen.getByText("Kosecka_Ola")).toBeInTheDocument();
    expect(screen.queryByText("mirek352810")).toBeNull();
  });

  it("zawęża po prowadzącym, bo o to pyta się na głos", async () => {
    await pokaz();
    await userEvent.type(pole(), "wójcik");
    expect(screen.getByText("Kosecka_Ola")).toBeInTheDocument();
    expect(screen.queryByText("mirek352810")).toBeNull();
  });

  it("MÓWI, że trafienie jest w treści, nie w loginie (0.425.0)", async () => {
    /* To jest ochrona przed najdroższą pomyłką tego ekranu: wpisane nazwisko
       trafia też w CUDZĄ wiadomość, w której to nazwisko padło. Wiersz
       wyglądał wtedy dokładnie jak trafienie po nazwisku klienta. */
    const dwoje = [
      rozmowa({ id: 1, klient: "kowalski_jan", ostatniaWiadomosc: "Kiedy paczka?" }),
      rozmowa({ id: 2, klient: "zielinska_ewa",
        ostatniaWiadomosc: "Sąsiad Kowalski polecił Wasz sklep" }),
    ];
    render(<Kolejka rozmowy={dwoje} stan={STAN} wybranaId={null}
      laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.type(pole(), "kowalski");

    expect(screen.getByText("kowalski_jan")).toBeInTheDocument();
    expect(screen.getByText("zielinska_ewa")).toBeInTheDocument();
    /* Znacznik JEDEN, przy tym wierszu, w którym login się nie zgadza. */
    expect(screen.getByText("trafienie w treści, nie w loginie")).toBeInTheDocument();
  });

  it("MILCZY przy trafieniu po loginie — znak zapalany zawsze przestaje być znakiem", async () => {
    await pokaz();
    await userEvent.type(pole(), "mirek");
    expect(screen.queryByText(/trafienie w treści/)).toBeNull();
  });

  it("nazywa też trafienie po PROWADZĄCYM, bo to znowu nie jest login klienta", async () => {
    await pokaz();
    await userEvent.type(pole(), "wójcik");
    expect(screen.getByText("trafienie po prowadzącym")).toBeInTheDocument();
  });

  it("bez szukania nie ma żadnego znacznika trafienia", async () => {
    await pokaz();
    expect(screen.queryByText(/trafienie/)).toBeNull();
  });

  it("brak trafień CYTUJE frazę — literówkę widać dopiero wtedy", async () => {
    await pokaz();
    await userEvent.type(pole(), "kosiarka elektryczna");
    expect(screen.getByText(/Nic nie pasuje do „kosiarka elektryczna"/)).toBeInTheDocument();
    /* Zdanie o pustym kubełku byłoby tu nieprawdą: rozmowy są, tylko sito je
       zasłania. */
    expect(screen.queryByText(/Ten kubełek jest pusty/)).toBeNull();
  });

  it("wyczyszczenie przywraca całą listę", async () => {
    await pokaz();
    await userEvent.type(pole(), "mirek");
    await userEvent.click(screen.getByRole("button", { name: /Wyczyść szukanie/ }));
    expect(screen.getByText("Kosecka_Ola")).toBeInTheDocument();
    expect(screen.getByText("mirek352810")).toBeInTheDocument();
  });
});

describe("kolejność listy (0.215.0)", () => {
  const LISTA = [
    rozmowa({ id: 1, klient: "Najstarsze pytanie", ostatniaWiadomoscAt: "2026-09-01T07:00:00.000Z" }),
    rozmowa({ id: 2, klient: "Świeże pytanie", ostatniaWiadomoscAt: "2026-09-06T09:00:00.000Z" }),
    rozmowa({ id: 3, klient: "Pilna sprzed tygodnia", priorytet: "pilny", ostatniaWiadomoscAt: "2026-08-30T07:00:00.000Z" }),
  ];
  const klienci = () => screen.getAllByText(/Najstarsze pytanie|Świeże pytanie|Pilna sprzed tygodnia/)
    .map((e) => e.textContent);

  it("domyślnie zostaje kolejność serwera — PILNE i najdłużej czekające", () => {
    localStorage.removeItem("wertis.kolejka.porzadek");
    render(<Kolejka rozmowy={LISTA} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByLabelText("Kolejność")).toHaveValue("czekanie");
    expect(klienci()).toEqual(["Najstarsze pytanie", "Świeże pytanie", "Pilna sprzed tygodnia"]);
  });

  it("„od najnowszych” ustawia ostatnią wiadomość na górze, ale PILNE dalej przebija", async () => {
    localStorage.removeItem("wertis.kolejka.porzadek");
    render(<Kolejka rozmowy={LISTA} stan={STAN} wybranaId={null} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Kolejność"), "najnowsze");
    expect(klienci()).toEqual(["Pilna sprzed tygodnia", "Świeże pytanie", "Najstarsze pytanie"]);
    /* Wybór to nawyk stanowiska — przeglądarka go pamięta. */
    expect(localStorage.getItem("wertis.kolejka.porzadek")).toBe("najnowsze");
  });
});

/* ── KLAWIATURA W SKRZYNCE (0.383.0) ─────────────────────────────────────────
   Cztery kolejki obsługi, trzy chodziły z klawiatury od 0.245.0. Skrzynka nie
   miała ani jednego klawisza — a to na niej agent siedzi najdłużej z całego
   panelu. Żadna decyzja tego nie wybrała; nikt jej tu po prostu nie dorobił.

   Nasłuch stoi w KOLEJCE, nie w ekranie: kubełek, kategoria i szukanie są
   stanem tej kolejki, więc tylko ona wie, co jest „następne" po zawężeniu.
   Dlatego testy idą po komponencie, a nie po ekranie.                        */

const TRZY = [
  rozmowa({ id: 1, ostatniaWiadomosc: "Pierwsza z brzegu",
    ostatniaWiadomoscAt: "2026-09-01T07:00:00.000Z" }),
  rozmowa({ id: 2, ostatniaWiadomosc: "Druga z brzegu",
    ostatniaWiadomoscAt: "2026-09-01T08:00:00.000Z" }),
  rozmowa({ id: 3, ostatniaWiadomosc: "Trzecia z brzegu",
    ostatniaWiadomoscAt: "2026-09-01T09:00:00.000Z" }),
];

const zKlawiszami = (wybranaId: number | null, onWybierz: (id: number) => void) =>
  render(<Kolejka rozmowy={TRZY} stan={STAN} wybranaId={wybranaId} laduje={false}
    onWybierz={onWybierz} onOdswiez={() => {}} />);

/**
 * Kolejność WYŚWIETLONA, nie kolejność z tablicy.
 *
 * Kolejka sortuje sama („najdłużej czekające"), więc test wiążący się
 * z identyfikatorami sprawdzałby ułożenie danych wejściowych, a nie umowę
 * klawisza. Umowa brzmi: `j` bierze WIDOCZNY następny wiersz.
 */
const kolejnosc = (): number[] => [...document.querySelectorAll("[aria-current]")]
  .map((e) => TRZY.find((r) => (e.textContent ?? "").includes(r.ostatniaWiadomosc))?.id ?? 0);

describe("Kolejka: klawiatura", () => {
  it("`j` bez zaznaczenia bierze PIERWSZĄ widoczną, nie ostatnią", async () => {
    /* Ruch w dół z niczego zaczyna od góry listy. Odwrotnie byłoby
       zaskoczeniem: agent wchodzi na ekran i naciska `j`, żeby zacząć. */
    const onWybierz = vi.fn();
    zKlawiszami(null, onWybierz);
    await userEvent.keyboard("j");
    expect(onWybierz).toHaveBeenCalledWith(kolejnosc()[0]);
  });

  it("`k` bez zaznaczenia bierze OSTATNIĄ — ruch w górę zaczyna od dołu", async () => {
    const onWybierz = vi.fn();
    zKlawiszami(null, onWybierz);
    await userEvent.keyboard("k");
    expect(onWybierz).toHaveBeenCalledWith(kolejnosc()[2]);
  });

  it("`j` i `k` chodzą po liście, a strzałki robią to samo", async () => {
    const onWybierz = vi.fn();
    zKlawiszami(null, onWybierz);
    const [gora, srodek, dol] = kolejnosc();
    onWybierz.mockClear();
    cleanup();
    zKlawiszami(srodek, onWybierz);
    await userEvent.keyboard("j");
    expect(onWybierz).toHaveBeenLastCalledWith(dol);
    await userEvent.keyboard("k");
    expect(onWybierz).toHaveBeenLastCalledWith(gora);
    await userEvent.keyboard("{ArrowDown}");
    expect(onWybierz).toHaveBeenLastCalledWith(dol);
    await userEvent.keyboard("{ArrowUp}");
    expect(onWybierz).toHaveBeenLastCalledWith(gora);
  });

  it("na końcach listy ruch STOI, zamiast zawijać się na drugi koniec", async () => {
    /* Zawijanie gubi miejsce w kolejce: agent naciska `j` o jeden raz za dużo
       i ląduje na górze, nie wiedząc, że przeskoczył wszystko. */
    const onWybierz = vi.fn();
    zKlawiszami(null, onWybierz);
    const dol = kolejnosc()[2];
    onWybierz.mockClear();
    cleanup();
    zKlawiszami(dol, onWybierz);
    await userEvent.keyboard("j");
    expect(onWybierz).not.toHaveBeenCalled();
  });

  it("KLAWISZ MILCZY, GDY KURSOR STOI W POLU — to jest tu sedno", async () => {
    /* Na tym ekranie agent PISZE odpowiedź do klienta. Bez tej bramki `j`
       w słowie „już" przerzucałoby rozmowę spod kursora, a litera nie
       wchodziłaby do szkicu. Dwa błędy naraz, oba ciche. */
    const onWybierz = vi.fn();
    const { container } = zKlawiszami(1, onWybierz);
    const pole = document.createElement("textarea");
    container.appendChild(pole);
    pole.focus();
    await userEvent.keyboard("już kk jj 2");
    expect(onWybierz).not.toHaveBeenCalled();
    expect(pole.value).toBe("już kk jj 2");
  });

  it("cyfra przełącza kubełek, a pierwszy i domyślny jest „Do odpowiedzi”", async () => {
    /* Od @wydanie pierwszy kubełek to praca, nie przeglądanie — „Wszystkie"
       zeszło pod „Więcej" jako ostatnie, jak w zwrotach, reklamacjach
       i dyskusjach. Cyfra dalej mapuje się wprost na indeks listy. */
    zKlawiszami(null, vi.fn());
    expect(screen.getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("2");
    expect(screen.getByRole("button", { name: /Nieprzypisane/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("1");
    expect(screen.getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("6");
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    expect(lista.selectedOptions[0].textContent).toMatch(/^Wszystkie/);
  });

  it("cyfra wybiera też kubełek spod „Więcej” i lista pokazuje jego nazwę", async () => {
    zKlawiszami(null, vi.fn());
    await userEvent.keyboard("5");
    const lista = screen.getByLabelText("Więcej kubełków") as HTMLSelectElement;
    expect(lista.selectedOptions[0].textContent).toMatch(/^Zakończone/);
    expect(screen.getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("fokus w liście „Więcej” nie przesuwa rozmowy — strzałka należy do listy", async () => {
    /* Strażnik z `nawigacja/fokus.ts` zna SELECT; własny, sprzed 0.522.0,
       go nie znał i strzałka w liście przerzucała też rozmowę. */
    const onWybierz = vi.fn();
    zKlawiszami(null, onWybierz);
    screen.getByLabelText("Więcej kubełków").focus();
    await userEvent.keyboard("{ArrowDown}j");
    expect(onWybierz).not.toHaveBeenCalled();
  });

  it("pasek pokazuje klawisze, bo skrót, o którym nikt nie wie, nie skraca pracy", async () => {
    /* Ta sama lekcja co 0.281.0 na reklamacjach. Pasek NIE obiecuje sit
       „moje"/„niczyje": w skrzynce „Moje" jest kubełkiem pod cyfrą. */
    zKlawiszami(null, vi.fn());
    /* Skróty siedzą pod „?" od 0.402.0, od 0.522.0 pod tym samym „?" co
       słownik znaków. Reguła ta sama: pokazane klawisze mają DZIAŁAĆ. */
    await userEvent.click(screen.getByRole("button", { name: "Znaki i skróty" }));
    const pomoc = screen.getByRole("region", { name: "Znaki i skróty" });
    expect(pomoc).toHaveTextContent("ruch po liście");
    expect(pomoc).toHaveTextContent(/1–6\s*kubełek/);
    expect(pomoc).not.toHaveTextContent(/niczyje/);
  });

  it("wiersz woła plakietką REKLAMACYJNA — inaczej znacznik nie zmieniałby wyboru pracy", () => {
    /* Znacznik widoczny tylko w otwartej rozmowie byłby wiedzą, po którą trzeba
       wejść. Kolejka jest miejscem, w którym agent WYBIERA, co robić. */
    pokaz([rozmowa({ reklamacyjna: true })]);
    expect(screen.getByText("REKLAMACYJNA")).toBeInTheDocument();
  });

  it("zwykły wiersz nie nosi tej plakietki", () => {
    pokaz([rozmowa()]);
    expect(screen.queryByText("REKLAMACYJNA")).not.toBeInTheDocument();
  });
});

/* ── Podziękowanie bez odpowiedzi (22 września 2026) ─────────────────────────
   Serwer zdejmuje rozmowę z „Czeka na nas", gdy klasyfikator uznał ostatnią
   wiadomość za podziękowanie. Wiersz ma powiedzieć DLACZEGO, bo podgląd to
   słowa klienta. */
describe("podziękowanie w kolejce", () => {
  it("wiersz mówi, że to podziękowanie, i nie liczy zegara", async () => {
    await pokazWszystkie([rozmowa({ status: "waiting_for_customer", podziekowal: true,
      czekaOdMs: 3 * 3600_000, ostatniaWiadomosc: "Dziękuję!" })]);
    expect(screen.getByText("podziękowanie, bez odpowiedzi")).toBeInTheDocument();
    expect(screen.queryByText(/czeka 3 g/)).not.toBeInTheDocument();
  });

  it("zwykła rozmowa znacznika nie nosi", () => {
    render(<Kolejka rozmowy={[rozmowa({ status: "waiting_for_us", czekaOdMs: 3600_000 })]}
      stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.queryByText("podziękowanie, bez odpowiedzi")).not.toBeInTheDocument();
  });
});

/* ── Słownik znaków (23 września 2026) ───────────────────────────────────────
   Znaki zastąpiły słowa na wierszu, więc ich lista musi stać jedno kliknięcie
   od kolejki — i otwarcie jej nie może niczego zapisać. */
describe("słownik znaków pod „?”", () => {
  it("otwiera się z kolejki i nazywa każdą kategorię", async () => {
    pokaz([rozmowa()]);
    await userEvent.click(screen.getByRole("button", { name: "Znaki i skróty" }));
    const slownik = screen.getByRole("region", { name: "Znaki i skróty" });
    expect(slownik).toHaveTextContent("Dobór");
    expect(slownik).toHaveTextContent("wymaga człowieka");
    await userEvent.click(screen.getByRole("button", { name: "Zamknij słownik" }));
    expect(screen.queryByRole("region", { name: "Znaki i skróty" })).not.toBeInTheDocument();
  });

  it("jeden „?” w kolejce — skróty nie mają już osobnego przycisku", () => {
    pokaz([rozmowa()]);
    expect(screen.queryByRole("button", { name: /Skróty klawiszowe/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Znaki i skróty" })).toHaveLength(1);
  });

  it("zamyka się Escape'em i kliknięciem obok, jak każde okienko panelu", async () => {
    pokaz([rozmowa()]);
    await userEvent.click(screen.getByRole("button", { name: "Znaki i skróty" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Znaki i skróty" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Znaki i skróty" }));
    await userEvent.click(screen.getByLabelText("Szukaj w rozmowach"));
    expect(screen.queryByRole("region", { name: "Znaki i skróty" })).not.toBeInTheDocument();
  });
});

/* ── Lista widocznych dla „następnej rozmowy" (23 września 2026) ─────────────
   Następna po wysyłce ma być następną w TYM, co agent przerabia — po kubełku
   i szukaniu. Kolejka trzyma te sita u siebie, więc musi je podać wyżej. */
describe("kolejka podaje widoczne wiersze", () => {
  it("po zmianie kubełka podaje nową listę", async () => {
    const onWidoczne = vi.fn();
    render(<Kolejka rozmowy={[
      rozmowa({ id: 1, klient: "A" }),
      rozmowa({ id: 2, klient: "B", wlascicielId: 9, wlasciciel: "Kolega" }),
    ]} stan={STAN} wybranaId={null} laduje={false} onWybierz={() => {}} onOdswiez={() => {}}
      onWidoczne={onWidoczne} />);
    /* Domyślny „Do odpowiedzi" nie niesie rozmowy kolegi. */
    expect(onWidoczne).toHaveBeenLastCalledWith([1]);
    await userEvent.keyboard("6");
    expect(onWidoczne).toHaveBeenLastCalledWith([1, 2]);
  });
});

/* ── „DO ODPOWIEDZI" (@wydanie) ──────────────────────────────────────────────
   Decyzja właściciela z 26 września 2026: wejście staje na pracy, nie na
   archiwum. Nasz ruch, niczyje i moje razem; kolegi i czekające — nie. */
describe("kubełek „Do odpowiedzi”", () => {
  const LISTA = [
    rozmowa({ id: 1, klient: "Niczyja", status: "waiting_for_us" }),
    rozmowa({ id: 2, klient: "Moja", status: "waiting_for_us", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 3, klient: "Kolegi", status: "waiting_for_us", wlascicielId: 9, wlasciciel: "M. Wójcik" }),
    rozmowa({ id: 4, klient: "Czeka", status: "waiting_for_customer", wlascicielId: 7, wlasciciel: "Ja" }),
    rozmowa({ id: 5, klient: "Odlozona", status: "snoozed", odlozoneDo: "2026-09-28T06:00:00.000Z" }),
    rozmowa({ id: 6, klient: "Archiwum", status: "closed" }),
  ];

  it("jest domyślny i niesie niczyje i moje, bez kolegi, czekających i odłożonych", () => {
    render(<Kolejka rozmowy={LISTA} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    expect(screen.getByRole("button", { name: /Do odpowiedzi/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Niczyja")).toBeInTheDocument();
    expect(screen.getByText("Moja")).toBeInTheDocument();
    for (const k of ["Kolegi", "Czeka", "Odlozona", "Archiwum"]) {
      expect(screen.queryByText(k)).not.toBeInTheDocument();
    }
  });

  it("odłożona stoi w „Oczekujących” i mówi, do kiedy", async () => {
    render(<Kolejka rozmowy={LISTA} stan={STAN} wybranaId={null} mojeId={7} laduje={false}
      onWybierz={() => {}} onOdswiez={() => {}} />);
    await userEvent.keyboard("4");
    const wiersz = screen.getByText("Odlozona").closest("button")!;
    expect(wiersz).toHaveTextContent(/do 28\.09\.2026/);
  });
});
