---
rodzaj: minor
tytul: Copilot sam sprawdza bazę przy dopytaniu
---

**Copilot sam sprawdza bazę przy dopytaniu.** Do tej pory model odpowiadał
agentowi wyłącznie z faktów, które mu podaliśmy, albo z własnej pamięci.
Teraz ma pięć narzędzi tylko do odczytu naszej bazy: szukanie w kartotece
(także po numerze OEM), kartę towaru, pasowanie, części do maszyny i treść
naszych ofert z kopii w bazie. Sam decyduje, po co sięgnąć, najwyżej w pięciu
rundach. Pod odpowiedzią stoi linijka „Sprawdził w bazie: …”, więc agent
widzi, na czym odpowiedź stoi.

Narzędzia nie zapisują niczego i nie wołają sieci — ani Allegro, ani
Subiekta na żywo. Półka, opis kartoteki i dane klienta do modelu nie idą.
Twierdzenie oparte na niezatwierdzonej propozycji z bazy wiedzy serwer
obniża do „niepewne”. Koszt wszystkich rund liczy się w pomiarze Copilota,
także gdy dopytanie skończy się błędem.
