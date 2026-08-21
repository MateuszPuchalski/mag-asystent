package pl.wertis.kolektor.ui.kosze

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import pl.wertis.kolektor.AppGraph
import pl.wertis.kolektor.core.loc.normalizeLoc
import pl.wertis.kolektor.core.net.KoszPozycja
import pl.wertis.kolektor.core.net.KoszView
import pl.wertis.kolektor.core.net.OdlozKoszBody
import pl.wertis.kolektor.core.net.PominKoszBody
import pl.wertis.kolektor.core.net.ScanBody
import pl.wertis.kolektor.core.scan.ScanKind
import pl.wertis.kolektor.core.text.formatQty
import pl.wertis.kolektor.core.text.iloscZJednostka
import pl.wertis.kolektor.net.apiCall
import pl.wertis.kolektor.scan.ScanHandlerEffect
import pl.wertis.kolektor.ui.components.LoadingRow
import pl.wertis.kolektor.ui.components.LokPastylka
import pl.wertis.kolektor.ui.components.OutlineButton
import pl.wertis.kolektor.ui.components.PrimaryButton
import pl.wertis.kolektor.ui.components.WIcons
import pl.wertis.kolektor.ui.components.WertisTextField
import pl.wertis.kolektor.ui.product.MiniaturaTowaru
import pl.wertis.kolektor.ui.theme.Amber
import pl.wertis.kolektor.ui.theme.AmberBg
import pl.wertis.kolektor.ui.theme.AmberBgSoft
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
import pl.wertis.kolektor.ui.theme.Success
import pl.wertis.kolektor.ui.theme.cardSurface

/* ── Rozkładanie kosza zwrotowego ────────────────────────────────────────────
   Ta sama gramatyka skanu co przy dostawach, bo ręce już ją znają:

     skan TOWARU  → wskazuje pozycję kosza (serwer szuka wyłącznie w koszu —
                    cudzy towar dostaje uczciwe „nie z tego kosza"),
     skan REGAŁU  → odkłada wskazaną pozycję pod ten adres.

   Od 0.77.0 wiersz mówi tyle, co wiersz dostawy: zdjęcie z kartoteki, ilość
   z jednostką, pastylka adresu, a pod spodem stany wszystkich magazynów
   i podpowiedź strefy złotej. Zwrot bardziej tego potrzebuje niż dostawa —
   towar wraca pojedynczo, bywa wycofany ze sprzedaży, więc pytanie „co to
   właściwie jest i gdzie tego jeszcze mam" pada tu częściej.

   POMIŃ jest drugą połową tej zmiany. Wcześniej pozycja, której w koszu nie
   było, blokowała ZAKOŃCZ, a razem z nim cały obieg; kosz wracał do biura bez
   śladu, CZEGO zabrakło. Teraz pominięcie ma powód, nie blokuje zakończenia
   i — co najważniejsze — NIE dostaje MM, bo towar nigdzie nie pojechał.

   Ilości częściowych tu nie ma i to decyzja właściciela: przy zwrocie sztuki
   idą na jedną półkę, a licznik − / + kosztowałby dotknięcie przy każdej
   pozycji, żeby obsłużyć przypadek, który się nie zdarza.

   ZAKOŃCZ robi jedno z dwóch, zależnie od tego, SKĄD kosz pochodzi:

     kosz z aplikacji (Etap 3) → kolejkuje MM ZWROTY→MAG per ODŁOŻONA pozycja
                                 i cofa bufor bez nikogo przy komputerze,
     kosz z dokumentu (0.75.0) → nie wystawia NICZEGO. Przesunięcie na regał
                                 zrobiło biuro przed przywiezieniem kosza,
                                 a powrotne zrobi po rozłożeniu.              */

private val POWODY = listOf("nie ma w koszu", "uszkodzony", "obcy towar")

@Composable
fun KoszScreen(graph: AppGraph) {
    val id = graph.nav.koszId ?: return
    val scope = rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var kosz by remember { mutableStateOf<KoszView?>(null) }
    var wybrana by remember { mutableStateOf<Long?>(null) }
    var adres by remember { mutableStateOf("") }
    var pomijana by remember { mutableStateOf<KoszPozycja?>(null) }

    fun wybierz(p: KoszPozycja?) {
        wybrana = p?.id
        adres = p?.lokOczekiwana ?: ""
    }

    LaunchedEffect(id, reload) {
        try {
            val k = apiCall { graph.api.kosz(id) }.kosz
            kosz = k
            // domyślnie wskazana pierwsza nieodłożona — lista jest alejkowa,
            // więc to zarazem najbliższy regał na trasie
            if (wybrana == null || k.pozycje.none { it.id == wybrana && it.status == "todo" }) {
                wybierz(k.pozycje.firstOrNull { it.status == "todo" })
            }
        } catch (e: Exception) {
            graph.effects.toast(e.message ?: "Nie udało się wczytać kosza")
        }
    }

    fun odloz(pozycjaId: Long, kod: String, recznie: Boolean) {
        scope.launch {
            try {
                apiCall { graph.api.koszOdloz(pozycjaId, OdlozKoszBody(kod, recznie)) }
                graph.feedback.beep(true)
                reload++
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się odłożyć")
            }
        }
    }

    fun pomin(pozycjaId: Long, powod: String) {
        scope.launch {
            try {
                apiCall { graph.api.koszPomin(pozycjaId, PominKoszBody(powod)) }
                pomijana = null
                reload++
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Nie udało się pominąć pozycji")
            }
        }
    }

    fun skanTowaru(code: String) {
        scope.launch {
            try {
                val r = apiCall { graph.api.koszSkan(id, ScanBody(code)) }
                when {
                    r.pozycjaId != null -> {
                        graph.feedback.beep(true)
                        wybierz(kosz?.pozycje?.firstOrNull { it.id == r.pozycjaId })
                    }
                    r.poza -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("${r.symbol} nie jest z tego kosza")
                    }
                    else -> {
                        graph.feedback.beep(false)
                        graph.effects.toast("Nieznany kod: $code")
                    }
                }
            } catch (e: Exception) {
                graph.effects.toast(e.message ?: "Błąd połączenia z serwerem")
            }
        }
    }

    ScanHandlerEffect { scan ->
        val k = kosz ?: return@ScanHandlerEffect true
        if (k.status != "zamkniety") return@ScanHandlerEffect true
        val sel = wybrana
        if (sel != null && scan.kind != ScanKind.EAN) {
            odloz(sel, normalizeLoc(scan.code), recznie = false)
        } else {
            skanTowaru(scan.code)
        }
        true
    }

    val k = kosz
    if (k == null) {
        LoadingRow("Wczytywanie kosza…")
        return
    }
    val doZrobienia = k.pozycje.count { it.status == "todo" }
    val pominietych = k.pozycje.count { it.status == "skipped" }
    val odlozonych = k.pozycje.size - doZrobienia - pominietych

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            buildString {
                append("KOSZ ${k.kod} · ODŁOŻONE $odlozonych/${k.pozycje.size}")
                if (pominietych > 0) append(" · POMINIĘTE $pominietych")
            },
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        k.pozycje.forEach { p ->
            val wskazana = p.id == wybrana && k.status == "zamkniety"
            PozycjaRow(graph, p, wskazana) { if (p.status != "done") wybierz(p) }
            if (wskazana) {
                PanelPozycji(
                    p = p,
                    adres = adres,
                    onAdres = { adres = it },
                    onOdloz = { if (adres.isNotBlank()) odloz(p.id, normalizeLoc(adres), recznie = true) },
                    onPomin = { pomijana = p },
                )
            }
        }

        if (doZrobienia == 0 && k.status == "zamkniety") {
            val zDokumentu = k.mmNumer != null
            val napis = if (zDokumentu) "ZAKOŃCZ — KOSZ ROZŁOŻONY" else "ZAKOŃCZ — COFNIJ BUFOR"
            /* Kosz z pominięciem wraca do biura NIEKOMPLETNY. Przycisk mówi to
               wprost, żeby nikt nie zamknął go w przekonaniu, że rozniósł
               całość — pominięta pozycja czeka na wyjaśnienie po tamtej stronie. */
            if (pominietych > 0) {
                Text(
                    "$pominietych poz. pominięta — biuro dostanie kosz niekompletny",
                    fontSize = 12.sp,
                    color = AmberInk,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            PrimaryButton(napis, tall = true, modifier = Modifier.fillMaxWidth()) {
                scope.launch {
                    try {
                        apiCall { graph.api.koszZakoncz(id) }
                        graph.effects.toast(
                            if (zDokumentu) "Kosz ${k.kod} rozłożony — dokument powrotny wystawia biuro"
                            else "Kosz rozłożony — MM na magazyn główny w kolejce"
                        )
                        graph.nav.zakonczonyKosz()
                    } catch (e: Exception) {
                        graph.effects.toast(e.message ?: "Nie udało się zakończyć")
                    }
                }
            }
        }
        if (k.status == "rozlozony") {
            Text(
                if (k.mmNumer != null) "Kosz rozłożony. Dokument powrotny (ZWR→MAG) wystawia biuro."
                else "Kosz rozłożony — bufor cofnięty automatycznie.",
                fontSize = 13.sp,
                color = InkMute,
            )
        }
    }

    pomijana?.let { p ->
        PominSheet(p, onCancel = { pomijana = null }) { powod -> pomin(p.id, powod) }
    }
}

/* ── Wiersz pozycji ──────────────────────────────────────────────────────────
   Trzy tryby, dokładnie jak przy dostawach: oczekujący pełnej wysokości,
   wskazany z bursztynową obwódką i zrobiony (odłożony albo pominięty) zwinięty
   do połowy. Zwinięcie nie jest oszczędnością pikseli, tylko sposobem, żeby
   dziesięć pozycji drobnicy zmieściło się na ekranie bez przewijania.        */

@Composable
private fun PozycjaRow(graph: AppGraph, p: KoszPozycja, wskazana: Boolean, onClick: () -> Unit) {
    val done = p.status == "done"
    val pominieta = p.status == "skipped"
    val zwiniety = done || (pominieta && !wskazana)
    val bok = if (wskazana) 44.dp else 36.dp

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(
                background = if (wskazana) AmberBgSoft else CardWhite,
                borderColor = if (wskazana) AmberLine else CardBorder,
            )
            .then(if (wskazana) Modifier.border(2.dp, Amber, RoundedCornerShape(12.dp)) else Modifier)
            .heightIn(min = if (zwiniety) 34.dp else 52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = if (zwiniety) 4.dp else 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        /* Ikona STANU zostaje zawsze — niesie „odłożone" albo „pominięte",
           czego zdjęcie nie zastąpi. Rysunek pudełka ustępuje miniaturze, bo
           nie niesie nic ponad „towar", a zdjęcie mówi KTÓRY towar. */
        when {
            pominieta -> Icon(WIcons.Alert, null, tint = Destructive, modifier = Modifier.size(18.dp))
            done -> Icon(WIcons.Check, null, tint = Success, modifier = Modifier.size(14.dp))
        }
        if (!zwiniety) {
            /* Rysunek pudełka zajmuje TYLE SAMO miejsca co miniatura, więc
               wiersz nie przeskakuje w bok w chwili doczytania zdjęcia. */
            val ikonaPudelka: @Composable () -> Unit = {
                Box(
                    Modifier
                        .size(bok)
                        .clip(RoundedCornerShape(10.dp))
                        .background(CardWhite)
                        .border(1.dp, CardBorder, RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(WIcons.Box, null, tint = Ink, modifier = Modifier.size(bok / 2))
                }
            }
            MiniaturaTowaru(graph, p.twId, bok, powieksz = wskazana, zamiast = ikonaPudelka)
        }
        Column(Modifier.weight(1f)) {
            Text(
                p.symbol.ifEmpty { p.nazwa },
                fontFamily = BarlowCond,
                fontWeight = FontWeight.Bold,
                fontSize = if (zwiniety) 14.sp else 17.sp,
                color = if (zwiniety) InkMute else Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!zwiniety) {
                Text(p.nazwa, fontSize = 12.sp, color = InkMute, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            /* Powód pominięcia stoi PRZY pozycji, nie w osobnym wykazie: to
               jedyna treść tego zgłoszenia i ma być widoczna bez szukania. */
            if (pominieta) {
                Text(
                    "pominięta — ${p.powod ?: "bez powodu"}",
                    fontSize = 12.sp,
                    color = Destructive,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                iloscZJednostka(p.ilosc, p.unit),
                fontSize = if (zwiniety) 12.sp else 14.sp,
                fontWeight = FontWeight.Bold,
                color = if (zwiniety) InkMute else Ink,
            )
            /* Adres, pod który towar MA trafić — a po odłożeniu ten faktyczny. */
            LokPastylka(p.lokFaktyczna ?: p.lokOczekiwana, przygaszona = zwiniety)
        }
    }
}

/* ── Panel wskazanej pozycji ────────────────────────────────────────────────
   Wszystko, czego magazynier potrzebuje STOJĄC z towarem w ręce: gdzie to
   ma iść, gdzie tego jeszcze jest i czy nie warto przenieść na lepszą półkę.
   Niżej dwa wyjścia: wpisanie adresu ręką (zniszczona etykieta nie może
   blokować pozycji) i pominięcie z powodem.                                  */

@Composable
private fun PanelPozycji(
    p: KoszPozycja,
    adres: String,
    onAdres: (String) -> Unit,
    onOdloz: () -> Unit,
    onPomin: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(background = CardWhite, borderColor = AmberLine)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            if (p.status == "skipped") "POMINIĘTA — ODŁOŻENIE COFNIE POMINIĘCIE" else "ODŁÓŻ NA",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = InkSoft,
        )
        Text(
            p.lokOczekiwana ?: "BEZ ADRESU",
            fontFamily = BarlowCond,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 28.sp,
            color = if (p.lokOczekiwana == null) AmberInk else Ink,
        )
        /* Gdzie tego jeszcze jest. Przy zwrocie najczęściej czyta się drugą
           liczbę: ile z tego kosza zostało jeszcze na regale zwrotów. */
        Text(
            if (p.stany.isEmpty()) "brak stanu w magazynach"
            else p.stany.joinToString(" · ") { "${it.kod} ${formatQty(it.stan)}" },
            fontSize = 12.sp,
            color = InkMute,
        )
        p.zlotaStrefa?.let { z ->
            Text(
                "Strefa złota: ${z.zbiorekNaDzien} zbiórek dziennie · poziomy ${z.poziomy}",
                fontSize = 12.sp,
                color = AmberInk,
                fontWeight = FontWeight.SemiBold,
            )
        }
        WertisTextField(
            value = adres,
            onValueChange = onAdres,
            placeholder = "np. A01-02-03",
            leadingIcon = WIcons.Scan,
            onDone = onOdloz,
        )
        PrimaryButton("ODŁÓŻ TUTAJ", enabled = adres.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = onOdloz)
        if (p.status != "skipped") {
            OutlineButton("POMIŃ — NIE MA CZEGO ODŁOŻYĆ", modifier = Modifier.fillMaxWidth(), onClick = onPomin)
        }
    }
}

/* ── Arkusz pominięcia ──────────────────────────────────────────────────────
   Cztery powody i tyle. Bez zdjęcia, bez ilości, bez typów wyjątku znanych
   z dostaw: kosz zwrotowy jest mały, a zgłoszenie ma odpowiedzieć biuru na
   jedno pytanie — szukać towaru czy reklamacji.                              */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PominSheet(p: KoszPozycja, onCancel: () -> Unit, onPomin: (String) -> Unit) {
    var wybrany by remember(p.id) { mutableStateOf<String?>(null) }
    var wlasny by remember(p.id) { mutableStateOf("") }
    val powod = wybrany ?: wlasny.trim()

    ModalBottomSheet(onDismissRequest = onCancel, containerColor = Paper) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "POMIŃ ${p.symbol.ifEmpty { p.nazwa }}",
                fontFamily = BarlowCond,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 20.sp,
                color = Ink,
            )
            Text(
                "Powód trafia do biura razem z koszem — po nim wiadomo, czy szukać towaru, czy reklamacji.",
                fontSize = 13.sp,
                color = InkMute,
            )
            POWODY.forEach { r ->
                val aktywny = wybrany == r
                Text(
                    r,
                    fontSize = 15.sp,
                    fontWeight = if (aktywny) FontWeight.Bold else FontWeight.Normal,
                    color = if (aktywny) AmberInk else Ink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (aktywny) AmberBg else CardWhite)
                        .border(1.dp, if (aktywny) AmberLine else CardBorder, RoundedCornerShape(12.dp))
                        .clickable {
                            wybrany = if (aktywny) null else r
                            if (!aktywny) wlasny = ""
                        }
                        .padding(horizontal = 12.dp, vertical = 14.dp),
                )
            }
            WertisTextField(
                value = wlasny,
                onValueChange = {
                    wlasny = it
                    if (it.isNotBlank()) wybrany = null
                },
                placeholder = "inny powód",
            )
            PrimaryButton("POMIŃ POZYCJĘ", enabled = powod.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                onPomin(powod)
            }
            OutlineButton("ANULUJ", modifier = Modifier.fillMaxWidth(), onClick = onCancel)
        }
    }
}
