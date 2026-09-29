---
rodzaj: minor
tytul: dobór od zera
---

**Dobór części od nowa.** Na górze widać, czego szuka klient: maszynę
i część. Pod spodem stoją kandydaci w trzech grupach: wskazane przez klienta,
z bazy wiedzy i podobne po nazwie. Odpowiedź to jeden klik: „Wybierz",
„Nie mamy", „Dopytaj o…" albo „Nie dotyczy". Nie ma już listy statusów ani
osobnego „Zatwierdź dobór".

**Zdanie dla klienta nie mówi „pasuje" bez dowodu.** Bez potwierdzonego
wpisu w bazie wiedzy szkic pisze „prawdopodobnie pasuje". Przy trafieniu po
numerze pisze, że to część o numerze z pytania.

**Zmiana maszyny zdejmuje wybraną część.** Wybór dotyczył innej maszyny,
więc nie zostaje przy nowej.

Karta pasowania rozpoznanego przez Copilota przeszła do wiersza „Wiedza".
Karta danych rozpoznanych przez Copilota zniknęła, bo dane wchodzą same.
Droga „zgodne wymiary" i parametry doboru wyszły.

Serwer: nowa tabela `dobor`. Migracja kopiuje dotychczasowe dobory raz,
a stara tabela `dobor_rozmowy` zostaje nietknięta na wypadek powrotu do
poprzedniej wersji. Raport skuteczności po drogach zastępują miary doboru,
liczone od tego wydania. Opis i kontrakt: `docs/dobor-od-zera.md`.
