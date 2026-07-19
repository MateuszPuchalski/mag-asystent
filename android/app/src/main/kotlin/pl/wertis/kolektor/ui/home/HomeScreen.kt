package pl.wertis.kolektor.ui.home

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.net.ScanResult
import pl.wertis.kolektor.core.scan.DEFAULT_LOC_PREFIX
import pl.wertis.kolektor.core.scan.EAN_RE
import pl.wertis.kolektor.data.RecentEntry
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.ProductRowCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.BorderCol
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute

/* ── Ekran główny: skan / wyszukiwarka / ostatnio skanowane ─────────────────
   Port web/src/screens/Home.tsx. Wykrywanie skanu w polu: tempo znaków
   <50 ms (wedge pisze do pola, gdy ma fokus) albo kształt EAN.               */

private const val SCAN_CHAR_MS = 50L

/** Kod „wygląda jak lokalizacja”: ma literę, nie jest czystym ciągiem cyfr. */
private fun looksLikeLocation(code: String): Boolean =
    code.any { it.isLetter() } && !code.all { it.isDigit() } && !code.any { it.isWhitespace() }

@OptIn(FlowPreview::class)
@Composable
fun HomeScreen(graph: AppGraph) {
    var query by remember { mutableStateOf(graph.nav.pendingSearch.orEmpty()) }
    var results by remember { mutableStateOf<List<ProductRow>>(emptyList()) }
    var fetching by remember { mutableStateOf(false) }
    val recent by graph.recent.recent.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // licznik szybkich znaków (skaner-klawiatura pisze <50 ms/znak)
    val fast = remember { object { var last = 0L; var count = 0 } }

    val queryFlow = remember { MutableStateFlow(graph.nav.pendingSearch.orEmpty()) }
    LaunchedEffect(Unit) {
        graph.nav.pendingSearch = null
        queryFlow.debounce(250).collectLatest { q ->
            val trimmed = q.trim()
            if (trimmed.isEmpty()) {
                results = emptyList()
                return@collectLatest
            }
            fetching = true
            try {
                results = apiCall { graph.api.search(trimmed) }.results
            } catch (_: Exception) {
                /* offline — zostaw poprzednie wyniki */
            } finally {
                fetching = false
            }
        }
    }

    fun openRow(x: ProductRow) {
        graph.nav.openProduct(x.id, RecentEntry(x.id, x.sym, x.locs.firstOrNull() ?: "brak lokalizacji"))
    }

    suspend fun handleScan(code: String) {
        try {
            when (val r = apiCall { graph.api.scan(code) }) {
                is ScanResult.Product -> {
                    graph.feedback.beep(true)
                    graph.nav.openProduct(
                        r.card.id,
                        RecentEntry(r.card.id, r.card.sym, r.card.locs.firstOrNull() ?: "brak lokalizacji"),
                    )
                }
                is ScanResult.Search -> {
                    query = code
                    queryFlow.value = code
                }
                is ScanResult.NotFound -> {
                    // nieznany towar — jeśli kod wygląda jak lokalizacja, pokaż jej zawartość
                    if (looksLikeLocation(code)) {
                        graph.feedback.beep(true)
                        graph.nav.openLocation(code)
                    } else {
                        graph.feedback.beep(false)
                        graph.effects.toast("Nieznany kod: $code")
                    }
                }
            }
        } catch (_: Exception) {
            graph.effects.toast("Błąd połączenia z serwerem")
        }
    }

    fun onEnter() {
        val v = query.trim()
        if (v.isEmpty()) return
        // prefiks skanera dla lokalizacji → od razu podgląd zawartości
        if (v.uppercase().startsWith(DEFAULT_LOC_PREFIX)) {
            fast.count = 0
            query = ""
            queryFlow.value = ""
            graph.nav.openLocation(normalizeLoc(v))
            return
        }
        val isScan = fast.count >= 3 || EAN_RE.matches(v)
        fast.count = 0
        if (isScan) {
            scope.launch { handleScan(v) }
        } else {
            results.firstOrNull()?.let { openRow(it) }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        WertisTextField(
            value = query,
            onValueChange = { newValue ->
                val t = SystemClock.elapsedRealtime()
                if (newValue.length == query.length + 1) {
                    fast.count = if (t - fast.last < SCAN_CHAR_MS) fast.count + 1 else 0
                    fast.last = t
                }
                query = newValue
                queryFlow.value = newValue
            },
            placeholder = "Skanuj lub wpisz symbol / nazwę…",
            imeAction = ImeAction.Search,
            onDone = ::onEnter,
        )

        val q = query.trim()
        if (q.isNotEmpty()) {
            if (results.isNotEmpty()) {
                SectionLabel("Wyniki (${results.size})${if (fetching) " …" else ""}")
                results.forEach { row ->
                    ProductRowCard(row) { openRow(row) }
                }
            } else {
                Text(
                    if (fetching) "Szukam…" else "Brak wyników dla „$q”",
                    color = InkMute,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                )
            }
        } else {
            Text("Dane na żywo z serwera (odczyt SQL z Subiekta)", fontSize = 11.sp, color = InkMute)

            OutlineButton("📍 SKANUJ LOKALIZACJĘ", modifier = Modifier.fillMaxWidth()) {
                graph.nav.openLocation("")
            }

            if (recent.isNotEmpty()) {
                SectionLabel("Ostatnio skanowane")
                recent.forEach { r ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(CardWhite)
                            .clickable { graph.nav.openProduct(r.id, RecentEntry(r.id, r.sym, r.loc)) }
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            r.sym,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = Ink,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            r.loc,
                            fontSize = 12.sp,
                            color = InkMute,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(BorderCol.copy(alpha = 0.5f))
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}
