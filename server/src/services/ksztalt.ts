/* ── Opis KSZTAŁTU odpowiedzi, nie jej treści (0.137.2) ──────────────────────
   Etap 1 przebudowy obsługi klienta. Cały dotychczasowy model danych stał na
   JSON-ie, który sami wymyśliliśmy w testach adaptera — i tam pękł: pytanie
   o rozrusznik przyjechało bez numeru oferty, choć mail z Allegro tę ofertę
   nazywa. Zanim zaprojektujemy cokolwiek od nowa, musimy zobaczyć, co żywe
   konto NAPRAWDĘ oddaje.

   Zobaczyć znaczy tu: nazwy pól, ich typy i to, jak często bywają puste.
   NIE znaczy: treści wiadomości, loginów, nazwisk, adresów ani numerów. Raport
   wchodzi do repo, więc nie ma prawa nieść ani jednej danej osobowej — i to
   jest jedyny powód, dla którego wartości pokazujemy tak skąpo.             */

/** Jedno pole w odpowiedzi: gdzie stoi, czym bywa i jak często je widać. */
export interface PoleKsztaltu {
  /** Ścieżka z gwiazdką za tablicami, np. `messages[].relatedObject.type`. */
  sciezka: string;
  /** Typy spotkane pod tą ścieżką — więcej niż jeden znaczy pole zmienne. */
  typy: string[];
  /** W ilu rekordach klucz W OGÓLE był. */
  obecne: number;
  /** W ilu miał wartość inną niż null, "" i []. */
  niepuste: number;
  /** Wartości słownikowe z liczbą wystąpień; puste, gdy pole nie jest słownikiem. */
  wartosci: Array<{ wartosc: string; ile: number }>;
}

/**
 * Nazwy kluczy, których wartości NIE POKAZUJEMY nigdy — nawet gdyby przeszły
 * regułę słownika. Druga zapora obok wzorca: reguła może się kiedyś poluzować,
 * ta lista nie. Dopasowanie po fragmencie nazwy i bez wielkości liter, bo
 * Allegro miesza `text`, `firstName` i `deliveryAddress`.
 */
const ZAKAZANE_KLUCZE = [
  "text", "content", "message", "body", "note", "comment", "subject", "title",
  "login", "name", "email", "phone", "address", "street", "city", "zip", "post",
  "company", "tax", "nip", "account", "iban", "token", "secret",
];

/**
 * Wartość słownikowa: WIELKIMI, bez spacji, krótka. Allegro pisze tak enumy
 * (`BUYER`, `OFFER`, `READY_FOR_PROCESSING`), a nie pisze tak niczego, co
 * pochodzi od człowieka. Login `mirek352810`, numer oferty `18448310205`
 * i UUID tego wzorca nie przechodzą — i o to chodzi.
 */
const WZORZEC_SLOWNIKA = /^[A-Z][A-Z0-9_]{0,31}$/;

/** Powyżej tylu różnych wartości pole przestaje być słownikiem, a zaczyna być danymi. */
const MAX_WARTOSCI = 12;

const zakazany = (sciezka: string): boolean => {
  const ostatni = sciezka.split(".").pop()?.replace("[]", "").toLowerCase() ?? "";
  return ZAKAZANE_KLUCZE.some((z) => ostatni.includes(z));
};

/** Nazwa typu do raportu. `null` jest osobnym typem, bo mówi „bywa puste". */
function typWartosci(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "tablica";
  switch (typeof v) {
    case "string":
      return "tekst";
    case "number":
      return "liczba";
    case "boolean":
      return "logiczna";
    case "object":
      return "obiekt";
    default:
      return typeof v;
  }
}

const pusta = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

interface Zbieracz {
  typy: Set<string>;
  obecne: number;
  niepuste: number;
  wartosci: Map<string, number>;
  /** Raz przekroczony sufit różnorodności już nie wraca — to nie jest słownik. */
  zaDuzo: boolean;
}

/**
 * Opisuje kształt listy rekordów. Rekordem jest jeden element odpowiedzi
 * (wątek, wiadomość, zamówienie) — liczby „obecne" i „niepuste" odnoszą się
 * do niego, bo pytanie brzmi „na ilu rekordach mogę polegać".
 */
export function opiszKsztalt(rekordy: unknown[]): PoleKsztaltu[] {
  const pola = new Map<string, Zbieracz>();

  const dojdz = (sciezka: string, wartosc: unknown): void => {
    const z = pola.get(sciezka) ?? {
      typy: new Set<string>(),
      obecne: 0,
      niepuste: 0,
      wartosci: new Map<string, number>(),
      zaDuzo: false,
    };
    z.typy.add(typWartosci(wartosc));
    z.obecne++;
    if (!pusta(wartosc)) z.niepuste++;

    /* Logiczne pokazujemy wprost: `true`/`false` nie jest niczyją daną, a bez
       tego nie widać, czy pole bywa oboma. */
    if (typeof wartosc === "boolean") {
      z.wartosci.set(String(wartosc), (z.wartosci.get(String(wartosc)) ?? 0) + 1);
    } else if (
      typeof wartosc === "string" &&
      !zakazany(sciezka) &&
      WZORZEC_SLOWNIKA.test(wartosc)
    ) {
      z.wartosci.set(wartosc, (z.wartosci.get(wartosc) ?? 0) + 1);
      if (z.wartosci.size > MAX_WARTOSCI) z.zaDuzo = true;
    }
    pola.set(sciezka, z);
  };

  const zejdz = (sciezka: string, wartosc: unknown): void => {
    if (Array.isArray(wartosc)) {
      /* Tablica dostaje własny wpis (żeby było widać, że bywa pusta), a jej
         elementy jadą pod ścieżką z `[]` — inaczej trzy zamówienia po pięć
         pozycji dałyby piętnaście osobnych ścieżek. */
      for (const el of wartosc) zejdz(`${sciezka}[]`, el);
      return;
    }
    if (wartosc !== null && typeof wartosc === "object") {
      for (const [k, v] of Object.entries(wartosc as Record<string, unknown>)) {
        const glebiej = sciezka === "" ? k : `${sciezka}.${k}`;
        dojdz(glebiej, v);
        zejdz(glebiej, v);
      }
    }
  };

  for (const r of rekordy) zejdz("", r);

  return [...pola.entries()]
    .map(([sciezka, z]) => ({
      sciezka,
      typy: [...z.typy].sort(),
      obecne: z.obecne,
      niepuste: z.niepuste,
      wartosci: z.zaDuzo
        ? []
        : [...z.wartosci.entries()]
            .map(([wartosc, ile]) => ({ wartosc, ile }))
            .sort((a, b) => b.ile - a.ile || a.wartosc.localeCompare(b.wartosc)),
    }))
    .sort((a, b) => a.sciezka.localeCompare(b.sciezka));
}

/**
 * Raport jednej końcówki jako tabela Markdown. Kolumna NIEPUSTE jest tu
 * najważniejsza: pole obecne w każdym rekordzie, ale puste w połowie, jest
 * dokładnie tą pułapką, w którą wpadł numer oferty przy pytaniach.
 */
export function raportKoncowki(nazwa: string, rekordow: number, pola: PoleKsztaltu[]): string {
  if (pola.length === 0) {
    return `## ${nazwa}\n\nPusta odpowiedź — nie ma czego opisać (rekordów: ${rekordow}).\n`;
  }
  const wiersze = pola.map((p) => {
    const wartosci = p.wartosci.length
      ? p.wartosci.map((w) => `\`${w.wartosc}\` ×${w.ile}`).join(", ")
      : "—";
    return `| \`${p.sciezka}\` | ${p.typy.join(", ")} | ${p.obecne} | ${p.niepuste} | ${wartosci} |`;
  });
  return [
    `## ${nazwa}`,
    "",
    `Rekordów w próbce: **${rekordow}**.`,
    "",
    "| pole | typ | obecne | niepuste | wartości słownikowe |",
    "|---|---|---:|---:|---|",
    ...wiersze,
    "",
  ].join("\n");
}
