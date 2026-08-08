# Budowa workera Sfery: jeden samowystarczalny exe dla Windows x64.
#
# Wymaga .NET 8 SDK — na maszynie dewelopera, NIE u klienta. Wynikowy exe
# niesie w sobie runtime i natywny sqlite3, więc na serwerze firmy nie trzeba
# instalować niczego. To świadome odejście od build-on-site reszty repo
# (npm ci u klienta działa, bo ciągnie z locka; restore NuGet w trakcie
# wdrożenia byłby drugim, innym mechanizmem pobierania i drugim punktem
# awarii dokładnie wtedy, kiedy nikt nie ma czasu na diagnozę).
#
# Użycie:  powershell -File sfera-worker\build.ps1
# Wynik:   sfera-worker\publish\wertis-sfera-worker.exe
#          → skopiuj do C:\wertis\sfera-worker\ (instalator rejestruje usługę
#            tylko, gdy exe tam leży — patrz instalator/README.md)

$ErrorActionPreference = "Stop"
$katalog = Split-Path -Parent $MyInvocation.MyCommand.Path

dotnet publish (Join-Path $katalog "WertisSferaWorker.csproj") `
    -c Release -r win-x64 --self-contained `
    -p:PublishSingleFile=true `
    -o (Join-Path $katalog "publish")

Write-Host ""
Write-Host "Gotowe: $(Join-Path $katalog 'publish\wertis-sfera-worker.exe')"
Write-Host "Skopiuj do C:\wertis\sfera-worker\ i uruchom instalator (albo nssm) — DEPLOY §6, etap 2."
