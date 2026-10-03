---
rodzaj: minor
tytul: alarm w panelu o dyskusjach bez odpowiedzi i prawdziwy zegar „czeka od”
---

**Dyskusja bez odpowiedzi zapala alarm w panelu.** Po blokadzie konta za
nieodpowiedzianą dyskusję panel ostrzega, zanim minie czas. Czerwony pasek na
każdym ekranie mówi, ile dyskusji czeka na nas i jak długo najstarsza.
Ostrzega też zdanie w stanie systemu. Próg w godzinach ustawia
`DYSKUSJE_ALARM_GODZIN` w `wertis.env`, a bez wpisu działa wartość domyślna.
Przy dyskusji po progu `ok` w `/api/health` jest fałszywe, co zobaczy też
zewnętrzny monitoring, jeśli czyta to pole.

**Zegar „czeka od” liczy od pytania klienta.** Wiersz dyskusji pokazywał
„dziś”, gdy ostatnią wiadomość napisał doradca Allegro, bo jego odpowiedź
zerowała licznik. Teraz zegar liczy od najstarszej wiadomości kupującego bez
naszej odpowiedzi i pokazuje godziny, gdy minęło mniej niż doba.
