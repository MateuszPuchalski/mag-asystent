# Sellasist — zamówienia i potwierdzenie wysyłki

Konektor korzysta z [oficjalnego API Sellasist](https://api.sellasist.pl/).
Zweryfikowany kontrakt: `GET /orders`, `GET /orders/{order_id}` i `PUT /orders/{order_id}`
ze [specyfikacji OpenAPI](https://api.sellasist.pl/api.yaml?v=1.90.76), pobranej 10 września 2026.
Dotychczasowy import historycznych zbiórek CSV pozostaje osobnym raportem.

## Konfiguracja

Integracja jest domyślnie wyłączona.
W administracji WERTIS utwórz osobne aktywne konto z rolą biura.
Jego identyfikator będzie autorem importów i potwierdzeń w audycie.
Klucz Sellasist wygeneruj w ustawieniach integracji tego systemu.

W `wertis.env` ustaw:

```dotenv
WMS_SELLASIST_ENABLED=0
WMS_SELLASIST_ACCOUNT=twoje-konto
WMS_SELLASIST_API_KEY=uzupelnij-prawdziwym-kluczem
WMS_SELLASIST_USER_ID=2
WMS_SELLASIST_READY_STATUSES=10
WMS_SELLASIST_DISPATCH_DAYS=1
WMS_SELLASIST_CUTOFF_HOUR=14
WMS_SELLASIST_INTERVAL_MS=60000
```

Numery użytkownika i statusu powyżej są przykładami.
Wpisz rzeczywiste identyfikatory z obu systemów przed ustawieniem `ENABLED=1`.
Kilka statusów gotowych można oddzielić przecinkami.
Muszą oznaczać zamówienia zatwierdzone do fizycznej realizacji, także dla płatności za pobraniem.
Nie należy wskazywać statusu roboczych koszyków ani statusu oczekiwania na decyzję klienta.

Adres serwera powstaje jako `https://{konto}.sellasist.pl/api/v1`.
Nie przyjmuje dowolnego URL. Klucz pozostaje na serwerze i nie trafia do interfejsu, audytu ani bazy WMS.
Konta i ich uprawnienia są sprawdzane przy kolejnych zapisach integracji.

Po konfiguracji i restarcie API synchronizacja rusza automatycznie.
Pojedynczy cykl można uruchomić poleceniem:

```powershell
npm run wms:sellasist
```

Jedna dzierżawa w SQLite nie pozwala dwóm procesom synchronizować równocześnie tego samego konta.
W pierwszej próbie pozostaw automatyczne potwierdzanie wysyłek wyłączone.

## Co trafia do WMS

Numer zamówienia ma postać `SA-12345`.
Kanał tożsamości to `Sellasist/konto`, dzięki czemu numery różnych kont nie kolidują.
Raport sprzedażowych kanałów zachowuje dodatkowo źródło, np. `Sellasist/konto/allegro`.
Kartoteka musi jednoznacznie pasować do symbolu SKU z koszyka.
Brak SKU, nieznana część lub ułamkowa ilość zatrzymują dane zamówienie i tworzą komunikat.
Pozostałe poprawne zamówienia mogą zostać zaimportowane.

Adapter odrzuca pola adresowe, uwagi klienta, dane płatnicze i załączniki.
Nie przechowuje surowej odpowiedzi API.
Zamówienie trafia do kolejki nowych; biuro decyduje o rezerwacji dostępnego zapasu.

Jawny `deadline` Sellasist wyznacza dzień terminu.
Gdy go nie ma, termin wynika z daty zamówienia oraz `DISPATCH_DAYS`.
Ta liczba oznacza dni od poniedziałku do piątku; kalendarz świąt nie jest doliczany automatycznie.
Godzina odcięcia jest liczona w strefie `Europe/Warsaw`, z uwzględnieniem czasu letniego.
Uzgodnij te ustawienia z obietnicą wysyłki sklepu przed uruchomieniem produkcyjnym.

## Przerwanie i zmiany zamówień

Importer przechodzi przez strony po 100 numerów.
Wraca również do wcześniejszych numerów: stare zamówienie może dopiero dziś uzyskać status gotowy.
Nie używa nieodwracalnego kursora „najwyższy numer już widziany”.
Kursory są zapisywane, a tożsamość zamówienia i klucze ponowień chronią przed duplikatami po restarcie.

Otwarte zamówienia są ponownie porównywane ze sklepem.
Zmiana SKU, ilości, priorytetu lub terminu, a także niedopuszczalny status, wstrzymują realizację.
Dotyczy to również jednostronnej zmiany treści w WMS.
System zachowuje rzeczywiście pobrane ilości i nie udaje fizycznego zwrotu na półkę.

Zakładka **Integracja** pokazuje problemy oraz propozycję zmienionej treści.
**Otwórz zmiany do sprawdzenia** wypełnia formularz zamówienia; zapis wymaga świadomego zatwierdzenia.
Zmiana zwalnia stare rezerwacje i odłącza zamówienie od wózka.
Po rozpoczęciu zbiórki najpierw wstrzymaj pracę i odłóż wszystkie pobrane sztuki.
Zapis nie usuwa wstrzymania: biuro wznawia realizację po uzgodnieniu i rezerwuje towar ponownie.
Kolejny cykl potwierdza zgodność obu zapisów i usuwa problem integracji.

HTTP 429 wstrzymuje kolejne cykle zgodnie z odczytanym `Retry-After`, w granicach 1 minuty–24 godzin.
Błąd sieci lub autoryzacji nie zmienia stanów fizycznych.
Poszczególne fazy mają limity czasu, więc duży import nie zajmuje całego czasu przeznaczonego na kontrolę i eksport.

## Paczki i potwierdzenie wysłania

Etykiety nadal powstają i są drukowane w Sellasist lub jego integracji przewoźnika.
WMS nie kupuje etykiet ani nie rejestruje ponownie listów przewozowych.
Przed zatwierdzeniem paczki w WMS serwer pobiera aktualne zamówienie Sellasist.
Sprawdza jego status, SKU, ilości, termin oraz przynależność wszystkich zeskanowanych numerów paczek.

Wynik kontroli jest związany z kontem operatora, wersją zamówienia i całą treścią operacji wysyłki.
Zmiana numeru, masy lub innego pola wymaga nowego sprawdzenia.
Awaria Sellasist zatrzymuje potwierdzenie: zachowaj spakowaną paczkę i ponów tę samą operację.
Po utracie odpowiedzi WMS odtwarza już zapisany wynik bez zależności od dostępności sklepu.

Automatyczne potwierdzenie wysłania w Sellasist włącza dodatkowe ustawienie:

```dotenv
WMS_SELLASIST_SHIPPED_STATUS=20
```

Podaj rzeczywisty status wysłania, różny od wszystkich statusów gotowych.
Eksporter pobiera aktualne dane i ponownie sprawdza numery listów oraz treść zamówienia.
Wysyła wyłącznie status i `send_status_to_external=false`.
Nie zmienia adresu, koszyka, ceny ani danych płatności.
Po zapisie odczytuje potwierdzenie; utracona odpowiedź jest rozstrzygana przez kolejny odczyt.
Problematyczna paczka nie blokuje kolejnych zamówień w kolejce eksportu.

## Odbiór

`npm run test:wms` obejmuje stronę 1500 zamówień, późniejsze dopuszczenie starego numeru,
przerwany import, limity API, równoległy cykl, zmiany treści, kontrolę paczek i utratę odpowiedzi.
Te scenariusze używają kontrolowanych odpowiedzi zgodnych z opublikowanym kontraktem.
Nie wykonano operacji na rzeczywistym koncie Sellasist.

Przed produkcją sprawdź konfigurację statusów, rzeczywiste symbole SKU,
terminy, płatność za pobraniem, jedną paczkę i zamówienie wielopaczkowe.
Sprawdź także anulowanie w sklepie oraz zmianę pozycji podczas kompletacji.
Stan synchronizacji i ewentualne rozbieżności są widoczne w zakładce **Integracja**.
