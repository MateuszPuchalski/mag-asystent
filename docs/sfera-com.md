# Sfera Subiekta GT — kształt COM, który mamy ustalony

`CLAUDE.md` mówi o Allegro: kształt czyta się z pliku, nie z pamięci. Mapowanie
z pamięci kosztowało tam trzy wydania. Sfera stała do 0.197.0 dokładnie po tej
złej stronie reguły: dwadzieścia cztery znaczniki `[WERYFIKUJ]` w jednym pliku,
zero zapisanych źródeł.

Ten dokument zbiera to, co udało się ustalić **z dokumentacji i z opublikowanych
przykładów producenta**, oraz nazywa wprost to, czego stamtąd ustalić się nie da.
Autorytetem pozostaje **InfoSfera** — pomoc instalowana razem ze Sferą, na
maszynie klienta. Nie ma jej w tym repozytorium i nie będzie: to cudza treść,
a repozytorium jest publiczne.

Kod, którego to dotyczy: [`sfera-worker/src/SferaComAdapter.cs`](../sfera-worker/src/SferaComAdapter.cs).
Lista punktów `[WERYFIKUJ]`: [`sfera-worker/README.md`](../sfera-worker/README.md).

## 1. Logowanie — komplet właściwości

Przykład producenta ma osiem kroków przed `Uruchom`. Nasz kod miał sześć.

```vb
gt.Produkt = InsERT.gtaProduktSubiekt
gt.Serwer = "serwer\insertgt"
gt.Baza = "BIMBO"
gt.Autentykacja = InsERT.gtaAutentykacjaMieszana
gt.Uzytkownik = "sa"            ' login SQL
gt.UzytkownikHaslo = ""
gt.Operator = "Szef"            ' operator Subiekta
gt.OperatorHaslo = ""
Set sgt = gt.Uruchom(InsERT.gtaUruchomDopasuj, InsERT.gtaUruchom)
```

Wynikają z tego dwie poprawki, obie wydane w 0.197.0.

**Login SQL to osobna para kluczy.** `Uzytkownik` i `UzytkownikHaslo` to
uwierzytelnienie w bazie. `Operator` i `OperatorHaslo` to użytkownik Subiekta.
Przy autentykacji mieszanej Sfera potrzebuje obu par. Nasz kod ustawiał tylko
drugą, więc połączenie nie miało czym otworzyć bazy.

To **nie jest** `MSSQL_USER` z `wertis.env`. Tamten login ma z założenia prawo
`SELECT` na sześciu tabelach i `UPDATE` na dwóch kolumnach (`DEPLOY.md` §6).
Sfera wystawia dokumenty i potrzebuje pełnych praw podmiotu. Stąd osobne klucze
`SFERA_SQL_LOGIN` i `SFERA_SQL_HASLO`.

**Adres serwera zawiera instancję.** Przykład podaje `serwer\insertgt`, a
instalator InsERT-u zakłada instancję `INSERTGT`. Nasz kod wysyłał samo
`MSSQL_SERVER`, czyli celował w instancję domyślną. Teraz skleja
`HOST\INSTANCJA` tak samo jak `config.mssql` po stronie Node.

## 2. Wartości wyliczeń, które są opublikowane

`UruchomEnum` — drugi argument `Uruchom`, maska bitowa:

| stała | wartość | znaczenie |
|---|---|---|
| `gtaUruchom` | `0x0` | podłącz się do działającej, uruchom dopiero, gdy jej nie ma |
| `gtaUruchomNieZablokowany` | `0x1` | pomiń aplikację zajętą interfejsem użytkownika |
| `gtaUruchomNowy` | `0x2` | zawsze nowa instancja |
| `gtaUruchomWTle` | `0x4` | bez interfejsu użytkownika, bez okna |

`UruchomDopasujEnum.gtaUruchomDopasuj` to `0x0`: pierwsza znaleziona aplikacja
tego typu, podłączona do wskazanego serwera i bazy.

Worker wysyła `Uruchom(0x0, 0x0 | 0x4)`. Usługa Windows nie ma pulpitu, więc bez
`gtaUruchomWTle` Subiekt nie miałby gdzie pokazać okna. Kod miał tu wcześniej
gołe `Uruchom(0, 4)` — te same liczby, bez śladu, skąd się wzięły.

## 3. Czego z publicznych źródeł ustalić się nie da

Trzy grupy. Wszystkie zostają jako `[WERYFIKUJ]`.

1. **Wartości liczbowe `ProduktEnum` i `AutentykacjaEnum`.** Nazwy stałych są
   opublikowane, liczby nie. Domyślne wartości siedzą teraz w `wertis.env`
   (`SFERA_PRODUKT`, `SFERA_AUTENTYKACJA`), nie w kodzie. Poprawka na hali
   kosztuje restart usługi, nie przebudowanie exe.
2. **Model dokumentów.** Nazwy managerów, metod `Dodaj*` i właściwości
   dokumentu opisuje wyłącznie InfoSfera. Odpowiada na nie sonda, punkt niżej.
3. **Skutek `Zapisz()`.** Czy dokument powstaje wykonany, czy trafia do bufora.
   Tego nie widać po nazwach; to widać po jednym wystawionym MM.

## 4. Jak zamknąć resztę listy

**Najpierw sonda.** [`sfera-worker/sonda.ps1`](../sfera-worker/sonda.ps1)
otwiera sesję i wypisuje nazwy składowych. Niczego nie zapisuje: żadnego
`Dodaj*`, żadnego `Zapisz()`. Zamyka punkty od 1 do 4, 6 i 8, bez śladu w bazie
i bez pakietu SDK.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\sonda.ps1
```

**Potem bramka 2** z [`wdrozenie.md`](wdrozenie.md): jedno prawdziwe MM na
kartotece próbnej, na kopii bazy. Ona rozstrzyga punkty 5 i 7 oraz nazwy
właściwości na samym dokumencie.

Po ustaleniach poprawia się jeden plik — `SferaComAdapter.cs` — i dopisuje
wynik tutaj. Znacznik zdjęty z listy w `sfera-worker/README.md` ma tu zostawić
zdanie o tym, co go zamknęło.

## Źródła

Wartości wyżej pochodzą z opublikowanych przykładów i opisu wyliczeń Sfery,
cytowanych w poniższych wątkach. Nie są potwierdzone na naszej instalacji —
od tego jest sonda i bramka 2.

- [Subiekt GT Sfera — przykład logowania](https://programowanie.cal.pl/forum/viewtopic.php?f=2&t=2222) (pełna sekwencja właściwości obiektu GT)
- [Sfera Subiekt GT — wywołanie Uruchom w C#](https://4programmers.net/Forum/C_i_C++/191405-sfera_subiekt_gt) (maska trybu uruchomienia)
- [Problem z integracją przez Sferę](https://forumsubiekta.pl/dodatki-zestawienia/problem-z-integracja-\(polaczenie-przez-sfere\)/10?wap2=) (wartości `UruchomEnum` i `UruchomDopasujEnum`)
- [Sfera dla InsERT GT — informacje zaawansowane](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/7667,sfera-dla-insert-gt-%E2%80%93-informacje-zaawansowane.html) (gdzie szukać InfoSfery)
