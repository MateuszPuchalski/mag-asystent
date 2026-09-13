import { verifiedBackup } from "./services/wms-backup.js";
const [source, target] = process.argv.slice(2);
if (!source || !target)
  throw new Error("Użycie: npm run wms:backup -- <źródło.db> <nowa-kopia.db>");
console.log(JSON.stringify(await verifiedBackup(source, target), null, 2));
