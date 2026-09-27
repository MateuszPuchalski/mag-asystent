---
rodzaj: minor
tytul: dosyłka ze śledzeniem w sprawie klienta
---

**Odmowa „Wysłaliśmy nowy towar” zakłada śledzenie dosyłki.** Drugi przyrost
sprawy klienta. Przy złym towarze biuro odmawia wypłaty za zwrot kodem
„Wysłaliśmy nowy towar” albo „Wysłaliśmy brakującą część”. Ta sama odmowa, w tym
samym kliknięciu, stawia w sprawie klienta krok „dosłać” na trzy dni robocze
i zaczyna pilnować drugiej paczki. Sprawę bez kroku zakłada, zakończoną
wznawia, a w toku zastępuje jej krok. Ekran zwrotu mówi, co zastąpił.

**Numer dosyłki przychodzi sam z Allegro.** Co kwadrans serwer pyta o przesyłki
zamówienia i wybiera dosyłkę: odrzuca pierwszą paczkę i paczki zwrotu. Gdy
numeru nie da się wskazać na pewno, po dwóch dniach roboczych karta sprawy
prosi o wpisanie go z Sellasist. Numer wpisuje się na profilu, z listą
przewoźników znanych z bazy.

**Sprawa widzi, gdzie jest dosyłka.** Karta sprawy, historia klienta przy
kolejkach i „Moje” mówią jednym zdaniem: „Dosyłka w drodze”, „Dosyłka doręczona
30.09”, „Przewoźnik zgłosił problem z dosyłką”. Doręczenie i kłopot budzą
sprawę jak nowy zwrot. Dosyłka bez numeru za długo albo z kłopotem staje
w „Moje” na dziś. Po doręczeniu profil pyta „Zakończ sprawę?”, choć zwrot
wymiany stoi otwarty.

- Pod „Odmówiono” przy zwrocie stoi stan dosyłki z odnośnikiem do profilu
  klienta. Gdy zapis dosyłki się nie uda, odmowa i tak jest wysłana, a przycisk
  „Śledź dosyłkę” ponawia sam zapis.
- Profil proponuje śledzenie odmowy z panelu Allegro z ostatnich trzydziestu
  dni, której nikt jeszcze nie śledzi.
- Paczka zamówienia na profilu i w faktach szkicu Copilota mówi też o drugiej
  paczce, bez jej numeru.
- W dzienniku numer sprawy, nigdy numer przesyłki ani login.
- Tabela `klient_dosylka` i takt `dosylki` powstają same przy starcie.
  Przebuduj panel i zrestartuj serwer.
