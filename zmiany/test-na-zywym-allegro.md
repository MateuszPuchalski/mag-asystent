---
rodzaj: minor
tytul: test na żywym Allegro raz dziennie, bez atrap
---

**Test na żywym Allegro raz dziennie.** Drugi krok po „build it”. Nasze
bramki sprawdzają kod wobec kodu, nie wobec Allegro. Tak przez 150 wydań
„działały” zdjęcia Copilota: testy podstawiały pobieracz i przechodziły.

- **Pięć kroków, te same drogi co produkcja, bez atrap:** lista wątków
  skrzynki, najnowsza sprawa posprzedażowa, zdjęcie z rozmowy i zdjęcie ze
  sprawy pobrane dokładnie tak, jak pobiera je Copilot. Piąty krok, bez
  sieci, liczy zdjęcia, które w szkicach z ostatniej doby nie doszły do modelu.
- **Tylko czyta z Allegro.** U siebie zapisuje wynik kroku, zdanie bez
  adresów i czas. Zdjęcia nie idą do modelu; test sprawdza bramkę, nie płaci.
- **Stan systemu → „Test na żywym Allegro”** z przyciskiem „Przetestuj
  teraz”, co najwyżej raz na pięć minut.
- **Krok, który nie przeszedł, staje w DO DECYZJI** i gaśnie po udanym
  przebiegu. Limit 429 i brak danych to „pominięty”, nie błąd.

Po wdrożeniu warto kliknąć „Przetestuj teraz” — pierwszy przebieg z taktu
przyjdzie w ciągu doby. Tabela `sonda_rzeczywistosci` powstaje sama przy starcie.
