CREATE TABLE "alert_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"channel" text NOT NULL,
	"recipient" text DEFAULT 'default' NOT NULL,
	"phase" text DEFAULT 'CREATED' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"provider_id" text,
	"provider_status" text,
	"error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"source" text NOT NULL,
	"camera_id" text,
	"track_id" integer,
	"zone_name" text,
	"title" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"rule_version" text NOT NULL,
	"model_version" text NOT NULL,
	"track_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pre_event_snapshot" text,
	"pre_event_frames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_snapshot" text,
	"annotated_snapshot" text,
	"pre_event_clip" text,
	"post_event_clip" text,
	"escalation_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observation_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alert_delivery_unique" ON "alert_deliveries" USING btree ("incident_id","channel","recipient","phase");