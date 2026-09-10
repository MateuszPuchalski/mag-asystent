import { z } from "zod";
import { orderInput } from "../services/wms.js";

const id = z.number().int().positive().max(2147483647);
export const sellasistSettingsSchema = z.object({
  account: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  apiKey: z.string().min(10).max(500),
  userId: id,
  readyStatuses: z.array(id).min(1).max(10),
  shippedStatus: id.optional(),
  dispatchDays: z.number().int().min(0).max(14).default(1),
  cutoffHour: z.number().int().min(6).max(20).default(14),
  intervalMs: z.number().int().min(30000).max(3600000).default(60000),
});
export type SellasistSettings = z.infer<typeof sellasistSettingsSchema>;

export function sellasistSettings(
  env: NodeJS.ProcessEnv = process.env,
): SellasistSettings | null {
  if (env.WMS_SELLASIST_ENABLED !== "1") return null;
  const result = sellasistSettingsSchema.safeParse({
    account: env.WMS_SELLASIST_ACCOUNT,
    apiKey: env.WMS_SELLASIST_API_KEY,
    userId: Number(env.WMS_SELLASIST_USER_ID),
    readyStatuses: (env.WMS_SELLASIST_READY_STATUSES || "")
      .split(",")
      .map(Number),
    shippedStatus: env.WMS_SELLASIST_SHIPPED_STATUS
      ? Number(env.WMS_SELLASIST_SHIPPED_STATUS)
      : undefined,
    dispatchDays: env.WMS_SELLASIST_DISPATCH_DAYS
      ? Number(env.WMS_SELLASIST_DISPATCH_DAYS)
      : undefined,
    cutoffHour: env.WMS_SELLASIST_CUTOFF_HOUR
      ? Number(env.WMS_SELLASIST_CUTOFF_HOUR)
      : undefined,
    intervalMs: env.WMS_SELLASIST_INTERVAL_MS
      ? Number(env.WMS_SELLASIST_INTERVAL_MS)
      : undefined,
  });
  if (!result.success)
    throw new Error(
      "Sprawdź konfigurację WMS_SELLASIST: " +
        result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  if (result.data.readyStatuses.includes(result.data.shippedStatus ?? -1))
    throw new Error(
      "Status wysłania Sellasist musi być inny niż statusy gotowe do zbiórki",
    );
  return result.data;
}

export class SellasistError extends Error {
  constructor(
    public status: number,
    public retryMs = 0,
  ) {
    super(
      status
        ? `Sellasist: HTTP ${status}`
        : "Sellasist: brak poprawnej odpowiedzi",
    );
  }
}

// Host i ścieżki mają zamknięty zakres: sekret nie może trafić pod adres z danych zamówienia.
export class SellasistClient {
  constructor(
    private settings: SellasistSettings,
    private transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(
        `https://${this.settings.account}.sellasist.pl/api/v1${path}`,
        {
          method: body ? "PUT" : "GET",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            apiKey: this.settings.apiKey,
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new SellasistError(0);
    }
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 60000;
      await response.body?.cancel();
      throw new SellasistError(
        response.status,
        response.status === 429
          ? Math.max(
              60000,
              Math.min(Number.isFinite(delay) ? delay : 60000, 86400000),
            )
          : 0,
      );
    }
    // Odpowiedź może zawierać załączniki; limit działa także bez Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new SellasistError(0);
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new SellasistError(0);
        }
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } catch {
      throw new SellasistError(0);
    } finally {
      reader.releaseLock();
    }
  }
  async orders(status: number, after: number) {
    const raw = await this.request(
      `/orders?status_id=${id.parse(status)}&from_id=${z.number().int().min(0).parse(after)}&sort=asc&limit=100&placeholder=0`,
    );
    const rows = z.array(z.object({ id })).max(100).parse(raw);
    let last = after;
    for (const row of rows) {
      if (row.id <= last) throw new SellasistError(0);
      last = row.id;
    }
    return rows;
  }
  async order(orderId: number) {
    return sourceOrder.parse(
      await this.request(`/orders/${id.parse(orderId)}`),
    );
  }
  async markShipped(orderId: number, status: number) {
    // Nie rejestrujemy ponownie etykiet ani nie wywołujemy komunikacji marketplace.
    await this.request(`/orders/${id.parse(orderId)}`, {
      status: id.parse(status),
      send_status_to_external: false,
    });
  }
}

// Celowo wycinamy adresy, uwagi klienta, załączniki i dane płatnicze przy parsowaniu.
export const sourceOrder = z.object({
  id,
  status: z.object({ id }),
  date: z.string(),
  source: z.string().trim().max(80).optional(),
  deadline: z.string().nullable().optional(),
  important: z.number().optional(),
  placeholder: z.number().optional(),
  carts: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(120),
        quantity: z.number().int().positive().max(1000000),
      }),
    )
    .min(1)
    .max(200),
  tracking_number: z.string().nullable().optional(),
  shipments: z
    .array(z.object({ tracking_number: z.string().nullable().optional() }))
    .max(100)
    .optional(),
});
export type SourceOrder = z.infer<typeof sourceOrder>;

export function mapSellasistOrder(
  source: SourceOrder,
  settings: SellasistSettings,
) {
  if (source.placeholder)
    throw new Error("Zamówienie Sellasist nie zostało zatwierdzone");
  const explicit = source.deadline?.trim();
  const date = explicit || source.date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Niepoprawna data realizacji Sellasist");
  const day = new Date(date + "T12:00:00Z");
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new Error("Niepoprawna data realizacji Sellasist");
  if (!explicit) {
    let remaining = settings.dispatchDays;
    while (remaining > 0 || [0, 6].includes(day.getUTCDay())) {
      day.setUTCDate(day.getUTCDate() + 1);
      if (![0, 6].includes(day.getUTCDay()))
        remaining = Math.max(0, remaining - 1);
    }
  }
  const dayString = day.toISOString().slice(0, 10);
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    timeZoneName: "shortOffset",
  })
    .formatToParts(day)
    .find((p) => p.type === "timeZoneName")!.value;
  const offset = /GMT([+-])(\d+)(?::(\d+))?/.exec(zone);
  if (!offset) throw new Error("Nie można ustalić strefy czasu Warszawy");
  const minutes =
    (Number(offset[2]) * 60 + Number(offset[3] || 0)) *
    (offset[1] === "+" ? 1 : -1);
  const dueAt = new Date(
    Date.parse(
      `${dayString}T${String(settings.cutoffHour).padStart(2, "0")}:00:00Z`,
    ) -
      minutes * 60000,
  ).toISOString();
  return orderInput.parse({
    reference: `SA-${source.id}`,
    channel: `Sellasist/${settings.account}`,
    dueAt,
    priority: source.important ? 1 : 0,
    lines: source.carts.map((c) => ({ sku: c.symbol, quantity: c.quantity })),
  });
}

export function sourceTracking(source: SourceOrder): Set<string> {
  return new Set(
    [
      source.tracking_number,
      ...(source.shipments || []).map((s) => s.tracking_number),
    ].flatMap((s) =>
      (s || "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  );
}
