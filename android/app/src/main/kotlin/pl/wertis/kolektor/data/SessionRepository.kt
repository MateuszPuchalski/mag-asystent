package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.LoginBody
import pl.wertis.kolektor.core.net.UserDto
import pl.wertis.kolektor.core.session.SessionState
import pl.wertis.kolektor.core.session.osoba
import pl.wertis.kolektor.core.session.userId
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Sesja urządzenia (plan §7) ─────────────────────────────────────────────
   Zastępuje `UsersRepository`, w którym „użytkownik" był dowolnym łańcuchem
   wpisywanym z klawiatury. Tożsamość rozstrzyga SERWER na podstawie loginu
   i hasła; kolektor trzyma tylko token.

   Token leży w prefsach, bo ma przeżyć zabicie procesu: kolektor idzie do
   kieszeni, Android ubija aplikację, a człowiek wraca do tej samej dostawy.
   Sesja kończy się wyłącznie jawną decyzją — wylogowaniem z Ustawień.

   Obok tokenu zapisujemy OSTATNI LOGIN, nigdy hasła. Login i tak stoi na
   pasku razem z nazwiskiem, więc niczego nie zdradza, a oszczędza wpisywanie
   na urządzeniu współdzielonym przez zmianę. Zapamiętane hasło byłoby
   plakietką pod inną nazwą, tylko bez możliwości świadomego oddania jej.     */

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

    /** Wołane po KAŻDEJ zmianie osoby — kontekst przyklejony musi wtedy zniknąć. */
    var onUserChanged: (() -> Unit)? = null

    /** Token sesji — czytany synchronicznie przez `IdentityHeaderInterceptor`. */
    val token: String? get() = prefs.getString("token", null)

    /** Ostatni udany login — do wstawienia w pole na ekranie logowania. */
    val ostatniLogin: String? get() = prefs.getString("login", null)

    /** Nazwa do paska i do nagłówka `x-user` (podpowiedź, nie tożsamość). */
    val currentUser: String get() = _state.value.osoba ?: "anonim"

    /** Czy ktokolwiek jest zalogowany na tym urządzeniu (Splash przy starcie). */
    val hasSession: Boolean get() = token != null

    private fun zapisz(token: String?, user: UserDto?) {
        val poprzedni = _state.value.userId
        prefs.edit {
            if (token == null) remove("token") else putString("token", token)
            // login przeżywa wylogowanie: następna osoba i tak go nadpisze,
            // a ta sama nie musi go wpisywać po raz drugi
            user?.login?.let { putString("login", it) }
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
     * Logowanie. Zwraca `null` przy powodzeniu, komunikat przy odmowie —
     * ekran nie musi wtedy znać ani kodów HTTP, ani treści błędów.
     */
    suspend fun zaloguj(login: String, haslo: String): String? =
        runCatching { apiCall { api().authLogin(LoginBody(login.trim().lowercase(), haslo)) } }
            .fold(
                onSuccess = {
                    zapisz(it.token, it.user)
                    null
                },
                onFailure = { it.komunikat("Nieznany login albo błędne hasło") },
            )

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
