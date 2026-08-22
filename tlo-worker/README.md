# Usługa tła — zdjęcie kartoteki bez tła (C#/.NET)

Czwarty proces WERTIS, obok `wertis-api`, `wertis-worker` i `wertis-sfera`.
Przyjmuje jedno zdjęcie po HTTP z pętli lokalnej i oddaje PNG z przezroczystością.

| trasa | wejście | wyjście |
|---|---|---|
| `POST /tlo` | JPEG albo PNG w ciele żądania | `200` PNG z alfą, `422` gdy na zdjęciu nie widać przedmiotu |

`422` nie jest awarią. Zdjęcie regału z pięcioma kartonami wygląda dla modelu
tak samo jak zdjęcie noża. Serwer zamienia tę odpowiedź na podgląd z tłem
i przycisk „ZOSTAW TŁO" — decyzję podejmuje człowiek przy regale.

Kontrakt, z którego wynika ten kod: [`server/src/adapters/tlo.ts`](../server/src/adapters/tlo.ts).

## Dlaczego osobny proces

Model chodzi na runtime ONNX, czyli na module natywnym. Serwer WERTIS ma dwie
zależności i zero modułów natywnych. To reguła powtórzona w czterech plikach
i jej powodem jest maszyna: serwer stoi tam, gdzie biuro wystawia faktury,
i ma się dać zainstalować bez kompilatora.

Wzorzec na taki przypadek repozytorium już ma. `sfera-worker/` to trzeci proces,
samowystarczalny exe pod `nssm`, domyślnie wyłączony. Ten jest czwarty i działa
tak samo: bez niego zdjęcia zapisują się z tłem, a nie przestają się zapisywać.

## Wymagania

| co | po co |
|---|---|
| Windows z .NET | wydanie jest samowystarczalne, więc runtime jedzie w exe |
| plik modelu `.onnx` | wycinanie tła; pobiera go `build.ps1` |
| `TLO_URL` w `wertis.env` | ten sam klucz czyta serwer; bez niego proces odmawia startu |

Modelu **nie ma w repozytorium** — to kilka megabajtów binariów, których nie da
się przeglądać ani różnicować. Tak samo jest z AAR-em Honeywella w kolektorze.

## Budowa i wdrożenie

**Przy pierwszym budowaniu skrypt odmówi — i to jest krok procedury, nie awaria.**
Suma kontrolna modelu jest w nim pusta, bo repozytorium nie zna sumy pliku,
którego nie zawiera. Skrypt pobiera model, wypisuje jego sumę i każe ją porównać
ze źródłem u wydawcy. Wpisana suma pilnuje każdego następnego budowania.

Odmowa przychodzi **po** `dotnet publish`, czyli po kilku minutach. Inaczej się
nie da: żeby policzyć sumę pliku, trzeba go najpierw pobrać.

Buduje się **z repozytorium na maszynie dewelopera**, nigdy w `C:\wertis\tlo-worker`
— to katalog docelowy na serwerze firmy.

**`-ExecutionPolicy Bypass` nie jest ozdobnikiem.** Windows domyślnie odmawia
uruchomienia skryptu słowami „running scripts is disabled on this system".
Bypass dotyczy **tego jednego uruchomienia**; polityka systemowa zostaje
nietknięta. Ta sama reguła co przy instalatorze.

```powershell
# maszyna z .NET 8 SDK (deweloper — NIE serwer firmy).
# Ścieżka jest względna wobec katalogu, w którym stoisz — stąd dwie drogi:
powershell -NoProfile -ExecutionPolicy Bypass -File tlo-worker\build.ps1  # z korzenia repo
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1              # z katalogu tlo-worker
# → tlo-worker\publish\wertis-tlo-worker.exe  (samowystarczalny, win-x64)
# → tlo-worker\publish\model\u2netp.onnx

# serwer firmy:
#  1. skopiuj CAŁY katalog publish do C:\wertis\tlo-worker\
#  2. dopisz do C:\wertis\wertis.env:  TLO_URL=http://127.0.0.1:8791
#  3. zarejestruj usługę:
nssm install wertis-tlo C:\wertis\tlo-worker\wertis-tlo-worker.exe
#  4. zrestartuj usługę wertis-api (czyta ten sam plik konfiguracji)
```

Kolejność i bramki wdrożenia — [`DEPLOY.md`](../DEPLOY.md) §6, etap 2a.

## Konfiguracja — ten sam `wertis.env` co pozostałe procesy

Szuka pliku: `WERTIS_ENV_FILE` → katalog exe → katalog wyżej (`C:\wertis`) →
bieżący. Zmienna środowiskowa wygrywa z plikiem, jak w Node.

| klucz | domyślnie | rola |
|---|---|---|
| `TLO_URL` | brak | adres nasłuchu; pusty = proces odmawia startu |
| `TLO_MODEL` | `model\u2netp.onnx` obok exe | plik modelu |
| `TLO_BOK` | `1024` | dłuższy bok zapisywanego zdjęcia |

`TLO_TIMEOUT_MS` czyta wyłącznie serwer — to jego cierpliwość, nie nasza.

## Flagi

| flaga | działanie |
|---|---|
| `--dry-run` | odpowiada `422` na każde zdjęcie, bez modelu i bez pliku `.onnx` |
| `--once` | jedno żądanie i wyjście — do testów |

`--dry-run` odpowiada tak, jak gdyby model nie znalazł przedmiotu, a **nie**
udanym wycięciem. Cały łańcuch — kolektor, podgląd, przycisk „ZOSTAW TŁO" —
da się dzięki temu przejść bez modelu, a żadne ogniwo nie usłyszy nieprawdy
o tym, co się z jego zdjęciem stało.

## Wybór modelu

Domyślny jest **u2netp** — mała odmiana U^2-Net, licencja Apache-2.0, około
4,7 MB. Na towarze sfotografowanym na blacie radzi sobie dobrze.

Przy zagraconym tle lepszy jest **isnet-general-use** (około 176 MB). Wskazuje
się go kluczem `TLO_MODEL`, bez przebudowy exe. Oba mają wejście 320 × 320
i to samo przetwarzanie wstępne, więc podmiana jest naprawdę podmianą pliku.

## `[WERYFIKUJ]` — do potwierdzenia na pobranym pliku

Wszystko, co dotyczy modelu, siedzi w jednym pliku
[`src/UsuwanieTla.cs`](src/UsuwanieTla.cs) i jest oznaczone `[WERYFIKUJ]`
(konwencja repo — wartość do potwierdzenia na własnym systemie):

1. Nazwa i kształt wejścia (u2netp: `input`, 1 × 3 × 320 × 320, NCHW float32).
2. Który tensor wyjściowy jest maską. U^2-Net oddaje siedem map (`d0`…`d6`);
   pierwsza jest tą właściwą, reszta to wyjścia pośrednie warstw.
3. Czy wyjście przeszło już przez sigmoidę. Eksporty z `rembg` — tak.
4. Adres pobrania i suma kontrolna modelu w [`build.ps1`](build.ps1).

Jakość wycięcia na **towarze magazynowym** jest osobnym `[WERYFIKUJ]`. Model
uczono na zdjęciach ogólnych, nie na częściach do kosiarek. Dlatego w kolektorze
stoi przycisk „ZOSTAW TŁO", a model da się podmienić jednym plikiem.
