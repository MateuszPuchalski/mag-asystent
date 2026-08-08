import { db } from "../db/db.js";

/* ── Cache wyników zapytań, unieważniany stanem bazy ────────────────────────
   Dwa liczniki razem widzą KAŻDY zapis:

   - `PRAGMA data_version` rośnie, gdy bazę zmieni INNE połączenie — a piszą
     trzy procesy (API, worker Node, worker Sfery);
   - `total_changes()` rośnie przy zapisie TYM połączeniem, którego
     data_version nie zdradzi.

   Odczyt obu nie bierze żadnej blokady, więc sprawdzenie przy każdym
   trafieniu jest tanie. Cache nie wymaga przez to żadnego jawnego
   unieważniania — każdy zapis gdziekolwiek go zeruje. To celowo GRUBY
   warunek: heartbeat workera i tak zmienia bazę co 1–2 s, więc subtelniejsze
   śledzenie „czy to był zapis do MOJEJ tabeli" nie kupiłoby prawie nic,
   a kosztowałoby właśnie tę pomyłkę, której cache mieć nie może. */

interface Wpis {
  wartosc: unknown;
  dataVersion: number;
  totalChanges: number;
}

const wpisy = new Map<string, Wpis>();

function stanBazy(): { dataVersion: number; totalChanges: number } {
  const d = db();
  const dv = (d.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
  const tc = (d.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  return { dataVersion: dv, totalChanges: tc };
}

export function cachedByDbVersion<T>(name: string, compute: () => T): T {
  const stan = stanBazy();
  const wpis = wpisy.get(name);
  if (wpis && wpis.dataVersion === stan.dataVersion && wpis.totalChanges === stan.totalChanges) {
    return wpis.wartosc as T;
  }
  const wartosc = compute();
  // stan sprzed compute(): zapis, który wpadł W TRAKCIE liczenia, ma
  // unieważnić wynik przy następnym pytaniu, nie zostać uznany za policzony
  wpisy.set(name, { wartosc, ...stan });
  return wartosc;
}
