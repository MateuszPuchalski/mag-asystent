import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { runOrBuffer } from "./offline";

export const keys = {
  product: (id: number) => ["product", id] as const,
  history: (id: number) => ["product", id, "history"] as const,
  search: (q: string) => ["search", q] as const,
  queue: ["queue"] as const,
  locations: ["locations"] as const,
  locationProducts: (code: string) => ["location", code] as const,
  putawayDocs: ["putaway", "documents"] as const,
  session: (id: number) => ["putaway", "session", id] as const,
};

/* ── odczyt ──────────────────────────────────────────────────────────── */
export function useProduct(id: number | null) {
  return useQuery({
    queryKey: keys.product(id ?? 0),
    queryFn: () => api.product(id!),
    enabled: id != null,
    refetchInterval: 2000, // odbicie korekty stanów o kolejkę
  });
}
export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.search(query).then((r) => r.results),
    enabled: query.length >= 1,
    placeholderData: (prev) => prev,
  });
}
export function useQueue() {
  return useQuery({
    queryKey: keys.queue,
    queryFn: () => api.queue(),
    refetchInterval: 1500, // postęp workera
  });
}
export function useHistory(id: number | null) {
  return useQuery({
    queryKey: keys.history(id ?? 0),
    queryFn: () => api.history(id!).then((r) => r.entries),
    enabled: id != null,
  });
}
export function useLocations() {
  return useQuery({
    queryKey: keys.locations,
    queryFn: () => api.locations(),
    staleTime: 5 * 60 * 1000, // słownik zmienia się rzadko
  });
}
export function useLocationProducts(code: string | null) {
  return useQuery({
    queryKey: keys.locationProducts(code ?? ""),
    queryFn: () => api.locationProducts(code!).then((r) => r.products),
    enabled: !!code,
  });
}
export function usePutawayDocuments() {
  return useQuery({ queryKey: keys.putawayDocs, queryFn: () => api.putawayDocuments().then((r) => r.documents) });
}
export function useSession(id: number | null) {
  return useQuery({
    queryKey: keys.session(id ?? 0),
    queryFn: () => api.session(id!),
    enabled: id != null,
    refetchInterval: 2000,
  });
}

/* ── mutacje ─────────────────────────────────────────────────────────── */
export function useInvalidate() {
  const qc = useQueryClient();
  return {
    product: (id: number) => qc.invalidateQueries({ queryKey: keys.product(id) }),
    queue: () => qc.invalidateQueries({ queryKey: keys.queue }),
    docs: () => qc.invalidateQueries({ queryKey: keys.putawayDocs }),
    session: (id: number) => qc.invalidateQueries({ queryKey: keys.session(id) }),
  };
}

export function useSetLocation(productId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.setLocation>[1]) =>
      runOrBuffer({ kind: "setLocation", productId, body }),
    onSuccess: () => {
      inv.product(productId);
      inv.queue();
    },
  });
}
export function useMM(productId: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.mm>[0]) => runOrBuffer({ kind: "mm", body }),
    onSuccess: () => {
      inv.product(productId);
      inv.queue();
    },
  });
}
export function useRetry() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.retry(id),
    onSuccess: () => inv.queue(),
  });
}
export function useCancel() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.cancel(id),
    onSuccess: () => inv.queue(),
  });
}
