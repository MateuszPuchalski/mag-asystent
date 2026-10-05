---
rodzaj: minor
tytul: zmiana własnego hasła w panelu
---

**Swoje hasło zmienisz sam.** Ustawienia → Ludzie i urządzenia → Twoje
hasło. Admin nie musi już zmieniać haseł za innych w biurze.

Zmiana hasła ma ten sam limit prób co logowanie i liczy je na wspólnym
liczniku. Po pięciu błędnych próbach odpowiada 429 przez minutę.

Pełny resync z Subiekta robi to samo co odświeżenie co minutę: wiąże korekty
i czyści ostrzeżenie w stanie systemu. Kliknięty w trakcie odświeżenia czeka
na nie i robi jeszcze jedno, więc pokazuje stan po kliknięciu. Dwa importy
nie biegną już naraz.

Porządki w serwerze: znikają dwie trasy, których nie woła żaden ekran, i cykl
importów w obsłudze klienta.
