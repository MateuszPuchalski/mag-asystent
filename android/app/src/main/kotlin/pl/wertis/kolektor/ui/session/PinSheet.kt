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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.Paper

/**
 * Pytanie o PIN przed operacją uprzywilejowaną (plan §7).
 *
 * PIN, a nie sam badge, bo badge'e bywają pożyczane („podaj mi swój, mam ręce
 * w oleju"). Przy operacji, której nie da się cofnąć albo która omija cudzą
 * pracę, „ktoś użył mojego badge'a" musi być kłamstwem, a nie wymówką.
 *
 * PIN nie jest nigdzie zapamiętywany — wpisuje się go za każdym razem. Cache
 * „na 5 minut" zamieniłby dowód tożsamości w wygodę, czyli usunął jedyny
 * powód, dla którego ten ekran istnieje.
 */
@Composable
fun PinSheet(
    tytul: String,
    opis: String,
    blad: String?,
    onPotwierdz: (String) -> Unit,
    onAnuluj: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }

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
                tytul,
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 22.sp,
                color = Ink,
            )
            Text(opis, fontSize = 13.sp, color = InkMute)
            blad?.let {
                Text(it, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink)
            }
            WertisTextField(
                value = pin,
                onValueChange = { pin = it.filter { c -> c.isDigit() }.take(8) },
                placeholder = "PIN",
                keyboardType = KeyboardType.NumberPassword,
                visualTransformation = PasswordVisualTransformation(),
                onDone = { onPotwierdz(pin) },
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlineButton("ANULUJ", modifier = Modifier.weight(1f)) { onAnuluj() }
                PrimaryButton(
                    "POTWIERDŹ",
                    modifier = Modifier.weight(1f),
                    enabled = pin.isNotBlank(),
                ) { onPotwierdz(pin) }
            }
        }
    }
}
