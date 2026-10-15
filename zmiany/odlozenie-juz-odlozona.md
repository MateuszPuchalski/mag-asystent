---
rodzaj: patch
tytul: ponowne odłożenie pozycji po zgubionej odpowiedzi nie robi nadmiaru
---

**Pozycja, która już weszła, nie da się odłożyć drugi raz „z ręki".** Gdy odpowiedź na odłożenie zginęła w dziurze Wi-Fi, kolektor dalej pokazywał pozycję jako nietkniętą, a serwer odpowiadał komunikatem o ilości. Magazynier wpisywał wtedy ilość ręcznie i ta sama partia lądowała drugi raz jako nadmiar (audyt z 14 października: 30 szt. + 29 szt. przy fakturze na 30). Serwer odpowiada teraz „już odłożona w całości" z kodem `juz_odlozona`, a kolektor zdejmuje zaznaczenie i odświeża listę.
