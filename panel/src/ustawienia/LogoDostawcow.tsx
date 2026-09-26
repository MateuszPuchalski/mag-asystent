import React, { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useDostawcy, useUsunLogo, useZapiszLogo, type DostawcaZLogo } from "../api/ustawienia";
import { naPng } from "../lib/logo";
import { sciezkaLogo, useLogoDostawcy, zapomnijObraz } from "../towar/useZdjecie";
import { Blad, Przycisk } from "../ui";
import { Potwierdz } from "../ui/Potwierdz";
import { KartaWgladu, Tabela, Td } from "../ui/wglad";

/* ── Logo dostawców (z `biuro.html` 0.56.0 / 0.87.0, 0.444.0) ───────────
   Logo pokazuje się magazynierowi po lewej stronie wiersza listy dostaw —
   firmę poznaje się wzrokiem, zanim przeczyta się numer dokumentu. To samo
   logo stoi przy dostawcy w Dostawach tego panelu.

   Przeglądarka zmniejsza plik, obcina przezroczysty margines i przerabia go
   na PNG, ZANIM cokolwiek pojedzie na serwer (`lib/logo.ts`). Serwer nie
   skaluje obrazów — zero modułów natywnych — więc ta praca jest tu albo
   nigdzie.

   PO ZAPISIE I USUNIĘCIU obraz jest zapominany (`zapomnijObraz`), bo pamięć
   obrazów trzyma go do przeładowania panelu. Bez tego nowe logo pokazałoby
   się w tej tabeli i w Dostawach dopiero po F5.

   JEDNO POLE PLIKU NA KARTĘ, nie jedno na wiersz: kilkadziesiąt ukrytych
   `<input type="file">` to kilkadziesiąt elementów po nic. Przycisk
   zapamiętuje, dla kogo otwiera okno wyboru. */

function Miniatura({ d }: { d: DostawcaZLogo }) {
  const url = useLogoDostawcy(d.khId, d.maLogo);
  /* Miejsce ma wymiary od razu, także bez logo: nazwy zaczynają się wtedy
     w jednej kolumnie, a wiersz nie podskakuje po doczytaniu obrazu. */
  return <span className="inline-flex h-[30px] w-[72px] items-center">
    {url ? <img src={url} alt="" className="h-full w-full object-contain object-left" />
      : !d.maLogo && <span className="text-xs text-slate-500">brak</span>}
  </span>;
}

export function LogoDostawcow() {
  const dostawcy = useDostawcy();
  const zapisz = useZapiszLogo();
  const usun = useUsunLogo();
  const plik = useRef<HTMLInputElement>(null);
  const [dla, setDla] = useState<DostawcaZLogo | null>(null);
  const [wynik, setWynik] = useState("");
  const [blad, setBlad] = useState("");
  const [przetwarza, setPrzetwarza] = useState(false);

  const wybierz = (d: DostawcaZLogo) => {
    setDla(d); setWynik(""); setBlad("");
    plik.current?.click();
  };

  const wyslij = async (f: File) => {
    if (!dla) return;
    const d = dla;
    setPrzetwarza(true);
    setWynik(`Przetwarzam ${f.name}…`);
    try {
      const logoBase64 = await naPng(f);
      await zapisz.mutateAsync({ khId: d.khId, nazwa: d.nazwa, logoBase64 });
      zapomnijObraz(sciezkaLogo(d.khId));
      setWynik(`Logo dla ${d.nazwa} zapisane.`);
    } catch (e) {
      setWynik("");
      setBlad(`Nie zapisano: ${(e as Error).message}`);
    } finally {
      setPrzetwarza(false);
    }
  };

  return <KartaWgladu id="karta-logo" tytul="Logo dostawców"
    /* Rada o logo sprzed 0.87.0 zeszła (0.521.0): dotyczyła jednorazowej
       poprawki sprzed wielu wydań, a stała przy karcie na zawsze. */
    opis={<>Widoczne przy dostawie na kolektorze i w Dostawach. Dowolny plik graficzny — PNG, JPG, WEBP albo SVG;
      przeglądarka zmniejszy go i obetnie przezroczysty margines.</>}>
    <input ref={plik} type="file" accept="image/*,.svg" hidden aria-label="Plik logo dostawcy"
      onChange={(e) => {
        const f = e.target.files?.[0];
        /* Wyczyszczenie pola pozwala wybrać TEN SAM plik drugi raz — np. po
           poprawce w programie graficznym pod tą samą nazwą. */
        e.target.value = "";
        if (f) void wyslij(f);
      }} />
    {wynik && <p className="mb-2 text-sm text-ranga-ok">{wynik}</p>}
    <Blad>{blad || dostawcy.error?.message || usun.error?.message}</Blad>
    <Tabela naglowki={["", "Dostawca", "Dokumenty", ""]}
      pusto="Nie ma jeszcze dokumentów dostaw — nie ma komu wgrać logo.">
      {(dostawcy.data?.dostawcy ?? []).map((d) => <tr key={d.khId}>
        <Td className="w-20"><Miniatura d={d} /></Td>
        <Td className="font-semibold">{d.nazwa}</Td>
        <Td className="tabular-nums text-slate-600">{d.dokumentow} dok.</Td>
        <Td>
          <div className="flex flex-wrap gap-2">
            <Przycisk className="!px-2.5 !py-1 !text-xs" disabled={przetwarza} onClick={() => wybierz(d)}>
              <ImagePlus size={14} />{d.maLogo ? "Zmień" : "Wgraj"}</Przycisk>
            {d.maLogo && <Potwierdz maly etykieta={<><Trash2 size={14} />Usuń</>}
              pytanie="Logo zniknie z listy dostaw na kolektorach." tak="Usuń logo" trwa={usun.isPending}
              onTak={() => {
                setWynik(""); setBlad("");
                usun.mutate(d.khId, {
                  onSuccess: () => { zapomnijObraz(sciezkaLogo(d.khId)); setWynik(`Logo dla ${d.nazwa} usunięte.`); },
                });
              }} />}
          </div>
        </Td>
      </tr>)}
    </Tabela>
  </KartaWgladu>;
}
