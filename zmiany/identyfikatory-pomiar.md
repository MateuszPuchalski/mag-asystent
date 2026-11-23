---
rodzaj: patch
tytul: numery części ze spacjami i pomiar numerów, których parser nie odczytuje
---

**Szukanie po numerze części znajduje numery Stihla i Husqvarny pisane ze
spacjami.** Numer `4238 140 1800` albo `537 06 91-01` w środku listy trafia do
tabeli identyfikatorów w całości. Dotąd szły tam jego urywki, na przykład
`4238`, które prowadziły do cudzych kartotek. Parser czyta też osiem wariantów
pisowni znanych etykiet, między innymi `Zaminnik:`, `Zamienne:`, `Nr.org:`
i `Zastępuje nr:`. Na kartotece demo to 76 numerów więcej i 83 urywki mniej.
Tabela przebudowuje się sama przy najbliższym imporcie kartotek.

Nowe polecenie `npm run identyfikatory:pomiar` w `server/` liczy, ile numerów
części zostaje w opisach kartotek poza tabelą i przy jakich etykietach stoją.
Czyta bazę i niczego nie zapisuje. Raport niesie symbole towarów i numery
z opisów, bez danych klientów.
