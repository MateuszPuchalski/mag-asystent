package pl.wertis.kolektor.core.session

/* ── Kto pracuje na kolektorze ──────────────────────────────────────────────
   Wejściem jest login i hasło — ten sam wzorzec, co w reszcie firmy. Do
   sierpnia 2026 był nim skan plakietki i to ten sam gest znaczył trzy różne
   rzeczy naraz (logowanie, nic, przejęcie pracy). Reguła mieszkała tutaj,
   osobno od ekranów, bo żadnego z jej wariantów nie widać z kodu UI.

   Po zmianie nie ma czego rozstrzygać: kto siada do kolektora, ten wpisuje
   swoje dane, a poprzednik się wylogowuje. Zostaje sam STAN — dwa warianty
   i ani jednego więcej.                                                      */

/**
 * Rola konta.
 *
 * Typ istnieje dla EKRANÓW, które muszą pokazać człowiekowi listę do wyboru.
 * `SessionState.role` zostaje surowym łańcuchem z serwera i to jest celowe:
 * serwer jest właścicielem zbioru ról, a nieznana rola ma zalogować z ograniczonymi
 * uprawnieniami, nie wywrócić aplikacji przy `valueOf`.
 */
enum class Rola(val wire: String, val etykieta: String) {
    MAGAZYNIER("magazynier", "Magazynier"),
    BIURO("biuro", "Biuro"),
    ADMIN("admin", "Administrator"),
}

/**
 * Role, którym serwer daje wgląd w konta i ustawienia globalne.
 *
 * Jedno miejsce, bo ekrany pytały o to każdy po swojemu — dwa razy przez
 * `role == "biuro"` w Ustawieniach. Po dojściu czwartej roli w 0.24.0 taki
 * zapis milcząco odbierałby adminowi to, co ma z definicji.
 *
 * Porównanie idzie po `wire`, a nie po enumie, bo `SessionState.role` zostaje
 * surowym łańcuchem z serwera — nieznana rola ma ograniczyć uprawnienia, a nie
 * wywrócić aplikację przy `valueOf`.
 */
val ROLE_BIUROWE: Set<String> = setOf(Rola.BIURO.wire, Rola.ADMIN.wire)

/** Czy ta sesja widzi konta, kreator i ustawienia globalne. */
val SessionState.biurowa: Boolean
    get() = (this as? SessionState.Aktywna)?.role in ROLE_BIUROWE

/**
 * Stan sesji urządzenia widziany przez UI.
 *
 * Dwa stany i ani jednego więcej: ktoś jest zalogowany albo nie jest. Sesja
 * trwa do jawnej decyzji człowieka — wylogowania z Ustawień.
 */
sealed interface SessionState {
    /** Nikt się nie zalogował — kolektor nie wie, kto pracuje. */
    data object Brak : SessionState

    data class Aktywna(val userId: Long, val name: String, val role: String) : SessionState
}

val SessionState.userId: Long?
    get() = when (this) {
        is SessionState.Aktywna -> userId
        SessionState.Brak -> null
    }

val SessionState.osoba: String?
    get() = when (this) {
        is SessionState.Aktywna -> name
        SessionState.Brak -> null
    }

/** Inicjały do awatara w pasku (np. „Jan Kowalski" → JK). */
fun userInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.isEmpty()) return "?"
    return parts.take(2).joinToString("") { it.first().uppercase() }
}
