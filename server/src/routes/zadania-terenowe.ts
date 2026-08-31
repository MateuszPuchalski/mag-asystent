import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { anulujZadanie,listaZadan,utworzZadanie,wezZadanie,wykonajZadanie,zadanie,type PriorytetZadania,type RodzajZadania } from "../services/zadania-terenowe.js";
const blad=(reply:FastifyReply,e:unknown)=>reply.code(400).send({error:e instanceof Error?e.message:String(e)});
export async function zadaniaTerenoweRoutes(app:FastifyInstance){
 app.get<{Querystring:{status?:string;moje?:string}}>("/api/zadania-terenowe",async req=>{const s=sesjaZadania()!;return{zadania:listaZadan({status:req.query.status,userId:req.query.moje==="1"?s.user.userId:undefined})};});
 app.get<{Params:{id:string}}>("/api/zadania-terenowe/:id",async(req,reply)=>{const z=zadanie(Number(req.params.id));return z?{zadanie:z}:reply.code(404).send({error:"Nie znaleziono zadania"});});
 app.post<{Body:{rodzaj:RodzajZadania;tytul:string;instrukcja:string;twId?:number|null;zrodlo?:string;zrodloRef?:string|null;priorytet?:PriorytetZadania}}>("/api/zadania-terenowe",async(req,reply)=>{const s=sesjaZadania()!;if(!["biuro","admin"].includes(s.user.role))return reply.code(403).send({error:"Zadania dla magazynu tworzy biuro"});try{return{zadanie:utworzZadanie(req.body,{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string}}>("/api/zadania-terenowe/:id/wez",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:wezZadanie(Number(req.params.id),{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string};Body:{wynik?:string}}>("/api/zadania-terenowe/:id/wykonaj",async(req,reply)=>{const s=sesjaZadania()!;try{return{zadanie:wykonajZadanie(Number(req.params.id),req.body?.wynik??"",{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
 app.post<{Params:{id:string}}>("/api/zadania-terenowe/:id/anuluj",async(req,reply)=>{const s=sesjaZadania()!;if(!["biuro","admin"].includes(s.user.role))return reply.code(403).send({error:"Zadanie może anulować biuro"});try{return{zadanie:anulujZadanie(Number(req.params.id),{id:s.user.userId,name:s.user.name})};}catch(e){return blad(reply,e);}});
}
