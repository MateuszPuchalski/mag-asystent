# Budowa usługi usuwania tła: jeden samowystarczalny exe dla Windows x64
# plus plik modelu obok niego.
#
# Wymaga .NET 8 SDK — na maszynie dewelopera, NIE u klienta. Ta sama reguła
# i to samo uzasadnienie co w sfera-worker\build.ps1.
#
# MODEL NIE LEŻY W REPOZYTORIUM (kilka MB binariów, których nie da się
# przeglądać ani różnicować) — pobiera go ten skrypt i sprawdza sumę
# kontrolną. Bez sprawdzenia sumy byłby to plik z internetu uruchamiany
# na maszynie z bazą Subiekta.
#
# ŚCIEŻKA JEST WZGLĘDNA WOBEC KATALOGU, W KTÓRYM STOISZ. Sam skrypt liczy swój
# katalog z $MyInvocation i działa z dowolnego miejsca — myli się tylko to, co
# podasz do -File. Stąd obie drogi wypisane wprost:
#
# Użycie:  powershell -NoProfile -ExecutionPolicy Bypass -File tlo-worker\build.ps1
#          powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
#          (pierwsze z korzenia repozytorium, drugie z katalogu tlo-worker)
#
# -ExecutionPolicy Bypass NIE JEST OZDOBNIKIEM. Windows domyślnie odmawia
# uruchomienia skryptu pobranego z sieci — „running scripts is disabled on this
# system". Bypass dotyczy TEGO JEDNEGO uruchomienia; polityka systemowa zostaje
# nietknięta. Ta sama reguła i to samo zdanie co w instalator/README.md.
#
# NIE buduj w C:\wertis\tlo-worker — to katalog docelowy na serwerze firmy,
# a nie miejsce pracy. Build idzie z repozytorium na maszynie dewelopera.
#
# Wynik:   tlo-worker\publish\wertis-tlo-worker.exe
#          tlo-worker\publish\model\u2netp.onnx
#          → skopiuj CAŁY katalog publish do C:\wertis\tlo-worker\

$ErrorActionPreference = "Stop"
$katalog = Split-Path -Parent $MyInvocation.MyCommand.Path
$publish = Join-Path $katalog "publish"

# u2netp — mała odmiana U^2-Net (Apache-2.0), ~4,7 MB. Wydanie `rembg`, bo
# tam modele mają stałe adresy i podane sumy. Większy `isnet-general-use`
# (~176 MB) radzi sobie lepiej z zagraconym tłem; wskazuje się go kluczem
# TLO_MODEL w wertis.env, bez przebudowy.
$modelUrl = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"  # [WERYFIKUJ]

# [WERYFIKUJ] — SUMA JEST PUSTA I TO JEST STAN ZAMIERZONY.
#
# Repozytorium nie zna sumy pliku, którego nie zawiera. Wpisanie tu liczby
# „z pamięci" byłoby gorsze niż jej brak: sprawdzenie przechodziłoby, nie
# sprawdzając niczego. Pierwsza osoba budująca wydanie pobiera model, PORÓWNUJE
# sumę ze źródłem u wydawcy i wpisuje ją tutaj — od tej chwili pilnuje jej
# każdy kolejny build. Do tego czasu skrypt odmawia i mówi, czego brakuje.
$modelSha = ""

dotnet publish (Join-Path $katalog "WertisTloWorker.csproj") `
    -c Release -r win-x64 --self-contained `
    -p:PublishSingleFile=true `
    -o $publish

$katalogModelu = Join-Path $publish "model"
New-Item -ItemType Directory -Force -Path $katalogModelu | Out-Null
$plikModelu = Join-Path $katalogModelu "u2netp.onnx"

if (-not (Test-Path $plikModelu)) {
    Write-Host "Pobieram model: $modelUrl"
    Invoke-WebRequest -Uri $modelUrl -OutFile $plikModelu
}

$suma = (Get-FileHash -Path $plikModelu -Algorithm SHA256).Hash.ToLower()

if ([string]::IsNullOrWhiteSpace($modelSha)) {
    Remove-Item $plikModelu -Force
    throw @"
Suma kontrolna modelu nie jest jeszcze ustalona (`$modelSha w tym skrypcie jest puste).
Pobrany plik miał sumę: $suma
Porównaj ją z sumą podaną przez wydawcę modelu, wpisz do `$modelSha i uruchom build ponownie.
Plik usunięto — nie kopiujemy na serwer firmy binariów, których nikt nie sprawdził.
"@
}

if ($suma -ne $modelSha.ToLower()) {
    # Rozbieżność sumy to NIE jest ostrzeżenie. Plik idzie na maszynę z bazą
    # firmy i uruchamia się na niej jako kod — nie kopiujemy go „na razie".
    Remove-Item $plikModelu -Force
    throw "Suma kontrolna modelu się nie zgadza (jest $suma, ma być $modelSha). Plik usunięto."
}

Write-Host ""
Write-Host "Gotowe: $(Join-Path $publish 'wertis-tlo-worker.exe')"
Write-Host "Skopiuj CAŁY katalog publish do C:\wertis\tlo-worker\ — DEPLOY.md §6, etap 2a."
