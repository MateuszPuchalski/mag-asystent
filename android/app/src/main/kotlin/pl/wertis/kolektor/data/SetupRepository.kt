package pl.wertis.kolektor.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.BadgeBody
import pl.wertis.kolektor.core.net.CreateUserBody
import pl.wertis.kolektor.core.setup.Konto
import pl.wertis.kolektor.core.setup.ZalozoneKonto
import pl.wertis.kolektor.core.setup.kolejnoscWysylki
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Zakładanie kont z kolektora ────────────────────────────────────────────
   Wykonanie listy, której reguły opisuje `core/setup/SetupModel.kt`.

   NAJWAŻNIEJSZE JEST TU ZACHOWANIE PRZY BŁĘDZIE W POŁOWIE. Konta powstają
   jedno po drugim — zerwane Wi-Fi przy czwartym z sześciu zostawia trzy konta
   założone i trzy nie. Nie da się tego cofnąć (konta się NIE kasuje, bo
   historia w `events` musi mieć na co wskazywać), więc jedyne uczciwe wyjście
   to POKAZAĆ, co powstało, i pozwolić dokończyć resztę. Ukrycie tego pod
   komunikatem „błąd zapisu" kończyłoby się drugim przebiegiem i kompletem
   duplikatów.                                                                */

/** Postęp zakładania — UI pokazuje go na żywo, bo lista bywa długa. */
sealed interface StanSetupu {
    data object Wpisywanie : StanSetupu
    data class Zakladanie(val zrobione: Int, val wszystkich: Int) : StanSetupu

    /**
     * Koniec — zawsze z listą tego, co POWSTAŁO, nawet gdy coś padło.
     * `blad != null` znaczy „reszta nie przeszła", nie „nic nie przeszło".
     */
    data class Gotowe(val konta: List<ZalozoneKonto>, val blad: String?) : StanSetupu
}

class SetupRepository(
    private val api: () -> ApiService,
    private val session: SessionRepository,
) {
    private val _stan = MutableStateFlow<StanSetupu>(StanSetupu.Wpisywanie)
    val stan: StateFlow<StanSetupu> = _stan

    /** Czy serwer nie ma jeszcze żadnego konta; `null` = nie udało się zapytać. */
    suspend fun potrzebny(): Boolean? =
        runCatching { apiCall { api().setupPotrzebny() }.potrzebne }.getOrNull()

    /**
     * Zakłada całą listę.
     *
     * @param odZera pusta instalacja — pierwsze konto idzie bez sesji, a zaraz
     *   po nim logujemy się nim, żeby móc założyć resztę.
     * @param pinBiuraIstniejacego PIN zalogowanego biura; wymagany tylko przy
     *   dokładaniu kont do działającej instalacji.
     */
    suspend fun zaloz(
        konta: List<Konto>,
        odZera: Boolean,
        pinBiuraIstniejacego: String? = null,
    ) {
        val kolejka = kolejnoscWysylki(konta, odZera)
        val powstale = mutableListOf<ZalozoneKonto>()
        // PIN biura, którym autoryzujemy KAŻDE kolejne założenie. Przy pustej
        // instalacji poznajemy go dopiero po założeniu pierwszego konta.
        var pinAutora = pinBiuraIstniejacego

        for ((i, k) in kolejka.withIndex()) {
            _stan.value = StanSetupu.Zakladanie(i, kolejka.size)
            val pierwszeBezSesji = odZera && i == 0
            try {
                val u = apiCall {
                    api().createUser(
                        CreateUserBody(
                            name = k.imieNazwisko.trim(),
                            // przy pierwszym koncie serwer i tak wymusza `biuro`,
                            // ale wysyłamy jawnie, żeby żądanie mówiło prawdę
                            role = k.rola.wire,
                            pin = k.pin.ifBlank { null },
                            pinAutora = if (pierwszeBezSesji) null else pinAutora,
                        )
                    )
                }.user
                powstale += ZalozoneKonto(u.name, u.badgeCode, k.rola)

                if (pierwszeBezSesji) {
                    // Logujemy się kontem, które właśnie powstało — bez tego
                    // każde następne żądanie odbije się od „Brak sesji", a lista
                    // zostanie założona w jednej szóstej.
                    apiCall { api().authBadge(BadgeBody(u.badgeCode)) }.let {
                        session.przyjmijZSetupu(it.token, it.user)
                    }
                    pinAutora = k.pin
                }
            } catch (e: Exception) {
                _stan.value = StanSetupu.Gotowe(powstale, komunikat(e, k))
                return
            }
        }
        _stan.value = StanSetupu.Gotowe(powstale, null)
    }

    fun wrocDoWpisywania() {
        _stan.value = StanSetupu.Wpisywanie
    }

    private fun komunikat(e: Exception, k: Konto): String {
        val powod = (e as? ApiError)?.message?.takeIf { it.isNotBlank() } ?: "błąd połączenia"
        return "Zatrzymano na „${k.imieNazwisko}”: $powod"
    }
}
