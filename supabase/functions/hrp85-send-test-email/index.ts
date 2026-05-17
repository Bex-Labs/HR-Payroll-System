// =========================================================
// HRP-85 - EMAIL INTEGRATION - STEP 1D-6 START
// Edge Function: hrp85-send-test-email
//
// Purpose:
// 1. Validate the signed-in HR/Admin user.
// 2. Confirm the recipient is on the approved Bex test-recipient list.
// 3. Create a Pending delivery log.
// 4. Send the real test email through EmailJS.
// 5. Mark the delivery log as Sent or Failed.
//
// This function is still limited to HRP85_TEST emails only.
// Payslip email sending will be wired separately after HRP-85 is proven.
// =========================================================

import { createClient } from "npm:@supabase/supabase-js@2";

type TestEmailRequest = {
  recipientEmail?: string;
  recipientName?: string;
  subject?: string;
  message?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function cleanEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "").trim().slice(0, maxLength);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function markLogFailed(
  serviceSupabase: ReturnType<typeof createClient>,
  logId: string | null,
  errorMessage: string,
): Promise<void> {
  if (!logId) return;

  await serviceSupabase.rpc("hrp85_mark_email_delivery_log_failed", {
    p_log_id: logId,
    p_error_message: errorMessage,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        error: "Method not allowed. Use POST.",
      },
      405,
    );
  }

  let deliveryLogId: string | null = null;
  let serviceSupabase: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const emailJsServiceId = getRequiredEnv("EMAILJS_SERVICE_ID");
    const emailJsTemplateId = getRequiredEnv("EMAILJS_TEMPLATE_ID");
    const emailJsPublicKey = getRequiredEnv("EMAILJS_PUBLIC_KEY");
    const emailJsPrivateKey = getRequiredEnv("EMAILJS_PRIVATE_KEY");
    const emailJsFromName =
      Deno.env.get("EMAILJS_FROM_NAME")?.trim() || "Bex HR Payroll Test";

    const authorizationHeader = req.headers.get("Authorization") || "";

    if (!authorizationHeader) {
      return jsonResponse(
        {
          success: false,
          error: "Missing Authorization header.",
        },
        401,
      );
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorizationHeader,
        },
      },
    });

    serviceSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(
        {
          success: false,
          error: "Unable to validate signed-in user.",
          details: userError?.message || null,
        },
        401,
      );
    }

    const { data: isOperator, error: operatorError } =
      await userSupabase.rpc("is_hrp85_email_operator");

    if (operatorError) {
      return jsonResponse(
        {
          success: false,
          error: "Unable to confirm email integration access.",
          details: operatorError.message,
        },
        403,
      );
    }

    if (isOperator !== true) {
      return jsonResponse(
        {
          success: false,
          error: "You are not authorised to send HRP-85 test emails.",
        },
        403,
      );
    }

    const payload = (await req.json().catch(() => ({}))) as TestEmailRequest;

    const recipientEmail = cleanEmail(payload.recipientEmail);
    const recipientName = cleanText(payload.recipientName, 120);
    const subject = cleanText(
      payload.subject || "HRP-85 Email Integration Test",
      180,
    );
    const message = cleanText(
      payload.message ||
        "This is a controlled HRP-85 test email from the HR & Payroll System.",
      2000,
    );

    if (!isValidEmail(recipientEmail)) {
      return jsonResponse(
        {
          success: false,
          error: "A valid recipientEmail is required.",
        },
        400,
      );
    }

    if (!subject) {
      return jsonResponse(
        {
          success: false,
          error: "A subject is required.",
        },
        400,
      );
    }

    if (!message) {
      return jsonResponse(
        {
          success: false,
          error: "A message is required.",
        },
        400,
      );
    }

    const { data: isApprovedRecipient, error: recipientError } =
      await serviceSupabase.rpc("hrp85_is_active_test_recipient", {
        p_recipient_email: recipientEmail,
      });

    if (recipientError) {
      return jsonResponse(
        {
          success: false,
          error: "Unable to validate HRP-85 test recipient.",
          details: recipientError.message,
        },
        400,
      );
    }

    if (isApprovedRecipient !== true) {
      return jsonResponse(
        {
          success: false,
          error:
            "Recipient is not approved for HRP-85 test emails. Add them to the approved test-recipient list first.",
        },
        400,
      );
    }

    const { data: createdLogId, error: createLogError } =
      await serviceSupabase.rpc("hrp85_create_email_delivery_log", {
        p_email_type: "HRP85_TEST",
        p_recipient_email: recipientEmail,
        p_recipient_name: recipientName || null,
        p_subject: subject,
        p_provider_name: "EmailJS",
        p_created_by: user.id,
      });

    if (createLogError || !createdLogId) {
      return jsonResponse(
        {
          success: false,
          error: "Unable to create email delivery log.",
          details: createLogError?.message || null,
        },
        500,
      );
    }

    deliveryLogId = createdLogId;

    const emailJsResponse = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_id: emailJsServiceId,
          template_id: emailJsTemplateId,
          user_id: emailJsPublicKey,
          accessToken: emailJsPrivateKey,
          template_params: {
            to_email: recipientEmail,
            to_name: recipientName || recipientEmail,
            subject,
            message,
            from_name: emailJsFromName,
            initiated_by_email: user.email || "",
            sent_at: new Date().toISOString(),
          },
        }),
      },
    );

    const providerResponseText = await emailJsResponse.text();

    if (!emailJsResponse.ok) {
      const errorMessage =
        providerResponseText ||
        `EmailJS failed with HTTP status ${emailJsResponse.status}.`;

      await markLogFailed(serviceSupabase, deliveryLogId, errorMessage);

      return jsonResponse(
        {
          success: false,
          status: "Failed",
          logId: deliveryLogId,
          error: "EmailJS failed to send the HRP-85 test email.",
          providerStatus: emailJsResponse.status,
          providerResponse: providerResponseText,
        },
        502,
      );
    }

    const { error: sentLogError } = await serviceSupabase.rpc(
      "hrp85_mark_email_delivery_log_sent",
      {
        p_log_id: deliveryLogId,
        p_provider_name: "EmailJS",
        p_provider_message_id: providerResponseText || null,
      },
    );

    if (sentLogError) {
      return jsonResponse(
        {
          success: false,
          status: "SentButLogUpdateFailed",
          logId: deliveryLogId,
          error: "Email was sent, but the delivery log could not be marked as Sent.",
          details: sentLogError.message,
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      status: "Sent",
      logId: deliveryLogId,
      message: "HRP-85 test email sent successfully.",
      recipientEmail,
      providerResponse: providerResponseText,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown HRP-85 email error.";

    try {
      if (serviceSupabase && deliveryLogId) {
        await markLogFailed(serviceSupabase, deliveryLogId, errorMessage);
      }
    } catch {
      // HRP-85 - STEP 1D-6
      // Preserve the original failure response if the log update also fails.
    }

    return jsonResponse(
      {
        success: false,
        status: "Failed",
        logId: deliveryLogId,
        error: errorMessage,
      },
      500,
    );
  }
});

// =========================================================
// HRP-85 - EMAIL INTEGRATION - STEP 1D-6 END
// =========================================================