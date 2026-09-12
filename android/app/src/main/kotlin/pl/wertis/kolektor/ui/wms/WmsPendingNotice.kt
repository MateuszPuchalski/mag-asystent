package pl.wertis.kolektor.ui.wms

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.wms.WmsContext
import pl.wertis.kolektor.core.wms.WmsPending
import pl.wertis.kolektor.ui.components.PrimaryButton

/** Wspólny komunikat wskazuje proces będący właścicielem nierozliczonego zapisu.
 * Żaden ekran nie oferuje porzucenia operacji ani ponowienia na innym koncie. */
@Composable
fun WmsPendingNotice(graph: AppGraph, pending: WmsPending, context: WmsContext, workflow: String, busy: Boolean, retry: () -> Unit) {
    Text(pending.description, fontWeight = FontWeight.Bold)
    Text("Nie przenoś kolejnych sztuk. Ponowienie sprawdzi ten sam zapis.")
    if (pending.context != context) Text("Wróć do konta i serwera użytych przy tym zapisie.")
    val target = when (pending.workflow) {
        "picking" -> Screen.WMS_PICKING to "WRÓĆ DO ZBIÓRKI WMS"
        "putaway" -> Screen.WMS_PUTAWAY to "WRÓĆ DO ODKŁADANIA WMS"
        "replenishment" -> Screen.WMS_REPLENISHMENT to "WRÓĆ DO UZUPEŁNIENIA WMS"
        "counting" -> Screen.WMS_COUNTING to "WRÓĆ DO PRZELICZENIA WMS"
        "receiving" -> Screen.WMS_RECEIVING to "WRÓĆ DO PRZYJĘCIA WMS"
        else -> null
    }
    if (target == null) Text("Ten zapis wymaga nowszej wersji aplikacji. Nie czyść danych kolektora.")
    else if (pending.workflow != workflow) {
        PrimaryButton(target.second, enabled = !busy, modifier = Modifier.fillMaxWidth()) { graph.nav.go(target.first) }
    } else {
        PrimaryButton("SPRAWDŹ OSTATNI ZAPIS", enabled = !busy && pending.context == context, modifier = Modifier.fillMaxWidth(), onClick = retry)
    }
}
