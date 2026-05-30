// PAYROLL EMAIL DELIVERY - STEP 2E
// Secure backend delivery for Send Payslips.
//
// This function validates the signed-in HR/payroll user, verifies tenant/company
// ownership server-side, loads finalised payroll records, prepares payslip email
// logs, sends controlled payslip notification emails through EmailJS, and marks
// each payslip_email_logs row as Sent or Failed.
//
// This step does not attach PDF payslips yet and does not accept salary,
// deduction, or bank data from the browser.

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

// PAYROLL EMAIL DELIVERY - STEP 2E
// EmailJS settings are read only inside the Edge Function from Supabase secrets.
// The browser does not provide provider keys, salary values, deductions, or bank data.
type EmailJsConfig = {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
  fromName: string;
};

// ALPATECH EMAIL BRANDING - STEP 2E
// Branding context is resolved server-side from the signed-in company workspace.
// This must not come from the browser because payslip delivery is tenant-sensitive.
type PayslipEmailBrandingContext = {
  isAlpatech: boolean;
  brandName: string;
  fromName: string;
  headerTitle: string;
  headerSubtitle: string;
  primaryColor: string;
  logoUrl: string;
  payslipAccessLabel: string;
  fallbackAccessLabel: string;
  payrollContactLabel: string;
  footerName: string;
};

type PayslipEmailDeliveryRequest = {
  config: EmailJsConfig;
  toEmail: string;
  toName: string;
  subject: string;
  message: string;
  initiatedByEmail: string;
  payCycle: string;
  payrollRecordId: string;

  // ALPATECH EMAIL BRANDING - STEP 2E
  // Used only to pass non-sensitive branding fields to EmailJS.
  branding: PayslipEmailBrandingContext;

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-3
  // Safe employee payroll landing URL.
  // This must point to the protected employee dashboard payroll section,
  // not to a payroll record ID or salary-bearing public page.
  payslipAccessUrl: string;
};

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

// PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 1
// The payslip email button must open the public landing page directly.
// If PAYSLIP_ACCESS_URL is still configured as a protected dashboard route,
// convert it to /index.html so employees do not briefly see a dashboard or
// session-expired redirect before reaching the login page.
// PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4A
// Keep the email button on the public landing page to prevent protected
// dashboard flashes. The query string carries only non-sensitive login intent:
// it does not include payroll ID, salary, deduction, employee ID, or bank data.
function getOptionalPayslipAccessUrlEnv(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) return "";

  try {
    const parsedUrl = new URL(value);
    const isHttps = parsedUrl.protocol === "https:";
    const isLocalhost =
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "127.0.0.1";

    if (!isHttps && !isLocalhost) {
      throw new Error("Only HTTPS URLs are allowed outside local testing.");
    }

    const publicLandingUrl = new URL("/index.html", `${parsedUrl.origin}/`);
    publicLandingUrl.searchParams.set("payslip", "1");
    publicLandingUrl.searchParams.set("source", "payslip-email");

    return publicLandingUrl.toString();
  } catch {
    throw new Error(
      `${name} must be a valid secure HR/payroll landing page URL when provided.`,
    );
  }
}

// PAYROLL SECURE DELIVERY - STEP 2F-1
// Read an optional secure payslip access URL from Supabase secrets.
// It is optional for now so existing safe notification-only sending does not break.
// When configured, it must be HTTPS because payslip access is payroll-sensitive.
function getOptionalHttpsUrlEnv(name: string) {
  const value = Deno.env.get(name)?.trim();

  if (!value) return "";

  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTPS URLs are allowed.");
    }

    return parsedUrl.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL when provided.`);
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ALPATECH EMAIL BRANDING - STEP 2E
// Default email identity for non-Alpatech tenants.
const DEFAULT_PAYSLIP_EMAIL_BRANDING: PayslipEmailBrandingContext = {
  isAlpatech: false,
  brandName: "HR & Payroll System",
  fromName: "",
  headerTitle: "HR & Payroll System",
  headerSubtitle: "Confidential payslip notification",
  primaryColor: "#904d00",
  logoUrl: "",
  payslipAccessLabel: "View payslip securely",
  fallbackAccessLabel: "Open HR & Payroll System",
  payrollContactLabel: "HR/Payroll",
  footerName: "the HR & Payroll System",
};

function isAlpatechBrandValue(value: unknown) {
  return normalise(value).includes("alpatech");
}

function buildPublicAssetUrl(baseUrl: string, assetPath: string) {
  const cleanBaseUrl = cleanText(baseUrl);
  const cleanAssetPath = cleanText(assetPath).replace(/^\/+/, "");

  if (!cleanBaseUrl || !cleanAssetPath) return "";

  try {
    const parsedBaseUrl = new URL(cleanBaseUrl);
    return new URL(cleanAssetPath, `${parsedBaseUrl.origin}/`).toString();
  } catch {
    return "";
  }
}

// ALPATECH EMAIL BRANDING - STEP 2E
// Resolve tenant branding from trusted backend data only.
// If tenant lookup is blocked by RLS, the function safely falls back to
// non-Alpatech branding rather than leaking Alpatech branding to other tenants.
async function resolvePayslipEmailBrandingContext(
  supabase: ReturnType<typeof createClient>,
  profile: Record<string, unknown> | null,
  payslipAccessUrl: string,
): Promise<PayslipEmailBrandingContext> {
  const tenantId = getProfileTenantId(profile);

  const brandCandidates = [
    profile?.company_name,
    profile?.tenant_code,
    profile?.tenant_name,
    profile?.organization_name,
  ];

  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("company_name, tenant_code")
      .eq("id", tenantId)
      .maybeSingle();

    if (!error && data) {
      brandCandidates.push(data.company_name, data.tenant_code);
    } else if (error) {
      console.warn("Payslip email tenant branding lookup skipped.", error);
    }
  } catch (error) {
    console.warn("Payslip email tenant branding lookup failed.", error);
  }

  try {
    const { data, error } = await supabase
      .from("organization_settings")
      .select("organization_name")
      .eq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      brandCandidates.push(data.organization_name);
    } else if (error) {
      console.warn("Payslip email organization branding lookup skipped.", error);
    }
  } catch (error) {
    console.warn("Payslip email organization branding lookup failed.", error);
  }

  const isAlpatech = brandCandidates.some(isAlpatechBrandValue);

  if (!isAlpatech) {
    return DEFAULT_PAYSLIP_EMAIL_BRANDING;
  }

  const configuredPublicBaseUrl = cleanText(Deno.env.get("PUBLIC_APP_BASE_URL"));
  const logoBaseUrl = configuredPublicBaseUrl || payslipAccessUrl;

  return {
    isAlpatech: true,
    brandName: "ALPATECH",
    fromName: "Alpatech HR & Payroll",
    headerTitle: "ALPATECH HR & Payroll",
    headerSubtitle: "Confidential payslip notification",
    primaryColor: "#0b5f95",
    logoUrl: buildPublicAssetUrl(logoBaseUrl, "assets/alpatech-flame.png"),
    payslipAccessLabel: "View Alpatech payslip securely",
    fallbackAccessLabel: "Open Alpatech HR & Payroll",
    payrollContactLabel: "Alpatech HR/Payroll",
    footerName: "Alpatech HR & Payroll",
  };
}

async function sendPayslipEmailViaEmailJs({
  config,
  toEmail,
  toName,
  subject,
  message,
  initiatedByEmail,
  payCycle,
  payrollRecordId,
  branding,
  payslipAccessUrl,
}: PayslipEmailDeliveryRequest) {
  const response = await fetch(
    "https://api.emailjs.com/api/v1.0/email/send",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        accessToken: config.privateKey,
        template_params: {
          to_email: toEmail,
          to_name: toName || toEmail,
          subject,
          message,
          // ALPATECH EMAIL BRANDING - STEP 2E
          // from_name is tenant-aware for Alpatech, but falls back to the
          // configured EmailJS sender name for every other tenant.
          from_name: branding.fromName || config.fromName,
          initiated_by_email: initiatedByEmail || "",
          pay_cycle: payCycle,
          payroll_record_id: payrollRecordId,

          // ALPATECH EMAIL BRANDING - STEP 2E
          // Non-sensitive branding parameters for the EmailJS payslip template.
          // These do not include salary, deduction, bank, or payslip amount data.
          brand_name: branding.brandName,
          brand_header_title: branding.headerTitle,
          brand_header_subtitle: branding.headerSubtitle,
          brand_primary_color: branding.primaryColor,
          brand_logo_url: branding.logoUrl,
          payroll_contact_label: branding.payrollContactLabel,
          email_footer_name: branding.footerName,

          // PAYROLL SECURE DELIVERY - STEP 2F-3B-3
          // Non-sensitive EmailJS params for the protected employee payroll page.
          payslip_access_url: payslipAccessUrl,

          // PAYROLL SECURE DELIVERY - STEP 2F-3B-4C
          // Short client-ready button label for the EmailJS template.
          payslip_access_label: payslipAccessUrl
            ? branding.payslipAccessLabel
            : branding.fallbackAccessLabel,

          sent_at: new Date().toISOString(),
        },
      }),
    },
  );

  const responseText = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    responseText,
  };
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

// PAYROLL EMAIL DELIVERY - STEP 2E
// Keep the email content controlled and non-sensitive. This does not include
// salary, deductions, bank details, or PDF attachments.
function buildPayslipEmailSubject(
  record: Record<string, unknown>,
  branding: PayslipEmailBrandingContext = DEFAULT_PAYSLIP_EMAIL_BRANDING,
) {
  const payCycle = cleanText(record.pay_cycle) || "Payroll";
  const prefix = branding.isAlpatech
    ? "Alpatech Payslip Notification"
    : "Payslip Notification";

  return `${prefix} - ${payCycle}`.slice(0, 180);
}

// PAYROLL EMAIL DELIVERY - STEP 2F-3B-4D
// Official client-ready payslip notification wording.
// Paragraphs are deliberately separated with blank lines so the EmailJS template
// renders the email like a formal notification instead of a compressed text block.
function buildPayslipEmailMessage(
  record: Record<string, unknown>,
  payslipAccessUrl: string,
  branding: PayslipEmailBrandingContext = DEFAULT_PAYSLIP_EMAIL_BRANDING,
) {
  const employeeName = getEmployeeName(record);
  const payCycle = cleanText(record.pay_cycle) || "the selected pay cycle";
  const payDate = cleanText(record.pay_date);

  const accessInstruction = payslipAccessUrl
    ? "Please use the secure button below to access your payslip."
    : branding.isAlpatech
      ? "Please sign in to Alpatech HR & Payroll and open Payroll to access your payslip."
      : "Please sign in to the HR & Payroll System and open Payroll to access your payslip.";

  // ALPATECH EMAIL BRANDING - STEP 2K
  // The EmailJS visual header already carries the Alpatech brand.
  // Keep the body clean and operational so the email does not repeat
  // "Alpatech" too many times.
  return [
    `Hello ${employeeName},`,
    `Your payslip for ${payCycle} is now ready to view.${payDate ? `\nPay date: ${payDate}.` : ""}`,
    accessInstruction,
    `For payroll queries, please contact ${branding.payrollContactLabel}.`,
    `This is an automated notification from ${branding.footerName}.`,
  ].join("\n\n");
}

async function updatePayslipEmailLogStatus(
  supabase: ReturnType<typeof createClient>,
  logId: string,
  status: "Sent" | "Failed",
  errorMessage: string | null = null,
) {
  const payload: Record<string, unknown> = {
    status,
    error_message: errorMessage,
    sent_at: status === "Sent" ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from("payslip_email_logs")
    .update(payload)
    .eq("id", logId);

  if (error) {
    throw error;
  }
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

    // PAYROLL EMAIL DELIVERY - STEP 2E
    // Reuse the EmailJS secrets already proven by HRP-85.
    const emailJsConfig: EmailJsConfig = {
      serviceId: getRequiredEnv("EMAILJS_SERVICE_ID"),
      // PAYROLL EMAIL DELIVERY - STEP 2E-C
      // Payslip delivery uses its own EmailJS template so it does not inherit
      // HRP-85 validation/test wording.
      templateId: getRequiredEnv("EMAILJS_PAYSLIP_TEMPLATE_ID"),
      publicKey: getRequiredEnv("EMAILJS_PUBLIC_KEY"),
      privateKey: getRequiredEnv("EMAILJS_PRIVATE_KEY"),
      fromName:
        Deno.env.get("EMAILJS_FROM_NAME")?.trim() ||
        "HR & Payroll System",
    };

    // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 1
    // EmailJS receives only the public landing page URL.
    // The employee signs in from the landing page instead of first touching a
    // protected dashboard route that can flash before session validation finishes.
    const payslipAccessUrl = getOptionalPayslipAccessUrlEnv("PAYSLIP_ACCESS_URL");

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

    // ALPATECH EMAIL BRANDING - STEP 2H
    // Use a service-role client only for non-sensitive company branding lookup.
    // Payroll records, employee ownership, recipient emails, and delivery actions
    // still use the signed-in user's RLS-scoped client above.
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
    const brandingSupabase = supabaseServiceRoleKey
      ? createClient(supabaseUrl, supabaseServiceRoleKey)
      : supabase;

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

    // ALPATECH EMAIL BRANDING - STEP 2E
    // Resolve branding only after the signed-in user's tenant is confirmed.
    const emailBrandingContext = await resolvePayslipEmailBrandingContext(
      brandingSupabase,
      profile,
      payslipAccessUrl,
    );

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
          prepared,
          alreadyPending,
          alreadySent,
          missingRequiredData,

          // ALPATECH EMAIL BRANDING - STEP 2H
          // Non-sensitive diagnostic so HR can confirm whether the backend
          // resolved tenant branding for this delivery run.
          emailBranding: emailBrandingContext.isAlpatech
            ? "Alpatech"
            : "Default",
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
      .select("id, payroll_record_id, status")
      .in("payroll_record_id", finalisedPayrollRecordIds);

    if (existingLogsError) {
      throw existingLogsError;
    }

    const existingLogMap = new Map(
      (existingLogs || []).map((log) => [
        cleanText(log.payroll_record_id),
        log,
      ]),
    );

    const getExistingStatus = (record: Record<string, unknown>) => {
      const existingLog = existingLogMap.get(cleanText(record.id));
      return normalise(existingLog?.status);
    };

    const recordsToPrepare = finalisedRecords.filter((record) => {
      const existingStatus = getExistingStatus(record);

      // PAYROLL EMAIL DELIVERY - STEP 2E
      // New records and Failed records are reset to Pending before sending.
      // Existing Pending rows are also eligible to send, but do not need a new log.
      // Sent rows are never resent by this step.
      return !existingStatus || existingStatus === "failed";
    });

    const alreadyPendingCount = finalisedRecords.filter(
      (record) => getExistingStatus(record) === "pending",
    ).length;

    const alreadySentCount = finalisedRecords.filter(
      (record) => getExistingStatus(record) === "sent",
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

    const recordsToSend = finalisedRecords.filter(
      (record) => getExistingStatus(record) !== "sent",
    );

    const recordsToSendPayrollRecordIds = recordsToSend
      .map((record) => cleanText(record.id))
      .filter(Boolean);

    let deliveryLogs: Record<string, unknown>[] = [];

    if (recordsToSendPayrollRecordIds.length) {
      const { data: latestLogs, error: latestLogsError } = await supabase
        .from("payslip_email_logs")
        .select("id, payroll_record_id, status")
        .in("payroll_record_id", recordsToSendPayrollRecordIds);

      if (latestLogsError) {
        throw latestLogsError;
      }

      deliveryLogs = Array.isArray(latestLogs) ? latestLogs : [];
    }

    const deliveryLogByPayrollRecordId = new Map(
      deliveryLogs.map((log) => [
        cleanText(log.payroll_record_id),
        log,
      ]),
    );

    let sentCount = 0;
    let failedCount = 0;
    let missingLogCount = 0;
    const deliveryFailures: string[] = [];

    for (const record of recordsToSend) {
      const payrollRecordId = cleanText(record.id);
      const employeeName = getEmployeeName(record);
      const recipientEmail = normalise(record.work_email);
      const deliveryLog = deliveryLogByPayrollRecordId.get(payrollRecordId);
      const deliveryLogId = cleanText(deliveryLog?.id);

      if (!deliveryLogId) {
        failedCount += 1;
        missingLogCount += 1;
        deliveryFailures.push(
          `${employeeName}: payslip email log was not found after preparation.`,
        );
        continue;
      }

      if (!isValidEmail(recipientEmail)) {
        const errorMessage = "Employee work email is not a valid email address.";

        await updatePayslipEmailLogStatus(
          supabase,
          deliveryLogId,
          "Failed",
          errorMessage,
        );

        failedCount += 1;
        deliveryFailures.push(`${employeeName}: ${errorMessage}`);
        continue;
      }

      const subject = buildPayslipEmailSubject(record, emailBrandingContext);

      // PAYROLL SECURE DELIVERY - STEP 2F-3B-3
      // Add only the protected employee Payroll page URL.
      // Do not include payroll amounts, bank details, or payroll record IDs in the email body.
      const message = buildPayslipEmailMessage(
        record,
        payslipAccessUrl,
        emailBrandingContext,
      );

      try {
        const emailJsResult = await sendPayslipEmailViaEmailJs({
          config: emailJsConfig,
          toEmail: recipientEmail,
          toName: employeeName,
          subject,
          message,
          initiatedByEmail: user.email || "",
          payCycle: cleanText(record.pay_cycle),
          payrollRecordId,

          // ALPATECH EMAIL BRANDING - STEP 2E
          // Tenant-safe branding context passed to EmailJS template params.
          branding: emailBrandingContext,

          // PAYROLL SECURE DELIVERY - STEP 2F-3B-3
          // Passed as an EmailJS template parameter for optional button/link rendering.
          payslipAccessUrl,
        });

        if (!emailJsResult.ok) {
          const errorMessage =
            emailJsResult.responseText ||
            `EmailJS failed with HTTP status ${emailJsResult.status}.`;

          await updatePayslipEmailLogStatus(
            supabase,
            deliveryLogId,
            "Failed",
            errorMessage,
          );

          failedCount += 1;
          deliveryFailures.push(`${employeeName}: ${errorMessage}`.slice(0, 250));
          continue;
        }

        await updatePayslipEmailLogStatus(
          supabase,
          deliveryLogId,
          "Sent",
          null,
        );

        sentCount += 1;
      } catch (deliveryError) {
        const errorMessage = getSafeErrorMessage(deliveryError);

        try {
          await updatePayslipEmailLogStatus(
            supabase,
            deliveryLogId,
            "Failed",
            errorMessage,
          );
        } catch (logUpdateError) {
          deliveryFailures.push(
            `${employeeName}: email failed and the failure log could not be updated. ${getSafeErrorMessage(logUpdateError)}`.slice(0, 250),
          );
        }

        failedCount += 1;
        deliveryFailures.push(`${employeeName}: ${errorMessage}`.slice(0, 250));
      }
    }

    const deliveryStatus = failedCount
      ? sentCount
        ? "DeliveredWithFailures"
        : "DeliveryFailed"
      : "Sent";

    return jsonResponse(200, {
      success: failedCount === 0,
      status: deliveryStatus,
      message: failedCount
        ? "Payslip email delivery completed with one or more failures. Review Payslip Email Status."
        : "Payslip emails were sent successfully.",
      failures: deliveryFailures.slice(0, 10),
      summary: {
        finalisedRecords: finalisedRecords.length,
        prepared: recordsToPrepare.length,
        sent: sentCount,
        failed: failedCount,
        missingLogs: missingLogCount,
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