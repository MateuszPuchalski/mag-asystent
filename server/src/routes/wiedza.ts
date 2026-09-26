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
import { siecWiedzy } from "../services/siec-wiedzy.js";
import {
  kandydaciZamiennosci, rozstrzygnijZamiennosc, wycofajZamiennosc, zamiennosciTowaru,
} from "../services/zamiennosc-oem.js";
import {
  historiaImportow, importujOdsylacze, wycofajImport, type ZadanieImportu,
} from "../services/odsylacze-dostawcow.js";
import {
  historiaWykazow, importujWykaz, przegladWykazow, wycofajWykaz, zatwierdzZWykazu, type ZadanieWykazu,
} from "../services/wykaz-czesci.js";
import { spiszOferty, sprawdzOferty, stanPasujeDo, zbierzPartie } from "../services/pasuje-do-ofert.js";
import {
  czemuNiegotowy, przegladZSieci, stanPasowaniaZSieci, zatwierdzZSieci,
} from "../services/pasowanie-z-sieci.js";
import { nadawcaPasowaniaSieciAnthropic, nadawcaWykazuSilnikaAnthropic } from "../adapters/copilot.anthropic.js";
import { przebiegSieci, przegladOdSilnika, stanSilnikow, zatwierdzOdSilnika } from "../services/pasowanie-od-silnika.js";
import { config } from "../config.js";
import { BladLimituAllegro } from "../adapters/allegro.js";
import { dodajToken, listaTokenow, rozstrzygnijToken, usunToken } from "../services/tokeny-silnikow.js";

/* ── Trasy bazy wiedzy (§12, etapy E2 i E3) ─────────────────────────────────
   TRZYDZIEŚCI JEDEN ZAPIS: propozycja, rozstrzygnięcie, wycofanie, dowód (E2),
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
   Dwudziesty i dwudziesty pierwszy to decyzja o zamienności przez wspólny
   numer oryginału i jej wycofanie. Kandydat nie ma wiersza, więc nie ma
   trasy propozycji — jest tylko decyzja człowieka i droga powrotu.
   Dwudziesty drugi i dwudziesty trzeci to import odsyłaczy od dostawcy
   (podgląd i zapis jedną trasą) i wycofanie importu w całości.
   Dwudziesty czwarty i dwudziesty piąty to wykaz części producenta — ten
   sam kształt: podgląd i zapis jedną trasą, wycofanie czekających propozycji.
   Dwudziesty szósty to zatwierdzenie propozycji z wykazu listą, którą
   człowiek przejrzał — jedna trasa na listę, jak przy tokenach.
   Dwudziesty siódmy i dwudziesty ósmy to zbiórka „Pasuje do" z ofert:
   strona listy ofert konta i partia treści. Obie CZYTAJĄ Allegro, a piszą
   wyłącznie u nas — publikacji do Allegro nie ma, decyzją właściciela.
   Dwudziesty dziewiąty (0.508.0) to ręczne pasowanie z sieci, po jednej
   kartotece: składa wyłącznie propozycje i nie woła Allegro.
   Trzydziesty (@wydanie) to zatwierdzenie listą propozycji z sieci dla jednej
   kartoteki — ten sam kształt co zatwierdzenie wykazu. Trzydziesty pierwszy
   (@wydanie) to to samo dla jednego silnika z trybu „od silnika”.
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

  /* Jedna kolejka, trzy rodzaje decyzji. Pola nazwane OSOBNO (lekcja
     0.229.0: dwa `liczba` w jednym obiekcie nadpisują się po cichu).
     Kandydaci na zamienność przez wspólny numer oryginału nie są wierszami —
     liczą się tu, przy odczycie, i niczego nie zapisują. */
  app.get("/api/obsluga/wiedza/kolejka", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const pasowania = kolejkaPasowan();
    const zamiennosci = kandydaciZamiennosci();
    const kolejka = kolejkaPropozycji();
    /* Propozycje z wykazów części jadą DWA razy: w `propozycje` (licznik mówi
       prawdę o całej pracy) i pogrupowane w `wykazy` do przeglądu listą.
       Ekran pokazuje każdą raz — pojedyncze karty bez tych z przeglądu. */
    /* Propozycje automatu z sieci (@wydanie) jadą tak samo DWA razy: w
       `propozycje` i pogrupowane po kartotece w `zSieci` do przeglądu listą. */
    return { ...kolejka, wykazy: przegladWykazow(kolejka.propozycje), zSieci: przegladZSieci(kolejka.propozycje),
      zSilnikow: przegladOdSilnika(kolejka.propozycje),
      pasowania: pasowania.propozycje, pasowanDoRozstrzygniecia: pasowania.liczba,
      zamiennosciOem: zamiennosci.kandydaci, zamiennosciOemDoRozstrzygniecia: zamiennosci.liczba };
  });

  app.get<{ Querystring: { q?: string } }>("/api/obsluga/wiedza/modele", async (req, reply) =>
    odmowa(reply) ?? { modele: szukajModeli(req.query.q ?? "") });

  /* Cała sieć wiedzy jednym odczytem: widok „Sieć" rysuje wszystko naraz,
     a strzał po kartotece na węzeł to setki żądań przy pierwszym otwarciu. */
  app.get("/api/obsluga/wiedza/siec", async (_req, reply) => odmowa(reply) ?? siecWiedzy());

  app.get<{ Params: { twId: string } }>("/api/obsluga/wiedza/towar/:twId", async (req, reply) =>
    odmowa(reply) ?? { ...zastosowaniaTowaru(Number(req.params.twId)), pasowania: pasowaniaTowaru(Number(req.params.twId)),
      zamiennosciOem: zamiennosciTowaru(Number(req.params.twId)) });

  /* Ręczna propozycja z ekranu Wiedza. Autor to sesja — nigdy pole z ciała. */
  app.post<{ Body: Partial<NowaPropozycja> }>("/api/obsluga/wiedza/propozycje", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      const z = zaproponujZastosowanie({
        twId: Number(b.twId), model: b.model!, polaryzacja: b.polaryzacja!,
        powodNegatywny: b.powodNegatywny ?? null, komentarz: b.komentarz ?? null,
        zrodlo: "reczne", dowod: b.dowod!, zastepujeId: b.zastepujeId ?? null, warunki: b.warunki ?? null,
      }, { userId: ja().userId, name: ja().name });
      /* Duplikat to odmowa ze zdaniem, nie cichy sukces: agent ma wiedzieć,
         że ta para już czeka albo stoi — i jak zmienić jej warunki, bo drugi
         wpis tej samej pary z innymi latami serwis odbija jako dubel. */
      if (!z) {
        return reply.code(409).send({ error: "Ta para kartoteka–model już czeka w kolejce albo jest zatwierdzona"
          + " — warunki zatwierdzonego wpisu zmienisz przyciskiem „Popraw warunki” przy kartotece" });
      }
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

  /* Zamienność przez wspólny numer oryginału: decyzja o PARZE kartotek, nie
     o wierszu — kandydat wiersza nie ma. Serwis przyjmuje wyłącznie parę,
     która dziś dzieli numer, więc trasa nie jest furtką do dowolnego
     zamiennika. Druga decyzja o tej samej parze → 409 z tym, kto był pierwszy. */
  app.post<{ Body: { twA?: number; twB?: number; decyzja?: string; powod?: string | null } }>(
    "/api/obsluga/wiedza/zamiennosci-oem/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        const b = req.body ?? {};
        return rozstrzygnijZamiennosc(Number(b.twA), Number(b.twB),
          (b.decyzja ?? "") as "zatwierdz" | "odrzuc", b.powod ?? null, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { powod?: string | null } }>(
    "/api/obsluga/wiedza/zamiennosci-oem/:id/wycofaj", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wycofajZamiennosc(Number(req.params.id), req.body?.powod ?? null, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  /* Import odsyłaczy od dostawców. JEDNA trasa na podgląd i zapis, jak przy
     arkuszu lokalizacji: `zastosuj: false` liczy raport i niczego nie zostawia
     (symulacja kandydatów zamienności idzie w punkcie zapisu, który cofa),
     `zastosuj: true` liczy ten sam raport jeszcze raz i dopiero wtedy pisze.
     Dwie trasy dawałyby dwie drogi do jednego rachunku. */
  app.get("/api/obsluga/wiedza/odsylacze", async (_req, reply) => odmowa(reply) ?? historiaImportow());

  app.post<{ Body: Partial<ZadanieImportu> & { zastosuj?: boolean } }>(
    "/api/obsluga/wiedza/odsylacze", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        const b = req.body ?? {};
        return importujOdsylacze({ dostawca: String(b.dostawca ?? ""), plik: b.plik ?? null, tresc: b.tresc ?? {},
          mapowanie: b.mapowanie ?? null }, b.zastosuj === true, ja().userId);
      } catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wiedza/odsylacze/:id/wycofaj", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return wycofajImport(Number(req.params.id), ja().userId); }
    catch (e) { return blad(reply, e); }
  });

  /* Wykaz części producenta (IPL) → propozycje zastosowań. Ten sam kształt
     co odsyłacze: jedna trasa na podgląd i zapis, bo to jeden rachunek.
     Podgląd nie tworzy nawet modelu maszyny — pilnuje tego test tras. */
  app.get("/api/obsluga/wiedza/wykazy", async (_req, reply) => odmowa(reply) ?? historiaWykazow());

  app.post<{ Body: Partial<ZadanieWykazu> & { zastosuj?: boolean } }>(
    "/api/obsluga/wiedza/wykazy", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        const b = req.body ?? {};
        return importujWykaz({ zrodlo: String(b.zrodlo ?? ""), link: b.link ?? null, plik: b.plik ?? null,
          rodzajDowodu: b.rodzajDowodu, tresc: b.tresc ?? {}, mapowanie: b.mapowanie ?? null },
        b.zastosuj === true, ja().userId);
      } catch (e) { return blad(reply, e); }
    });

  /* Zatwierdzenie listą: identyfikatory, które człowiek zostawił zaznaczone
     w przeglądzie wykazu. Jedna trasa na listę — wzór rozstrzygnięcia tokenów. */
  app.post<{ Params: { id: string }; Body: { ids?: unknown } }>(
    "/api/obsluga/wiedza/wykazy/:id/zatwierdz", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return zatwierdzZWykazu(Number(req.params.id), req.body?.ids, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string } }>("/api/obsluga/wiedza/wykazy/:id/wycofaj", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return wycofajWykaz(Number(req.params.id), ja().userId); }
    catch (e) { return blad(reply, e); }
  });

  /* „Pasuje do" ze wszystkich ofert. Odczyt to stan zbiórki i sprawdzenie
     ofert przeciw wiedzy — czysty rachunek na bazie, bez Allegro. Zapisy to
     dwa kroki, które prowadzi ekran partiami: serwer nie trzyma przebiegu.
     Limit Allegro wraca jako 429 z czasem, o który Allegro prosi — ekran
     czeka tyle, zamiast pytać od razu i pogłębiać przerwę. */
  const limit = (reply: FastifyReply, e: unknown) => e instanceof BladLimituAllegro
    ? reply.code(429).send({ error: "Allegro prosi o przerwę — zbiórka wróci po niej", poIluMs: e.poIluMs })
    : blad(reply, e);

  app.get("/api/obsluga/wiedza/pasuje-do", async (_req, reply) =>
    odmowa(reply) ?? { stan: stanPasujeDo(), sprawdzenie: sprawdzOferty() });

  app.post<{ Body: { offset?: unknown } }>("/api/obsluga/wiedza/pasuje-do/lista", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return await spiszOferty(Number(req.body?.offset ?? 0), ja().userId); }
    catch (e) { return limit(reply, e); }
  });

  app.post("/api/obsluga/wiedza/pasuje-do/zbierz", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return await zbierzPartie(ja().userId); }
    catch (e) { return limit(reply, e); }
  });

  /* Pasowanie z sieci uruchomione ręcznie (0.508.0). Właściciel chciał zobaczyć
     automat w pracy bez czekania na noc. JEDNA kartoteka na żądanie, a ekran
     woła w pętli, jak przy zbiórce wyżej: serwer nie trzyma przebiegów w tle,
     a człowiek ma móc przerwać. Wydatek pilnuje sufit nocy, bo ręczny przebieg
     liczy się do tej samej księgi — klikanie nie wyda więcej niż jedna noc.
     Bramka biura, nie admina: to ta sama klasa pracy co zbiórka „Pasuje do". */
  app.get("/api/obsluga/wiedza/pasowanie-z-sieci", async (_req, reply) =>
    odmowa(reply) ?? { ...stanPasowaniaZSieci(), silniki: stanSilnikow() });

  app.post("/api/obsluga/wiedza/pasowanie-z-sieci/sprawdz", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const powod = czemuNiegotowy();
    if (powod) return reply.code(409).send({ error: powod });
    try {
      const wynik = await przebiegSieci({
        nadaj: nadawcaPasowaniaSieciAnthropic, nadajSilnik: nadawcaWykazuSilnikaAnthropic,
        naNoc: config.pasowanieZSieci.naNoc, naPrzebieg: 1,
      });
      return { wynik, stan: { ...stanPasowaniaZSieci(), silniki: stanSilnikow() } };
    } catch (e) { return blad(reply, e); }
  });

  /* Zatwierdzenie listą propozycji automatu dla jednej kartoteki (@wydanie).
     Ten sam kształt co `wykazy/:id/zatwierdz`: ciało to identyfikatory, które
     człowiek zostawił zaznaczone; reszta czeka dalej. */
  app.post<{ Params: { twId: string }; Body: { ids?: unknown } }>(
    "/api/obsluga/wiedza/pasowanie-z-sieci/:twId/zatwierdz", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return zatwierdzZSieci(Number(req.params.twId), req.body?.ids, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  /* Zatwierdzenie listą propozycji trybu „od silnika” (@wydanie): jedna karta
     na silnik, ciało to identyfikatory zostawione zaznaczone. */
  app.post<{ Params: { modelId: string }; Body: { ids?: unknown } }>(
    "/api/obsluga/wiedza/pasowanie-z-sieci/silnik/:modelId/zatwierdz", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return zatwierdzOdSilnika(Number(req.params.modelId), req.body?.ids, ja().userId); }
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
