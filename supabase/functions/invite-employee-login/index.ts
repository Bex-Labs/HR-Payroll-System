// EMPLOYEE LOGIN PROVISIONING
// Secure server-side invite for new employees.
//
// This function is called by the HR dashboard immediately after a new employee
// record is created. It validates the calling HR/admin user, then uses the
// Supabase admin API (service role key — never exposed to the browser) to send
// an invite email to the employee's work address.
//
// The invite email contains a secure magic link. When the employee clicks it
// they are prompted to set their own password and are then redirected to the
// HR & Payroll login page. No temporary password is ever transmitted in plain text.
//
// After the invite is issued, the function creates the employee's profiles row
// immediately so that role-based access is ready as soon as they complete setup.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Only HR and Admin users may provision employee login accounts.
const allowedRoles = new Set(["hr", "admin"]);

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing authorization header." });
    }

    // Build the admin Supabase client using the service role key.
    // This key is stored as a Supabase secret and is never sent to the browser.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Build a user-scoped client to verify the caller's identity and role.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verify the calling user is authenticated.
    const { data: { user: callerUser }, error: callerAuthError } =
      await supabaseUser.auth.getUser();

    if (callerAuthError || !callerUser) {
      return jsonResponse(401, { error: "Unauthorized." });
    }

    // Verify the caller has an active HR or Admin profile.
    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from("profiles")
      .select("role, is_active")
      .eq("id", callerUser.id)
      .single();

    if (callerProfileError || !callerProfile) {
      return jsonResponse(403, { error: "Caller profile not found." });
    }

    const callerRole = cleanText(callerProfile.role).toLowerCase();

    if (!allowedRoles.has(callerRole) || callerProfile.is_active === false) {
      return jsonResponse(403, {
        error: "You do not have permission to provision employee logins.",
      });
    }

    // Parse and validate the request payload.
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body." });
    }

    const workEmail = cleanText(payload.workEmail).toLowerCase();
    const fullName = cleanText(payload.fullName);
    const tenantId = cleanText(payload.tenantId) || null;
    const companyName = cleanText(payload.companyName) || "Your Company";

    if (!workEmail) {
      return jsonResponse(400, { error: "workEmail is required." });
    }

    if (!fullName) {
      return jsonResponse(400, { error: "fullName is required." });
    }

    // The redirect URL lands the employee on the login page after they set
    // their password via the magic link.
    const appOrigin = cleanText(req.headers.get("origin")) ||
      cleanText(Deno.env.get("APP_URL"));
    const redirectTo = appOrigin
      ? `${appOrigin}/index.html`
      : "/index.html";

    // Send the invite. The Supabase admin API creates the auth.users row
    // immediately and dispatches the invite email with a secure magic link.
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(workEmail, {
        data: {
          full_name: fullName,
          company_name: companyName,
          role: "employee",
        },
        redirectTo,
      });

    if (inviteError) {
      // Surface a clear message if the email is already registered.
      const message = cleanText(inviteError.message).toLowerCase();
      if (
        message.includes("already registered") ||
        message.includes("already been registered") ||
        message.includes("user already exists")
      ) {
        return jsonResponse(409, {
          error: `A login account already exists for ${workEmail}. No new invite was sent.`,
        });
      }

      console.error("inviteUserByEmail error:", inviteError);
      throw new Error(inviteError.message || "Invite could not be sent.");
    }

    // The auth user now exists. Create the profiles row immediately so
    // role-based access is ready when the employee completes their setup.
    const newUserId = inviteData?.user?.id;

    if (newUserId) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: newUserId,
            email: workEmail,
            full_name: fullName,
            role: "employee",
            ...(tenantId ? { tenant_id: tenantId } : {}),
            is_active: true,
            must_change_password: false,
          },
          { onConflict: "id" },
        );

      if (profileError) {
        // The invite was sent successfully. Log the profile error but do not
        // fail the request — HR will see the account appear once the employee
        // completes setup and the auth trigger fires.
        console.error("Profile upsert error after invite:", profileError);
      }
    }

    return jsonResponse(200, {
      success: true,
      message: `Login invite sent to ${workEmail}.`,
    });
  } catch (error) {
    console.error("invite-employee-login unexpected error:", error);
    return jsonResponse(500, {
      error: cleanText((error as Error).message) ||
        "An unexpected error occurred.",
    });
  }
});
