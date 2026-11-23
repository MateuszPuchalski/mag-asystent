---
rodzaj: patch
tytul: zestaw testowy Copilota — ponowne puszczenie zapisanych spraw
---

Polecenie `npm run copilot:zestaw` w `server/` puszcza zapisane wejścia
szkiców jeszcze raz, innym modelem (`--model`) albo inną instrukcją
(`--instrukcja plik.txt`). Wynik przechodzi przez te same sita co szkic biura.
Raport pokazuje, które sprawy nowy wariant naprawił, a które zepsuł, koszt
i czas obu stron oraz bliskość szkicu do odpowiedzi, którą agent wysłał.
Bez `--pusc` polecenie tylko wycenia przebieg i nie woła modelu. Opcja
`--pary plik.md` zapisuje oba szkice obok siebie do przeczytania.

Powtórka stoi w pomiarze Copilota jako osobne zadanie „zestaw testowy
szkiców” i nie liczy się do sufitu szkiców z automatu. Sprawy ze zdjęciami
są pomijane, a narzędzie ofert nie pyta Allegro. Zasady danych:
`docs/obsluga-klienta.md`, rozdział o Copilocie.
