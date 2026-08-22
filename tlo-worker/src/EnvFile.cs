using System.Text.RegularExpressions;

namespace WertisTloWorker;

/* ── Wczytanie wertis.env — LUSTRO server/src/env-file.ts ────────────────────
   Konfiguracja ma JEDNO źródło: plik wertis.env czytany przez wszystkie CZTERY
   procesy (api, worker, sfera, tło). Rozjazd między procesami to najgroźniejsza
   awaria wdrożenia — bez objawu poza brakiem zmian w Subiekcie — więc ten
   parser odwzorowuje tamten co do znaku: export/KEY=VALUE, cudzysłowy,
   komentarze doklejone po białym znaku, pierwszeństwo zmiennych środowiska
   (semantyka dotenv). Zmieniasz tam → zmieniasz tutaj.

   KOPIA, NIE WSPÓŁDZIELONY PROJEKT, i to jest ta sama decyzja co przy workerze
   Sfery: oba exe mają być samowystarczalne i budować się osobno. Plik jest
   identyczny z `sfera-worker/src/EnvFile.cs` poza nazwą przestrzeni.          */

public sealed class EnvFile
{
    private readonly Dictionary<string, string> _plik;

    /// <summary>Ścieżka wczytanego pliku (do logu startowego) — null, gdy brak.</summary>
    public string? Sciezka { get; }

    private EnvFile(Dictionary<string, string> plik, string? sciezka)
    {
        _plik = plik;
        Sciezka = sciezka;
    }

    /// <summary>Zmienna środowiskowa wygrywa z plikiem — jak w Node.</summary>
    public string? Get(string klucz)
    {
        var env = Environment.GetEnvironmentVariable(klucz);
        if (!string.IsNullOrEmpty(env)) return env;
        return _plik.TryGetValue(klucz, out var v) ? v : null;
    }

    public string Get(string klucz, string domyslna) => Get(klucz) ?? domyslna;

    public int GetInt(string klucz, int domyslna)
    {
        var v = Get(klucz);
        if (string.IsNullOrEmpty(v)) return domyslna;
        // Śmieci są BŁĘDEM, nie cichym powrotem do domyślnej (lustro num() z config.ts).
        if (!int.TryParse(v, out var n))
            throw new InvalidOperationException($"{klucz}={v} — oczekiwano liczby. Popraw w wertis.env.");
        return n;
    }

    /// <summary>
    /// Kandydaci w kolejności — lustro envFileCandidates():
    /// WERTIS_ENV_FILE → katalog exe → bieżący katalog.
    /// </summary>
    public static EnvFile Load()
    {
        var jawny = Environment.GetEnvironmentVariable("WERTIS_ENV_FILE");
        var kandydaci = !string.IsNullOrEmpty(jawny)
            ? new[] { jawny }
            : new[]
            {
                Path.Combine(AppContext.BaseDirectory, "wertis.env"),
                // instalator kładzie plik w korzeniu C:\wertis, exe w C:\wertis\tlo-worker
                Path.Combine(AppContext.BaseDirectory, "..", "wertis.env"),
                Path.Combine(Environment.CurrentDirectory, "wertis.env"),
            };

        foreach (var sciezka in kandydaci)
        {
            if (!File.Exists(sciezka)) continue;
            return new EnvFile(Parse(File.ReadAllText(sciezka)), Path.GetFullPath(sciezka));
        }
        return new EnvFile(new Dictionary<string, string>(), null);
    }

    private static readonly Regex Linia =
        new(@"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", RegexOptions.Compiled);

    public static Dictionary<string, string> Parse(string tekst)
    {
        var wynik = new Dictionary<string, string>();
        foreach (var surowa in tekst.Split('\n'))
        {
            var linia = surowa.TrimEnd('\r').Trim();
            if (linia.Length == 0 || linia.StartsWith('#')) continue;

            var m = Linia.Match(linia);
            if (!m.Success) continue;
            var klucz = m.Groups[1].Value;
            var wartosc = m.Groups[2].Value;

            if (wartosc.Length > 0 && (wartosc[0] == '"' || wartosc[0] == '\''))
            {
                // W cudzysłowie `#` jest zwykłym znakiem — hasło może go zawierać.
                var cudzyslow = wartosc[0];
                var koniec = wartosc.IndexOf(cudzyslow, 1);
                wartosc = koniec == -1 ? wartosc[1..] : wartosc[1..koniec];
            }
            else
            {
                /* Bez cudzysłowu bash ucina komentarz dopiero po BIAŁYM ZNAKU —
                   `haslo#7` zostaje w całości. Ta sama reguła co w env-file.ts. */
                wartosc = Regex.Replace(wartosc, @"\s+#.*$", "").Trim();
            }
            wynik[klucz] = wartosc;
        }
        return wynik;
    }
}
