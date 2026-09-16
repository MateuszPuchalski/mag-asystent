package pl.wertis.kolektor.ui.problems

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.net.EanConflictRow
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.core.net.ProblemView
import pl.wertis.kolektor.core.problem.ProblemType
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.SectionLabel
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberInk
import pl.wertis.kolektor.ui.theme.AmberLine
import pl.wertis.kolektor.ui.theme.BarlowCond
import pl.wertis.kolektor.ui.theme.Destructive
import pl.wertis.kolektor.ui.theme.Ink
import pl.wertis.kolektor.ui.theme.InkMute
import pl.wertis.kolektor.ui.theme.InkSoft
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Wyjątki: nierozwiązane zgłoszenia + kolizje EAN (D8, §4.5) ──────────────
   Ten ekran jest powodem, dla którego zgłaszanie problemów ma sens. Zgłoszenie,
   którego nikt nigdy nie zobaczy, to ta sama niewiedza co przed wdrożeniem —
   dopiero lista „nierozwiązane" zamienia wyjątek w zadanie.

   Kolizje EAN są tu obok, bo to ten sam gatunek długu: dane, które zatrzymują
   pracę w alejce, a naprawia się je w biurze.

   ── DRUGA POŁOWA PĘTLI (0.357.0) ─────────────────────────────────────────
   Zdanie wyżej pilnowało wyłącznie kierunku TAM. Do 0.356.0 ekran pobierał
   `unresolved`, więc wyjątek po zamknięciu przez biuro po prostu z niego
   znikał — a z punktu widzenia magazyniera znikniecie bez słowa wygląda
   identycznie jak zignorowanie. To uczy najprostszej rzeczy: nie zgłaszać.

   Sekcja „ROZSTRZYGNIĘTE" mówi, CO postanowiono i KTO, w oknie tygodnia.
   Bez przycisków: to nie jest praca do zrobienia, tylko odpowiedź do
   przeczytania.                                                             */

@Composable
fun ProblemsScreen(graph: AppGraph) {
    val problems by graph.problemsRepo.problems.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var resolving by remember { mutableStateOf<ProblemView?>(null) }

    LaunchedEffect(Unit) { graph.problemsRepo.refreshNow() }

    /* Osobne pobranie, nie rozszerzenie repozytorium: `problemsRepo` niesie
       LICZNIK na pasku każdego ekranu, a rozstrzygnięte nie są zaległością
       i nie mają prawa go podnosić. */
    val rozstrzygniete by produceState<List<ProblemView>>(emptyList()) {
        value = try {
            apiCall { graph.api.rozstrzygnieteProblems() }.problems
        } catch (_: Exception) {
            emptyList()
        }
    }

    val conflicts by produceState<List<EanConflictRow>?>(null) {
        value = try {
            apiCall { graph.api.eanConflicts() }.conflicts
        } catch (_: Exception) {
            emptyList()
        }
    }

    resolving?.let { p ->
        ResolveSheet(
            problem = p,
            onConfirm = { note ->
                scope.launch {
                    val err = graph.problemsRepo.resolve(p.id, note)
                    if (err != null) {
                        graph.effects.toast(err)
                    } else {
                        graph.feedback.beep(true)
                        graph.effects.toast("Wyjątek zamknięty")
                        resolving = null
                    }
                }
            },
            onCancel = { resolving = null },
        )
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (problems.isEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().cardSurface().padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(WIcons.Check, null, tint = Success, modifier = Modifier.size(20.dp))
                Text("Brak nierozwiązanych wyjątków", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink)
            }
        } else {
            SectionLabel("NIEROZWIĄZANE (${problems.size})")
            problems.forEach { p -> ProblemCard(p) { resolving = p } }
        }

        if (rozstrzygniete.isNotEmpty()) {
            SectionLabel("ROZSTRZYGNIĘTE PRZEZ BIURO (${rozstrzygniete.size})")
            Text(
                "Co biuro postanowiło z tym, co zgłosiliście w ostatnim tygodniu.",
                fontSize = 11.5.sp,
                color = InkSoft,
            )
            rozstrzygniete.forEach { p -> RozstrzygnieteCard(p) }
        }

        val c = conflicts
        if (c != null && c.isNotEmpty()) {
            SectionLabel("KOLIZJE KODÓW (${c.size})")
            Text(
                "Ten sam kod na kilku kartotekach zatrzymuje pracę w alejce — do naprawy w Subiekcie.",
                fontSize = 11.5.sp,
                color = InkSoft,
            )
            c.forEach { row -> ConflictCard(graph, row) }
        }
    }
}

/**
 * Wyjątek ZAMKNIĘTY przez biuro (0.357.0).
 *
 * Bez przycisku i bez czerwieni: to nie jest praca do zrobienia, tylko
 * odpowiedź do przeczytania. Czerwień na tym ekranie znaczy „stoi i czeka",
 * a ta karta mówi coś przeciwnego.
 *
 * Notatka biura stoi WYŻEJ niż opis zgłoszenia, odwrotnie niż w karcie
 * otwartej. Magazynier zna własne zgłoszenie — przyszedł tu po odpowiedź,
 * której nie zna.
 */
@Composable
private fun RozstrzygnieteCard(p: ProblemView) {
    Column(
        modifier = Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Check, null, tint = Success, modifier = Modifier.size(17.dp))
            Text(
                ProblemType.labelOf(p.typ),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = Ink,
            )
        }
        p.sym?.let { sym ->
            Text("$sym · ${p.name.orEmpty()}", fontSize = 12.5.sp, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        // NOTATKA PIERWSZA. Jej brak też jest odpowiedzią i też ma swoje zdanie:
        // „zamknięte bez notatki" mówi mniej niż powód, ale nieporównanie
        // więcej niż zniknięcie z listy bez śladu.
        Text(
            p.resolvedNote?.takeIf { it.isNotBlank() } ?: "Zamknięte bez notatki.",
            fontSize = 13.sp,
            color = if (p.resolvedNote.isNullOrBlank()) InkMute else Ink,
        )
        // Nazwisko, nie samo „biuro": z pytaniem idzie się do człowieka.
        Text(
            listOfNotNull(
                p.resolvedBy?.let { "Zamknął(a): $it" } ?: "Zamknęło biuro",
                p.docNumber,
                p.createdBy?.let { "zgłosił(a): $it" },
            ).joinToString(" · "),
            fontSize = 11.5.sp,
            color = InkMute,
        )
    }
}

@Composable
private fun ProblemCard(p: ProblemView, onResolve: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().cardSurface().padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(17.dp))
            Text(
                ProblemType.labelOf(p.typ),
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = Destructive,
            )
            if (p.hasPhoto) {
                Box(
                    Modifier.clip(RoundedCornerShape(6.dp)).background(AmberBg).padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text("ZDJĘCIE", fontSize = 9.5.sp, fontWeight = FontWeight.Bold, color = AmberInk)
                }
            }
        }
        p.sym?.let { sym ->
            Text("$sym · ${p.name.orEmpty()}", fontSize = 12.5.sp, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(
            listOfNotNull(
                p.docNumber,
                p.qty?.let { iloscZJednostka(it, p.unit) },
                p.createdBy,
            ).joinToString(" · "),
            fontSize = 11.5.sp,
            color = InkMute,
        )
        p.opis?.takeIf { it.isNotBlank() }?.let {
            Text(it, fontSize = 12.sp, color = InkSoft)
        }
        OutlineButton(
            "ZAMKNIJ WYJĄTEK",
            modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
            onClick = onResolve,
        )
    }
}

@Composable
private fun ConflictCard(graph: AppGraph, row: EanConflictRow) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = AmberBg, borderColor = AmberLine)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(row.ean, fontFamily = BarlowCond, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Ink)
        Text(
            "${row.twIds.size} kartoteki · ${row.hits} trafień" +
                if (row.autoResolved > 0) " · ${row.autoResolved} rozstrzygnięte kontekstem" else "",
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = AmberInk,
        )
        /* ── DECYZJA BIURA (0.359.0) ─────────────────────────────────────
           Do 0.358.0 ta karta mówiła wyłącznie, ILE razy kod kogoś zatrzymał.
           Biuro patrzyło na tę samą listę w `/biuro` i też nie mogło nic
           powiedzieć — dziennik bez wyjścia z obu stron.

           Dwa rodzaje znaczą dla hali coś PRZECIWNEGO, więc muszą wyglądać
           inaczej: `dopuszczone` to koniec sprawy (wybieraj po symbolu, nie
           zgłaszaj drugi raz), `poprawione` to obietnica, którą kolejne
           trafienie podważa. */
        row.rozstrzygniecie?.let { r ->
            val nieudana = r.rodzaj == "poprawione" && row.trafienPoDecyzji > 0
            Text(
                when {
                    nieudana -> "BIURO: POPRAWIONE — ale kod zatrzymał jeszcze ${row.trafienPoDecyzji}×"
                    r.rodzaj == "poprawione" -> "BIURO: POPRAWIONE — kolizja ma zniknąć"
                    else -> "BIURO: DOPUSZCZONE — wybierz po symbolu, nie zgłaszaj ponownie"
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                // Czerwień TYLKO przy nieudanej poprawce: to jedyny stan, w
                // którym hala ma coś zrobić — powiedzieć biuru, że nie zadziałało.
                color = if (nieudana) Destructive else Success,
            )
            r.notatka?.takeIf { it.isNotBlank() }?.let { nota ->
                Text("$nota · ${r.przez}", fontSize = 11.5.sp, color = InkSoft)
            }
        }
        /* Kartoteki po ludzku: symbol i nazwa, nie surowe tw_Id — z gołego
           identyfikatora nie da się rozpoznać, o które towary chodzi.
           Starszy serwer nie wysyła `towary` — wtedy zostaje dawna linia. */
        if (row.towary.isEmpty()) {
            Text("tw_Id: ${row.twIds.joinToString(", ")}", fontSize = 11.sp, color = InkMute)
        } else {
            row.towary.forEach { t ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 2.dp),
                ) {
                    MiniaturaTowaru(graph, t.twId, 28.dp)
                    Text(
                        if (t.sym.isBlank()) "tw_Id ${t.twId} (kartoteka usunięta)"
                        else t.sym,
                        fontFamily = BarlowCond,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = Ink,
                    )
                    if (t.name.isNotBlank()) {
                        Text(
                            t.name,
                            fontSize = 11.5.sp,
                            color = InkSoft,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/** Zamknięcie wyjątku z notatką — „co z tym zrobiono" jest częścią dowodu. */
@Composable
private fun ResolveSheet(problem: ProblemView, onConfirm: (String?) -> Unit, onCancel: () -> Unit) {
    var note by remember(problem.id) { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Zamknij wyjątek",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 20.sp,
            color = Ink,
        )
        Column(Modifier.fillMaxWidth().cardSurface().padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(ProblemType.labelOf(problem.typ), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Destructive)
            problem.sym?.let { Text("$it · ${problem.name.orEmpty()}", fontSize = 12.5.sp, color = InkSoft) }
            problem.docNumber?.let { Text(it, fontSize = 11.5.sp, color = InkMute) }
        }
        WertisTextField(
            value = note,
            onValueChange = { note = it },
            placeholder = "Co zrobiono (np. nr reklamacji)",
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(
            "ZAMKNIJ",
            tall = true,
            modifier = Modifier.fillMaxWidth(),
            onClick = { onConfirm(note.trim().takeIf { it.isNotEmpty() }) },
        )
        OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
    }
}

/** Pasek na każdym ekranie — dopóki wyjątki wiszą, są widoczne. */
@Composable
fun ProblemsBanner(count: Int, onOpen: () -> Unit) {
    if (count == 0) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Destructive)
            .clickable(onClick = onOpen)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(WIcons.Alert, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp))
        Text(
            if (count == 1) "1 nierozwiązany wyjątek" else "$count nierozwiązanych wyjątków",
            color = androidx.compose.ui.graphics.Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text("POKAŻ", color = androidx.compose.ui.graphics.Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}
