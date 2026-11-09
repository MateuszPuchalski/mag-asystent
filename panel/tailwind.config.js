/** @type {import('tailwindcss').Config} */

/* Tokeny stoją TUTAJ, a nie w komponentach, bo oś rozmowy odróżnia rodzaje
   wpisów czterema cechami naraz — tłem, obwódką, ikoną i wcięciem.
   Rozsypane po plikach rozjechałyby się przy pierwszym nowym ekranie, a wtedy
   oś przestaje się czytać w biegu. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* BARWY Z LOGO, decyzją właściciela, odczytane z pikseli pliku logo:
           pomarańcz #FF9100, grafit #303030. Pomarańcz NIE jest pismem
           (`Kontrast.test.ts`): na bieli daje 2,26:1. Pod grafitowym pismem
           daje 5,84:1 i zostaje barwą akcji. */
        wertis: { amber: "#FF9100", ink: "#303030", paper: "#F6F5F2", tlo: "#f1f5f9" },

        /* Statusy rozmowy z §7. Para tło–tekst, żeby plakietki nie dobierało
           się ręcznie przy każdym użyciu. */
        stan: {
          "new": "#fef3c7", "new-tekst": "#78350f",
          "open": "#e0f2fe", "open-tekst": "#075985",
          "klient": "#f1f5f9", "klient-tekst": "#334155",
          "wewnetrzne": "#fef3c7", "wewnetrzne-tekst": "#78350f",
          "zrobione": "#d1fae5", "zrobione-tekst": "#065f46",
          /* Barwy kolumny statusu. Odłożona jest fioletowa,
             bo ma się nie mylić z „czeka na klienta" — to dwa różne powody
             ciszy. Zamknięta i spam są WYGASZONE: sprawa zeszła z biurka. */
          "odlozona": "#ede9fe", "odlozona-tekst": "#5b21b6",
          "zamknieta": "#e2e8f0", "zamknieta-tekst": "#475569",
          "spam": "#fee2e2", "spam-tekst": "#991b1b",
        },

        /* Rangi wierszy stanu integracji. Nazwy mówią
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
      /* ── RAMKA BIERZE TOKEN, NIE DOMYŚLNĄ SZAROŚĆ TAILWINDA ─────────────────
         Tailwind bez podanej barwy rysuje ramkę w `gray-200` (#E5E7EB), a ten
         projekt ma własny token `slate-200` (#E2E8F0). Różnicy nie widać na
         jednej krawędzi (1.24:1 kontra 1.23:1 na bieli), ale widać ją tam, gdzie
         krawędzie się stykają: karta z obwódką `slate-200` i linie `gray-200`
         w środku.

         `divideColor` dziedziczy w Tailwindzie 3 z `borderColor`, więc gołe
         `divide-y` wchodzi tu razem z ramkami. To jest zamierzone — tabela
         stanu integracji stoi właśnie na `divide-y`. */
      borderColor: { DEFAULT: "#e2e8f0" },

      /* ── DRABINA TYPOGRAFICZNA ────────────────────────────────────────────
         Kiedy treść ma ten sam rozmiar co jej podpis, hierarchię trzeba budować
         czymś innym — pogrubieniem i odcieniami szarości. Drabina rozdziela
         ROLE, nie rozmiary.

         SZCZEBLE NAZYWAJĄ ROLĘ, NIE ROZMIAR. Piszący ma wybierać „to jest
         treść", a nie „to jest 15 px" — inaczej za pół roku będzie tu znowu
         osiem rozmiarów.

         PARA [rozmiar, interlinia] jest tu istotna, a nie ozdobna. Arbitralne
         `text-[NNpx]` NIE MAJĄ w Tailwindzie domyślnej interlinii, więc
         dziedziczą 1,5 z przeglądarki zamiast pary przypisanej do klasy.

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

      /* ── RUCH SKRZYNKI: DWA KRÓTKIE, JEDNORAZOWE ─────────────────────────────
         Ruch pokazuje zmianę, która w tle łatwo umyka, i nic więcej: bez pętli,
         bez ruchu przy otwarciu ekranu. Obie animacje wolno użyć wyłącznie
         z `motion-safe:` — pilnuje tego `src/Ruch.test.ts`.

         WIERSZ BŁYSKA SZAROŚCIĄ, nie barwą. Bursztyn znaczy „coś jest nie tak"
         (`Bursztyn.test.ts`), a wolnej rodziny barw w kolejce nie ma: czerwień
         to błąd, zieleń powodzenie, fiolet Copilot, błękit zdarzenie na osi.
         Błysk zgaśnie w półtorej sekundy, więc pokrywanie się z szarością
         zaznaczenia (`slate-200`) nie wprowadza w błąd na stałe, a wybrany
         wiersz i tak nie błyska. `slate-300` to wartość o stopień ciemniejsza
         od zaznaczenia, żeby błysk było widać na tle samego wiersza.

         WIADOMOŚĆ WSUWA SIĘ O 6 PX W 120 ms: dość, by oko to złapało, za mało,
         by przesunąć czytany tekst. */
      keyframes: {
        "wiersz-nowy": { "0%": { backgroundColor: "#cbd5e1" }, "100%": { backgroundColor: "transparent" } },
        "wiadomosc-nowa": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "wiersz-nowy": "wiersz-nowy 1.6s ease-out 1",
        "wiadomosc-nowa": "wiadomosc-nowa 120ms ease-out 1",
      },
    },
  },
  plugins: [],
};
