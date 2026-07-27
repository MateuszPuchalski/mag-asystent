@echo off
rem  Uruchomienie instalatora WERTIS z pominieciem polityki wykonywania skryptow.
rem
rem  Windows domyslnie odmawia uruchomienia plikow .ps1 (Restricted) i probe
rem  `.\wertis-instalator.ps1` konczy blad "running scripts is disabled on this
rem  system". Obejscie jest w instalator/README.md, ale trafia sie na nie ZANIM
rem  sie tam zajrzy — stad ten plik.
rem
rem  Bypass dotyczy WYLACZNIE tego jednego uruchomienia; polityka systemowa
rem  zostaje nietknieta.
rem
rem  Instalator wymaga uprawnien administratora — kliknij prawym i wybierz
rem  "Uruchom jako administrator". Bez tego sam sie zatrzyma z komunikatem.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wertis-instalator.ps1" %*

if errorlevel 1 (
  echo.
  echo Instalator zakonczyl sie bledem — przewin wyzej po szczegoly.
)
echo.
pause
