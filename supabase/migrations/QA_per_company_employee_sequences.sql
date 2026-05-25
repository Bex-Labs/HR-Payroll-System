-- =============================================================
-- QA VERIFICATION SCRIPT
-- Per-Company Employee Number Sequences (HRP-EMPNUM)
--
-- Run this in the Supabase SQL Editor after applying the migration.
-- Every CHECK at the bottom should return 'PASS'.
-- Any 'FAIL' row tells you exactly what needs attention.
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- CHECK 1: Table exists
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 1 – table exists' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = 'company_employee_sequences'
    ) THEN 'PASS'
    ELSE 'FAIL – company_employee_sequences table not found'
  END AS result;


-- ─────────────────────────────────────────────────────────────
-- CHECK 2: Table has the expected columns
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 2 – columns: ' || column_name AS check_name,
  CASE
    WHEN column_name IN ('tenant_id', 'last_number', 'updated_at')
    THEN 'PASS'
    ELSE 'FAIL – unexpected column'
  END AS result
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'company_employee_sequences'
ORDER BY ordinal_position;


-- ─────────────────────────────────────────────────────────────
-- CHECK 3: Old parameterless function is gone
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 3 – old parameterless function removed' AS check_name,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname  = 'public'
        AND p.proname  = 'get_next_employee_number'
        AND p.pronargs = 0          -- zero-argument version
    ) THEN 'PASS'
    ELSE 'FAIL – parameterless get_next_employee_number() still exists'
  END AS result;


-- ─────────────────────────────────────────────────────────────
-- CHECK 4: New function exists with correct signature (1 arg)
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 4 – new function exists with UUID parameter' AS check_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname  = 'public'
        AND p.proname  = 'get_next_employee_number'
        AND p.pronargs = 1
    ) THEN 'PASS'
    ELSE 'FAIL – get_next_employee_number(UUID) not found'
  END AS result;


-- ─────────────────────────────────────────────────────────────
-- CHECK 5: Seeding – sequence table has at least one row
--          (only meaningful if employees already existed)
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 5 – seeded rows in sequence table' AS check_name,
  CASE
    WHEN (SELECT COUNT(*) FROM company_employee_sequences) > 0
    THEN 'PASS – ' || (SELECT COUNT(*) FROM company_employee_sequences)::TEXT || ' tenant(s) seeded'
    ELSE 'INFO – table is empty (expected if no P-style employees existed yet)'
  END AS result;


-- ─────────────────────────────────────────────────────────────
-- CHECK 6: Seeding – no tenant sequence is behind its actual max
--          employee number (i.e. the seed was high enough)
-- ─────────────────────────────────────────────────────────────
SELECT
  'CHECK 6 – seed values match existing employee max per tenant' AS check_name,
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM (
        SELECT
          e.tenant_id,
          MAX(CAST(SUBSTRING(e.employee_number FROM '^[Pp](\d+)$') AS INTEGER)) AS actual_max
        FROM employees e
        WHERE e.tenant_id IS NOT NULL
          AND e.employee_number ~* '^P\d+$'
        GROUP BY e.tenant_id
      ) emp_max
      JOIN company_employee_sequences seq USING (tenant_id)
      WHERE seq.last_number < emp_max.actual_max
    ) THEN 'PASS – all sequence counters are >= their tenant max employee number'
    ELSE 'FAIL – one or more tenants have a sequence counter lower than existing employees'
  END AS result;


-- ─────────────────────────────────────────────────────────────
-- CHECK 7: Function returns a P-formatted string
-- ─────────────────────────────────────────────────────────────
-- We use a synthetic UUID so this does not touch real tenant data.
-- The sequence row is cleaned up afterwards.
DO $$
DECLARE
  v_test_tenant UUID := '00000000-0000-0000-0000-000000000001';
  v_result      TEXT;
BEGIN
  -- Run the function once
  SELECT get_next_employee_number(v_test_tenant) INTO v_result;

  -- Clean up test row
  DELETE FROM company_employee_sequences WHERE tenant_id = v_test_tenant;

  -- Assert format
  IF v_result ~ '^P\d+$' THEN
    RAISE NOTICE 'CHECK 7 – PASS: function returned %', v_result;
  ELSE
    RAISE EXCEPTION 'CHECK 7 – FAIL: expected P<number>, got: %', v_result;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- CHECK 8: Sequence increments correctly (3 calls → P1, P2, P3)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_test_tenant UUID := '00000000-0000-0000-0000-000000000002';
  v_r1 TEXT; v_r2 TEXT; v_r3 TEXT;
BEGIN
  SELECT get_next_employee_number(v_test_tenant) INTO v_r1;
  SELECT get_next_employee_number(v_test_tenant) INTO v_r2;
  SELECT get_next_employee_number(v_test_tenant) INTO v_r3;

  -- Clean up
  DELETE FROM company_employee_sequences WHERE tenant_id = v_test_tenant;

  IF v_r1 = 'P1' AND v_r2 = 'P2' AND v_r3 = 'P3' THEN
    RAISE NOTICE 'CHECK 8 – PASS: sequence increments correctly (%, %, %)', v_r1, v_r2, v_r3;
  ELSE
    RAISE EXCEPTION 'CHECK 8 – FAIL: expected P1, P2, P3 but got %, %, %', v_r1, v_r2, v_r3;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- CHECK 9: Two companies get INDEPENDENT sequences
--          Company A: P1, P2   Company B: P1, P2  (no sharing)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant_a UUID := '00000000-0000-0000-0000-000000000003';
  v_tenant_b UUID := '00000000-0000-0000-0000-000000000004';
  v_a1 TEXT; v_a2 TEXT;
  v_b1 TEXT; v_b2 TEXT;
BEGIN
  SELECT get_next_employee_number(v_tenant_a) INTO v_a1;
  SELECT get_next_employee_number(v_tenant_b) INTO v_b1;
  SELECT get_next_employee_number(v_tenant_a) INTO v_a2;
  SELECT get_next_employee_number(v_tenant_b) INTO v_b2;

  -- Clean up
  DELETE FROM company_employee_sequences WHERE tenant_id IN (v_tenant_a, v_tenant_b);

  IF v_a1 = 'P1' AND v_a2 = 'P2' AND v_b1 = 'P1' AND v_b2 = 'P2' THEN
    RAISE NOTICE 'CHECK 9 – PASS: companies have independent sequences (A: %, % | B: %, %)',
      v_a1, v_a2, v_b1, v_b2;
  ELSE
    RAISE EXCEPTION 'CHECK 9 – FAIL: sequences are not independent (A: %, % | B: %, %)',
      v_a1, v_a2, v_b1, v_b2;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- CHECK 10: NULL tenant_id raises an error (guard clause works)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    PERFORM get_next_employee_number(NULL);
    -- Should never reach here
    RAISE EXCEPTION 'CHECK 10 – FAIL: NULL tenant_id did not raise an error';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%p_tenant_id must not be NULL%' THEN
        RAISE NOTICE 'CHECK 10 – PASS: NULL tenant_id correctly rejected (%)', SQLERRM;
      ELSE
        RAISE EXCEPTION 'CHECK 10 – FAIL: unexpected error message: %', SQLERRM;
      END IF;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- SUMMARY VIEW
-- Shows current state of the sequence table for all real tenants
-- ─────────────────────────────────────────────────────────────
SELECT
  seq.tenant_id,
  seq.last_number,
  seq.updated_at,
  'Last issued: P' || seq.last_number::TEXT AS last_issued_number,
  'Next will be: P' || (seq.last_number + 1)::TEXT AS next_number_preview
FROM company_employee_sequences seq
ORDER BY seq.updated_at DESC;
