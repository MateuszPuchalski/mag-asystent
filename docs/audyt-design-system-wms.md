# Audyt systemu wizualnego Biura i WMS — 12 września 2026

Audyt według ECC `design-system`, tryb Visual Audit. Punktem odniesienia jest
panel Obsługa: Barlow, grafitowy nagłówek, jasne karty i pomarańcz WERTIS
`#FF9100`. Sprawdzono logowanie, wspólny nagłówek oraz dziesięć obszarów WMS.
Obsługa dostarcza wzorzec; jej pozostałe ekrany i kolektor Android nie są
przedmiotem tego audytu.

Stan wyjściowy: commit `bcc58ac`, wersja 0.287.0. Wszystkie próby korzystają
z danych demonstracyjnych. Oceny są oceną projektową, nie certyfikatem
dostępności ani pomiarem wydajności pracownika.

| Wymiar | Przed → po / 10 | Problem, poprawka i miejsce |
|---|---:|---|
| Kolory | 6 → 9 | WMS definiował starą żółto-zieloną paletę, a motyw nadpisywał jej część. Usunięto podwójną warstwę komponentów. Wszystkie kolory WMS korzystają z nazwanych ról: `server/src/web/biuro-theme.css:3`, `server/src/web/wms.css:1`. |
| Typografia | 6 → 9 | Nagłówki sekcji dziedziczyły wersaliki i kolor drobnych podpisów. W zbiórce ręcznej nagłówek miał 10 px. WMS ma jawne 24 px dla tytułu, 20 px dla sekcji i 14 px dla treści. Duża pozycja skrzynki pozostaje wyjątkiem funkcjonalnym: `server/src/web/wms.css:219`. |
| Odstępy | 6 → 8 | Formularze mieszały odstępy 7, 14, 18 i 22 px. Wprowadzono skalę 4/8/12/16/24 i wspólny rytm formularza. Rozmiary skanowanych danych zachowują własną skalę: `server/src/web/biuro-theme.css:33`, `server/src/web/wms.css:226`. |
| Komponenty | 6 → 9 | Karty miały promienie 7, 8, 10 i 12 px. Kontrolki korzystają z 8 px, karty z 12 px, statusy z 4 px. Nieaktywny przycisk ma kursor niedostępności, nie oczekiwania. Pole wyboru wraz z etykietą tworzy jeden wygodny cel: `server/src/web/wms.css:44`, `server/src/web/wms.css:601`, `server/src/web/wms.css:641`. |
| Responsywność | 7 → 9 | Aktywny obszar znikał poza przewijanym paskiem, a kod skrzynki dostawał tylko 85 px. Pasek odsłania aktywną pozycję, pole kodu jest szersze niż ilość, długie SKU zawijają się: `server/src/web/wms.js:266`, `server/src/web/wms.css:651`, `server/src/web/wms.css:664`. |
| Tryb ciemny | 2 → 4 | Pełnego trybu ciemnego nie ma. Jawne `color-scheme: light` utrzymuje spójne natywne kontrolki również przy ciemnym ustawieniu systemu. Pełna ciemna paleta wymaga osobnego projektu i walidacji: `server/src/web/biuro-theme.css:8`. |
| Animacja | 8 → 9 | Brak ozdobnych animacji jest właściwy dla skanowania. Preferencja ograniczenia ruchu obejmuje teraz także ramę Biura i pseudo-elementy: `server/src/web/biuro-theme.css:306`. |
| Dostępność | 5 → 8 | Przycisk wylogowania nie miał dostępnej nazwy; nawigacja używała `aria-selected` bez roli zakładki. Podpis miał kontrast 4,34:1 na tle strony, a obwódka pola była zbyt blada. Dodano nazwę, `aria-current`, ciemniejszy podpis, obwódkę i fokus. Rozwijane sekcje mają 48 px zamiast 36 px: `server/src/web/biuro.html:868`, `server/src/web/wms.js:264`, `server/src/web/biuro-theme.css:11`, `server/src/web/biuro-theme.css:296`, `server/src/web/wms.css:358`. |
| Gęstość informacji | 7 → 8 | Każdy obszar miał tytuł „Realizacja zamówień”. Tytuł odpowiada teraz wybranej czynności. Na wąskim ekranie bieżąca zbiórka zachowuje priorytet lokalizacji, skrzynki i skanu; konfiguracja pozostaje poza formularzem roboczym: `server/src/web/wms.js:263`, `server/src/web/wms-carts.js:121`. |
| Stany interakcji | 6 → 8 | Przy wolnym odczycie widoczne było głównie zablokowanie przycisków. Po 300 ms pojawia się komunikat poza obszarem `inert`; znika po zakończeniu. Fokus wraca do nawigacji lub następnego pola skanu. Komunikat błędu ma pilny kanał odczytu: `server/src/web/wms.js:116`, `server/src/web/wms.js:128`, `server/src/web/wms.css:673`. |

## Utrzymanie

Tokeny wspólnego motywu stoją w `biuro-theme.css`. `wms.css` odpowiada za
komponenty i układ WMS. Motyw nie powinien ponownie nadpisywać poszczególnych
komponentów WMS. Obsługa pozostaje osobnym frontem; jej odpowiedniki tokenów
są w `panel/tailwind.config.js`. Zmiana marki wymaga sprawdzenia obu frontów.

Pomarańcz służy głównej akcji i wskazaniu miejsca pracy. Tekst na pomarańczowym
przycisku jest grafitowy. Sukces, wyjątek i trwająca praca mają własne kolory
oraz opisy tekstowe. Kod lokalizacji, pozycja skrzynki i liczby używają cyfr
o stałej szerokości. Nie skracamy kodu SKU wielokropkiem w instrukcji skanu.

Nie znaleziono dekoracyjnych gradientów, efektów szkła ani animacji przewijania,
które utrudniałyby pracę. Zmiany zachowują znak WERTIS i układ zgodny z Obsługą.

## Weryfikacja

- `npm run test:wms:e2e -- --built`: pełny przebieg zamówienia, zbiórki,
  pakowania i wysyłki, również dla wózków 20/30. Obejmuje błędny skan,
  utratę odpowiedzi, odświeżenie i zgodność stanów.
- `tools/wms-design-e2e.mjs`, uruchamiany przez powyższy test: dziesięć obszarów
  przy szerokościach 320, 390, 768 i 1440 px; brak poziomego przepełnienia
  dokumentu; widoczna aktywna pozycja nawigacji; cele przycisków i sekcji
  co najmniej 48 px; klawiatura, wolny odczyt i ograniczenie ruchu.
- `tools/wms-cart-e2e.mjs`: potwierdzenie odkładania mieści się w pierwszym
  ekranie 390 × 844; pole skrzynki jest szersze od ilości; długi symbol SKU
  nie powoduje poziomego przepełnienia. Sprawdzono zrzuty obu wózków.
- Dodatkowy lokalny audyt axe-core 4.13.0, reguły WCAG A/AA i 2.1 AA:
  logowanie oraz dziesięć obszarów przy 1440 i 390 px, bez zgłoszonych naruszeń.
  Silnik pozostawia część ocen kontrastu jako nierozstrzygnięte, m.in. przy
  elementach przewijanych. Nie jest to deklaracja pełnej zgodności WCAG.
  Instrumentacja używa wyłączenia CSP tylko w kontekście testowej przeglądarki;
  polityka bezpieczeństwa aplikacji pozostaje aktywna w zwykłym E2E.

Zrzuty i wyniki jednorazowego pomiaru są lokalnie w `.wms-artifacts/design-*`.
Pozostają poza repozytorium. Automatyczne próby nie zastępują pracy na fizycznym
kolektorze ani testu z czytnikiem ekranu. Pełny tryb ciemny i pomiar ergonomii
podczas rzeczywistej zmiany pozostają poza zakresem tej poprawki.
