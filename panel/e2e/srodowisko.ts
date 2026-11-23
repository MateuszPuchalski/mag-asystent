import os from "node:os";
import path from "node:path";

/* ── Jedno miejsce na adresy i konta przebiegu ───────────────────────────────
   Czytają je trzy strony: konfiguracja Playwrighta, skrypt stawiający serwer
   API i same testy. Port wpisany w trzech plikach rozjechałby się przy
   pierwszej zmianie, a objawem byłby test wiszący do limitu czasu.

   PORTY SĄ WŁASNE, nie 3001 i 5174. Pod tamtymi chodzi `npm run dev`, a test
   przywiązany do cudzego serwera mierzy cudzą bazę: raz pustą, raz z pracą
   z wczoraj. Własny port razem z `reuseExistingServer: false` daje pewność,
   że przebieg widzi wyłącznie serwer, który sam postawił.                   */
export const PORT_API = 3187;
export const PORT_ALLEGRO = 3188;
export const PORT_PANELU = 5187;
export const PORT_DYMU = 5186;

export const URL_API = `http://127.0.0.1:${PORT_API}`;
/* Udawane Allegro z `udawane-allegro.mjs`. Testy pytają je wyłącznie o dziennik
   żądań i każą mu dopisać wiadomość klienta. Z Allegro rozmawia nasz serwer. */
export const URL_ALLEGRO = `http://127.0.0.1:${PORT_ALLEGRO}`;
export const URL_PANELU = `http://127.0.0.1:${PORT_PANELU}`;
export const URL_DYMU = `http://127.0.0.1:${PORT_DYMU}`;

/* Katalog ma STAŁĄ nazwę, bo test musi umieć go znaleźć: leży w nim dziennik
   odmów sieci. Świeżość daje skrypt serwera, który kasuje go przed zasianiem
   bazy. Port w nazwie, bo dwa przebiegi naraz i tak nie mogą dzielić portu. */
export const KATALOG_PRZEBIEGU = path.join(os.tmpdir(), `wertis-e2e-${PORT_API}`);
export const DZIENNIK_ODMOW_SIECI = path.join(KATALOG_PRZEBIEGU, "odmowy-sieci.log");

/* Konta zakłada `npm run seed:scenariusze`, a hasło jest w nim jedno dla
   wszystkich (`HASLO_SCENARIUSZY` w `server/src/db/seed-scenariusze.ts`). */
export const HASLO = "wertis12345";
export const KONTO = {
  biuro: { login: "biuro.test", nazwa: "Biuro (scenariusze)" },
  admin: { login: "admin.test", nazwa: "Administrator (scenariusze)" },
  magazynier: { login: "jan.k", nazwa: "Jan Kowalski" },
} as const;

/* Gotowe tokeny sesji z tego samego seeda. Służą WYŁĄCZNIE pytaniom do
   samego API, czyli sprawdzeniu bramki roli bez ekranu. Na ekran wchodzi się
   formularzem logowania, bo to on jest pierwszym krokiem każdej drogi. */
export const TOKEN = {
  biuro: "scenariusz-biuro",
  admin: "scenariusz-admin",
  magazynier: "scenariusz-jan",
} as const;

/* Uchwyty spraw obsługi klienta z seeda scenariuszy (`SPRAWY_OBSLUGI`
   w `server/src/db/seed-scenariusze.ts`, opis w `docs/scenariusze-testowe.md`).
   Sprawy szuka się po loginie albo numerze, nigdy po numerze wiersza: ten
   zależy od kolejności wstawiania w seedzie. */
export const SPRAWA = {
  rozmowaWolna: { login: "klient.testowy", watek: "scenariusz-watek-pytanie" },
  rozmowaDopisek: { login: "klient.dopisujacy", watek: "scenariusz-watek-dopisek" },
  zwrotDoDecyzji: { numer: "SCEN-1/ZWROT", login: "klient.zwrot.decyzja" },
  zwrotDoWyplaty: {
    numer: "SCEN-2/ZWROT", login: "klient.zwrot.wyplata",
    platnosc: "scenariusz-platnosc-wyplata", zamowienie: "scenariusz-zam-zwrot-wyplata",
  },
  reklamacja: { numer: "SCEN-1/REKLAMACJA", login: "klient.reklamacja", sprawa: "scenariusz-reklamacja" },
} as const;
