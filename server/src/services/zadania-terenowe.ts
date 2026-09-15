import { db } from "../db/db.js";
import { logEvent } from "./events.js";
import { dopiszZdarzenieOdeslania, dopiszZdarzenieWyniku, ustawStatus } from "./conversations.js";
import { sciezkaZdjecia, zapiszZdjecie } from "./foto.js";

export type RodzajZadania = "pomiar" | "zdjecie" | "weryfikacja" | "inne";
export type PriorytetZadania = "normalny" | "pilny";
/**
 * Powód odesłania zadania z hali do biura (0.352.0).
 *
 * DWA kody, nie pięć. Biuro reaguje na nie inaczej: przy `brak_towaru` idzie
 * do Subiekta albo do dostawcy, przy `nie_da_sie` przeformułowuje zlecenie.
 * Trzeci kod musiałby nazwać trzecią reakcję biura — a takiej nie ma, więc
 * byłby wyłącznie kolejnym kaflem do przeczytania w rękawicy.
 */
export const POWODY_ODESLANIA = ["brak_towaru", "nie_da_sie"] as const;
export type PowodOdeslania = (typeof POWODY_ODESLANIA)[number];
export interface ZadanieTerenowe {
  id: number; rodzaj: RodzajZadania; tytul: string; instrukcja: string;
  twId: number | null; symbol: string | null; nazwaTowaru: string | null; lokalizacja: string | null;
  zrodlo: string; zrodloRef: string | null; priorytet: PriorytetZadania;
  status: "nowe" | "w_toku" | "wykonane" | "anulowane";
  utworzonoAt: string; utworzonoPrzez: string; przypisanoAt: string | null;
  przypisanoPrzez: string | null; przypisanoUserId: number | null;
  wynik: string | null; wykonanoAt: string | null; wykonanoPrzez: string | null;
 odeslanoAt: string | null; odeslanoPrzez: string | null;
 powodKod: PowodOdeslania | null; powod: string | null;
 /**
  * Ile milisekund minęło od ZLECENIA — `null` przy zadaniu zamkniętym.
  *
  * Liczy SERWER, nie ekran, i to jest ta sama decyzja co przy `czekaOdMs`
  * w kolejce rozmów. Kolektor to urządzenie z własnym zegarem, który bywa
  * przestawiony; „zlecone 4 dni temu" policzone na takim zegarze byłoby
  * gorsze niż brak liczby, bo wygląda na fakt.
  *
  * Mierzy od `utworzono_at` w KAŻDYM stanie otwartym — także w `w_toku`
  * i `odeslane`. Pytanie brzmi „jak dawno biuro poprosiło", a na nie
  * odpowiedź nie zmienia się przez to, że ktoś zadanie przejął. Blizna
  * 0.251.0 mówi o czym innym: tam zegar nazywał się „czeka" i kłamał przy
  * statusie, w którym nikt nie czekał. Tu nazwa jest „zlecone ... temu"
  * i jest prawdziwa zawsze.
  */
 zleconeOdMs: number | null;
 /** Zdjęcia od hali — bez treści plików, sama lista (§13.3). */
 zalaczniki: ZalacznikZadania[];
}

export interface ZalacznikZadania {
 id: number; opis: string | null; at: string; przez: string;
}
const SELECT = `SELECT z.id,z.rodzaj,z.tytul,z.instrukcja,z.tw_id AS twId,
 t.symbol,t.nazwa AS nazwaTowaru,t.lokalizacja,z.zrodlo,z.zrodlo_ref AS zrodloRef,
 z.priorytet,z.status,z.utworzono_at AS utworzonoAt,z.utworzono_przez AS utworzonoPrzez,
 z.przypisano_at AS przypisanoAt,z.przypisano_przez AS przypisanoPrzez,
 z.przypisano_user_id AS przypisanoUserId,z.wynik,z.wykonano_at AS wykonanoAt,
 z.wykonano_przez AS wykonanoPrzez,z.odeslano_at AS odeslanoAt,
 z.odeslano_przez AS odeslanoPrzez,z.powod_kod AS powodKod,z.powod FROM zadanie_terenowe z
 LEFT JOIN sgt_towar t ON t.tw_id=z.tw_id`;
const teraz=()=>new Date().toISOString();
/* Zadanie zamknięte nie ma zegara: „zlecone 9 dni temu" przy wyniku sprzed
   tygodnia mierzyłoby wiek historii, a nie zaległość. */
const OTWARTE=new Set(["nowe","w_toku","odeslane"]);
function zalacznikiDla(ids:number[]):Map<number,ZalacznikZadania[]>{
 const out=new Map<number,ZalacznikZadania[]>();
 if(!ids.length)return out;
 const q=ids.map(()=>"?").join(",");
 for(const r of db().prepare(`SELECT id,zadanie_id AS zadanieId,opis,at,przez FROM zadanie_zalacznik WHERE zadanie_id IN (${q}) ORDER BY id`).all(...ids) as Array<{id:number;zadanieId:number;opis:string|null;at:string;przez:string}>){
  out.set(Number(r.zadanieId),[...(out.get(Number(r.zadanieId))??[]),{id:Number(r.id),opis:r.opis,at:String(r.at),przez:String(r.przez)}]);
 }
 return out;
}
const zZegarem=(z:ZadanieTerenowe,chwila:number,zal:ZalacznikZadania[]=[]):ZadanieTerenowe=>({...z,
 zleconeOdMs:OTWARTE.has(z.status)?Math.max(0,chwila-Date.parse(z.utworzonoAt)):null,zalaczniki:zal});
function tekst(v:string,n:string,max:number){const t=v.trim();if(!t)throw new Error(`${n} nie może być pusty`);if(t.length>max)throw new Error(`${n} może mieć najwyżej ${max} znaków`);return t;}
export function listaZadan(opts:{status?:string;userId?:number}={}):ZadanieTerenowe[]{
 const w:string[]=[];const a:(string|number)[]=[];
 if(opts.status){w.push("z.status=?");a.push(opts.status);} if(opts.userId!==undefined){w.push("(z.przypisano_user_id IS NULL OR z.przypisano_user_id=?)");a.push(opts.userId);}
 const where=w.length?` WHERE ${w.join(" AND ")}`:"";
 const chwila=Date.now();
 const wiersze=(db().prepare(`${SELECT}${where} ORDER BY CASE z.priorytet WHEN 'pilny' THEN 0 ELSE 1 END, CASE z.status WHEN 'odeslane' THEN 0 WHEN 'w_toku' THEN 1 WHEN 'nowe' THEN 2 ELSE 3 END,z.utworzono_at`).all(...a) as unknown as ZadanieTerenowe[]);
 const zal=zalacznikiDla(wiersze.map((z)=>z.id));
 return wiersze.map((z)=>zZegarem(z,chwila,zal.get(z.id)??[]));
}
export function zadanie(id:number):ZadanieTerenowe|null{const z=db().prepare(`${SELECT} WHERE z.id=?`).get(id) as unknown as ZadanieTerenowe|undefined;return z?zZegarem(z,Date.now(),zalacznikiDla([z.id]).get(z.id)??[]):null;}
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
export function anulujZadanie(id:number,autor:{id:number;name:string}){const r=db().prepare("UPDATE zadanie_terenowe SET status='anulowane',anulowano_at=?,anulowano_przez=? WHERE id=? AND status IN ('nowe','w_toku','odeslane')").run(teraz(),autor.name,id);if(!r.changes)throw new Error("Zadania nie można anulować");const z=zadanie(id)!;logEvent("zadanie_terenowe_anulowane",autor.name,z.twId,{zadanieId:id});return z;}

/**
 * Hala ODSYŁA zadanie do biura — projekt panelu §13.3 (0.352.0).
 *
 * Do 0.351.0 jedynym wyjściem z zadania był wynik, więc magazynier przed pustą
 * półką albo wpisywał brak JAKO WYNIK i zadanie szło do biura oznaczone jako
 * wykonane, albo zostawiał je w `w_toku`, gdzie nie widział go już nikt.
 * Pierwsze kłamie w metryce „czas realizacji zadania magazynowego" (§22),
 * drugie kłamie ciszą.
 *
 * Wolno z `nowe` (nie przejmuję, bo wiem, że się nie da) i z WŁASNEGO
 * `w_toku`. Cudzego `w_toku` odesłać nie można — ta sama bramka własności co
 * przy wyniku, bo inaczej dałoby się zamknąć komuś zadanie zza pleców.
 *
 * Treść jest OPCJONALNA, kod obowiązkowy. Wymóg pisania na kolektorze
 * kosztowałby dokładnie to, przed czym broni dekalog ergonomii: kciuk
 * w rękawicy i klawiatura ekranowa nad pustą półką. Kod biuro rozstrzyga
 * maszynowo, a szczegół dostaje wtedy, gdy hala miała go pod ręką.
 */
export function odeslijZadanie(id:number,powodKod:PowodOdeslania,powod:string|null,autor:{id:number;name:string}){
 if(!POWODY_ODESLANIA.includes(powodKod))throw new Error("Nieznany powód odesłania");
 const tresc=powod?.trim()||null;
 if(tresc&&tresc.length>2000)throw new Error("Powód może mieć najwyżej 2000 znaków");
 const r=db().prepare("UPDATE zadanie_terenowe SET status='odeslane',odeslano_at=?,odeslano_przez=?,odeslano_user_id=?,powod_kod=?,powod=? WHERE id=? AND (status='nowe' OR (status='w_toku' AND przypisano_user_id=?))").run(teraz(),autor.name,autor.id,powodKod,tresc,id,autor.id);
 if(!r.changes){const z=zadanie(id);if(!z)throw new Error("Nie znaleziono zadania");throw new Error(z.status==="w_toku"?`Zadanie realizuje ${z.przypisanoPrzez} i tylko ta osoba może je odesłać`:"Zadanie nie czeka na realizację");}
 const z=zadanie(id)!;
 /* Rozmowa czekająca na halę MA SIĘ DOWIEDZIEĆ, że nie doczeka (0.352.0).
    Bez tego wpisu `waiting_for_internal` trzymałby ją do ręcznego kliknięcia,
    a agent czekałby na pomiar, którego nikt nie zrobi. */
 const rozmowa=db().prepare("SELECT conversation_id FROM zadanie_terenowe WHERE id=?").get(id) as {conversation_id:number|null};
 if(rozmowa?.conversation_id!=null)dopiszZdarzenieOdeslania(rozmowa.conversation_id,id,powodKod,tresc);
 logEvent("zadanie_terenowe_odeslane",autor.name,z.twId,{zadanieId:id,powodKod});return z;
}

/**
 * Magazynier ODDAJE zadanie z powrotem do puli (0.352.0).
 *
 * To NIE jest odesłanie: nie ma werdyktu, nie ma powodu i biuro nie ma tu nic
 * do zrobienia. Zadanie wraca na `nowe` i weźmie je ktokolwiek inny.
 *
 * Istnieje, bo `wezZadanie` przypina zadanie do konta na zawsze. Magazynier,
 * który wziął pomiar i skończył zmianę, zostawiał je w `w_toku` do końca
 * świata: kolektory innych osób filtrują `przypisano_user_id`, a skasować je
 * mogło wyłącznie biuro — o ile w ogóle zauważyło. Bez tej drogi „odeślij"
 * stałoby się protezą oddania i zaśmieciło biuru skrzynkę powodami, które
 * powodami nie są.
 */
export function oddajZadanie(id:number,autor:{id:number;name:string}){
 const r=db().prepare("UPDATE zadanie_terenowe SET status='nowe',przypisano_at=NULL,przypisano_przez=NULL,przypisano_user_id=NULL WHERE id=? AND status='w_toku' AND przypisano_user_id=?").run(id,autor.id);
 if(!r.changes){const z=zadanie(id);if(!z)throw new Error("Nie znaleziono zadania");throw new Error("Oddać można wyłącznie zadanie, które sam(a) przejąłeś/przejęłaś");}
 const z=zadanie(id)!;logEvent("zadanie_terenowe_oddane",autor.name,z.twId,{zadanieId:id});return z;
}

/**
 * Biuro ZLECA ODESŁANE ZADANIE PONOWNIE (0.352.0).
 *
 * Druga z dwóch odpowiedzi biura na odesłanie; pierwszą jest `anulujZadanie`.
 * Zadanie wraca na `nowe` z czystym przypisaniem, a ślad odesłania ZOSTAJE
 * w księdze zdarzeń — inaczej „ile razy hala odesłała ten pomiar" nie miałoby
 * gdzie się policzyć, a to jest pytanie o jakość zleceń biura, nie hali.
 *
 * Instrukcję wolno poprawić przy okazji, bo najczęstszą reakcją na
 * `nie_da_sie` jest przeformułowanie zlecenia. Zmuszanie do zakładania
 * drugiego zadania zrywałoby powiązanie z rozmową.
 */
/**
 * Zdjęcie od hali przy zadaniu — projekt panelu §13.3 (0.352.0).
 *
 * Są pytania, na które tekst nie odpowiada: „czy to ta sama wtyczka", „co jest
 * na tabliczce", „jak wygląda pęknięcie". Do 0.351.0 agent przepisywał opis ze
 * słów magazyniera i wysyłał go kupującemu jako WŁASNE ustalenie — a przy
 * sporze nie miał się o co oprzeć.
 *
 * Bramka własności ta sama co przy odesłaniu: `nowe` albo WŁASNE `w_toku`.
 * Zamknięte odpada świadomie — dowód dokładany do zadania rozliczonego tydzień
 * temu nie jest odpowiedzią, tylko dopiskiem do cudzej pracy.
 *
 * LIMIT JEST TUTAJ, nie tylko na trasie. Kolektor koduje kadr do ~200 KB, ale
 * limit ciała żądania chroni proces, a nie dysk: aparat zacięty na serii
 * zapełniłby `data/photos` w godzinę, a objawu nie widać nigdzie, dopóki nie
 * padnie zapis bazy.
 */
const ZALACZNIK_MAX_KB=3072;
export function dodajZalacznik(id:number,fotoBase64:string,opis:string|undefined,autor:{id:number;name:string}){
 const z=zadanie(id);if(!z)throw new Error("Nie znaleziono zadania");
 if(!(z.status==="nowe"||(z.status==="w_toku"&&z.przypisanoUserId===autor.id)))throw new Error("Zdjęcie dokłada się do zadania czekającego albo przejętego przez Ciebie");
 const czysty=(fotoBase64??"").replace(/^data:image\/\w+;base64,/,"").trim();
 if(!czysty)throw new Error("Zdjęcie jest puste");
 /* Rozmiar liczymy z DŁUGOŚCI base64, przed dekodowaniem: bufor powstaje
    dopiero po sprawdzeniu, więc zdjęcie ponad limit nie zajmuje pamięci. */
 if(Math.round(czysty.length*3/4/1024)>ZALACZNIK_MAX_KB)throw new Error(`Zdjęcie może mieć najwyżej ${ZALACZNIK_MAX_KB} kB`);
 const podpis=opis?.trim()||null;
 if(podpis&&podpis.length>500)throw new Error("Podpis może mieć najwyżej 500 znaków");
 const ref=zapiszZdjecie(czysty,"z");
 const zalId=Number(db().prepare("INSERT INTO zadanie_zalacznik(zadanie_id,foto_ref,opis,at,przez,przez_user_id) VALUES(?,?,?,?,?,?)").run(id,ref,podpis,teraz(),autor.name,autor.id).lastInsertRowid);
 logEvent("zadanie_terenowe_zalacznik",autor.name,z.twId,{zadanieId:id,zalacznikId:zalId});
 return zadanie(id)!;
}

/** Ścieżka pliku załącznika — `null`, gdy wiersz albo plik nie istnieje. */
export function sciezkaZalacznika(zadanieId:number,zalacznikId:number):string|null{
 const r=db().prepare("SELECT foto_ref FROM zadanie_zalacznik WHERE id=? AND zadanie_id=?").get(zalacznikId,zadanieId) as {foto_ref:string}|undefined;
 return r?sciezkaZdjecia(r.foto_ref):null;
}

export function ponowZadanie(id:number,instrukcja:string|undefined,autor:{id:number;name:string}){
 const nowa=instrukcja===undefined?null:tekst(instrukcja,"Instrukcja",2000);
 const r=db().prepare(`UPDATE zadanie_terenowe SET status='nowe',przypisano_at=NULL,przypisano_przez=NULL,przypisano_user_id=NULL,odeslano_at=NULL,odeslano_przez=NULL,odeslano_user_id=NULL,powod_kod=NULL,powod=NULL,instrukcja=COALESCE(?,instrukcja) WHERE id=? AND status='odeslane'`).run(nowa,id);
 if(!r.changes){const z=zadanie(id);if(!z)throw new Error("Nie znaleziono zadania");throw new Error("Ponowić można wyłącznie zadanie odesłane przez halę");}
 const z=zadanie(id)!;
 /* Rozmowa ZNOWU czeka na halę — symetrycznie do `zlecPomiar` (0.159.0).
    Bez tego odesłanie zdejmowało `waiting_for_internal` (słusznie: hala
    odpowiedziała), a ponowienie zostawiało rozmowę jako `open`, czyli
    z ruchem po stronie agenta — który nie ma co napisać, bo czeka na pomiar. */
 const rozmowa=db().prepare("SELECT conversation_id FROM zadanie_terenowe WHERE id=?").get(id) as {conversation_id:number|null};
 if(rozmowa?.conversation_id!=null)ustawStatus(db(),rozmowa.conversation_id,"waiting_for_internal",autor.id,null);
 logEvent("zadanie_terenowe_ponowione",autor.name,z.twId,{zadanieId:id});return z;
}
