import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Towar } from "../wyszukiwarka";
import { Konflikt } from "../api/klient";
import {
  useAgenci, useDodajKomentarz, useJa, usePrzejmij, usePrzekaz, useRozmowa,
  useRozmowy, useSynchronizuj, useUchwytRozmowy, useUstawStatus, useWskazOferte, useWyslij,
  useZapiszSzkic, useZdrowie, useZlecPomiar,
} from "../api/rozmowy";
import { useSzynaZdarzen } from "../api/zdarzenia";
import { Blad } from "../ui";
import { Kolejka } from "../skrzynka/Kolejka";
import { Rozmowa } from "../skrzynka/Rozmowa";
import { AlarmSynchronizacji } from "../skrzynka/AlarmSynchronizacji";
import { StanIntegracji } from "../skrzynka/StanIntegracji";
import type { StatusRozmowy, SzczegolyKonfliktu, SzczegolyWysylki } from "../api/typy";
import { DialogKonfliktu } from "../skrzynka/DialogKonfliktu";

export function Skrzynka() {
  /* Wybrana rozmowa siedzi w ADRESIE, nie w stanie komponentu. Do 0.146.0
     panel zapisywał `?rozmowa=N` przez `history.replaceState` i nigdy tego
     nie odczytywał, więc odświeżenie strony gubiło wybór. */
  const { id } = useParams<{ id: string }>();
  const wybranaId = id ? Number(id) : null;
  const nawiguj = useNavigate();

  const ja = useJa();
  const lista = useRozmowy();
  const rozmowa = useRozmowa(wybranaId);
  const przejmij = usePrzejmij();
  const przekaz = usePrzekaz();
  const oferta = useWskazOferte();
  const zdrowie = useZdrowie();
  const synchronizuj = useSynchronizuj();
  const wyslij = useWyslij();
  const zapisz = useZapiszSzkic();
  const zlec = useZlecPomiar();

  const status = useUstawStatus();
  const agenci = useAgenci();
  const dodajKomentarz = useDodajKomentarz();

  const [szkic, setSzkic] = useState("");
  /* Komentarz ma WŁASNY stan, osobny od szkicu. Gdyby dzieliły jeden, notatka
     „klient bywa trudny" zostawałaby w szkicu po przełączeniu trybu i czekała
     na kliknięcie WYŚLIJ (§6.4). */
  const [komentarz, setKomentarz] = useState("");
  const [wzmianki, setWzmianki] = useState<number[]>([]);
  const [zrodlo, setZrodlo] = useState<number | null>(null);
  const [wskazowka, setWskazowka] = useState("");
  const [towar, setTowar] = useState<Towar | null>(null);
  const [nowa, setNowa] = useState(false);
  const [blad, setBlad] = useState("");
  const [konflikt, setKonflikt] = useState<SzczegolyKonfliktu | null>(null);
  const [bladKonfliktu, setBladKonfliktu] = useState("");
  const [bladOferty, setBladOferty] = useState("");
  const [bladSynchronizacji, setBladSynchronizacji] = useState("");
  const [konfliktWysylki, setKonfliktWysylki] = useState<SzczegolyWysylki | null>(null);
  const [bladWysylki, setBladWysylki] = useState("");
  const [bladStatusu, setBladStatusu] = useState("");
  const [przyRozmowie, setPrzyRozmowie] = useState<string | null>(null);

  useSzynaZdarzen(wybranaId, () => setNowa(true));
  /* Samo wejście w pytanie trzyma je dla tego agenta — do wyjścia albo do
     odpowiedzi, która przydziela je na stałe (decyzja właściciela, 0.159.0). */
  useUchwytRozmowy(wybranaId);

  /* Szkic wchodzi do pola przy zmianie ROZMOWY, nie przy każdym odczycie:
     nadpisywanie go w trakcie pisania kasowałoby pracę agenta. */
  useEffect(() => {
    setSzkic(rozmowa.data?.szkic?.body ?? "");
    setZrodlo(null); setWskazowka(""); setTowar(null); setNowa(false); setBlad("");
    setKonflikt(null); setBladKonfliktu(""); setBladOferty("");
    setKonfliktWysylki(null); setBladWysylki(""); setBladStatusu(""); setPrzyRozmowie(null);
  }, [wybranaId, rozmowa.data?.rozmowa.id]);

  const zglos = (e: unknown) =>
    setBlad(e instanceof Konflikt ? `${e.message} — odśwież rozmowę` : (e as Error).message);

  /* Przegrany wyścig o przejęcie NIE jest zwykłym błędem: ekran ma pokazać
     właściciela, czas i obie wersje, a nie zamienić to w jedno zdanie. */
  const zglosPrzejecie = (e: unknown) => {
    if (e instanceof Konflikt) setKonflikt(e.szczegoly as SzczegolyKonfliktu);
    else setBlad((e as Error).message);
  };

  /* Kontrola świeżości porównuje ostatnią wiadomość KLIENTA, nie ostatnią
     w ogóle — inaczej własna odpowiedź blokowałaby kolejną w tej rozmowie. */
  const ostatniaKlienta = [...(rozmowa.data?.os ?? [])].reverse()
    .find((w) => w.rodzaj === "wiadomosc" && w.odKlienta)?.messageId ?? null;

  function wyslijOdpowiedz(mimoNowejWiadomosci = false, mimoObecnosci = false) {
    if (!rozmowa.data) return;
    setBladWysylki("");
    wyslij.mutate({
      id: rozmowa.data.rozmowa.id, body: szkic,
      expectedVersion: rozmowa.data.rozmowa.wersja,
      expectedLastMessageId: ostatniaKlienta, mimoNowejWiadomosci, mimoObecnosci,
    }, {
      onSuccess: (w) => {
        setKonfliktWysylki(null);
        setPrzyRozmowie(null);
        if (w.status === "sent") setSzkic("");
        else setBlad("Wysyłka nie dała jednoznacznej odpowiedzi — zsynchronizuj wątek.");
      },
      onError: (e) => {
        /* Dopisek klienta nie jest błędem do pokazania w pasku: ekran ma
           postawić dialog i poprosić o jawną zgodę. */
        if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).nowaWiadomosc !== undefined) {
          setKonfliktWysylki(e.szczegoly as SzczegolyWysylki);
        /* Drugi rodzaj konfliktu: przy rozmowie siedzi kto inny. Pytanie do
           agenta jest inne niż przy dopisku klienta, więc i pasek jest inny —
           a zgoda musi być jawna, tak samo jak tam. */
        } else if (e instanceof Konflikt && (e.szczegoly as SzczegolyWysylki).trzymajacyName) {
          setPrzyRozmowie((e.szczegoly as SzczegolyWysylki).trzymajacyName ?? "");
        } else if (konfliktWysylki) setBladWysylki((e as Error).message);
        else zglos(e);
      },
    });
  }

  const jestemAdminem = ja.data?.user.role === "admin";
  const alarm = Boolean(zdrowie.data?.allegroInbox.alarm);

  return <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
    <div className="lg:col-span-2">
      <AlarmSynchronizacji zdrowie={zdrowie.data} trwa={synchronizuj.isPending}
        blad={bladSynchronizacji}
        synchronizuj={() => { setBladSynchronizacji(""); synchronizuj.mutate(undefined,
          { onError: (e) => setBladSynchronizacji((e as Error).message) }); }} />
    </div>

    <Kolejka
      nieswieza={alarm}
      rozmowy={lista.data?.rozmowy ?? []}
      stan={lista.data?.stan ?? { ostatniaSynchronizacja: null, bledy: 0 }}
      wybranaId={wybranaId}
      mojeId={ja.data?.user.userId ?? null}
      laduje={lista.isLoading}
      onOdswiez={() => lista.refetch()}
      onWybierz={(x) => nawiguj(`/obsluga/skrzynka/${x}`)} />

    <div className="space-y-4">
    {/* Uchwyt kolegi zatrzymuje wysyłkę, ale nigdy po cichu: zgoda jest jawna,
        tak samo jak przy dopisku klienta z 0.110.0. */}
    {przyRozmowie && <div className="card flex flex-wrap items-center gap-3 border-violet-300 bg-violet-50 p-3 text-sm">
      <span><b>{przyRozmowie}</b> siedzi teraz przy tej rozmowie.</span>
      <span className="text-slate-600">Dwie odpowiedzi na jedno pytanie to dwie różne prawdy u klienta.</span>
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn-secondary text-sm"
          onClick={() => setPrzyRozmowie(null)}>Zostaw koledze</button>
        <button type="button" className="btn-primary text-sm" disabled={wyslij.isPending}
          onClick={() => wyslijOdpowiedz(false, true)}>Odpowiedz mimo to</button>
      </div>
    </div>}

    <Rozmowa
      dane={rozmowa.data}
      mojeId={ja.data?.user.userId ?? null}
      nowaWiadomosc={nowa}
      szkic={szkic}
      zapisuje={zapisz.isPending}
      zrodloPomiaru={zrodlo}
      wskazowka={wskazowka}
      towar={towar}
      onPrzejmij={() => rozmowa.data && przejmij.mutate(
        { id: rozmowa.data.rozmowa.id, expectedVersion: rozmowa.data.rozmowa.wersja },
        { onError: zglosPrzejecie, onSuccess: () => setKonflikt(null) })}
      onPokazNowa={() => { setNowa(false); rozmowa.refetch(); }}
      komentarz={komentarz}
      onKomentarz={setKomentarz}
      komentuje={dodajKomentarz.isPending}
      /* Komentowanie NIE wymaga prowadzenia rozmowy: notatka zespołu to nie
         odpowiedź do klienta. */
      onDodajKomentarz={() => rozmowa.data && dodajKomentarz.mutate(
        { rozmowaId: rozmowa.data.rozmowa.id, body: komentarz, mentionedUserIds: wzmianki },
        { onSuccess: () => { setKomentarz(""); setWzmianki([]); } })}
      agenci={(agenci.data?.users ?? [])
        .filter((u) => u.userId !== ja.data?.user.userId)
        .map((u) => ({ userId: u.userId, name: u.name }))}
      wzmianki={wzmianki}
      onWzmianki={setWzmianki}
      onSzkic={setSzkic}
      onZapiszSzkic={() => {
        if (!rozmowa.data) return;
        const ostatnia = [...rozmowa.data.os].reverse().find((w) => w.messageId)?.messageId ?? null;
        zapisz.mutate({
          id: rozmowa.data.rozmowa.id, body: szkic, expectedLastMessageId: ostatnia,
          expectedVersion: rozmowa.data.szkic?.wersja ?? null,
        }, { onError: zglos, onSuccess: () => setBlad("") });
      }}
      onZrodlo={setZrodlo}
      onWskazowka={setWskazowka}
      onTowar={setTowar}
      wysyla={wyslij.isPending}
      onWyslij={() => wyslijOdpowiedz(false)}
      onZlec={() => {
        if (!rozmowa.data || !zrodlo) return;
        zlec.mutate({
          rozmowaId: rozmowa.data.rozmowa.id, wiadomoscId: zrodlo,
          instrukcja: wskazowka, twId: towar ? towar.id : null,
        }, { onError: zglos, onSuccess: () => { setZrodlo(null); setWskazowka(""); setTowar(null); } });
      }}
      konflikt={konflikt}
      mozeWymusic={jestemAdminem}
      wymusza={przekaz.isPending}
      bladKonfliktu={bladKonfliktu}
      zapisujeOferte={oferta.isPending}
      bladOferty={bladOferty}
      onZamknijKonflikt={() => setKonflikt(null)}
      onPoprosOPrzekazanie={() => {
        /* Prośba o przekazanie to komentarz wewnętrzny, nie osobny mechanizm:
           właściciel czyta go w rozmowie, przy której siedzi. */
        if (!rozmowa.data) return;
        setSzkic(`@${konflikt?.assignedUserName ?? ""} — przejmiesz tę rozmowę? `.trimEnd());
        setKonflikt(null);
      }}
      onWymus={(powod) => {
        if (!rozmowa.data) return;
        setBladKonfliktu("");
        przekaz.mutate({
          id: rozmowa.data.rozmowa.id, doUserId: ja.data?.user.userId ?? null,
          powod, expectedVersion: konflikt?.version ?? rozmowa.data.rozmowa.wersja,
        }, { onSuccess: () => setKonflikt(null),
             onError: (e) => setBladKonfliktu((e as Error).message) });
      }}
      onWskazOferte={(ofertaId) => {
        if (!rozmowa.data) return;
        setBladOferty("");
        oferta.mutate({ id: rozmowa.data.rozmowa.id, ofertaId },
          { onError: (e) => setBladOferty((e as Error).message) });
      }}
      zapisujeStatus={status.isPending}
      bladStatusu={bladStatusu}
      onZmienStatus={(nowy: StatusRozmowy, doKiedy) => {
        if (!rozmowa.data) return;
        setBladStatusu("");
        status.mutate({ id: rozmowa.data.rozmowa.id, status: nowy, doKiedy },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      onDopytajOOferte={() => setSzkic((s) => s
        || "Dzień dobry, proszę o numer oferty, której dotyczy pytanie — dobiorę wtedy właściwą część.")}
    />
    </div>

    {konfliktWysylki && <DialogKonfliktu
      szczegoly={konfliktWysylki} szkic={szkic} wysyla={wyslij.isPending} blad={bladWysylki}
      onWyslijMimoTo={() => wyslijOdpowiedz(true)}
      onPopraw={() => { setKonfliktWysylki(null); rozmowa.refetch(); }} />}

    <div className="lg:col-span-2 space-y-4">
      <Blad>{blad || (lista.error as Error | null)?.message}</Blad>
      <StanIntegracji zdrowie={zdrowie.data} odczyt={zdrowie.dataUpdatedAt} />
    </div>
  </div>;
}
