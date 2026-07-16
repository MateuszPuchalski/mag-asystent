export interface Product {
  id: number;
  sym: string;
  name: string;
  ean: string;
  mag: number;      // stan na magazynie głównym MAG
  rez: number;      // rezerwacje MAG
  mgp: number;      // stan na strefie przyjęć MGP (dawniej PRZYJ)
  unit: string;
  ordered: number;  // zamówione u dostawcy
  locs: string[];   // lokalizacje (pierwsza = pickingowa)
  desc: string;
}

export type QueueType = "set_location" | "mm" | "combo";
export type QueueStatus = "pending" | "processing" | "done" | "error";

export interface QueueTask {
  id: number;
  type: QueueType;
  label: string;
  detail: string;
  status: QueueStatus;
  errMsg?: string;
  time: string;
  pid?: number;
  apply?: () => void;
}

export type Screen = "splash" | "home" | "product" | "scanLoc" | "mm" | "queue";
export type LocMode = "loc" | "combo";
