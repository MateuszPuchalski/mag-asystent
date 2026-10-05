---
rodzaj: minor
tytul: dobór części i baza wiedzy usunięte w całości
---

**Zakładka Wiedza i dobór części zniknęły.** Właściciel zdecydował, że oba
stały na chwiejnym fundamencie, więc wychodzą w całości. Rozmowa w skrzynce
nie ma już zakładki doboru ani stanu doboru na wierszu kolejki. Analiza nie ma
miar doboru, a Ustawienia — pokrycia wiedzy i listy „Co automat dopisał".

**Copilot pisze szkic z rozmowy, oferty, zamówienia i kartoteki.** Nie podaje
już kandydatów z bazy wiedzy, nie wpisuje danych maszyny i nie proponuje
pasowań. Narzędzia dopytania szukają kartoteki i czytają ofertę.

Lista „Pasuje do" z oferty zostaje przy rozmowie, bez podświetlania maszyny
klienta, bo maszynę znał wyłącznie dobór. Historia i profil klienta nie
pokazują już maszyn z doborów. Numery OEM z opisów kartotek zostają: karta
towaru i szukanie po numerze dalej z nich korzystają.

Migracja kasuje tabele doboru i wiedzy (`dobor`, `model_urzadzenia`,
`zastosowanie`, `dowod_zastosowania`, `zabudowa_silnika`, `alias_silnika`,
`pasowanie_czesci`, `zamiennosc_oem`, `import_odsylaczy`, `import_wykazu`,
`model_z_opisu`, `token_silnika*`, `pasowanie_siec*`, `wymiar_kartoteki`,
`towar_fts`) oraz kolumny doboru i pasowań w szkicu i dopytaniu Copilota.
Zdarzenia w dzienniku audytu zostają.

**[wymaga działania]** Migracja kasuje dane bazy wiedzy bezpowrotnie poza
kopią `server\data\kopie\przed-*.db`, którą serwer robi przed migracją.
Zanim klikniesz aktualizację, upewnij się, że kopie działają (Ustawienia →
Serwer i kopie). Jeśli w `wertis.env` stoją `WIEDZA_AUTOMAT`,
`WIEDZA_AUTOMAT_MODEL`, `WIEDZA_AUTOMAT_NA_PRZEBIEG`, `PASOWANIE_Z_SIECI`
albo `PASOWANIE_Z_SIECI_NA_NOC`, usuń je — nic ich już nie czyta.
