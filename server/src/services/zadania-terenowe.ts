import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { dopiszZdarzenieWyniku } from "./conversations.js";

export type RodzajZadania = "pomiar" | "zdjecie" | "weryfikacja" | "inne";
export type PriorytetZadania = "normalny" | "pilny";
export interface ZadanieTerenowe {
  id: number; rodzaj: RodzajZadania; tytul: string; instrukcja: string;
  twId: number | null; symbol: string | null; nazwaTowaru: string | null; lokalizacja: string | null;
  zrodlo: string; zrodloRef: string | null; priorytet: PriorytetZadania;
  status: "nowe" | "w_toku" | "wykonane" | "anulowane";
  utworzonoAt: string; utworzonoPrzez: string; przypisanoAt: string | null;
  przypisanoPrzez: string | null; przypisanoUserId: number | null;
  wynik: string | null; wykonanoAt: string | null; wykonanoPrzez: string | null;
}
const SELECT = `SELECT z.id,z.rodzaj,z.tytul,z.instrukcja,z.tw_id AS twId,
 t.symbol,t.nazwa AS nazwaTowaru,t.lokalizacja,z.zrodlo,z.zrodlo_ref AS zrodloRef,
 z.priorytet,z.status,z.utworzono_at AS utworzonoAt,z.utworzono_przez AS utworzonoPrzez,
 z.przypisano_at AS przypisanoAt,z.przypisano_przez AS przypisanoPrzez,
 z.przypisano_user_id AS przypisanoUserId,z.wynik,z.wykonano_at AS wykonanoAt,
 z.wykonano_przez AS wykonanoPrzez FROM zadanie_terenowe z
 LEFT JOIN sgt_towar t ON t.tw_id=z.tw_id`;
const teraz=()=>new Date().toISOString();
function tekst(v:string,n:string,max:number){const t=v.trim();if(!t)throw new Error(`${n} nie może być pusty`);if(t.length>max)throw new Error(`${n} może mieć najwyżej ${max} znaków`);return t;}
export function listaZadan(opts:{status?:string;userId?:number}={}):ZadanieTerenowe[]{
 const w:string[]=[];const a:(string|number)[]=[];
 if(opts.status){w.push("z.status=?");a.push(opts.status);} if(opts.userId!==undefined){w.push("(z.przypisano_user_id IS NULL OR z.przypisano_user_id=?)");a.push(opts.userId);}
 const where=w.length?` WHERE ${w.join(" AND ")}`:"";
 return db().prepare(`${SELECT}${where} ORDER BY CASE z.priorytet WHEN 'pilny' THEN 0 ELSE 1 END, CASE z.status WHEN 'w_toku' THEN 0 WHEN 'nowe' THEN 1 ELSE 2 END,z.utworzono_at`).all(...a) as unknown as ZadanieTerenowe[];
}
export function zadanie(id:number):ZadanieTerenowe|null{return(db().prepare(`${SELECT} WHERE z.id=?`).get(id) as unknown as ZadanieTerenowe)??null;}
export function utworzZadanie(input:{rodzaj:RodzajZadania;tytul:string;instrukcja:string;twId?:number|null;zrodlo?:string;zrodloRef?:string|null;priorytet?:PriorytetZadania},autor:{id:number;name:string}){
 if(!["pomiar","zdjecie","weryfikacja","inne"].includes(input.rodzaj))throw new Error("Nieznany rodzaj zadania");
 const t=tekst(input.tytul,"Tytuł",120),i=tekst(input.instrukcja,"Instrukcja",2000),p=input.priorytet??"normalny";
 if(input.twId!=null&&!db().prepare("SELECT 1 FROM sgt_towar WHERE tw_id=?").get(input.twId))throw new Error("Nie znaleziono towaru");
 const id=Number(db().prepare(`INSERT INTO zadanie_terenowe(rodzaj,tytul,instrukcja,tw_id,zrodlo,zrodlo_ref,priorytet,utworzono_at,utworzono_przez,utworzono_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(input.rodzaj,t,i,input.twId??null,input.zrodlo??"reczne",input.zrodloRef?.trim()||null,p,teraz(),autor.name,autor.id).lastInsertRowid);
 logEvent("zadanie_terenowe_utworzone",autor.name,input.twId??null,{zadanieId:id,rodzaj:input.rodzaj});return zadanie(id)!;
}
export function wezZadanie(id:number,autor:{id:number;name:string}){
 const r=db().prepare("UPDATE zadanie_terenowe SET status='w_toku',przypisano_at=?,przypisano_przez=?,przypisano_user_id=? WHERE id=? AND status='nowe' AND przypisano_user_id IS NULL").run(teraz(),autor.name,autor.id,id);
 if(!r.changes){const z=zadanie(id);if(!z)throw new Error("Nie znaleziono zadania");throw new Error(z.status==="w_toku"?`Zadanie realizuje już ${z.przypisanoPrzez}`:"Zadanie nie czeka na realizację");}
 const z=zadanie(id)!;logEvent("zadanie_terenowe_przejete",autor.name,z.twId,{zadanieId:id});return z;
}
export function wykonajZadanie(id:number,wynik:string,autor:{id:number;name:string}){
 const w=tekst(wynik,"Wynik",4000);const r=db().prepare("UPDATE zadanie_terenowe SET status='wykonane',wynik=?,wykonano_at=?,wykonano_przez=?,wykonano_user_id=? WHERE id=? AND status='w_toku' AND przypisano_user_id=?").run(w,teraz(),autor.name,autor.id,id,autor.id);
 if(!r.changes)throw new Error("Zadanie musi być przejęte przez Ciebie przed zapisaniem wyniku");const z=zadanie(id)!;
 /* Zadanie z rozmowy oddaje wynik na jej oś (0.142.0). Zdarzenie, nie edycja
    wiadomości: treść napisana przez klienta ma zostać tym, czym była. */
 const rozmowa=db().prepare("SELECT conversation_id FROM zadanie_terenowe WHERE id=?").get(id) as {conversation_id:number|null};
 if(rozmowa?.conversation_id!=null)dopiszZdarzenieWyniku(rozmowa.conversation_id,id,w);
 logEvent("zadanie_terenowe_wykonane",autor.name,z.twId,{zadanieId:id});return z;
}
export function anulujZadanie(id:number,autor:{id:number;name:string}){const r=db().prepare("UPDATE zadanie_terenowe SET status='anulowane',anulowano_at=?,anulowano_przez=? WHERE id=? AND status IN ('nowe','w_toku')").run(teraz(),autor.name,id);if(!r.changes)throw new Error("Zadania nie można anulować");const z=zadanie(id)!;logEvent("zadanie_terenowe_anulowane",autor.name,z.twId,{zadanieId:id});return z;}
