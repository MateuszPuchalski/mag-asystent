import "./config.js";
import { sellasistSettings } from "./adapters/sellasist-wms.js";
import { syncSellasist } from "./services/wms-sellasist.js";

const settings = sellasistSettings();
if (!settings)
  throw new Error(
    "Integracja jest wyłączona. Skonfiguruj WMS_SELLASIST według docs/wms.md",
  );
const result = await syncSellasist(settings);
console.log(JSON.stringify(result, null, 2));
if ("error" in result && (result.error||result.errors||result.held)) process.exitCode = 1;
