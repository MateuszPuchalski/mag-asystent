# Worker Sfery — zasady obszaru

Uzupełnia `CLAUDE.md` w korzeniu. **To jedyny kod w repo, który wystawia
dokumenty w Subiekcie.** MM, korekta sprzedaży z RW i ZW zostają w księgach
firmy. Następne wydanie ich nie cofnie, a sprząta się je ręcznie w ERP.
Co i jak worker robi: `sfera-worker/README.md` i `docs/sfera-com.md`.

## Zgoda właściciela

Każdy PR dotykający tego katalogu, `server/src/adapters/sfera.ts`
albo `sfera.sql.ts` czeka na kliknięcie właściciela. Pilnuje tego
check `Zgoda właściciela` (`.github/workflows/zgoda.yml`, DEPLOY §0d).
Nie obchodź go i nie zmieniaj listy ścieżek przy okazji innej pracy.
Opisz w PR-ze, jaki dokument zmiana może wystawić inaczej niż dotąd.

## Czego CI nie sprawdza

COM Sfery istnieje tylko na Windowsie z Subiektem. CI sprawdza, że projekt
się kompiluje, a `test-dymny.sh` przepuszcza jedno MM przez kolejkę w trybie
`--dry-run`, bez Sfery. **Nic w repo nie sprawdza samego wystawienia
dokumentu.** Robi to dopiero bramka z `docs/wdrozenie.md`: `--dry-run` na
podmiocie testowym, potem jedno MM na kartotece próbnej, dopiero potem
produkcja.

## Zasady

- **Atomowo albo wcale.** Gdy ogniwo łańcucha padnie, wszystko przed nim
  ma zostać usunięte, bo Subiekt nie ma transakcji obejmującej kilka
  dokumentów. Gdy nie uda się i wycofanie, błąd zadania wymienia Z IMIENIA
  dokumenty do ręcznego usunięcia. Nowe ogniwo dostaje własne wycofanie.
  *Strażnik: konwencja.*
- **Jeden wykonawca kolejki.** Przy `SFERA_WORKER=1` zadania dokumentowe
  bierze ten proces, bez niego worker Node. Nie dokładaj trzeciej drogi.
  *Strażnik: odmowa startu procesu przy złej konfiguracji.*
- **Guard kolejności zadań** leży w `sql/*.sql` i jedzie w exe jako zasób.
  *Strażnik: `server/src/worker/sfera-pick.test.ts` na tych samych plikach.*
- **Nazwy Sfery sprawdzaj sondą, nie z pamięci** (`sonda.ps1` niczego nie
  zapisuje). Niepotwierdzone nazwy znaczy `[WERYFIKUJ]`.

<!-- Próba bramki „Zgoda właściciela" — PR testowy, do zamknięcia bez scalania. -->
