package pl.wertis.kolektor.data

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import pl.wertis.kolektor.core.net.DziennikCiszy
import pl.wertis.kolektor.core.net.QueueResponse
import pl.wertis.kolektor.core.net.powodOdmowy
import pl.wertis.kolektor.net.ApiService
import pl.wertis.kolektor.net.apiCall

/* ── Jedna wspólna pętla pollingu kolejki Sfery (1.5 s) ─────────────────────
   Zasila pastylkę statusu na każdym ekranie ORAZ ekran kolejki — bez
   zdublowanych żądań (odpowiednik useQueue z refetchInterval 1500).
   Polling działa tylko gdy aplikacja jest na wierzchu (ProcessLifecycle).
   refreshNow() po każdym zapisie = odpowiednik inwalidacji query.            */

/**
 * @param dziennik zapis przerw w łączności — patrz komentarz przy pętli niżej.
 */
class QueueRepository(
    private val api: ApiService,
    scope: CoroutineScope,
    private val dziennik: DziennikCiszy = DziennikCiszy(),
) {
    private val _queue = MutableStateFlow<QueueResponse?>(null)
    val queue: StateFlow<QueueResponse?> = _queue

    /* Serwer, który przestał odpowiadać, nie zostawiał na ekranie ŻADNEGO
       śladu: pastylka i karty trzymają ostatni znany stan (świadomie — patrz
       niżej), więc zamrożone liczby wyglądały jak aktualne. Ta pętla chodzi
       co 1,5 s na każdym ekranie, czyli jest naturalnym heartbeatem serwera —
       trzy porażki z rzędu (~5 s) zapalają baner w AppRoot, pierwszy sukces
       go gasi. Próg, nie pierwsza porażka: pojedynczy timeout w dziurze
       Wi-Fi przy regałach to codzienność, nie awaria. */
    private val _serwerMilczy = MutableStateFlow(false)
    val serwerMilczy: StateFlow<Boolean> = _serwerMilczy
    private var porazkiZRzedu = 0

    /* ── Dziennik przerw (0.323.0) ───────────────────────────────────────────
       Ta pętla jest JEDYNYM miejscem, które puka do serwera co 1,5 s przez całą
       zmianę — czyli jedynym, które wie, kiedy łączność znika i kiedy wraca.
       Baner mówi o tym TERAZ i gaśnie bez śladu, więc pytanie właściciela
       („czy wraca sama, czy trzeba przełączyć Wi-Fi?") nie miało dotąd żadnej
       odpowiedzi poza czyjąś pamięcią.

       Zapis nie dokłada ANI JEDNEGO żądania: bierze wynik, który i tak tu jest.
       Czyta go ekran POŁĄCZENIE z Ustawień. */
    val dziennikCiszy: DziennikCiszy get() = dziennik

    private val kick = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    init {
        scope.launch {
            ProcessLifecycleOwner.get().lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try {
                        _queue.value = apiCall { api.queue() }
                        porazkiZRzedu = 0
                        _serwerMilczy.value = false
                        dziennik.sukces(System.currentTimeMillis())
                    } catch (e: Exception) {
                        /* offline / serwer w restarcie — pastylka trzyma ostatni stan */
                        porazkiZRzedu++
                        if (porazkiZRzedu >= PROG_MILCZENIA) _serwerMilczy.value = true
                        dziennik.porazka(System.currentTimeMillis(), powodOdmowy(e))
                    }
                    // czekaj 1.5 s ALBO obudź się natychmiast po refreshNow()
                    withTimeoutOrNull(1500) { kick.first() }
                }
            }
        }
    }

    /** Natychmiastowe odświeżenie po zapisie (setLocation/MM/retry/cancel…). */
    fun refreshNow() {
        kick.tryEmit(Unit)
    }

    private companion object {
        const val PROG_MILCZENIA = 3
    }
}
