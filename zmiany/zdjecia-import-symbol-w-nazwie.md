---
rodzaj: patch
tytul: import zdjęć znajduje symbol w opisowej nazwie folderu
---

**Import zdjęć czyta symbol z opisu folderu.** Folder
`Gaznik_Wacker_BS50-2_BS30-2_W09-1501` z plikiem `miniaturka.jpg` trafia do
`W09-1501`, a `katownik_FT1249` do `FT1249`. Import sprawdza w Subiekcie
każdy fragment nazwy z cyfrą, także `10_02014` jako `10-02014`. Gdy jedna
nazwa wskazuje kilka różnych towarów, zdjęcie idzie na listę do ręcznego
dodania, zamiast trafić do przypadkowej kartoteki.
