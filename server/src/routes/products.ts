import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { autorOperacji, subiekt, userOf } from "../context.js";
import { sciezkaZdjecia, zapewnijZdjecie } from "../services/zdjecia.js";
import { config } from "../config.js";
import { buildProductCard } from "../services/stock.js";
import { enqueueSetEan, enqueueSetLocation } from "../services/queue.js";
import { aliasKodu, bladKodu, ktoMaTenKod, zapiszAlias, zdejmijAlias } from "../services/ean-alias.js";
import { recordEanConflict } from "../services/ean.js";
import { logEvent, productHistory } from "../services/events.js";
import {
  validateLocationCode,
  listLocations,
  getProductsByLocation,
} from "../services/locations.js";
import { classifyScan, normalizeLoc } from "../scan.js";
import { parseLocs } from "../locs.js";

type LocAction = "replace" | "add" | "remove" | "replace_one" | "promote";

interface LocBody {
  action: LocAction;
  value?: string;
  replaced?: string;
  /** Kod WPISANY z ręki, nie zeskanowany — zasila raport etykiet do przedruku. */
  recznie?: boolean;
}

const AKCJE: readonly LocAction[] = ["replace", "add", "remove", "replace_one", "promote"];

/**
 * `null` dla nieznanej albo brakującej akcji.
 *
 * TypeScript uznawał ten `switch` za wyczerpujący, bo typ `LocBody.action` to
 * unia czterech wartości — ale to jest deklaracja o ciele żądania, nie o tym,
 * co przyjdzie po sieci. Żądanie bez pola `action` przechodziło przez wszystkie
 * `case`, funkcja zwracała `undefined`, a wywołujący robił na tym `.join()`
 * i kończyło się to **500 zamiast 400**. Typ opisywał kontrakt, walidacji nie
 * było wcale.
 */
function computeNewLocs(current: string[], body: LocBody): string[] | null {
  const v = (body.value ?? "").trim().toUpperCase();
  switch (body.action) {
    case "replace":
      return [v];
    case "add":
      return current.includes(v) ? current : [...current, v];
    case "remove":
      return current.filter((l) => l !== v);
    case "replace_one":
      return current.map((l) => (l === body.replaced ? v : l));
    /* PODNIESIENIE na pierwsze miejsce (0.38.0). Pickingową jest PIERWSZA
       lokalizacja z pola (`locs.ts`), więc „uczyń podstawową" to przestawienie
       kolejności, a nie dopisanie ani skasowanie czegokolwiek — reszta adresów
       zostaje nietknięta i w swojej kolejności.

       Kod spoza listy odrzucamy zamiast dopisywać: prośba „podnieś adres,
       którego tu nie ma" znaczy, że wołający patrzy na inny stan niż baza,
       a ciche dopisanie zamieniłoby ten rozjazd w zapis do kartoteki. */
    case "promote":
      return current.includes(v) ? [v, ...current.filter((l) => l !== v)] : null;
    default:
      return null;
  }
}

export async function productRoutes(app: FastifyInstance) {
  /**
   * Rozpoznanie skanu → karta / zawartość regału / wyniki (spec §4, plan §4).
   *
   * Klasyfikacja idzie PRZED wyszukiwaniem, bo bez niej skan etykiety regału
   * trafiał do wyszukiwarki towarów (`subiekt.search` nie zna lokalizacji),
   * zwracał zero wyników i magazynier oglądał pustą listę z kodem półki
   * w polu — zamiast jej zawartości.
   *
   * Po klasyfikacji obowiązuje JEDNO wyszukanie w JEDNEJ dziedzinie, bez
   * fallbacku na drugą. Fallback jest zależny od kolejności, a zależność od
   * kolejności to sposób, w jaki mis-skan cicho robi coś innego, niż wygląda.
   */
  app.get<{ Params: { code: string }; Querystring: { manual?: string; screen?: string } }>(
    "/api/products/scan/:code",
    async (req) => {
    const raw = decodeURIComponent(req.params.code).trim();
    const scan = classifyScan(raw);
    // Wejście RĘCZNE liczone osobno od skanu — udział wpisów per lokalizacja to
    // darmowy raport jakości etykiet („który regał wymaga przedruku"), a per
    // towar mówi, która kartoteka nie ma czytelnego kodu. Wrzucone do jednego
    // worka z `scan` nie mierzy niczego.
    const reczne = req.query.manual === "1";
    logEvent(reczne ? "manual_entry" : "scan", userOf(req), null, {
      code: raw,
      kind: scan.kind,
      ...(reczne && req.query.screen ? { screen: req.query.screen } : {}),
    });

    if (scan.kind === "LOC") {
      const code = normalizeLoc(scan.code);
      // Pusty regał to POPRAWNA odpowiedź, nie błąd — magazynier skanuje półkę
      // między innymi po to, żeby sprawdzić, czy jest wolna. `known` mówi tylko,
      // czy ten adres występuje dziś w kartotece.
      return {
        type: "location",
        code,
        known: listLocations().includes(code),
        products: getProductsByLocation(code),
      };
    }
    if (scan.kind === "EAN") {
      const p = subiekt.getProductByEan(scan.code);
      if (p) return { type: "product", card: buildProductCard(subiekt, p.tw_id) };
      /* FURTKA, NIE PIERWSZEŃSTWO. Kod nadany u nas sprawdzamy dopiero, gdy
         kartoteka nie zna go wcale (0.37.0). Odwrotna kolejność znaczyłaby, że
         kod nadany przy półce przykrywa kod z Subiekta — czyli że magazynier
         cicho nadpisuje dane, których nie widzi. */
      const alias = aliasKodu(scan.code);
      if (alias) {
        const card = buildProductCard(subiekt, alias.twId);
        if (card) return { type: "product", card };
      }
      return { type: "notfound", code: scan.code };
    }
    const bySym = subiekt.getProductBySymbol(scan.code);
    if (bySym) return { type: "product", card: buildProductCard(subiekt, bySym.tw_id) };
    /* FURTKA NA LITERÓWKI JEST TU WYŁĄCZONA — świadomie i to jest ważniejsze
       niż wygoda. Ta ścieżka SAMA otwiera kartę, gdy wynik jest dokładnie
       jeden, więc dopasowanie przybliżone prowadziłoby wprost do CUDZEJ
       kartoteki: zdarta etykieta, kod wpisany z błędem, jedno trafienie po
       literówce i magazynier zapisuje adres półki nie na tym towarze.
       Zapis lokalizacji jest bezwarunkowy i nie ma po nim cofnięcia.

       W wyszukiwarce na ekranie głównym furtka działa — tam wynik trafia na
       listę, którą człowiek potwierdza wzrokiem. */
    const results = subiekt.search(scan.code, 20, { literowki: false });
    if (results.length === 1) {
      return { type: "product", card: buildProductCard(subiekt, results[0].id) };
    }
      return { type: "search", results };
    }
  );

  // wyszukiwarka (spec §5.1)
  app.get<{ Querystring: { q?: string } }>("/api/products/search", async (req) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return { results: [] };
    logEvent("search", userOf(req), null, { q });
    const { wyniki, przyblizone } = subiekt.szukajZFurtka(q, 20);
    /* Pole addytywne — kolektor ma `ignoreUnknownKeys` (Dtos.kt), więc stare
       APK je zignoruje. Mówi „nie znalazłem dosłownie, to są podobne" i czeka
       na ekran, który to pokaże. */
    return { results: wyniki, przyblizone };
  });

  // karta towaru
  app.get<{ Params: { twId: string } }>("/api/products/:twId", async (req, reply) => {
    const card = buildProductCard(subiekt, Number(req.params.twId));
    if (!card) return reply.code(404).send({ error: "Nie znaleziono towaru" });
    return card;
  });

  // historia ruchów lokalizacji/MM towaru (analiza — „kto/kiedy")
  app.get<{ Params: { twId: string } }>("/api/products/:twId/history", async (req) => {
    return { entries: productHistory(Number(req.params.twId)) };
  });

  // zmiana lokalizacji → zadanie set_location (spec §5.2)
  app.post<{ Params: { twId: string }; Body: LocBody }>(
    "/api/products/:twId/location",
    async (req, reply) => {
      const twId = Number(req.params.twId);
      const p = subiekt.getProductById(twId);
      if (!p) return reply.code(404).send({ error: "Nie znaleziono towaru" });

      const body = req.body ?? ({} as LocBody);
      // Akcja PRZED walidacją kodu: bez niej nie wiadomo nawet, czy kod jest
      // w tym żądaniu potrzebny (`remove` go nie waliduje).
      if (!AKCJE.includes(body.action)) {
        return reply
          .code(400)
          .send({ error: `Nieznana akcja „${body.action ?? ""}". Dozwolone: ${AKCJE.join(", ")}` });
      }
      if (body.action !== "remove") {
        const err = validateLocationCode(body.value ?? "");
        if (err) return reply.code(400).send({ error: err });
      }
      const current = parseLocs(p.lokalizacja);
      const next = computeNewLocs(current, body);
      if (!next) {
        /* Jedyna akcja, która dochodzi tu z POPRAWNĄ nazwą, to `promote` na
           adres spoza listy — komunikat musi to powiedzieć, bo „nieznana
           akcja" wysłałoby diagnozę w złą stronę. */
        return reply.code(400).send({
          error: body.action === "promote"
            ? `Towar nie ma lokalizacji ${(body.value ?? "").toUpperCase()} — odśwież kartę`
            : "Nieznana akcja",
        });
      }
      const joined = next.join(" ");
      if (joined.length > config.locFieldLimit) {
        // twardy błąd, NIE ciche ucięcie (spec §5.2, §12)
        return reply.code(400).send({
          error: `Przekroczono limit pola tw_Lokalizacja (${config.locFieldLimit} znaków)`,
        });
      }

      // Autor Z CHWILI WYKONANIA, nie z chwili wysyłki — operacja z bufora
      // offline może dojechać po zmianie zmiany (patrz `autorOperacji`).
      const autor = autorOperacji(req);
      const user = autor.nazwa;
      const desc = describeLoc(body, current);
      /* Zdarzenie audytowe emituje `enqueueSetLocation`, nie ta trasa — patrz
         `AudytLokalizacji`. Wpis TUTAJ byłby drugim wpisem o tej samej zmianie.

         `p.lokalizacja` jest przekazywane SUROWE, nie jako `current.join(" ")`:
         wycofanie polega na wpisaniu z powrotem dokładnie tego, co w polu
         stało, a wartość po `parseLocs` jest już rekonstrukcją. */
      const queueId = enqueueSetLocation(
        twId,
        joined,
        {
          createdBy: user,
          createdByRef: autor.ref,
          twId,
          label: "Lokalizacja · " + p.symbol,
          detail: desc,
        },
        {
          locsPrzed: p.lokalizacja ?? "",
          zrodlo: "karta",
          akcja: body.action,
          wartosc: body.value,
          wyslanePrzez: autor.wyslanePrzez,
        }
      );
      /* Kod wpisany z ręki zamiast zeskanowany = sygnał zniszczonej etykiety.
         Ten sam kształt zdarzenia co przy ręcznym „skanie" (`manual_entry`
         wyżej), więc raport etykiet do przedruku widzi obie drogi bez zmian. */
      if (body.recznie && body.action !== "remove" && body.value) {
        logEvent("manual_entry", user, twId, {
          code: body.value.trim().toUpperCase(),
          kind: "LOC",
          zrodlo: "karta",
        });
      }
      return { queueId };
    }
  );

  /**
   * Nadanie kodu kreskowego kartotece (0.37.0) → zadanie `set_ean`.
   *
   * POWSTAŁO Z SYTUACJI PRZY REGALE: karton ma kod, kartoteka go nie ma, a
   * jedyną drogą było „zapamiętaj i powiedz biuru" — czyli nazajutrz ten sam
   * karton zatrzymywał pracę drugi raz.
   *
   * Dwa tryby i to jest decyzja, nie wygoda:
   *   UZUPEŁNIENIE (pole puste) przechodzi od razu — nic nie ginie;
   *   PODMIANA wymaga `potwierdzone: true`, bo nadpisuje dane, których
   *   magazynier nie widzi w całości, a stary kod zostaje na kartonach w hali.
   * Odpowiedź 409 niesie stary kod, żeby kolektor mógł pokazać STARY → NOWY
   * i dopiero wtedy poprosić o potwierdzenie.
   *
   * Kod zajęty przez INNĄ kartotekę jest odmawiany bezwarunkowo (409): nadanie
   * go wyprodukowałoby własnoręcznie kolizję (§4.5), którą ten system mierzy
   * i raportuje jako defekt danych.
   */
  app.post<{ Params: { twId: string }; Body: { ean?: string; potwierdzone?: boolean } }>(
    "/api/products/:twId/ean",
    async (req, reply) => {
      const twId = Number(req.params.twId);
      const p = subiekt.getProductById(twId);
      if (!p) return reply.code(404).send({ error: "Nie znaleziono towaru" });

      const kod = (req.body?.ean ?? "").trim();
      const bladWalidacji = bladKodu(kod);
      if (bladWalidacji) return reply.code(400).send({ error: bladWalidacji });

      const zajety = ktoMaTenKod(kod);
      if (zajety && zajety.twId !== twId) {
        /* Kolizja ZAPISUJE SIĘ do rejestru, nie tylko odmawia. Próba nadania
           zajętego kodu jest tym samym defektem danych, który mierzymy przy
           skanowaniu — a tu widać go, ZANIM zatrzyma pracę w alejce. */
        recordEanConflict(kod, [zajety.twId, twId], false);
        const inny = subiekt.getProductById(zajety.twId);
        return reply.code(409).send({
          error: `Kod ${kod} należy już do ${inny?.symbol ?? zajety.twId}` +
            (inny?.nazwa ? ` (${inny.nazwa})` : ""),
          powod: "zajety",
          twIdKolidujacy: zajety.twId,
          symKolidujacy: inny?.symbol ?? "",
        });
      }
      if (zajety && zajety.twId === twId) {
        // ten sam kod na tej samej kartotece — nie ma czego zapisywać
        return { queueId: null, bezZmian: true };
      }

      const eanPrzed = (p.ean ?? "").trim();
      if (eanPrzed && !req.body?.potwierdzone) {
        return reply.code(409).send({
          error: `Kartoteka ma już kod ${eanPrzed}. Podmiana wymaga potwierdzenia.`,
          powod: "podmiana",
          eanPrzed,
        });
      }

      const autor = autorOperacji(req);
      const queueId = enqueueSetEan(
        twId,
        kod,
        {
          createdBy: autor.nazwa,
          createdByRef: autor.ref,
          twId,
          label: "Kod kreskowy · " + p.symbol,
          detail: eanPrzed ? `${eanPrzed} → ${kod}` : kod,
        },
        { eanPrzed, zrodlo: "karta", wyslanePrzez: autor.wyslanePrzez }
      );

      /* Alias zapisujemy PO zakolejkowaniu, żeby nieść `queueId`: gdy Subiekt
         odmówi zapisu, pytanie brzmi „które zadanie stoi w błędzie". */
      if (eanPrzed) zdejmijAlias(eanPrzed);
      zapiszAlias(kod, twId, eanPrzed || null, queueId, autor.nazwa);
      return { queueId };
    }
  );

  /**
   * Zdjęcie kartoteki (0.30.0).
   *
   * OSOBNA TRASA, nigdy pole karty — karta jest odpytywana co 2 s
   * (ProductScreen.kt), a 150 KB w base64 w tym cyklu to ponad 4 MB na minutę
   * z JEDNEGO kolektora. Osobny adres pozwala też na 304, czyli na to, że
   * zdjęcie jedzie przez Wi-Fi raz na towar, a nie raz na spojrzenie.
   *
   * Zostaje za sesją (nie ma jej w `BEZ_SESJI`), tak samo jak zdjęcia dowodowe.
   */
  app.get<{ Params: { twId: string } }>("/api/products/:twId/zdjecie", async (req, reply) => {
    const wpis = await zapewnijZdjecie(Number(req.params.twId));
    if (!wpis?.plik || !wpis.etag) return reply.code(404).send({ error: "Brak zdjęcia" });

    const etag = `"${wpis.etag}"`;
    /* 304 PRZED otwarciem pliku. Kolektor pyta przy każdym wejściu na kartę,
       a odpowiedź „to samo, co masz" ma kosztować nagłówek — nie transfer. */
    if (req.headers["if-none-match"] === etag) {
      return reply.code(304).header("etag", etag).send();
    }

    const plik = sciezkaZdjecia(wpis.plik);
    if (!plik) return reply.code(404).send({ error: "Brak pliku" });
    /* Długość ze `stat`, nie z bazy: między odczytem wpisu a wysyłką plik mógł
       wypaść z cache'u, a skłamany content-length urywa obrazek w połowie
       BEZ żadnego błędu — po stronie kolektora wygląda to jak zepsute zdjęcie. */
    return reply
      .type(wpis.mime ?? "image/jpeg")
      .header("etag", etag)
      .header("cache-control", "private, max-age=86400")
      .header("content-length", String(fs.statSync(plik).size))
      .send(fs.createReadStream(plik));
  });
}

function describeLoc(body: LocBody, current: string[]): string {
  const v = (body.value ?? "").toUpperCase();
  switch (body.action) {
    case "replace":
      return `${v} (zastąpiono ${current[0] ?? "brak"})`;
    case "add":
      return `${v} (dodano)`;
    case "remove":
      return `(usunięto ${body.value})`;
    case "replace_one":
      return `${v} (zamiast ${body.replaced})`;
    case "promote":
      return `${v} (ustawiono jako podstawową)`;
  }
}
