---
rodzaj: patch
tytul: narzędzie do anonimizacji w paczce poza katalogiem tools
---

Paczka wydania 0.550.3 niosła katalog `tools`, a aktualizacja przenosi ze starej instalacji katalog `tools` z `nssm.exe`. Przy istniejącym katalogu docelowym PowerShell wkłada źródło do środka, więc `nssm.exe` lądował by w `tools\tools`, a usługi nie wstawałyby. Narzędzie do anonimizacji jedzie teraz w katalogu `narzedzia`, którego aktualizacja nie dotyka. Próba paczki pilnuje, żeby nazwy z listy przenoszonej nigdy nie trafiły do paczki.
