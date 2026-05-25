-- HRP-EMPNUM - PER-COMPANY EMPLOYEE NUMBER SEQUENCES
-- =============================================================
-- Previously, get_next_employee_number() used a single global
-- sequence shared across all tenants.  This migration replaces
-- that with a per-company counter table so each company's
-- employee numbers start from 1 and never collide with another
-- company's numbers.
--
-- What this migration does:
--   1. Creates company_employee_sequences to hold the running
--      counter for each tenant.
--   2. Seeds the table from the highest existing P-number already
--      stored in the employees table for each tenant, so the new
--      function always picks up where the old one left off per
--      company.
--   3. Replaces the parameterless get_next_employee_number()
--      with a version that accepts p_tenant_id (UUID) and
--      atomically increments that company's counter.
-- =============================================================


-- ─────────────────────────────────────────────
-- STEP 1: Per-company sequence counter table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_employee_sequences (
    tenant_id   UUID        NOT NULL PRIMARY KEY,
    last_number INTEGER     NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_employee_sequences IS
  'Tracks the last-used employee number for each tenant/company.
   Incremented atomically by get_next_employee_number() to prevent
   duplicate staff numbers within a company.';

COMMENT ON COLUMN company_employee_sequences.tenant_id IS
  'Foreign key to the tenants table.  One row per company.';

COMMENT ON COLUMN company_employee_sequences.last_number IS
  'The highest employee sequence number issued for this tenant.
   The NEXT number issued will be last_number + 1.';


-- ─────────────────────────────────────────────
-- STEP 2: Seed from existing employees data
-- ─────────────────────────────────────────────
-- For each tenant that already has employees with P-style numbers
-- (e.g. P1, P21, P042), find the highest numeric part and record
-- it so the new function never re-issues an existing number.
--
-- Non-P numbers (e.g. EMP001) are intentionally ignored — they
-- exist outside the auto-generated sequence and should not affect
-- the counter.
INSERT INTO company_employee_sequences (tenant_id, last_number)
SELECT
    tenant_id,
    MAX(
        CAST(
            SUBSTRING(employee_number FROM '^[Pp](\d+)$')
            AS INTEGER
        )
    ) AS last_number
FROM employees
WHERE
    tenant_id IS NOT NULL
    AND employee_number ~* '^P\d+$'   -- only P-style numbers
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE
    SET
        last_number = GREATEST(
            company_employee_sequences.last_number,
            EXCLUDED.last_number
        ),
        updated_at = now();


-- ─────────────────────────────────────────────
-- STEP 3: Replace the RPC function
-- ─────────────────────────────────────────────
-- Drop the old parameterless version first so its signature does
-- not conflict with the new one.
DROP FUNCTION IF EXISTS get_next_employee_number();

CREATE OR REPLACE FUNCTION get_next_employee_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
-- SECURITY DEFINER lets HR users call this without needing direct
-- INSERT/UPDATE access to company_employee_sequences.
SET search_path = public
AS $$
DECLARE
    v_next_number INTEGER;
BEGIN
    -- Validate input
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'get_next_employee_number: p_tenant_id must not be NULL';
    END IF;

    -- Atomically insert-or-increment the counter for this tenant.
    -- ON CONFLICT ensures a row is created on first use for a tenant.
    -- The RETURNING clause gives us the newly committed value, so
    -- concurrent calls from multiple HR users never return the same number.
    INSERT INTO company_employee_sequences (tenant_id, last_number, updated_at)
    VALUES (p_tenant_id, 1, now())
    ON CONFLICT (tenant_id) DO UPDATE
        SET
            last_number = company_employee_sequences.last_number + 1,
            updated_at  = now()
    RETURNING last_number INTO v_next_number;

    -- Return the formatted staff number, e.g. "P1", "P42", "P100"
    RETURN 'P' || v_next_number::TEXT;
END;
$$;

COMMENT ON FUNCTION get_next_employee_number(UUID) IS
  'Generates the next available employee number for the given tenant.
   Each company has its own independent counter starting from 1.
   Returns a formatted string such as ''P1'', ''P42'', ''P100''.
   Safe for concurrent use — the counter is incremented atomically.';


-- ─────────────────────────────────────────────
-- STEP 4: Row-Level Security
-- ─────────────────────────────────────────────
-- HR users should not be able to read or tamper with other
-- companies' sequence counters directly.
ALTER TABLE company_employee_sequences ENABLE ROW LEVEL SECURITY;

-- Only the SECURITY DEFINER function above should write to this
-- table.  No direct SELECT/INSERT/UPDATE needed by application roles.
-- Adjust or add policies below if your RLS setup requires explicit
-- grants for service_role or authenticated users.

-- Allow the function (running as the table owner via SECURITY DEFINER)
-- to bypass RLS — this is the default for SECURITY DEFINER functions.
-- No additional policy is required for normal operation.
