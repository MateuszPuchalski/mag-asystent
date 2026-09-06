import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "./index.css";
import { Dowody } from "./zwroty/Dowody";
import { Dopisz } from "./zwroty/Dopisz";

const OBRAZY: Record<string, string> = { A: "iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAACDUlEQVR4nO3dwW0DQQxDUZeaIlJEig2QQxpIDRlrxC/tB1gA+eCbF6PX98+vacgr3uAhEVroXRFa6F0RWuhdEVroXRFa6F0R+vHQH59fZ4k3HwB9jMtHR0CX+wLFk9ANvhzxDHSEOMvdDR0nTnG3Qsdlg9ZN0HHQOHcHdNyRYH0XOs7H4b4IHVdDWd+CjnvRrK9Ax6WA1vXQcSOmdTF0XAdrXQkddyFbl0HHReDWNdBxC751AXRcYYS10EOg4/unWL8FHV8+yFpoPHR88yzrQ+j42nHWQoOh4zsJEXoLdHwhJ0ILfW0Ss9U5NHkJvCEX+kCZXJIIfUxMrvoPaFr1WYVZ0IXKtM4g6HJlVG2hYdCQunOtEdBXlSH9hRZa6HHKhAlCCy200EJzJwgttNBCC82dILTQQk+0jvcXWmihx1kTyvufYVNtoZ8HfcOa05kFXWuNKuy3d01VidBvcjNLcqHPrLEN/eK/6XcwA5oZoVdAa32gLDQbWusDMaHZ0E+2PuPyBZoOZaGHQD/N+h0o373rUBZ6FPQTrN8n8rXdDuVK6K3WVTi+iN6hXA+9ybqWxasVHcq3oKdb3wDxslCH8l3oidb3KLz+dp24D5pv3SDghc6m7d6cXQoN4e6f7F3wB0B3isc3IqDviccXQaFL0OPNh0Evi9BC74rQQu+K0ELvitBC74rQQu+K0E35A4R7w++tLBStAAAAAElFTkSuQmCC", B: "iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAABfElEQVR4nO3cwU0DURBEQQdGTIRDdA6AIyEgEQEG/+nZdkkvgOk679/b1+ddA93iF7xIoEF3BRp0V6BBdwUadFegQXcFGnRXoEF3BRp0V6BBdwUadFegQXcFGnRXoEF3BRp0V6BB//Tx/vb74tdeD/oh30uI74L+p+9m8UXQT1deZb0C+hDxKu489IDyBusk9BjxBu4YdEQ5aJ2BDiqnrAPQceWI9TR03DdlDboROi4btJ6DjptmrUF3Qcc149YT0HHHDdagQYPuUx6wBg0adKXyaWvQoEGDBg36IoEGDRo06L2BBg0aNOi9gQZdZH3UATRo0JXWpxFAgwbdZz0g4GvSCWXQjdA7rce2e8MCGnSH9fBqL2erobPWkb3+bvAC0MPc2Zl56Bnr+MYV0Ee547vWQZ+wji9aCv0s8fj9l4H+m3j82gtD1wQadFegQXcFGnRXoEF3BRp0V6BBdwUadFegQXcFGnRXoEF3BRp0V6BBdwUadFegQXcFeqhvjbojJV9EqtkAAAAASUVORK5CYII=", C: "iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAACUElEQVR4nO3dwW3DQAxEUVeXIlJOqg2QWypIAwFsWeTMkPsBnmP+Fx2l3cf37w8jmId9g0MGaKB3DdBA7xqgz4b++Pq8M/b9o6Fv4oaj+6GbfNPEbdAy3xBxA7SR2MgthbbjGrlF0HZQO3c7tB0xhLsX2m6XY90FbSdL426BtksFWtdD240yrSuh7TTJ3GXQdpFw6xpou0W+dQG0XWGE9V1oe/8U61vQ9vJB1u9D25tnWQOdDR2bFLvYO9CBGflLXoaO2n7QtinQ5cRpO1+Dtq+bxt0CPZc4ocIGbVE2hrwKvUbZlaOGthO7ol6CXqksTtNB2029dc+hFz/OykARtF3T3vgE+gRlTWk7tF1QaQ10NvRRyt3JQM+HtqtZrC9DH/g4t4Z3Qdu9jNZAr4O2S3mtL0Cf/Dg3CQA9FtpulGANNNB5AzTQQAMNdO4ADTTQQAOdO0ADDTTQQOcO0EADrYTeYV0uALQV+uYv2Zm80P/+Qd7rELUDPRx6rnVTOG+Tiqp5P1qUDHQA9GnWrbFAb4GeYt1dypezoka+BY/5FlzzD58O/fRXOK9DlMYJNKIozlQKg95kbQnh3Ls86I4tldze5TmbVLRzCnQTd862nB8tWpIT0UWLcca/QhnoCdBnWr9txc1CCuUC6HOsbypx+5tCuQx6t3WJDzd0KpSLoZdx17Jwi7JCuQt6unUHCDfdtxMroGdZtzq0Q4/gFgiIoGO5Ze1S6ChucbUB2s5t6bVB68W9mX7obnF7Vxx0Ibp9/zHQ+wZooHcN0EDvGqBF8wc1+niBJdvQngAAAABJRU5ErkJggg==" };
const OFERTY: Record<string, string> = { "111": "A", "222": "C", "333": "B" };
function bin(b64: string) {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const oryginal = window.fetch;
window.fetch = (async (we: any, init?: any) => {
  const url = String(typeof we === "string" ? we : we?.url ?? we);
  const o = url.match(/oferta\/([^/]+)\/zdjecie/);
  if (o) { const k = OFERTY[decodeURIComponent(o[1])];
    return k ? new Response(bin(OBRAZY[k]), { headers: { "content-type": "image/png" } })
             : new Response("", { status: 404 }); }
  if (/zdjecie/.test(url)) return new Response("", { status: 404 });
  return oryginal(we, init);
}) as any;

const POZ_ZAM = (n: any) => ({ offerId: "111", nazwa: "PRZYSTAWKA DO SZLIFIERKI KĄTOWEJ DO SZLIFOWANIA",
  sku: "W28-1701", ilosc: 1, cenaGrosze: 1393, waluta: "EUR", zwracana: true, wracaIlosc: 1,
  twId: null, twSymbol: null, twZrodlo: null, ofertaZdjecie: "jest", ...n });

const ZWROT: any = { id: 1, externalId: "z-1", numer: "70X0/2026", orderId: "ord-1",
  utworzono: "2026-09-05T23:27:12Z", paczkaAt: "2026-09-05T23:27:34Z", dostarczonoAt: null,
  przesylkaStatus: null, kubelek: "decyzja", sygnaly: [], terminAt: "2026-09-19T23:27:12Z",
  dniDoTerminu: 14, sumaPozycjiGrosze: 1491, kwotaPelnaGrosze: null, waluta: "EUR",
  linkZwrotu: null, werdykt: null, werdyktPowod: null, kwotaGrosze: null, kwotaWariant: null,
  korektaNumer: null, korektaZrodlo: null, rejectionCode: null, zrodlo: "allegro", notatka: null,
  kupujacyLogin: "Fenix", przewoznik: "ZIGZAG", rozmowy: [], wersja: 1,
  faktura: { dokId: 5, numer: "FS 189/MAG/09/2026", typ: "FS", zrodlo: "numer",
    at: "2026-09-05", przez: "automat" },
  pozycje: [],
  zamowienie: { externalId: "ord-1", status: "READY", kupujacyLogin: "Fenix", dostawaGrosze: 0,
    dostawaMetoda: "Allegro Automaty Paczkowe DHL Słowacja", platnoscTyp: "online",
    platnoscAt: "2026-09-01T20:33:31Z", fakturaZadana: false, sumaGrosze: 1491, waluta: "EUR",
    kupionoAt: "2026-09-01T20:33:31Z", link: "https://allegro.pl", pozycje: [
      POZ_ZAM({}),
      POZ_ZAM({ offerId: "999", nazwa: "NAKRĘTKA DO KOSY SPALINOWEJ M10 x 1,25mm LEWY GWINT",
        cenaGrosze: 98, zwracana: false, wracaIlosc: 0, ofertaZdjecie: "nieznane" }),
      POZ_ZAM({ offerId: "888", nazwa: "TARCZA — Allegro nie ma zdjęcia tej oferty",
        cenaGrosze: 500, zwracana: false, wracaIlosc: 0, ofertaZdjecie: "brak" }),
    ] } };

const KANDYDACI: any = [
  { zamPozycjaId: 7, offerId: "222", ofertaZdjecie: "jest", nazwa: "Łopata", ilosc: 1,
    cenaGrosze: 2999, waluta: "EUR" },
  { zamPozycjaId: 8, offerId: "333", ofertaZdjecie: "jest", nazwa: "Grabie do liści", ilosc: 2,
    cenaGrosze: 1999, waluta: "EUR" },
];

const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={klient}><MemoryRouter>
    <div className="min-h-screen bg-slate-100 p-6 flex items-start gap-6">
      <div style={{ width: "27rem" }} className="card overflow-hidden p-3">
        <Dowody zwrot={ZWROT} />
      </div>
      <div style={{ width: "24rem" }} className="card overflow-hidden p-3">
        <Dopisz kandydaci={KANDYDACI} trwa={false} blad="" onDopisz={() => {}} />
      </div>
    </div>
  </MemoryRouter></QueryClientProvider>);
