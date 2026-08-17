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
import androidx.compose.foundation.layout.heightIn
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
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.core.net.DeliveryLineView
import pl.wertis.kolektor.core.net.PrzesylkaBody
import pl.wertis.kolektor.core.net.RaiseProblemBody
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.problem.problemBlocker
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.device.PhotoCapture
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
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

/* ── Niezgodność w dostawie (§4.6, D8) ───────────────────────────────────────
   Od 0.21.0 arkusz zbiera DOKŁADNIE to, czego żąda firmowy formularz
   „Niezgodność w dostawie": pięć kategorii i pola per kategoria. Wcześniej
   kolektor zbierał własny zestaw siedmiu typów, a różnicę uzupełniało biuro
   z pamięci, po fakcie.

   Typy są zamknięte — otwarte pole „opisz problem" daje dane, których nikt nie
   policzy. Przy uszkodzeniu i błędnym artykule zdjęcie jest OBOWIĄZKOWE: bez
   dowodu nie ma rozmowy z dostawcą, jest tylko wersja.

   Blokadę pokazujemy jako zdanie pod przyciskiem, a nie jako wyszarzenie bez
   powodu — magazynier w alejce musi wiedzieć, czego brakuje.

   ARKUSZ OD DOŁU, NIE PEŁNY EKRAN. Wcześniej ten composable wchodził przez
   `return` przed listą pozycji i gasił ją całkowicie. Zgłoszenie wyjątku
   potrzebuje miejsca (kafle, ilość, notatka, aparat), ale nie potrzebuje
   ZABIERAĆ kontekstu: pod spodem ma zostać widok dostawy, z którego widać,
   ile jeszcze zostało i czy ta pozycja jest ostatnia.

   CZEGO ARKUSZ NIE PYTA: numeru faktury, dostawcy ani numeru katalogowego
   pozycji z dokumentu. To wszystko już jest w bazie — pytanie o nie byłoby
   przepisywaniem z ekranu na ekran.                                          */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProblemSheet(
    graph: AppGraph,
    deliveryId: Long,
    line: DeliveryLineView?,
    /** Typ wybrany z góry (skrót „INNA ILOŚĆ") — oszczędza szukanie kafla. */
    initialType: ProblemType? = null,
    /** Numer przesyłki zapisany wcześniej na tej dostawie; null = jeszcze nie pytano. */
    nrPrzesylkiZapisany: String? = null,
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

    /** Numer katalogowy artykułu SPOZA dokumentu — nie ma go skąd odczytać. */
    var symObcy by remember { mutableStateOf("") }
    /** Ilość zamówionego, które nie przyszło — w formularzu opcjonalna. */
    var zamiastIlosc by remember { mutableStateOf("") }
    var zamiastOtwarte by remember { mutableStateOf(false) }
    /** Numer przesyłki i protokół kuriera — pytane raz na CAŁĄ dostawę. */
    var nrPrzesylki by remember { mutableStateOf(nrPrzesylkiZapisany ?: "") }
    var kurierProtokol by remember { mutableStateOf<String?>(null) }

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

    /* Skan zamiast klawiatury: numer katalogowy obcego artykułu jest na jego
       etykiecie, numer przesyłki — na liście przewozowym; oba kody leżą
       w zasięgu ręki, a przepisywanie ich w rękawicach to najdłuższe pisanie
       w całym formularzu. Skan trafia do pierwszego PUSTEGO z tych pól;
       poza tym arkusz połyka skany jak dotąd (przypadkowy strzał skanera nie
       może przewinąć zgłoszenia). Wedge i tak pisze do pola z fokusem — ta
       droga obsługuje skanery systemowe Zebra/Honeywell. */
    ScanHandlerEffect { scan ->
        when {
            chosen?.symObcyRequired == true && symObcy.isBlank() -> {
                symObcy = scan.code
                graph.feedback.beep(true)
            }
            chosen == ProblemType.DAMAGED && nrPrzesylkiZapisany.isNullOrBlank() && nrPrzesylki.isBlank() -> {
                nrPrzesylki = scan.code
                graph.feedback.beep(true)
            }
        }
        true
    }
    /** Pytamy o przesyłkę tylko przy pierwszym uszkodzeniu w tej dostawie. */
    val pytamOPrzesylke = chosen == ProblemType.DAMAGED && nrPrzesylkiZapisany.isNullOrBlank()
    val blocker = chosen?.let {
        problemBlocker(
            type = it,
            qty = qtyValue,
            hasPhoto = photoFile != null,
            symObcy = symObcy,
            nrPrzesylki = nrPrzesylki.ifBlank { nrPrzesylkiZapisany },
            lineId = line?.id,
        )
    }

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
                /* Przesyłka IDZIE PIERWSZA. Gdyby szła po zgłoszeniu, zerwane
                   Wi-Fi zostawiłoby uszkodzenie bez numeru przesyłki — a numer
                   jest tym, czym przewoźnik odnajduje paczkę. */
                if (pytamOPrzesylke) {
                    apiCall {
                        graph.api.zapiszPrzesylke(
                            deliveryId,
                            PrzesylkaBody(
                                nrPrzesylki = nrPrzesylki.trim(),
                                kurierProtokol = kurierProtokol,
                            ),
                        )
                    }
                }
                apiCall {
                    graph.api.raiseProblem(
                        deliveryId,
                        RaiseProblemBody(
                            typ = t.key,
                            lineId = line?.id,
                            qty = qtyValue,
                            symObcy = symObcy.trim().takeIf { it.isNotEmpty() },
                            zamiastIlosc = zamiastIlosc.replace(',', '.').toDoubleOrNull(),
                            opis = note.trim().takeIf { it.isNotEmpty() },
                            photoBase64 = base64,
                        ),
                    )
                }
                PhotoCapture.discard(photoFile)
                // sygnał ZAPISU — zgłoszenie przyjęte
                graph.feedback.zapis()
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
                "Niezgodność w dostawie",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
        }

        if (line != null) {
            Row(
                Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                /* Z powiększeniem: zgłaszający porównuje wadliwą sztukę w ręce
                   ze wzorcem z kartoteki, a karta tożsamości nie ma tu innego
                   gestu, który tap mógłby ukraść. */
                MiniaturaTowaru(graph, line.twId, 56.dp, powieksz = true)
                Column(Modifier.weight(1f)) {
                    Text(line.sym, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Ink)
                    Text(line.name, fontSize = 12.sp, color = InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(
                        "${iloscZJednostka(line.qtyDoc, line.unit)} wg dokumentu · ${line.locExpected ?: "BRAK LOKALIZACJI"}",
                        fontSize = 11.5.sp,
                        color = InkMute,
                    )
                }
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

        if (chosen != null) {
            /* Numer katalogowy artykułu SPOZA dokumentu. Dla pozycji z faktury
               bierzemy go z `line.sym` — symbol z Subiekta JEST numerem
               katalogowym dostawcy, więc pytanie o niego byłoby przepisywaniem. */
            if (chosen.symObcyRequired) {
                WertisTextField(
                    value = symObcy,
                    onValueChange = { symObcy = it },
                    placeholder = "Numer katalogowy — zeskanuj albo wpisz",
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // przy złej ilości pokazujemy zamówioną jako TEKST — jest na
            // dokumencie i nie ma powodu, żeby ktokolwiek ją przepisywał
            if (chosen == ProblemType.QTY_MISMATCH && line != null) {
                Text(
                    "Zamówiono ${iloscZJednostka(line.qtyDoc, line.unit)} — podaj, ile faktycznie przyszło.",
                    fontSize = 12.5.sp,
                    color = InkSoft,
                )
            }

            WertisTextField(
                value = qty,
                onValueChange = { qty = it.filter { c -> c.isDigit() || c == ',' || c == '.' } },
                placeholder = etykietaIlosci(chosen),
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )

            /* „A miało przyjść" jest w formularzu OPCJONALNE, więc startuje
               zwinięte — pole, którego nikt nie musi wypełnić, nie ma prawa
               wydłużać ścieżki przy palecie. */
            if (chosen == ProblemType.WRONG_ITEM) {
                if (zamiastOtwarte) {
                    Text(
                        if (line != null) "Zamiast: ${line.sym}" else "Zamiast zamówionego artykułu",
                        fontSize = 12.5.sp,
                        color = InkSoft,
                    )
                    WertisTextField(
                        value = zamiastIlosc,
                        onValueChange = {
                            zamiastIlosc = it.filter { c -> c.isDigit() || c == ',' || c == '.' }
                        },
                        placeholder = "Ile miało przyjść (opcjonalnie)",
                        keyboardType = KeyboardType.Number,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    OutlineButton(
                        "+ A MIAŁO PRZYJŚĆ",
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { zamiastOtwarte = true },
                    )
                }
            }

            /* Numer przesyłki i protokół kuriera dotyczą CAŁEJ paczki, więc
               pytamy o nie raz na dostawę. Przy drugim uszkodzonym artykule
               pola już nie wracają — odpowiedź jest ta sama. */
            if (pytamOPrzesylke) {
                WertisTextField(
                    value = nrPrzesylki,
                    onValueChange = { nrPrzesylki = it },
                    placeholder = "Nr przesyłki — zeskanuj list przewozowy albo wpisz",
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Czy spisano protokół z kurierem?", fontSize = 12.5.sp, color = InkSoft)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // trzeci stan („nie pytano") zostaje możliwy: brak wyboru
                    // wysyła null, zamiast kłamać przewoźnikowi, że było „nie"
                    ChoiceChip("TAK", kurierProtokol == "tak", Modifier.weight(1f)) {
                        kurierProtokol = if (kurierProtokol == "tak") null else "tak"
                    }
                    ChoiceChip("NIE", kurierProtokol == "nie", Modifier.weight(1f)) {
                        kurierProtokol = if (kurierProtokol == "nie") null else "nie"
                    }
                }
            } else if (chosen == ProblemType.DAMAGED) {
                Text(
                    "Przesyłka $nrPrzesylkiZapisany — zapisana przy poprzednim zgłoszeniu.",
                    fontSize = 12.5.sp,
                    color = InkMute,
                )
            }

            WertisTextField(
                value = note,
                onValueChange = { note = it },
                placeholder = "Uwagi (opcjonalnie)",
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

/**
 * Etykieta pola ilości. Jedno słowo „ilość" znaczy co innego w każdej
 * kategorii, a magazynier ma wpisać liczbę bez zastanawiania się, którą.
 */
private fun etykietaIlosci(type: ProblemType): String = when (type) {
    ProblemType.MISSING_ITEM -> "Ile sztuk brakuje"
    ProblemType.QTY_MISMATCH -> "Ile faktycznie przyszło"
    ProblemType.DAMAGED -> "Ile sztuk uszkodzonych"
    ProblemType.WRONG_ITEM, ProblemType.EXTRA_ITEM -> "Ile sztuk przyszło"
}

/** Odpowiedź TAK/NIE jako kafel — rękawica trafia w 48dp, nie w checkbox. */
@Composable
private fun ChoiceChip(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AmberBg else CardWhite)
            .border(if (selected) 2.dp else 1.dp, if (selected) Amber else CardBorder, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            fontFamily = BarlowCond,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = if (selected) AmberInk else InkSoft,
        )
    }
}

@Composable
private fun TypeTile(type: ProblemType, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) AmberBg else CardWhite)
            .border(if (selected) 2.dp else 1.dp, if (selected) Amber else CardBorder, RoundedCornerShape(12.dp))
            // 48 dp zadeklarowane, nie założone — komentarz przy kaflach mówi
            // „rękawica trafia w 48dp", więc niech to będzie prawda z kodu
            .heightIn(min = 48.dp)
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
        // ilości wymaga każda kategoria, więc podpisujemy tylko to, co wyróżnia
        if (type.photoRequired) {
            Text("wymaga zdjęcia", fontSize = 10.5.sp, color = InkMute)
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
