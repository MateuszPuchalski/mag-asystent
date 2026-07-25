package pl.wertis.kolektor.ui.delivery

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.net.LocApplyAction
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.theme.AmberBgSoft
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Rozjazd lokalizacji (§4.3) ──────────────────────────────────────────────
   Magazynier zeskanował inną półkę, niż mówi kartoteka. Ze skanu NIE DA SIĘ
   odróżnić dwóch sytuacji: „towar przeniesiono" od „towar leży teraz w dwóch
   miejscach". Zgadywanie po stronie serwera kosztowałoby zgubiony towar, więc
   pyta się człowieka — raz, dużym przyciskiem, PRZED zapisem.                 */

@Composable
fun MismatchSheet(
    sym: String,
    expected: String,
    scanned: String,
    onPick: (LocApplyAction) -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = AmberInk, modifier = Modifier.size(20.dp))
            Text(
                "Inna lokalizacja",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .cardSurface(background = AmberBgSoft, borderColor = AmberLine)
                .padding(vertical = 14.dp, horizontal = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
            Text("w kartotece: $expected", fontSize = 13.sp, color = InkSoft)
            Text(
                "zeskanowano: $scanned",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 28.sp,
                color = AmberInk,
            )
        }

        Text(
            "Czy towar został przeniesiony, czy leży teraz w obu miejscach?",
            fontSize = 13.sp,
            color = InkSoft,
        )

        PrimaryButton(
            text = "PRZENIESIONY — ZAMIEŃ",
            tall = true,
            modifier = Modifier.fillMaxWidth(),
            onClick = { onPick(LocApplyAction.REPLACE) },
        )
        OutlineButton(
            "LEŻY W OBU — DODAJ",
            tall = true,
            modifier = Modifier.fillMaxWidth(),
            onClick = { onPick(LocApplyAction.ADD) },
        )
        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}
