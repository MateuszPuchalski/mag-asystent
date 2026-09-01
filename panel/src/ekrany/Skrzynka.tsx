import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Towar } from "../wyszukiwarka";
import { Konflikt } from "../api/klient";
import {
  useJa, useOdloz, usePrzejmij, usePrzekaz, useRozmowa, useRozmowy, useSynchronizuj,
  useUchwytRozmowy, useUstawStatus, useWskazOferte, useWyslij, useZalatw, useZapiszSzkic,
  useZdrowie, useZlecPomiar,
} from "../api/rozmowy";
import { useSzynaZdarzen } from "../api/zdarzenia";
import { Blad } from "../ui";
import { Kolejka } from "../skrzynka/Kolejka";
import { KUBELKI, Kubelki, wKubelku, type KubelekId } from "../skrzynka/Kubelki";
import { Decyzja } from "../skrzynka/Decyzja";
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
  const odloz = useOdloz();
  const zalatw = useZalatw();
  const status = useUstawStatus();

  const [szkic, setSzkic] = useState("");
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
  const [kubelek, setKubelek] = useState<KubelekId>("moje");
  const [bladStatusu, setBladStatusu] = useState("");
  const [przyRozmowie, setPrzyRozmowie] = useState<string | null>(null);

  useSzynaZdarzen(wybranaId, () => setNowa(true));
  /* Samo wejście w pytanie trzyma je dla tego agenta — do wyjścia albo do
     odpowiedzi, która przydziela je na stałe (decyzja właściciela, 0.158.0). */
  useUchwytRozmowy(wybranaId);

  const mojeId = ja.data?.user.userId ?? null;
  const wszystkie = lista.data?.rozmowy ?? [];
  const wKolejce = useMemo(
    () => wszystkie.filter((r) => wKubelku(r, kubelek, mojeId)),
    [wszystkie, kubelek, mojeId]);
  const wybrana = wszystkie.find((r) => r.id === wybranaId) ?? null;

  /* Wejście z paska adresu na rozmowę spoza wybranego kubełka ma pokazać TĘ
     rozmowę, a nie pustą listę. Adres jest źródłem prawdy, kubełek za nim
     idzie — dokładnie jak w zwrotach. */
  useEffect(() => {
    if (wybrana && !wKubelku(wybrana, kubelek, mojeId)) setKubelek("wszystkie");
  }, [wybrana?.id, wybrana?.status]);

  /**
   * Przełączenie kubełka PRZESTAWIA TEŻ KURSOR.
   *
   * Blizna z panelu zwrotów, znaleziona okiem, nie testem: bez tego jeden
   * klawisz zmieniał listę, a zaznaczenie zostawało na rozmowie z poprzedniego
   * kubełka — i trzeba było dokliknąć wiersz.
   */
  const przelacz = (k: KubelekId) => {
    setKubelek(k);
    const pierwsza = wszystkie.find((r) => wKubelku(r, k, mojeId));
    nawiguj(pierwsza ? `/obsluga/skrzynka/${pierwsza.id}` : "/obsluga/skrzynka");
  };

  const idz = (o: number) => {
    if (!wKolejce.length) return;
    const i = wKolejce.findIndex((r) => r.id === wybranaId);
    const nast = wKolejce[Math.min(wKolejce.length - 1, Math.max(0, (i < 0 ? 0 : i) + o))];
    if (nast) nawiguj(`/obsluga/skrzynka/${nast.id}`);
  };

  /** Zmiana statusu z jednego miejsca — klawisz i przycisk robią to samo. */
  const zmienStatus = (nowyStatus: StatusRozmowy) => {
    if (!wybrana) return;
    setBladStatusu("");
    const przy = { onError: (e: unknown) => setBladStatusu((e as Error).message) };
    if (nowyStatus === "resolved") {
      zalatw.mutate({ id: wybrana.id, expectedVersion: wybrana.wersja }, przy);
    } else {
      status.mutate({ id: wybrana.id, status: nowyStatus, expectedVersion: wybrana.wersja }, przy);
    }
  };

  useEffect(() => {
    const naKlawisz = (e: KeyboardEvent) => {
      /* Skrót nie ma prawa zadziałać, gdy ktoś pisze — inaczej „s" w szkicu
         odpowiedzi oznaczałoby rozmowę jako spam, a `Backspace` cofałby
         decyzję zamiast kasować literę. */
      const cel = e.target as HTMLElement | null;
      if (cel && /^(INPUT|TEXTAREA|SELECT)$/.test(cel.tagName)) return;
      if (cel?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") { e.preventDefault(); idz(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idz(-1); }
      else if (/^[1-7]$/.test(e.key)) przelacz(KUBELKI[Number(e.key) - 1].id);
      else if (e.key === "z" || e.key === "Z") zmienStatus("resolved");
      else if (e.key === "s" || e.key === "S") zmienStatus("spam");
      else if (e.key === "Backspace") { e.preventDefault(); zmienStatus("open"); }
    };
    window.addEventListener("keydown", naKlawisz);
    return () => window.removeEventListener("keydown", naKlawisz);
  }, [wKolejce, wybranaId, wszystkie, kubelek, mojeId]);

  /* Szkic wchodzi do pola przy zmianie ROZMOWY, nie przy każdym odczycie:
     nadpisywanie go w trakcie pisania kasowałoby pracę agenta. */
  useEffect(() => {
    setSzkic(rozmowa.data?.szkic?.body ?? "");
    setZrodlo(null); setWskazowka(""); setTowar(null); setNowa(false); setBlad("");
    setKonflikt(null); setBladKonfliktu(""); setBladOferty("");
    setKonfliktWysylki(null); setBladWysylki(""); setPrzyRozmowie(null);
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
      kubelki={<Kubelki rozmowy={wszystkie} mojeId={mojeId}
        wybrany={kubelek} onWybierz={przelacz} />}
      mojeId={mojeId}
      rozmowy={wKolejce}
      stan={lista.data?.stan ?? { ostatniaSynchronizacja: null, bledy: 0 }}
      wybranaId={wybranaId}
      laduje={lista.isLoading}
      onOdswiez={() => lista.refetch()}
      onWybierz={(x) => nawiguj(`/obsluga/skrzynka/${x}`)} />

    <div className="space-y-4">
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

    {wybrana && <Decyzja
      rozmowa={wybrana}
      zajete={odloz.isPending || zalatw.isPending || status.isPending}
      blad={bladStatusu}
      onOdloz={(iso) => {
        setBladStatusu("");
        odloz.mutate({ id: wybrana.id, do: iso, expectedVersion: wybrana.wersja },
          { onError: (e) => setBladStatusu((e as Error).message) });
      }}
      onStatus={zmienStatus}
      mojeId={mojeId} />}

    <Rozmowa
      dane={rozmowa.data}
      mojeId={mojeId}
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
