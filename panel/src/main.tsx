import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClipboardList, Inbox, LogOut, Warehouse } from "lucide-react";
import { BrakSesji, token, wyczyscToken } from "./api/klient";
import { useZdrowie } from "./api/rozmowy";
import { czas } from "./ui";
import { Logowanie } from "./ekrany/Logowanie";
import { Skrzynka } from "./ekrany/Skrzynka";
import { Zadania } from "./ekrany/Zadania";
import "./index.css";

/* Jeden cache zapytań na cały panel zastępuje ręczne odświeżanie co
   piętnaście sekund. To jest ta część wyceny z `docs/obsluga-klienta.md` §7,
   za którą płacimy TanStackiem: ekrany dzielą stan zamiast każdy swój. */
const klient = new QueryClient({
  defaultOptions: {
    queries: {
      /* Sesja wygasła nie jest błędem do ponowienia — ekran ma wrócić do
         logowania. Bez tego panel próbowałby trzy razy i pokazał błąd. */
      retry: (proba, blad) => !(blad instanceof BrakSesji) && proba < 2,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

const ZAKLADKI = [
  { do: "/obsluga/", etykieta: "Zadania", ikona: <ClipboardList size={16} /> },
  { do: "/obsluga/skrzynka", etykieta: "Skrzynka", ikona: <Inbox size={16} /> },
];

/* Pigułka stanu synchronizacji jest w NAGŁÓWKU, a nie w skrzynce: agent ma
   ją widzieć z każdej zakładki. Awaria integracji, o której wie tylko jeden
   ekran, jest awarią widoczną dopiero wtedy, gdy ktoś na ten ekran wejdzie. */
function PigulkaSynchronizacji() {
  const { data } = useZdrowie();
  if (!data) return null;
  const i = data.allegroInbox;
  const zle = i.status !== "current";
  return <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
    zle ? "bg-red-500/20 text-red-100" : "bg-white/10 text-slate-300"}`}>
    <span className={`h-2 w-2 rounded-full ${zle ? "bg-red-400" : "bg-emerald-400"}`} />
    {i.alarm
      ? `Synchronizacja stanęła ${czas(i.ostatniaUdanaSynchronizacja).slice(-8, -3)}`
      : `Synchronizacja ${czas(i.ostatniaUdanaSynchronizacja).slice(-8, -3) || "—"} · ${
          i.liczbaBledow} błędów`}
  </div>;
}

function Naglowek({ wyloguj }: { wyloguj: () => void }) {
  const { pathname } = useLocation();
  const naSkrzynce = pathname.startsWith("/obsluga/skrzynka");
  return <header className="sticky top-0 z-20 border-b border-slate-200 bg-wertis-ink text-white">
    <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-5 py-3">
      <div className="rounded-lg bg-wertis-amber p-2 text-wertis-ink"><Warehouse size={22} /></div>
      <div className="mr-auto"><b>WERTIS</b>
        <span className="ml-2 text-sm text-slate-400">Obsługa klienta</span></div>
      <nav className="mr-3 flex rounded-lg bg-white/10 p-1">
        {ZAKLADKI.map((z) => {
          const aktywna = z.do.endsWith("skrzynka") ? naSkrzynce : !naSkrzynce;
          return <Link key={z.do} to={z.do}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${
              aktywna ? "bg-wertis-amber text-wertis-ink" : "text-slate-300"}`}>
            {z.ikona}{z.etykieta}</Link>;
        })}
      </nav>
      <PigulkaSynchronizacji />
      <button className="rounded-lg p-2 text-slate-400 hover:bg-white/10" onClick={wyloguj}
        title="Wyloguj" aria-label="Wyloguj"><LogOut size={20} /></button>
    </div>
  </header>;
}

function App() {
  const [zalogowany, setZalogowany] = useState(Boolean(token()));
  if (!zalogowany) return <Logowanie zalogowano={() => setZalogowany(true)} />;
  return <div className="min-h-screen">
    <Naglowek wyloguj={() => { wyczyscToken(); klient.clear(); setZalogowany(false); }} />
    <main className="mx-auto max-w-[1500px] p-5">
      <Routes>
        <Route path="/obsluga/" element={<Zadania />} />
        {/* Rozmowa ma własny adres, więc odświeżenie strony jej nie gubi,
            a link do sprawy da się wkleić koledze. */}
        <Route path="/obsluga/skrzynka" element={<Skrzynka />} />
        <Route path="/obsluga/skrzynka/:id" element={<Skrzynka />} />
        <Route path="*" element={<Navigate to="/obsluga/" replace />} />
      </Routes>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={klient}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
