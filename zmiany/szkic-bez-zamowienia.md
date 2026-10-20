---
rodzaj: patch
tytul: szkic dociąga zamówienie, którego WERTIS jeszcze nie znał
---

**Pierwszy szkic zna zamówienie.** Automat układa szkic zaraz po wiadomości,
a zamówienie z Allegro dochodziło dopiero w takcie synchronizacji. Szkic na
„kiedy nadacie?” nie znał wtedy zamówienia wcale i odpisywał „sprawdzamy”.
Teraz dociąga zamówienie przed szkicem. Gdy Allegro nie odpowie, szkic dostaje
przynajmniej stan zamówienia z Sellasist.
