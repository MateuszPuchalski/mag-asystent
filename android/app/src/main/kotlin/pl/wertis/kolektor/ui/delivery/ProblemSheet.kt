package pl.wertis.kolektor.ui.delivery

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.DeliveryLineView
import pl.wertis.kolektor.core.net.RaiseProblemBody
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.problem.problemBlocker
import pl.wertis.kolektor.device.PhotoCapture
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.components.formatQty
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.CardBorder
import pl.wertis.kolektor.ui.theme.CardWhite
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Paper
import pl.wertis.kolektor.ui.theme.Muted
import pl.wertis.kolektor.ui.theme.cardSurface
import java.io.File

/* ── Zgłoszenie wyjątku (§4.6, D8) ───────────────────────────────────────────
   Typy są zamknięte — otwarte pole „opisz problem" daje dane, których nikt nie
   policzy. Przy uszkodzeniu / złym towarze / nieznanym kodzie zdjęcie jest
   OBOWIĄZKOWE: bez dowodu nie ma rozmowy z dostawcą, jest tylko wersja.

   Blokadę pokazujemy jako zdanie pod przyciskiem, a nie jako wyszarzenie bez
   powodu — magazynier w alejce musi wiedzieć, czego brakuje.

   ARKUSZ OD DOŁU, NIE PEŁNY EKRAN. Wcześniej ten composable wchodził przez
   `return` przed listą pozycji i gasił ją całkowicie. Zgłoszenie wyjątku
   potrzebuje miejsca (siedem kafli, notatka, aparat), ale nie potrzebuje
   ZABIERAĆ kontekstu: pod spodem ma zostać widok dostawy, z którego widać,
   ile jeszcze zostało i czy ta pozycja jest ostatnia.                         */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProblemSheet(
    graph: AppGraph,
    deliveryId: Long,
    line: DeliveryLineView?,
    /** Typ wybrany z góry (skrót „INNA ILOŚĆ") — oszczędza szukanie kafla. */
    initialType: ProblemType? = null,
    onDone: () -> Unit,
    onCancel: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var type by remember { mutableStateOf(initialType) }
    var qty by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var photoFile by remember { mutableStateOf<File?>(null) }
    var busy by remember { mutableStateOf(false) }

    // podgląd miniatury — magazynier musi zobaczyć, że kadr nie jest rozmazany
    var preview by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    LaunchedEffect(photoFile) {
        val f = photoFile
        preview = if (f == null) null else withContext(Dispatchers.IO) {
            runCatching { BitmapFactory.decodeFile(f.absolutePath, thumbOpts())?.asImageBitmap() }.getOrNull()
        }
    }

    var pending by remember { mutableStateOf<File?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) {
            PhotoCapture.discard(photoFile) // poprzedni kadr nie jest już potrzebny
            photoFile = pending
        } else {
            PhotoCapture.discard(pending)
        }
        pending = null
    }

    fun shoot() {
        runCatching {
            val (file, uri) = PhotoCapture.newTarget(context)
            pending = file
            camera.launch(uri)
        }.onFailure {
            graph.effects.toast("Brak aparatu na tym urządzeniu")
        }
    }

    val chosen = type
    val qtyValue = qty.replace(',', '.').toDoubleOrNull()
    val blocker = chosen?.let { problemBlocker(it, qtyValue, photoFile != null) }

    fun submit() {
        val t = chosen ?: return
        if (blocker != null || busy) return
        busy = true
        scope.launch {
            try {
                val base64 = photoFile?.let {
                    withContext(Dispatchers.IO) { PhotoCapture.encode(it) }
                }
                if (photoFile != null && base64 == null) {
                    graph.effects.toast("Nie udało się odczytać zdjęcia — zrób je jeszcze raz")
                    busy = false
                    return@launch
                }
                apiCall {
                    graph.api.raiseProblem(
                        deliveryId,
                        RaiseProblemBody(
                            typ = t.key,
                            lineId = line?.id,
                            qty = qtyValue,
                            opis = note.trim().takeIf { it.isNotEmpty() },
                            photoBase64 = base64,
                        ),
                    )
                }
                PhotoCapture.discard(photoFile)
                graph.feedback.beep(true)
                graph.problemsRepo.refresh()
                graph.effects.toast("Zgłoszono: ${t.label}")
                onDone()
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się zgłosić")
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = {
            PhotoCapture.discard(photoFile)
            onCancel()
        },
        containerColor = Paper,
    ) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 14.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(20.dp))
            Text(
                "Zgłoś problem",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
        }

        if (line != null) {
            Column(Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 9.dp)) {
                Text(line.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
                Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    "${formatQty(line.qtyDoc)} szt wg dokumentu · ${line.locExpected ?: "BRAK LOKALIZACJI"}",
                    fontSize = 11.5.sp,
                    color = InkMute,
                )
            }
        } else {
            Text("Zgłoszenie dotyczy całej dostawy.", fontSize = 12.5.sp, color = InkSoft)
        }

        // typy jako duże kafle — rękawica trafia w 48dp, nie w listę rozwijaną
        ProblemType.entries.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { t ->
                    TypeTile(t, selected = t == chosen, modifier = Modifier.weight(1f)) { type = t }
                }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }

        if (chosen?.qtyRequired == true) {
            WertisTextField(
                value = qty,
                onValueChange = { qty = it.filter { c -> c.isDigit() || c == ',' || c == '.' } },
                placeholder = "Ilość faktyczna",
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (chosen != null) {
            WertisTextField(
                value = note,
                onValueChange = { note = it },
                placeholder = "Opis (opcjonalnie)",
                modifier = Modifier.fillMaxWidth(),
            )

            PhotoBox(
                required = chosen.photoRequired,
                preview = preview,
                onShoot = { shoot() },
                onDrop = {
                    PhotoCapture.discard(photoFile)
                    photoFile = null
                },
            )
        }

        blocker?.let {
            Text(it, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Destructive)
        }

        PrimaryButton(
            text = if (busy) "ZGŁASZAM…" else "ZGŁOŚ",
            enabled = chosen != null && blocker == null && !busy,
            tall = true,
            modifier = Modifier.fillMaxWidth(),
            onClick = { submit() },
        )
        OutlineButton(
            "ANULUJ",
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
            onClick = {
                PhotoCapture.discard(photoFile)
                onCancel()
            },
        )
    }
    }
}

@Composable
private fun TypeTile(type: ProblemType, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AmberBg else CardWhite)
            .border(if (selected) 2.dp else 1.dp, if (selected) Amber else CardBorder, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            type.label,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = if (selected) AmberInk else Ink,
        )
        if (type.photoRequired) {
            Text("wymaga zdjęcia", fontSize = 10.5.sp, color = InkMute)
        } else if (type.qtyRequired) {
            Text("wymaga ilości", fontSize = 10.5.sp, color = InkMute)
        }
    }
}

@Composable
private fun PhotoBox(
    required: Boolean,
    preview: androidx.compose.ui.graphics.ImageBitmap?,
    onShoot: () -> Unit,
    onDrop: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (preview != null) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Muted),
            ) {
                androidx.compose.foundation.Image(
                    bitmap = preview,
                    contentDescription = "Zdjęcie dowodowe",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlineButton("ZRÓB PONOWNIE", modifier = Modifier.weight(1f), onClick = onShoot)
                OutlineButton("USUŃ", modifier = Modifier.weight(1f), danger = true, onClick = onDrop)
            }
        } else {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(96.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (required) AmberBg else Muted)
                    .border(1.dp, if (required) AmberLine else CardBorder, RoundedCornerShape(12.dp))
                    .clickable(onClick = onShoot),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(WIcons.Camera, null, tint = if (required) AmberInk else InkSoft, modifier = Modifier.size(22.dp))
                    Text(
                        if (required) "ZRÓB ZDJĘCIE (wymagane)" else "ZRÓB ZDJĘCIE",
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = if (required) AmberInk else InkSoft,
                    )
                }
            }
        }
    }
}

/** Miniatura do podglądu — pełny kadr nie ma po co siedzieć w pamięci. */
private fun thumbOpts() = BitmapFactory.Options().apply { inSampleSize = 4 }
