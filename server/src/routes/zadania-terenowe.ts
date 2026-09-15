import fs from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { anulujZadanie,dodajZalacznik,listaZadan,oddajZadanie,odeslijZadanie,ponowZadanie,sciezkaZalacznika,utworzZadanie,wezZadanie,wykonajZadanie,zadanie,type PowodOdeslania,type PriorytetZadania,type RodzajZadania } from "../services/zadania-terenowe.js";
const blad=(reply:FastifyReply,e:unknown)=>reply.code(400).send({error:e instanceof Error?e.message:String(e)});
export async function zadaniaTerenoweRoutes(app:FastifyInstance){
 app.get<{Querystring:{status?:string;moje?:string}}>("/api/zadania-terenowe",async req=>{const s=sesjaZadania()!;return{zadania:listaZadan({status:req.query.status,userId:req.query.moje==="1"?s.user.userId:undefined})};});
 app.get<{Params:{id:string}}>("/api/zadania-terenowe/:id",async(req,reply)=>{const z=zadanie(Number(req.params.id));return z?{zadanie:z}:reply.code(404).send({error:"Nie znaleziono zadania"});});
 app.post<{Body:{rodzaj:RodzajZadania;tytul:string;instrukcja:string;twId?:number|null;zrodlo?:string;zrodloRef?:string|null;priorytet?:PriorytetZadania}}>("/api/zadania-terenowe",async(req,reply)=>{const s=sesjaZadania()!;if(!["biuro","admin"].includes(s.user.role))return reply.code(403).send({error:"Zadania dla magazynu tworzy biuro"});try{return{zadanie:utworzZadanie(req.body,{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string}}>("/api/zadania-terenowe/:id/wez",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:wezZadanie(Number(req.params.id),{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string};Body:{wynik?:string}}>("/api/zadania-terenowe/:id/wykonaj",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:wykonajZadanie(Number(req.params.id),req.body?.wynik??"",{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 /* ── ZDJĘCIE OD HALI (§13.3, 0.352.0) ────────────────────────────────────
    `bodyLimit` OSOBNY dla tej trasy, mimo globalnego 6 MiB: zdjęcie jedzie
    base64 w JSON, czyli rośnie o jedną trzecią, a 4 MiB ciała to ~3 MiB
    obrazu — dokładnie tyle, ile przyjmuje serwis. Limit na trasie chroni
    PROCES (kadr z 13 Mpx w pamięci taniego serwera), limit w serwisie chroni
    DYSK. To dwie różne awarie i dwa różne progi. */
 app.post<{Params:{id:string};Body:{fotoBase64?:string;opis?:string}}>("/api/zadania-terenowe/:id/zalacznik",{bodyLimit:4*1024*1024},async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:dodajZalacznik(Number(req.params.id),req.body?.fotoBase64??"",req.body?.opis,{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});

 /* Nazwa pliku niesie znacznik czasu, więc treść pod tym URL-em nie zmienia
    się nigdy — ta sama pamięć podręczna co przy zdjęciu niezgodności. */
 app.get<{Params:{id:string;zid:string}}>("/api/zadania-terenowe/:id/zalacznik/:zid",async(req,reply)=>{const plik=sciezkaZalacznika(Number(req.params.id),Number(req.params.zid));if(!plik)return reply.code(404).send({error:"Brak zdjęcia"});return reply.type("image/jpeg").header("cache-control","public, max-age=31536000, immutable").send(fs.createReadStream(plik));});

 /* ODESŁANIE I ODDANIE ROBI HALA, więc roli tu nie bramkujemy — bramką jest
    własność zadania w serwisie. Tworzenie i anulowanie zostaje przy biurze
    (niżej): zlecenie i jego odwołanie to decyzja zlecającego. */
 app.post<{Params:{id:string};Body:{powodKod?:PowodOdeslania;powod?:string|null}}>("/api/zadania-terenowe/:id/odeslij",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:odeslijZadanie(Number(req.params.id),req.body?.powodKod as PowodOdeslania,req.body?.powod??null,{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string}}>("/api/zadania-terenowe/:id/oddaj",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:oddajZadanie(Number(req.params.id),{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string};Body:{instrukcja?:string}}>("/api/zadania-terenowe/:id/ponow",async(req,reply)=>{const s=sesjaZadania()!;if(!["biuro","admin"].includes(s.user.role))return reply.code(403).send({error:"Zadanie ponawia biuro"});try{return{zadanie:ponowZadanie(Number(req.params.id),req.body?.instrukcja,{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string}}>("/api/zadania-terenowe/:id/anuluj",async(req,reply)=>{const s=sesjaZadania()!;if(!["biuro","admin"].includes(s.user.role))return reply.code(403).send({error:"Zadanie może anulować biuro"});try{return{zadanie:anulujZadanie(Number(req.params.id),{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
}
