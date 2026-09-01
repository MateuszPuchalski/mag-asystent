# Projekt widoków obsługi klienta

Źródła makiet do `docs/panel-obslugi-klienta.md`. Pięć ekranów, każdy jako
osobny plik `.dc.html`; `canvas.json` układa je na jednej kanwie.

Kanwa: https://claude.ai/code/artifact/cee721cd-f98c-41b7-a9c0-d32fbbb1941a

| plik | ekran | paragraf projektu |
|---|---|---|
| `Main.dc.html` | skrzynka: kolejka, rozmowa, kontekst | §10.1–10.4 |
| `Dobor.dc.html` | dobór części: kandydaci, dowody, negatywne | §11 |
| `Konflikt.dc.html` | konflikt świeżości przy wysyłce | §8.5 |
| `Awaria.dc.html` | trwały alarm synchronizacji | §21 |
| `Przejecie.dc.html` | wyścig o przejęcie, brak powiązania z ofertą | §6.2 |

## Czym to nie jest

To nie jest kod panelu. Ekrany są makietami z działającymi kontrolkami, więc
kliknięcia działają, ale żadne nie sięga do serwera. Dane są przykładowe:
numery ofert, symbole towarów i nazwiska zostały zmyślone. Kształt wiersza
kolejki i rodzaje wpisów osi pochodzą z projektu docelowego.

Makiety trzymają się mowy wizualnej dzisiejszego panelu: Barlow, bursztyn
`#F7A600`, atrament `#2A2A2C`, karty o promieniu 12 px na obwódce `#e2e8f0`,
ikony w stylu lucide. Nowe elementy rozszerzają ten zestaw, nie zakładają
własnego.

## Decyzje widoczne na ekranie

Trzy rzeczy z dokumentu wymagały wyboru rysunkowego, nie tylko zapisu.

**Rodzaje wpisów osi różnią się czterema cechami naraz** — tłem, obwódką,
ikoną i wcięciem. Sam podpis nie wystarczy, gdy oś czyta się w biegu. Zmiany
przypisania i statusu idą cienką szyną, żeby nie udawały wiadomości.

**Komentarz wewnętrzny przemalowuje całe pole edytora.** Przełącznik zmienia
tło, obwódkę i przycisk. Wysyłka do klienta znika z ekranu, gdy piszesz
komentarz.

**Brak danych mówi o sobie wprost.** Puste pole oferty zostaje puste i jest
oznaczone. Ekran nie uzupełnia go z kartoteki, bo to mieszałoby źródła.

## Skąd wzięte

Ekran stanów pokrywa cztery blizny z `docs/obsluga-klienta.md`. Dopisek
klienta w trakcie redagowania nie kasuje szkicu i wymaga jawnego
zatwierdzenia. Awaria synchronizacji jest jawna, a pusta kolejka niesie
datę ostatniego przebiegu. Przejęcie rozmowy jest atomowe i pokazuje
przegranemu właściciela oraz wersję. Pytanie bez numeru oferty nie dobiera
towaru z najdłuższych słów treści.
