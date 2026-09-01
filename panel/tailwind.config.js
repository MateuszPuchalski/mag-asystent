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
      fontFamily: { sans: ["Barlow", "sans-serif"] },
    },
  },
  plugins: [],
};
