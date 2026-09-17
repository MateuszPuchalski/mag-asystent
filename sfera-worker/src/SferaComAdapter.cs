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
        /* PUSTY OBIEKT TO NIE POMYŁKA W NAZWIE (15 września 2026). Binder C#
           zgłasza `RuntimeBinderException` także wtedy, gdy wołamy metodę na
           null — i do tego dnia ten przypadek szedł gałęzią niżej. Kolejka na
           produkcji pokazała więc „Sfera nie zna wywołania DodajMM()", choć sonda
           tę nazwę potwierdziła. Pusty był obiekt sesji albo manager, a nie nazwa. */
        catch (Exception e) when (PustyObiekt(e))
        {
            throw new InvalidOperationException(
                $"Sfera oddała PUSTY obiekt przy „{wywolanie}” — to nie jest pomyłka w nazwie. " +
                $"Najczęściej sesja Subiekta jest otwarta na koncie bez dostępu do podmiotu: usługa " +
                $"działa jako {KontoProcesu()}, a sonda.ps1 zwykle na koncie człowieka. Uruchom " +
                "wertis-sfera na koncie, na którym przechodzi sonda (DEPLOY §3, konto usługi). " +
                $"Błąd źródłowy: {e.Message}", e);
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

    /**
     * Czy wyjątek mówi „wołasz na null". Binder C# zgłasza to tą samą klasą co
     * brak nazwy, więc rozstrzyga treść. Sprawdzane PRZED `NieznanaNazwa`.
     */
    private static bool PustyObiekt(Exception e) =>
        e is RuntimeBinderException
        && e.Message.Contains("null reference", StringComparison.OrdinalIgnoreCase);

    /** Konto Windows procesu — do dziennika i do treści błędu pustej sesji. */
    internal static string KontoProcesu() => $"{Environment.UserDomainName}\\{Environment.UserName}";

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

    public string CreateZw(ZlecenieZw z)
    {
        if (!OperatingSystem.IsWindows())
            throw new InvalidOperationException(
                "COM Sfery działa wyłącznie na Windows z zainstalowanym Subiektem GT. " +
                "Do przebiegu próbnego bez Sfery służy flaga --dry-run.");

        try
        {
            return WystawZw((object)Sesja(), z);
        }
        /* Blokada paragonu i odmowa merytoryczna nie psują SESJI — Sfera
           odpowiedziała poprawnie. Restart sesji kosztuje sekundy przy każdym
           zadaniu, więc zostaje dla prawdziwych awarii COM. */
        catch (Exception e) when (e is DokumentZablokowanyException or BladTrwalyException)
        {
            throw;
        }
        catch
        {
            ZamknijSesje();
            throw;
        }
    }

    /**
     * ZW do paragonu (0.349.0). Każdy krok stoi na pomiarze sondy — nazwy
     * i zachowania z docs/sfera-com.md §2m, nie z dokumentacji producenta.
     */
    private static string WystawZw(object sesja, ZlecenieZw z)
    {
        dynamic su = sesja;
        dynamic zw = Krok("SuDokumentyManager.DodajZW()", 6, () => su.SuDokumentyManager.DodajZW());
        try
        {
            /* `NaPodstawie` BLOKUJE paragon (sonda, 15 września 2026). Blokada
               cudzej sesji to biuro z paragonem na ekranie — zadanie ma poczekać,
               a nie spalić próby. Odmowa korekty to zły dokument: czekanie nic
               nie zmieni. */
            try
            {
                Krok("ZW.NaPodstawie(dok_Id)", 6, () => { zw.NaPodstawie(z.DokId); });
            }
            catch (InvalidOperationException e) when (Zawiera(e, "zablokowa"))
            {
                throw new DokumentZablokowanyException(
                    $"Paragon {z.DokId} jest otwarty w Subiekcie — ZW spróbuje ponownie za 2 minuty. {e.Message}");
            }
            catch (InvalidOperationException e) when (Zawiera(e, "wystawić korekty"))
            {
                throw new BladTrwalyException(
                    $"Subiekt nie pozwala wystawić ZW do dokumentu {z.DokId} — sprawdź, czy to paragon. {e.Message}");
            }

            /* SKUTEK Z PARAGONU. Szkic do PA 8995 miał False — taki ZW nie przyjąłby
               towaru na magazyn, a MM koszyka zdjęłoby go i tak. Do czasu
               ustalenia przyczyny decyduje biuro (docs/sfera-com.md §2m). */
            bool skutek = Krok("ZW.SkutekMagazynowy", 6, () => (bool)zw.SkutekMagazynowy);
            if (!skutek)
                throw new BladTrwalyException(
                    "ZW do tego paragonu nie przyjąłby towaru na magazyn (SkutekMagazynowy = False). " +
                    "Wystaw ZW ręcznie w Subiekcie i wpisz numer w panelu. ZW NIE wystawiono.");

            // „zwrot ze sprzedaży" — odczytane z ZW 772 wystawionego przez biuro
            Krok("ZW.RodzajZwrotuDetal", 6, () => { zw.RodzajZwrotuDetal = 1; });

            /* POZYCJE PO TowarId, nie po `DokHanLp` — to numer wiersza na ZW,
               nie na paragonie. Wiersz, który nie wraca, dostaje ZERO i ZOSTAJE:
               tak wygląda ZW biura, a Subiekt po zerze sam przelicza wartość.
               Ta sama kartoteka w dwóch wierszach paragonu wypełnia się po kolei. */
            dynamic pozycje = Krok("ZW.Pozycje", 6, () => zw.Pozycje);
            int ile = Krok("ZW.Pozycje.Liczba", 6, () => (int)pozycje.Liczba);
            var zostalo = z.Pozycje
                .GroupBy(p => p.TwId)
                .ToDictionary(g => g.Key, g => g.Sum(p => (decimal)p.Qty));
            bool przesylkaJest = false;
            for (int i = PIERWSZA_POZYCJA; i < PIERWSZA_POZYCJA + ile; i++)
            {
                int nr = i;
                dynamic p = Krok($"ZW.Pozycje.Element({nr})", 6,
                    () => ElementZIndeksem((object)pozycje, nr));
                int tw = Krok($"ZW.Pozycje.Element({nr}).TowarId", 6, () => (int)p.TowarId);
                decimal ilosc = Krok($"ZW.Pozycje.Element({nr}).IloscJm", 6,
                    () => Convert.ToDecimal((object)p.IloscJm));

                decimal nowa;
                if (z.PrzesylkaTwId > 0 && tw == z.PrzesylkaTwId)
                {
                    przesylkaJest = true;
                    nowa = z.PrzesylkaZostaw ? ilosc : 0m;
                }
                else if (zostalo.TryGetValue(tw, out var reszta) && reszta > 0m)
                {
                    nowa = Math.Min(ilosc, reszta);
                    zostalo[tw] = reszta - nowa;
                }
                else
                {
                    nowa = 0m;
                }

                if (nowa != ilosc)
                    Krok($"ZW.Pozycje.Element({nr}).IloscJm =", 6, () => { p.IloscJm = (double)nowa; });
            }

            /* Paragon z wcześniejszym ZW daje wyłącznie niezwrócone wiersze
               (sonda, PA 12102). Brak sztuk znaczy więc zwykle „ZW już był" —
               drugi dokument byłby dublem. */
            var brak = zostalo.Where(kv => kv.Value > 0m).ToList();
            if (brak.Count > 0)
                throw new BladTrwalyException(
                    "Na paragonie nie zostało do zwrotu: " +
                    string.Join(", ", brak.Select(kv => $"kartoteka {kv.Key} × {kv.Value:0.####}")) +
                    ". Możliwe, że ZW do tego paragonu już istnieje. ZW NIE wystawiono.");
            if (z.PrzesylkaZostaw && !przesylkaJest)
                throw new BladTrwalyException(
                    "Zwrot oddaje koszt dostawy, a paragon nie ma wiersza przesyłki (TW_ID_PRZESYLKA). " +
                    "ZW NIE wystawiono.");

            /* PEŁNA WARTOŚĆ ZWROTU = wartość ZW, co do grosza (decyzja właściciela:
               potrącenie tylko w Allegro). Rozjazd to inna cena na paragonie niż
               w zamówieniu albo zła kartoteka — dokument fiskalny nie wychodzi. */
            decimal wartosc = Krok("ZW.WartoscBrutto", 6, () => Convert.ToDecimal((object)zw.WartoscBrutto));
            long grosze = (long)Math.Round(wartosc * 100m, MidpointRounding.AwayFromZero);
            if (grosze != z.WartoscGrosze)
                throw new BladTrwalyException(
                    $"Wartość ZW {wartosc:0.00} zł nie zgadza się z pełną wartością zwrotu " +
                    $"{z.WartoscGrosze / 100m:0.00} zł. ZW NIE wystawiono — wystaw go ręcznie.");

            /* Szkic po wcześniejszym ZW startuje od kwoty CAŁEGO paragonu (sonda,
               PA 12102: 17,83 zł przy wartości 10,49 zł), więc przelew idzie jawnie. */
            Krok("ZW.PlatnoscPrzelewKwota", 6, () => { zw.PlatnoscPrzelewKwota = wartosc; });
            /* STAN DOKUMENTU DO TREŚCI ODMOWY (0.372.0). Odmowa zapisu ZW padła
               na produkcji trzeci raz i trzeci raz nie powiedziała nic:
               `SzczegolyOstatniegoBledu` puste, komunikat Sfery jednozdaniowy,
               a HRESULT (0x80040F20) to numer wewnętrzny Sfery. Bez stanu
               dokumentu biuro nie ma nawet od czego zacząć — nie zna paragonu,
               bo w treści stoi tylko numer zadania.

               Wartości są te SAME, które kod już odczytał wyżej. Nic tu nie
               zgadujemy i nic nie wołamy drugi raz — poza `DoDokumentuNumerPelny`
               (nazwa z sondy, docs/sfera-com.md §2m), czytanym obronnie. */
            string towary = string.Join(",", z.Pozycje
                .GroupBy(p => p.TwId)
                .Select(g => $"{g.Key}={g.Sum(x => (decimal)x.Qty):0.####}"));
            string stan =
                $"paragon {Pole((object)zw, "DoDokumentuNumerPelny")} (dok_Id {z.DokId}), " +
                $"wartość {wartosc:0.00} zł, przelew {wartosc:0.00} zł, " +
                /* KWOTA DO ZAPŁATY OBOK PRZELEWU (0.383.1). Worker ustawia JEDNĄ
                   formę płatności, a okno Subiekta wypełnia pięć i pilnuje ich
                   sumy. Jeśli szkic dziedziczy po paragonie drugą formę, suma
                   rozjedzie się z tą kwotą — i to widać dopiero, gdy obie stoją
                   w jednym zdaniu. Nazwa zmierzona sondą (docs/sfera-com.md §2m). */
                $"do zapłaty {Pole((object)zw, "KwotaDoZaplaty")}, " +
                $"rodzaj zwrotu 1, skutek magazynowy {skutek}, wierszy {ile}. " +
                "Tę samą odmowę pokaże sonda BEZ zapisu: sonda.ps1 -PlikEnv C:\\wertis\\wertis.env " +
                $"-SzkicZW -Paragon {z.DokId} -Towary \"{towary}\" -Sprawdz";
            ZapiszZeSzczegolami((object)zw, "ZW", stan);
            return Krok("ZW.NumerPelny", 6, () => (string)zw.NumerPelny);
        }
        finally
        {
            /* `Zamknij()` ZAWSZE — także po odmowie. Otwarty szkic trzyma blokadę
               paragonu, a sesja workera żyje godzinami: biuro nie otworzyłoby tego
               paragonu do restartu usługi (sonda, drugi przebieg). */
            try { zw.Zamknij(); } catch { /* zamknięcie nie ma prawa zasłonić przyczyny */ }
        }
    }

    private static bool Zawiera(Exception e, string fraza) =>
        e.Message.Contains(fraza, StringComparison.OrdinalIgnoreCase);

    /**
     * Właściwość dokumentu do TREŚCI BŁĘDU — nigdy nie wywraca wołającego.
     *
     * Lustro `Wartosc` z `sonda.ps1`: brak nazwy to co innego niż pusta wartość,
     * a jedno i drugie ma się zmieścić w zdaniu zamiast przerwać je wyjątkiem.
     * Jesteśmy tu już w obsłudze odmowy — druga odmowa zasłoniłaby pierwszą.
     *
     * DANYCH KONTRAHENTA TĄ DROGĄ NIE CZYTAMY. Treść błędu idzie do kolejki,
     * na ekran i do dziennika, a nabywca z paragonu nie jest nikomu do niczego
     * potrzebny przy odmowie zapisu.
     */
    private static string Pole(object dokument, string nazwa)
    {
        dynamic dok = dokument;
        try
        {
            object? w = nazwa switch
            {
                "DoDokumentuNumerPelny" => dok.DoDokumentuNumerPelny,
                "KwotaDoZaplaty" => dok.KwotaDoZaplaty,
                _ => null,
            };
            string tekst = (Convert.ToString(w) ?? "").Trim();
            return tekst.Length > 0 ? tekst : "(puste)";
        }
        catch (Exception e) when (NieznanaNazwa(e) || PustyObiekt(e))
        {
            return "(brak nazwy)";
        }
        catch (Exception e)
        {
            return $"(odmowa: {e.Message.Trim()})";
        }
    }

    /**
     * Zapis z PRZYCZYNĄ odmowy (0.349.1).
     *
     * Pierwszy ZW na produkcji (15 września 2026) padł zdaniem „Nie można
     * zapisać dokumentu." — trzy razy, bez słowa o powodzie. Przyczynę trzyma
     * `SzczegolyOstatniegoBledu` na dokumencie (nazwa z sondy), a
     * `SprawdzPoprawnosc()` zgłasza ją PRZED próbą zapisu.
     *
     * Odmowa jest TRWAŁA: dane dokumentu między próbami się nie zmieniają, więc
     * trzy identyczne próby tylko opóźniały biuro. Nieznana nazwa albo pusty
     * obiekt idą dalej zwykłą drogą — to awaria, nie odmowa.
     */
    private static void ZapiszZeSzczegolami(object dokument, string nazwa, string stan = "")
    {
        dynamic dok = dokument;
        try
        {
            dok.SprawdzPoprawnosc();
            dok.Zapisz();
        }
        catch (Exception e) when (!PustyObiekt(e) && !NieznanaNazwa(e))
        {
            string szczegoly;
            try { szczegoly = (Convert.ToString((object)dok.SzczegolyOstatniegoBledu) ?? "").Trim(); }
            catch { szczegoly = ""; }
            /* NUMER PO ODMOWIE (0.350.1). Na produkcji Subiekt nadał ZW 463,
               wpisał dokument i wycofał zapis — a import zdążył ten numer
               zobaczyć. Numer w komunikacie mówi biuru, czego szukać w Subiekcie
               (także w buforze), zanim uzna, że dokumentu nie ma. */
            string numer;
            try { numer = (Convert.ToString((object)dok.NumerPelny) ?? "").Trim(); }
            catch { numer = ""; }
            throw new BladTrwalyException(
                $"Subiekt nie zapisał {nazwa}: {e.Message.Trim()} " +
                (szczegoly.Length > 0 ? $"Szczegóły: {szczegoly} " : "(Sfera nie podała szczegółów) ") +
                $"Wyjątek: {LancuchWyjatku(e)}. " +
                (stan.Length > 0 ? $"Dokument: {stan}. " : "") +
                (numer.Length > 0
                    ? $"Subiekt zdążył nadać numer {numer} — sprawdź w Subiekcie, także w buforze, czy dokument nie został. "
                    : "") +
                $"{nazwa} NIE wystawiono — wystaw go ręcznie.");
        }
    }

    /**
     * Typ, kod HRESULT i treść każdego wyjątku w łańcuchu (0.350.1).
     *
     * Sfera przy odmowie zapisu ZW oddaje wyłącznie „Nie można zapisać
     * dokumentu.", a `SzczegolyOstatniegoBledu` bywa puste. Kod HRESULT i typ
     * wyjątku to jedyne, co jeszcze niesie informację — bez nich zostaje
     * zgadywanie przyczyny.
     */
    private static string LancuchWyjatku(Exception e)
    {
        var czesci = new List<string>();
        for (Exception? x = e; x is not null && czesci.Count < 5; x = x.InnerException)
            czesci.Add($"{x.GetType().Name} 0x{x.HResult:X8} „{x.Message.Trim()}”");
        return string.Join(" ← ", czesci);
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

        /* PUSTA SESJA ODPADA TUTAJ, a nie przy pierwszym dokumencie (15 września
           2026). Na produkcji `Uruchom` przeszedł bez wyjątku, a łańcuch wywrócił
           się dopiero na `SuDokumentyManager.DodajMM()` — z treścią o nieznanej
           nazwie. Sonda na koncie człowieka widziała tego managera, usługa na
           swoim koncie już nie. Sesja stoi w polu PRZED sprawdzeniem, żeby
           `ZamknijSesje()` u wołającego zwolniło uchwyt COM. */
        if (_subiekt is null)
            throw new InvalidOperationException(
                $"GT.Uruchom oddał pustą sesję na koncie {KontoProcesu()} — Subiekt w tle nie wstał. " +
                "Uruchom wertis-sfera na koncie, na którym przechodzi sonda.ps1 (DEPLOY §3, konto usługi).");
        dynamic sesja = _subiekt;
        object? manager = Krok<object?>("Subiekt.SuDokumentyManager", 4,
            () => (object?)sesja.SuDokumentyManager);
        if (manager is null)
            throw new InvalidOperationException(
                $"Sesja Subiekta otwarta na koncie {KontoProcesu()}, ale bez SuDokumentyManager — " +
                "to konto nie widzi dokumentów podmiotu. Uruchom wertis-sfera na koncie, " +
                "na którym przechodzi sonda.ps1 (DEPLOY §3, konto usługi).");

        Console.WriteLine(
            $"[sfera] sesja Subiekta otwarta (Sfera COM, {progId}, serwer {Serwer()}, " +
            $"tryb 0x{tryb:X}, konto {KontoProcesu()})");
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
