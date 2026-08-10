CREATE TYPE "public"."consent_state" AS ENUM('granted', 'denied', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."conversion_event_type" AS ENUM('lead_created', 'lead_contacted', 'lead_qualified', 'visit_scheduled', 'walk_in_completed', 'site_visit_completed', 'unit_shortlisted', 'negotiation_started', 'token_paid', 'booking_confirmed', 'sale_completed', 'booking_cancelled', 'lead_disqualified');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'in_flight', 'delivered', 'failed_retryable', 'failed_permanent', 'ineligible', 'expired', 'skipped_dry_run');--> statement-breakpoint
CREATE TYPE "public"."destination_platform" AS ENUM('meta_capi', 'google_data_manager', 'internal_analytics');--> statement-breakpoint
CREATE TYPE "public"."identifier_type" AS ENUM('phone', 'email', 'external_id', 'meta_lead_id', 'whatsapp_wa_id');--> statement-breakpoint
CREATE TYPE "public"."lead_quality" AS ENUM('unrated', 'invalid', 'low', 'medium', 'high', 'very_high');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'visit_scheduled', 'visited', 'negotiating', 'token_paid', 'booked', 'lost', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."lead_sub_status" AS ENUM('none', 'contact_attempted', 'unreachable', 'callback_scheduled', 'awaiting_family_decision', 'awaiting_documents', 'awaiting_finance_approval', 'reschedule_requested', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."lost_reason" AS ENUM('not_interested', 'budget_mismatch', 'location_mismatch', 'configuration_mismatch', 'possession_timeline_mismatch', 'postponed', 'no_response', 'bought_competitor', 'invalid_contact', 'duplicate', 'spam_or_bot', 'wrong_geography', 'agent_or_broker');--> statement-breakpoint
CREATE TYPE "public"."touchpoint_source" AS ENUM('website_form', 'landing_page', 'meta_lead_ad', 'google_lead_form', 'whatsapp', 'phone_call', 'walk_in', 'referral', 'influencer', 'broker', 'csv_import', 'manual_entry', 'portal', 'other');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('available', 'held', 'token_paid', 'booked', 'registered', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'marketing', 'sales_manager', 'sales_agent', 'receptionist', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'confirmed', 'arrived', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visit_type" AS ENUM('corporate_office', 'project_site', 'experience_centre', 'virtual');--> statement-breakpoint
CREATE TABLE "conversion_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversion_event_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliver_by" timestamp with time zone,
	"ineligible_reason" text,
	"request_payload" jsonb,
	"response_body" jsonb,
	"last_error" text,
	"platform_trace_id" text,
	"match_quality" numeric(5, 2),
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"request_payload" jsonb,
	"response_body" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"platform" "destination_platform" NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"credentials_encrypted" text,
	"project_id" uuid,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"event_type" "conversion_event_type" NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"platform_event_name" text NOT NULL,
	"platform_destination_id" text,
	"value_strategy" text DEFAULT 'modelled' NOT NULL,
	"fixed_value" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_type" "conversion_event_type" NOT NULL,
	"lead_id" uuid,
	"person_id" uuid NOT NULL,
	"project_id" uuid,
	"touchpoint_id" uuid,
	"event_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"value" numeric(14, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"value_model_version" integer,
	"stage_at_event" "lead_stage",
	"source_entity_type" text,
	"source_entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_conversion_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"value_model_version_id" uuid NOT NULL,
	"stage" "lead_stage" NOT NULL,
	"probability_to_booking" numeric(8, 6) NOT NULL,
	"observed_rate" numeric(8, 6),
	"sample_size" integer DEFAULT 0 NOT NULL,
	"expected_value" numeric(14, 2) NOT NULL,
	"median_days_to_booking" integer
);
--> statement-breakpoint
CREATE TABLE "value_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"project_id" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"method" text DEFAULT 'prior' NOT NULL,
	"window_days" integer DEFAULT 365 NOT NULL,
	"expected_sale_value" numeric(14, 2),
	"notes" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"unit_id" uuid,
	"project_id" uuid,
	"status" text DEFAULT 'token' NOT NULL,
	"agreement_value" numeric(14, 2),
	"token_amount" numeric(14, 2),
	"token_paid_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"agreement_signed_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"closed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"kind" text NOT NULL,
	"mode" text,
	"reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"held_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"rank" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tower" text,
	"unit_number" text NOT NULL,
	"floor" integer,
	"configuration" text NOT NULL,
	"carpet_area_sqft" numeric(10, 2),
	"saleable_area_sqft" numeric(10, 2),
	"facing" text,
	"base_price" numeric(14, 2),
	"all_in_price" numeric(14, 2),
	"status" "unit_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid,
	"type" "visit_type" NOT NULL,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"duration_minutes" integer,
	"host_user_id" uuid,
	"accompanying_count" integer DEFAULT 0 NOT NULL,
	"accompanying_relations" jsonb,
	"configurations_viewed" jsonb,
	"units_viewed" jsonb,
	"intent_rating" integer,
	"objections" jsonb,
	"next_action" text,
	"notes" text,
	"check_in_method" text DEFAULT 'manual' NOT NULL,
	"check_in_latitude" numeric(10, 7),
	"check_in_longitude" numeric(10, 7),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"state" "consent_state" NOT NULL,
	"collected_via" text NOT NULL,
	"policy_version" text,
	"ip_address" text,
	"user_agent" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"quality" "lead_quality" DEFAULT 'unrated' NOT NULL,
	"budget_fit" boolean,
	"location_fit" boolean,
	"timeline_fit" boolean,
	"configuration_fit" boolean,
	"is_decision_maker" boolean,
	"budget_min" text,
	"budget_max" text,
	"desired_configuration" text,
	"purchase_intent" text,
	"purchase_timeline" text,
	"funding_mode" text,
	"notes" text,
	"rated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "identifier_type" NOT NULL,
	"value_normalized" text NOT NULL,
	"value_hash" text NOT NULL,
	"value_raw" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"surviving_person_id" uuid NOT NULL,
	"merged_person_id" uuid NOT NULL,
	"match_rule" text NOT NULL,
	"confidence" text DEFAULT '1.0' NOT NULL,
	"merged_snapshot" jsonb NOT NULL,
	"performed_by_user_id" uuid,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"primary_phone" text,
	"primary_email" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"is_nri" boolean DEFAULT false NOT NULL,
	"preferred_language" text,
	"merged_into_person_id" uuid,
	"is_suppressed" boolean DEFAULT false NOT NULL,
	"suppression_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid,
	"person_id" uuid,
	"type" text NOT NULL,
	"direction" text,
	"subject" text,
	"body" text,
	"call_duration_seconds" integer,
	"call_outcome" text,
	"call_recording_url" text,
	"transcript" text,
	"ai_insights" jsonb,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"user_id" uuid,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"date" text NOT NULL,
	"platform" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"spend" numeric(14, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"platform_reported_conversions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"rule" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "lead_stage",
	"to_stage" "lead_stage" NOT NULL,
	"duration_in_previous_seconds" integer,
	"changed_by_user_id" uuid,
	"changed_by" text DEFAULT 'user' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"lead_id" uuid,
	"project_id" uuid,
	"source" "touchpoint_source" NOT NULL,
	"source_detail" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"utm_id" text,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"fbclid" text,
	"fbp" text,
	"fbc" text,
	"ctwa_clid" text,
	"meta_lead_id" text,
	"msclkid" text,
	"li_fat_id" text,
	"ad_platform" text,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"creative_id" text,
	"creative_name" text,
	"keyword" text,
	"match_type" text,
	"placement" text,
	"landing_page" text,
	"referrer" text,
	"user_agent" text,
	"ip_address" text,
	"browser_event_id" text,
	"clicked_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"attribution_expires_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"person_id" uuid NOT NULL,
	"project_id" uuid,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"sub_status" "lead_sub_status" DEFAULT 'none' NOT NULL,
	"lost_reason" "lost_reason",
	"lost_notes" text,
	"owner_user_id" uuid,
	"first_touchpoint_id" uuid,
	"last_touchpoint_id" uuid,
	"score" integer DEFAULT 0 NOT NULL,
	"score_updated_at" timestamp with time zone,
	"first_contacted_at" timestamp with time zone,
	"first_response_seconds" integer,
	"sla_breached_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"spam_score" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"scopes" jsonb DEFAULT '["leads:write"]'::jsonb NOT NULL,
	"project_id" uuid,
	"rate_limit_per_minute" text DEFAULT '120' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" text NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"city" text,
	"rera_number" text,
	"avg_sale_value" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" "user_role" DEFAULT 'sales_agent' NOT NULL,
	"password_hash" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_capacity" text DEFAULT '150' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_conversion_event_id_conversion_events_id_fk" FOREIGN KEY ("conversion_event_id") REFERENCES "public"."conversion_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_destination_id_conversion_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."conversion_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_delivery_attempts" ADD CONSTRAINT "conversion_delivery_attempts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_delivery_attempts" ADD CONSTRAINT "conversion_delivery_attempts_delivery_id_conversion_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."conversion_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_destinations" ADD CONSTRAINT "conversion_destinations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_destinations" ADD CONSTRAINT "conversion_destinations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_event_mappings" ADD CONSTRAINT "conversion_event_mappings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_event_mappings" ADD CONSTRAINT "conversion_event_mappings_destination_id_conversion_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."conversion_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_touchpoint_id_lead_touchpoints_id_fk" FOREIGN KEY ("touchpoint_id") REFERENCES "public"."lead_touchpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_conversion_rates" ADD CONSTRAINT "stage_conversion_rates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_conversion_rates" ADD CONSTRAINT "stage_conversion_rates_value_model_version_id_value_model_versions_id_fk" FOREIGN KEY ("value_model_version_id") REFERENCES "public"."value_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_model_versions" ADD CONSTRAINT "value_model_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_model_versions" ADD CONSTRAINT "value_model_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holds" ADD CONSTRAINT "unit_holds_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holds" ADD CONSTRAINT "unit_holds_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holds" ADD CONSTRAINT "unit_holds_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_holds" ADD CONSTRAINT "unit_holds_held_by_user_id_users_id_fk" FOREIGN KEY ("held_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_interests" ADD CONSTRAINT "unit_interests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_interests" ADD CONSTRAINT "unit_interests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_interests" ADD CONSTRAINT "unit_interests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_rated_by_user_id_users_id_fk" FOREIGN KEY ("rated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifiers" ADD CONSTRAINT "person_identifiers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifiers" ADD CONSTRAINT "person_identifiers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_surviving_person_id_persons_id_fk" FOREIGN KEY ("surviving_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_merged_person_id_persons_id_fk" FOREIGN KEY ("merged_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touchpoints" ADD CONSTRAINT "lead_touchpoints_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touchpoints" ADD CONSTRAINT "lead_touchpoints_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touchpoints" ADD CONSTRAINT "lead_touchpoints_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touchpoints" ADD CONSTRAINT "lead_touchpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_event_destination_idx" ON "conversion_deliveries" USING btree ("conversion_event_id","destination_id");--> statement-breakpoint
CREATE INDEX "deliveries_claim_idx" ON "conversion_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "deliveries_org_status_idx" ON "conversion_deliveries" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_idx" ON "conversion_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "destinations_org_platform_idx" ON "conversion_destinations" USING btree ("org_id","platform","is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "event_mappings_unique_idx" ON "conversion_event_mappings" USING btree ("destination_id","event_type");--> statement-breakpoint
CREATE INDEX "event_mappings_org_idx" ON "conversion_event_mappings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_events_key_idx" ON "conversion_events" USING btree ("org_id","event_key");--> statement-breakpoint
CREATE INDEX "conversion_events_lead_idx" ON "conversion_events" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversion_events_org_type_idx" ON "conversion_events" USING btree ("org_id","event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_rates_unique_idx" ON "stage_conversion_rates" USING btree ("value_model_version_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "value_model_version_idx" ON "value_model_versions" USING btree ("org_id","project_id","version");--> statement-breakpoint
CREATE INDEX "value_model_active_idx" ON "value_model_versions" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_org_reference_idx" ON "bookings" USING btree ("org_id","reference");--> statement-breakpoint
CREATE INDEX "bookings_lead_idx" ON "bookings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "bookings_org_status_idx" ON "bookings" USING btree ("org_id","status","booked_at");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id","received_at");--> statement-breakpoint
CREATE INDEX "unit_holds_unit_idx" ON "unit_holds" USING btree ("unit_id","released_at");--> statement-breakpoint
CREATE INDEX "unit_holds_expiry_idx" ON "unit_holds" USING btree ("org_id","expires_at","released_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_interests_unique_idx" ON "unit_interests" USING btree ("lead_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_project_number_idx" ON "units" USING btree ("project_id","tower","unit_number");--> statement-breakpoint
CREATE INDEX "units_status_idx" ON "units" USING btree ("org_id","project_id","status");--> statement-breakpoint
CREATE INDEX "visits_lead_idx" ON "visits" USING btree ("lead_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "visits_org_arrived_idx" ON "visits" USING btree ("org_id","arrived_at");--> statement-breakpoint
CREATE INDEX "visits_org_scheduled_idx" ON "visits" USING btree ("org_id","scheduled_at","status");--> statement-breakpoint
CREATE INDEX "visits_host_idx" ON "visits" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "consent_person_purpose_idx" ON "consent_records" USING btree ("person_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "consent_org_idx" ON "consent_records" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lead_qualifications_lead_idx" ON "lead_qualifications" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "person_identifiers_unique_idx" ON "person_identifiers" USING btree ("org_id","type","value_normalized");--> statement-breakpoint
CREATE INDEX "person_identifiers_person_idx" ON "person_identifiers" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_identifiers_hash_idx" ON "person_identifiers" USING btree ("value_hash");--> statement-breakpoint
CREATE INDEX "person_merges_surviving_idx" ON "person_merges" USING btree ("surviving_person_id");--> statement-breakpoint
CREATE INDEX "person_merges_merged_idx" ON "person_merges" USING btree ("merged_person_id");--> statement-breakpoint
CREATE INDEX "persons_org_idx" ON "persons" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "persons_merged_into_idx" ON "persons" USING btree ("merged_into_person_id");--> statement-breakpoint
CREATE INDEX "persons_primary_phone_idx" ON "persons" USING btree ("org_id","primary_phone");--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_person_idx" ON "activities" USING btree ("person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_due_idx" ON "activities" USING btree ("org_id","due_at");--> statement-breakpoint
CREATE INDEX "activities_user_idx" ON "activities" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_spend_unique_idx" ON "ad_spend_daily" USING btree ("org_id","platform","date","campaign_id","adset_id","ad_id");--> statement-breakpoint
CREATE INDEX "ad_spend_date_idx" ON "ad_spend_daily" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "assignments_lead_idx" ON "lead_assignments" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "stage_history_lead_idx" ON "lead_stage_history" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "stage_history_org_to_idx" ON "lead_stage_history" USING btree ("org_id","to_stage","created_at");--> statement-breakpoint
CREATE INDEX "touchpoints_person_idx" ON "lead_touchpoints" USING btree ("person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "touchpoints_lead_idx" ON "lead_touchpoints" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "touchpoints_org_occurred_idx" ON "lead_touchpoints" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "touchpoints_gclid_idx" ON "lead_touchpoints" USING btree ("gclid");--> statement-breakpoint
CREATE INDEX "touchpoints_meta_lead_idx" ON "lead_touchpoints" USING btree ("meta_lead_id");--> statement-breakpoint
CREATE INDEX "touchpoints_campaign_idx" ON "lead_touchpoints" USING btree ("org_id","ad_platform","campaign_id");--> statement-breakpoint
CREATE INDEX "touchpoints_expiry_idx" ON "lead_touchpoints" USING btree ("org_id","attribution_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_reference_idx" ON "leads" USING btree ("org_id","reference");--> statement-breakpoint
CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_user_id","stage");--> statement-breakpoint
CREATE INDEX "leads_person_idx" ON "leads" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "leads_project_idx" ON "leads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("org_id","next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_org_key_endpoint_idx" ON "idempotency_keys" USING btree ("org_id","key","endpoint");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("org_id","email");