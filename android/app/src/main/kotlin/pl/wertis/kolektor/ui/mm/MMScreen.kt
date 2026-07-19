package pl.wertis.kolektor.ui.mm

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.floor
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.nav.Screen
import pl.wertis.kolektor.core.net.MmBody
import pl.wertis.kolektor.core.net.MmConflict
import pl.wertis.kolektor.core.net.MmItem
import pl.wertis.kolektor.core.offline.PendingOp
import pl.wertis.kolektor.data.Poll
import pl.wertis.kolektor.data.pollFlow
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary

/* ── MM MGP→MAG — port web/src/screens/MM.tsx ───────────────────────────────
   Stepper ilości (max = mgp.effective, skorygowane o kolejkę), CAŁA ILOŚĆ,
   UTWÓRZ MM → kolejka Sfery (worker tworzy dokument).                        */

@Composable
fun MMScreen(graph: AppGraph) {
    val id = graph.nav.curId ?: return
    val scope = rememberCoroutineScope()

    val poll by remember(id) { pollFlow(2000) { apiCall { graph.api.product(id) } } }
        .collectAsState(initial = Poll())
    val p = poll.data

    val max = (p?.mgp?.effective ?: 1.0).coerceAtLeast(1.0)
    var qty by remember { mutableStateOf(1.0) }
    var sending by remember { mutableStateOf(false) }
    LaunchedEffect(max) { qty = max } // domyślnie cała ilość, jak w PWA

    if (p == null) {
        LoadingRow()
        return
    }

    fun clamp(v: Double) {
        qty = v.coerceIn(1.0, max)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
                .background(CardWhite)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Text(p.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
            Text(p.name, fontSize = 12.sp, color = InkSoft, maxLines = 1)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "MGP",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                letterSpacing = 1.sp,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(AmberBg).padding(horizontal = 10.dp, vertical = 4.dp),
            )
            Text("  →  ", fontSize = 16.sp, color = Ink)
            Text(
                "MAG",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                letterSpacing = 1.sp,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Secondary).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlineButton("−", modifier = Modifier.size(52.dp)) { clamp(floor(qty) - 1) }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    formatQty(qty),
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 46.sp,
                    color = Ink,
                )
                Text("z ${formatQty(p.mgp.effective)} szt na MGP", fontSize = 11.sp, color = InkMute)
            }
            OutlineButton("+", modifier = Modifier.size(52.dp)) { clamp(floor(qty) + 1) }
        }

        OutlineButton("CAŁA ILOŚĆ — ${formatQty(max)} SZT", modifier = Modifier.fillMaxWidth()) { qty = max }

        Spacer(Modifier.weight(1f))

        PrimaryButton(
            "UTWÓRZ MM (${formatQty(qty)} SZT)",
            tall = true,
            enabled = !sending,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (sending) return@PrimaryButton
            sending = true
            scope.launch {
                try {
                    graph.offlineQueue.runOrBuffer(
                        kind = PendingOp.OpKind.MM,
                        user = graph.users.currentUser,
                        mm = MmBody(listOf(MmItem(p.id, qty))),
                    )
                    graph.queueRepo.refreshNow()
                    graph.feedback.beep(true)
                    graph.effects.flashSuccess("MM w kolejce")
                    graph.nav.go(Screen.PRODUCT)
                } catch (e: Exception) {
                    val msg = if (e is MmConflict) "${e.message} (dostępne: ${formatQty(e.available)})" else e.message
                    graph.effects.toast(msg ?: "Błąd MM")
                } finally {
                    sending = false
                }
            }
        }
        Text(
            "Dokument MM utworzy worker Sfery — numer pojawi się w kolejce",
            fontSize = 11.sp,
            color = InkMute,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
