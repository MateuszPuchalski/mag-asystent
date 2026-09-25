---
rodzaj: patch
tytul: zwrot zamknięty korektą widzi wypłatę zrobioną w Allegro
---

**Zwrot zamknięty korektą widzi wypłatę zrobioną w Allegro.** Zgłoszenie
właściciela, zwrot X5XY/2026: „dlaczego pokazuje do zwrotu, mimo że pieniądze
zostały zwrócone?". Sprawdzanie wypłat w operacjach płatności pomijało zwroty
zamknięte korektą, a te od 0.476.0 czekają w DO ZWROTU na pieniądze. Teraz
obejmuje też zamknięte, przyjęte, z kwotą i bez naszego śladu wypłaty, do
sześćdziesięciu dni po zamknięciu. Zwrot zejdzie do zamkniętych przy
najbliższej synchronizacji.
