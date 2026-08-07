namespace WertisSferaWorker;

/* ── Worker Sfery — pętla główna (odpowiednik server/src/worker/worker.ts) ───
   Trzeci proces WERTIS: czyta sfera_queue i wykonuje WYŁĄCZNIE zadania mm
   przez COM Sfery. set_location zostaje w workerze Node — podział pilnowany
   z obu stron (tam filtr `type <> 'mm'` przy SFERA_WORKER=1, tu zapytania
   biorą wyłącznie mm).

   Jeden wątek STA, jedno zadanie naraz — COM Sfery nie jest thread-safe
   (spec §9, kontrakt w server/src/adapters/sfera.ts).

   Flagi:
     --dry-run  pętla bez Sfery (DryRunAdapter) — przebieg próbny, także Linux
     --once     jeden tick i koniec — do testów                                */

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var dryRun = args.Contains("--dry-run");
        var once = args.Contains("--once");

        var env = EnvFile.Load();
        Console.WriteLine($"[sfera] wertis.env: {env.Sciezka ?? "(brak pliku — tylko zmienne środowiskowe)"}");

        /* Bez SFERA_WORKER=1 zadania mm bierze worker Node — drugi wykonawca
           tej samej kolejki to wyścig, w dry-run tym groźniejszy, że oznaczałby
           zadania jako done z fikcyjnym numerem. Odmowa startu, nie ostrzeżenie. */
        if (env.Get("SFERA_WORKER") != "1")
        {
            Console.Error.WriteLine(
                "[sfera] SFERA_WORKER nie jest ustawione na 1 — zadania mm obsługuje worker Node " +
                "i drugi wykonawca zrobiłby wyścig o tę samą kolejkę. Ustaw SFERA_WORKER=1 " +
                "w wertis.env (DEPLOY §6, etap 2) i zrestartuj wszystkie usługi.");
            return 1;
        }
        var sgtMode = env.Get("SGT_MODE", "seeded");
        if (sgtMode != "mssql")
        {
            Console.Error.WriteLine(
                $"[sfera] SGT_MODE={sgtMode} — worker Sfery ma sens tylko przy pracy na bazie " +
                "Subiekta (mssql). W trybie seeded dokumenty MM wykonuje worker Node (demo).");
            return 1;
        }

        var dbPath = env.Get("DB_PATH")
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "server", "data", "wertis.db"));
        var pollMs = env.GetInt("WORKER_POLL_MS", 1200);

        using var db = Db.Open(dbPath);
        ISferaAdapter sfera = dryRun ? new DryRunAdapter() : new SferaComAdapter(env);

        // mm zastane w 'processing' po padnięciu → error z ostrzeżeniem o duplikacie
        Queue.OznaczPrzerwane(db);

        Console.WriteLine(
            $"[sfera] start · poll {pollMs}ms · dryRun={dryRun} · baza={dbPath} · SGT_MODE={sgtMode}");

        while (true)
        {
            try
            {
                Heartbeat.Zamelduj(db, sgtMode, dryRun);
                var zadanie = Queue.Pick(db);
                if (zadanie is not null && !Queue.CzekaNaDokument(db, zadanie))
                    Queue.Przetworz(db, zadanie, sfera);
            }
            catch (Exception e)
            {
                /* Błąd ticku (np. chwilowo zablokowana baza) nie ubija usługi —
                   NSSM by ją wprawdzie zrestartował, ale restart co kolizję
                   to hałas w logu zamiast jednej linii. */
                Console.Error.WriteLine($"[sfera] błąd pętli: {e.Message}");
            }
            if (once) break;
            Thread.Sleep(pollMs);
        }
        return 0;
    }
}
