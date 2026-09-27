# Kolektor Android — zasady obszaru

Uzupełnia `CLAUDE.md` w korzeniu. Kolektor to natywny klient REST serwera
(Kotlin, Jetpack Compose). Szczegóły budowania: `android/README.md`.

## Co da się sprawdzić przed wypchnięciem

Moduł `:app` kompiluje się tylko z Android SDK, czyli w praktyce w CI.
Przed wypchnięciem łapią błędy trzy rzeczy:

- `./gradlew :core:test` — logika bez SDK: skany, walidacja, DTO, sesja.
  Logikę, którą da się wyjąć z ekranu, stawiaj w `:core`, bo tam ma testy.
- `python3 tools/kt_imports_check.py` — brakujący import w `:app`.
- `python3 tools/ergonomia_check.py` — cel dotyku poniżej 48 dp.

## Zasady

- **Ergonomia przed wyglądem** (`docs/ergonomia-magazynu.md`). Cały dekalog
  obowiązuje kolektor. Jedno źródło minimalnego celu dotyku to `MinTap`
  w `ui/components/Common.kt`. Własny klikalny `Box` ma go użyć albo nieść
  komentarz `ergonomia: <powód>` z co najmniej trzema wyrazami.
  *Strażnik: `tools/ergonomia_check.py`.*
- **Żądanie bez ciała wysyła `EMPTY_BODY`** z `net/ApiService.kt`, bez typu
  treści. Serwer i tak czyta pusty JSON jak brak ciała, ale kolektor nie
  powinien na tym polegać. *Strażnik: konwencja.*
