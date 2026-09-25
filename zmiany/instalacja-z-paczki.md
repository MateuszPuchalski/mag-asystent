---
rodzaj: minor
tytul: nowa instalacja z paczki, bez Gita i Noda, pierwsze konto w panelu
---

**Nowa instalacja z paczki wydania.** Instalator pobiera najnowszy
`wertis-<wersja>.zip` i rozpakowuje go, zamiast instalować Gita, klonować
repozytorium i budować 372 MB zależności na serwerze. Paczka niesie własny
Node 22 (`tools/node-windows.txt`, suma przypięta w repo), więc instalator nie
instaluje żadnych programów. Git zostaje dla `-Galaz` i instalacji z `.git`.

- **Reinstalacja po awarii zachowuje dane.** Dane od pierwszego dnia leżą
  w `<katalog>-dane`; instalator, który je zastanie, podpina je zamiast
  zaczynać od pustej bazy.
- **Mniej pytań.** Serwer SQL to `localhost` (`-SerwerSql`), instancję czyta
  z rejestru (`-InstancjaSql`), jedyną bazę bierze sam, magazyny MGP i Zwroty
  podsuwa po symbolu. Pole lokalizacji zostaje pytaniem — aplikacja nadpisuje
  je bezwarunkowo.
- **Pierwsze konto w panelu.** Pusta instalacja pokazuje formularz konta
  administratora zamiast logowania; instalator o hasło już nie pyta.
- **Poprawka:** kreator nadpisywał obiekt instancji WERTIS nazwą instancji
  SQL. Po podłączeniu do Subiekta usługi nie dostawały restartu z nową
  konfiguracją, a dev — swojego `SRODOWISKO`.

Paczka urosła z 22 do 58 MB przez Node.

**Poprawka CI: scalenia z auto-scalania nie uruchamiały niczego na `main`.**
Auto-scalanie włączał token workflowu, więc GitHub scalał jako bot Actions,
a taki push nie wyzwala workflowów. Przepadły wydania 0.482.1–0.482.11,
0.484.3, 0.484.6, 0.485.0, 0.486.1, 0.486.4 i 0.492.0, a `wydanie.yml` po
pierwszym scaleniu nie ruszył. Auto-scalanie włącza teraz `ODSWIEZANIE_TOKEN`.
