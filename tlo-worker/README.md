# Usługa tła — zdjęcie kartoteki bez tła (C#/.NET)

Czwarty proces WERTIS: przyjmuje zdjęcie po HTTP z pętli lokalnej i oddaje PNG
z alfą. Kontrakt: [`server/src/adapters/tlo.ts`](../server/src/adapters/tlo.ts).

| trasa | wejście | wyjście |
|---|---|---|
| `POST /tlo` | JPEG albo PNG w ciele żądania | `200` PNG z alfą, `422` gdy na zdjęciu nie widać przedmiotu |

`422` nie jest awarią: zdjęcie regału z kartonami wygląda dla modelu jak
zdjęcie noża. Serwer pokazuje wtedy podgląd z tłem i „ZOSTAW TŁO”.

## Dlaczego osobny proces

Model chodzi na runtime ONNX, czyli na module natywnym. Serwer nie ma modułów
natywnych, bo instaluje się go bez kompilatora na maszynie biura. Wzorzec jak
w `sfera-worker/`: samowystarczalny exe pod `nssm`, domyślnie wyłączony. Bez
usługi zdjęcia zapisują się z tłem, a nie przestają się zapisywać.

## Wymagania

| co | po co |
|---|---|
| Windows | wydanie jest samowystarczalne, więc runtime .NET jedzie w exe |
| plik modelu `.onnx` | wycinanie tła; pobiera go `build.ps1` |
| `TLO_URL` w `wertis.env` | ten sam klucz czyta serwer; bez niego proces odmawia startu |

Modelu **nie ma w repozytorium** (binaria bez przeglądu i różnic). `build.ps1`
pobiera go i sprawdza sumę SHA-256; niezgodna suma zatrzymuje budowanie.

## Budowa i wdrożenie

Build wymaga **.NET 8 SDK**, nie Runtime:
`winget install Microsoft.DotNet.SDK.8`, potem nowe okno i `dotnet --version`.
SDK idzie na maszynę dewelopera, **nie na serwer firmy**: `--self-contained`
wkłada runtime do exe. `C:\wertis\tlo-worker` to katalog docelowy, nie roboczy.

**`-ExecutionPolicy Bypass` nie jest ozdobnikiem.** Windows domyślnie odmawia
uruchomienia skryptu („running scripts is disabled on this system”). Bypass
dotyczy tego jednego uruchomienia; polityka systemowa zostaje nietknięta.

```powershell
# maszyna z .NET 8 SDK (NIE serwer firmy); ścieżka względna wobec katalogu:
powershell -NoProfile -ExecutionPolicy Bypass -File tlo-worker\build.ps1  # z korzenia repo
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1              # z katalogu tlo-worker
# → tlo-worker\publish\wertis-tlo-worker.exe, tlo-worker\publish\model\u2netp.onnx

# serwer firmy:
#  1. skopiuj CAŁY katalog publish do C:\wertis\tlo-worker\
#  2. dopisz do C:\wertis\wertis.env:  TLO_URL=http://127.0.0.1:8791
#  3. zarejestruj usługę:
nssm install wertis-tlo C:\wertis\tlo-worker\wertis-tlo-worker.exe
#  4. zrestartuj usługę wertis-api (czyta ten sam plik konfiguracji)
```

Instalator tej usługi nie zakłada, ale aktualizacja zatrzymuje ją na czas
zamiany katalogów. Bramki wdrożenia: [`DEPLOY.md`](../DEPLOY.md) §6, etap 2a.

## Konfiguracja — ten sam `wertis.env` co pozostałe procesy

Kolejność szukania: `WERTIS_ENV_FILE` → katalog exe → katalog wyżej
(`C:\wertis`) → bieżący. Zmienna środowiskowa wygrywa z plikiem.

| klucz | domyślnie | rola |
|---|---|---|
| `TLO_URL` | brak | adres nasłuchu; pusty = proces odmawia startu |
| `TLO_MODEL` | `model\u2netp.onnx` obok exe | plik modelu |
| `TLO_BOK` | `1024` | dłuższy bok zapisywanego zdjęcia |

`TLO_TIMEOUT_MS` czyta wyłącznie serwer — to jego cierpliwość, nie usługi.

## Flagi

| flaga | działanie |
|---|---|
| `--dry-run` | odpowiada `422` na każde zdjęcie, bez modelu i bez pliku `.onnx` |
| `--once` | jedno żądanie i wyjście — do testów |

`--dry-run` odpowiada jak model, który nie znalazł przedmiotu, a **nie**
udanym wycięciem: łańcuch aż do „ZOSTAW TŁO” przechodzi bez modelu i bez
nieprawdy o zdjęciu.

## Model

Domyślny jest **u2netp**: mała odmiana U^2-Net, licencja Apache-2.0, około
4,7 MB, dobry na towarze sfotografowanym na blacie. Przy zagraconym tle lepszy
jest **isnet-general-use** (około 176 MB), wskazywany kluczem `TLO_MODEL` bez
przebudowy exe. Oba mają wejście 320 × 320 i to samo przetwarzanie wstępne.

Wejście `u2netp.onnx` to `input.1` (1 × 3 × 320 × 320, NCHW float32), maską
jest pierwsze z siedmiu wyjść, a graf kończy się sigmoidą. Nazwę wejścia kod
bierze z metadanych sesji, więc podmiana modelu nie zmienia `UsuwanieTla.cs`.
Sumę potwierdziły trzy niezależne odczyty ([`build.ps1`](build.ps1)); dowodzą
one zgodności bajtów z wydawcą, nie jakości modelu.

## `[WERYFIKUJ]` — co zostaje

Jakość wycięcia na **towarze magazynowym**: model uczono na zdjęciach ogólnych,
a rozstrzygną to tylko zdjęcia z hali. Dlatego jest „ZOSTAW TŁO”, a model
podmienia się kluczem `TLO_MODEL`.
