---
rodzaj: minor
tytul: zasady ze strażnikami — pusty JSON na serwerze, zgoda na zapis do Subiekta
---

**Serwer czyta pusty JSON jak brak ciała.** Żądanie z typem treści JSON
i pustą treścią nie kończy się już gołym „Bad Request". Poprawka po stronie
serwera zamyka tę klasę błędu dla panelu, kolektora i każdego przyszłego
frontu naraz. Zły JSON i zatruty `__proto__` dalej dostają 400.

**Zmiana w zapisie do Subiekta czeka na zgodę właściciela.** Nowy check
`Zgoda właściciela` wstrzymuje scalenie PR-a, który dotyka workera Sfery
albo adaptera zapisu do Subiekta. Działa po dwóch krokach w ustawieniach
GitHuba, opisanych w DEPLOY §0d. Kolejność ma znaczenie.

**Zasady w `CLAUDE.md` nazywają swoich strażników.** Każda zasada mówi, który
test jej pilnuje, albo wprost, że żaden. Doszły strażnicy dla trzech obietnic,
których nic nie sprawdzało: zero zapisu przy otwarciu każdego ekranu panelu,
jedna lista ról biura i prywatność w całym schemacie bazy. Zasady obszarów
przeszły do `server/`, `panel/`, `android/` i `sfera-worker/`.
