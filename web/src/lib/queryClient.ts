import { QueryClient } from "@tanstack/react-query";

/** Współdzielony klient zapytań — dostępny też poza komponentami (undo/sensory). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 500 },
  },
});
