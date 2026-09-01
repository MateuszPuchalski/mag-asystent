import { EventEmitter } from "node:events";

export type ConversationEventType =
  | "presence"
  | "message.created"
  | "assignment.changed"
  | "warehouse.result";

export interface ConversationRealtimeEvent {
  id: number;
  type: ConversationEventType;
  conversationId: number;
  data: unknown;
  at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let sequence = 0;

export function publishConversationEvent(
  type: ConversationEventType, conversationId: number, data: unknown,
): ConversationRealtimeEvent {
  const event = { id: ++sequence, type, conversationId, data, at: new Date().toISOString() };
  emitter.emit("event", event);
  return event;
}

export function onConversationEvent(listener: (event: ConversationRealtimeEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

// „Pisze” wygasa samo i nigdy nie trafia do SQLite.
const TYPING_TTL_MS = 12_000;
const typing = new Map<string, { conversationId: number; userId: number; name: string; expiresAt: number }>();

export function setTyping(conversationId: number, userId: number, name: string, active: boolean) {
  const key = `${conversationId}:${userId}`;
  if (active) typing.set(key, { conversationId, userId, name, expiresAt: Date.now() + TYPING_TTL_MS });
  else typing.delete(key);
  return publishConversationEvent("presence", conversationId, {
    userId, name, typing: active, expiresAt: active ? new Date(Date.now() + TYPING_TTL_MS).toISOString() : null,
  });
}

export function typingPresence(conversationId: number) {
  const now = Date.now();
  for (const [key, value] of typing) if (value.expiresAt <= now) typing.delete(key);
  return [...typing.values()].filter((value) => value.conversationId === conversationId);
}
