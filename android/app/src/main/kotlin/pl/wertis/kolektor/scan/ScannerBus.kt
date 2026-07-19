package pl.wertis.kolektor.scan

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import pl.wertis.kolektor.core.scan.Scan
import pl.wertis.kolektor.core.scan.ScanHandler

/* ── Globalny router skanów — port web/src/lib/scanner.ts ───────────────────
   Stos handlerów: ostatnio zarejestrowany ekran ma pierwszeństwo; zwrot false
   = przekaż niżej, aż do fallbacku (App: EAN→karta, LOC→zawartość). Źródła
   sprzętowe (Honeywell/Zebra/wedge) wołają dispatch z dowolnego wątku —
   normalizujemy na główny.                                                   */

object ScannerBus {
    private val handlers = ArrayDeque<ScanHandler>() // stos
    private var fallback: ScanHandler? = null
    private val main = Handler(Looper.getMainLooper())

    fun setFallback(h: ScanHandler?) {
        fallback = h
    }

    fun push(h: ScanHandler) = synchronized(handlers) { handlers.addLast(h) }

    fun remove(h: ScanHandler) = synchronized(handlers) { handlers.remove(h) }

    /** Wyślij skan do aktywnych handlerów (używane też przez dialog DEV). */
    fun dispatch(scan: Scan) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { dispatchOnMain(scan) }
        } else {
            dispatchOnMain(scan)
        }
    }

    private fun dispatchOnMain(scan: Scan) {
        val snapshot = synchronized(handlers) { handlers.toList() }
        for (h in snapshot.asReversed()) {
            if (h(scan)) return
        }
        fallback?.invoke(scan)
    }
}

/** Rejestracja handlera skanów na czas życia ekranu (jak useScanHandler). */
@Composable
fun ScanHandlerEffect(handler: ScanHandler) {
    val latest by rememberUpdatedState(handler)
    DisposableEffect(Unit) {
        val h: ScanHandler = { latest(it) }
        ScannerBus.push(h)
        onDispose { ScannerBus.remove(h) }
    }
}
