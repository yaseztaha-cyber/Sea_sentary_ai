import { EventEmitter } from "node:events";

// In-process event bus feeding the /api/events Server-Sent Events stream.
const g = globalThis as typeof globalThis & { __sentryBus?: EventEmitter };
export const bus: EventEmitter = g.__sentryBus ?? new EventEmitter();
bus.setMaxListeners(100);
g.__sentryBus = bus;

export type BusEvent = { type: string; data: unknown; at: string };

export function publish(type: string, data: unknown) {
  const evt: BusEvent = { type, data, at: new Date().toISOString() };
  bus.emit("event", evt);
}
