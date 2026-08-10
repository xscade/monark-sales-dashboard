CREATE TABLE "api_rate_limit_buckets" (
	"org_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_rate_limit_buckets_pk" PRIMARY KEY("api_key_id","window_start"),
	CONSTRAINT "api_rate_limit_buckets_count_check" CHECK ("api_rate_limit_buckets"."request_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_policy" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "signature_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api_rate_limit_buckets" ADD CONSTRAINT "api_rate_limit_buckets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_rate_limit_buckets" ADD CONSTRAINT "api_rate_limit_buckets_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_rate_limit_buckets_org_window_idx" ON "api_rate_limit_buckets" USING btree ("org_id","window_start");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_policy_signature_check" CHECK (("api_keys"."key_policy" = 'browser' AND "api_keys"."signature_required" = false)
          OR ("api_keys"."key_policy" = 'server' AND "api_keys"."signature_required" = true));--> statement-breakpoint
ALTER TABLE "api_rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "api_rate_limit_buckets" FROM anon, authenticated;--> statement-breakpoint
COMMENT ON COLUMN "api_keys"."key_policy" IS 'browser permits bearer-only requests; server requires HMAC signing';--> statement-breakpoint
COMMENT ON TABLE "api_rate_limit_buckets" IS 'Distributed fixed-window counters for public API keys; rows older than two hours are pruned during consumption';
