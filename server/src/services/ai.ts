import { config } from "../config.js";

/* ── Model językowy — szkic odpowiedzi dla klienta ───────────────────────────
   Druga integracja HTTP wychodząca w tym serwerze, po Allegro, i zbudowana
   tak samo: globalny `fetch`, zero zależności. Oficjalne SDK obu dostawców
   wciągnęłyby pierwszą od lat zależność do `server/package.json` (dziś:
   fastify i mssql), a oba API to zwykły HTTPS z JSON-em — koszt własnego
   klienta to jedna funkcja na dostawcę.

   Jedno zapytanie na pytanie klienta, z kontekstem POBRANYM WCZEŚNIEJ przez
   `services/pytania.ts` (kartoteki, stany, zamienniki, nasze oferty). Pętla
   narzędziowa dałaby modelowi samodzielne szukanie, ale kosztem kilku rund
   HTTP i niedeterministycznych testów — a właściciel dziś wkleja screenshot
   do czata BEZ żadnych narzędzi, więc jedno zapytanie z lepszym kontekstem
   jest już krokiem naprzód. Interfejs tego nie zamyka: pętlę da się dołożyć
   w `generujOdpowiedz` bez ruszania wołających.

   Odpowiedź modelu jest UMÓWIONYM JSON-em, nie swobodnym tekstem — inaczej
   nie dałoby się z niej wyjąć kategorii ani symboli do statystyk. Parser jest
   jednak wyrozumiały: nieparsowalna odpowiedź ląduje w polu `odpowiedz`
   w całości. Szkic bez klasyfikacji da się wysłać, błąd 500 nie.            */

export type TrybAI = "dev" | "anthropic" | "openai" | "wylaczone";

/** Kategorie pytań — zamknięta lista, bo po niej liczą się statystyki. */
export const KATEGORIE = [
  "dobor-czesci",
  "dostawa-wysylka",
  "stan-zamowienia",
  "reklamacja",
  "inne",
] as const;

const MODEL_ANTHROPIC = "claude-opus-5";
const MODEL_OPENAI = "gpt-4o";

/**
 * Tryb faktycznie użyty: jawny `AI_PROVIDER` wygrywa, puste wynika z
 * `SGT_MODE` — ten sam wzorzec co `allegroTryb`. Różnica jest jedna i celowa:
 * brak konfiguracji na produkcji znaczy WYŁĄCZONE, a nie „udawaj". Fikcyjny
 * doradca w prawdziwym magazynie byłby gorszy niż brak zakładki.
 */
export function aiTryb(): TrybAI {
  if (config.ai.provider) return config.ai.provider;
  return config.sgtMode === "mssql" ? "wylaczone" : "dev";
}

/** Model, którego użyjemy — do banera w panelu i do logu. */
export function modelAI(tryb: TrybAI = aiTryb()): string {
  if (config.ai.model) return config.ai.model;
  if (tryb === "anthropic") return MODEL_ANTHROPIC;
  if (tryb === "openai") return MODEL_OPENAI;
  return "";
}

export interface StanAI {
  tryb: TrybAI;
  model: string;
  /** Zdanie dla panelu — co jest i co ewentualnie zrobić. */
  opis: string;
}

export function stanAI(): StanAI {
  const tryb = aiTryb();
  const opis =
    tryb === "wylaczone"
      ? "Szkice AI są wyłączone. Dopisz AI_PROVIDER (anthropic albo openai) " +
        "i klucz API do wertis.env, potem zrestartuj usługę wertis-api."
      : tryb === "dev"
        ? "Doradca DEV — odpowiedzi są fikcyjne i składane z kontekstu, bez " +
          "wychodzenia w internet. Do demo i testów."
        : `Szkice pisze ${tryb === "anthropic" ? "Claude" : "OpenAI"} (${modelAI(tryb)}).`;
  return { tryb, model: modelAI(tryb), opis };
}

/** Awaria integracji z modelem. `kod` niesie status HTTP dla trasy. */
export class BladAI extends Error {
  constructor(
    message: string,
    readonly kod = 502
  ) {
    super(message);
    this.name = "BladAI";
  }
}

export interface ObrazPytania {
  /** Sam base64, bez przedrostka `data:`. */
  base64: string;
  mime: string;
}

/** Para pytanie → wysłana odpowiedź; uczy model naszego stylu. */
export interface PrzykladOdpowiedzi {
  pytanie: string;
  odpowiedz: string;
}

export interface ZadanieAI {
  /** Prompt ekspercki z panelu + fakty firmowe + umowa o JSON. */
  system: string;
  /** Pytanie tekstem; null, gdy mamy sam screenshot. */
  tekst: string | null;
  obraz?: ObrazPytania;
  /** Blok wiedzy z magazynu, zbudowany przez `services/pytania.ts`. */
  kontekst: string;
}

export interface OdpowiedzAI {
  odpowiedz: string;
  kategoria: string | null;
  produkty: Array<{ symbol: string }>;
  /** Model urządzenia klienta, gdy da się go wyłuskać. */
  urzadzenie: string | null;
  wOfercie: boolean | null;
  /** Transkrypcja pytania ze screenshota — obrazu NIE zapisujemy. */
  pytanieKlienta: string | null;
}

/**
 * Stała część promptu systemowego.
 *
 * Trzyma UMOWĘ O KSZTAŁCIE ODPOWIEDZI, a nie wiedzę o częściach — tamta
 * należy do właściciela i mieszka w `ai_config.prompt`, żeby dało się ją
 * poprawić bez wydania nowej wersji.
 */
const UMOWA_JSON = `
FORMAT ODPOWIEDZI — obowiązkowy.
Odpowiedz WYŁĄCZNIE obiektem JSON, bez komentarza przed ani po, bez płotków \`\`\`:
{
  "odpowiedz": "gotowa treść wiadomości do klienta, po polsku, z linkami do naszych aukcji jeśli są w KONTEKŚCIE",
  "kategoria": "${KATEGORIE.join(" | ")}",
  "produkty": [{"symbol": "SYMBOL-KARTOTEKI"}],
  "urzadzenie": "model maszyny klienta albo null",
  "w_ofercie": true albo false albo null,
  "pytanie_klienta": "treść pytania przepisana z obrazu albo null"
}

Zasady twarde:
- "odpowiedz" ma być gotowa do wysłania: bez nawiasów do uzupełnienia, bez „proszę sprawdzić”.
- Linki podawaj WYŁĄCZNIE te z KONTEKSTU. Nie zmyślaj adresów aukcji ani cen.
- "produkty" wypełniaj symbolami Z KONTEKSTU. Symbol, którego tam nie ma, nie istnieje.
- Gdy kontekst nie daje pewności, napisz w odpowiedzi, o co dopytać klienta,
  i ustaw "w_ofercie": null. Zgadywanie pasującej części jest gorsze niż pytanie.
- Kosztów wysyłki, terminów i zasad płatności nie wymyślaj: albo są w FAKTACH
  FIRMOWYCH, albo napisz, że sprawdzisz i odpiszesz.
`.trim();

const DOMYSLNY_PROMPT = `
Jesteś doświadczonym doradcą w sklepie z częściami do maszyn ogrodniczych
(kosiarki, pilarki, agregaty, podkaszarki). Odpowiadasz na pytania klientów
Allegro w imieniu firmy WERTIS.

Piszesz zwięźle i konkretnie, po polsku, w drugiej osobie liczby mnogiej
(„Dzień dobry, …”). Zaczynasz od odpowiedzi na zadane pytanie, nie od uprzejmości.
Gdy część pasuje — podajesz symbol, cenę i link do aukcji. Gdy nie masz pewności —
dopytujesz o model urządzenia albo numer katalogowy części ze starej sztuki.
`.trim();

/**
 * System prompt: wiedza właściciela + fakty firmowe + przykłady + umowa.
 *
 * Kolejność nie jest przypadkowa. Umowa o JSON idzie NA KOŃCU, bo ostatnie
 * zdanie promptu waży najwięcej, a to ono decyduje, czy odpowiedź da się
 * w ogóle rozebrać. Przykłady są przed nią i po faktach: to wzorzec stylu,
 * a nie źródło wiedzy.
 */
export function zbudujSystem(
  prompt: string,
  fakty: string,
  przyklady: PrzykladOdpowiedzi[] = []
): string {
  const czesci = [prompt.trim() || DOMYSLNY_PROMPT];

  if (fakty.trim()) {
    czesci.push(
      `FAKTY FIRMOWE — to jedyne źródło prawdy o wysyłce, terminach i płatnościach:\n${fakty.trim()}`
    );
  }

  if (przyklady.length > 0) {
    const wzory = przyklady
      .map((p, i) => `[${i + 1}] Klient: ${p.pytanie.trim()}\n    Nasza odpowiedź: ${p.odpowiedz.trim()}`)
      .join("\n\n");
    czesci.push(
      "TAK ODPOWIADAMY NAPRAWDĘ — wcześniejsze odpowiedzi po redakcji biura.\n" +
        "Naśladuj ton i długość, nie treść:\n\n" +
        wzory
    );
  }

  czesci.push(UMOWA_JSON);
  return czesci.join("\n\n");
}

/** Treść użytkownika: pytanie + blok kontekstu z magazynu. */
export function zbudujTrescUzytkownika(tekst: string | null, kontekst: string): string {
  const pytanie = tekst?.trim()
    ? `PYTANIE KLIENTA:\n${tekst.trim()}`
    : "PYTANIE KLIENTA: na obrazie w załączniku — przepisz je do pola \"pytanie_klienta\".";
  return `${pytanie}\n\n${kontekst.trim()}`;
}

const tekstPola = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * Odpowiedź modelu → typ domenowy.
 *
 * DEGRADUJE UCZCIWIE: gdy JSON-a nie da się rozebrać, cały tekst ląduje
 * w `odpowiedz`, a klasyfikacja zostaje pusta. Biuro dostaje wtedy szkic
 * do poprawienia zamiast błędu, a statystyki tracą jeden wiersz — to dobra
 * zamiana, bo statystyki są skutkiem ubocznym, a szkic celem.
 */
export function sparsujOdpowiedzAI(surowy: string): OdpowiedzAI {
  const pusty: OdpowiedzAI = {
    odpowiedz: surowy.trim(),
    kategoria: null,
    produkty: [],
    urzadzenie: null,
    wOfercie: null,
    pytanieKlienta: null,
  };

  /* Model bywa uprzejmy i owija JSON w płotki markdown mimo zakazu — wycięcie
     ich jest tańsze niż stracony szkic. */
  let tekst = surowy.trim();
  const plotki = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(tekst);
  if (plotki) tekst = plotki[1].trim();
  else {
    /* Zdanie wstępne przed obiektem („Oto odpowiedź:") — bierzemy od pierwszej
       klamry do ostatniej. Przy braku klamr `slice` da pustkę i parse rzuci,
       co sprowadza nas do uczciwej degradacji niżej. */
    const od = tekst.indexOf("{");
    const do_ = tekst.lastIndexOf("}");
    if (od > 0 && do_ > od) tekst = tekst.slice(od, do_ + 1);
  }

  let obiekt: Record<string, unknown>;
  try {
    const rozebrane = JSON.parse(tekst);
    if (!rozebrane || typeof rozebrane !== "object" || Array.isArray(rozebrane)) return pusty;
    obiekt = rozebrane as Record<string, unknown>;
  } catch {
    return pusty;
  }

  const odpowiedz = tekstPola(obiekt.odpowiedz);
  if (!odpowiedz) return pusty; // JSON bez treści odpowiedzi jest bezużyteczny

  const kategoria = tekstPola(obiekt.kategoria);
  const produkty = Array.isArray(obiekt.produkty)
    ? obiekt.produkty
        .map((p) => {
          if (typeof p === "string") return tekstPola(p);
          const o = (p ?? {}) as Record<string, unknown>;
          return tekstPola(o.symbol);
        })
        .filter((s): s is string => s !== null)
        .map((symbol) => ({ symbol }))
    : [];

  return {
    odpowiedz,
    /* Kategoria spoza umówionej listy jest wyrzucana, nie zapisywana: pole
       zasila statystyki i jedna „doradztwo-techniczne" rozbiłaby zestawienie. */
    kategoria: kategoria && (KATEGORIE as readonly string[]).includes(kategoria) ? kategoria : null,
    produkty,
    urzadzenie: tekstPola(obiekt.urzadzenie),
    wOfercie: typeof obiekt.w_ofercie === "boolean" ? obiekt.w_ofercie : null,
    pytanieKlienta: tekstPola(obiekt.pytanie_klienta),
  };
}

/** Szkic odpowiedzi od skonfigurowanego dostawcy. */
export async function generujOdpowiedz(zadanie: ZadanieAI): Promise<OdpowiedzAI> {
  const tryb = aiTryb();
  switch (tryb) {
    case "wylaczone":
      throw new BladAI(stanAI().opis, 400);
    case "dev":
      return doradcaDev(zadanie);
    case "anthropic":
      return sparsujOdpowiedzAI(await zapytajAnthropic(zadanie));
    case "openai":
      return sparsujOdpowiedzAI(await zapytajOpenAI(zadanie));
  }
}

/* ── Anthropic ───────────────────────────────────────────────────────────── */

async function zapytajAnthropic(zadanie: ZadanieAI): Promise<string> {
  const tresci: unknown[] = [];
  /* Obraz PRZED tekstem — tak zaleca dokumentacja i tak model widzi, czego
     dotyczy polecenie. */
  if (zadanie.obraz) {
    tresci.push({
      type: "image",
      source: { type: "base64", media_type: zadanie.obraz.mime, data: zadanie.obraz.base64 },
    });
  }
  tresci.push({ type: "text", text: zbudujTrescUzytkownika(zadanie.tekst, zadanie.kontekst) });

  const odp = await wyslij(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": config.ai.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: modelAI("anthropic"),
      max_tokens: 4000,
      /* Ani `temperature`, ani `thinking.budget_tokens`: bieżące modele
         odrzucają oba błędem 400. Głębokość rozumowania steruje `effort`,
         a „medium" pasuje do zadania — to redakcja odpowiedzi na gotowym
         kontekście, nie rozwiązywanie zagadki. */
      output_config: { effort: "medium" },
      system: zadanie.system,
      messages: [{ role: "user", content: tresci }],
    },
    "Claude"
  );

  const root = odp as Record<string, unknown>;
  /* Odmowa ze względów bezpieczeństwa wraca jako HTTP 200 z pustą treścią —
     bez tego sprawdzenia biuro zobaczyłoby pusty szkic i nie wiedziało czemu. */
  if (root.stop_reason === "refusal") {
    throw new BladAI(
      "Model odmówił odpowiedzi na to pytanie. Odpisz ręcznie albo przeformułuj treść pytania."
    );
  }
  const bloki = Array.isArray(root.content) ? root.content : [];
  const tekst = bloki
    .map((b) => {
      const blok = (b ?? {}) as Record<string, unknown>;
      return blok.type === "text" && typeof blok.text === "string" ? blok.text : "";
    })
    .join("")
    .trim();
  if (!tekst) throw new BladAI("Claude nie zwrócił treści odpowiedzi (pusta odpowiedź API).");
  return tekst;
}

/* ── OpenAI ──────────────────────────────────────────────────────────────── */

async function zapytajOpenAI(zadanie: ZadanieAI): Promise<string> {
  const tresci: unknown[] = [];
  if (zadanie.obraz) {
    tresci.push({
      type: "image_url",
      image_url: { url: `data:${zadanie.obraz.mime};base64,${zadanie.obraz.base64}` },
    });
  }
  tresci.push({ type: "text", text: zbudujTrescUzytkownika(zadanie.tekst, zadanie.kontekst) });

  const odp = await wyslij(
    "https://api.openai.com/v1/chat/completions",
    { authorization: `Bearer ${config.ai.openaiKey}` },
    {
      model: modelAI("openai"),
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: zadanie.system },
        { role: "user", content: tresci },
      ],
    },
    "OpenAI"
  );

  const root = (odp ?? {}) as Record<string, unknown>;
  const wybory = Array.isArray(root.choices) ? root.choices : [];
  const pierwszy = (wybory[0] ?? {}) as Record<string, unknown>;
  const wiadomosc = (pierwszy.message ?? {}) as Record<string, unknown>;
  const tekst = typeof wiadomosc.content === "string" ? wiadomosc.content.trim() : "";
  if (!tekst) throw new BladAI("OpenAI nie zwróciło treści odpowiedzi (pusta odpowiedź API).");
  return tekst;
}

/* ── Wspólny klient HTTP ─────────────────────────────────────────────────── */

/**
 * Jedno żądanie do dostawcy. Komunikaty błędów mówią, CO NAPRAWIĆ — „fetch
 * failed" albo gołe 401 na ekranie biura nie prowadzi donikąd (ta sama
 * zasada co w `allegro.http.ts`).
 */
async function wyslij(
  url: string,
  naglowki: Record<string, string>,
  body: unknown,
  dostawca: string
): Promise<unknown> {
  let odp: Response;
  try {
    odp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...naglowki },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (e) {
    throw new BladAI(
      `Brak połączenia z ${dostawca} (${new URL(url).host}) — sprawdź internet na serwerze ` +
        `i czy zapora przepuszcza ten adres. (${e instanceof Error ? e.message : e})`
    );
  }

  if (odp.status === 401 || odp.status === 403) {
    throw new BladAI(
      `${dostawca} odrzucił klucz (${odp.status}) — sprawdź ` +
        `${dostawca === "Claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} w wertis.env.`
    );
  }
  if (odp.status === 429) {
    throw new BladAI(`${dostawca} przyjął za dużo zapytań naraz (429) — spróbuj za chwilę.`);
  }
  if (!odp.ok) {
    const tresc = await odp.text().catch(() => "");
    throw new BladAI(`${dostawca} odpowiedział ${odp.status}: ${tresc.slice(0, 300)}`);
  }
  return odp.json();
}

/* ── DEV ─────────────────────────────────────────────────────────────────── */

/** Słowa kluczowe → kategoria. Prymitywne i takie ma być: to atrapa. */
const SLOWA_KATEGORII: Array<[RegExp, string]> = [
  [/wysyłk|wysylk|przesyłk|paczk|kurier|chorwac|zagranic/i, "dostawa-wysylka"],
  [/zamówieni|zamowieni|kiedy wyśl|kiedy wysl|status/i, "stan-zamowienia"],
  [/reklamac|uszkodz|zepsu|wadliw/i, "reklamacja"],
  [/pasuj|dobór|dobor|model|symbol|części|czesci|końcówk|koncowk/i, "dobor-czesci"],
];

/**
 * Doradca DEV — deterministyczny, bez sieci.
 *
 * Nie udaje mądrości: skleja odpowiedź z pierwszego symbolu i pierwszego
 * linku, które `services/pytania.ts` włożył do kontekstu. To wystarcza, żeby
 * cały przepływ (szkic → edycja → wysyłka → statystyki) dało się przejść
 * w demo i w testach bez ani jednego klucza API.
 */
function doradcaDev(zadanie: ZadanieAI): OdpowiedzAI {
  const pytanie = zadanie.tekst ?? "";
  const kategoria =
    SLOWA_KATEGORII.find(([wzorzec]) => wzorzec.test(pytanie))?.[1] ?? "inne";

  const symbol = /SYMBOL: ([^\s|]+)/.exec(zadanie.kontekst)?.[1] ?? null;
  const link = /https:\/\/allegro\.pl\/oferta\/\S+/.exec(zadanie.kontekst)?.[0] ?? null;
  const urzadzenie = /\b([A-Z]{1,4}[-\s]?\d{2,4}[A-Z]?)\b/.exec(pytanie)?.[1] ?? null;

  const zdania = ["Dzień dobry,"];
  if (kategoria === "dobor-czesci" && symbol) {
    zdania.push(`do tego urządzenia pasuje część o symbolu ${symbol}.`);
    if (link) zdania.push(`Oferta: ${link}`);
  } else if (kategoria === "dobor-czesci") {
    zdania.push(
      "nie mamy pewności co do dopasowania — prosimy o model urządzenia " +
        "albo numer katalogowy ze starej części."
    );
  } else {
    zdania.push("dziękujemy za wiadomość — sprawdzamy i odpiszemy.");
  }
  zdania.push("Pozdrawiamy, WERTIS");

  return {
    odpowiedz: zdania.join(" "),
    kategoria,
    produkty: symbol ? [{ symbol }] : [],
    urzadzenie,
    wOfercie: kategoria === "dobor-czesci" ? symbol !== null : null,
    pytanieKlienta: zadanie.obraz ? "(transkrypcja dev — obraz ze schowka)" : null,
  };
}
