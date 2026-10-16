---
rodzaj: patch
tytul: zdjęcie wchodzi do Subiekta z numerem wiersza i sumą kontrolną
---

**Zdjęcie dodane w WERTIS wchodzi do kartoteki Subiekta.** Zadanie
„Zdjęcie · …" kończyło się błędem o pustym `zd_Id`. Numer wiersza bierze się
teraz z licznika Subiekta (`ins_ident`), a `zd_CRC` dostaje CRC32 obrazu.
Zadania, które już padły, wystarczy ponowić z kolejki.

**[wymaga działania]** Konto SQL potrzebuje dwóch nowych praw do licznika
numerów. Instalator z `-TylkoKonfiguracja -ZdjeciaZapis` albo w SSMS na bazie
podmiotu: `GRANT SELECT ON dbo.ins_ident TO wertis;` i
`GRANT UPDATE ON dbo.ins_ident (ido_wartosc) TO wertis;`.
