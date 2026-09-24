import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import logo from "../assets/wertis-logo.png";
import { api, zapiszToken } from "../api/klient";
import { Blad, Przycisk } from "../ui";

/* Walidacja stoi w schemacie, nie w `if`-ach na submicie: przy trzech
   formularzach w panelu reguła powtórzona ręcznie rozjeżdża się przy
   pierwszej zmianie. To jest ta część wyceny z §7, za którą płacimy Zodem. */
const Schemat = z.object({
  login: z.string().trim().min(1, "Podaj login"),
  haslo: z.string().min(1, "Podaj hasło"),
});
type Dane = z.infer<typeof Schemat>;

/* Pierwsze konto (@wydanie). Do tej pory zakładał je instalator, pytając
   o hasło w oknie PowerShella na serwerze — a panel pustej instalacji
   pokazywał logowanie, na które nie było czym się zalogować. Serwer umie to
   od dawna: w pustej bazie `POST /api/users` przyjmuje pierwsze konto bez
   sesji i wymusza rolę admin (`routes/auth.ts`). Ten formularz tylko z tego
   korzysta, a regułę loginu i hasła zna serwer — tu jej nie powtarzamy
   ponad minimum, które da się powiedzieć przed wysłaniem. */
const SchematPierwszego = z.object({
  name: z.string().trim().min(1, "Podaj imię i nazwisko"),
  login: z.string().trim().min(3, "Login: co najmniej 3 znaki"),
  haslo: z.string().min(8, "Hasło: co najmniej 8 znaków"),
  powtorz: z.string(),
}).refine((d) => d.haslo === d.powtorz, { path: ["powtorz"], message: "Hasła się różnią" });
type DanePierwszego = z.infer<typeof SchematPierwszego>;

function PierwszeKonto({ zalogowano }: { zalogowano: () => void }) {
  const [blad, setBlad] = useState("");
  const { register, handleSubmit, formState } = useForm<DanePierwszego>({ resolver: zodResolver(SchematPierwszego) });
  const e = formState.errors;

  async function wyslij(d: DanePierwszego) {
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify({ name: d.name, login: d.login, haslo: d.haslo }) });
      /* Od razu zalogowany — drugi raz wpisywać tego samego nie ma po co. */
      const t = await api<{ token: string }>("/api/auth/login", {
        method: "POST", body: JSON.stringify({ login: d.login, haslo: d.haslo }),
      });
      zapiszToken(t.token);
      zalogowano();
    } catch (x) { setBlad((x as Error).message); }
  }

  const pole = (etykieta: string, nazwa: keyof DanePierwszego, typ = "text") => <>
    <label className="mb-4 block text-sm font-semibold">{etykieta}
      <input className="field mt-1" type={typ} autoFocus={nazwa === "name"} {...register(nazwa)} />
    </label>
    {e[nazwa] && <p className="mb-3 text-sm text-red-700">{e[nazwa]!.message}</p>}
  </>;

  return <form aria-label="Pierwsze konto" onSubmit={handleSubmit(wyslij)}>
    <p className="mb-5 text-sm text-slate-600">To nowa instalacja — nie ma jeszcze żadnego konta. Pierwsze
      będzie kontem administratora: zakłada wszystkie następne, także konta biura.</p>
    {pole("Imię i nazwisko", "name")}
    {pole("Login", "login")}
    {pole("Hasło", "haslo", "password")}
    {pole("Powtórz hasło", "powtorz", "password")}
    <div className="mb-4"><Blad>{blad}</Blad></div>
    <Przycisk wariant="glowny" className="w-full" disabled={formState.isSubmitting}>ZAŁÓŻ KONTO ADMINISTRATORA</Przycisk>
  </form>;
}

export function Logowanie({ zalogowano }: { zalogowano: () => void }) {
  const [blad, setBlad] = useState("");
  /* `null` = jeszcze nie wiadomo. Błąd pytania to zwykłe logowanie: serwer,
     który nie odpowiada, i tak nikogo nie wpuści. */
  const [pusta, setPusta] = useState<boolean | null>(null);
  const { register, handleSubmit, formState } = useForm<Dane>({ resolver: zodResolver(Schemat) });
  useEffect(() => {
    api<{ potrzebne: boolean }>("/api/setup").then((d) => setPusta(!!d.potrzebne), () => setPusta(false));
  }, []);

  async function wyslij(dane: Dane) {
    try {
      const d = await api<{ token: string }>("/api/auth/login", {
        method: "POST", body: JSON.stringify(dane),
      });
      zapiszToken(d.token);
      zalogowano();
    } catch (e) { setBlad((e as Error).message); }
  }

  return <main className="grid min-h-screen place-items-center bg-wertis-ink p-5">
    <div className="card w-full max-w-sm p-7">
      {/* Logo sklepu zamiast ikony i słowa (23 września 2026) — to pierwszy
          ekran, jaki widzi nowa osoba w biurze, więc ma wyglądać jak ta firma. */}
      <div className="mb-7">
        <h1 className="m-0"><img src={logo} alt="WERTIS — sklep z częściami" className="h-14 w-auto" /></h1>
        {/* „Biuro", nie „Obsługa klienta", od 0.446.0: pod tym adresem jest
            całe biuro — dostawy, kosze, wgląd i ustawienia, nie tylko skrzynka. */}
        <p className="mt-2 text-sm text-slate-500">Biuro</p>
      </div>
      {pusta ? <PierwszeKonto zalogowano={zalogowano} /> : <form aria-label="Logowanie" onSubmit={handleSubmit(wyslij)}>
      <label className="mb-4 block text-sm font-semibold">Login
        <input className="field mt-1" autoFocus {...register("login")} />
      </label>
      {formState.errors.login && <p className="mb-3 text-sm text-red-700">{formState.errors.login.message}</p>}
      <label className="mb-5 block text-sm font-semibold">Hasło
        <input className="field mt-1" type="password" {...register("haslo")} />
      </label>
      {formState.errors.haslo && <p className="mb-3 text-sm text-red-700">{formState.errors.haslo.message}</p>}
      <div className="mb-4"><Blad>{blad}</Blad></div>
      <Przycisk wariant="glowny" className="w-full" disabled={formState.isSubmitting}>ZALOGUJ</Przycisk>
      </form>}
    </div>
  </main>;
}
