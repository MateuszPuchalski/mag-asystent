import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania, subiekt } from "../context.js";
import { szukajWszedzie } from "../services/szukaj-wszedzie.js";
import { historiaSprawy } from "../services/klient-historia.js";
import {
  cofnijNotatkeKlienta, profilKlienta, zapiszNotatkeKlienta,
} from "../services/profil-klienta.js";
import {
  BladSprawy, BrakKlienta, KonfliktSprawy, przejmijSprawe, sprawaKlienta, ustawKrok, wznowSprawe,
  zakonczSprawe, type SprawaKlienta,
} from "../services/prowadzenie-klienta.js";
import { wpiszNumerDosylki, zalozDosylkeZProfilu } from "../services/dosylka.js";

/* ── Trasy PONAD kolejkami (23 września 2026) ────────────────────────────────
   Szukanie Ctrl+K i historia klienta ze zwrotu albo sprawy nie należą do
   żadnej jednej kolejki — dlatego nie stoją w pliku żadnej z nich. Obie są
   ODCZYTEM: GET, zero zapisu i zero żądań do Allegro. */

const BIURO = ["biuro", "admin"];

/**
 * Historia klienta RAZEM ze sprawą klienta — wiązanie w drugą stronę
 * (CLAUDE.md: jednostronne to takie, którego nie ma). Z profilu widać
 * kolejki; ze zwrotu, reklamacji i rozmowy ma być widać sprawę. Składa to
 * TRASA, bo `klient-historia.ts` nie ma prawa importować serwisu sprawy —
 * sprawa sama czyta historię (`kontaLoginu`, `rozmowyPoLoginie`).
 *
 * `login` podaje trasa rozmowy osobno: sprawa budzi się też z rozmowy bez
 * rozmówcy w wątku, dowiązanej numerem zamówienia, a historia takiej
 * rozmowy loginu nie ma (`loginSprawyRozmowy`).
 *
 * NUMER DOSYŁKI TU NIE JEDZIE (@wydanie). Linia sprawy przy źródle drukuje
 * samo zdanie dosyłki, a numer prowadzi do adresu odbiorcy. Potrzebuje go
 * wyłącznie karta sprawy na profilu, gdzie agent go kopiuje albo poprawia.
 */
export function zeSprawa<H extends { login: string | null }>(
  h: H, login: string | null = h.login,
): H & { sprawa: SprawaKlienta | null } {
  const sprawa = login ? sprawaKlienta(login) : null;
  return {
    ...h,
    sprawa: sprawa && { ...sprawa, dosylki: sprawa.dosylki.map((d) => ({ ...d, waybill: null })) },
  };
}

/* Bramka jak w skrzynce: sprawy klientów widzi biuro, nie hala. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Szukanie spraw obsługuje biuro" });
  }
  return null;
}

export async function spoiwoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>("/api/obsluga/szukaj", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    /* Towar bez furtki literówek: w oknie szukania rozmyte trafienie
       w kartotekę zagłuszałoby dokładne trafienie w sprawę. */
    return {
      trafienia: szukajWszedzie(req.query.q ?? "", (q) => subiekt.search(q, 8, { literowki: false })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/zwroty/:id/klient", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return zeSprawa(historiaSprawy("zwrot", Number(req.params.id))); }
    catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });

  /* Reklamacja i dyskusja to jedna tabela — jedna trasa, rodzaj zna wiersz. */
  app.get<{ Params: { id: string } }>("/api/obsluga/sprawy/:id/klient", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return zeSprawa(historiaSprawy("sprawa", Number(req.params.id))); }
    catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });

  /* PROFIL KLIENTA (24 września 2026) — odczyt; 404 ze zdaniem, gdy login nie
     występuje nigdzie, żeby ekran nie rysował pustego profilu jak prawdziwego. */
  app.get<{ Params: { login: string } }>("/api/obsluga/klient/:login", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const p = profilKlienta(req.params.login);
    if (!p) return reply.code(404).send({ error: "Nie znamy klienta o takim loginie" });
    return p;
  });

  /* Notatka o kliencie — zapis profilu obok sprawy klienta (trasy `/sprawa/*`
     niżej). `tresc: null` albo pusta zdejmuje. */
  app.post<{ Params: { login: string }; Body: { tresc?: string | null } }>(
    "/api/obsluga/klient/:login/notatka", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const t = req.body?.tresc;
      if (t !== undefined && t !== null && typeof t !== "string") {
        return reply.code(400).send({ error: "Pole `tresc` musi być tekstem albo `null`" });
      }
      const s = sesjaZadania()!;
      try {
        return { notatka: zapiszNotatkeKlienta(req.params.login, t ?? null,
          { id: s.user.userId, name: s.user.name }) };
      } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    });

  app.post<{ Params: { login: string } }>(
    "/api/obsluga/klient/:login/notatka/cofnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const s = sesjaZadania()!;
      const ok = cofnijNotatkeKlienta(req.params.login, { id: s.user.userId, name: s.user.name });
      if (!ok) return reply.code(409).send({ error: "Nie ma poprzedniej notatki do przywrócenia" });
      return { ok };
    });

  /* ── SPRAWA KLIENTA (0.535.0, S6) ─────────────────────────────────────────
     Cztery zapisy, każdy z wymaganą `wersją` (od 0.536.0 jeszcze dwa przy
     dosyłce, niżej). KAŻDY KLUCZ CIAŁA JEST
     WYMAGANY i sprawdza się go `in`, nie `?? null`: brak klucza to 400 bez
     zapisu. Pole, które nie dojechało z trasy do serwisu, ginęło już po
     cichu (blizna 0.224.1), a wartość domyślna podstawiona w jego miejsce
     zamieniłaby taką zgubę w zapis. Notatka wyżej ma `?? null` słusznie:
     brak treści JEST tam zdjęciem notatki.

     Błędy mają STAŁE zdania: powód odrzucenia idzie do `events`, a login
     ani krok nie mają prawa tam trafić (`sciezkaDoAudytu` w `context.ts`). */
  const pola = (body: unknown, klucze: Record<string, "string" | "number">): string | null => {
    if (!body || typeof body !== "object") return "Brak ciała żądania";
    for (const [k, typ] of Object.entries(klucze)) {
      if (!(k in body)) return `Brak pola \`${k}\``;
      if (typeof (body as Record<string, unknown>)[k] !== typ) return `Pole \`${k}\` ma zły typ`;
    }
    const w = (body as Record<string, unknown>).wersja;
    return Number.isInteger(w) && (w as number) >= 0 ? null : "Pole `wersja` musi być liczbą całkowitą";
  };
  const wykonaj = (reply: FastifyReply, zapis: () => SprawaKlienta) => {
    try { return { sprawa: zapis() }; } catch (e) {
      if (e instanceof KonfliktSprawy) return reply.code(409).send({ error: e.message, sprawa: e.sprawa });
      if (e instanceof BrakKlienta) return reply.code(404).send({ error: e.message });
      if (e instanceof BladSprawy) return reply.code(400).send({ error: e.message });
      throw e;
    }
  };
  const autor = () => { const s = sesjaZadania()!; return { id: s.user.userId, name: s.user.name }; };
  type Cialo = Record<string, unknown>;

  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/krok", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, { krok: "string", krokDo: "string", wersja: "number", odcisk: "string" });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => ustawKrok(req.params.login, {
        krok: String(b.krok), krokDo: String(b.krokDo), wersja: Number(b.wersja), odcisk: String(b.odcisk),
      }, autor()));
    });

  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/zakoncz", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, { wersja: "number", odcisk: "string" });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => zakonczSprawe(req.params.login,
        { wersja: Number(b.wersja), odcisk: String(b.odcisk) }, autor()));
    });

  /* „Cofnij” i „Przejmij” też niosą odcisk: wiadomość klienta nie podbija
     `wersji`, a oba zapisy ustawiają „znane” — bez odcisku gasiłyby
     zdarzenie, którego ekran nie narysował (`sprawdzOdcisk`). */
  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/wznow", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, { wersja: "number", odcisk: "string" });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => wznowSprawe(req.params.login,
        { wersja: Number(b.wersja), odcisk: String(b.odcisk) }, autor()));
    });

  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/przejmij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, { wersja: "number", odcisk: "string" });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => przejmijSprawe(req.params.login,
        { wersja: Number(b.wersja), odcisk: String(b.odcisk) }, autor()));
    });

  /* ── DOSYŁKA (0.536.0, drugi przyrost S6) ─────────────────────────────────
     Dwa zapisy z profilu, z tymi samymi strażnikami co cztery wyżej: każdy
     klucz wymagany, wersja i odcisk ekranu, 409 ze świeżą sprawą. Zamówienia
     i konta propozycja NIE niesie — wynikają ze zwrotu po stronie serwera.
     Numer przesyłki jedzie w CIELE, nie w adresie: adres ląduje w logu
     żądań, a numer prowadzi do adresu odbiorcy. */
  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/dosylka", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, { zwrotId: "number", wersja: "number", odcisk: "string" });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => zalozDosylkeZProfilu(req.params.login,
        { zwrotId: Number(b.zwrotId), wersja: Number(b.wersja), odcisk: String(b.odcisk) }, autor()));
    });

  app.post<{ Params: { login: string }; Body: Cialo }>(
    "/api/obsluga/klient/:login/sprawa/dosylka/numer", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const zle = pola(req.body, {
        zamowienie: "string", waybill: "string", przewoznik: "string", wersja: "number", odcisk: "string",
      });
      if (zle) return reply.code(400).send({ error: zle });
      const b = req.body;
      return wykonaj(reply, () => wpiszNumerDosylki(req.params.login, {
        zamowienie: String(b.zamowienie), waybill: String(b.waybill), przewoznik: String(b.przewoznik),
        wersja: Number(b.wersja), odcisk: String(b.odcisk),
      }, autor()));
    });
}
