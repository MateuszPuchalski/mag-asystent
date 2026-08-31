package pl.wertis.kolektor.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk

/** Widoczny na każdym ekranie sygnał zastępuje Teamsa i ustne przekazywanie. */
@Composable
fun FieldTasksBanner(graph: AppGraph, open: () -> Unit) {
    var count by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            count = try { apiCall { graph.api.zadaniaTerenowe() }.zadania.count { it.status == "nowe" || it.status == "w_toku" } } catch (_: Exception) { count }
            delay(30_000)
        }
    }
    if (count > 0) Row(Modifier.fillMaxWidth().background(AmberBg).clickable(onClick = open).padding(horizontal = 14.dp, vertical = 9.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("ZADANIA Z BIURA", color = AmberInk, fontWeight = FontWeight.Bold)
        Text(count.toString(), color = AmberInk, fontWeight = FontWeight.Bold)
    }
}
