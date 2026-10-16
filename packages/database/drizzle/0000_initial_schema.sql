CREATE TABLE "customer_auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_temporary_password" boolean DEFAULT false NOT NULL,
	"temporary_password_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_auth_accounts_email_not_blank" CHECK (length(btrim("customer_auth_accounts"."email")) > 0),
	CONSTRAINT "customer_auth_accounts_email_normalized" CHECK ("customer_auth_accounts"."email" = lower(btrim("customer_auth_accounts"."email"))),
	CONSTRAINT "customer_auth_accounts_password_not_blank" CHECK (length(btrim("customer_auth_accounts"."password_hash")) > 0),
	CONSTRAINT "customer_auth_accounts_status_check" CHECK ("customer_auth_accounts"."status" IN (
        'active',
        'disabled'
      )),
	CONSTRAINT "customer_auth_accounts_temporary_password_check" CHECK ("customer_auth_accounts"."is_temporary_password" =
          ("customer_auth_accounts"."temporary_password_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"auth_account_id" uuid,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(254) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_first_name_not_blank" CHECK (length(btrim("customers"."first_name")) > 0),
	CONSTRAINT "customers_last_name_not_blank" CHECK (length(btrim("customers"."last_name")) > 0),
	CONSTRAINT "customers_email_not_blank" CHECK (length(btrim("customers"."email")) > 0),
	CONSTRAINT "customers_email_normalized" CHECK ("customers"."email" = lower(btrim("customers"."email")))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_role_check" CHECK ("tenant_memberships"."role" IN (
        'owner',
        'admin',
        'staff'
      )),
	CONSTRAINT "tenant_memberships_status_check" CHECK ("tenant_memberships"."status" IN (
        'invited',
        'active',
        'disabled'
      ))
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_name_not_blank" CHECK (length(btrim("tenants"."name")) > 0),
	CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" IN (
        'pending',
        'active',
        'suspended',
        'archived'
      ))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_not_blank" CHECK (length(btrim("users"."email")) > 0),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN (
        'invited',
        'active',
        'disabled'
      )),
	CONSTRAINT "users_first_name_not_blank" CHECK ("users"."first_name" IS NULL OR length(btrim("users"."first_name")) > 0),
	CONSTRAINT "users_last_name_not_blank" CHECK ("users"."last_name" IS NULL OR length(btrim("users"."last_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_account_id_customer_auth_accounts_id_fk" FOREIGN KEY ("auth_account_id") REFERENCES "public"."customer_auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_auth_accounts_email_unique_idx" ON "customer_auth_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_auth_account_unique_idx" ON "customers" USING btree ("tenant_id","auth_account_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_email_idx" ON "customers" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "customers_auth_account_id_idx" ON "customers" USING btree ("auth_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_memberships_tenant_user_unique_idx" ON "tenant_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("email");--> statement-breakpoint
-- ============================================================
-- Lara Security: Authenticated Actor Validation
-- ============================================================
--
-- Verifies whether the actor identified by the transaction
-- context is an active staff or customer authentication account.
--
-- The application must establish the context from trusted
-- authenticated server-side state.
--
-- SECURITY DEFINER allows access to protected identity tables
-- without granting lara_app unrestricted SELECT privileges.
--
-- ============================================================

CREATE FUNCTION public.lara_actor_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $lara_function$
  SELECT
    CASE current_setting('app.actor_type', true)

      WHEN 'staff' THEN EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE
          u.id = NULLIF(
            current_setting('app.actor_id', true),
            ''
          )::uuid
          AND u.status = 'active'
      )

      WHEN 'customer' THEN EXISTS (
        SELECT 1
        FROM public.customer_auth_accounts AS ca
        WHERE
          ca.id = NULLIF(
            current_setting('app.actor_id', true),
            ''
          )::uuid
          AND ca.status = 'active'
      )

      ELSE false

    END;
$lara_function$;

--> statement-breakpoint

REVOKE ALL
ON FUNCTION public.lara_actor_is_active()
FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE
ON FUNCTION public.lara_actor_is_active()
TO lara_app;

--> statement-breakpoint

-- ============================================================
-- Lara Security: Tenant Lifecycle Validation
-- ============================================================
--
-- Verifies that the specified tenant exists and is active.
--
-- Normal tenant operations must not be permitted for
-- pending, suspended, or archived tenants.
--
-- This function checks tenant lifecycle status only.
-- It does not authorize the current actor to access
-- the tenant. RLS policies enforce that separately.
--
-- SECURITY DEFINER allows the application to check
-- tenant status without unrestricted SELECT access
-- to the global tenants table.
--
-- ============================================================

CREATE FUNCTION public.lara_tenant_is_active(
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $lara_function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants AS t
    WHERE
      t.id = p_tenant_id
      AND t.status = 'active'
  );
$lara_function$;

--> statement-breakpoint

REVOKE ALL
ON FUNCTION public.lara_tenant_is_active(uuid)
FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE
ON FUNCTION public.lara_tenant_is_active(uuid)
TO lara_app;

--> statement-breakpoint

CREATE POLICY "customers_customer_self_select" ON "customers" AS PERMISSIVE FOR SELECT TO "lara_app" USING (
        current_setting('app.actor_type', true) = 'customer'

        AND "customers"."tenant_id" = NULLIF(
          current_setting('app.tenant_id', true),
          ''
        )::uuid

        AND "customers"."auth_account_id" = NULLIF(
          current_setting('app.actor_id', true),
          ''
        )::uuid

        AND public.lara_actor_is_active()

        AND public.lara_tenant_is_active("customers"."tenant_id")
      );--> statement-breakpoint
CREATE POLICY "customers_staff_select" ON "customers" AS PERMISSIVE FOR SELECT TO "lara_app" USING (
        current_setting('app.actor_type', true) = 'staff'

        AND "customers"."tenant_id" = NULLIF(
          current_setting('app.tenant_id', true),
          ''
        )::uuid

        AND public.lara_actor_is_active()

        AND public.lara_tenant_is_active("customers"."tenant_id")

        AND EXISTS (
          SELECT 1
          FROM "tenant_memberships"
          WHERE
            "tenant_memberships"."tenant_id" = "customers"."tenant_id"

            AND "tenant_memberships"."user_id" = NULLIF(
              current_setting('app.actor_id', true),
              ''
            )::uuid

            AND "tenant_memberships"."status" = 'active'

            AND "tenant_memberships"."role" IN (
              'owner',
              'admin',
              'staff'
            )
        )
      );--> statement-breakpoint
CREATE POLICY "tenant_memberships_staff_self_select" ON "tenant_memberships" AS PERMISSIVE FOR SELECT TO "lara_app" USING (
        current_setting('app.actor_type', true) = 'staff'

        AND "tenant_memberships"."user_id" = NULLIF(
          current_setting('app.actor_id', true),
          ''
        )::uuid

        AND "tenant_memberships"."status" = 'active'

        AND public.lara_actor_is_active()

        AND public.lara_tenant_is_active("tenant_memberships"."tenant_id")
      );
      
--> statement-breakpoint

-- ============================================================
-- Lara Security: Application Table Privileges
-- ============================================================
--
-- The ordinary application database role must not have
-- unrestricted access to global identity or tenant tables.
--
-- All application tables start with their default public
-- privileges explicitly revoked.
--
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE
  public.users,
  public.customer_auth_accounts,
  public.tenants,
  public.tenant_memberships,
  public.customers
FROM PUBLIC;

--> statement-breakpoint

-- ============================================================
-- Explicitly remove any privileges granted directly
-- to the application role.
-- ============================================================

REVOKE ALL PRIVILEGES
ON TABLE
  public.users,
  public.customer_auth_accounts,
  public.tenants,
  public.tenant_memberships,
  public.customers
FROM lara_app;

--> statement-breakpoint

-- ============================================================
-- Allow tenant membership discovery.
--
-- RLS restricts staff to their own active memberships.
-- ============================================================

GRANT SELECT
ON TABLE public.tenant_memberships
TO lara_app;

--> statement-breakpoint

-- ============================================================
-- Allow tenant customer profile reads.
--
-- RLS restricts customers to their linked profile
-- and staff to customers in authorized tenants.
-- ============================================================

GRANT SELECT
ON TABLE public.customers
TO lara_app;