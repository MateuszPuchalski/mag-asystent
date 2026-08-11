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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.ProductRow
import pl.wertis.kolektor.core.recent.RecentEntry
import pl.wertis.kolektor.core.recent.etykietaAdresu
import pl.wertis.kolektor.core.scan.DEFAULT_LOC_PREFIX
import pl.wertis.kolektor.core.scan.EAN_RE
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.scan.classify
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.scan.routeScan
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.ProductRowCard
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Secondary
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Ekran główny: skan / wyszukiwarka / ostatnio skanowane ─────────────────
   Port web/src/screens/Home.tsx. Wykrywanie skanu w polu: tempo znaków
   <50 ms (wedge pisze do pola, gdy ma fokus) albo kształt EAN.               */

private const val SCAN_CHAR_MS = 50L

/**
 * Kod „wygląda jak lokalizacja” — ta sama (przetestowana) reguła co w skanerze,
 * z :core, czyli wzorzec pobrany z serwera. Używane wyłącznie do skrótu przy
 * ręcznym wpisaniu; skan rozstrzyga serwer.
 */
private fun looksLikeLocation(code: String): Boolean = classify(code).kind == ScanKind.LOC

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
        graph.nav.openProduct(x.id, RecentEntry(x.id, x.sym, etykietaAdresu(x.locs.firstOrNull()), x.name))
    }

    // jedna droga skanu dla całej aplikacji — kontekst przyklejony musi
    // działać tak samo tutaj i w globalnym fallbacku (ui/scan/ScanRouter.kt)
    suspend fun handleScan(code: String, manual: Boolean = false) =
        routeScan(graph, code, manual, screen = "home") {
            query = it
            queryFlow.value = it
        }

    fun onEnter() {
        val v = query.trim()
        if (v.isEmpty()) return
        // Kod regału — wpisany czy zeskanowany — idzie tą samą drogą co skan,
        // żeby kontekst przyklejony działał także przy wpisywaniu z ręki.
        val zeSkanera = fast.count >= 3
        val jakSkan = zeSkanera || EAN_RE.matches(v) ||
            v.uppercase().startsWith(DEFAULT_LOC_PREFIX) || looksLikeLocation(v)
        fast.count = 0
        if (jakSkan) {
            query = ""
            queryFlow.value = ""
            // wpisane z ręki liczy się osobno: udział wpisów per regał mówi,
            // która etykieta jest nieczytelna i wymaga przedruku
            scope.launch { handleScan(v, manual = !zeSkanera) }
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
            leadingIcon = WIcons.Search,
            imeAction = ImeAction.Search,
            onDone = ::onEnter,
        )

        val q = query.trim()
        if (q.isNotEmpty()) {
            if (results.isNotEmpty()) {
                SectionLabel("Wyniki (${results.size})${if (fetching) " …" else ""}")
                results.forEach { row ->
                    ProductRowCard(graph, row) { openRow(row) }
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

            // Skan etykiety regału otwiera go wprost, więc to jest dziś ścieżka
            // AWARYJNA — dla zdartej etykiety, którą trzeba wpisać z ręki.
            OutlineButton("REGAŁ — WPISZ KOD RĘCZNIE", leadingIcon = WIcons.Pin, modifier = Modifier.fillMaxWidth()) {
                graph.nav.openLocation("")
            }

            if (recent.isNotEmpty()) {
                SectionLabel("Ostatnio skanowane")
                recent.forEach { r ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .cardSurface()
                            .heightIn(min = 48.dp)
                            // `r` w całości, z nazwą — pominięta gubiła ją
                            // z listy przy pierwszym dotknięciu pozycji
                            .clickable { graph.nav.openProduct(r.id, r) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        /* Ta lista ma cztery pozycje i służy do powrotu do
                           czegoś, co się przed chwilą trzymało w ręku —
                           rozpoznanie po kształcie jest tu szybsze niż
                           czytanie symbolu. Zdjęcia są już w cache'u, bo
                           kartę tego towaru otwierano chwilę wcześniej. */
                        MiniaturaTowaru(graph, r.id, 36.dp)
                        Column(Modifier.weight(1f)) {
                            Text(r.sym, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Ink)
                            // sam symbol słabo działa jako pamięć podręczna —
                            // „który to był W32-…?" rozstrzyga dopiero nazwa
                            if (r.name.isNotBlank()) {
                                Text(
                                    r.name,
                                    fontSize = 11.sp,
                                    color = InkSoft,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(Secondary)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Icon(WIcons.Pin, null, tint = AmberInk, modifier = Modifier.size(13.dp))
                            Text(r.loc, fontSize = 12.sp, color = InkSoft)
                        }
                    }
                }
            }
        }
    }
}
