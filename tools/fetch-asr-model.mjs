#!/usr/bin/env node
/*
 * Pobiera wagi modelu ASR (Whisper, ONNX q8) do web/public/models/<id>/ —
 * uruchom na maszynie Z INTERNETEM, potem skopiuj katalog na serwer WERTIS
 * (magazyn on-premise nie ma dostępu do huggingface.co). Aplikacja ładuje
 * wagi najpierw z własnego serwera (env.localModelPath = "models/").
 *
 *   node tools/fetch-asr-model.mjs [id-modelu] [decoder-dtype]
 *      id-modelu     : domyślnie onnx-community/whisper-tiny
 *      decoder-dtype : fp32 (domyślnie, pewny na WASM) lub q8 (lżejszy —
 *                      tylko z modelem Xenova/*, standardowy int8)
 *
 *   Enkoder zawsze fp32 (kwantyzowany nie działa w ORT-web). Musi być zgodne
 *   z VITE_ASR_DECODER_DTYPE w web/src/lib/asr.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = process.argv[2] ?? "onnx-community/whisper-tiny";
const DECODER_DTYPE = process.argv[3] ?? "fp32";
const decoderFile =
  DECODER_DTYPE === "q8" ? "onnx/decoder_model_merged_quantized.onnx" : "onnx/decoder_model_merged.onnx";
const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model.onnx",
  decoderFile,
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = path.join(root, "web", "public", "models", MODEL);

let failed = 0;
for (const f of FILES) {
  const url = `https://huggingface.co/${MODEL}/resolve/main/${f}`;
  const dest = path.join(destRoot, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  process.stdout.write(`→ ${f} … `);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (e) {
    failed++;
    console.log(`BŁĄD (${e instanceof Error ? e.message : e})`);
  }
}

if (failed) {
  console.error(`\nNie pobrano ${failed} plik(ów) — sprawdź sieć/proxy i uruchom ponownie.`);
  process.exit(1);
}
console.log(`\nGotowe: ${destRoot}`);
console.log("Skopiuj katalog web/public/models/ na serwer (lub zbuduj front z nim) — patrz DEPLOY.md.");
