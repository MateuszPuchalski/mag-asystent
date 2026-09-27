---
rodzaj: minor
tytul: sprawa klienta — kto prowadzi, następny krok, zakończenie
---

**Sprawa klienta na profilu.** Decyzja właściciela z 26 września 2026. Karta
„Sprawa klienta” pod sygnałami profilu mówi, kto prowadzi klienta i jaki jest
nasz następny krok z terminem. Krok ustawia się podpowiedzią („czekamy na
zwrot”, „dosłać”, „czekamy na dostawcę”) i jednym kliknięciem w gotowy termin.
Kalendarz sięga sześćdziesiąt dni naprzód. „Zakończ sprawę” kończy sprawę,
a pasek „Cofnij” przez osiem sekund cofa pomyłkę. „Przejmij” stoi tylko przy
cudzej sprawie w toku.

**Sprawa budzi się sama, gdy klient się ruszy.** Nowa wiadomość klienta, nowy
zwrot, jego nadanie albo doręczenie, reklamacja, dyskusja i wiadomość w nich
stawiają sprawę na „Moje” prowadzącego. Powód stoi słowami, np. „Klient
napisał 26.09 14:10”, i prowadzi do źródła. Podziękowanie, zakup i nasze
własne ruchy sprawy nie budzą. Zakończona budzi się przez trzydzieści dni od
zakończenia; później nowa wiadomość to nowa sprawa. Obudzoną zakończoną kończy
się znów jednym kliknięciem „Zakończ sprawę”.

**„Moje” niesie sprawy klienta.** Na górze obudzone, potem terminy z kolejek
i kroki na dziś albo po terminie, na końcu kroki czekające na swój dzień.
Wiersz prowadzi do źródła zdarzenia albo na profil. Historia klienta przy
rozmowie, zwrocie, reklamacji i dyskusji pokazuje linijkę sprawy.

**Ctrl+K po numerze zamówienia daje kupującego.** Brak w dostawie przychodzi
z numerem zamówienia, a sprawę zakłada się na profilu klienta. Teraz profil
jest o jeden krok od numeru.

- Karta profilu „Otwarte sprawy” nazywa się teraz „Otwarte w kolejkach”, żeby
  „sprawa” na profilu znaczyła jedno.
- Zapis z ekranu sprzed cudzego ruchu albo sprzed nowej wiadomości klienta
  dostaje zdanie, co się stało, zamiast cicho nadpisać sprawę. Dotyczy to
  także „Przejmij” i „Cofnij”.
- „Cofnij” po zakończeniu przywraca to, co było nowe, zamiast to potwierdzić.
- Dziennik dostaje numer sprawy, długość kroku i termin — nigdy login ani
  treść kroku. Odrzucenia pod profilem klienta zapisują wzorzec trasy zamiast
  loginu.
- Tabela `klient_prowadzenie` i sześć indeksów powstają same przy
  starcie. Przebuduj panel i zrestartuj serwer.
