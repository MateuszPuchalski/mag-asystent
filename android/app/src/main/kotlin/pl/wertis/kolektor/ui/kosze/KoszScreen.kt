package pl.wertis.kolektor.ui.kosze

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import pl.wertis.kolektor.ui.components.LocChip
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

    /* Kolejny przedmiot do wzięcia z kosza. Serwer trzyma pozycje zrobione na
       końcu listy, więc PIERWSZA czekająca jest zarazem najbliższym regałem na
       trasie — po tym jednym założeniu poznaje się, że kolejność listy i to
       wskazanie muszą pochodzić z jednego miejsca. */
    fun nastepna(k: KoszView?, pomijajac: Long? = null): KoszPozycja? =
        k?.pozycje?.firstOrNull { it.status == "todo" && it.id != pomijajac }

    LaunchedEffect(id, reload) {
        try {
            val k = apiCall { graph.api.kosz(id) }.kosz
            kosz = k
            // domyślnie wskazana pierwsza nieodłożona; wskazanie zrobione ręką
            // (albo przez `nastepna` po odłożeniu) zostaje, dopóki jest co robić
            if (wybrana == null || k.pozycje.none { it.id == wybrana && it.status == "todo" }) {
                wybierz(nastepna(k))
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
                /* Wskazanie przeskakuje OD RAZU, nie dopiero z powracającą listą.
                   Między jednym a drugim mieści się skan następnego regału,
                   a trafiłby w pozycję właśnie odłożoną — czyli POPRAWIŁBY jej
                   adres zamiast odłożyć kolejny towar. Odległość między półkami
                   jest krótsza niż runda do serwera i z powrotem. */
                wybierz(nastepna(kosz, pomijajac = pozycjaId))
                reload++
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się odłożyć")
            }
        }
    }

    /* Trzy drogi powrotne z jednej pomyłki. `apiCall` zwraca kosz po zmianie,
       więc ekran nie musi się przeładowywać osobnym żądaniem. */
    fun akcjaNaPozycji(nazwa: String, wywolanie: suspend () -> Unit) {
        scope.launch {
            try {
                wywolanie()
                graph.feedback.beep(true)
                reload++
            } catch (e: Exception) {
                graph.feedback.beep(false)
                graph.effects.toast(e.message ?: "Nie udało się $nazwa")
            }
        }
    }

    fun pomin(pozycjaId: Long, powod: String) {
        scope.launch {
            try {
                apiCall { graph.api.koszPomin(pozycjaId, PominKoszBody(powod)) }
                pomijana = null
                // pominięcie kończy pracę na tej pozycji tak samo jak odłożenie,
                // więc i tu wskazujemy kolejny przedmiot bez czekania na listę
                wybierz(nastepna(kosz, pomijajac = pozycjaId))
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

    /* Ekran rozpada się na DWIE części i na tym polega cała ta zmiana: szapka
       stoi, lista przewija się pod nią.

       Wcześniej wszystko jechało w jednej przewijanej kolumnie, a ZAKOŃCZ leżał
       pod ostatnią pozycją. Kosz na dwadzieścia pozycji znaczył wtedy: odłóż
       ostatnią rzecz i przewiń jeszcze pół listy, żeby domknąć pracę — kciukiem,
       w rękawicy, z koszem w drugiej ręce.

       Samo przestawienie bloku NAD `forEach` odwróciłoby tylko kierunek tego
       przewijania. Ostatnie odłożenie zostawia listę tam, gdzie stał palec, więc
       przycisk pojawiłby się NAD widocznym obszarem — a dorzucenie do tego
       przewinięcia na górę odbiera je dokładnie w chwili, w której człowiek
       sprawdza wzrokiem właśnie zwinięty wiersz. Dlatego zakończenie nie wędruje
       wewnątrz przewijanej treści, tylko WYCHODZI spod przewijania.

       Reguła z dostaw zostaje w mocy (stopka w `DeliveryLinesScreen`, lekcja
       z 0.54.0): dopóki JEST CO ROBIĆ, zakończenia na ekranie nie ma w ogóle,
       więc nie ma jak kusić na starcie pracy. Zmienia się miejsce, nie warunek. */
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp)
            .padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        /* Licznik przy komplecie mówi to SŁOWEM. „ODŁOŻONE 12/12" wymaga
           porównania dwóch liczb, „KOMPLET" czyta się z odległości ramienia —
           ta sama decyzja co przy pasku postępu dostawy. Kosz z pominięciem
           tego słowa NIE dostaje, bo kompletem nie jest: wraca do biura
           niepełny i nagłówek nie ma prawa temu przeczyć. */
        val komplet = doZrobienia == 0 && pominietych == 0
        Text(
            buildString {
                append("KOSZ ${k.kod} · ODŁOŻONE $odlozonych/${k.pozycje.size}")
                if (pominietych > 0) append(" · POMINIĘTE $pominietych")
                if (komplet) append(" · KOMPLET")
            },
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = if (komplet) Success else InkSoft,
        )

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

        /* Stan końcowy zostaje W SZAPCE, a cofnięcie go NIE. Na koszu rozłożonym
           wszystkie wiersze są zwinięte i wyglądają identycznie, więc bez tego
           zdania ekran nie odpowiada na jedyne pytanie, jakie się tu zadaje:
           „dlaczego nic tu nie mogę zrobić". */
        if (k.status == "rozlozony") {
            Text(
                if (k.mmNumer != null) "Kosz rozłożony. Dokument powrotny (ZWR→MAG) wystawia biuro."
                else "Kosz rozłożony — bufor cofnięty automatycznie.",
                fontSize = 13.sp,
                color = InkMute,
            )
        }

        /* Jedyna przewijana część ekranu. Odstęp MUSI być powtórzony: `spacedBy`
           kolumny zewnętrznej rozdziela już tylko szapkę od listy, a nie wiersze
           między sobą. Dolne wcięcie stoi PO `verticalScroll`, więc jedzie
           z treścią i daje ostatniemu wierszowi oddech, zamiast zostawiać pusty
           pasek nad krawędzią. */
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            k.pozycje.forEach { p ->
                val wskazana = p.id == wybrana && k.status == "zamkniety"
                PozycjaRow(
                    graph = graph,
                    p = p,
                    wskazana = wskazana,
                    adres = adres,
                    onAdres = { adres = it },
                    onOdloz = { if (adres.isNotBlank()) odloz(p.id, normalizeLoc(adres), recznie = true) },
                    onPomin = { pomijana = p },
                    onPozniej = {
                        akcjaNaPozycji("odłożyć na później") {
                            apiCall { graph.api.koszPozniej(p.id) }
                        }
                        /* Ta pozycja czeka dalej, tylko na końcu listy — wskazujemy
                           więc następną, a nie nic. Pusty ekran po „później" kazał
                           szukać kolejnego towaru palcem. */
                        wybierz(nastepna(kosz, pomijajac = p.id))
                    },
                    onCofnij = {
                        akcjaNaPozycji("cofnąć") { apiCall { graph.api.koszCofnijPozycje(p.id) } }
                    },
                    /* Pozycja ODŁOŻONA też daje się wskazać — inaczej nie byłoby
                       jak cofnąć złego skanu ani poprawić adresu. */
                    onClick = { wybierz(p) },
                )
            }

            /* COFNIJ ZAKOŃCZENIE zostaje POD listą i to jest ta sama myśl, dla
               której zakończenie dostawy leży w stopce: droga powrotna ma leżeć
               ZA dowodem, że kosz naprawdę jest rozłożony. Wyjściem z ekranu ona
               nie jest — od tego jest WSTECZ w pasku zakładek — a przypięta
               u góry byłaby najbardziej rzucającą się w oczy rzeczą na ekranie,
               na którym poprawnym ruchem jest odejście.

               Serwer przepuści ją tylko wtedy, gdy MM jeszcze czekają w kolejce;
               po zapisie do Subiekta odmówi i powie dlaczego. */
            if (k.status == "rozlozony") {
                OutlineButton("COFNIJ ZAKOŃCZENIE", modifier = Modifier.fillMaxWidth()) {
                    scope.launch {
                        try {
                            apiCall { graph.api.koszCofnijZakonczenie(id) }
                            graph.effects.toast("Kosz wrócił do rozkładania")
                            reload++
                        } catch (e: Exception) {
                            graph.effects.toast(e.message ?: "Nie udało się cofnąć")
                        }
                    }
                }
            }
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
private fun PozycjaRow(
    graph: AppGraph,
    p: KoszPozycja,
    wskazana: Boolean,
    adres: String,
    onAdres: (String) -> Unit,
    onOdloz: () -> Unit,
    onPomin: () -> Unit,
    onPozniej: () -> Unit,
    onCofnij: () -> Unit,
    onClick: () -> Unit,
) {
    val done = p.status == "done"
    val pominieta = p.status == "skipped"
    val zwiniety = done || (pominieta && !wskazana)
    val bok = if (wskazana) 44.dp else 36.dp

    /* JEDNA KARTA na wskazaną pozycję i jej panel — dokładnie jak rozwinięty
       wiersz dostawy (`LineRow`). Dwie osobne karty rozrywały to, co jest
       jedną myślą: „ten towar idzie na tę półkę". Oko musiało wtedy wiązać
       symbol z adresem przez szczelinę między kartami. */
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .cardSurface(
                background = if (wskazana) AmberBgSoft else CardWhite,
                borderColor = if (wskazana) AmberLine else CardBorder,
            )
            .then(if (wskazana) Modifier.border(2.dp, Amber, RoundedCornerShape(12.dp)) else Modifier)
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = if (zwiniety) 34.dp else 52.dp)
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
                /* Symbol WSKAZANEJ pozycji rośnie do 22 sp. To jego się szuka
                   wzrokiem, mając towar w ręce i pytanie „czy to na pewno ten" —
                   a czyta się go z odległości ramienia, tak samo jak adres
                   w panelu niżej. Reszta wierszy zostaje przy 17 sp, bo pełna
                   lista w tym rozmiarze przestałaby mieścić się na ekranie. */
                Text(
                    p.symbol.ifEmpty { p.nazwa },
                    fontFamily = BarlowCond,
                    fontWeight = FontWeight.Bold,
                    fontSize = when {
                        zwiniety -> 14.sp
                        wskazana -> 22.sp
                        else -> 17.sp
                    },
                    color = if (zwiniety) InkMute else Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!zwiniety) {
                    Text(p.nazwa, fontSize = 12.sp, color = InkMute, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                /* „Na później" mówi, DLACZEGO ta pozycja stoi na końcu listy.
                   Bez tego zdania wyglądałaby na przeoczoną. */
                if (p.pozniejAt != null && !done && !pominieta) {
                    Text(
                        "na później — czeka na końcu listy",
                        fontSize = 12.sp,
                        color = AmberInk,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
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
                /* ILOŚĆ INNA NIŻ JEDNA to tutaj wyjątek i tak ma wyglądać.
                   Zwrot wraca pojedynczo, więc oko czyta wiersz jak „jedna rzecz
                   na jedną półkę" i idzie dalej — a przy „3 szt." zostawia dwie
                   w koszu. Pomyłka wychodzi wtedy dopiero przy inwentaryzacji,
                   bo kosz zamyka się z licznikiem POZYCJI, nie sztuk.

                   Pastylka zamiast samego koloru: pozycja bez adresu świeci
                   bursztynem obok, a dwa różne znaczenia jednej barwy nie
                   niosłyby żadnego. Kształt odróżnia je bez czytania. */
                val wyjatkowaIlosc = p.ilosc != 1.0
                Text(
                    iloscZJednostka(p.ilosc, p.unit),
                    fontFamily = if (wyjatkowaIlosc) BarlowCond else null,
                    fontSize = when {
                        zwiniety -> 12.sp
                        wyjatkowaIlosc -> 18.sp
                        else -> 14.sp
                    },
                    fontWeight = if (wyjatkowaIlosc) FontWeight.ExtraBold else FontWeight.Bold,
                    color = when {
                        zwiniety -> InkMute
                        wyjatkowaIlosc -> AmberInk
                        else -> Ink
                    },
                    /* Wiersz zwinięty pastylki nie dostaje: praca jest zrobiona,
                       a pasek ma zostać paskiem. Liczba zostaje na nim widoczna,
                       bo to po niej sprawdza się kompletność kosza. */
                    modifier = if (wyjatkowaIlosc && !zwiniety) {
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .border(1.5.dp, AmberLine, RoundedCornerShape(50))
                            .background(AmberBg)
                            .padding(horizontal = 10.dp, vertical = 3.dp)
                    } else {
                        Modifier
                    },
                )
                /* Adres, pod który towar MA trafić — a po odłożeniu ten faktyczny.
                   Wskazana pozycja pastylki NIE dostaje: ten sam adres stoi
                   oczko niżej w 28 sp i dwa razy tego samego nie czyta się lepiej.
                   Ta sama reguła co przy rozwiniętym wierszu dostawy. */
                if (!wskazana) {
                    LokPastylka(p.lokFaktyczna ?: p.lokOczekiwana, przygaszona = zwiniety)
                }
            }
        }

        if (wskazana) {
            PanelPozycji(
                p = p,
                adres = adres,
                onAdres = onAdres,
                onOdloz = onOdloz,
                onPomin = onPomin,
                onPozniej = onPozniej,
                onCofnij = onCofnij,
            )
        }
    }
}

/* ── Panel wskazanej pozycji ────────────────────────────────────────────────
   Wszystko, czego magazynier potrzebuje STOJĄC z towarem w ręce: gdzie to
   ma iść, gdzie tego jeszcze jest i czy nie warto przenieść na lepszą półkę.
   Niżej dwa wyjścia: wpisanie adresu ręką (zniszczona etykieta nie może
   blokować pozycji) i pominięcie z powodem.

   Rysuje się WEWNĄTRZ karty wiersza, więc nie ma własnego tła ani obwódki —
   samo wcięcie i odstęp od dołu. Osobna karta rozrywała jedną myśl na dwie
   i to było widać gołym okiem.                                              */

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PanelPozycji(
    p: KoszPozycja,
    adres: String,
    onAdres: (String) -> Unit,
    onOdloz: () -> Unit,
    onPomin: () -> Unit,
    onPozniej: () -> Unit,
    onCofnij: () -> Unit,
) {
    val done = p.status == "done"
    val pominieta = p.status == "skipped"
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            when {
                pominieta -> "POMINIĘTA — ODŁOŻENIE COFNIE POMINIĘCIE"
                done -> "ODŁOŻONA — MOŻESZ POPRAWIĆ ADRES ALBO COFNĄĆ"
                else -> "ODŁÓŻ NA"
            },
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
        /* POZOSTAŁE PÓŁKI TEGO TOWARU (0.118.0). Kartoteka trzyma kilka adresów,
           a kolektor pokazywał tu wyłącznie pierwszy — pickingowy. Przy zwrocie
           to za mało: wraca jedna sztuka i najtaniej dołożyć ją tam, gdzie ten
           towar już leży, bo półka pickingowa bywa pełna albo stoi w drugim
           końcu hali. Do tej wersji trzeba było po to wyjść z kosza do karty
           towaru — czyli zgubić wskazaną pozycję.

           Pastylka WPISUJE adres w pole niżej, nie odkłada. Odłożenie zostaje
           przy skanie regału i przycisku: dotknięcie jednego z kilku adresów
           obok siebie w rękawicy jest zbyt tanie na czynność nieodwracalną. */
        val innePolki = p.lokalizacje.filter { it != p.lokOczekiwana }
        if (innePolki.isNotEmpty()) {
            Text(
                "LEŻY TAKŻE NA — DOTKNIJ, ABY WPISAĆ",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                color = InkSoft,
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                innePolki.forEach { kod -> LocChip(kod, primary = false) { onAdres(kod) } }
            }
        }
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
        PrimaryButton(
            if (done) "POPRAW — ODŁÓŻ TUTAJ" else "ODŁÓŻ TUTAJ",
            enabled = adres.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
            onClick = onOdloz,
        )
        /* Drogi powrotne. Pozycja zrobiona ma COFNIJ, pozycja czekająca —
           PÓŹNIEJ i POMIŃ. Te dwa ostatnie znaczą co innego i dlatego stoją
           osobno: „później" zostawia pracę w koszu, „pomiń" oddaje ją biuru. */
        if (done || pominieta) {
            OutlineButton(
                if (pominieta) "COFNIJ POMINIĘCIE" else "COFNIJ ODŁOŻENIE",
                modifier = Modifier.fillMaxWidth(),
                onClick = onCofnij,
            )
        } else {
            OutlineButton("PÓŹNIEJ — NA KONIEC LISTY", modifier = Modifier.fillMaxWidth(), onClick = onPozniej)
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
