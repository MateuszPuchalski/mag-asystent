using System.Net;
using WertisTloWorker;

/* ── Usługa usuwania tła (0.88.0) ────────────────────────────────────────────
   Czwarty proces WERTIS. Jedna trasa, jedno zdjęcie na wywołanie, nasłuch
   WYŁĄCZNIE na pętli lokalnej — klientem jest `wertis-api` z tej samej maszyny
   i nikt inny nie ma prawa tu wejść.

   HttpListener zamiast ASP.NET: jedna trasa nie potrzebuje routingu, potoku
   middleware ani konfiguracji hostingu, a każda z tych rzeczy to kolejna
   zależność w exe, który ma się dać skopiować na serwer firmy i uruchomić.

   PO JEDNYM ZDJĘCIU NARAZ. Sesja ONNX zjada kilkaset megabajtów przy dużym
   modelu, a maszyna jest tą, na której biuro wystawia faktury. Kolektorów
   robiących zdjęcia jednocześnie jest w praktyce jeden — kolejka przy drugim
   kosztuje sekundy, równoległość kosztowałaby pamięć.                        */

var dryRun = args.Contains("--dry-run");
var raz = args.Contains("--once");

var env = EnvFile.Load();
var url = env.Get("TLO_URL", "");
if (string.IsNullOrWhiteSpace(url))
{
    /* Odmowa startu, nie ciche nasłuchiwanie na domyślnym porcie. Pusty TLO_URL
       znaczy, że serwer WERTIS o tej usłudze nie wie i nigdy jej nie zawoła —
       proces stałby wtedy w tle, meldując się jako zdrowy i nie robiąc nic. */
    Console.Error.WriteLine(
        "Brak TLO_URL w wertis.env. Ustaw np. TLO_URL=http://127.0.0.1:8791 " +
        "— ten sam klucz czyta serwer WERTIS. Wdrożenie: DEPLOY.md §6.");
    return 2;
}

var bokWyniku = env.GetInt("TLO_BOK", 1024);
var sciezkaModelu = env.Get("TLO_MODEL", Path.Combine(AppContext.BaseDirectory, "model", "u2netp.onnx"));

UsuwanieTla? model = null;
if (!dryRun)
{
    try
    {
        model = new UsuwanieTla(sciezkaModelu);
    }
    catch (Exception e)
    {
        Console.Error.WriteLine(e.Message);
        return 3;
    }
}

using var nasluch = new HttpListener();
// Ukośnik na końcu jest w HttpListener OBOWIĄZKOWY — bez niego rzuca
// „prefiks jest nieprawidłowy", a wpis w wertis.env go nie ma.
nasluch.Prefixes.Add(url.TrimEnd('/') + "/");
try
{
    nasluch.Start();
}
catch (HttpListenerException e)
{
    Console.Error.WriteLine($"Nie da się nasłuchiwać pod {url}: {e.Message}");
    return 4;
}

Console.WriteLine(
    $"[tlo] nasłuch {url}{(dryRun ? " (--dry-run: bez modelu)" : $", model {sciezkaModelu}")}, " +
    $"bok wyniku {bokWyniku} px" + (env.Sciezka is null ? "" : $", konfiguracja {env.Sciezka}"));

var koniec = new ManualResetEventSlim(false);
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    koniec.Set();
    nasluch.Stop();
};

while (!koniec.IsSet)
{
    HttpListenerContext ctx;
    try
    {
        ctx = nasluch.GetContext();
    }
    catch (HttpListenerException)
    {
        break; // nasłuch zatrzymany przez Ctrl+C
    }

    try
    {
        Obsluz(ctx, model, bokWyniku, dryRun);
    }
    catch (Exception e)
    {
        /* Wyjątek na JEDNYM zdjęciu nie ma prawa położyć usługi: magazynier
           dostanie zdjęcie z tłem, a nie zawieszony kolektor przy każdym
           kolejnym kadrze. */
        Console.Error.WriteLine($"[tlo] błąd: {e.Message}");
        Odpowiedz(ctx, 500, "text/plain", System.Text.Encoding.UTF8.GetBytes(e.Message));
    }

    if (raz) break;
}

model?.Dispose();
return 0;

static void Obsluz(HttpListenerContext ctx, UsuwanieTla? model, int bokWyniku, bool dryRun)
{
    if (ctx.Request.HttpMethod != "POST" || ctx.Request.Url?.AbsolutePath != "/tlo")
    {
        Odpowiedz(ctx, 404, "text/plain", System.Text.Encoding.UTF8.GetBytes("POST /tlo"));
        return;
    }

    using var wejscie = new MemoryStream();
    ctx.Request.InputStream.CopyTo(wejscie);
    var bajty = wejscie.ToArray();
    if (bajty.Length == 0)
    {
        Odpowiedz(ctx, 400, "text/plain", System.Text.Encoding.UTF8.GetBytes("Puste ciało żądania"));
        return;
    }

    /* --dry-run odpowiada TAK, JAK GDYBY model nie znalazł przedmiotu, a nie
       udanym wycięciem. Cały łańcuch — kolektor, trasa, podgląd, przycisk
       „ZOSTAW TŁO" — da się dzięki temu przejść bez pliku modelu, a żadne
       ogniwo nie usłyszy nieprawdy o tym, co się z jego zdjęciem stało. */
    var wynik = dryRun ? null : model!.Przetworz(bajty, bokWyniku);
    if (wynik is null)
    {
        Odpowiedz(ctx, 422, "text/plain",
            System.Text.Encoding.UTF8.GetBytes("Na zdjęciu nie widać pojedynczego przedmiotu"));
        return;
    }
    Odpowiedz(ctx, 200, "image/png", wynik);
}

static void Odpowiedz(HttpListenerContext ctx, int kod, string typ, byte[] tresc)
{
    try
    {
        ctx.Response.StatusCode = kod;
        ctx.Response.ContentType = typ;
        ctx.Response.ContentLength64 = tresc.Length;
        ctx.Response.OutputStream.Write(tresc, 0, tresc.Length);
    }
    catch (HttpListenerException)
    {
        /* Klient rozłączył się w trakcie — na przykład serwer WERTIS przerwał
           żądanie po TLO_TIMEOUT_MS. Nie ma komu odpowiedzieć i nie ma na to
           rady; usługa ma z tego wyjść żywa. */
    }
    finally
    {
        ctx.Response.Close();
    }
}
