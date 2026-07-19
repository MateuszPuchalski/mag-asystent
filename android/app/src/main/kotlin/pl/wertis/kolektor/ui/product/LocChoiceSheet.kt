package pl.wertis.kolektor.ui.product

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.core.net.LocAction
import pl.wertis.kolektor.core.net.ProductCard
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft

/* ── Wybór przy wielu lokalizacjach — port LocChoiceDrawer.tsx ──────────────
   ZASTĄP WSZYSTKIE / DODAJ JAKO KOLEJNĄ / ZASTĄP JEDNĄ Z…                    */

data class LocChoice(val action: LocAction, val value: String, val replaced: String? = null)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun LocChoiceSheet(
    product: ProductCard,
    code: String?,
    onClose: () -> Unit,
    onPick: (LocChoice, String) -> Unit,
) {
    if (code == null) return
    var pickOne by remember(code) { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onClose, containerColor = CardWhite) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                buildString {
                    append("Towar ma ${product.locs.size} lokalizacje — co z $code?")
                },
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = Ink,
            )
            PrimaryButton(
                "ZASTĄP WSZYSTKIE",
                tall = true,
                modifier = Modifier.fillMaxWidth(),
            ) { onPick(LocChoice(LocAction.REPLACE, code), "Lokalizacja zapisana") }
            Text(
                "usuniesz: ${product.locs.joinToString(", ")} · zostanie: $code",
                fontSize = 11.sp,
                color = InkSoft,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlineButton(
                "DODAJ JAKO KOLEJNĄ",
                tall = true,
                modifier = Modifier.fillMaxWidth(),
            ) { onPick(LocChoice(LocAction.ADD, code), "Lokalizacja dodana") }

            if (!pickOne) {
                OutlineButton(
                    "ZASTĄP JEDNĄ Z… ▾",
                    tall = true,
                    modifier = Modifier.fillMaxWidth(),
                ) { pickOne = true }
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    product.locs.forEach { old ->
                        OutlineButton("$old → $code") {
                            onPick(LocChoice(LocAction.REPLACE_ONE, code, replaced = old), "Lokalizacja zapisana")
                        }
                    }
                }
            }
            Text(
                "Anuluj",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = InkMute,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onClose)
                    .padding(8.dp),
            )
        }
    }
}
