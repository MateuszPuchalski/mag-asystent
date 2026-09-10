/** @type {import('tailwindcss').Config} */

/* Tokeny pochodzą z makiet w `docs/projekt-widokow/`. Stoją TUTAJ, a nie
   w komponentach, bo makieta odróżnia rodzaje wpisów osi czterema cechami
   naraz — tłem, obwódką, ikoną i wcięciem. Rozsypane po plikach rozjechałyby
   się przy pierwszym nowym ekranie, a wtedy oś przestaje się czytać w biegu. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        wertis: { amber: "#F7A600", ink: "#2A2A2C", paper: "#F6F5F2", tlo: "#f1f5f9" },

        /* Statusy rozmowy z §7. Para tło–tekst, żeby plakietki nie dobierało
           się ręcznie przy każdym użyciu. */
        stan: {
          "new": "#fef3c7", "new-tekst": "#78350f",
          "open": "#e0f2fe", "open-tekst": "#075985",
          "klient": "#f1f5f9", "klient-tekst": "#334155",
          "wewnetrzne": "#fef3c7", "wewnetrzne-tekst": "#78350f",
          "zrobione": "#d1fae5", "zrobione-tekst": "#065f46",
          /* Dołożone w 0.158.0 razem z kolumną statusu. Odłożona jest fioletowa,
             bo ma się nie mylić z „czeka na klienta" — to dwa różne powody
             ciszy. Zamknięta i spam są WYGASZONE: sprawa zeszła z biurka. */
          "odlozona": "#ede9fe", "odlozona-tekst": "#5b21b6",
          "zamknieta": "#e2e8f0", "zamknieta-tekst": "#475569",
          "spam": "#fee2e2", "spam-tekst": "#991b1b",
        },

        /* Rangi wierszy stanu integracji — makieta Awaria. Nazwy mówią
           o WADZE, nie o barwie: „czerwony" przestałby znaczyć cokolwiek
           przy zmianie palety. */
        ranga: { zle: "#b91c1c", uwaga: "#92400e", ok: "#047857", nic: "#334155" },

        /* Wpisy osi rozmowy — §10.3 żąda, żeby każdy rodzaj wyglądał inaczej. */
        os: {
          klient: "#ffffff", "klient-ramka": "#e2e8f0",
          firma: "#f8fafc", "firma-ramka": "#e2e8f0",
          komentarz: "#fffbeb", "komentarz-ramka": "#fbbf24",
          wynik: "#ecfdf5", "wynik-ramka": "#a7f3d0",
        },
      },
      /* ── RAMKA BIERZE TOKEN, NIE DOMYŚLNĄ SZAROŚĆ TAILWINDA (0.255.0) ───────
         Tailwind bez podanej barwy rysuje ramkę w `gray-200` (#E5E7EB), a ten
         projekt ma własny token `slate-200` (#E2E8F0). W panelu stało 320
         gołych `border` naprzeciw 77 jawnych `border-slate-*` — czyli cztery
         na pięć ramek miały barwę, której nikt nie wybrał, a token był barwą
         ramek wyłącznie w klasie `.card`.

         Różnicy nie widać na jednej krawędzi (1.24:1 kontra 1.23:1 na bieli)
         i właśnie dlatego przeżyła. Widać ją tam, gdzie krawędzie się stykają:
         karta z obwódką `slate-200` i jedenaście linii `gray-200` w środku,
         na jednym ekranie ustawień.

         `divideColor` dziedziczy w Tailwindzie 3 z `borderColor`, więc gołe
         `divide-y` wchodzi tu razem z ramkami. To jest zamierzone — tabela
         stanu integracji stoi właśnie na `divide-y`. */
      borderColor: { DEFAULT: "#e2e8f0" },

      /* ── DRABINA TYPOGRAFICZNA (0.258.0) ──────────────────────────────────
         Zmierzone przed tą zmianą: 664 wystąpienia klas rozmiaru w panelu,
         z czego 95,2% w paśmie 11–14 px. Powyżej 16 px było DZIEWIĘĆ
         wystąpień na 664 — a cztery z nich to liczby, nie tekst.

         Skutkiem był rozjazd RÓL, nie rozmiarów. `text-xs` niosło naraz
         kontrolkę, metadane, komunikat błędu i sześciowierszowy opis towaru.
         Kiedy treść ma ten sam rozmiar co jej podpis, hierarchię trzeba budować
         czymś innym — i stąd 70% pogrubionego tekstu oraz sześć odcieni
         szarości na „tekst poboczny". To były objawy braku drabiny.

         SZCZEBLE NAZYWAJĄ ROLĘ, NIE ROZMIAR. Piszący ma wybierać „to jest
         treść", a nie „to jest 15 px" — inaczej za pół roku będzie tu znowu
         osiem rozmiarów.

         PARA [rozmiar, interlinia] jest tu istotna, a nie ozdobna. Arbitralne
         `text-[NNpx]` NIE MAJĄ w Tailwindzie domyślnej interlinii, więc
         82 wystąpienia `text-[11px]` dziedziczyły 1,5 z przeglądarki zamiast
         pary przypisanej do klasy. Nazwany szczebel naprawia to przy okazji.

         CZEGO TU NIE MA. `text-xs` (12 px) zostaje szczeblem KONTROLKI —
         przycisku, chipa, komunikatu przy polu — bo tam ten rozmiar jest
         właściwy. `text-sm` zostaje przy gęstych rzędach danych. Liczby
         (`text-2xl`, `text-lg`) też zostają: liczba nie jest tekstem, a jej
         rozmiar wynika z odległości, z jakiej ma być czytelna. */
      fontSize: {
        podpis: ["11px", "16px"],
        tresc: ["15px", "22px"],
        naglowek: ["17px", "24px"],
        tytul: ["24px", "30px"],
      },

      fontFamily: { sans: ["Barlow", "sans-serif"] },
    },
  },
  plugins: [],
};
