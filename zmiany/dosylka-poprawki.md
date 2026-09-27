---
rodzaj: patch
tytul: poprawki dosyłki po przeglądzie
---

**Formularz odmowy nie przechodzi już na następny zwrot.** Po odmowie na
jednym zwrocie i przejściu na drugi formularz stał otwarty z kodem i powodem
poprzedniego. Jedno kliknięcie wysyłało nieodwracalną odmowę do innego
klienta, a od 0.536.0 zakładało mu też dosyłkę. Sekcja pieniędzy rysuje się
teraz od nowa dla każdego zwrotu, a błąd odmowy stoi przy swoim zwrocie.

**Dosyłka nie gubi się i nie wraca nie w porę.** Poprawki do 0.536.0 po
trzech przeglądach:

- Odmowa wypłaty przejmuje dosyłkę, której numer ktoś już wpisał, zamiast ją
  kasować — także numer trzeciej paczki wpisany przed odmową drugiego zwrotu.
- Sprawa wznowiona po zakończeniu nie pokazuje skończonych dosyłek poprzedniej
  sprawy. Stara dosyłka bez numeru nie trzyma już sprawy „na dziś” tygodniami.
  Dosyłka, która jeszcze jedzie, zostaje śledzona.
- Numer wpisany z Sellasist do paczki już doręczonej budzi sprawę z datą,
  a profil pyta „Zakończ sprawę?”.
- Drugi kłopot przewoźnika z tą samą dosyłką budzi sprawę. Doręczenie, które
  prowadzący już widział, nie budzi jej drugi raz.
- Numer wpisany po czasie ma własne trzydzieści dni śledzenia.
- Serwer nie bierze pierwszej paczki za dosyłkę, gdy Allegro nie podało daty
  nadania.
- Jeden źle wpisany numer nie zatrzymuje śledzenia pozostałych dosyłek tego
  przewoźnika.
- Podpowiedź „Zakończ sprawę?” czeka, aż dojdą wszystkie dosyłki sprawy,
  i znika po nowym kroku.
- Odmowa złożona w panelu Allegro pokazuje na ekranie zwrotu stan dosyłki
  i zamyka tam drugą odmowę oraz wypłatę, których Allegro i tak nie przyjmie.
- Numer dosyłki wpisuje się z przewoźnikiem wybranym świadomie. Lista zna
  „inny”, a nie proponuje już pierwszego z alfabetu.
- Linijka dosyłki na profilu mówi, którego zamówienia dotyczy, i prowadzi
  do zwrotu.
- Śledzenie dosyłek chodzi co siedemnaście minut, innym rytmem niż rabaty.
  Rytm zmienia `ALLEGRO_DOSYLKI_SYNC_MS`, a 0 wyłącza takt.
- Dziennik serwera nie przepisuje już treści odpowiedzi Allegro przy błędzie
  śledzenia. Numer dosyłki zszedł z historii przy kolejkach, zostaje na
  karcie sprawy.
- Dokumenty oddzielają fakty właściciela od założeń. Kod „Wysłaliśmy
  brakującą część” dołożyliśmy sami, a 0.536.0 przypisał go właścicielowi.

Migracja dokłada cztery kolumny do tabeli `klient_dosylka` przy starcie
i przycina zapisane odciski spraw do nowych liczników. Nie trzeba nic klikać.
