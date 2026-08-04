package pl.wertis.kolektor.ui.chrome

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Paper
import pl.wertis.kolektor.ui.theme.Success

/* ── Nakładki: toast (2.6 s) · plakietka sukcesu (1.5 s) ───────────────────
   Czasy pilnuje UiEffects.                                                   */

@Composable
fun BoxScope.ToastOverlay(msg: String?) {
    if (msg == null) return
    Box(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(horizontal = 16.dp, vertical = 24.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Ink)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(msg, color = CardWhite, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun BoxScope.SuccessOverlay(msg: String?) {
    if (msg == null) return
    Column(
        modifier = Modifier
            .align(Alignment.Center)
            .clip(RoundedCornerShape(16.dp))
            .background(Success)
            .padding(horizontal = 28.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text("✓", color = CardWhite, fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text(msg, color = CardWhite, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
}

@Composable
fun TrybSerwisowyBanner(widoczny: Boolean) {
    /* Czerwony, bez akcji i bez możliwości zamknięcia. To jedyna rzecz na
       ekranie, która mówi, że instalacja nie pyta o hasło — a przełącznik,
       który najgorzej zostawić włączony, musi być widoczny z drugiego końca
       alejki, nie w diagnostyce serwera. */
    if (!widoczny) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Destructive)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "TRYB SERWISOWY — logowanie wyłączone",
            color = Paper,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun OfflineBanner(count: Int, onFlush: () -> Unit) {
    if (count == 0) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(AmberBg)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (count == 1) "1 operacja czeka na sieć" else "$count operacje czekają na sieć",
            color = AmberInk,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text(
            "WYŚLIJ TERAZ",
            color = AmberInk,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onFlush)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}
