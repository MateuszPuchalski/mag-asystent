# Specyfikacja Sellasist REST API — kopia w repo

`api.yaml` to **cudzy plik**. Nie piszemy go, nie poprawiamy i nie
uzupełniamy. Leży tutaj, żeby kształt odpowiedzi Sellasist dawało się
sprawdzić odczytem, a nie pamięcią. Zasada ta sama co przy Allegro
(`docs/allegro/README.md`).

| co | wartość |
|---|---|
| źródło | `https://api.sellasist.pl/api.yaml` (strona dokumentacji to Swagger UI) |
| pobrał | sesja Claude Code, `curl` |
| data odczytu | 13 października 2026 |
| `info.version` | `1.92.4` |
| rozmiar | 531 KB, 16 489 linii |
| sha256 | `400197636ecd10eac8ba2b6e60ec79621cb422b69dc43de35b776e44eeb96e45` |

Sumę kontrolną sprawdza `tools/docs_check.py`. To czujnik, nie
zabezpieczenie: cudza poprawka wsunięta w środek pliku nie ma szans zostać
zauważona w przeglądzie zmian.

## Co trzeba wiedzieć, zanim się sięgnie po końcówkę

- Adres: `https://{konto}.sellasist.pl/api/v1`. Klucz w nagłówku `apiKey`,
  generowany w Sellasist w zakładce Integracje > Klucze API.
- Webhooków nie ma. Zmiany zbiera się odpytywaniem, z respektem dla 429.
- Lista zamówień (`GET /orders`) zwraca skrót. Koszyk, przesyłki i notatki
  daje dopiero szczegół (`GET /orders/{order_id}`) albo `GET /orders_with_carts`.
- `external_data.external_id` to numer zamówienia w źródle. Dla Allegro
  zakładamy UUID formularza zakupu, ale to obserwacja do potwierdzenia.

## Jak z tego korzystać

Plik ma 16 tysięcy linii, więc szuka się po nazwie:

```bash
grep -n "^  /orders" docs/sellasist/api.yaml       # ścieżki rodziny końcówek
grep -n "^    OrderDetails:" docs/sellasist/api.yaml # definicja schematu
```

Czytać trzeba schemat, nie przykład. Wymagalność pola mówi wyłącznie lista
`required`.

## Jak odświeżyć

1. Pobrać `https://api.sellasist.pl/api.yaml`.
2. Podmienić plik i policzyć `sha256sum docs/sellasist/api.yaml`.
3. Wpisać nową sumę, wersję i datę do tabeli wyżej.
4. Przeczytać różnicę na końcówkach, które wołamy: `adapters/sellasist.http.ts`.

## Czego ten plik NIE zastępuje

Specyfikacja mówi, jak Sellasist deklaruje odpowiedzi. Nie mówi, które pola
na koncie firmy bywają puste ani jakie statusy firma u siebie zdefiniowała.
Lista statusów jest per konto i czyta się ją z `GET /statuses`.
