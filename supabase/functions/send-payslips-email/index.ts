// PAYROLL EMAIL DELIVERY - STEP 2B
// Secure backend foundation for Send Payslips.
//
// This function does NOT send real emails yet.
// It validates the signed-in HR/payroll user, loads finalised payroll records
// server-side, checks required recipient data, and prepares Pending
// payslip_email_logs for the next delivery step.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set([
  "hr",
  "hr_manager",
  "payroll",
  "payroll_manager",
  "system_admin",
]);

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalise(value: unknown) {
  return cleanText(value).toLowerCase();
}

// PAYROLL EMAIL DELIVERY - STEP 2B FIX
// Supabase query errors are often plain objects, not JavaScript Error instances.
// This helper keeps diagnostics readable while we stabilise the Edge Function.
function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const errorObject = error as Record<string, unknown>;

    return (
      cleanText(errorObject.message) ||
      cleanText(errorObject.details) ||
      cleanText(errorObject.hint) ||
      JSON.stringify(errorObject)
    );
  }

  return "Payslip email delivery preparation failed.";
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Signed-in user token was not provided.");
  }

  return token;
}

function uniqueCleanIds(values: unknown) {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(
      values
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
  );
}

function getProfileRole(profile: Record<string, unknown> | null) {
  return normalise(
    profile?.role ||
      profile?.system_role ||
      profile?.user_role ||
      "",
  );
}

// PAYROLL EMAIL DELIVERY - STEP 2D
// Tenant/company ownership is required before payslip preparation.
// User access is stored on the signed-in profile as tenant_id.
function getProfileTenantId(profile: Record<string, unknown> | null) {
  return cleanText(profile?.tenant_id);
}

function getRecordEmployeeId(record: Record<string, unknown>) {
  return cleanText(record.employee_id);
}

function getEmployeeName(record: Record<string, unknown>) {
  return (
    `${cleanText(record.first_name)} ${cleanText(record.last_name)}`.trim() ||
    cleanText(record.work_email) ||
    "Unknown Employee"
  );
}

function buildPayslipEmailLogPayload(record: Record<string, unknown>) {
  return {
    payroll_record_id: record.id,
    employee_id: record.employee_id,
    recipient_email: normalise(record.work_email),
    pay_cycle: cleanText(record.pay_cycle),
    status: "Pending",
    error_message: null,
    sent_at: null,
  };
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      success: false,
      message: "Only POST requests are supported.",
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase Edge Function environment is not configured.");
    }

    const token = getBearerToken(request);

    // PAYROLL EMAIL DELIVERY - STEP 2B
    // Use the signed-in user's token so existing RLS remains in force.
    // This avoids using browser-supplied payroll data or bypassing tenant rules.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userResult, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userResult?.user) {
      return jsonResponse(401, {
        success: false,
        message: "Signed-in user could not be validated.",
      });
    }

    const user = userResult.user;

    // PAYROLL EMAIL DELIVERY - STEP 2B FIX
    // Select all profile columns because different builds may store role in
    // role, system_role, or user_role. This avoids failing if one optional
    // role column does not exist in the current schema.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const role = getProfileRole(profile);

    if (!allowedRoles.has(role)) {
      return jsonResponse(403, {
        success: false,
        message: "You are not authorised to prepare payslip email delivery.",
      });
    }

    // PAYROLL EMAIL DELIVERY - STEP 2D
    // Payslip preparation is company-scoped. A signed-in HR/payroll user must
    // be linked to a tenant before the backend can prepare payroll email logs.
    const tenantId = getProfileTenantId(profile);

    if (!tenantId) {
      return jsonResponse(403, {
        success: false,
        message: "Your user profile is not linked to a company workspace. Payslip email preparation cannot continue.",
      });
    }

    const body = await request.json().catch(() => ({}));

    const payCycle = cleanText(body.payCycle || body.pay_cycle);
    const payrollRecordIds = uniqueCleanIds(
      body.payrollRecordIds || body.payroll_record_ids,
    );

    if (!payCycle && !payrollRecordIds.length) {
      return jsonResponse(400, {
        success: false,
        message: "Provide a pay cycle or one or more payroll record IDs.",
      });
    }

    if (payrollRecordIds.length > 250) {
      return jsonResponse(400, {
        success: false,
        message: "Too many payroll records were requested at once. Limit is 250.",
      });
    }

    // PAYROLL EMAIL DELIVERY - STEP 2B
    // Load finalised payroll records server-side.
    // The browser sends only the cycle/IDs; salary and deduction data are not trusted
    // from the frontend.
    let payrollQuery = supabase
      .from("hr_payroll_overview")
      .select("*")
      .eq("is_finalised", true);

    if (payrollRecordIds.length) {
      payrollQuery = payrollQuery.in("id", payrollRecordIds);
    }

    if (payCycle) {
      payrollQuery = payrollQuery.eq("pay_cycle", payCycle);
    }

    const { data: payrollRecords, error: payrollError } = await payrollQuery;

    if (payrollError) {
      throw payrollError;
    }

    let finalisedRecords = Array.isArray(payrollRecords)
      ? payrollRecords
      : [];

    if (!finalisedRecords.length) {
      return jsonResponse(200, {
        success: true,
        status: "NoRecords",
        message: "No finalised payroll records were found for the selected criteria.",
        summary: {
          finalisedRecords: 0,
          prepared: 0,
          alreadyPending: 0,
          alreadySent: 0,
          missingRequiredData: 0,
        },
      });
    }

    // PAYROLL EMAIL DELIVERY - STEP 2D
    // Verify every payroll row against employees in the signed-in tenant.
    // This backend check protects payslip preparation even if someone tries
    // to call the Edge Function directly with another company's payroll IDs.
    const finalisedEmployeeIds = uniqueCleanIds(
      finalisedRecords.map((record) => getRecordEmployeeId(record)),
    );

    if (!finalisedEmployeeIds.length) {
      return jsonResponse(400, {
        success: false,
        status: "MissingRequiredData",
        message: "Payslip email preparation stopped because the selected payroll records are missing employee ownership data.",
        summary: {
          finalisedRecords: finalisedRecords.length,
          prepared: 0,
          alreadyPending: 0,
          alreadySent: 0,
          missingRequiredData: finalisedRecords.length,
        },
      });
    }

    const { data: tenantEmployees, error: tenantEmployeesError } = await supabase
      .from("employees")
      .select("id, tenant_id")
      .eq("tenant_id", tenantId)
      .in("id", finalisedEmployeeIds);

    if (tenantEmployeesError) {
      throw tenantEmployeesError;
    }

    const tenantEmployeeIdSet = new Set(
      (tenantEmployees || [])
        .map((employee) => cleanText(employee.id))
        .filter(Boolean),
    );

    const tenantOwnedRecords = finalisedRecords.filter((record) =>
      tenantEmployeeIdSet.has(getRecordEmployeeId(record)),
    );

    const outsideTenantCount = finalisedRecords.length - tenantOwnedRecords.length;

    if (outsideTenantCount > 0 && payrollRecordIds.length) {
      return jsonResponse(403, {
        success: false,
        status: "TenantMismatch",
        message: "One or more selected payroll records do not belong to the current company workspace.",
        summary: {
          finalisedRecords: finalisedRecords.length,
          prepared: 0,
          alreadyPending: 0,
          alreadySent: 0,
          missingRequiredData: 0,
        },
      });
    }

    finalisedRecords = tenantOwnedRecords;

    if (!finalisedRecords.length) {
      return jsonResponse(200, {
        success: true,
        status: "NoRecords",
        message: "No finalised payroll records were found for the current company workspace.",
        summary: {
          finalisedRecords: 0,
          prepared: 0,
          alreadyPending: 0,
          alreadySent: 0,
          missingRequiredData: 0,
        },
      });
    }

    const recordsMissingRequiredData = finalisedRecords.filter((record) => {
      const hasPayrollRecordId = Boolean(cleanText(record.id));
      const hasEmployeeId = Boolean(cleanText(record.employee_id));
      const hasRecipientEmail = Boolean(cleanText(record.work_email));
      const hasRecordPayCycle = Boolean(cleanText(record.pay_cycle));

      return !hasPayrollRecordId ||
        !hasEmployeeId ||
        !hasRecipientEmail ||
        !hasRecordPayCycle;
    });

    if (recordsMissingRequiredData.length) {
      return jsonResponse(400, {
        success: false,
        status: "MissingRequiredData",
        message: "Payslip email preparation stopped because one or more finalised records are missing employee, email, or pay-cycle data.",
        affectedEmployees: recordsMissingRequiredData
          .slice(0, 10)
          .map(getEmployeeName),
        summary: {
          finalisedRecords: finalisedRecords.length,
          prepared: 0,
          alreadyPending: 0,
          alreadySent: 0,
          missingRequiredData: recordsMissingRequiredData.length,
        },
      });
    }

    const finalisedPayrollRecordIds = finalisedRecords
      .map((record) => cleanText(record.id))
      .filter(Boolean);

    const { data: existingLogs, error: existingLogsError } = await supabase
      .from("payslip_email_logs")
      .select("payroll_record_id, status")
      .in("payroll_record_id", finalisedPayrollRecordIds);

    if (existingLogsError) {
      throw existingLogsError;
    }

    const existingLogMap = new Map(
      (existingLogs || []).map((log) => [
        cleanText(log.payroll_record_id),
        normalise(log.status),
      ]),
    );

    const recordsToPrepare = finalisedRecords.filter((record) => {
      const existingStatus = existingLogMap.get(cleanText(record.id));

      // PAYROLL EMAIL DELIVERY - STEP 2B
      // Do not disturb rows already Pending or Sent.
      // Failed rows may be reset to Pending for retry preparation.
      return !existingStatus || existingStatus === "failed";
    });

    const alreadyPendingCount = finalisedRecords.filter(
      (record) => existingLogMap.get(cleanText(record.id)) === "pending",
    ).length;

    const alreadySentCount = finalisedRecords.filter(
      (record) => existingLogMap.get(cleanText(record.id)) === "sent",
    ).length;

    if (recordsToPrepare.length) {
      const payload = recordsToPrepare.map(buildPayslipEmailLogPayload);

      const { error: upsertError } = await supabase
        .from("payslip_email_logs")
        .upsert(payload, {
          onConflict: "payroll_record_id",
        });

      if (upsertError) {
        throw upsertError;
      }
    }

    return jsonResponse(200, {
      success: true,
      status: "Prepared",
      message: "Payslip email delivery records were prepared successfully. No emails were sent in this step.",
      summary: {
        finalisedRecords: finalisedRecords.length,
        prepared: recordsToPrepare.length,
        alreadyPending: alreadyPendingCount,
        alreadySent: alreadySentCount,
        missingRequiredData: 0,
      },
    });
  } catch (error) {
    console.error("send-payslips-email foundation error:", error);

    // PAYROLL EMAIL DELIVERY - STEP 2B FIX
    // Return a readable backend error during foundation testing so we can fix
    // schema/RLS issues surgically instead of guessing from a generic 500.
    return jsonResponse(500, {
      success: false,
      message: getSafeErrorMessage(error),
    });
  }
});