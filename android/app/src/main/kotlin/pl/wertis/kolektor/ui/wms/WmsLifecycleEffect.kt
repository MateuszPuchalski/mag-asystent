package pl.wertis.kolektor.ui.wms

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.wms.WmsContext
import pl.wertis.kolektor.core.scan.ScanHandler
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.scan.WedgeKeySource

/** Router sprzętowy może dostarczyć kod przed następną klatką Compose.
 * Sprawdzamy stan w chwili skanu, bez czekania na odświeżenie ready na ekranie. */
@Composable
fun WmsScanHandlerEffect(handler: ScanHandler) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    ScanHandlerEffect { scan ->
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) handler(scan) else true
    }
}

/** Jeden powrót oznacza jeden świeży odczyt. Pauza anuluje tylko ten odczyt,
 * a operacje zapisane w dzienniku mogą dokończyć potwierdzenie w appScope. */
@Composable
fun WmsLifecycleEffect(graph: AppGraph, context: WmsContext?, activate: () -> Unit, invalidate: () -> Unit,
    open: suspend (WmsContext) -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, context) {
        var refresh: Job? = null
        WedgeKeySource.wmsMode(true)
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    activate()
                    refresh?.cancel()
                    refresh = context?.let { bound -> graph.appScope.launch { open(bound) } }
                }
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    invalidate()
                    refresh?.cancel()
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            invalidate()
            refresh?.cancel()
            WedgeKeySource.wmsMode(false)
        }
    }
}
