package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.BadgeBody
import pl.wertis.kolektor.core.net.HandoverBody
import pl.wertis.kolektor.core.net.UserDto
import pl.wertis.kolektor.core.session.BadgeAction
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.core.session.naBadge
import pl.wertis.kolektor.core.session.osoba
import pl.wertis.kolektor.core.session.userId
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Sesja urządzenia (plan §7) ─────────────────────────────────────────────
   Zastępuje `UsersRepository`, w którym „użytkownik" był dowolnym łańcuchem
   wpisywanym z klawiatury. Tożsamość rozstrzyga SERWER na podstawie skanu
   badge'a; kolektor trzyma tylko token.

   Token i kod badge'a leżą w prefsach, bo mają przeżyć zabicie procesu:
   kolektor idzie do kieszeni, Android ubija aplikację, a człowiek wraca do
   tej samej dostawy. Sesja kończy się wyłącznie jawną decyzją: wylogowaniem
   z Ustawień albo przejęciem pracy cudzym badge'em.

   Sam kod badge'a zapisujemy po to, żeby ROZPOZNAĆ WŁASNY skan bez pytania
   serwera — inaczej każdy odruchowy skan własnej plakietki kosztowałby
   round-trip, a przy martwym Wi-Fi kończyłby się pytaniem o przejęcie pracy
   od samego siebie.                                                          */

/** Pytanie do człowieka: „przejąć pracę?". `null` = nikt o nic nie pyta. */
data class PytanieOPrzejecie(val badge: String, val od: String)

class SessionRepository(
    /* Dostawca, nie gotowy `ApiService`: klient HTTP musi znać token sesji,
       a token zna to repozytorium — kolejność tworzenia w `AppGraph` byłaby
       inaczej cykliczna. Lambda rozwiązuje to bez pola `lateinit`. */
    private val api: () -> ApiService,
    private val scope: CoroutineScope,
    context: Context,
) {
    private val prefs = context.getSharedPreferences("wertis_session", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow<SessionState>(SessionState.Brak)
    val state: StateFlow<SessionState> = _state

    private val _pytanie = MutableStateFlow<PytanieOPrzejecie?>(null)
    val pytanie: StateFlow<PytanieOPrzejecie?> = _pytanie

    /** Wołane po KAŻDEJ zmianie osoby — kontekst przyklejony musi wtedy zniknąć. */
    var onUserChanged: (() -> Unit)? = null

    /** Token sesji — czytany synchronicznie przez `IdentityHeaderInterceptor`. */
    val token: String? get() = prefs.getString("token", null)

    /** Kod badge'a właściciela sesji; `null` gdy sesji nie ma. */
    val mojBadge: String? get() = prefs.getString("badge", null)

    /** Nazwa do paska i do nagłówka `x-user` (podpowiedź, nie tożsamość). */
    val currentUser: String get() = _state.value.osoba ?: "anonim"

    /** Czy ktokolwiek jest zalogowany na tym urządzeniu (Splash przy starcie). */
    val hasSession: Boolean get() = token != null

    private fun zapisz(token: String?, user: UserDto?) {
        val poprzedni = _state.value.userId
        prefs.edit {
            if (token == null) remove("token") else putString("token", token)
            if (user == null) remove("badge") else putString("badge", user.badgeCode)
        }
        _state.value =
            if (user == null) SessionState.Brak
            else SessionState.Aktywna(user.userId, user.name, user.role)
        if (user?.userId != poprzedni) onUserChanged?.invoke()
    }

    /**
     * Sesja przyjęta z kreatora kont: konto właśnie powstało i od razu się nim
     * logujemy, bo bez sesji nie da się założyć ani jednego następnego.
     * Osobne wejście, żeby `zapisz` mogło zostać prywatne.
     */
    fun przyjmijZSetupu(token: String, user: UserDto) {
        zapisz(token, user)
    }

    /**
     * Odświeżenie stanu z serwera — przy starcie i po powrocie z tła.
     *
     * Właścicielem sesji jest SERWER: to on wie, czy token nadal wskazuje
     * czynne konto — także po przejęciu pracy z innego urządzenia.
     */
    fun refresh() {
        if (token == null) return
        scope.launch {
            runCatching { apiCall { api().authMe() } }
                .onSuccess { zapisz(token, it.user) }
                .onFailure { e ->
                    // 401 = serwer nie zna tego tokenu (restart bazy, unieważnienie).
                    // Błąd sieci NIE kasuje sesji — offline nie jest wylogowaniem.
                    if (e is ApiError && e.status == 401) zapisz(null, null)
                }
        }
    }

    /**
     * Skan badge'a. Decyzję („zaloguj / odblokuj / zapytaj / nic") podejmuje
     * czysty model w `:core` — tutaj zostaje samo wykonanie.
     *
     * @return komunikat dla człowieka albo `null`, gdy nie ma co mówić.
     */
    suspend fun onBadge(kod: String): String? =
        when (val a = naBadge(_state.value, kod, mojBadge)) {
            is BadgeAction.Zaloguj -> zaloguj(a.badge)
            is BadgeAction.ZapytajOPrzejecie -> {
                _pytanie.value = PytanieOPrzejecie(a.badge, a.od)
                null
            }
            BadgeAction.Nic -> null
        }

    private suspend fun zaloguj(badge: String): String? =
        runCatching { apiCall { api().authBadge(BadgeBody(badge)) } }
            .fold(
                onSuccess = {
                    zapisz(it.token, it.user)
                    "Zalogowano: ${it.user.name}"
                },
                onFailure = { it.komunikat("Nie rozpoznano badge'a") },
            )

    /** Potwierdzone przejęcie pracy. Wołane WYŁĄCZNIE z dialogu, nigdy ze skanu. */
    suspend fun przejmij(kontekst: String?): String? {
        val p = _pytanie.value ?: return null
        _pytanie.value = null
        return runCatching { apiCall { api().authHandover(HandoverBody(p.badge, kontekst)) } }
            .fold(
                onSuccess = {
                    zapisz(it.token, it.user)
                    "Pracę przejął: ${it.user.name}"
                },
                onFailure = { it.komunikat("Nie udało się przejąć pracy") },
            )
    }

    fun odrzucPrzejecie() {
        _pytanie.value = null
    }

    /**
     * Wylogowanie — JEDYNIE z jawnej decyzji człowieka (Ustawienia).
     * Bezczynność nie robi nic: patrz `core/session/SessionModel.kt`.
     */
    fun wyloguj() {
        scope.launch {
            runCatching { apiCall { api().authLogout() } }
            zapisz(null, null)
        }
    }

    private fun Throwable.komunikat(domyslny: String): String =
        (this as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: domyslny
}
