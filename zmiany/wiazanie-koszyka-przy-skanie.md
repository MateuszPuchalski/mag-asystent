---
rodzaj: patch
tytul: koszyk wiąże się z dokumentem MM przy skanie, nie co minutę
---

Koszyk wirtualny dostaje swój dokument MM w chwili, gdy hala skanuje kartkę
albo etykietę koszyka. Worker nie przegląda już koszyków co minutę. Znika
wyścig z halą i wpis „Wiązanie kosza pominięte", który przy starych
sobowtórach powtarzał się w dzienniku co minutę. Skan etykiety `Z-…`
otwiera koszyk, gdy jego MM jest już w Subiekcie, zamiast odsyłać do numeru
z kartki. Lista przyjęć pokazuje dokument koszyka jako nietknięty aż do skanu.
