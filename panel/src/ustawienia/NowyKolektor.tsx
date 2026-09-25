import React, { useState } from "react";
import qrcode from "qrcode-generator";
import { useKolektor } from "../api/ustawienia";
import { Blad } from "../ui";
import { KartaWgladu } from "../ui/wglad";

/* ── Nowy kolektor (0.496.0) ───────────────────────────────────────────
   Pierwsza instalacja aplikacji na kolektorze szła przez MDM albo kabel.
   Serwer rozdaje APK bez logowania (`/api/aktualizacja/apk`), więc wystarczy
   zeskanować ten kod aparatem kolektora: przeglądarka pobierze plik,
   a Android zapyta o zgodę na instalację.

   Adres bierze się z SERWERA, nie z paska przeglądarki: panel otwarty na
   samym serwerze to `localhost`, a z kolektora `localhost` jest kolektorem.

   Skanera na ekranie startowym kolektora celowo tu nie wołamy — jest tam
   wyłączony, żeby wpisywane hasło nie pojechało jako skan (nagłówek
   `SplashScreen.kt`). Aplikacja ma adres produkcyjny wbudowany; wpisuje się
   go tylko po przeprowadzce serwera, i do tego jest duży napis niżej. */

function KodQr({ tekst }: { tekst: string }) {
  const qr = qrcode(0, "M");
  qr.addData(tekst);
  qr.make();
  const n = qr.getModuleCount();
  const moduly: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) moduly.push(<rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} />);
    }
  }
  /* Margines czterech modułów to minimum ze specyfikacji QR — bez niego
     aparaty gubią kod na ciemnym tle karty. */
  return <svg role="img" aria-label={`Kod QR: ${tekst}`} viewBox={`-4 -4 ${n + 8} ${n + 8}`}
    className="h-48 w-48 bg-white" shapeRendering="crispEdges" fill="currentColor">{moduly}</svg>;
}

export function NowyKolektor({ biuro }: { biuro: boolean }) {
  const k = useKolektor(biuro);
  const [wybrany, setWybrany] = useState<string | null>(null);
  if (!biuro) return null;

  const d = k.data;
  const adres = wybrany ?? d?.adresy[0] ?? null;
  const baza = adres && d ? `http://${adres}:${d.port}` : null;

  return <KartaWgladu id="karta-kolektor" tytul="Nowy kolektor"
    opis={<>Pierwsza instalacja bez kabla i MDM: zeskanuj kod aparatem kolektora, pobierz aplikację
      i zgódź się na instalację. Kolektory w sieci magazynu znają adres serwera same.</>}>
    {d && !baza && <p className="text-sm text-ranga-zle">Serwer nie widzi swojego adresu w sieci lokalnej —
      kolektor go nie znajdzie. Sprawdź kartę sieciową serwera (DEPLOY.md §4).</p>}
    {baza && <div className="flex flex-wrap items-start gap-6">
      {d!.apk
        ? <KodQr tekst={`${baza}/api/aktualizacja/apk`} />
        : <p className="max-w-xs text-sm text-slate-600">Serwer nie ma jeszcze APK kolektora — dokłada je
          aktualizacja serwera. Do tego czasu zostaje instalacja z pliku.</p>}
      <div className="text-sm">
        <p className="mb-1 text-slate-600">Adres serwera, gdy aplikacja powie „Nie widzę serwera":</p>
        <p className="text-tytul mb-3 font-bold">{baza}</p>
        {d!.apk?.wersja && <p className="mb-3 text-slate-600">Wersja aplikacji na serwerze: {d!.apk.wersja}</p>}
        {d!.adresy.length > 1 && <label className="block text-slate-600">Serwer ma kilka adresów — wybierz ten
          z sieci hali:{" "}
          <select aria-label="Adres serwera" className="field w-auto" value={adres ?? ""}
            onChange={(e) => setWybrany(e.target.value)}>
            {d!.adresy.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>}
      </div>
    </div>}
    <Blad>{k.error?.message}</Blad>
  </KartaWgladu>;
}
