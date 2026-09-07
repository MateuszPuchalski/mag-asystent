import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { config } from "../config.js";
import { logEvent } from "../services/events.js";
import { pobierzZalacznik } from "../adapters/allegro.http.js";
import { rozpoznajMime } from "../adapters/zdjecia.sgt.js";
import { typPodgladu } from "../services/skrzynka.js";
import {
  adresZalacznika, BladReklamacji, licznikiKubelkow, listaReklamacji,
  ReklamacjaConflict, stempelProwadzi, szczegolReklamacji, zapiszNotatke,
} from "../services/reklamacje.js";
import { stanReklamacjiHealth } from "../services/allegro-reklamacje-sync-state.js";
import { synchronizujAllegroReklamacje } from "../services/allegro-reklamacje-sync.js";

/* ── Trasy reklamacji klienckich (0.222.0) ───────────────────────────────────
   PRZYROST PIERWSZY: odczyt, kolejka z zegarem, czat do czytania. Do Allegro
   NIE WYCHODZI STĄD ŻADEN ZAPIS — odpowiedź w czacie i formalny werdykt to
   dwa następne przyrosty, a każdy z nich jest nieodwracalny wobec kupującego
   i dostanie własne wydanie.

   DWA ZAPISY, oba wyłącznie u nas i oba dotyczące pracy biura: znacznik „kto
   prowadzi" i notatka z ustaleń. Otwarcie ekranu nie zapisuje nic (blizna
   0.18.0), a synchronizacja jest osobnym, jawnym kliknięciem.

   Bramka roli stoi na KAŻDEJ trasie, także na odczycie — tak samo jak przy
   skrzynce i przy zwrotach. Reklamacja niesie login kupującego, treść jego
   zgłoszenia i numer zamówienia; to są dane biura, nie hali.               */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Reklamacje prowadzi biuro" });
  }
  return null;
}

/** `BladReklamacji` niesie kod HTTP; konflikt wersji ma własny ładunek. */
function blad(reply: FastifyReply, e: unknown) {
  if (e instanceof ReklamacjaConflict) {
    return reply.code(409).send({ error: e.message, ...e.szczegoly });
  }
  if (e instanceof BladReklamacji) return reply.code(e.kod).send({ error: e.message });
  return reply.code(400).send({ error: (e as Error).message });
}

const autor = () => sesjaZadania()?.user.name ?? "?";

export async function reklamacjeRoutes(app: FastifyInstance) {
  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — ten sam wybór
     co przy zwrotach i z tego samego powodu. */
  app.get("/api/obsluga/reklamacje", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const reklamacje = listaReklamacji(db());
    return {
      reklamacje,
      liczniki: licznikiKubelkow(reklamacje),
      stan: stanReklamacjiHealth(db()),
    };
  });

  /* Ręczne dociągnięcie (wzorzec „synchronizuj teraz" ze skrzynki). Nie omija
     limitu Allegro: pobiera tyle samo co ticker i tak samo przerywa na 429. */
  app.post("/api/obsluga/reklamacje/synchronizuj", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    logEvent("reklamacje_synchronizacja_reczna", autor());
    try {
      return await synchronizujAllegroReklamacje();
    } catch (e) {
      /* Zdanie z adaptera mówi, co naprawić — token, uprawnienie, limit —
         więc jedzie na ekran w całości. Sam kod HTTP nie mówi nic. */
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/reklamacje/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return szczegolReklamacji(db(), Number(req.params.id));
    } catch (e) { return blad(reply, e); }
  });

  /**
   * Pobranie załącznika PRZEZ NAS.
   *
   * Adres bierze się z bazy po identyfikatorze, nie z żądania — inaczej ten
   * serwer stałby się bramką pod dowolny adres w internecie. Bearer firmy nie
   * wychodzi do przeglądarki, a pobranie zostawia ślad w audycie.
   *
   * DWA ADRESY, DWIE ODPOWIEDZI (0.223.0). Ta trasa oddaje PLIK: zawsze
   * `application/octet-stream` i `content-disposition: attachment`, bo cudzy
   * plik nie ma się otwierać w naszym origin, gdy agent wejdzie tu paskiem
   * przeglądarki. Podgląd na osi ma własną trasę niżej, węższą bramkę i inne
   * nagłówki. Rozstrzyganie obu przypadków jednym nagłówkiem znaczyłoby, że
   * jeden z nich jest ustawiony źle — ta sama decyzja co przy skrzynce.
   *
   * Tu ZOSTAJE ślad w dzienniku, bo to jest czynność agenta: ktoś wziął plik
   * na dysk. Podgląd rysuje się sam i śladu nie zostawia.
   */
  app.get<{ Params: { id: string; zid: string } }>(
    "/api/obsluga/reklamacje/:id/zalaczniki/:zid", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        const z = adresZalacznika(db(), Number(req.params.id), Number(req.params.zid));
        const odp = await pobierzZalacznik(z.url);
        logEvent("reklamacja_zalacznik_pobrany", autor(), null,
          { id: Number(req.params.id), nazwa: z.nazwa });
        return reply
          .header("content-type", "application/octet-stream")
          /* Cudzysłowy i znaki końca wiersza znikają z nazwy — rozbiłyby
             nagłówek. Ta sama ostrożność co przy załączniku rozmowy. */
          .header("content-disposition",
            `attachment; filename="${z.nazwa.replace(/["\r\n]/g, "")}"`)
          .send(Buffer.from(odp));
      } catch (e) { return blad(reply, e); }
    });

  /**
   * Podgląd załącznika WPROST na osi (0.223.0).
   *
   * ── DLACZEGO TERAZ, SKORO 0.222.0 MÓWIŁO „NIE DA SIĘ" ─────────────────────
   * Tamto zdanie było prawdziwe co do POWODU i fałszywe co do wniosku.
   * `PostPurchaseIssueAttachment` faktycznie nie ma ani `mimeType`, ani
   * `status`, więc bramki ze skrzynki (0.218.0) nie da się tu POWTÓRZYĆ.
   * Ale bramka pilnowała jednej rzeczy: żeby na osi rysowały się wyłącznie
   * cztery typy rastrowe i nic innego. Tego można dopilnować bez pola —
   * po BAJTACH, które i tak mamy w ręku, bo plik przechodzi przez nasz serwer.
   *
   * Nie zgadujemy więc kształtu i nie wymyślamy pola, którego nie ma:
   * `rozpoznajMime` czyta sygnaturę pliku (ta sama funkcja, co przy zdjęciach
   * z Subiekta), a `typPodgladu` przecina wynik z listą ze skrzynki. Przejdą
   * trzy typy — JPEG, PNG i GIF — bo tyle jest we WSPÓLNEJ części tego, co
   * Allegro przy tym zasobie przyjmuje (`png`, `gif`, `bmp`, `tiff`, `jpeg`,
   * `pdf`) i co przeglądarka rysuje. BMP, TIFF i PDF zostają przy pobieraniu.
   *
   * NAZWA PLIKU NICZEGO NIE ROZSTRZYGA. Decyduje o UKŁADZIE po stronie panelu
   * (`podglad` przy załączniku), a tutaj rozstrzygają bajty: plik nazwany
   * `usterka.jpg`, który nie zaczyna się sygnaturą obrazu, dostaje 415.
   *
   * W sklepie z częściami zdjęcie pękniętego elementu bywa CAŁYM zgłoszeniem,
   * a sonda widziała załączniki przy 57 sprawach na 100. Kazanie agentowi
   * zapisywać każdy z nich na dysk to ta sama usterka, którą skrzynka
   * naprawiła w 0.218.0.
   *
   * ETAG PRZED POBRANIEM OD ALLEGRO. Treść załącznika jest niezmienna (nowy
   * plik to nowy wiersz), więc identyfikator wystarcza za odcisk — bez tego
   * oś ciągnęłaby te same megabajty przy każdym przerysowaniu.
   */
  app.get<{ Params: { id: string; zid: string } }>(
    "/api/obsluga/reklamacje/:id/zalaczniki/:zid/podglad", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;

      const etag = `"rekl-zal-${Number(req.params.zid)}"`;
      if (req.headers["if-none-match"] === etag) {
        return reply.code(304).header("etag", etag).send();
      }
      try {
        const z = adresZalacznika(db(), Number(req.params.id), Number(req.params.zid));
        const odp = await pobierzZalacznik(z.url);
        const bajty = Buffer.from(odp);
        const typ = typPodgladu(rozpoznajMime(bajty));
        if (typ === null) {
          /* 415, nie 404: plik JEST, tylko nie jest obrazem, który narysujemy.
             Panel spada wtedy na przycisk pobrania — to odpowiedź, nie awaria. */
          return reply.code(415).send({
            error: `Załącznik „${z.nazwa}" nie jest obrazem do pokazania na osi.`,
          });
        }
        /* BEZ `logEvent`. Podgląd rysuje się sam przy otwarciu sprawy, więc wpis
           w dzienniku nie znaczyłby „ktoś wziął plik", tylko „ktoś spojrzał na
           ekran". Pobranie na dysk, czyli czynność agenta, ślad zostawia. */
        return reply
          .header("content-type", typ)
          .header("x-content-type-options", "nosniff")
          .header("content-disposition", "inline")
          .header("etag", etag)
          .header("cache-control", "private, max-age=86400")
          .send(bajty);
      } catch (e) { return blad(reply, e); }
    });

  /* Znacznik „prowadzę", nie zamek: ponowne kliknięcie go zdejmuje. Bez
     `autoryzuj()` — to zwykła praca biura, a nie operacja uprzywilejowana. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/reklamacje/:id/prowadze", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return { reklamacja: stempelProwadzi(db(), Number(req.params.id), autor(), req.body?.wersja) };
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { notatka?: string | null; wersja?: number } }>(
    "/api/obsluga/reklamacje/:id/notatka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const n = req.body?.notatka;
      if (n !== null && n !== undefined && typeof n !== "string") {
        return reply.code(400).send({ error: "Pole `notatka` musi być tekstem albo `null`" });
      }
      try {
        return {
          reklamacja: zapiszNotatke(db(), Number(req.params.id), n ?? null, autor(), req.body?.wersja),
        };
      } catch (e) { return blad(reply, e); }
    });
}
