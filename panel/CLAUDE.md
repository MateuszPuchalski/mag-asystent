# Panel biura — zasady obszaru

Uzupełnia `CLAUDE.md` w korzeniu. Panel to jedyny front biura: React, Vite,
TanStack Query, build do `dist/web/obsluga` na serwerze.

## Nowy ekran

1. **Trasa w `src/main.tsx`**, komponent w `src/ekrany/`.
2. **Test zera zapisu obok**: `ekrany/<Nazwa>.test.tsx` albo osobny
   `ekrany/<Nazwa>.zapis.test.tsx`. Otwarcie ekranu ma wysłać zero żądań
   innych niż GET. Najprościej atrapą `atrapaZapisow` z `src/test/zapisy.ts`,
   która liczy zapisy na samym `fetch`. Bez tego testu CI zatrzyma
   `src/ZeroZapisu.test.ts`.
3. **Kształt z celu biura** (`docs/obsluga-klienta.md` §7): praca na górnym
   rzędzie, wgląd na dolnym, ustawienia za zębatką.

Test, który podmienia moduł `../api/...`, widzi tylko haki, które sam
podstawił. Zapisu wołanego z pominięciem haka nie zobaczy. Dlatego test zera
zapisu patrzy na `fetch`, a nie na haki.

## Żądania

- **Żądanie bez ciała nie deklaruje typu treści.** `api()` w
  `src/api/klient.ts` robi to samo. Nie dopisuj nagłówka ręcznie.
  *Strażnik: `src/api/klient.test.ts`.*
- **Każdy zapis przez hak z `src/api/`, nie `api()` wprost z ekranu.** Hak
  unieważnia właściwe zapytania, a ekran o tym nie pamięta.
  *Strażnik: konwencja.*

## Brak danych to nie zero

- **Lista bez danych nie mówi „pusto" ani „0".** Gdy zapytanie padło i nie
  ma danych, ekran pokazuje błąd zamiast listy, a licznik kubełka dostaje
  `undefined`, nie zero. Serwer znika w każdej aktualizacji, a „nic nie
  czeka" przy awarii agent czyta jako koniec pracy.
  *Strażnik: `src/ekrany/BrakPolaczenia.test.tsx` (Dostawy, Kosze, Skrzynka).*
- **Brak połączenia ma jeden typ: `BrakPolaczenia`** z `api/klient.ts`.
  Pasek pod nagłówkiem (`nawigacja/Polaczenie.tsx`) mówi o nim raz.
  Własny `fetch` poza `api()` zamienia brak sieci na ten sam typ.

## Strażnicy źródeł

Pliki `*.test.ts` leżące wprost w `src/` czytają źródła panelu przez `?raw`
i pilnują zasad wyglądu i czasu: `Bursztyn`, `Kontrast`, `Skala`, `Czas`,
`RamaOkna`, `Wielkosc` i `ZeroZapisu`. Zwolnienia są jawne, a ich formę
opisuje nagłówek każdego strażnika — zwykle komentarz `<nazwa>: <powód>`
z co najmniej trzema wyrazami powodu. Odmowa strażnika zwykle znaczy, że
łamiesz zasadę.

## Dostępność

- **Ekran przechodzi WCAG 2.2 A i AA w strukturze.** Po każdym teście
  z `src/ekrany/` i `src/druk/` axe-core sprawdza wyrenderowany DOM.
  Przycisk bez nazwy, pole bez etykiety czy pusty nagłówek tabeli zatrzyma
  test. *Strażnik: `src/test/dostepnosc.ts`.*
- **Kolumna bez napisu dostaje nazwę dla czytnika:** `{ ukryty: "Działania" }`
  w `Tabela`, nie pusty napis.
- **Nic nie wychodzi za kadr przy powiększeniu 200%** (WCAG 1.4.4). Element
  z `shrink-0` szerszy niż 640 px wypycha stronę w bok. Nazwy zakładek
  chowają się poniżej 900 px (`max-[899px]:sr-only`).
- **Kontrastu i fokusu jsdom nie widzi.** Zmieniając barwy albo układ,
  zmierz w przeglądarce: `node tools/audyt-dostepnosci.mjs <katalog>` przy
  działającym serwerze i panelu. Cel: zero naruszeń na każdym ekranie.
- **Audyt na pustym seedzie mierzy puste ekrany.** `seed:scenariusze` nie ma
  zwrotów, reklamacji ani rozmów. Zero naruszeń na nim przepuściło pięć
  rodzajów na otwartej sprawie, w tym szary podpis na zaznaczonym wierszu
  (3.86:1). Mierząc ekran kolejki, otwórz na nim sprawę.
  *Strażnik: `src/Kontrast.test.ts` (znane pary i biel liczona z palety).*

## Okna dialogowe

- **Każde okno idzie przez `useOkno`** z `nawigacja/fokus.ts`. Hak wprowadza
  fokus do okna i oddaje go temu, kto okno otworzył. Escape zamyka tylko
  górne okno. Nakładka `fixed inset-0` też jest oknem. Rozłóż wynik haka
  na elemencie z `role="dialog"`: `<div role="dialog" {...okno}>`.
  *Strażnik: `src/Okna.test.ts`.*
- **Pod oknem modalnym skróty strony milkną.** Nasłuch skrótu pyta
  o `klawiszZajety(e.target)`, nie o samo `polePisania`. W zwrotach `Z` pod
  historią klienta oddawało pieniądze za niewidoczny zwrot. Skan czytnika
  przechodzi dalej (`skaner.ts`), bo zwroty słuchają etykiety cały czas.
  *Strażnik: `src/ekrany/Zwroty.test.tsx`, `nawigacja/fokus.test.tsx`.*
- **Fokus startowy: samo okno albo `data-fokus-startowy`.** Pierwszy
  przycisk bywa „Zamknij”. Przy kroku nieodwracalnym fokus stoi na wyjściu,
  które nic nie wysyła, jak „Popraw szkic” przy wysyłce zatrzymanej.
- **Szuflada obok pracy jest niemodalna** (`modalne: false`): bez nakładki,
  bez pułapki tabulatora i bez wyciszania skrótów.

## Obsługa klienta

Nowa kolejka albo ekran obsługi dopisuje się do drogi klienta w obie strony:
ekran prowadzi na profil klienta, a profil z powrotem do ekranu. Wiązanie
jednostronne to wiązanie, którego nie ma. Reguły: `docs/obsluga-klienta-calosc.md`.
