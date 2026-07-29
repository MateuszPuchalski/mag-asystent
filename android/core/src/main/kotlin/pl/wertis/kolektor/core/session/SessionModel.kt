package pl.wertis.kolektor.core.session

/* ── Co znaczy skan badge'a ─────────────────────────────────────────────────
   Ten sam gest — jeden skan — znaczy trzy różne rzeczy w zależności od tego,
   co dzieje się na kolektorze. Reguła jest krótka, ale każdy jej wariant ma
   konsekwencję, której nie widać z kodu ekranu, więc mieszka tutaj: osobno,
   bez Androida, z testami.

     brak sesji    → logowanie
     mój badge     → nic (przypadkowy skan własnego badge'a nie ma prawa
                     niczego zresetować; ludzie skanują badge odruchowo,
                     gdy nie wiedzą, co zrobić)
     cudzy badge   → PYTANIE o przejęcie pracy, nigdy ciche przełączenie

   Ostatni wariant jest tu najważniejszy. Ciche przełączenie tożsamości
   w środku cudzej dostawy niszczy audyt dokładnie wtedy, gdy jest potrzebny:
   pozycje odłożone przez Jana dostają nazwisko Piotra i nikt się o tym nie
   dowie. Dlatego decyzja należy do człowieka, a nie do aplikacji.

   Czwartego wariantu — „moja sesja, zablokowana → odblokowanie" — nie ma od
   sierpnia 2026. Sesja nie wygasa sama, więc nie ma czego odblokowywać.      */

/**
 * Rola konta.
 *
 * Typ istnieje dla EKRANÓW, które muszą pokazać człowiekowi listę do wyboru.
 * `SessionState.role` zostaje surowym łańcuchem z serwera i to jest celowe:
 * serwer jest właścicielem zbioru ról, a nieznana rola ma zalogować z ograniczonymi
 * uprawnieniami, nie wywrócić aplikacji przy `valueOf`.
 */
enum class Rola(val wire: String, val etykieta: String, val wymagaPinu: Boolean) {
    MAGAZYNIER("magazynier", "Magazynier", false),
    BRYGADZISTA("brygadzista", "Brygadzista", true),
    BIURO("biuro", "Biuro", true),
}

/**
 * Stan sesji urządzenia widziany przez UI.
 *
 * Dwa stany i ani jednego więcej: ktoś jest zalogowany albo nie jest. Sesja
 * trwa do jawnej decyzji człowieka — wylogowania z Ustawień albo przejęcia
 * pracy cudzym badge'em.
 */
sealed interface SessionState {
    /** Nikt nie zeskanował badge'a — kolektor nie wie, kto pracuje. */
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

/** Co zrobić po skanie badge'a. */
sealed interface BadgeAction {
    /** Nowa sesja — `POST /api/auth/badge`. */
    data class Zaloguj(val badge: String) : BadgeAction

    /**
     * Pytanie do człowieka. Kolektor woła `/api/auth/handover` DOPIERO po
     * potwierdzeniu — sam skan cudzego badge'a niczego nie przełącza.
     */
    data class ZapytajOPrzejecie(val badge: String, val od: String) : BadgeAction

    /** Skan bez skutku (własny badge przy czynnej sesji). */
    data object Nic : BadgeAction
}

/**
 * Decyzja o skanie badge'a.
 *
 * @param mojBadge kod badge'a osoby, która ma bieżącą sesję; `null` gdy sesji
 *   nie ma. Porównujemy KODY, nie nazwiska — dwie osoby o tym samym imieniu
 *   to nie jest przypadek hipotetyczny, a badge jest z definicji unikalny.
 */
fun naBadge(stan: SessionState, badge: String, mojBadge: String?): BadgeAction {
    val kod = badge.trim().uppercase()
    if (stan is SessionState.Brak) return BadgeAction.Zaloguj(kod)
    val moj = mojBadge?.trim()?.uppercase()
    if (moj != null && kod != moj) {
        return BadgeAction.ZapytajOPrzejecie(kod, stan.osoba ?: "poprzednia osoba")
    }
    // Własny badge przy czynnej sesji nie ma prawa niczego zresetować. Tak samo
    // dowolny badge, gdy kolektor zgubił zapamiętany kod — bez porównania nie
    // wiadomo, czy to przejęcie, a ciche przełączenie jest tu najgorszą opcją.
    return BadgeAction.Nic
}

/** Inicjały do awatara w pasku (np. „Jan Kowalski" → JK). */
fun userInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.isEmpty()) return "?"
    return parts.take(2).joinToString("") { it.first().uppercase() }
}
