// ADMIN PASSWORD RESET
// Allows an admin to set a temporary password for any non-admin user.
//
// The admin dashboard calls this function with the target user's email and
// a new temporary password chosen by the admin. The function:
//   1. Verifies the caller is an active admin via their JWT.
//   2. Looks up the target user's auth UUID via the profiles table.
//   3. Prevents resetting another admin's password as a safety guard.
//   4. Updates the password via the Supabase admin API (service role key —
//      never exposed to the browser).
//   5. Marks must_change_password = true so the employee is prompted to
//      update their password on next login.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

serve(async (req: Request) => {
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

    // Admin client — uses service role key, never sent to the browser.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // User-scoped client — verifies caller's JWT.
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verify caller identity.
    const { data: { user: callerUser }, error: callerAuthError } =
      await supabaseUser.auth.getUser();

    if (callerAuthError || !callerUser) {
      return jsonResponse(401, { error: "Unauthorized." });
    }

    // Verify caller has an active admin profile.
    const { data: callerProfile, error: callerProfileError } =
      await supabaseAdmin
        .from("profiles")
        .select("role, is_active")
        .eq("id", callerUser.id)
        .single();

    if (callerProfileError || !callerProfile) {
      return jsonResponse(403, { error: "Caller profile not found." });
    }

    if (
      cleanText(callerProfile.role).toLowerCase() !== "admin" ||
      callerProfile.is_active === false
    ) {
      return jsonResponse(403, {
        error: "Only admins can reset employee passwords.",
      });
    }

    // Parse and validate request body.
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON in request body." });
    }

    const targetEmail = cleanText(payload.targetEmail).toLowerCase();
    const tempPassword = cleanText(payload.tempPassword);

    if (!targetEmail) {
      return jsonResponse(400, { error: "targetEmail is required." });
    }

    if (!tempPassword || tempPassword.length < 8) {
      return jsonResponse(400, {
        error: "Temporary password must be at least 8 characters.",
      });
    }

    // Look up the target user's auth UUID via the profiles table.
    const { data: targetProfile, error: profileLookupError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, full_name, role, is_active")
        .eq("email", targetEmail)
        .maybeSingle();

    if (profileLookupError) {
      console.error("Profile lookup error:", profileLookupError);
      return jsonResponse(500, { error: "Could not look up the target user." });
    }

    if (!targetProfile) {
      return jsonResponse(404, {
        error: `No user account found for ${targetEmail}.`,
      });
    }

    // Safety guard: admins cannot reset another admin's password.
    if (
      cleanText(targetProfile.role).toLowerCase() === "admin" &&
      targetProfile.id !== callerUser.id
    ) {
      return jsonResponse(403, {
        error: "Admin passwords cannot be reset by other admins.",
      });
    }

    // Set the new password via the Supabase admin API.
    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(targetProfile.id, {
        password: tempPassword,
      });

    if (updateError) {
      console.error("Password update error:", updateError);
      return jsonResponse(500, {
        error: updateError.message || "Password could not be reset.",
      });
    }

    // Flag the account so the employee is prompted to change their password.
    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", targetProfile.id);

    return jsonResponse(200, {
      success: true,
      message: `Password reset successfully for ${targetEmail}.`,
    });
  } catch (error) {
    console.error("reset-employee-password unexpected error:", error);
    return jsonResponse(500, {
      error:
        cleanText((error as Error).message) ||
        "An unexpected error occurred.",
    });
  }
});
