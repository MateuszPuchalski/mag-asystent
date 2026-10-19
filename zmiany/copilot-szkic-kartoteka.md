---
rodzaj: minor
tytul: Copilot sam szuka w kartotece przy pisaniu szkicu
---

**Copilot sam sprawdza kartotekę, gdy pisze szkic odpowiedzi.** Klient pyta
numerem OEM, nazwą części albo inną aukcją. Copilot znajduje wtedy nasz towar,
jego dostępność, cenę i link do naszej oferty. Nie zgaduje już z własnej
wiedzy.

Szkic korzysta z tych samych narzędzi co dopytanie, w najwyżej trzech
rundach. Narzędzia pokazują dodatkowo ceny sprzedaży z kartoteki (nigdy cenę
zakupu) i nasze aktywne oferty Allegro towaru. Wynik narzędzia ma w szkicu
własne oznaczenie `N#`. Walidacja numerów i faktów sprawdza go tak samo jak
pozostałe fakty. Szkic, który użył narzędzi, nie wychodzi automatem w
przepływie na żywo, tylko czeka na agenta. Przełącznik `COPILOT_SZKIC_NARZEDZIA=0` wraca do szkicu
z jednym wywołaniem.
