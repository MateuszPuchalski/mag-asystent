import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania, subiekt } from "../context.js";
import { logEvent } from "../services/events.js";
import { listaRozmow, osRozmowy, stanSkrzynki, typPodgladu, zlecPomiar } from "../services/skrzynka.js";
import { ConversationConflict, dodajKomentarz, przejmijRozmowe, przekazRozmowe, STATUSY_RECZNE, ustawPriorytet, ustawStatus, wskazKartoteke, wskazOferte, zapiszSzkic, type StatusRozmowy } from "../services/conversations.js";
import {
  onConversationEvent, przyRozmowie, setTyping, trzymajacy, wejdzDoRozmowy, wyjdzZRozmowy,
} from "../services/conversation-realtime.js";
import { autoryzuj } from "../services/auth.js";
import { config } from "../config.js";
import { db } from "../db/db.js";
import { stanSynchronizacji } from "../services/allegro-inbox-sync-state.js";
import { synchronizujAllegroInbox } from "../services/allegro-inbox-sync.js";
import { wyslijOdpowiedz } from "../services/wysylka.js";
import {
  dodajZalacznik, usunZalacznik, zalacznikiRozmowy,
} from "../services/zalaczniki-wysylki.js";
import { pobierzZalacznik } from "../adapters/allegro.http.js";
import { sciezkaZdjeciaOferty, zapewnijZdjecieOferty } from "../services/zdjecia-ofert.js";
import { kontoKanalu } from "../services/kanal-konto.js";
import { liczbaNowychWzmianek, odhaczWzmianke, wzmiankiDlaMnie } from "../services/wzmianki.js";
import { dolaczRozmowe, listaSpraw, odlaczRozmowe, utworzSprawe } from "../services/sprawy.js";
import { pomiarDoWiedzy, ustawStatusDoboru, wiedzaDoboru, wybierzKandydata, zapiszDane, type DaneDoboru } from "../services/dobor.js";
import { kandydaciDoboru } from "../services/kandydaci.js";
import { historiaKlienta } from "../services/klient-historia.js";

const BIURO = ["biuro", "admin"];
const blad = (reply: FastifyReply, e: unknown) =>
  reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

/* Skrzynka jest ekranem biura, więc bramka roli stoi na każdej trasie — także
   na odczycie. Rozmowy z klientami nie są danymi, które ma widzieć hala. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Skrzynkę obsługuje biuro" });
  }
  return null;
}

export async function skrzynkaRoutes(app: FastifyInstance) {
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof ConversationConflict
    ? reply.code(409).send({ error: e.message, ...e.details }) : blad(reply, e);
  app.get("/api/obsluga/rozmowy", async (_req, reply) =>
    odmowa(reply) ?? { rozmowy: listaRozmow(), stan: stanSkrzynki() });

  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try { return osRozmowy(Number(req.params.id)); } catch (e) { return blad(reply, e); }
  });

  /* ── Pobranie załącznika (0.155.0) ────────────────────────────────────────
     ADRES ALLEGRO NIE IDZIE DO PRZEGLĄDARKI, i to jest cała treść tej trasy.

     `attachments[].url` wskazuje `upload.allegro.pl`. Czy ten adres otwiera
     się bez tokena — NIE WIEM i nie zgaduję; zgadywanie kształtu Allegro
     kosztowało ten projekt trzy wydania. Pobranie przez nas działa niezależnie
     od odpowiedzi na tamto pytanie, a przy okazji nie wypuszcza Bearera do
     przeglądarki i zostawia ślad w audycie.

     Tylko `SAFE`. `UNSAFE` znaczy, że Allegro uznało plik za niebezpieczny —
     nie mamy powodu wiedzieć lepiej, a plik szedłby na maszynę biura. */
  app.get<{ Params: { id: string } }>("/api/obsluga/zalaczniki/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const z = db().prepare(`SELECT a.file_name, a.mime_type, a.url, a.status, m.conversation_id
      FROM message_attachment a JOIN message m ON m.id=a.message_id WHERE a.id=?`)
      .get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!z) return reply.code(404).send({ error: "Nie znaleziono załącznika" });
    if (String(z.status) !== "SAFE" || z.url == null) {
      return reply.code(409).send({
        error: `Załącznik „${String(z.file_name)}" nie jest do pobrania (stan ${String(z.status)}).`,
      });
    }
    try {
      const odp = await pobierzZalacznik(String(z.url));
      logEvent("obsluga.zalacznik.pobrany", sesjaZadania()?.user.name ?? "?", null,
        { rozmowaId: Number(z.conversation_id), nazwa: String(z.file_name) });
      return reply
        .header("content-type", String(z.mime_type ?? "application/octet-stream"))
        /* `attachment` z nazwą: przeglądarka nie ma renderować cudzego pliku
           w naszym origin. Cudzysłowy w nazwie znikają, bo rozbiłyby nagłówek. */
        .header("content-disposition",
          `attachment; filename="${String(z.file_name).replace(/["\r\n]/g, "")}"`)
        .send(Buffer.from(odp));
    } catch (e) { return blad(reply, e); }
  });

  /**
   * Podgląd załącznika WPROST na osi (0.218.0).
   *
   * ── DLACZEGO OSOBNA TRASA, A NIE PARAMETR PRZY POBRANIU ───────────────────
   * Trasa wyżej odsyła `content-disposition: attachment` i to jest DECYZJA,
   * nie szczegół: cudzy plik nie ma się otwierać w naszym origin, gdy agent
   * wejdzie na ten adres paskiem przeglądarki. Zdjęcie w `<img>` to inna
   * sytuacja — nie nawigacja, tylko podzasób — ale rozstrzyganie tego jednym
   * nagłówkiem dla obu przypadków znaczyłoby, że jeden z nich jest ustawiony
   * źle. Dwa adresy, dwie odpowiedzi, każda mówi prawdę o sobie.
   *
   * WĄSKIE GARDŁO JEST CELOWE. Oddajemy WYŁĄCZNIE cztery typy rastrowe
   * (`TYPY_PODGLADU`) i wyłącznie przy `SAFE`; `content-type` bierzemy z tej
   * listy, nie z bazy, a `nosniff` zabrania przeglądarce zgadywać lepiej.
   * Plik spoza listy dostaje 415 i zostaje przy pobieraniu — to nie awaria,
   * tylko odpowiedź „tego nie pokażę".
   *
   * ETAG PRZED POBRANIEM OD ALLEGRO, jak przy zdjęciu oferty. Treść załącznika
   * jest niezmienna (nowy plik = nowy wiersz), więc identyfikator wystarcza za
   * odcisk. Bez tego oś rysowana przy każdym zdarzeniu szyny ciągnęłaby te same
   * megabajty od Allegro raz za razem.
   */
  app.get<{ Params: { id: string } }>("/api/obsluga/zalaczniki/:id/podglad", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;

    const etag = `"zal-${Number(req.params.id)}"`;
    if (req.headers["if-none-match"] === etag) {
      return reply.code(304).header("etag", etag).send();
    }

    const z = db().prepare(`SELECT a.file_name, a.mime_type, a.url, a.status
      FROM message_attachment a WHERE a.id=?`)
      .get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!z) return reply.code(404).send({ error: "Nie znaleziono załącznika" });

    const typ = String(z.status) === "SAFE" ? typPodgladu(z.mime_type as string | null) : null;
    if (typ == null || z.url == null) {
      return reply.code(415).send({
        error: `Załącznik „${String(z.file_name)}" nie jest obrazem do pokazania na osi.`,
      });
    }

    try {
      const odp = await pobierzZalacznik(String(z.url));
      /* BEZ `logEvent`. Podgląd rysuje się sam przy otwarciu rozmowy, więc wpis
         w dzienniku nie znaczyłby „ktoś wziął plik", tylko „ktoś spojrzał na
         oś" — a to już mówi audyt otwarcia rozmowy. Pobranie na dysk, czyli
         czynność agenta, dalej zostawia ślad na trasie wyżej. */
      return reply
        .header("content-type", typ)
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", "inline")
        .header("etag", etag)
        .header("cache-control", "private, max-age=86400")
        .send(Buffer.from(odp));
    } catch (e) { return blad(reply, e); }
  });

  /**
   * Zdjęcie listingowe oferty (0.213.0).
   *
   * OSOBNA TRASA, nigdy pole `osRozmowy` — dokładnie z tego powodu, co przy
   * kartotece (`GET /api/products/:twId/zdjecie`). Oś rozmowy odświeża się przy
   * każdym zdarzeniu szyny, a obraz w base64 w tym cyklu to megabajty za nic.
   * Osobny adres daje też 304, czyli „to samo, co masz" za cenę nagłówka.
   *
   * ADRES IDZIE Z NASZEGO SERWERA, nie z `a.allegroimg.com`, i to jest cała
   * treść decyzji z 0.213.0: zakaz z 0.178.0 dotyczył wyjścia PRZEGLĄDARKI
   * biura poza własną sieć, a nie zdjęcia. Wychodzi serwer, który i tak
   * rozmawia z Allegro.
   *
   * 404 znaczy „nie ma czego pokazać" i jest ODPOWIEDZIĄ, nie awarią: oferta
   * bez adresu w snapshocie, snapshot jeszcze niepobrany albo CDN, który nie
   * oddał obrazu. Panel rysuje wtedy kafel zastępczy i nie pyta drugi raz.
   */
  app.get<{ Params: { externalId: string } }>(
    "/api/obsluga/oferta/:externalId/zdjecie", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const konto = kontoKanalu(db(), config.allegro.clientId);
      const w = await zapewnijZdjecieOferty(konto, String(req.params.externalId));
      if (!w?.plik || !w.etag) return reply.code(404).send({ error: "Brak zdjęcia oferty" });

      const etag = `"${w.etag}"`;
      /* 304 PRZED otwarciem pliku — jak przy kartotece. */
      if (req.headers["if-none-match"] === etag) {
        return reply.code(304).header("etag", etag).send();
      }
      const plik = sciezkaZdjeciaOferty(w.plik);
      if (!plik) return reply.code(404).send({ error: "Brak pliku" });
      /* Długość ze `stat`, nie z bazy: między odczytem wpisu a wysyłką plik mógł
         wypaść z cache'u, a skłamany `content-length` urywa obraz w połowie BEZ
         żadnego błędu — na ekranie wygląda to jak zepsute zdjęcie. */
      return reply
        .type(w.mime ?? "image/jpeg")
        .header("etag", etag)
        .header("cache-control", "private, max-age=86400")
        .header("content-length", String(fs.statSync(plik).size))
        .send(fs.createReadStream(plik));
    });

  app.post<{ Body: { rozmowaId?: number; wiadomoscId?: number; instrukcja?: string; twId?: number | null } }>(
    "/api/obsluga/zadania/pomiar", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = sesjaZadania()!;
      try {
        return {
          zadanie: zlecPomiar(
            Number(req.body?.rozmowaId), Number(req.body?.wiadomoscId),
            req.body?.instrukcja ?? "", { id: s.user.userId, name: s.user.name },
            req.body?.twId ?? null,
          ),
        };
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { expectedVersion?: number } }>(
    "/api/conversations/:id/claim", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return przejmijRozmowe(Number(req.params.id), sesjaZadania()!.user.userId,
        Number(req.body?.expectedVersion)); } catch (e) { return konflikt(reply, e); }
    });

  app.put<{ Params: { id: string }; Body: { body?: string; expectedLastMessageId?: number | null; expectedVersion?: number | null } }>(
    "/api/conversations/:id/draft", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return zapiszSzkic(Number(req.params.id), sesjaZadania()!.user.userId,
        req.body?.body ?? "", req.body?.expectedLastMessageId ?? null,
        req.body?.expectedVersion ?? null); } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { body?: string; mentionedUserIds?: number[] } }>(
    "/api/conversations/:id/comments", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return dodajKomentarz(Number(req.params.id), sesjaZadania()!.user.userId,
        req.body?.body ?? "", req.body?.mentionedUserIds ?? []); } catch (e) { return blad(reply, e); }
    });

  /* ── Obecność i uchwyt rozmowy (0.159.0) ──────────────────────────────────
     Ta trasa jest ZAPISEM tylko z nazwy: cały stan żyje w pamięci procesu
     i wygasa sam (§6.3). Do bazy nie idzie nic, więc „zero zapisu przy
     patrzeniu" obowiązuje mimo tego, że wejście na ekran ją woła.

     `obecny: false` to wyjście z rozmowy i puszczenie uchwytu. Panel woła je
     przy zmianie rozmowy i przy zamykaniu karty; gdyby nie doszło, uchwyt
     i tak puści po swoim czasie. */
  app.post<{ Params: { id: string }; Body: { typing?: boolean; obecny?: boolean } }>(
    "/api/conversations/:id/presence", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const user = sesjaZadania()!.user;
      const id = Number(req.params.id);
      if (req.body?.obecny === false) {
        wyjdzZRozmowy(id, user.userId);
      } else if (req.body?.typing === undefined) {
        wejdzDoRozmowy(id, user.userId, user.name);
      } else {
        setTyping(id, user.userId, user.name, Boolean(req.body.typing));
      }
      return { presence: przyRozmowie(id), trzyma: trzymajacy(id) };
    });

  /* Ręczna synchronizacja (§9). NIE omija przerwy: gdy Allegro poprosiło
     o `Retry-After`, przycisk skraca tylko czekanie po jej końcu. Omijanie
     przerwy kosztowałoby konto — a agent klika wtedy, gdy najbardziej mu
     zależy, czyli dokładnie w środku limitu. */
  app.post("/api/obsluga/synchronizuj", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    const stan = stanSynchronizacji(db());
    if (stan.nextAttemptAt && Date.parse(stan.nextAttemptAt) > Date.now()) {
      return reply.code(409).send({
        error: "Allegro prosi o przerwę — synchronizacja czeka",
        nastepnaProba: stan.nextAttemptAt,
      });
    }
    const s = sesjaZadania()!;
    logEvent("skrzynka_synchronizacja_reczna", s.user.name);
    try {
      await synchronizujAllegroInbox();
      return { stan: stanSynchronizacji(db()) };
    } catch (e) { return blad(reply, e); }
  });

  /* SPRAWA (§6.1, 0.161.0). Trzy zapisy: założenie klamry, dołączenie
     kolejnej rozmowy i odklejenie. Czwartego nie ma i to jest cały zamysł —
     poprzednia odpowiedź o tym samym kształcie kosztowała cztery tabele
     nakładki plus ręczne SCAL i ROZKLEJ. */
  app.get("/api/obsluga/sprawy", async (_req, reply) =>
    odmowa(reply) ?? { sprawy: listaSpraw() });

  app.post<{ Body: { tytul?: string; rozmowaId?: number } }>("/api/obsluga/sprawy",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return utworzSprawe(req.body?.tytul ?? "", Number(req.body?.rozmowaId),
          sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { rozmowaId?: number } }>(
    "/api/obsluga/sprawy/:id/rozmowy", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return dolaczRozmowe(Number(req.params.id), Number(req.body?.rozmowaId),
          sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id/odlacz",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        odlaczRozmowe(Number(req.params.id), sesjaZadania()!.user.userId);
        return { sprawa: null };
      } catch (e) { return blad(reply, e); }
    });

  /* DOBÓR CZĘŚCI (§11, etap E1). Sam dobór jedzie w `GET …/rozmowy/:id`;
     kandydaci mają OSOBNĄ trasę, bo to wyszukiwarka i parser opisu, a tamten
     odczyt odświeża się na każde zdarzenie szyny. Odczyt niczego nie zapisuje.
     Bramka to zwykłe `odmowa()`: dobór to codzienna praca biura, a zatwierdza
     go każdy z biura — decyzja właściciela, roli „ekspert" nie ma. */
  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id/dobor/kandydaci",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return kandydaciDoboru(Number(req.params.id), subiekt); }
      catch (e) { return blad(reply, e); }
    });

  app.put<{ Params: { id: string }; Body: { dane?: Partial<DaneDoboru>; expectedVersion?: number } }>(
    "/api/obsluga/rozmowy/:id/dobor/dane", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return zapiszDane(Number(req.params.id), req.body?.dane ?? {},
          Number(req.body?.expectedVersion), sesjaZadania()!.user.userId);
      } catch (e) { return konflikt(reply, e); }
    });

  /* `silnikModelId` jedzie tą samą trasą co status, a nie własną: to jedno
     pole przy JEDNEJ czynności („zatwierdź dobór"), a nowa trasa podniosłaby
     licznik zapisów panelu bez nowej decyzji do podjęcia. */
  app.post<{ Params: { id: string }; Body: { status?: string; brakuje?: string | null; silnikModelId?: number | null } }>(
    "/api/obsluga/rozmowy/:id/dobor/status", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return ustawStatusDoboru(Number(req.params.id), req.body?.status ?? "",
          req.body?.brakuje ?? null, sesjaZadania()!.user.userId, undefined,
          req.body?.silnikModelId ?? null);
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { twId?: number | null; droga?: string; expectedVersion?: number } }>(
    "/api/obsluga/rozmowy/:id/dobor/wybor", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return wybierzKandydata(Number(req.params.id), req.body?.twId ?? null, req.body?.droga ?? "",
          Number(req.body?.expectedVersion), sesjaZadania()!.user.userId);
      } catch (e) { return konflikt(reply, e); }
    });

  /* WIEDZA PRZY DOBORZE (E2): dowody wybranej kartoteki i pomiary z tej
     rozmowy, które mogą stać się dowodem. Odczyt nic nie zapisuje; wynik
     pomiaru trafia do bazy wiedzy WYŁĄCZNIE na kliknięcie (§13.4). */
  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id/dobor/wiedza",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wiedzaDoboru(Number(req.params.id)); }
      catch (e) { return blad(reply, e); }
    });

  /* HISTORIA KLIENTA (§10.1, zakładka KLIENT). Osobna trasa, nie pole
     w `GET …/rozmowy/:id`: zakładkę otwiera się rzadziej niż rozmowę, a to
     są dwa złączenia po loginie i przegląd doborów. Oś rozmowy przeładowuje
     się przy każdym zdarzeniu — dokładanie do niej pracy, której nikt w tej
     chwili nie ogląda, kosztowałoby przy każdym odświeżeniu. */
  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id/klient",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return historiaKlienta(Number(req.params.id)); }
      catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { zadanieId?: number; twId?: number | null; polaryzacja?: string; powodNegatywny?: string | null } }>(
    "/api/obsluga/rozmowy/:id/dobor/pomiar-do-wiedzy", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return pomiarDoWiedzy(Number(req.params.id), {
          zadanieId: Number(req.body?.zadanieId), twId: req.body?.twId ?? null,
          polaryzacja: (req.body?.polaryzacja ?? "pasuje") as "pasuje" | "nie_pasuje",
          powodNegatywny: (req.body?.powodNegatywny ?? null) as never,
        }, sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  /* SKRZYNKA WZMIANEK (§6.4, 0.160.0). `userId` bierze się z SESJI, nigdy
     z parametru — wzmianka niesie fragment komentarza wewnętrznego, a cudzych
     notatek nikt tu oglądać nie ma. Trasa listy niczego nie odhacza. */
  app.get<{ Querystring: { tylkoNowe?: string } }>("/api/obsluga/wzmianki",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const ja = sesjaZadania()!.user.userId;
      return {
        wzmianki: wzmiankiDlaMnie(ja, { tylkoNowe: req.query?.tylkoNowe === "1" }),
        nowe: liczbaNowychWzmianek(ja),
      };
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wzmianki/:id/odhacz",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return odhaczWzmianke(Number(req.params.id), sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  /* Status rozmowy (§7, 0.158.0). Zmiana ręką agenta; przejścia automatyczne
     robią synchronizator i wysyłka, bez udziału tej trasy. */
  app.post<{ Params: { id: string }; Body: { status?: string; doKiedy?: string | null } }>(
    "/api/obsluga/rozmowy/:id/status", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = req.body?.status ?? "";
      /* TYLKO STATUSY RĘCZNE (0.225.0). „Otwarta", „czeka na klienta" i „czeka
         na nas" WYNIKAJĄ z ostatniej wiadomości, więc nadanie ich z ręki byłoby
         przepisaniem faktu, który już stoi w wątku — i jedyne, co mogłoby z tego
         wyjść, to rozjazd. Bramka stoi na TRASIE, nie w serwisie: `ustawStatus`
         wołają też zdarzenia po naszej stronie (zlecenie pomiaru stawia
         `waiting_for_internal`), a te mają prawo pisać stan wprost. */
      if (!(STATUSY_RECZNE as readonly string[]).includes(s)) {
        return reply.code(400).send({
          error: `Tego statusu nie nadaje się ręcznie. Dozwolone: ${STATUSY_RECZNE.join(", ")}.` });
      }
      try {
        return ustawStatus(db(), Number(req.params.id), s as StatusRozmowy,
          sesjaZadania()!.user.userId, req.body?.doKiedy ?? null);
      } catch (e) { return blad(reply, e); }
    });

  /* Priorytet rozmowy (§10.2, 0.181.0). Ręczna flaga — automat nie ma z czego
     jej wyliczyć, dopóki §26 nie rozstrzygnie terminu odpowiedzi. */
  app.post<{ Params: { id: string }; Body: { priorytet?: string } }>(
    "/api/obsluga/rozmowy/:id/priorytet", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const p = req.body?.priorytet ?? "";
      if (p !== "normalny" && p !== "pilny") {
        return reply.code(400).send({ error: `Priorytet to „normalny" albo „pilny".` });
      }
      try {
        return ustawPriorytet(db(), Number(req.params.id), p, sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  /* Wymuszone przekazanie — odebranie rozmowy komuś z rąk. Rola i powód
     stoją tutaj, bo to trasa decyduje o uprawnieniu (wzorzec z domknięcia
     dostawy), a serwis pilnuje wersji i kompletu zapisu. */
  app.post<{ Params: { id: string }; Body: { doUserId?: number | null; powod?: string; expectedVersion?: number } }>(
    "/api/conversations/:id/assign", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const s = sesjaZadania()!;
      const zgoda = autoryzuj(s.user, "wymuszone_przekazanie");
      if (!zgoda.ok) return reply.code(403).send({ error: zgoda.powod });
      try {
        return przekazRozmowe(Number(req.params.id), s.user.userId,
          req.body?.doUserId ?? null, req.body?.powod ?? "", Number(req.body?.expectedVersion));
      } catch (e) { return konflikt(reply, e); }
    });

  /* Ręczne wskazanie oferty. Pytanie bez numeru oferty zostaje pytaniem bez
     numeru — ekran nie zgaduje towaru z najdłuższych słów treści. */
  app.post<{ Params: { id: string }; Body: { ofertaId?: string } }>(
    "/api/conversations/:id/oferta", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return wskazOferte(Number(req.params.id), req.body?.ofertaId ?? "",
          sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  /* Ręczne wskazanie KARTOTEKI dla oferty z rozmowy (0.179.0). SKU sprzedawcy
     bywa puste albo trafia w dwie kartoteki naraz — wtedy rozstrzyga człowiek,
     a wybór podpisuje się jego imieniem. `twId: null` zdejmuje powiązanie. */
  app.post<{ Params: { id: string }; Body: { ofertaId?: string; twId?: number | null } }>(
    "/api/conversations/:id/kartoteka", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return wskazKartoteke(Number(req.params.id), req.body?.ofertaId ?? "",
          req.body?.twId ?? null, sesjaZadania()!.user.userId);
      } catch (e) { return blad(reply, e); }
    });

  /* Wysyłka odpowiedzi (§8.5). Warunki „zalogowany agent" i „uprawnienie""
     domyka `odmowa()`; resztą — przypisaniem, wersją, świeżością, kluczem
     idempotencji i audytem — zajmuje się serwis.

     OBIE FLAGI JAWNEJ ZGODY MUSZĄ BYĆ WYMIENIONE Z NAZWY — w typie i niżej.
     Pole, którego trasa nie deklaruje, ginie po cichu: `mimoObecnosci` jechał
     tędy od 0.190.0 i nie dojeżdżał, więc miękka blokada obecności zachowywała
     się jak twarda przez pełne TTL uchwytu (poprawione w 0.224.1). Zgoda
     wyrażona przez człowieka i zgubiona przez kod jest gorsza niż brak
     przycisku. */
  app.post<{ Params: { id: string }; Body: {
    body?: string; expectedVersion?: number; expectedLastMessageId?: number | null;
    mimoNowejWiadomosci?: boolean; mimoObecnosci?: boolean;
  } }>("/api/conversations/:id/send", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const s = sesjaZadania()!;
    try {
      return await wyslijOdpowiedz({
        conversationId: Number(req.params.id),
        autor: { id: s.user.userId, name: s.user.name },
        body: req.body?.body ?? "",
        expectedVersion: Number(req.body?.expectedVersion),
        expectedLastMessageId: req.body?.expectedLastMessageId ?? null,
        mimoNowejWiadomosci: Boolean(req.body?.mimoNowejWiadomosci),
        mimoObecnosci: Boolean(req.body?.mimoObecnosci),
      });
    } catch (e) { return konflikt(reply, e); }
  });

  /* ── Załączniki do odpowiedzi (0.195.0) ────────────────────────────────────
     Plik jedzie base64 w JSON, jak zdjęcia dowodowe z kolektora — `bodyLimit`
     API stoi na 6 MiB i to on wyznacza nasz próg 4 MiB na plik (uzasadnienie
     przy `LIMIT_NASZ`). Multipart wymagałby wtyczki Fastify, czyli nowej
     zależności dla jednej trasy.

     Odczyt listy nie jest zapisem, więc idzie GET-em i niczego nie mutuje. */
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/zalaczniki", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      return { zalaczniki: zalacznikiRozmowy(db(), Number(req.params.id)) };
    });

  app.post<{ Params: { id: string }; Body: { nazwa?: string; typ?: string; dane?: string } }>(
    "/api/conversations/:id/zalaczniki", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const s = sesjaZadania()!;
      try {
        /* `Buffer.from(..., "base64")` MILCZY przy śmieciach — oddaje krótszy
           bufor zamiast rzucić. Pusty wynik przy niepustym wejściu znaczy
           więc „to nie jest base64", i tak trzeba to nazwać. */
        const surowe = String(req.body?.dane ?? "");
        const dane = Buffer.from(surowe, "base64");
        if (surowe.length > 0 && dane.byteLength === 0) {
          throw new Error("Treść pliku nie jest poprawnym base64");
        }
        return await dodajZalacznik({
          conversationId: Number(req.params.id),
          nazwa: String(req.body?.nazwa ?? ""),
          typ: String(req.body?.typ ?? ""),
          dane,
          autor: { id: s.user.userId, name: s.user.name },
        });
      } catch (e) { return blad(reply, e); }
    });

  app.delete<{ Params: { id: string; zalacznikId: string } }>(
    "/api/conversations/:id/zalaczniki/:zalacznikId", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const s = sesjaZadania()!;
      const zdjety = usunZalacznik(db(), Number(req.params.id), Number(req.params.zalacznikId),
        { id: s.user.userId, name: s.user.name });
      if (!zdjety) return reply.code(404).send({ error: "Nie ma takiego załącznika przy tej rozmowie" });
      return { zdjety: true };
    });

  // SSE: jedna szyna dla obecności, wiadomości, przypisań i wyników magazynu.
  app.get<{ Querystring: { conversationId?: string } }>("/api/conversations/events", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const filter = req.query.conversationId ? Number(req.query.conversationId) : null;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache",
      connection: "keep-alive", "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const off = onConversationEvent((event) => {
      if (filter !== null && event.conversationId !== filter) return;
      reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
    req.raw.on("close", () => { clearInterval(keepAlive); off(); });
  });
}
