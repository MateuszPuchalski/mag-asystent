package pl.wertis.kolektor.ui.wms

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.wms.WmsPutawayBin
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.theme.InkMute

// Przyjęcie i odkładanie potrzebują tej samej pojemności, bez pełnej listy przed bieżącą czynnością.
@Composable
internal fun WmsLocationHints(bins: List<WmsPutawayBin>, expanded: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val firstBin = bins.firstOrNull()
    if (firstBin == null) {
        Text("Brak podpowiedzi. Sprawdź miejsce na zarejestrowanej półce.", color = InkMute)
    } else {
        Text("Miejsce według ostatniego odczytu:", color = InkMute)
        Text(firstBin.hint, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        if (bins.size > 1) {
            OutlineButton(if (expanded) "ZWIŃ INNE MIEJSCA" else "INNE MIEJSCA (${bins.size - 1})", enabled = enabled, modifier = Modifier.fillMaxWidth(), onClick = onToggle)
            if (expanded) {
                bins.drop(1).forEach { Text(it.hint, color = InkMute) }
            }
        }
    }
}
