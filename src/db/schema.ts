import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  ref: text("ref").notNull().unique(),
  severity: text("severity").notNull(), // WATCH | SUSPECTED | CRITICAL (legacy LEVEL_2/LEVEL_3 kept for old rows)
  status: text("status").notNull().default("NEW"), // NEW | ACKNOWLEDGED | UNDER_REVIEW | RESOLVED | FALSE_ALARM
  source: text("source").notNull(),
  cameraId: text("camera_id"),
  trackId: integer("track_id"),
  zoneName: text("zone_name"),
  title: text("title").notNull(),
  isTest: boolean("is_test").notNull().default(false),
  observations: jsonb("observations").notNull().default([]),
  observationCount: integer("observation_count").notNull().default(1),
  ruleVersion: text("rule_version").notNull(),
  modelVersion: text("model_version").notNull(),
  trackHistory: jsonb("track_history").notNull().default([]),
  preEventSnapshot: text("pre_event_snapshot"),
  preEventFrames: jsonb("pre_event_frames").notNull().default([]),
  originalSnapshot: text("original_snapshot"),
  annotatedSnapshot: text("annotated_snapshot"),
  preEventClip: text("pre_event_clip"),
  postEventClip: text("post_event_clip"),
  escalationHistory: jsonb("escalation_history").notNull().default([]),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastObservationAt: timestamp("last_observation_at", { withTimezone: true }).notNull().defaultNow(),
});

export const incidentEvents = pgTable("incident_events", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  type: text("type").notNull(), // CREATED | OBSERVATION_GROUPED | ACKNOWLEDGED | UNDER_REVIEW | NOTE | RESOLVED | FALSE_ALARM
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zones = pgTable("zones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // OBSERVATION | SWIMMING | RESTRICTED | IGNORE
  enabled: boolean("enabled").notNull().default(true),
  points: jsonb("points").notNull().default([]), // normalized [{x,y}]
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id").notNull(),
    channel: text("channel").notNull(), // LOCAL_SIREN | LOCAL_VOICE | WEB_PUSH | TELEGRAM | PHONE_CALL
    recipient: text("recipient").notNull().default("default"),
    phase: text("phase").notNull().default("CREATED"), // CREATED | ESCALATION | TEST | REPEAT
    status: text("status").notNull().default("PENDING"), // PENDING | SENT | DELIVERED | ACKNOWLEDGED | FAILED | DISABLED | NOT_CONFIGURED
    attempts: integer("attempts").notNull().default(1),
    providerId: text("provider_id"),
    providerStatus: text("provider_status"),
    error: text("error"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex("alert_delivery_unique").on(t.incidentId, t.channel, t.recipient, t.phase),
  }),
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
});
