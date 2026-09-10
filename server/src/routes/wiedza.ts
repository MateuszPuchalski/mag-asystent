import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  dodajDowod, kolejkaPropozycji, rozstrzygnijZastosowanie, szukajModeli, WiedzaConflict,
  wycofajZastosowanie, zaproponujZastosowanie, zastosowaniaTowaru, type DaneModelu, type NowaPropozycja,
} from "../services/wiedza.js";
import {
  dodajIdentyfikator, identyfikatoryTowaru, listaModeliZOpisow, odrzucModelZOpisu, przerobModelZOpisu,
  usunIdentyfikatorZOferty,
} from "../services/identyfikatory.js";
import {
  aliasySilnikow, dodajAliasSilnika, kolejkaZabudow, lukiSilnikow, rozstrzygnijZabudowe, usunAliasSilnika,
  wycofajZabudowe, zaproponujZabudowe, zatwierdzoneZabudowy, type NowaZabudowa,
} from "../services/silniki.js";
import {
  kolejkaPasowan, pasowaniaTowaru, rozstrzygnijPasowanie, wycofajPasowanie, zaproponujPasowanie,
  type NowePasowanie,
} from "../services/pasowania.js";
import { dodajToken, listaTokenow, rozstrzygnijToken, usunToken } from "../services/tokeny-silnikow.js";

/* ── Trasy bazy wiedzy (§12, etapy E2 i E3) ─────────────────────────────────
   DZIEWIĘTNAŚCIE ZAPISÓW: propozycja, rozstrzygnięcie, wycofanie, dowód (E2),
   przerobienie i odrzucenie sekcji „Modele:" z opisu, ręczny identyfikator
   (E3), trzy przy zabudowie silnika (0.229.0), trzy przy pasowaniu części:
   propozycja, rozstrzygnięcie i wycofanie, dwa przy słowniku silników
   (0.238.0): dodanie i usunięcie aliasu, oraz trzy przy tokenach w nazwach
   kartotek (0.239.0): dodanie, rozstrzygnięcie listy i usunięcie. Każda
   z relacji ma ten sam cykl życia co zastosowanie — propozycja, którą
   rozstrzyga człowiek — a bez własnego wycofania zatwierdzona pomyłka
   o uszczelce zostałaby w bazie na zawsze. Alias i token cyklu nie mają
   (zapis ręki biura, nie propozycja automatu). Rozstrzygnięcie tokenu to
   JEDNA trasa dla listy, bo decyzja dotyczy kartotek przejrzanych naraz;
   osobne wywołanie na kartotekę zamieniłoby jedno kliknięcie w trzydzieści.
   Dziewiętnasty doszedł w 0.264.0 i jest cofnięciem numeru dopisanego
   z oferty — jedynego wpisu, którego nie cofa ani poprawka w Subiekcie,
   ani przebudowa po imporcie.
   Każdy zapis idzie przez serwis, który sprawdza konto biura PRZED zapisem
   — trasa nie ma własnej listy ról poza bramką odczytu.

   Adres `wiedza/*`, nie `dopasowania/*` z §16: `dopasowanie` to nazwa
   spalona w bazie i nie ożywiamy jej nawet w URL-u.

   Bramka roli stoi także na odczycie: wiedza niesie numery rozmów i imiona
   agentów; hala pracuje na kolektorze i nie ma po co tu zaglądać.          */

const BIURO = ["biuro", "admin"];

const blad = (reply: FastifyReply, e: unknown) =>
  reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) return reply.code(403).send({ error: "Bazę wiedzy prowadzi biuro" });
  return null;
}

export async function wiedzaRoutes(app: FastifyInstance) {
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof WiedzaConflict
    ? reply.code(409).send({ error: e.message, ...e.details }) : blad(reply, e);
  const ja = () => sesjaZadania()!.user;

  /* Jedna kolejka, dwa rodzaje propozycji. Pola nazwane OSOBNO (lekcja
     0.229.0: dwa `liczba` w jednym obiekcie nadpisują się po cichu). */
  app.get("/api/obsluga/wiedza/kolejka", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const pasowania = kolejkaPasowan();
    return { ...kolejkaPropozycji(), pasowania: pasowania.propozycje, pasowanDoRozstrzygniecia: pasowania.liczba };
  });

  app.get<{ Querystring: { q?: string } }>("/api/obsluga/wiedza/modele", async (req, reply) =>
    odmowa(reply) ?? { modele: szukajModeli(req.query.q ?? "") });

  app.get<{ Params: { twId: string } }>("/api/obsluga/wiedza/towar/:twId", async (req, reply) =>
    odmowa(reply) ?? { ...zastosowaniaTowaru(Number(req.params.twId)), pasowania: pasowaniaTowaru(Number(req.params.twId)) });

  /* Ręczna propozycja z ekranu Wiedza. Autor to sesja — nigdy pole z ciała. */
  app.post<{ Body: Partial<NowaPropozycja> }>("/api/obsluga/wiedza/propozycje", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      const z = zaproponujZastosowanie({
        twId: Number(b.twId), model: b.model!, polaryzacja: b.polaryzacja!,
        powodNegatywny: b.powodNegatywny ?? null, komentarz: b.komentarz ?? null,
        zrodlo: "reczne", dowod: b.dowod!, zastepujeId: b.zastepujeId ?? null,
      }, { userId: ja().userId, name: ja().name });
      /* Duplikat to odmowa ze zdaniem, nie cichy sukces: agent ma wiedzieć,
         że ta para już czeka albo stoi. */
      if (!z) return reply.code(409).send({ error: "Ta para kartoteka–model już czeka w kolejce albo jest zatwierdzona" });
      return z;
    } catch (e) { return blad(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { decyzja?: "zatwierdz" | "odrzuc"; powod?: string | null } }>(
    "/api/obsluga/wiedza/:id/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return rozstrzygnijZastosowanie(Number(req.params.id), req.body?.decyzja as "zatwierdz" | "odrzuc",
          req.body?.powod ?? null, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { powod?: string | null } }>(
    "/api/obsluga/wiedza/:id/wycofaj", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wycofajZastosowanie(Number(req.params.id), req.body?.powod ?? null, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { rodzaj?: string; tresc?: string; link?: string | null } }>(
    "/api/obsluga/wiedza/:id/dowody", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return dodajDowod(Number(req.params.id), {
          rodzaj: req.body?.rodzaj as never, tresc: req.body?.tresc ?? "", link: req.body?.link ?? null,
        }, ja().userId);
      } catch (e) { return blad(reply, e); }
    });

  /* ── E3: sekcje „Modele:" z opisów i identyfikatory ─────────────────────
     Automat NIE proponuje z opisu (decyzja właściciela): człowiek wskazuje
     markę i model, dopiero to tworzy propozycję. Odrzucenie trwale — wiersz
     nie wraca po przebudowie po imporcie. */
  app.get("/api/obsluga/wiedza/z-opisow", async (_req, reply) =>
    odmowa(reply) ?? listaModeliZOpisow());

  app.post<{ Params: { id: string }; Body: { model?: DaneModelu } }>(
    "/api/obsluga/wiedza/z-opisow/:id/przerob", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        if (!req.body?.model) throw new Error("Wskaż markę i model maszyny");
        return przerobModelZOpisu(Number(req.params.id), req.body.model, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wiedza/z-opisow/:id/odrzuc", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return odrzucModelZOpisu(Number(req.params.id), ja().userId); }
    catch (e) { return konflikt(reply, e); }
  });

  /* ── Tokeny silników w nazwach kartotek (0.239.0) ────────────────────────
     Człowiek wpisuje token i silnik, automat układa listę kartotek z tokenem
     w nazwie, człowiek przegląda i klika raz: zaznaczone → zatwierdzone
     zastosowania, odznaczone → pominięte. Automat nie zgaduje marki. */
  app.get("/api/obsluga/wiedza/tokeny", async (_req, reply) => odmowa(reply) ?? listaTokenow());

  app.post<{ Body: { token?: string; silnik?: DaneModelu } }>("/api/obsluga/wiedza/tokeny", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      return dodajToken({ token: String(b.token ?? ""), silnik: b.silnik! }, { userId: ja().userId, name: ja().name });
    } catch (e) { return konflikt(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { zatwierdz?: number[]; pomin?: number[] } }>(
    "/api/obsluga/wiedza/tokeny/:id/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return rozstrzygnijToken(Number(req.params.id),
          { zatwierdz: req.body?.zatwierdz ?? [], pomin: req.body?.pomin ?? [] }, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wiedza/tokeny/:id/usun", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { usunToken(Number(req.params.id), ja().userId); return { ok: true }; }
    catch (e) { return blad(reply, e); }
  });

  app.get<{ Params: { twId: string } }>("/api/obsluga/wiedza/identyfikatory/:twId", async (req, reply) =>
    odmowa(reply) ?? identyfikatoryTowaru(Number(req.params.twId)));

  /* ── Zabudowa silnika: który silnik stoi w której maszynie ──────────────
     `luki` to CZYSTY ODCZYT — ranking maszyn liczony z pól wpisanych przez
     agenta w doborze, nigdy z treści wiadomości klienta (blizna „szarpaka").
     Automat układa kolejkę; markę i nazwę silnika wpisuje człowiek. */
  app.get("/api/obsluga/wiedza/silniki", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const kolejka = kolejkaZabudow();
    const luki = lukiSilnikow();
    /* Pola nazwane OSOBNO, bo oba serwisy zwracają `liczba` i rozsypanie ich
       w jeden obiekt dałoby ciche nadpisanie: zakładka pokazywałaby liczbę luk
       pod napisem „do rozstrzygnięcia". */
    return {
      propozycje: kolejka.propozycje, doRozstrzygniecia: kolejka.liczba,
      luki: luki.luki, lukiRazem: luki.liczba,
      zatwierdzone: zatwierdzoneZabudowy(),
      aliasy: aliasySilnikow(),
    };
  });

  /* `zrodlo` wynika z KONTEKSTU, jak przy pasowaniu: para zaproponowana spod
     pola „Silnik" w rozmowie (jest `conversationId`) to `dobor`, z ekranu
     Wiedza — `reczne`. Agent nie ma jak podać cudzego źródła. */
  app.post<{ Body: Partial<NowaZabudowa> }>("/api/obsluga/wiedza/silniki", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      const z = zaproponujZabudowe({
        maszyna: b.maszyna!, silnik: b.silnik!, rodzajDowodu: b.rodzajDowodu!,
        dowodTresc: String(b.dowodTresc ?? ""), dowodLink: b.dowodLink ?? null,
        komentarz: b.komentarz ?? null, zrodlo: b.conversationId ? "dobor" : "reczne",
        conversationId: b.conversationId ?? null, zastepujeId: b.zastepujeId ?? null,
      }, { userId: ja().userId, name: ja().name });
      /* Duplikat to odmowa ze zdaniem, nie cichy sukces — jak przy
         zastosowaniu: agent ma wiedzieć, że ta para już czeka albo stoi. */
      if (!z) return reply.code(409).send({ error: "Ta para maszyna–silnik już czeka w kolejce albo jest zatwierdzona" });
      return z;
    } catch (e) { return blad(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { decyzja?: string; powod?: string | null } }>(
    "/api/obsluga/wiedza/silniki/:id/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return rozstrzygnijZabudowe(Number(req.params.id),
          (req.body?.decyzja ?? "") as "zatwierdz" | "odrzuc", req.body?.powod ?? null, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { powod?: string | null } }>(
    "/api/obsluga/wiedza/silniki/:id/wycofaj", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wycofajZabudowe(Number(req.params.id), req.body?.powod ?? null, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  /* ── Słownik silników (0.238.0): co znaczy tekst z pola „Silnik" ──────────
     Dwie trasy, nie trzy: alias jest zapisem ręki biura bez cyklu życia,
     pomyłkę się usuwa. Dubel tekstu to 409 ze wskazaniem, do czego prowadzi. */
  app.post<{ Body: { tekst?: string; silnik?: DaneModelu } }>(
    "/api/obsluga/wiedza/silniki/aliasy", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        const b = req.body ?? {};
        return dodajAliasSilnika({ tekst: String(b.tekst ?? ""), silnik: b.silnik! },
          { userId: ja().userId, name: ja().name });
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wiedza/silniki/aliasy/:id/usun", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { usunAliasSilnika(Number(req.params.id), ja().userId); return { ok: true }; }
    catch (e) { return blad(reply, e); }
  });

  /* ── Pasowanie części: uszczelka pasuje DO gaźnika ──────────────────────
     `zrodlo` wynika z KONTEKSTU, nie z ciała: propozycja złożona z rozmowy
     (jest `conversationId`) to `dobor`, z ekranu Wiedza — `reczne`. Agent nie
     ma jak podać cudzego źródła. */
  app.post<{ Body: Partial<NowePasowanie> }>("/api/obsluga/wiedza/pasowania", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      const z = zaproponujPasowanie({
        twId: Number(b.twId), doTwId: Number(b.doTwId), rola: b.rola!, pozycja: b.pozycja ?? null,
        polaryzacja: b.polaryzacja!, powodNegatywny: b.powodNegatywny ?? null,
        rodzajDowodu: b.rodzajDowodu!, dowodTresc: String(b.dowodTresc ?? ""), dowodLink: b.dowodLink ?? null,
        komentarz: b.komentarz ?? null, zrodlo: b.conversationId ? "dobor" : "reczne",
        conversationId: b.conversationId ?? null, zastepujeId: b.zastepujeId ?? null,
      }, { userId: ja().userId, name: ja().name });
      if (!z) return reply.code(409).send({ error: "To pasowanie już czeka w kolejce albo jest zatwierdzone" });
      return z;
    } catch (e) { return blad(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { decyzja?: string; powod?: string | null } }>(
    "/api/obsluga/wiedza/pasowania/:id/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return rozstrzygnijPasowanie(Number(req.params.id),
          (req.body?.decyzja ?? "") as "zatwierdz" | "odrzuc", req.body?.powod ?? null, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { powod?: string | null } }>(
    "/api/obsluga/wiedza/pasowania/:id/wycofaj", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wycofajPasowanie(Number(req.params.id), req.body?.powod ?? null, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  /* Ręczny identyfikator z katalogu, którego nie ma w opisie. Duplikat → 409. */
  app.post<{ Body: { twId?: number; rodzaj?: string; wartosc?: string } }>(
    "/api/obsluga/wiedza/identyfikatory", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        const b = req.body ?? {};
        return dodajIdentyfikator(Number(b.twId), String(b.rodzaj ?? ""), String(b.wartosc ?? ""), ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  /* DZIEWIĘTNASTY ZAPIS (0.264.0): cofnięcie numeru dopisanego z oferty.
     Wąsko, i to jest treść tej trasy: wiersz `opis` cofa się poprawką opisu
     w Subiekcie i najbliższą przebudową, wiersz `reczne` napisał człowiek,
     który wie, co napisał — a wpisu z oferty nie cofa nic, bo przebudowa go
     omija (i musi omijać, nie ma z czego go odtworzyć). Serwis odmawia dla
     pozostałych źródeł: trasa kasująca „identyfikator" bez rozróżnienia
     byłaby drogą do wycięcia wiedzy z opisów jednym żądaniem. */
  app.post<{ Params: { id: string } }>(
    "/api/obsluga/wiedza/identyfikatory/:id/cofnij-z-oferty", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return usunIdentyfikatorZOferty(Number(req.params.id), ja().userId); }
      catch (e) { return konflikt(reply, e); }
    });
}
