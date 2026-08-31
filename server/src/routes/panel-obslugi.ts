import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
const tutaj=path.dirname(fileURLToPath(import.meta.url));
function katalog(){const kandydaci=[path.join(tutaj,"../web/obsluga"),path.join(tutaj,"../../../panel/dist"),path.join(process.cwd(),"../panel/dist"),path.join(process.cwd(),"panel/dist")];return kandydaci.find(p=>fs.existsSync(path.join(p,"index.html")))??null;}
const MIME:Record<string,string>={".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};
/** Osobny frontend ma własny build, ale nadal serwuje go ten sam proces i origin. */
export async function panelObslugiRoutes(app:FastifyInstance){const dir=katalog();app.get("/obsluga",async(_req,reply)=>reply.redirect("/obsluga/"));app.get("/obsluga/",async(_req,reply)=>{if(!dir)return reply.code(503).type("text/plain; charset=utf-8").send("Panel nie został zbudowany — uruchom npm run build");return reply.type("text/html; charset=utf-8").send(fs.readFileSync(path.join(dir,"index.html")));});app.get<{Params:{file:string}}>("/obsluga/assets/:file",async(req,reply)=>{if(!dir||!/^[-.\w]+$/.test(req.params.file))return reply.code(404).send();const file=path.join(dir,"assets",req.params.file);if(!fs.existsSync(file))return reply.code(404).send();return reply.type(MIME[path.extname(file)]??"application/octet-stream").header("cache-control","public,max-age=31536000,immutable").send(fs.readFileSync(file));});}
