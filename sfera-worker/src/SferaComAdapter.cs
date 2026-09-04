using System.Runtime.InteropServices;
using Microsoft.CSharp.RuntimeBinder;

namespace WertisSferaWorker;

/* ── Zapis dokumentów przez COM Sfery — KAŻDE wywołanie COM to [WERYFIKUJ] ───
   Ten plik jest jedynym miejscem, które rozmawia ze Sferą, i JEDYNYM plikiem,
   który trzeba poprawić po ustaleniach na maszynie testowej. Szkic wywołań
   pochodzi z kontraktu w server/src/adapters/sfera.ts; nazwy ProgID, właściwości
   i metod NIE są zweryfikowane na żywej Sferze — stąd znaczniki [WERYFIKUJ]
   (konwencja repo: wartość do potwierdzenia na własnym systemie, DEPLOY §6).

   Late binding (`dynamic` + GetTypeFromProgID) zamiast interop DLL: kompiluje
   się bez Subiekta na maszynie (także w CI na Linuksie), a wersja biblioteki
   Sfery nie jest wtedy zaszyta w exe.

   Sekwencyjność: COM Sfery nie jest thread-safe (spec §9) — proces przetwarza
   jedno zadanie naraz w jednym wątku STA (Program.Main ma [STAThread]),
   więc ta klasa nie potrzebuje żadnej własnej synchronizacji.

   Sesja Subiekta jest otwierana raz i trzymana między zadaniami (start Sfery
   to sekundy, a MM przychodzą seriami przy kontenerze). Po wyjątku COM sesja
   idzie do kosza i następne zadanie otwiera ją od nowa — wiszący uchwyt COM
   to najczęstsza awaria Sfery i restart sesji jest tańszy niż diagnoza. */

public sealed class SferaComAdapter : ISferaAdapter
{
    private readonly EnvFile _env;
    private dynamic? _subiekt;

    public SferaComAdapter(EnvFile env) => _env = env;

    /* ── Stałe Sfery ustalone z dokumentacji, nie zgadnięte ───────────────────
       `UruchomEnum` i `UruchomDopasujEnum` mają opublikowane wartości i te
       zostają tutaj nazwane. Reszta (Produkt, Autentykacja) jest znana
       Z NAZWY, ale nie z wartości — dlatego siedzi w wertis.env z domyślną
       wartością do potwierdzenia, a nie w kodzie. Poprawka takiej liczby na
       hali kosztuje wtedy restart usługi, a nie przebudowanie exe na innej
       maszynie. Komplet z opisem źródeł: docs/sfera-com.md. */

    /** UruchomDopasujEnum.gtaUruchomDopasuj — pierwsza aplikacja podłączona do
        wskazanego serwera i bazy. */
    private const int URUCHOM_DOPASUJ = 0x0;

    /** UruchomEnum.gtaUruchomNowy — ZAWSZE własna instancja. */
    private const int URUCHOM_NOWY = 0x2;

    /** UruchomEnum.gtaUruchomWTle — bez interfejsu użytkownika. Usługa Windows
        nie ma pulpitu, na którym mogłaby pokazać okno Subiekta. */
    private const int URUCHOM_W_TLE = 0x4;

    /**
     * Tryb uruchomienia: WŁASNA instancja, w tle.
     *
     * Do 0.198.4 stało tu `gtaUruchom | gtaUruchomWTle`, czyli „podłącz się do
     * działającego Subiekta, a jak nie ma — uruchom własnego". Sonda pokazała
     * na maszynie firmy, do czego to prowadzi: przy otwartym Subiekcie sesja
     * w tle odmawia kodem `0x8004132B`, a ta sama próba z widocznym oknem
     * przechodzi. Podłączanie się do CUDZEJ instancji z żądaniem „bez okna"
     * jest sprzeczne samo w sobie.
     *
     * Poza tym usługa nie ma prawa zależeć od czyjegoś pulpitu: `wertis-sfera`
     * wystawia dokumenty firmy i musi mieć instancję, której nikt nie zamknie
     * ani nie zablokuje oknem dialogowym. Wywołanie z dokumentacji producenta
     * brzmi zresztą dokładnie tak: `gtaUruchomNowy | gtaUruchomWTle`.
     *
     * Wartość da się nadpisać (`SFERA_TRYB_URUCHOMIENIA`) — instalacje bywają
     * różne, a przestawienie liczby ma kosztować restart usługi, nie budowanie
     * exe od nowa.
     */
    private const int TRYB_DOMYSLNY = URUCHOM_NOWY | URUCHOM_W_TLE;

    /**
     * `SuDokument.Pozycje.Element` liczy OD JEDYNKI — zmierzone sondą
     * (0.198.12): `Element(0)` odmawia „Wartość jest spoza oczekiwanego
     * zakresu", `Element(1)` na dokumencie z jedną pozycją oddaje obiekt.
     *
     * Stała stoi osobno, bo pomyłka o jeden nie wywraca pętli — ona gubi
     * PIERWSZĄ albo OSTATNIĄ pozycję korekty. Dokument powstaje wtedy poprawny
     * z punktu widzenia Sfery i zły z punktu widzenia klienta.
     */
    private const int PIERWSZA_POZYCJA = 1;

    /**
     * Nazwa wywołania COM, którego Sfera nie zna, to POMYŁKA W NAZWIE, a nie
     * awaria — i wtedy komunikat ma powiedzieć, KTÓRY punkt listy `[WERYFIKUJ]`
     * poprawić. Bez tego zostaje gołe „'System.__ComObject' does not contain
     * a definition for 'DodajMM'" w środku wystawiania dokumentu.
     *
     * Błąd MERYTORYCZNY Sfery (brak stanu, zablokowany dokument) przechodzi
     * dalej z własną treścią — dopisujemy do niej wyłącznie nazwę kroku, bo
     * ona mówi, gdzie łańcuch stanął.
     */
    private static T Krok<T>(string wywolanie, int punkt, Func<T> co)
    {
        try
        {
            return co();
        }
        catch (Exception e) when (NieznanaNazwa(e))
        {
            throw new InvalidOperationException(
                $"Sfera nie zna wywołania „{wywolanie}” — to punkt {punkt} listy [WERYFIKUJ] " +
                "w sfera-worker/README.md. Właściwą nazwę podaje InfoSfera (pomoc instalowana " +
                "ze Sferą); sprawdzisz ją bez wystawiania dokumentu przez sfera-worker/sonda.ps1. " +
                $"Błąd źródłowy: {e.Message}", e);
        }
        catch (Exception e) when (e is not InvalidOperationException)
        {
            throw new InvalidOperationException($"Sfera odrzuciła „{wywolanie}”: {e.Message}", e);
        }
    }

    private static void Krok(string wywolanie, int punkt, Action co) =>
        Krok<object?>(wywolanie, punkt, () => { co(); return null; });

    /**
     * Właściwość COM z argumentem (`ParameterizedProperty`), czyli `Element(i)`.
     *
     * Idzie przez `InvokeMember`, a nie przez `dynamic`, ŚWIADOMIE: wiązanie
     * dynamiczne w C# tłumaczy `x.Element[i]` na indeksator, a to jest inne
     * wywołanie IDispatch niż pobranie właściwości z argumentem. Tego nie da
     * się sprawdzić w CI — COM-u tam nie ma — więc wybrana jest droga, która
     * nie zależy od zachowania bindera.
     */
    private static object ElementZIndeksem(object kolekcja, int indeks) =>
        kolekcja.GetType().InvokeMember(
            "Element", System.Reflection.BindingFlags.GetProperty,
            null, kolekcja, new object[] { indeks })!;

    /**
     * Czy wyjątek mówi „nie ma takiej nazwy". Late binding zgłasza to na dwa
     * sposoby zależnie od tego, czy nazwa padła po stronie bindera C#, czy
     * dopiero w IDispatch obiektu COM.
     */
    private static bool NieznanaNazwa(Exception e) =>
        e is RuntimeBinderException
        || e is MissingMemberException
        // DISP_E_MEMBERNOTFOUND / DISP_E_UNKNOWNNAME
        || (e is COMException com && ((uint)com.HResult is 0x80020003 or 0x80020006));

    public string CreateMM(int magFrom, int magTo, IReadOnlyList<MmItem> items)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException(
                "COM Sfery działa wyłącznie na Windows z zainstalowanym Subiektem GT. " +
                "Do przebiegu próbnego bez Sfery służy flaga --dry-run.");

        try
        {
            // rzut na object — argument `dynamic` zrobiłby z wywołania wiązanie
            // dynamiczne i krotka wynikowa straciłaby nazwane pola (CS8133)
            return DodajMm((object)Sesja(), magFrom, magTo, items).Numer;
        }
        catch
        {
            ZamknijSesje();
            throw;
        }
    }

    /// <summary>
    /// MM jako (dokument, numer) — korekta zwrotu potrzebuje UCHWYTU, żeby móc
    /// wycofać MM, gdy padnie RW stojące dalej w łańcuchu.
    /// Parametr sesji jest `object` ŚWIADOMIE: argument `dynamic` czyni całe
    /// wywołanie dynamicznym, a krotki z takiego wywołania nie da się
    /// dekonstruować (CS8133) — i traci nazwy pól w locie.
    /// </summary>
    private static (dynamic Dok, string Numer) DodajMm(
        object sesja, int magFrom, int magTo, IReadOnlyList<MmItem> items)
    {
        dynamic su = sesja;
        /* USTALONE (0.198.5) sondą na maszynie firmy: dokumenty niesie
           `SuDokumentyManager`, a metoda nazywa się `DodajMM`. Managera
           `DokumentyMagazynoweManager` — z dawnego szkicu w sfera.ts — na
           obiekcie sesji NIE MA WCALE. */
        dynamic mm = Krok("SuDokumentyManager.DodajMM()", 4,
            () => su.SuDokumentyManager.DodajMM());
        /* USTALONE (0.198.7) szkicem MM w sondzie: magazyny nazywają się
           `MagazynNadawczyId` i `MagazynOdbiorczyId`. Zgadnięte
           `MagazynZrodlowyId`/`MagazynDocelowyId` na dokumencie NIE ISTNIEJĄ —
           byłaby to TRZECIA zgadnięta nazwa, która wywróciłaby się dopiero
           przy pierwszym zwrocie u klienta. */
        Krok("MM.MagazynNadawczyId / MagazynOdbiorczyId", 4, () =>
        {
            mm.MagazynNadawczyId = magFrom;
            mm.MagazynOdbiorczyId = magTo;
        });
        foreach (var it in items)
        {
            /* USTALONE (0.198.12, szkic pozycji): `Dodaj(Variant)` przyjmuje
               identyfikator kartoteki i oddaje pozycję, a ilość na niej niesie
               `IloscJm`. Pozycja ma też `Ilosc` i `Jm` — `IloscJm` jest tym
               polem, które liczy w jednostce miary z kartoteki. */
            Krok("MM.Pozycje.Dodaj(tw_Id).IloscJm", 4, () =>
            {
                dynamic p = mm.Pozycje.Dodaj(it.TwId);
                p.IloscJm = it.Qty;
            });
        }
        /* Decyzja domyślna: MM powstaje WYKONANE, nie w buforze — sens
           operacji to „towar sprzedawalny na hali". [WERYFIKUJ] na etapie 2
           (docs/wdrozenie.md); jeśli firma woli bufor, tu jest to jedno
           wywołanie do zmiany. */
        Krok("MM.Zapisz()", 5, () => { mm.Zapisz(); });
        // `NumerPelny` potwierdzony na obiekcie dokumentu (szkic MM, 0.198.7)
        return (mm, Krok("MM.NumerPelny", 5, () => (string)mm.NumerPelny));
    }

    /// <summary>
    /// RW dla pozycji zniszczonych (0.67.0) — rozchód z magazynu sprzedaży,
    /// zaraz po korekcie, która te sztuki na stan oddała.
    /// </summary>
    private static string DodajRw(object sesja, int magId, IReadOnlyList<MmItem> items)
    {
        dynamic su = sesja;
        /* USTALONE (0.198.5): `SuDokumentyManager.DodajRW()`. Ten sam manager
           co MM — sonda wypisała komplet jego metod `Dodaj*`. */
        dynamic rw = Krok("SuDokumentyManager.DodajRW()", 8,
            () => su.SuDokumentyManager.DodajRW());
        /* `MagazynId` stoi na SESJI, nie na dokumencie — szkic MM pokazał, że
           `SuDokument` ma wyłącznie `MagazynNadawczyId` i `MagazynOdbiorczyId`.
           RW to rozchód, więc towar wychodzi z magazynu NADAWCZEGO. Lista
           składowych jest wspólna dla wszystkich typów dokumentu, więc to, że
           właściwość istnieje, nie dowodzi jeszcze, że RW jej używa: gdyby
           Sfera brała magazyn RW z kontekstu sesji, wołaniem zastępczym jest
           `su.MagazynId = magId` przed `DodajRW()`. Trzecia droga wyszła przy
           szkicu pozycji (0.198.12): POZYCJA też ma własne `MagazynId`.
           [WERYFIKUJ] na bramce 2 — rozstrzyga pierwszy RW. */
        Krok("RW.MagazynNadawczyId", 8, () => { rw.MagazynNadawczyId = magId; });
        foreach (var it in items)
        {
            Krok("RW.Pozycje.Dodaj(tw_Id).IloscJm", 8, () =>
            {
                dynamic p = rw.Pozycje.Dodaj(it.TwId);
                p.IloscJm = it.Qty;
            });
        }
        Krok("RW.Zapisz()", 8, () => { rw.Zapisz(); });
        return Krok("RW.NumerPelny", 8, () => (string)rw.NumerPelny);
    }

    public WynikKorekty CreateKorektaZwrotu(ZlecenieKorekty z)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException(
                "COM Sfery działa wyłącznie na Windows z zainstalowanym Subiektem GT. " +
                "Do przebiegu próbnego bez Sfery służy flaga --dry-run.");

        try
        {
            var su = Sesja();
            /* Sygnatura USTALONA sondą (0.198.6): `SuDokument DodajKFS()`,
               BEZ ARGUMENTÓW. Poprzednie wydanie wołało `DodajKFS(dok_Id)`
               i wywróciłoby się na liczbie argumentów — zgadywanie sygnatury
               kosztowało tyle samo, co zgadywanie nazwy.

               Korekta powstaje więc jako PUSTY dokument, a wskazanie dokumentu
               pierwotnego siedzi na obiekcie: `SuDokumentyManager` ma osobne
               `WczytajDokument(dok_Id)` zwracające `SuDokument`. Którą
               właściwością te dwa się wiąże — widać dopiero na obiekcie
               korekty, więc to `[WERYFIKUJ]` do bramki 2. */
            dynamic korekta = Krok("SuDokumentyManager.DodajKFS()", 6,
                () => su.SuDokumentyManager.DodajKFS());

            /* Powiązanie z dokumentem pierwotnym: `void NaPodstawie(Variant)`
               na obiekcie dokumentu (szkic MM, 0.198.7). Że Variant przyjmuje
               IDENTYFIKATOR, a nie wczytany dokument, mówi bliźniacza metoda
               `NaPodstawieWielu(SAFEARRAY(int))` — ta bierze tablicę intów.
               [WERYFIKUJ] zostaje sam typ argumentu; gdyby Sfera chciała
               obiektu, w tym miejscu wchodzi `WczytajDokument(z.DokId)`.
               Właściwość `DoDokumentuId` istnieje obok, ale wygląda na pole
               ODCZYTYWANE po powiązaniu: korekta musi przejąć pozycje
               dokumentu pierwotnego, a to robi się wywołaniem, nie przypisaniem. */
            Krok("Korekta.NaPodstawie(dok_Id)", 6, () => { korekta.NaPodstawie(z.DokId); });
            /* ── Adresowanie pozycji korekty ──────────────────────────────────
               Korekta nie DODAJE wierszy — `NaPodstawie` przenosi pozycje
               dokumentu pierwotnego, a my zmieniamy na nich ilość. Pozycję
               trzeba więc ODNALEŹĆ po kartotece.

               Kolekcja nie ma metody szukającej (`SzukajTowar`, na której stał
               kod do 0.198.10, NIE ISTNIEJE — sprawdzone sondą). Zostaje przejście
               po `Element(i)` z porównaniem `TowarId`. Obie nazwy i podstawa
               indeksu są zmierzone (0.198.12).

               Zniszczone wchodzą na korektę RAZEM z pełnowartościowymi: klient
               oddał towar, sprzedaż koryguje się w całości. */
            dynamic pozycjeKorekty = Krok("Korekta.Pozycje", 6, () => korekta.Pozycje);
            int ilePozycji = Krok("Korekta.Pozycje.Liczba", 6, () => (int)pozycjeKorekty.Liczba);
            foreach (var it in z.Pozycje.Concat(z.PozycjeZniszczone))
            {
                dynamic? wiersz = null;
                for (int i = PIERWSZA_POZYCJA; i < PIERWSZA_POZYCJA + ilePozycji; i++)
                {
                    int nr = i;
                    dynamic p = Krok($"Korekta.Pozycje.Element({nr}).TowarId", 6,
                        () => ElementZIndeksem((object)pozycjeKorekty, nr));
                    if ((int)p.TowarId != it.TwId) continue;
                    wiersz = p;
                    break;
                }
                /* Brak wiersza to NIEZGODNOŚĆ DANYCH, nie awaria Sfery: zwrot
                   mówi o kartotece, której nie ma na fakturze. Cichy `continue`
                   dałby korektę na mniejszą kwotę, niż należy się klientowi. */
                if (wiersz is null)
                {
                    throw new InvalidOperationException(
                        $"Dokument {z.DokId} nie ma pozycji z kartoteką {it.TwId}, a zwrot ją wymienia. " +
                        "Sprawdź powiązanie zwrotu z fakturą — korekty na resztę pozycji NIE wystawiono.");
                }
                /* [WERYFIKUJ] czy na KOREKCIE `IloscJm` znaczy „ilość po
                   korekcie". Pozycja ma jedno pole ilości w jednostce miary
                   i żadnego `IloscPoKorekcie` — Subiekt na ekranie korekty też
                   pyta o ilość docelową, nie o różnicę. Rozstrzyga to pierwsza
                   prawdziwa korekta na podmiocie testowym. */
                Krok("Korekta.pozycja.IloscJm", 6, () =>
                {
                    dynamic p = wiersz;
                    p.IloscJm = (double)p.IloscJm - it.Qty;
                });
            }
            Krok("Korekta.Zapisz()", 6, () => { korekta.Zapisz(); });
            string nrKorekty = Krok("Korekta.NumerPelny", 6, () => (string)korekta.NumerPelny);

            /* Dalsze ogniwa TEJ SAMEJ operacji: MM (pełnowartościowe → bufor)
               i RW (zniszczone schodzą ze stanu). Gdy którekolwiek padnie,
               wszystko przed nim MUSI zniknąć: korekta bez MM zostawia towar
               sprzedawalny w magazynie sprzedaży, korekta+MM bez RW zostawia
               zniszczone sztuki na stanie jako duchy. */
            dynamic? mmDok = null;
            string nrMm = "";
            try
            {
                if (z.Pozycje.Count > 0)
                    (mmDok, nrMm) = DodajMm((object)su, z.MagZrodlowy, z.MagZwrotow, z.Pozycje);
                string nrRw = z.PozycjeZniszczone.Count > 0
                    ? DodajRw((object)su, z.MagZrodlowy, z.PozycjeZniszczone)
                    : "";
                return new WynikKorekty(nrKorekty, nrMm, nrRw);
            }
            catch (Exception blad)
            {
                /* Wycofanie idzie od końca łańcucha; każdy nieusunięty dokument
                   trafia do komunikatu z IMIENIA, bo to jego człowiek będzie
                   musiał usunąć ręką przed ponowieniem. */
                var nieWycofane = new List<string>();
                /* `void Usun(bool)` — sygnatura ustalona (0.198.7), znaczenie
                   flagi NIE. Idzie `false`, bo w każdym czytaniu tej flagi
                   (potwierdzenie, kaskada na dokumenty powiązane, wymuszenie)
                   `false` jest działaniem WĘŻSZYM: usuwa ten jeden dokument
                   i o nic nie pyta. Usługa nie ma pulpitu, na którym mogłaby
                   odpowiedzieć na pytanie. [WERYFIKUJ] na bramce 2. */
                if (mmDok is not null)
                {
                    try { mmDok.Usun(false); }
                    catch { nieWycofane.Add($"MM {nrMm}"); }
                }
                try { korekta.Usun(false); }
                catch { nieWycofane.Add($"korekta {nrKorekty}"); }

                throw nieWycofane.Count == 0
                    ? new InvalidOperationException(
                        $"Dokumenty zwrotu nie powstały w całości — korekta {nrKorekty}" +
                        (nrMm.Length > 0 ? $" i MM {nrMm}" : "") +
                        $" zostały wycofane, PONÓW jest bezpieczny. Przyczyna: {blad.Message}", blad)
                    : new InvalidOperationException(
                        $"Dokumenty zwrotu nie powstały w całości, a wycofanie NIE OBJĘŁO: " +
                        $"{string.Join(", ", nieWycofane)} — usuń je w Subiekcie RĘCZNIE przed " +
                        $"ponowieniem. Przyczyna: {blad.Message}", blad);
            }
        }
        catch
        {
            ZamknijSesje();
            throw;
        }
    }

    /**
     * Adres serwera w postaci, której chce Sfera: `HOST\INSTANCJA`.
     *
     * Lustro `config.mssql` po stronie Node: instancja domyślnie INSERTGT,
     * a ustawiony `MSSQL_PORT` ma przed nią pierwszeństwo. Instancji nie
     * doklejamy, gdy ktoś wpisał ją już w `MSSQL_SERVER` — inaczej powstałoby
     * `HOST\INSERTGT\INSERTGT`, czyli adres, pod którym nie ma nikogo.
     */
    private string Serwer()
    {
        var serwer = _env.Get("MSSQL_SERVER", "localhost");
        var instancja = _env.Get("MSSQL_INSTANCE", "INSERTGT");
        if (serwer.Contains('\\') || instancja.Length == 0) return serwer;
        if ((_env.Get("MSSQL_PORT") ?? "").Length > 0) return serwer;
        return $"{serwer}\\{instancja}";
    }

    private dynamic Sesja()
    {
        if (_subiekt is not null) return _subiekt;

        /* [WERYFIKUJ] ProgID obiektu GT — wg dokumentacji Sfery "InsERT.GT".
           Z wertis.env, bo pomyłka tutaj blokuje absolutnie wszystko, a poprawka
           przez przebudowanie exe wymaga innej maszyny (patrz docs/sfera-com.md). */
        var progId = _env.Get("SFERA_PROGID", "InsERT.GT");
        var typ = Type.GetTypeFromProgID(progId)
            ?? throw new InvalidOperationException(
                $"Nie znaleziono COM \"{progId}\" — czy Subiekt GT (ze Sferą) jest zainstalowany na tej maszynie?");
        dynamic gt = Activator.CreateInstance(typ)!;

        /* Kolejność i komplet właściwości wg przykładu z dokumentacji Sfery
           (docs/sfera-com.md §1). Dwie z nich to NIE kosmetyka:

           — `Uzytkownik`/`UzytkownikHaslo` to LOGIN SQL, osobny od `Operator`.
             Przy autentykacji mieszanej Sfera bez niego nie ma czym otworzyć
             bazy. Nie jest to `MSSQL_USER`: tamten login ma z założenia prawo
             SELECT na sześciu tabelach i UPDATE na dwóch kolumnach (§6 etap 1),
             a Sfera wystawia dokumenty i potrzebuje pełnych praw podmiotu.
           — `Serwer` chce postaci `HOST\INSTANCJA`; instalator InsERT-u zakłada
             instancję INSERTGT, więc samo `MSSQL_SERVER` trafia w instancję
             domyślną, czyli zwykle w nic. */
        gt.Produkt = _env.GetInt("SFERA_PRODUKT", 1);         // gtaProduktSubiekt [WERYFIKUJ]
        gt.Serwer = Serwer();
        gt.Baza = _env.Get("MSSQL_DATABASE", "");
        gt.Autentykacja = _env.GetInt("SFERA_AUTENTYKACJA", 0);   // [WERYFIKUJ] mieszana vs Windows
        var loginSql = _env.Get("SFERA_SQL_LOGIN", "");
        if (loginSql.Length > 0)
        {
            gt.Uzytkownik = loginSql;
            gt.UzytkownikHaslo = _env.Get("SFERA_SQL_HASLO", "");
        }
        gt.Operator = _env.Get("SFERA_OPERATOR", "");
        gt.OperatorHaslo = _env.Get("SFERA_OPERATOR_HASLO", "");

        /* Uruchom(TypDopasowania, TrybUruchomienia). Drugi argument to MASKA
           BITOWA — powód wybranej kombinacji stoi przy `TRYB_DOMYSLNY`. */
        var tryb = _env.GetInt("SFERA_TRYB_URUCHOMIENIA", TRYB_DOMYSLNY);
        _subiekt = Krok("GT.Uruchom(...)", 3, () => gt.Uruchom(URUCHOM_DOPASUJ, tryb));
        Console.WriteLine(
            $"[sfera] sesja Subiekta otwarta (Sfera COM, {progId}, serwer {Serwer()}, tryb 0x{tryb:X})");
        return _subiekt!;
    }

    private void ZamknijSesje()
    {
        if (_subiekt is null) return;
        try
        {
            if (OperatingSystem.IsWindows()) Marshal.ReleaseComObject(_subiekt);
        }
        catch
        {
            // zwalnianie martwego uchwytu COM nie ma prawa ubić procesu
        }
        _subiekt = null;
        Console.WriteLine("[sfera] sesja Subiekta zamknięta po błędzie — następne zadanie otworzy nową");
    }
}
