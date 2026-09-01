# Specyfikacja Allegro REST API — kopia w repo

`swagger.yaml` to **cudzy plik**. Nie piszemy go, nie poprawiamy i nie
uzupełniamy. Leży tutaj po to, żeby kształt odpowiedzi Allegro dawało się
sprawdzić bez wychodzenia do sieci.

| co | wartość |
|---|---|
| źródło | `https://developer.allegro.pl/swagger.yaml` |
| pobrał | właściciel, przeglądarką |
| data odczytu | 1 września 2026 |
| `info.version` | `latest` (Allegro nie wersjonuje tego pliku) |
| rozmiar | 1,5 MB, 40 842 linie |
| sha256 | `4f45adc25258223c71f980bca8ba5829f6ed133b68c890abe43c08ec340cbf5d` |

Sumę kontrolną sprawdza `tools/docs_check.py`. Nie chodzi o bezpieczeństwo,
tylko o to, żeby cudzy plik nie zmienił się po cichu przy okazji czyjejś
poprawki — a przy 40 tysiącach linii nikt takiej zmiany nie zobaczy w code
review.

## Po co to tu leży

Trzy razy z rzędu mapowanie Allegro powstawało ze zgadywania, bo
`developer.allegro.pl` jest nieosiągalny z maszyny, na której pisze się kod.
Za każdym razem kosztowało to wydanie, a raz — dwa wydania i skrzynkę, która
nie zapisała ani jednego wątku. Historię opisuje preambuła
`docs/allegro-ksztalt.md`.

Ten plik zamyka tamtą przyczynę. Kształt pola sprawdza się teraz odczytem, a
nie pamięcią.

## Jak z tego korzystać

Plik ma 40 tysięcy linii, więc **nie czyta się go w całości**. Szuka się
schematu po nazwie:

```bash
grep -n "^    Thread:" docs/allegro/swagger.yaml     # definicja schematu
grep -n "^  /messaging" docs/allegro/swagger.yaml    # ścieżki rodziny końcówek
```

Czytać trzeba **schemat**, nie przykład. Przykłady w tym pliku bywają
niezgodne z własnym schematem: `Thread.read` ma `type: boolean`, a przykład
obok renderuje `'false'` jako tekst. Wymagalność pola mówi wyłącznie lista
`required`.

Uwaga na dwie wersje zasobu. `public.v1` i `beta.v1` to bywają **różne
kształty tej samej rzeczy**, a nie warianty. W Centrum wiadomości różnią się
autorem wiadomości, stronicowaniem i polami wątku. Chodzimy wersją stabilną —
patrz `zapytajAllegro` w `server/src/adapters/allegro.http.ts`.

## Jak odświeżyć

1. Pobrać `https://developer.allegro.pl/swagger.yaml` przeglądarką.
2. Podmienić plik i policzyć `sha256sum docs/allegro/swagger.yaml`.
3. Wpisać nową sumę i datę do tabeli wyżej.
4. Sprawdzić różnicę na sekcjach, które mapujemy, i dopisać zmiany do
   `docs/allegro-ksztalt.md`.

Krok czwarty jest tym, po co to wszystko. Sama podmiana pliku niczego nie
naprawia; naprawia dopiero przeczytanie różnicy.

## Czego ten plik NIE zastępuje

Specyfikacja mówi, jak Allegro **deklaruje** swoje odpowiedzi. Nie mówi, co
konto firmy naprawdę dostaje: które pola bywają puste, jakie wartości
wyliczeniowe wchodzą w grę u nas i czy uprawnienia sięgają danej końcówki.

Na to odpowiada `npm run sonda`, która nadal nie pobiegła na żywym koncie.
Znaczniki `[WERYFIKUJ]` zdejmuje właśnie ona, a nie ten plik.
