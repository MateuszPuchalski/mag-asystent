package pl.wertis.kolektor.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import pl.wertis.kolektor.core.net.WertisJson

/* ── Użytkownicy kolektora (spec §8) — port web/src/lib/users.ts ────────────
   Jedno urządzenie obsługuje kilku magazynierów (zmiany, hot-swap). Wybrany
   trafia do nagłówka X-User, więc każda operacja w events/kolejce jest
   przypisana do właściwej osoby. Brak logowania — tylko identyfikacja.       */

const val MAX_USER_LEN = 24
const val DEFAULT_USER = "magazynier"

data class UsersState(val list: List<String>, val current: String)

class UsersRepository(context: Context) {
    private val prefs = context.getSharedPreferences("wertis_users", Context.MODE_PRIVATE)

    private val _users = MutableStateFlow(load())
    val users: StateFlow<UsersState> = _users

    /** Bieżący użytkownik — czytany synchronicznie przez UserHeaderInterceptor. */
    val currentUser: String get() = _users.value.current

    /** Czy ktoś już wybrał użytkownika na tym urządzeniu (Splash przy 1. starcie). */
    val hasChosen: Boolean get() = prefs.contains("current")

    private fun load(): UsersState {
        val current = prefs.getString("current", null) ?: DEFAULT_USER
        val list = try {
            WertisJson.decodeFromString(ListSerializer(String.serializer()), prefs.getString("list", "[]") ?: "[]")
                .map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        } catch (_: Exception) {
            emptyList()
        }.ifEmpty { listOf(current) }
        return UsersState(if (current in list) list else list + current, current)
    }

    private fun persist(state: UsersState) {
        prefs.edit {
            putString("list", WertisJson.encodeToString(ListSerializer(String.serializer()), state.list))
            putString("current", state.current)
        }
        _users.value = state
    }

    /** Dodaj użytkownika (lub wskaż istniejącego o tej nazwie) i ustaw jako aktywnego. */
    fun addUser(name: String): String? {
        val n = name.trim().take(MAX_USER_LEN)
        if (n.isEmpty()) return null
        val state = _users.value
        val existing = state.list.find { it.equals(n, ignoreCase = true) }
        persist(
            UsersState(
                list = if (existing != null) state.list else state.list + n,
                current = existing ?: n,
            )
        )
        return _users.value.current
    }

    fun selectUser(name: String) {
        val state = _users.value
        if (name !in state.list || state.current == name) {
            // ponowny wybór tego samego = potwierdzenie na Splash (zapisz „wybrano”)
            if (state.current == name) persist(state)
            return
        }
        persist(state.copy(current = name))
    }

    /** Usuń z listy; zawsze musi zostać co najmniej jeden użytkownik. */
    fun removeUser(name: String) {
        val state = _users.value
        if (state.list.size <= 1) return
        val list = state.list.filter { it != name }
        persist(UsersState(list, if (state.current == name) list[0] else state.current))
    }
}

/** Inicjały do awatara w pasku (np. „Jan Kowalski” → JK). */
fun userInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.isEmpty()) return "?"
    return parts.take(2).joinToString("") { it.first().uppercase() }
}
