/* ── Rejestr kluczy wertis.env (0.488.0) ─────────────────────────────────────
   Lista WSZYSTKIEGO, co trzy programy czytają z `wertis.env`: serwer, worker
   Sfery i usługa tła. Do tego wydania jedynym spisem był `wertis.env.example`
   (561 linii), a pytanie „na czym ten serwer faktycznie chodzi" wymagało
   pulpitu zdalnego i edytora tekstu na maszynie z Subiektem.

   Rejestr robi trzy rzeczy, których plik przykładowy nie umie:
   1. panel pokazuje z niego stan konfiguracji, grupami, bez sekretów;
   2. klucz w `wertis.env`, którego nikt nie czyta, zgłasza się w zdrowiu —
      literówka w nazwie była dotąd cicha i kończyła się wartością domyślną;
   3. dzieli klucze na tych, kto je ustawia (`kto`), co jest podstawą pod
      edycję z panelu i pod cięcie pokręteł, których nikt nie powinien ruszać.

   LISTĘ PILNUJE TEST (`konfiguracja-rejestr.test.ts`), nie pamięć. Czyta
   źródła wszystkich trzech programów i porównuje z `czyta` w obie strony,
   tak jak rejestr zdarzeń pilnuje `logEvent`.

   Domyślnych wartości tu NIE MA, celowo. Stoją w `config.ts` i w kodzie C#,
   a druga kopia stu kilkudziesięciu liczb rozjechałaby się przy pierwszej
   zmianie. Panel mówi „domyślna" i odsyła do opisu.                          */

export type Grupa =
  | "subiekt" | "magazyn" | "allegro" | "zwroty" | "copilot"
  | "zdjecia" | "sfera" | "tlo" | "serwer";

export const NAZWY_GRUP: Record<Grupa, string> = {
  subiekt: "Połączenie z Subiektem",
  magazyn: "Magazyny i dokumenty",
  allegro: "Allegro",
  zwroty: "Zwroty i reklamacje",
  copilot: "Copilot",
  zdjecia: "Zdjęcia",
  sfera: "Worker Sfery",
  tlo: "Usuwanie tła",
  serwer: "Serwer i kopie",
};

/**
 * Kto ustawia klucz. Rozstrzyga, co panel pokaże na wierzchu, a co schowa.
 *
 * - `instalator` — wpisuje go kreator; ręczna zmiana zwykle znaczy pomyłkę.
 * - `wlasciciel` — decyzja biznesowa, zmieniana świadomie i rzadko.
 * - `zaawansowane` — pokrętło techniczne z dobrą wartością domyślną.
 * - `dev` — wyłącznie rozwój i testy; na produkcji puste.
 */
export type Kto = "instalator" | "wlasciciel" | "zaawansowane" | "dev";

export type Program = "serwer" | "sfera" | "tlo";

export interface Klucz {
  klucz: string;
  grupa: Grupa;
  kto: Kto;
  /** Jedno zdanie po polsku: co ustawia. Pełny opis — `wertis.env.example`. */
  opis: string;
  /** Wartość NIGDY nie wychodzi z serwera; panel widzi tylko „ustawione". */
  tajny?: true;
  /** Które programy go czytają. Brak pola = sam serwer. */
  czyta?: readonly Program[];
}

const S = ["serwer", "sfera"] as const;

export const KLUCZE: readonly Klucz[] = [
  // ── Połączenie z Subiektem ────────────────────────────────────────────────
  { klucz: "SGT_MODE", grupa: "subiekt", kto: "instalator", czyta: S,
    opis: "mssql = prawdziwa baza Subiekta, seeded = dane demo bez kontaktu z Subiektem." },
  { klucz: "MSSQL_SERVER", grupa: "subiekt", kto: "instalator", czyta: S,
    opis: "Adres SQL Servera z bazą Subiekta." },
  { klucz: "MSSQL_INSTANCE", grupa: "subiekt", kto: "instalator", czyta: S,
    opis: "Instancja nazwana SQL Servera, zwykle INSERTGT." },
  { klucz: "MSSQL_PORT", grupa: "subiekt", kto: "instalator", czyta: S,
    opis: "Port TCP; gdy ustawiony, ma pierwszeństwo przed instancją nazwaną." },
  { klucz: "MSSQL_DATABASE", grupa: "subiekt", kto: "instalator", czyta: S,
    opis: "Baza podmiotu, czyli nazwa firmy w oknie wyboru podmiotu Subiekta." },
  { klucz: "MSSQL_USER", grupa: "subiekt", kto: "instalator",
    opis: "Login SQL aplikacji o minimalnych uprawnieniach, zwykle wertis." },
  { klucz: "MSSQL_PASSWORD", grupa: "subiekt", kto: "instalator", tajny: true,
    opis: "Hasło loginu SQL aplikacji; losuje je instalator." },
  { klucz: "MSSQL_ENCRYPT", grupa: "subiekt", kto: "zaawansowane",
    opis: "1 = szyfrowane połączenie z SQL Serverem." },
  { klucz: "MSSQL_TRUST_CERT", grupa: "subiekt", kto: "zaawansowane",
    opis: "0 = wymagaj zaufanego certyfikatu SQL Servera." },
  { klucz: "MSSQL_LOC_COLUMN", grupa: "subiekt", kto: "instalator",
    opis: "Pole własne kartoteki (tw_Pole1–8), które trzyma lokalizację." },
  { klucz: "MSSQL_ZD_ZREAL_COLUMN", grupa: "subiekt", kto: "instalator",
    opis: "Kolumna ilości już odebranej z zamówienia; puste, gdy baza jej nie ma." },
  { klucz: "MSSQL_ZD_TERMIN_COLUMN", grupa: "subiekt", kto: "zaawansowane",
    opis: "Kolumna terminu realizacji zamówienia; puste = zamówienia bez terminu." },
  { klucz: "MSSQL_SYNC_MS", grupa: "subiekt", kto: "zaawansowane",
    opis: "Co ile milisekund odświeżać kopię danych Subiekta." },
  { klucz: "MSSQL_REQUEST_TIMEOUT_MS", grupa: "subiekt", kto: "zaawansowane",
    opis: "Limit czasu jednego zapytania do bazy Subiekta w milisekundach." },
  { klucz: "MSSQL_SPRZEDAZ_NR_ORYG_COLUMN", grupa: "subiekt", kto: "zaawansowane",
    opis: "Kolumna numeru obcego na sprzedaży, do wiązania zwrotów." },
  { klucz: "MSSQL_KOREKTA_COLUMN", grupa: "subiekt", kto: "zaawansowane",
    opis: "Kolumna dokumentu korygowanego; puste wyłącza automat numerów korekt." },

  // ── Magazyny i dokumenty ──────────────────────────────────────────────────
  { klucz: "MAG_ID_MAG", grupa: "magazyn", kto: "instalator", opis: "mag_Id magazynu głównego." },
  { klucz: "MAG_ID_MGP", grupa: "magazyn", kto: "instalator", opis: "mag_Id strefy przyjęć." },
  { klucz: "MAG_ID_ZWROTY", grupa: "magazyn", kto: "instalator", opis: "mag_Id magazynu zwrotów." },
  { klucz: "MAG_ID_ODP", grupa: "magazyn", kto: "wlasciciel",
    opis: "mag_Id magazynu odpadu dla towaru do utylizacji; 0 wyłącza." },
  { klucz: "MAG_ID_SERWIS", grupa: "magazyn", kto: "wlasciciel",
    opis: "mag_Id magazynu serwisowego dla braków w dostawie; 0 wyłącza." },
  { klucz: "DOK_TYPY_DOSTAW", grupa: "magazyn", kto: "wlasciciel",
    opis: "Kody dokumentów dostaw do rozkładania: 1 = sama FZ, 1,10 = FZ i PZ." },
  { klucz: "POZYCJE_NIE_TOWAROWE", grupa: "magazyn", kto: "wlasciciel",
    opis: "Symbole pozycji, które nie są towarem, np. PRZESYŁKA; puste wyłącza." },
  { klucz: "TW_ID_PRZESYLKA", grupa: "magazyn", kto: "wlasciciel",
    opis: "tw_Id kartoteki PRZESYŁKA z paragonów Allegro; wymagane przy SFERA_ZW=1." },
  { klucz: "ALLOW_MANUAL_LOC", grupa: "magazyn", kto: "wlasciciel",
    opis: "0 zabrania wpisywania lokalizacji z klawiatury kolektora." },
  { klucz: "DOK_TYPY_KOREKT", grupa: "magazyn", kto: "zaawansowane",
    opis: "Kody dokumentów oddających towar na stan po zwrocie." },
  { klucz: "DOK_STATUS_ZD_OTWARTE", grupa: "magazyn", kto: "zaawansowane",
    opis: "Statusy zamówień do dostawcy uznawane za otwarte." },
  { klucz: "DOK_DNI_WSTECZ", grupa: "magazyn", kto: "zaawansowane",
    opis: "Ile dni wstecz importować dostawy." },
  { klucz: "DOK_SPRZEDAZ_DNI_WSTECZ", grupa: "magazyn", kto: "zaawansowane",
    opis: "Ile dni wstecz importować sprzedaż do wiązania zwrotów." },
  { klucz: "MM_ZWROTY_DNI_WSTECZ", grupa: "magazyn", kto: "zaawansowane",
    opis: "Ile dni wstecz czytać przesunięcia MM na regał zwrotów." },
  { klucz: "LOC_FIELD_LIMIT", grupa: "magazyn", kto: "zaawansowane",
    opis: "Długość pola lokalizacji w Subiekcie, w znakach." },
  { klucz: "LOC_FORMAT_STANDARD", grupa: "magazyn", kto: "zaawansowane",
    opis: "Wzorzec kodu półki." },
  { klucz: "LOC_FORMAT_PALLET", grupa: "magazyn", kto: "zaawansowane",
    opis: "Wzorzec kodu miejsca paletowego." },
  { klucz: "LOC_STRICT", grupa: "magazyn", kto: "zaawansowane",
    opis: "0 wyłącza twarde sprawdzanie wzorca lokalizacji." },

  // ── Allegro ───────────────────────────────────────────────────────────────
  { klucz: "ALLEGRO_CLIENT_ID", grupa: "allegro", kto: "wlasciciel",
    opis: "Client ID aplikacji z developer.allegro.pl; puste wyłącza integrację." },
  { klucz: "ALLEGRO_CLIENT_SECRET", grupa: "allegro", kto: "wlasciciel", tajny: true,
    opis: "Client secret tej samej aplikacji." },
  { klucz: "ALLEGRO_USER_AGENT", grupa: "allegro", kto: "wlasciciel",
    opis: "Nagłówek User-Agent wygenerowany na developer.allegro.pl." },
  { klucz: "ALLEGRO_INBOX_OD", grupa: "allegro", kto: "wlasciciel",
    opis: "Od kiedy skrzynka widzi rozmowy (data ISO w UTC)." },
  { klucz: "ALLEGRO_SELLER_ID", grupa: "allegro", kto: "zaawansowane",
    opis: "Numer sprzedawcy w linkach do Centrum Sprzedaży." },
  { klucz: "ALLEGRO_SANDBOX", grupa: "allegro", kto: "dev",
    opis: "1 = środowisko testowe Allegro." },
  { klucz: "ALLEGRO_MODE", grupa: "allegro", kto: "dev",
    opis: "Wymusza dane fikcyjne (dev) albo prawdziwe API (http); puste = z SGT_MODE." },
  { klucz: "ALLEGRO_AUTH_URL", grupa: "allegro", kto: "zaawansowane",
    opis: "Host autoryzacji Allegro." },
  { klucz: "ALLEGRO_API_URL", grupa: "allegro", kto: "zaawansowane",
    opis: "Host API Allegro." },
  { klucz: "ALLEGRO_WATKI_BETA", grupa: "allegro", kto: "zaawansowane",
    opis: "0 wyłącza dociąganie struktury wątku do klasyfikacji." },
  { klucz: "ALLEGRO_INBOX_SYNC_MS", grupa: "allegro", kto: "zaawansowane",
    opis: "Takt skrzynki w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_OFERTY_SYNC_MS", grupa: "allegro", kto: "zaawansowane",
    opis: "Takt uzupełniania ofert do rozmów w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_ZAMOWIENIA_SYNC_MS", grupa: "allegro", kto: "zaawansowane",
    opis: "Takt uzupełniania zamówień w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_PANEL_OFERTA", grupa: "allegro", kto: "zaawansowane",
    opis: "Wzorzec adresu oferty; {id} zastępuje numer." },
  { klucz: "ALLEGRO_PANEL_ZAMOWIENIE", grupa: "allegro", kto: "zaawansowane",
    opis: "Wzorzec adresu zamówienia w panelu sprzedawcy." },
  { klucz: "ALLEGRO_PANEL_ZWROT", grupa: "allegro", kto: "zaawansowane",
    opis: "Wzorzec adresu zwrotu w Centrum Sprzedaży." },
  { klucz: "ALLEGRO_PANEL_REKLAMACJA", grupa: "allegro", kto: "zaawansowane",
    opis: "Wzorzec adresu reklamacji w Centrum Sprzedaży." },

  // ── Zwroty i reklamacje ───────────────────────────────────────────────────
  { klucz: "ALLEGRO_ZWROTY_OD", grupa: "zwroty", kto: "wlasciciel",
    opis: "Od kiedy pobierane są zwroty (data ISO w UTC)." },
  { klucz: "REKLAMACJE_OD", grupa: "zwroty", kto: "wlasciciel",
    opis: "Od kiedy kolejka reklamacji pokazuje sprawy; puste = bez progu." },
  { klucz: "ZWROT_ROZLICZONE_OD", grupa: "zwroty", kto: "wlasciciel",
    opis: "Od kiedy rekoncyliacja zgłasza zwrot rozliczony poza aplikacją." },
  { klucz: "ZWROT_TERMIN_DNI", grupa: "zwroty", kto: "wlasciciel",
    opis: "Dni na obsłużenie zwrotu od doręczenia paczki (regulamin Allegro)." },
  { klucz: "ZWROT_WYGASA_DNI", grupa: "zwroty", kto: "wlasciciel",
    opis: "Po ilu dniach zwrot bez decyzji uznaje się za rozliczony." },
  { klucz: "ALLEGRO_ZWROTY_SYNC_MS", grupa: "zwroty", kto: "zaawansowane",
    opis: "Takt synchronizacji zwrotów w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_RABATY_SYNC_MS", grupa: "zwroty", kto: "zaawansowane",
    opis: "Takt wniosków o rabat w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_REKLAMACJE_SYNC_MS", grupa: "zwroty", kto: "zaawansowane",
    opis: "Takt synchronizacji reklamacji w milisekundach; 0 wyłącza." },
  { klucz: "ALLEGRO_ZWROTY_DNI_WSTECZ", grupa: "zwroty", kto: "zaawansowane",
    opis: "Wycofany w 0.152.0; serwer odmawia startu, dopóki stoi w pliku." },

  // ── Copilot ───────────────────────────────────────────────────────────────
  { klucz: "COPILOT_MODE", grupa: "copilot", kto: "wlasciciel",
    opis: "anthropic włącza Copilota; off wyłącza." },
  { klucz: "ANTHROPIC_API_KEY", grupa: "copilot", kto: "wlasciciel", tajny: true,
    opis: "Klucz API dostawcy modelu." },
  { klucz: "COPILOT_MODEL", grupa: "copilot", kto: "wlasciciel",
    opis: "Model do szkiców odpowiedzi." },
  { klucz: "COPILOT_MODEL_KLASYFIKACJA", grupa: "copilot", kto: "wlasciciel",
    opis: "Model do rozpoznawania wiadomości; puste = ten sam co do szkiców." },
  { klucz: "COPILOT_AUTO_SZKIC", grupa: "copilot", kto: "wlasciciel",
    opis: "1 = szkic sam dla nowego pytania pod ofertą." },
  { klucz: "COPILOT_AUTO_KLASYFIKACJA", grupa: "copilot", kto: "wlasciciel",
    opis: "1 = rozpoznanie każdej nowej wiadomości klienta." },
  { klucz: "COPILOT_SZKIC_PO_ROZPOZNANIU", grupa: "copilot", kto: "wlasciciel",
    opis: "0 wyłącza szkic układany zaraz po rozpoznaniu." },
  { klucz: "COPILOT_AUTO_NA_GODZINE", grupa: "copilot", kto: "wlasciciel",
    opis: "Sufit automatycznych szkiców na godzinę; hamulec kosztów." },
  { klucz: "COPILOT_AUTO_KLASYFIKACJA_NA_GODZINE", grupa: "copilot", kto: "wlasciciel",
    opis: "Sufit automatycznych rozpoznań na godzinę; hamulec kosztów." },
  { klucz: "COPILOT_MAX_PARTIA", grupa: "copilot", kto: "zaawansowane",
    opis: "Ile rozmów bierze jedno kliknięcie." },
  { klucz: "COPILOT_AUTO_NA_PRZEBIEG", grupa: "copilot", kto: "zaawansowane",
    opis: "Ile szkiców na jeden przebieg taktu." },
  { klucz: "COPILOT_AUTO_KLASYFIKACJA_NA_PRZEBIEG", grupa: "copilot", kto: "zaawansowane",
    opis: "Ile rozpoznań na jeden przebieg taktu." },
  { klucz: "COPILOT_KLASYFIKACJA_OKNO_DNI", grupa: "copilot", kto: "zaawansowane",
    opis: "Z ilu dni wstecz automat bierze wiadomości do rozpoznania." },
  { klucz: "WIEDZA_AUTOMAT", grupa: "copilot", kto: "wlasciciel",
    opis: "1 = kolejka wiedzy opróżnia się sama." },
  { klucz: "WIEDZA_AUTOMAT_MODEL", grupa: "copilot", kto: "wlasciciel",
    opis: "1 = automat wiedzy może pytać model językowy." },
  { klucz: "WIEDZA_AUTOMAT_NA_PRZEBIEG", grupa: "copilot", kto: "zaawansowane",
    opis: "Ile wierszy wiedzy na jeden przebieg." },

  // ── Zdjęcia ───────────────────────────────────────────────────────────────
  { klucz: "ZDJECIA_ZRODLO", grupa: "zdjecia", kto: "instalator",
    opis: "Źródło zdjęć kartotek: blob (tabela Subiekta), plik albo puste (wyłączone)." },
  { klucz: "ZDJECIA_TABELA", grupa: "zdjecia", kto: "instalator", opis: "Tabela zdjęć w bazie Subiekta." },
  { klucz: "ZDJECIA_KOLUMNA_KLUCZA", grupa: "zdjecia", kto: "instalator", opis: "Kolumna z tw_Id towaru." },
  { klucz: "ZDJECIA_KOLUMNA", grupa: "zdjecia", kto: "instalator", opis: "Kolumna z obrazem." },
  { klucz: "ZDJECIA_KOLUMNA_GLOWNE", grupa: "zdjecia", kto: "instalator",
    opis: "Kolumna znacznika zdjęcia głównego." },
  { klucz: "ZDJECIA_KOLUMNA_KOLEJNOSC", grupa: "zdjecia", kto: "instalator",
    opis: "Kolumna kolejności zdjęć." },
  { klucz: "ZDJECIA_KATALOG", grupa: "zdjecia", kto: "instalator",
    opis: "Katalog ze zdjęciami przy źródle plik." },
  { klucz: "ZDJECIA_WZORZEC_PLIKU", grupa: "zdjecia", kto: "instalator",
    opis: "Wzorzec nazwy pliku zdjęcia, np. {symbol}.jpg." },
  { klucz: "ZDJECIA_DODAWANIE", grupa: "zdjecia", kto: "wlasciciel",
    opis: "Zdjęcie z kolektora: puste = nie wolno, wertis = u nas, subiekt = także do kartoteki." },
  { klucz: "ZDJECIA_KOLUMNA_CRC", grupa: "zdjecia", kto: "zaawansowane",
    opis: "Kolumna sumy kontrolnej zdjęcia; puste = nie wpisujemy." },
  { klucz: "ZDJECIA_MAX_KB", grupa: "zdjecia", kto: "zaawansowane",
    opis: "Największe zdjęcie kartoteki, jakie serwer weźmie." },
  { klucz: "ZDJECIA_UPLOAD_MAX_KB", grupa: "zdjecia", kto: "zaawansowane",
    opis: "Największe zdjęcie przyjmowane z kolektora." },
  { klucz: "ZDJECIA_PODGLAD_MIN", grupa: "zdjecia", kto: "zaawansowane",
    opis: "Ile minut żyje podgląd zdjęcia przed zatwierdzeniem." },

  // ── Worker Sfery ──────────────────────────────────────────────────────────
  { klucz: "SFERA_WORKER", grupa: "sfera", kto: "instalator", czyta: S,
    opis: "1 = dokumenty MM wystawia worker Sfery." },
  { klucz: "SFERA_OPERATOR", grupa: "sfera", kto: "instalator", czyta: ["sfera"],
    opis: "Operator Subiekta, którym worker wystawia dokumenty." },
  { klucz: "SFERA_OPERATOR_HASLO", grupa: "sfera", kto: "instalator", tajny: true, czyta: ["sfera"],
    opis: "Hasło tego operatora." },
  { klucz: "SFERA_ZW", grupa: "sfera", kto: "wlasciciel",
    opis: "1 = automatyczny ZW do paragonu; wymaga SFERA_WORKER=1." },
  { klucz: "SFERA_ZW_WYDANIE_KAT_ID", grupa: "sfera", kto: "wlasciciel", czyta: ["sfera"],
    opis: "Kategoria dokumentu ZW; 0 = domyślna Subiekta." },
  { klucz: "SFERA_SQL_LOGIN", grupa: "sfera", kto: "zaawansowane", czyta: ["sfera"],
    opis: "Login SQL Sfery, gdy inny niż konto usługi." },
  { klucz: "SFERA_SQL_HASLO", grupa: "sfera", kto: "zaawansowane", tajny: true, czyta: ["sfera"],
    opis: "Hasło tego loginu." },
  { klucz: "SFERA_PROGID", grupa: "sfera", kto: "zaawansowane", czyta: ["sfera"],
    opis: "Identyfikator COM Sfery." },
  { klucz: "SFERA_PRODUKT", grupa: "sfera", kto: "zaawansowane", czyta: ["sfera"],
    opis: "Produkt InsERT otwierany przez Sferę; 1 = Subiekt." },
  { klucz: "SFERA_AUTENTYKACJA", grupa: "sfera", kto: "zaawansowane", czyta: ["sfera"],
    opis: "Tryb logowania Sfery do SQL Servera." },
  { klucz: "SFERA_TRYB_URUCHOMIENIA", grupa: "sfera", kto: "zaawansowane", czyta: ["sfera"],
    opis: "Tryb uruchomienia Subiekta przez Sferę." },

  // ── Usuwanie tła ──────────────────────────────────────────────────────────
  { klucz: "TLO_URL", grupa: "tlo", kto: "instalator", czyta: ["serwer", "tlo"],
    opis: "Adres usługi wertis-tlo; puste wyłącza usuwanie tła." },
  { klucz: "TLO_TIMEOUT_MS", grupa: "tlo", kto: "zaawansowane",
    opis: "Ile milisekund czekać na wycięcie tła." },
  { klucz: "TLO_MODEL", grupa: "tlo", kto: "zaawansowane", czyta: ["tlo"],
    opis: "Ścieżka pliku modelu ONNX." },
  { klucz: "TLO_BOK", grupa: "tlo", kto: "zaawansowane", czyta: ["tlo"],
    opis: "Dłuższy bok zdjęcia po wycięciu, w pikselach." },

  // ── Serwer i kopie ────────────────────────────────────────────────────────
  { klucz: "PORT", grupa: "serwer", kto: "instalator", opis: "Port API; kolektory łączą się na ten port." },
  { klucz: "SRODOWISKO", grupa: "serwer", kto: "instalator",
    opis: "Etykieta instancji, np. dev; produkcja zostawia puste." },
  { klucz: "KOPIE_KATALOG", grupa: "serwer", kto: "wlasciciel",
    opis: "Katalog kopii bazy aplikacji; najlepiej na innym dysku." },
  { klucz: "STREFA_CZASU", grupa: "serwer", kto: "zaawansowane",
    opis: "Strefa czasu magazynu do wyświetlania godzin i okna nocnej kopii." },
  { klucz: "HOST", grupa: "serwer", kto: "zaawansowane", opis: "Adres nasłuchu API." },
  { klucz: "DB_PATH", grupa: "serwer", kto: "zaawansowane", czyta: S,
    opis: "Ścieżka bazy aplikacji; domyślnie server\\data\\wertis.db." },
  { klucz: "WORKER_POLL_MS", grupa: "serwer", kto: "zaawansowane", czyta: S,
    opis: "Co ile milisekund workery pytają o kolejkę zapisów." },
  { klucz: "LOG_LEVEL", grupa: "serwer", kto: "zaawansowane", opis: "Poziom dziennika serwera." },
  { klucz: "WERTIS_ENV_FILE", grupa: "serwer", kto: "zaawansowane", czyta: ["serwer", "sfera", "tlo"],
    opis: "Ścieżka pliku ustawień; działa tylko jako zmienna środowiska." },
  { klucz: "FORCE_SEED", grupa: "serwer", kto: "dev", opis: "Wymusza zasilenie danymi demo." },
  { klucz: "SEED_PRODUCTS", grupa: "serwer", kto: "dev", opis: "Plik kartoteki demo dla npm run seed." },
  { klucz: "ADMIN_HASLO", grupa: "serwer", kto: "dev", tajny: true,
    opis: "Hasło konta demo przy npm run seed; puste = losowe." },
  { klucz: "WORKER_SIM_ERRORS", grupa: "serwer", kto: "dev",
    opis: "1 = worker udaje błędy zapisu; zakazane przy mssql." },
];

const PO_NAZWIE = new Map(KLUCZE.map((k) => [k.klucz, k]));

export function kluczZRejestru(nazwa: string): Klucz | undefined {
  return PO_NAZWIE.get(nazwa);
}

/**
 * Zdanie do `/api/health` o kluczach z pliku, których nie czyta żaden program.
 *
 * Najczęstsza przyczyna to literówka: `ALEGRO_CLIENT_ID` zamiast
 * `ALLEGRO_CLIENT_ID`. Skutkiem była cicha wartość domyślna, a objaw —
 * funkcja „nie działa" — nie prowadził do pliku. Zdanie pada w każdym
 * trybie, bo literówka na demo zostaje literówką po przełączeniu na mssql.
 */
export function problemNieznanychKluczy(kluczePliku: readonly string[], plik: string | null): string | null {
  const obce = kluczePliku.filter((k) => !PO_NAZWIE.has(k));
  if (obce.length === 0) return null;
  return `W ${plik ?? "wertis.env"} ${obce.length === 1 ? "stoi klucz" : "stoją klucze"}, `
    + `których nie czyta żaden program: ${obce.join(", ")}. `
    + "To zwykle literówka w nazwie, a wtedy działa wartość domyślna. "
    + "Popraw nazwę albo usuń wpis; listę kluczy pokazuje panel w ustawieniach.";
}
