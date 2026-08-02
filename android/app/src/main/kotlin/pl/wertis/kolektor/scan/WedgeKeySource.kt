package pl.wertis.kolektor.scan

import android.os.SystemClock
import android.view.KeyEvent
import pl.wertis.kolektor.core.scan.GAP_MS
import pl.wertis.kolektor.core.scan.MIN_LEN
import pl.wertis.kolektor.core.scan.classify

/* ── Skaner jako klawiatura (keyboard wedge) — port installScanListener ─────
   Skaner kolektora wpisuje znaki <50 ms/znak i kończy Enterem. Zbieramy
   wejście, gdy fokus NIE jest w polu tekstowym (pola obsługują Enter same).
   MainActivity.dispatchKeyEvent przekazuje tu każde ACTION_DOWN.             */

object WedgeKeySource {
    /* LICZNIK, nie flaga — i to nie jest nadmiarowa ostrożność. Compose przy
       przejściu fokusu między dwoma polami wysyła „zyskał" i „stracił"
       w kolejności, na którą nie ma gwarancji. Flaga bool zapisana przez
       spóźnione „stracił" zostawiłaby zbieranie WŁĄCZONE przy aktywnym polu
       hasła, a wtedy wpisywane znaki poleciałyby przez `classify` do
       wyszukiwarki towarów — czyli hasło wylądowałoby w logu serwera. */
    private val fokusy = java.util.concurrent.atomic.AtomicInteger(0)

    fun ustawFokus(ma: Boolean) {
        if (ma) fokusy.incrementAndGet() else fokusy.updateAndGet { maxOf(0, it - 1) }
    }

    /** Twarde wyłączenie na ekranach, na których nie ma czego skanować. */
    @Volatile var wylaczony: Boolean = false

    private val buf = StringBuilder()
    private var last = 0L

    /** @return true = zdarzenie skonsumowane (Enter kończący skan). */
    fun onKeyDown(event: KeyEvent): Boolean {
        if (wylaczony || fokusy.get() > 0) return false // pole samo obsłuży Enter
        val now = SystemClock.elapsedRealtime()
        if (now - last > GAP_MS) buf.setLength(0)
        last = now

        when (event.keyCode) {
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_TAB -> {
                val code = buf.toString()
                buf.setLength(0)
                if (code.length >= MIN_LEN) {
                    ScannerBus.dispatch(classify(code))
                    return true
                }
                return false
            }
            else -> {
                val ch = event.unicodeChar
                if (ch > 0 && !Character.isISOControl(ch)) buf.appendCodePoint(ch)
                return false
            }
        }
    }
}
