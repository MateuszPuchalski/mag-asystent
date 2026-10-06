---
rodzaj: minor
tytul: automat sam odpowiada na pytania o stan zamówienia (po włączeniu)
---

**Automat może sam odpowiedzieć na pytanie o stan zamówienia.** Działa
dopiero po włączeniu przez właściciela. Wysyła szkic tylko wtedy, gdy nikt
nie prowadzi rozmowy, nikt przy niej nie siedzi i nikt jeszcze nie odpisał.
Karta „Automat by…" pokazuje, że automat odpisał, a agent ocenia to
przyciskiem „W porządku" albo „Źle wysłane".

Włącza się w `wertis.env`: `PRZEPLYW_NA_ZYWO=ORDER_STATUS`. Bez tego klucza
nic się nie zmienia. Sufit `PRZEPLYW_NA_ZYWO_NA_GODZINE`, domyślnie 10
wysyłek na godzinę. Projekt: §14.6f `docs/panel-obslugi-klienta.md`.
