import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Rola } from "../services/users.js";
process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"wertis-zadania-")),"t.db");
process.env.LOG_LEVEL="silent";process.env.SGT_MODE="seeded";
let app:FastifyInstance;let db:typeof import("../db/db.js").db;let createUser:typeof import("../services/users.js").createUser;
before(async()=>{({db}=await import("../db/db.js"));({createUser}=await import("../services/users.js"));const m=await import("../index.js");app=await m.buildApp();});
beforeEach(()=>{const d=db();for(const t of ["zadanie_terenowe","events","device_session","app_user","sgt_towar"])d.prepare(`DELETE FROM ${t}`).run();d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,lokalizacja) VALUES(?,?,?,?)").run(77,"USZ-LON","Uszczelki Loncin","A01-02-03");});
function login(role:Rola,name:string){const u=createUser(name,role,`${role}${Math.random()}`,"tajnehaslo");const token=`t-${u.userId}`;const n=new Date().toISOString();db().prepare("INSERT INTO device_session(token,user_id,created_at,last_seen) VALUES(?,?,?,?)").run(token,u.userId,n,n);return{"x-session":token};}
test("biuro zleca pomiar, jeden magazynier przejmuje i oddaje wynik",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek"),drugi=login("magazynier","Ola");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Zmierz rozstaw otworów",instrukcja:"Od środka do środka, w mm.",twId:77,priorytet:"pilny",zrodlo:"allegro",zrodloRef:"thread-1"}});assert.equal(r.statusCode,200,r.body);const id=r.json().zadanie.id;assert.equal(r.json().zadanie.symbol,"USZ-LON");r=await app.inject({method:"GET",url:"/api/zadania-terenowe?moje=1",headers:m});assert.equal(r.json().zadania.length,1);r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wez`,headers:m});assert.equal(r.json().zadanie.przypisanoPrzez,"Marek");r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wez`,headers:drugi});assert.equal(r.statusCode,400);r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wykonaj`,headers:m,payload:{wynik:"46 mm od środka do środka."}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().zadanie.status,"wykonane");assert.equal(r.json().zadanie.wynik,"46 mm od środka do środka.");const e=db().prepare("SELECT type FROM events WHERE type LIKE 'zadanie_terenowe_%' ORDER BY id").all() as Array<{type:string}>;assert.deepEqual(e.map(x=>x.type),["zadanie_terenowe_utworzone","zadanie_terenowe_przejete","zadanie_terenowe_wykonane"]);});
test("magazynier nie tworzy ani nie anuluje zadania",async()=>{const m=login("magazynier","Marek");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:m,payload:{rodzaj:"pomiar",tytul:"X",instrukcja:"Y"}});assert.equal(r.statusCode,403);r=await app.inject({method:"POST",url:"/api/zadania-terenowe/123/anuluj",headers:m});assert.equal(r.statusCode,403);});

/* ── ODESŁANIE Z HALI (0.352.0) ──────────────────────────────────────────────
   Projekt panelu §13.3 wymienia „odrzuca z powodem", „oznacza brak towaru"
   i „oznacza brak możliwości wykonania" od pierwszej wersji, a kod do 0.351.0
   nie miał żadnej z tych trzech dróg. Te testy pilnują CAŁEJ pętli, bo sama
   trasa bez odpowiedzi biura zostawiłaby zadanie w nowej ślepej uliczce. */
test("hala odsyła zadanie z powodem, biuro zleca je ponownie",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Zmierz wałek",instrukcja:"W mm.",twId:77}});const id=r.json().zadanie.id;
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wez`,headers:m});assert.equal(r.statusCode,200,r.body);
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/odeslij`,headers:m,payload:{powodKod:"brak_towaru",powod:"Półka A01-02-03 pusta, w buforze też nie ma."}});assert.equal(r.statusCode,200,r.body);
 assert.equal(r.json().zadanie.status,"odeslane");assert.equal(r.json().zadanie.powodKod,"brak_towaru");assert.equal(r.json().zadanie.odeslanoPrzez,"Marek");
 assert.equal(r.json().zadanie.wynik,null,"odesłanie NIE JEST wynikiem — o to cała ta wersja");
 /* Biuro poprawia zlecenie i puszcza je jeszcze raz: przypisanie i powód
    schodzą, bo zadanie znowu czeka na kogokolwiek. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/ponow`,headers:b,payload:{instrukcja:"Wałek leży w kartonie przy rampie, nie na półce."}});assert.equal(r.statusCode,200,r.body);
 assert.equal(r.json().zadanie.status,"nowe");assert.equal(r.json().zadanie.powodKod,null);assert.equal(r.json().zadanie.przypisanoPrzez,null);
 assert.match(r.json().zadanie.instrukcja,/rampie/);
 const e=db().prepare("SELECT type FROM events WHERE type LIKE 'zadanie_terenowe_%' ORDER BY id").all() as Array<{type:string}>;
 assert.deepEqual(e.map(x=>x.type),["zadanie_terenowe_utworzone","zadanie_terenowe_przejete","zadanie_terenowe_odeslane","zadanie_terenowe_ponowione"],"ślad odesłania ZOSTAJE po ponowieniu — inaczej nie da się policzyć, ile razy hala odsyłała to samo");});

test("odesłać cudze zadanie w toku nie można, ale nieprzejęte owszem",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek"),drugi=login("magazynier","Ola");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"weryfikacja",tytul:"Sprawdź oznaczenie",instrukcja:"Odczytaj tabliczkę."}});const id=r.json().zadanie.id;
 /* Bez przejmowania: magazynier, który WIE, że się nie da, nie musi najpierw
    brać zadania tylko po to, żeby je oddać. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/odeslij`,headers:m,payload:{powodKod:"nie_da_sie"}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().zadanie.powod,null,"treść jest opcjonalna — kciuk w rękawicy nie pisze zdań");
 r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Drugie",instrukcja:"Y"}});const drugieId=r.json().zadanie.id;
 await app.inject({method:"POST",url:`/api/zadania-terenowe/${drugieId}/wez`,headers:m});
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${drugieId}/odeslij`,headers:drugi,payload:{powodKod:"nie_da_sie"}});assert.equal(r.statusCode,400,"cudzego zadania w toku nie zamyka się zza pleców");
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${drugieId}/odeslij`,headers:m,payload:{powodKod:"zły_kod"}});assert.equal(r.statusCode,400,"kod powodu jest zamkniętą listą");});

test("magazynier oddaje własne zadanie do puli, cudzego nie rusza",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek"),drugi=login("magazynier","Ola");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Zmierz",instrukcja:"Y"}});const id=r.json().zadanie.id;
 await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wez`,headers:m});
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/oddaj`,headers:drugi});assert.equal(r.statusCode,400);
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/oddaj`,headers:m});assert.equal(r.statusCode,200,r.body);
 assert.equal(r.json().zadanie.status,"nowe");assert.equal(r.json().zadanie.przypisanoPrzez,null,"zadanie po zmianie ma znowu czekać na KOGOKOLWIEK");
 /* Dowód, że to nie jest kosmetyka: przed 0.352.0 zadanie zostawało przypięte
    do konta Marka, a kolektor Oli filtruje po `przypisano_user_id`. */
 r=await app.inject({method:"GET",url:"/api/zadania-terenowe?moje=1",headers:drugi});assert.equal(r.json().zadania.length,1,"po oddaniu zadanie widzi już inny magazynier");});

test("ponowić wolno tylko odesłane, i tylko biuru",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek");let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Zmierz",instrukcja:"Y"}});const id=r.json().zadanie.id;
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/ponow`,headers:b});assert.equal(r.statusCode,400,"zadanie nowe nie jest odesłane");
 await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/odeslij`,headers:m,payload:{powodKod:"brak_towaru"}});
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/ponow`,headers:m});assert.equal(r.statusCode,403,"ponowienie to decyzja zlecającego");
 /* Druga odpowiedź biura na odesłanie: anulowanie. Do 0.351.0 lista statusów
    w `anulujZadanie` nie znała `odeslane`, więc zadanie odesłane nie miało
    żadnego wyjścia poza ponowieniem. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/anuluj`,headers:b});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().zadanie.status,"anulowane");});

/* ── Wiek zlecenia liczy SERWER (0.352.0) ────────────────────────────────────
   Kolektor to urządzenie z własnym zegarem, który bywa przestawiony; wiek
   policzony na nim wyglądałby na fakt, nie będąc nim. To ta sama decyzja co
   przy `czekaOdMs` w kolejce rozmów.                                        */
test("zadanie otwarte niesie wiek zlecenia, zamknięte nie niesie żadnego",async()=>{const b=login("biuro","Anna"),m=login("magazynier","Marek");
 let r=await app.inject({method:"POST",url:"/api/zadania-terenowe",headers:b,payload:{rodzaj:"pomiar",tytul:"Zmierz",instrukcja:"Y"}});const id=r.json().zadanie.id;
 /* Zadanie sprzed trzech dni — znacznik podstawiamy, bo inaczej test mierzyłby
    czas własnego przebiegu. Wartość bierzemy z zegara testu, nie z zaszytej
    daty: raport z oknem czasowym nie ma prawa znać konkretnej daty. */
 const trzyDniTemu=new Date(Date.now()-3*24*3600_000).toISOString();
 db().prepare("UPDATE zadanie_terenowe SET utworzono_at=? WHERE id=?").run(trzyDniTemu,id);

 r=await app.inject({method:"GET",url:"/api/zadania-terenowe",headers:b});
 const z=r.json().zadania.find((x:{id:number})=>x.id===id);
 assert.ok(z.zleconeOdMs>=3*24*3600_000-5000&&z.zleconeOdMs<3*24*3600_000+60_000,`zleconeOdMs=${z.zleconeOdMs}`);

 /* Przejęcie NIE ZERUJE zegara: pytanie brzmi „jak dawno biuro poprosiło",
    a przejęcie przez halę na to nie odpowiada. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/wez`,headers:m});
 assert.ok(r.json().zadanie.zleconeOdMs>=3*24*3600_000-5000,"przejęcie nie zeruje wieku zlecenia");

 /* Odesłanie też nie — wtedy dług przechodzi na biuro, ale zlecenie jest
    dalej tak samo stare. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/odeslij`,headers:m,payload:{powodKod:"brak_towaru"}});
 assert.ok(r.json().zadanie.zleconeOdMs>=3*24*3600_000-5000);

 /* Zamknięte milczy: „zlecone 9 dni temu" przy wyniku sprzed tygodnia
    mierzyłoby wiek historii, a nie zaległość. */
 r=await app.inject({method:"POST",url:`/api/zadania-terenowe/${id}/anuluj`,headers:b});
 assert.equal(r.json().zadanie.zleconeOdMs,null);});
