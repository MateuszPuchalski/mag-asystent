# WMS — zakres i dowody odbioru

Gałąź: `codex/robust-wms`. Cel: 5000 SKU i 1500 zamówień dziennie.

Zachowujemy katalog, integracje Subiekta, przyjęcia, zwroty, konta i audyt.
Operacje WMS mieszkają w istniejącym `/biuro` oraz w API `/api/wms`.
Interfejs pozostaje polski i działa ze skanerem klawiaturowym.

## Kryteria odbioru

- Zamówienia: import, wyszukiwanie, terminy wysyłki, priorytety i anulowanie.
- Stany: lokalizacje, przyjęcia, przesunięcia, spis i niezmienny dziennik ruchów.
- Rezerwacje: transakcje, brak nadrezerwacji i pełne wycofanie przy niedoborze.
- Kompletacja: przypisanie osoby, pojemnik, kolejność lokalizacji i kontrola skanów.
- Wózki: do 12 zamówień na wspólnej trasie, atomowe przypisanie i kontrola docelowego pojemnika.
- Jakość: kwarantanna i zaplecze wyłączone z rezerwacji; jawne zwolnienie przez biuro.
- Pakowanie: niezależna kontrola SKU oraz ilości; wysyłka dopiero po sprawdzeniu całości.
- Wyjątki: braki, blokada, wznowienie, przejęcie i bezpieczny zwrot pobranego towaru.
- Analityka: przepływ zamówień, terminowość, czas realizacji, rotacja, zapasy i błędy.
- Bezpieczeństwo: role, walidacja, odporność na powtórzenia oraz konflikt wersji.
- Ergonomia: klawiatura, dotyk, telefon, widoczne błędy i zachowanie pracy po przerwie.
- Weryfikacja: testy usług/API, prawdziwy przebieg w przeglądarce i próba obciążenia.
- Eksploatacja: instrukcja uruchomienia, kopii, odtworzenia i granic integracji.

## Granica ewidencji

Subiekt pozostaje źródłem kartotek i dokumentów handlowych.
WMS prowadzi fizyczne ilości na lokalizacjach i rezerwacje zamówień.
Import Subiekta nie nadpisuje tych ilości. Otwarcie ewidencji wymaga jawnego spisu.
To zapobiega odtworzeniu sprzedanego zapasu przy kolejnym imporcie stanów ERP.
Różnice obu ewidencji wymagają raportu i uzgodnienia przed produkcyjnym uruchomieniem.

## Dowody i pozostały odbiór

Usługi i API pokrywają rezerwacje, skany, pakowanie, wyjątki, import partii i ewidencję lokalizacji.
Test dwóch procesów wyklucza podwójną rezerwację ostatniej sztuki.
Test kopii odtwarza całą bazę i sprawdza dziennik.
Test przeglądarki przechodzi od logowania do wysyłki, także po utracie odpowiedzi i odświeżeniu strony.
Widok 390 px nie ma poziomego przepełnienia.
Próba pojemności: 5000 SKU i 1500 pełnych zamówień; 16650 żądań przy 16 klientach.
Wynik próby wersji 0.285.0: 80,92 s, p95 95,63 ms, zgodny dziennik.
Raport 90 dni przy 136500 zamówieniach, 1229000 ruchów i 1506501 zdarzeń audytu: 1331 ms.
Pełny zestaw serwera wersji 0.285.0: 2160 testów, zero błędów. Panel: 727 testów po scaleniu main (`9dd4000`).
Build produkcyjny przechodzi również test przeglądarki, wraz z wygaśnięciem sesji podczas ponowienia skanu.
Aktualny audyt zależności produkcyjnych: zero zgłoszonych podatności.
Zapis wyników: `docs/wms-evidence.json`; scenariusze i zrzuty można odtworzyć przez `tools/wms-e2e.mjs`.

## Samodzielny WMS i zakres seeded

Decyzja właściciela: system ma zastąpić Sellasist, a obecny odbiór używa wyłącznie danych seeded.
Usunięto konektor, zadania synchronizacji, ekran integracji oraz warunek zewnętrznego potwierdzenia wysyłki.
Zamówienia powstają i zmieniają się bezpośrednio w WMS.
Rejestr paczek zapewnia wyszukiwanie, masę, liczniki oraz eksport dzienny CSV.
Test API przechodzi całe zamówienie wielopaczkowe przy zabronionych wywołaniach sieciowych.

Nowa baza nie tworzy tabel dawnego konektora.
Istniejące tabele testowych baz pozostają nieaktywne; migracja nie kasuje zapisanych danych.
Historyczne wstrzymania wymagają jawnego wznowienia przez biuro, tak jak inne blokady.
Demo z opcją `--scale` zawiera 5000 SKU i 1500 zamówień na różnych etapach.

Otwarcie 5000 SKU przechodzi jako jeden dokument przyjęcia lub spisu z arkusza.
Testy sprawdzają wycofanie całej partii po błędzie ruchu oraz po zmianie wersji zapasu.
Przeglądarka odrzuca stary podgląd po edycji i rozpoznaje już zapisany numer dokumentu.
Ostatni pomiar wydajności pochodzi z wersji 0.285.0 i obejmuje również historię ruchów oraz audytu.

## CI i przegląd zmiany

Zmiana jest dostępna w [szkicu PR #415](https://github.com/MateuszPuchalski/mag-asystent/pull/415).
Commit `5698856` przeszedł testy WMS, build i przeglądarkę na Windows oraz Linux.
Przeszły też pełne bramki serwera, panelu, instalatora, workera Sfery i Androida z budową APK debug.
Źródło: [WMS CI](https://github.com/MateuszPuchalski/mag-asystent/actions/runs/34537559134)
i [serwer/panel CI](https://github.com/MateuszPuchalski/mag-asystent/actions/runs/34537559099).
Szkic służy przeglądowi samodzielnego WMS na danych seeded.

Powtórzony przebieg Windows dla `6b117d2` ujawnił wyścig formularza pakowania z odczytem po zapisie.
Wersja 0.271.1 utrzymuje blokadę formularza do końca odczytu i usuwa stary formularz po błędzie odczytu.
Kontrolowane opóźnienie odtworzyło błąd przed poprawką; po poprawce przechodzi wraz z próbą awarii odczytu.
Aktualny stan kolejnych przebiegów jest widoczny w kontrolach PR.

Ograniczenia integracji i instrukcja odbioru stoją w `docs/wms.md`.
Rzeczywiste integracje, dokumenty ERP i sprzęt pozostają poza bieżącym zakresem seeded.
Nowy WMS pracuje w przeglądarce; natywne ekrany kompletacji Androida nie zostały dodane.
