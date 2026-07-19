package pl.wertis.kolektor.ui.queue

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ApiError
import pl.wertis.kolektor.core.net.QueueItem
import pl.wertis.kolektor.core.net.QueueStatus
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Muted
import pl.wertis.kolektor.ui.theme.Success

/* ── Kolejka Sfery — port web/src/screens/Queue.tsx ─────────────────────────
   Lista zadań workera (ostatnie 100), PONÓW przy błędzie, ANULUJ dla
   oczekujących, pull-to-refresh. Dane z QueueRepository (poll 1.5 s).        */

private fun statusLabel(s: QueueStatus): String = when (s) {
    QueueStatus.PENDING -> "w kolejce"
    QueueStatus.PROCESSING -> "zapisuję…"
    QueueStatus.WAITING_FOR_DOC -> "czeka na dokument"
    QueueStatus.DONE -> "zapisane"
    QueueStatus.ERROR -> "błąd"
    QueueStatus.CANCELLED -> "anulowane"
}

private fun statusColors(s: QueueStatus): Pair<Color, Color> = when (s) {
    QueueStatus.DONE -> Success.copy(alpha = 0.15f) to Success
    QueueStatus.ERROR -> Destructive.copy(alpha = 0.12f) to Destructive
    QueueStatus.PENDING, QueueStatus.PROCESSING, QueueStatus.WAITING_FOR_DOC -> AmberBg to AmberInk
    QueueStatus.CANCELLED -> Muted to InkMute
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueScreen(graph: AppGraph) {
    val queue by graph.queueRepo.queue.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    val items = queue?.items

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            graph.queueRepo.refreshNow()
            scope.launch { delay(600); refreshing = false }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        if (items == null) {
            LoadingRow()
        } else if (items.isEmpty()) {
            Text(
                "Kolejka pusta — wszystko zapisane w Subiekcie",
                color = InkMute,
                fontSize = 14.sp,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(items, key = { it.id }) { item ->
                    QueueRow(
                        item = item,
                        onRetry = {
                            scope.launch {
                                try {
                                    apiCall { graph.api.retry(item.id) }
                                    graph.queueRepo.refreshNow()
                                } catch (e: Exception) {
                                    graph.effects.toast(if (e is ApiError) e.message ?: "Błąd" else "Błąd połączenia")
                                }
                            }
                        },
                        onCancel = {
                            scope.launch {
                                try {
                                    apiCall { graph.api.cancel(item.id) }
                                    graph.queueRepo.refreshNow()
                                    graph.effects.toast("Anulowano")
                                } catch (e: Exception) {
                                    graph.effects.toast(
                                        if (e is ApiError && e.status == 409) "Worker już zabrał zadanie" else "Błąd połączenia"
                                    )
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun QueueRow(item: QueueItem, onRetry: () -> Unit, onCancel: () -> Unit) {
    val (bg, fg) = statusColors(item.status)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, BorderCol, RoundedCornerShape(10.dp))
            .background(CardWhite)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(item.label, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink, maxLines = 1)
                if (item.detail.isNotEmpty()) {
                    Text(item.detail, fontSize = 12.sp, color = InkSoft, maxLines = 2)
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    statusLabel(item.status),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = fg,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(bg)
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
                Text(item.time, fontSize = 10.sp, color = InkMute)
            }
        }
        item.errMsg?.let {
            Text(it, fontSize = 12.sp, color = Destructive)
        }
        when (item.status) {
            QueueStatus.ERROR -> OutlineButton("PONÓW", modifier = Modifier.fillMaxWidth(), onClick = onRetry)
            QueueStatus.PENDING -> OutlineButton("ANULUJ", danger = true, modifier = Modifier.fillMaxWidth(), onClick = onCancel)
            else -> {}
        }
    }
}
