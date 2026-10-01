---
rodzaj: patch
tytul: pamięć serwera w /api/health i godzinny wpis w logu
---

**Pamięć serwera widać bez zgadywania.** `/api/health` ma blok `pamiec`:
pamięć procesu, zajętą stertę, jej limit i czas pracy. Serwer zapisuje próbkę
co godzinę w logu (`[pamiec]`) i trzyma ostatnie dwie doby w pamięci. Blok
liczy też trend: o ile wzrosło dno pamięci między starszą a młodszą połową
okna. Dno, nie szczyt, bo sterta Node faluje przy każdym odświeżeniu
read-modelu. Stały wzrost dna po kilku godzinach oznacza wyciek, a wahania
wokół jednej wartości są normalne. Trend nie zmienia `ok` ani listy
`problemy`, więc aktualizacja nie może przez niego wycofać wydania.
