import { test } from "node:test";
import assert from "node:assert/strict";
import { adresySieci } from "./adresy-sieci.js";

/* Karta „Nowy kolektor" (@wydanie): do kodu trafia pierwszy adres z listy,
   więc kolejność jest gwarancją, a nie ozdobą. */

const ifc = (address: string, internal = false, family: "IPv4" | "IPv6" = "IPv4") =>
  ({ address, internal, family, netmask: "", mac: "", cidr: null }) as never;

test("prywatne IPv4, 192.168 pierwsze; pętla, IPv6 i publiczne odpadają", () => {
  const wynik = adresySieci({
    lo: [ifc("127.0.0.1", true)],
    vpn: [ifc("10.8.0.2")],
    eth: [ifc("192.168.1.49"), ifc("fe80::1", false, "IPv6")],
    docker: [ifc("172.17.0.1")],
    wan: [ifc("83.12.1.1")],
  });
  assert.deepEqual(wynik, ["192.168.1.49", "10.8.0.2", "172.17.0.1"]);
});

test("ten sam adres na dwóch kartach — raz; brak sieci — pusta lista", () => {
  assert.deepEqual(adresySieci({ a: [ifc("192.168.1.49")], b: [ifc("192.168.1.49")] }), ["192.168.1.49"]);
  assert.deepEqual(adresySieci({}), []);
  /* 172.32 nie jest prywatne. */
  assert.deepEqual(adresySieci({ a: [ifc("172.32.0.1")] }), []);
});
