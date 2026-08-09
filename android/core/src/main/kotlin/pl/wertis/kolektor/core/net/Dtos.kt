package pl.wertis.kolektor.core.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator

/* ── DTO REST — LUSTRO server/src/types.ts ─────────────────────────────────
   Zmieniasz typ tu → sprawdź tam (i odwrotnie); rozjazd kończy się błędem
   deserializacji na hali, nie w kompilatorze. Ilości/stany jako Double
   (JS number bywa ułamkiem), identyfikatory Long.                           */

/** Wspólna konfiguracja JSON dla całej aplikacji. */
val WertisJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = false
}

@Serializable
data class StockView(
    val stan: Double,
    val rez: Double,
    val avail: Double,
    val pendingIn: Double,
    val pendingOut: Double,
    val effective: Double,
)

/**
 * Stan towaru w magazynie BEZ ROLI (nie MAG/MGP/Zwroty).
 *
 * Odpowiada na pytanie „gdzie ten towar jeszcze leży", którego do lipca 2026
 * nie dało się zadać: serwer znał wyłącznie trzy magazyny z konfiguracji.
 * Które magazyny tu wchodzą, rozstrzyga SERWER — ukrywanie jest globalne,
 * więc kolektor niczego nie filtruje, tylko rysuje to, co dostał.
 */
@Serializable
data class MagazynStan(
    val magId: Long,
    /** `mag_Symbol` — ten sam krótki kod, który biuro widzi w Subiekcie. */
    val kod: String,
    val nazwa: String = "",
    val stan: Double = 0.0,
    val rez: Double = 0.0,
    /** Ile stąd wyjeżdża w zakolejkowanych przesunięciach (⏳ w drodze). */
    val wDrodze: Double = 0.0,
)

/** Magazyn na liście ustawień: z rolą i informacją, czy jest ukryty. */
@Serializable
data class MagazynInfo(
    val magId: Long,
    val kod: String,
    val nazwa: String = "",
    /** "MAG" | "MGP" | "ZWROTY" | null — z rolą nie da się ukryć. */
    val rola: String? = null,
    val ukryty: Boolean = false,
)

@Serializable
data class MagazynyResponse(val magazyny: List<MagazynInfo> = emptyList())

/* ── Ciała żądań ──────────────────────────────────────────────────────── */

@Serializable
enum class LocAction {
    @SerialName("replace") REPLACE,
    @SerialName("add") ADD,
    @SerialName("remove") REMOVE,
    @SerialName("replace_one") REPLACE_ONE,
}

@Serializable
data class SetLocationBody(
    val action: LocAction,
    val value: String? = null,
    val replaced: String? = null,
    /** Kod WPISANY z ręki, nie zeskanowany — zasila raport etykiet do przedruku. */
    val recznie: Boolean? = null,
)

/**
 * Przesunięcie stanu między magazynami.
 *
 * `location` wypełnia się WYŁĄCZNIE przy celu MAG: adres w kartotece Subiekta
 * to jedno pole na towar, bez wymiaru magazynu, więc opisuje regał na hali.
 * Serwer odrzuca kod przy innym celu — i dobrze, bo zapisany nadpisałby adres
 * hali adresem, którego na hali nie ma.
 */
@Serializable
data class PrzesuniecieBody(
    val twId: Long,
    val qty: Double,
    val magFrom: Long,
    val magTo: Long,
    val location: String? = null,
    /** Pozycja dostawy, gdy przesunięcie wyszło ze skrótu na liście. */
    val lineId: Long? = null,
    /** Kod półki WPISANY z ręki — zasila raport etykiet do przedruku. */
    val recznie: Boolean? = null,
)

@Serializable
data class PrzesuniecieResponse(
    val ok: Boolean = true,
    val queueIds: List<Long> = emptyList(),
    val dostepnePrzed: Double = 0.0,
)

/**
 * `/api/health` — tu interesuje nas WYŁĄCZNIE wersja serwera.
 *
 * Reszta pól (tryb, worker, problemy) zostaje po stronie serwera; kolektor
 * pokazuje numer obok własnego, bo rozjazd „serwer nowszy niż APK" to
 * najczęstsze pytanie po aktualizacji — `git pull` przestawia serwer od razu,
 * a APK czeka na rozesłanie przez MDM.
 */
@Serializable
data class HealthResponse(val wersja: String = "")

@Serializable
data class WidocznoscRequest(val ukryte: List<Long>)

/** Zmiana lokalizacji czekająca w kolejce — pojedynczy kod, nie całe pole. */
@Serializable
data class PendingLocChange(
    val code: String,
    /** `add` = dochodzi na tę półkę, `remove` = z niej schodzi. */
    val kind: String = "add",
    /** `pending` = worker to jeszcze zrobi; `error` = nie zrobi bez PONÓW. */
    val status: String = "pending",
    val queueId: Long = 0,
)

@Serializable
data class ProductCard(
    val id: Long,
    val sym: String,
    val name: String,
    val ean: String,
    val unit: String,
    val desc: String = "",
    /** Lokalizacje POTWIERDZONE — to, co naprawdę jest w Subiekcie. */
    val locs: List<String> = emptyList(),
    /** Zmiany w kolejce; `locs` celowo ich nie zawiera. */
    val pendingLocs: List<PendingLocChange> = emptyList(),
    val mag: StockView,
    val mgp: StockView,
    /** Strefa zwrotów od klientów (magazyn Zwroty). */
    val zwroty: StockView? = null,
    /**
     * Pozostałe magazyny firmy — bez trójki z rolami i bez ukrytych.
     * Pusta domyślna trzyma zgodność ze starszym serwerem, który tego pola
     * nie wysyła (tak samo jak przy `zwroty` i `zamienniki`).
     */
    val magazyny: List<MagazynStan> = emptyList(),
    /**
     * Przyjechało na dokumencie, jeszcze nie odłożone. Puste = wszystko, co
     * przyszło, leży już w regale.
     *
     * Odpowiada na pytanie, którego kafle stanów nie zamykają: „MAG pokazuje
     * 12 szt, a półka pusta". Przy dostawie krajowej towar figuruje na MAG od
     * zaksięgowania dokumentu, więc stan nie odróżnia „leży w regale" od „stoi
     * na palecie w przyjęciach". Liczy SERWER — kolektor tylko rysuje.
     */
    val wDostawie: List<WDostawie> = emptyList(),
    /** Otwarte zamówienia u dostawcy — czego jeszcze nie ma i kiedy przyjedzie. */
    val zamowione: List<ZamowioneUDostawcy> = emptyList(),
    /** Zamienniki wyczytane z opisu — regułę ma serwer, kolektor tylko rysuje. */
    val zamienniki: Zamienniki = Zamienniki(),
)

/** Jedna dostawa, na której ten towar przyjechał i nie został odłożony. */
@Serializable
data class WDostawie(
    val dokId: Long = 0,
    val typ: String = "",
    val nrPelny: String = "",
    val dataWyst: String = "",
    /** Ile z tego dokumentu jeszcze nie trafiło w regał. Zawsze > 0. */
    val ilosc: Double = 0.0,
    val wBuforze: Boolean = false,
    /** `null` = dokumentu nikt nie otwierał; inaczej status linii rozkładania. */
    val status: String? = null,
)

/** Jedno otwarte zamówienie do dostawcy, na którym stoi ten towar. */
@Serializable
data class ZamowioneUDostawcy(
    val dokId: Long = 0,
    val nrPelny: String = "",
    val dataWyst: String = "",
    /** Termin realizacji; pusty, gdy baza go nie udostępnia. */
    val termin: String? = null,
    val dostawca: String = "",
    /** Ile jeszcze nie przyjechało. Zawsze > 0. */
    val ilosc: Double = 0.0,
    /**
     * Serwer nie umiał odjąć części już odebranej — ilość jest GÓRNYM
     * oszacowaniem. Ekran musi to napisać, bo inaczej magazynier liczy na
     * towar, którego nikt już nie wyśle.
     */
    val szacunek: Boolean = false,
)

/**
 * Zamienniki z opisu kartoteki, rozstrzygnięte przez serwer.
 *
 * `znane` to nasze towary — zwykłe wiersze listy, więc rysuje je ten sam
 * komponent co wyniki wyszukiwania, i da się w nie wejść. `obce` to numery OEM
 * i katalogi innych producentów: zostają jako tekst, bo nie ma dokąd z nimi
 * pójść, ale to one idą w rozmowę z dostawcą.
 *
 * Wartości domyślne trzymają zgodność ze starszym serwerem, który tego pola
 * jeszcze nie zna.
 */
@Serializable
data class Zamienniki(
    val znane: List<ProductRow> = emptyList(),
    val obce: List<String> = emptyList(),
)

@Serializable
data class ProductRow(
    val id: Long,
    val sym: String,
    val name: String,
    val ean: String,
    val mag: Double,
    val mgp: Double,
    val locs: List<String> = emptyList(),
    /**
     * Tylko na liście zawartości regału: `add` = towar właśnie tu jedzie,
     * `remove` = schodzi, `error` = zapis się nie udał. W wyszukiwarce null.
     */
    val pendingHere: String? = null,
)

@Serializable
@OptIn(ExperimentalSerializationApi::class)
@JsonClassDiscriminator("type")
sealed interface ScanResult {
    @Serializable
    @SerialName("product")
    data class Product(val card: ProductCard) : ScanResult

    @Serializable
    @SerialName("search")
    data class Search(val results: List<ProductRow>) : ScanResult

    /**
     * Skan etykiety regału. Pusta lista to POPRAWNA odpowiedź — magazynier
     * skanuje półkę między innymi po to, żeby sprawdzić, czy jest wolna.
     */
    @Serializable
    @SerialName("location")
    data class Location(
        val code: String,
        /** Czy ten adres występuje dziś w kartotece (a nie: czy jest poprawny). */
        val known: Boolean = false,
        val products: List<ProductRow> = emptyList(),
    ) : ScanResult

    @Serializable
    @SerialName("notfound")
    data class NotFound(val code: String) : ScanResult
}

@Serializable
data class SearchResponse(val results: List<ProductRow>)

@Serializable
data class MovementEntry(
    val type: String,
    val user: String,
    val at: String,
    val detail: String,
)

@Serializable
data class HistoryResponse(val entries: List<MovementEntry>)

/**
 * Słownik lokalizacji i REGUŁA rozpoznawania kodu — serwer jest jej jedynym
 * właścicielem (plan §3). Klient cache'uje to, co dostanie, i nie ma własnej
 * kopii wzorca.
 */
@Serializable
data class LocationsInfo(
    val codes: List<String> = emptyList(),
    /** Wzorce kodu lokalizacji. Puste = starszy serwer, patrz `locPatterns()`. */
    val patterns: List<String> = emptyList(),
    /** Zgodność wsteczna: starszy serwer wysyła jeden wzorzec zamiast listy. */
    val format: String = "",
    val strict: Boolean = false,
    val allowManual: Boolean = true,
    /** Kiedy kolektor to pobrał (ms epoch); 0 = nigdy, tryb ostrożny. */
    val fetchedAt: Long = 0,
) {
    /** Wzorce niezależnie od wersji serwera; pusta lista = reguła nieznana. */
    fun locPatterns(): List<String> =
        if (patterns.isNotEmpty()) patterns else listOfNotNull(format.ifEmpty { null })
}

@Serializable
data class LocationProductsResponse(
    val code: String,
    val products: List<ProductRow> = emptyList(),
)

@Serializable
enum class QueueItemType {
    @SerialName("set_location") SET_LOCATION,
    /**
     * HISTORYCZNE. Aplikacja nie tworzy już zadań flagi faktury, ale w kolejce
     * na wdrożonych instalacjach leżą dawne wiersze — a `QueueItem.type` nie ma
     * wartości domyślnej, więc `coerceInputValues` ich nie uratuje. Usunięcie
     * tej pozycji wywracałoby ekran kolejki na każdej bazie z historią.
     */
    @SerialName("set_doc_flag") SET_DOC_FLAG,
    /** Dokument MM — powstaje wyłącznie z wózka trybu B (zatwierdzenie rundy). */
    @SerialName("mm") MM,
}

@Serializable
enum class QueueStatus {
    @SerialName("pending") PENDING,
    @SerialName("processing") PROCESSING,
    @SerialName("waiting_for_doc") WAITING_FOR_DOC,
    @SerialName("done") DONE,
    @SerialName("error") ERROR,
    @SerialName("cancelled") CANCELLED,
}

@Serializable
data class QueueItem(
    val id: Long,
    val type: QueueItemType,
    val status: QueueStatus,
    val label: String,
    val detail: String = "",
    val errMsg: String? = null,
    val time: String = "",
)

@Serializable
data class QueueSummary(val pending: Int = 0, val error: Int = 0, val done: Int = 0)

@Serializable
data class QueueResponse(
    val items: List<QueueItem> = emptyList(),
    val summary: QueueSummary = QueueSummary(),
)

@Serializable
data class DeviceEventBody(
    val type: String,
    val magnitude: Double? = null,
    val level: Double? = null,
    /** `scan_timing`: skan → odpowiedź, mierzone u człowieka (cel p95 < 150 ms). */
    val ms: Long? = null,
)

/* ── Odpowiedzi ───────────────────────────────────────────────────────── */

@Serializable
data class QueueIdResponse(val queueId: Long, val kind: String? = null)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class ApiErrorBody(val error: String? = null, val available: Double? = null)

/* ── Tryb A: rozkładanie faktur zakupu (redesign v2.0) ──────────────────────
   Dokument jest jednostką pracy. Aplikacja zapisuje wyłącznie lokalizację
   (D1) — bez MM i bez czekania na bufor SGT.                                  */

@Serializable
data class DeliveryDocument(
    val dokId: Long,
    val typ: String = "",
    val nrPelny: String = "",
    val dataWyst: String = "",
    val dostawca: String = "",
    val positions: Int = 0,
    /** Dokument w buforze SGT — nadal można na nim pracować. */
    val wBuforze: Boolean = false,
    /**
     * Dokument księgowany POZA halą (kontener). Rozkłada się tak samo, ale
     * zostaje po nim przesunięcie stanu na halę — i to jedyna rzecz, którą
     * warto powiedzieć PRZED wejściem w dokument.
     */
    val wPrzyjeciach: Boolean = false,
    val linesTotal: Int = 0,
    val linesDone: Int = 0,
    val status: String? = null,
)

@Serializable
data class DeliveryDocumentsResponse(
    val documents: List<DeliveryDocument> = emptyList(),
    /** Okno listy w dniach (`DOK_DNI_WSTECZ`) — nagłówek pokazuje tę liczbę,
     *  zamiast mieć ją wpisaną po swojej stronie i cicho rozjeżdżać się
     *  z serwerem. Domyślne 14 dotyczy starszego serwera bez tego pola. */
    val dniWstecz: Int = 14,
)

@Serializable
data class DeliveryLineView(
    val id: Long,
    val twId: Long,
    val sym: String = "",
    val name: String = "",
    val qtyDoc: Double = 0.0,
    val qtyDone: Double = 0.0,
    val locExpected: String? = null,
    val locActual: String? = null,
    val status: String = "todo",
    /**
     * Stan na hali i w przyjęciach — surowy, bez korekty o kolejkę i rezerwacje.
     * Przy dostawie krajowej `stanMag` zawiera już rozkładaną partię (towar
     * figuruje na MAG od zaksięgowania dokumentu). Domyślne zera dotyczą
     * starszego serwera, który tych pól nie wysyła.
     */
    val stanMag: Double = 0.0,
    val stanMgp: Double = 0.0,
)

@Serializable
data class DeliveryProgress(
    val total: Int = 0,
    val done: Int = 0,
    val remaining: Int = 0,
    /** Podzbiór `done`: linie wyjęte z rutyny przez zgłoszony wyjątek (D8). */
    val problems: Int = 0,
)

@Serializable
data class DeliveryView(
    val id: Long,
    val dokId: Long = 0,
    val nrPelny: String = "",
    val dostawca: String = "",
    val dataWyst: String = "",
    val status: String = "open",
    val progress: DeliveryProgress = DeliveryProgress(),
    /** Numer przesyłki, jeśli już go podano — pytamy o niego raz na dostawę. */
    val nrPrzesylki: String? = null,
    /** `tak` / `nie` / null (nie pytano) — trzy stany, nie dwa. */
    val kurierProtokol: String? = null,
    /**
     * Magazyn skutku, gdy NIE jest halą. `null` znaczy „nie ma czego
     * przesuwać" — kolektor nie musi wtedy znać identyfikatorów z konfiguracji.
     */
    val sourceMagId: Long? = null,
    val lines: List<DeliveryLineView> = emptyList(),
)

@Serializable
data class OpenDeliveryResponse(val deliveryId: Long)

/** Kandydat przy niejednoznacznym kodzie kreskowym (D7). */
@Serializable
data class EanCandidate(
    val twId: Long,
    val sym: String = "",
    val name: String = "",
    val inDocument: Boolean = false,
    val qtyDoc: Double? = null,
    val locExpected: String? = null,
)

/** Wynik skanu towaru w kontekście dostawy (dyskryminator `kind`). */
@Serializable
@OptIn(ExperimentalSerializationApi::class)
@JsonClassDiscriminator("kind")
sealed class ScanResolution {
    @Serializable @SerialName("line")
    data class Line(val line: DeliveryLineView) : ScanResolution()

    /** Kod wskazuje >1 kartotekę — operacja STOI, użytkownik wybiera (D7). */
    @Serializable @SerialName("conflict")
    data class Conflict(val code: String = "", val candidates: List<EanCandidate> = emptyList()) : ScanResolution()

    @Serializable @SerialName("off_document")
    data class OffDocument(val code: String = "", val twId: Long = 0, val sym: String = "", val name: String = "") : ScanResolution()

    /** Linię trzyma teraz ktoś inny — nie odbieramy jej po cichu. */
    @Serializable @SerialName("locked")
    data class Locked(
        val code: String = "",
        /** Do odebrania linii przed TTL (operacja na PIN, plan §7). */
        val lineId: Long = 0,
        val lockedBy: String = "",
        val sym: String = "",
        val name: String = "",
    ) : ScanResolution()

    @Serializable @SerialName("unknown")
    data class Unknown(val code: String = "") : ScanResolution()
}

@Serializable
data class ScanBody(val code: String)

@Serializable
data class PutawayLineBody(
    val location: String,
    val qty: Double? = null,
    /**
     * Rozjazd lokalizacji (§4.3) — decyduje magazynier, nie serwer: „ZAMIEŃ"
     * gdy towar przeniesiono, „DODAJ" gdy leży teraz w dwóch miejscach.
     * `null` = ścieżka bez rozjazdu (serwer przyjmuje domyślne `replace`).
     */
    val locAction: LocApplyAction? = null,
    /** Kod WPISANY z ręki, nie zeskanowany — zasila raport etykiet do przedruku. */
    val recznie: Boolean? = null,
)

/** Wybór operatora przy skanie innej półki niż oczekiwana (§4.3). */
@Serializable
enum class LocApplyAction {
    @SerialName("add") ADD,
    @SerialName("replace") REPLACE,
}

@Serializable
data class PutawayLineResponse(
    val ok: Boolean = true,
    val queueId: Long? = null,
    val mismatch: Boolean = false,
    val status: String = "",
)

/* ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
   Wyjątek to wiersz w bazie ze zdjęciem, nie notatka w głowie magazyniera —
   inaczej nie da się go zmierzyć ani zgłosić reklamacji dostawcy.            */

@Serializable
data class ProblemView(
    val id: Long,
    val deliveryId: Long? = null,
    val lineId: Long? = null,
    val typ: String = "",
    /** Nazwa kategorii policzona przez serwer — także dla kluczy sprzed 0.21.0. */
    val typLabel: String? = null,
    val qty: Double? = null,
    /** Numer katalogowy artykułu spoza dokumentu (błędny / niezamówiony). */
    val symObcy: String? = null,
    /** Ile miało przyjść tego, co zamówiono, a nie dostarczono. */
    val zamiastIlosc: Double? = null,
    /** Ilość z dokumentu w chwili zgłoszenia — snapshot, nie odczyt na żywo. */
    val qtyDok: Double? = null,
    val opis: String? = null,
    val hasPhoto: Boolean = false,
    val createdAt: String = "",
    val createdBy: String? = null,
    /** Kontekst do listy „nierozwiązane" — bez wchodzenia w dostawę. */
    val docNumber: String? = null,
    val sym: String? = null,
    val name: String? = null,
)

@Serializable
data class ProblemsResponse(val problems: List<ProblemView> = emptyList())

@Serializable
data class RaiseProblemBody(
    val typ: String,
    val lineId: Long? = null,
    val qty: Double? = null,
    /** Numer katalogowy artykułu, którego NIE MA na dokumencie. */
    val symObcy: String? = null,
    /** Ile miało przyjść zamiast tego, co przyszło (opcjonalne w formularzu). */
    val zamiastIlosc: Double? = null,
    val opis: String? = null,
    /** JPEG w base64 — dowód do reklamacji; serwer zapisuje na dysk. */
    val photoBase64: String? = null,
)

/**
 * Numer przesyłki i odpowiedź o protokole kuriera — dane CAŁEJ paczki,
 * pytane raz na dostawę, więc idą osobną trasą na dostawie, nie w zgłoszeniu.
 */
@Serializable
data class PrzesylkaBody(
    val nrPrzesylki: String? = null,
    /** `tak` albo `nie`; null znaczy „nie pytano". */
    val kurierProtokol: String? = null,
)

@Serializable
data class RaiseProblemResponse(val id: Long)

@Serializable
data class ResolveProblemBody(val note: String? = null)

/** Kartoteka z kolizji EAN — symbol i nazwa zamiast surowego tw_Id. */
@Serializable
data class KolizjaTowar(
    val twId: Long = 0,
    /** Pusty = kartoteka skasowana po zapisaniu kolizji; zostaje samo twId. */
    val sym: String = "",
    val name: String = "",
)

/** Kolizja EAN w kartotece — raport dla biura (§4.5). */
@Serializable
data class EanConflictRow(
    val ean: String = "",
    val hits: Int = 0,
    val autoResolved: Int = 0,
    val twIds: List<Long> = emptyList(),
    /** Puste przy starszym serwerze — karta wraca wtedy do listy twIds. */
    val towary: List<KolizjaTowar> = emptyList(),
    val lastSeen: String = "",
)

@Serializable
data class EanConflictsResponse(val conflicts: List<EanConflictRow> = emptyList())

/* ── Tożsamość: login i hasło, sesja urządzenia (plan §7) ─────────────────── */

@Serializable
data class LoginBody(val login: String, val haslo: String)

@Serializable
data class UserDto(
    val userId: Long = 0,
    /** `null` = konto-ślad z migracji historii: audyt na nie wskazuje, zalogować się nim nie da. */
    val login: String? = null,
    val name: String = "",
    val role: String = "magazynier",
    val active: Boolean = true,
)

@Serializable
data class LoginResponse(val token: String = "", val user: UserDto = UserDto())

/**
 * Odpowiedź `/api/auth/me`.
 *
 * Nie niesie stanu blokady ani TTL — sesja nie wygasa sama. Odpowiada na jedno
 * pytanie: czy zapamiętany token nadal wskazuje czynne konto.
 */
@Serializable
data class MeResponse(val user: UserDto = UserDto())

@Serializable
data class ForceReleaseResponse(val ok: Boolean = true, val odebrano: String? = null)

/** Czy instalacja nie ma jeszcze żadnego konta (kolektor pyta przy starcie). */
@Serializable
data class SetupResponse(val potrzebne: Boolean = false)

/** Założenie konta. Uprawnienie autora rozstrzyga sesja, nie drugi sekret w ciele. */
@Serializable
data class CreateUserBody(
    val name: String,
    val login: String,
    val haslo: String,
    val role: String? = null,
)

@Serializable
data class CreateUserResponse(val user: UserDto = UserDto())

/* ── Meldunek o operacjach odrzuconych na kolektorze ────────────────────────
   Bufor offline to plik na urządzeniu, a urządzenie zginie albo zostanie
   zresetowane. Operacja, której serwer nie przyjął, znikała razem z plikiem —
   bez śladu i bez odpowiedzi na pytanie „co się stało z moim skanem".        */

@Serializable
data class OdrzuconaOperacja(
    val rodzaj: String = "",
    val twId: Long? = null,
    val powod: String = "",
    /** Kod HTTP, którym serwer odmówił. */
    val status: Int = 0,
    /** Ile razy próbowaliśmy przed poddaniem się. */
    val proby: Int = 0,
    /**
     * Czas WYKONANIA na kolektorze w ISO 8601, nie czas dosłania. Operacja
     * mogła czekać w buforze godzinami — bez tego pola audyt datowałby ją na
     * moment, w którym się o niej dowiedział.
     */
    val at: String? = null,
)

@Serializable
data class MeldunekOdrzuconych(val operacje: List<OdrzuconaOperacja> = emptyList())

@Serializable
data class MeldunekPrzyjety(val przyjeto: Int = 0)
