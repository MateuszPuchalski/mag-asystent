---
rodzaj: minor
tytul: aktualizacja tego samego dnia, paczka dopiero po zielonych testach
---

**Serwer aktualizuje się tego samego dnia, nie w nocy.** Domyślny tryb
produkcji to `zaraz`: nowe wydanie wchodzi, gdy ma co najmniej godzinę i przez
dziesięć minut nikt nic nie zapisał. Decyzja właściciela z wywiadu
o wdrażaniu: jedna zmiana, dwie minuty postoju o każdej porze są do przyjęcia,
zmiana ma dojść w ciągu dnia. Tryb `noc` zostaje w konfiguracji.

**Paczka wydania powstaje dopiero po zielonym „Serwer" na commicie wydania**
(`paczka.yml` przez `workflow_run`). Kodu przed scaleniem nikt nie czyta, więc
testy tego commita są jedynym dowodem, że działa. Wersja z czerwonymi testami
nie dostaje paczki i serwer jej nie wgra.
