import { test } from "node:test";
import assert from "node:assert/strict";
import type { WynikSondyZalacznika } from "../adapters/allegro.http.js";
import { tabelaSondy, werdyktSondy } from "./sonda-zalacznik.js";

const w = (n: Partial<WynikSondyZalacznika>): WynikSondyZalacznika => ({
  droga: "api", akcept: "application/vnd.allegro.public.v1+json", status: 200, typ: "image/jpeg",
  bajtow: 123_456, przekierowany: false, hostKoncowy: "api.allegro.pl", blad: null, ...n,
});

test("tabela sondy nie wypuszcza adresów, hostów bez przekierowania ani identyfikatora", () => {
  const t = tabelaSondy([
    w({}), w({ akcept: "application/vnd.allegro.beta.v1+json", status: 406, typ: null, bajtow: null }),
    w({ droga: "url", akcept: null, status: 403, typ: "application/json", bajtow: null,
      hostKoncowy: "upload.allegro.pl" }),
    w({ droga: "url", akcept: null, status: null, blad: "fetch failed: timeout", typ: null, bajtow: null, hostKoncowy: null }),
  ]);
  assert.match(t, /\| końcówka API \| public\.v1 \| 200 \| image\/jpeg \| 123456 \| nie \|/);
  assert.match(t, /\| końcówka API \| beta\.v1 \| 406 \| — \| — \| nie \|/);
  assert.match(t, /\| zapisany adres \| bez Accept \| 403 \| application\/json \| — \| nie \|/);
  assert.match(t, /błąd: fetch failed: timeout/);
  assert.equal(/https?:\/\/|allegro\.pl|[0-9a-f]{8}-[0-9a-f]{4}/.test(t), false, "ani adresu, ani hosta, ani UUID");
});

test("host końcowy pokazuje się WYŁĄCZNIE przy przekierowaniu — to odpowiedź o Bearerze", () => {
  const t = tabelaSondy([w({ droga: "url", akcept: null, status: 403, przekierowany: true, hostKoncowy: "cdn.example" })]);
  assert.match(t, /tak → cdn\.example/);
});

test("werdykt: API zdejmuje znacznik, sam zapas go zostawia, wszystko 403 mówi o uprawnieniu", () => {
  assert.match(werdyktSondy([w({})]), /Droga API działa \(public\.v1, image\/jpeg\).*zdejmij `\[WERYFIKUJ\]`/);
  assert.match(werdyktSondy([w({ status: 403 }), w({ droga: "url", akcept: null })]), /WYŁĄCZNIE zapisany adres/);
  assert.match(werdyktSondy([w({ status: 403 }), w({ droga: "url", akcept: null, status: 403 })]), /allegro:api:messaging/);
  /* Kontrolna próba API bez Accept z 200 nie liczy się jako droga API — panel jej nie używa. */
  assert.match(werdyktSondy([w({ status: 404 }), w({ akcept: null, status: 200 })]), /Żadna droga/);
});
