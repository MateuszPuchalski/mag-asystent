import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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

export function Logowanie({ zalogowano }: { zalogowano: () => void }) {
  const [blad, setBlad] = useState("");
  const { register, handleSubmit, formState } = useForm<Dane>({ resolver: zodResolver(Schemat) });

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
    <form onSubmit={handleSubmit(wyslij)} className="card w-full max-w-sm p-7">
      <div className="mb-7">
        <img src="/biuro/wertis-logo.png" width={1600} height={672} alt="WERTIS — sklep z częściami" className="mx-auto mb-5 h-auto w-56 max-w-full" />
        <h1 className="text-tytul font-bold">Obsługa klienta</h1>
        <p className="mt-2 text-sm text-slate-500">Zaloguj się kontem WERTIS, aby rozpocząć pracę.</p>
      </div>
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
    </form>
  </main>;
}
