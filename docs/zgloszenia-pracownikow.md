# Zgłoszenia pracowników

Pracownik zgłasza z każdego ekranu panelu i kolektora, co mu przeszkadza,
czego brakuje albo co nie działa. Dokłada do czterech zdjęć. Zgłoszenia czyta
właściciel (rola `admin`) w menu „Więcej” panelu i odpowiada krótkim zdaniem.

Wchodzi w wydaniu 0.620.0.

## Po co

Uwagi z hali i biura giną dziś w rozmowie przy kawie. Właściciel słyszy
o irytacji wtedy, gdy pracownik już się do niej przyzwyczaił. Przycisk na
każdym ekranie łapie uwagę w chwili, gdy przeszkadza, razem z adresem ekranu.

## Decyzje właściciela

- Przycisk stoi w panelu i na kolektorze.
- Listę czyta tylko `admin`. Biuro i magazyn zgłaszają, ale cudzych zgłoszeń
  nie widzą, bo uwaga o koledze albo o szefie ma być bezpieczna.
- Zdjęcia dokłada się ręcznie. Panel nie robi sam zrzutu ekranu, bo na
  zrzucie stałyby dane kupujących, a zgłoszenie ich nie potrzebuje.

## Co zapisujemy

Opis, rodzaj, adres ekranu, źródło, wersję aplikacji, urządzenie kolektora,
autora i czas. Adres ekranu nie niesie danych klienta. Zapisuje się jako
ścieżka bez zapytania (`/obsluga/zwroty`, nie `?szukaj=Kowalski`), bo
zapytanie niesie to, czego pracownik szukał. Profil klienta traci login:
zostaje `/obsluga/klient/:login`, bo login Allegro jest kluczem kupującego.

Opis i zdjęcia to treść pracownika i mogą nieść dane kupującego. Zdjęcie
paczki złapie adres z etykiety, a opis bywa przepisanym numerem zamówienia.
Dlatego listę czyta tylko właściciel. Zgłoszenia i zdjęcia trzymamy bez
terminu, jak zdjęcia zadań terenowych. Termin kasowania to decyzja właściciela.

## Kontrakt API

Wszystkie pola po polsku w camelCase, jak w reszcie API.

### `POST /api/zgloszenia` — złożenie

Każda zalogowana sesja: panel i kolektor, każda rola. `bodyLimit` 6 MiB.

```json
{
  "rodzaj": "pomysl" | "przeszkadza" | "blad",
  "opis": "1–4000 znaków po przycięciu",
  "ekran": "ścieżka albo nazwa ekranu, do 200 znaków, bez ?query",
  "zrodlo": "panel" | "kolektor",
  "wersja": "np. 0.618.0, do 40 znaków, opcjonalne",
  "zdjecia": ["base64 JPEG, opcjonalnie z prefiksem data:image/...;base64,"]
}
```

- `zdjecia`: najwyżej 4, każde najwyżej 1024 kB po zdekodowaniu. Cztery
  po 1024 kB to w base64 około 5,4 MiB, więc mieszczą się w 6 MiB ciała.
  Klient zmniejsza zdjęcie przed wysyłką do dłuższego boku 1600 px, JPEG
  jakości około 0,8. To zwykle 200–400 kB.
- Serwer obcina `ekran` od pierwszego `?` albo `#`. Login w ścieżce profilu
  klienta zamienia na `:login`, choć panel robi to samo przed wysyłką.
- Zdjęcie musi być JPEG-iem (sygnatura `FF D8 FF`), bo trasa oddaje je jako
  `image/jpeg` z `nosniff`. Inny plik dostaje `400`.
- Urządzenie kolektora serwer bierze z sesji albo nagłówka `x-device`, nie
  z ciała.
- Odpowiedź `200`: `{ "zgloszenie": Zgloszenie }`. Błąd walidacji `400`
  z `{ "error": "zdanie po polsku" }`.
- Zapis jest atomowy: zgłoszenie i zdjęcia albo nic.
- `logEvent("zgloszenie_pracownika", autor, null, { id, rodzaj, zrodlo })`.

### `GET /api/zgloszenia/moje` — moje zgłoszenia

Każda zalogowana sesja. Ostatnie 20 zgłoszeń autora, najnowsze pierwsze:
`{ "zgloszenia": Zgloszenie[] }`. Pracownik widzi tu status i odpowiedź.

### `GET /api/obsluga/zgloszenia?status=nowe` — lista właściciela

Tylko `admin`, inaczej `403`. `status` opcjonalny. Odpowiedź:

```json
{
  "zgloszenia": [Zgloszenie],
  "liczniki": { "nowe": 0, "przyjete": 0, "zrobione": 0, "odrzucone": 0 }
}
```

### `GET /api/obsluga/zgloszenia/:id/zdjecie/:zid` — zdjęcie

Tylko `admin`. `image/jpeg`, `cache-control: private, max-age=31536000,
immutable`. Brak wiersza albo pliku: `404`.

### `POST /api/obsluga/zgloszenia/:id/status` — decyzja

Tylko `admin`. Ciało `{ "status": "przyjete" | "zrobione" | "odrzucone" |
"nowe", "odpowiedz": "do 1000 znaków, opcjonalne" }`. Odpowiedź
`{ "zgloszenie": Zgloszenie }`. `logEvent("zgloszenie_pracownika_status", ...)`.

### Kształt `Zgloszenie`

```json
{
  "id": 1,
  "rodzaj": "przeszkadza",
  "opis": "…",
  "ekran": "/obsluga/zwroty",
  "zrodlo": "panel",
  "wersja": "0.618.0",
  "urzadzenie": "TC21-03",
  "at": "2026-11-05T12:00:00.000Z",
  "autor": "Jan",
  "status": "nowe",
  "odpowiedz": null,
  "statusAt": null,
  "statusPrzez": null,
  "zdjecia": [{ "id": 7 }]
}
```

Adres zdjęcia składa klient z `id` zgłoszenia i `id` zdjęcia. W `moje`
lista `zdjecia` niesie same identyfikatory, bez trasy dla autora.
