package pl.wertis.kolektor.ui.location

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.ProductRowCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

/* ── Podgląd zawartości lokalizacji — port web/src/screens/Location.tsx ─────
   Skan etykiety regału → co powinno tu leżeć. Skan innej etykiety = przełącz
   podgląd; skan EAN przechodzi do fallbacku (karta towaru).                  */

@Composable
fun LocationScreen(graph: AppGraph) {
    var code by remember { mutableStateOf(graph.nav.locCode.orEmpty()) }

    ScanHandlerEffect { scan ->
        if (scan.kind != ScanKind.LOC) return@ScanHandlerEffect false
        graph.feedback.beep(true)
        code = scan.code
        true
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (code.isEmpty()) {
            // wejście z kafelka „SKANUJ LOKALIZACJĘ” — czekamy na skan
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .border(2.dp, Amber, RoundedCornerShape(14.dp))
                    .background(AmberBgSoft)
                    .padding(vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("▮▮▯▮▯▮▮", fontSize = 22.sp, color = Ink)
                Text(
                    "ZESKANUJ ETYKIETĘ LOKALIZACJI",
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    letterSpacing = 1.sp,
                    color = Ink,
                )
                Text("czekam na skan…", fontSize = 11.sp, color = InkMute)
            }
            return@Column
        }

        val contents by produceState<List<ProductRow>?>(null, code) {
            value = null
            value = try {
                apiCall { graph.api.locationProducts(code) }.products
            } catch (_: Exception) {
                emptyList()
            }
        }

        Text(
            code,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 28.sp,
            color = Ink,
        )

        when {
            contents == null -> LoadingRow()
            contents!!.isEmpty() -> Text(
                "Slot pusty — nic nie powinno tu leżeć",
                color = InkMute,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
            )
            else -> {
                SectionLabel("Powinno tu leżeć (${contents!!.size})")
                contents!!.forEach { row ->
                    ProductRowCard(row) {
                        graph.nav.openProduct(
                            row.id,
                            RecentEntry(row.id, row.sym, row.locs.firstOrNull() ?: "brak lokalizacji"),
                        )
                    }
                }
            }
        }

        Text(
            "skan innej etykiety = przełącz podgląd · skan towaru = karta",
            fontSize = 11.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
