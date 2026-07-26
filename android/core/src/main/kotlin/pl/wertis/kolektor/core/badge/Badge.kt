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
      żyje wyłącznie w bazie.                                                  */

const val BADGE_PREFIX = "PRC-"

private val BADGE_RE = Regex("""^PRC-(\d{4})-(\d)$""")

/**
 * Cyfra kontrolna dla czterocyfrowego numeru.
 *
 * Wagi 3-1-3-1 i dopełnienie do dziesiątki — ten sam schemat co w EAN, bo
 * wyłapuje zarówno przekłamanie pojedynczej cyfry, jak i najczęstszą pomyłkę
 * przy przepisywaniu z ręki: przestawienie dwóch sąsiednich cyfr.
 */
fun cyfraKontrolna(numer: Int): Int {
    val cyfry = numer.toString().padStart(4, '0').map { it - '0' }
    val suma = cyfry.mapIndexed { i, c -> c * if (i % 2 == 0) 3 else 1 }.sum()
    return (10 - suma % 10) % 10
}

/** Pełny kod badge'a dla numeru pracownika (np. 7 → `PRC-0007-3`). */
fun badgeCode(numer: Int): String =
    "$BADGE_PREFIX${numer.toString().padStart(4, '0')}-${cyfraKontrolna(numer)}"

/**
 * Numer pracownika z zeskanowanego kodu albo `null`, gdy kod nie jest badge'em
 * ALBO nie zgadza się cyfra kontrolna.
 *
 * Świadomie jedna wartość dla obu przypadków: dla wołającego to ten sam wniosek
 * („to nie jest ważny badge"), a rozróżnianie ich w UI kusiłoby, żeby przy złej
 * cyfrze kontrolnej „spróbować mimo wszystko".
 */
fun parseBadge(raw: String): Int? {
    val m = BADGE_RE.find(raw.trim().uppercase()) ?: return null
    val numer = m.groupValues[1].toInt()
    return if (m.groupValues[2].toInt() == cyfraKontrolna(numer)) numer else null
}

/** Czy kod ma KSZTAŁT badge'a — bez sprawdzania cyfry kontrolnej. */
fun looksLikeBadge(raw: String): Boolean = BADGE_RE.matches(raw.trim().uppercase())
