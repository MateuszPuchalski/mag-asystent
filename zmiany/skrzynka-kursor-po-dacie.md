---
rodzaj: patch
tytul: skrzynka Allegro nie czyta 25 stron po każdej wiadomości w najnowszym wątku
---

**Skrzynka Allegro czyta jedną stronę listy zamiast dwudziestu pięciu.** Do tej
pory kolejna wiadomość w najnowszym wątku, nasza albo klienta, zmieniała jego
datę. Kursor tego wątku nie trafiał już nigdzie na liście, więc przebieg czytał
25 stron i pisał w dzienniku, że został obcięty. Teraz przebieg kończy się na
pierwszym wątku starszym od kursora. Żadna wiadomość nie ginęła i nie ginie.
Znika tylko zbędny ruch do Allegro i mylące ostrzeżenie.
