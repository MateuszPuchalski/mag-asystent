package pl.wertis.kolektor.core.badge

/* ── Identyfikator pracownika na badge'u ────────────────────────────────────
   Format: `PRC-0007-3` — prefiks + numer + CYFRA KONTROLNA.

   Trzy powody, dla których to nie jest zwykły numerek:

   1. Prefiks `PRC-` nie koliduje z niczym innym w budynku. Sprawdzone na
      realnej kartotece: zero symboli, zero EAN-ów i zero z 2088 adresów ma ten
      kształt. Dzięki temu `classify` rozpoznaje badge jednoznacznie i badge
      jest — jak lokalizacja — kategorią ZAMKNIĘTĄ.
   2. Cyfra kontrolna wyklucza rozpoznanie USZKODZONEJ etykiety jako CUDZEGO
      badge'a. Bez niej starty znak zamienia Jana w Piotra, a audyt wskazuje
      niewinnego. To jest różnica między „nie dało się odczytać" a „odczytano
      źle" — pierwsze jest widoczne, drugie nie.
   3. Kod NIE NIESIE NAZWISKA. Badge się gubi i zostaje na kurtce; nazwisko na
      etykiecie to dane osobowe leżące na parkingu. Powiązanie kod → człowiek
      żyje wyłącznie w bazie.

   Kolektor rozpoznaje tu wyłącznie KSZTAŁT kodu — po to, żeby skan badge'a nie
   poszedł ścieżką EAN-u. Generowanie numeru i weryfikacja cyfry kontrolnej
   należą do serwera (`services/users.ts`) i tam mają swoje testy; druga kopia
   po tej stronie mogłaby się z nią rozjechać bez żadnego objawu.              */

private val BADGE_RE = Regex("""^PRC-(\d{4})-(\d)$""")

/** Czy kod ma KSZTAŁT badge'a — bez sprawdzania cyfry kontrolnej. */
fun looksLikeBadge(raw: String): Boolean = BADGE_RE.matches(raw.trim().uppercase())
