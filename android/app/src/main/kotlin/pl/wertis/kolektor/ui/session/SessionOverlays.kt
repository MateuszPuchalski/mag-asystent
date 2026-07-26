package pl.wertis.kolektor.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.data.PytanieOPrzejecie
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.Paper

/* ── Blokada i przejęcie pracy (plan §7) ─────────────────────────────────── */

/**
 * Ekran blokady po bezczynności.
 *
 * Mówi wprost, że NIC NIE ZGINĘŁO — i to jest jego główna treść, nie ozdoba.
 * Człowiek, który zobaczy ekran logowania po dziesięciu minutach przerwy,
 * zakłada najgorsze: że trzydzieści rozłożonych pozycji trzeba robić od nowa.
 * Ten strach wystarczy, żeby aplikacja wróciła do szuflady, nawet jeśli dane
 * naprawdę są bezpieczne.
 */
@Composable
fun LockOverlay(osoba: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Ink.copy(alpha = 0.94f))
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🔒", fontSize = 48.sp)
        Text(
            "Sesja zablokowana",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 28.sp,
            color = Amber,
        )
        Text(
            osoba,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = CardWhite,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            "Nic nie zginęło — otwarta dostawa i cały postęp czekają.\n" +
                "Zeskanuj swój badge, żeby wrócić do pracy.",
            fontSize = 14.sp,
            color = CardWhite,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}

/**
 * Pytanie o przejęcie pracy.
 *
 * Skan cudzego badge'a NIGDY nie przełącza tożsamości sam z siebie. Ciche
 * przełączenie podpisałoby pozycje odłożone przez jedną osobę nazwiskiem
 * drugiej — i nikt by się o tym nie dowiedział, bo w audycie nie byłoby śladu
 * po samym przełączeniu.
 */
@Composable
fun HandoverDialog(
    pytanie: PytanieOPrzejecie,
    kontekst: String?,
    onPotwierdz: () -> Unit,
    onOdrzuc: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .padding(20.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Paper)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Przejąć pracę?",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 24.sp,
                color = Ink,
            )
            Text(
                if (kontekst != null) "Trwa: $kontekst" else "Na kolektorze jest otwarta praca.",
                fontSize = 14.sp,
                color = Ink,
            )
            Text(
                "Rozpoczęte przez: ${pytanie.od}",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
            )
            Text(
                "Od tej chwili operacje będą podpisane Twoim nazwiskiem. " +
                    "Przejęcie zostanie zapisane w historii.",
                fontSize = 12.sp,
                color = InkMute,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlineButton("NIE", modifier = Modifier.weight(1f)) { onOdrzuc() }
                PrimaryButton("PRZEJMUJĘ", modifier = Modifier.weight(1f)) { onPotwierdz() }
            }
        }
    }
}
