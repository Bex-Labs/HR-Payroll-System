// ADMIN COMPANY USER BOOTSTRAP - STEP 1A
// Secure server-side invite for creating the first HR/Admin-managed company user.
//
// Description:
// Platform Admin is standalone and does not belong to a company tenant.
// This function allows Platform Admin to invite a company-scoped HR user
// directly into a selected company workspace without logging into that company
// and without manually creating users in Supabase.
//
// Behaviour:
// - Only active platform Admin can call this function.
// - Admin provides fullName, email, tenantId, companyName, and role.
// - Function sends Supabase invite email.
// - Function creates/updates public.profiles with the selected company tenant.
// - Function does not create employee records.
// - Function does not modify employees.user_id.
// - HR employee onboarding continues to use invite-employee-login separately.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ADMIN COMPANY USER BOOTSTRAP - STEP 1A
// Admin may bootstrap company users into these company-scoped roles only.
// Do not allow platform admin creation from this company bootstrap flow.
const allowedCompanyRoles = new Set([
    "hr",
    "hr_manager",
    "payroll",
    "payroll_manager",
    "manager",
    "employee",
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

function cleanText(value: unknown): string {
    return String(value ?? "").trim();
}

function normaliseEmail(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function normaliseRole(value: unknown): string {
    return cleanText(value).toLowerCase();
}

serve(async (req: Request) => {
    // ADMIN COMPANY USER BOOTSTRAP - STEP 1A
    // Required for browser preflight requests from the Admin dashboard.
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

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { autoRefreshToken: false, persistSession: false } },
        );

        const supabaseUser = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: authHeader } } },
        );

        // ADMIN COMPANY USER BOOTSTRAP - STEP 1A
        // Verify the caller is a signed-in platform Admin.
        const { data: { user: callerUser }, error: callerAuthError } =
            await supabaseUser.auth.getUser();

        if (callerAuthError || !callerUser) {
            return jsonResponse(401, { error: "Unauthorized." });
        }

        const { data: callerProfile, error: callerProfileError } =
            await supabaseAdmin
                .from("profiles")
                .select("id, role, is_active")
                .eq("id", callerUser.id)
                .single();

        if (callerProfileError || !callerProfile) {
            return jsonResponse(403, { error: "Caller profile not found." });
        }

        const callerRole = normaliseRole(callerProfile.role);

        if (callerRole !== "admin" || callerProfile.is_active === false) {
            return jsonResponse(403, {
                error: "Only active platform Admin users can invite company users.",
            });
        }

        let payload: Record<string, unknown>;

        try {
            payload = await req.json();
        } catch {
            return jsonResponse(400, { error: "Invalid JSON in request body." });
        }

        const fullName = cleanText(payload.fullName);
        const email = normaliseEmail(payload.email);
        const tenantId = cleanText(payload.tenantId);
        const companyName = cleanText(payload.companyName) || "Your Company";
        const role = normaliseRole(payload.role || "hr");

        if (!fullName) {
            return jsonResponse(400, { error: "Full name is required." });
        }

        if (!email) {
            return jsonResponse(400, { error: "Email address is required." });
        }

        if (!tenantId) {
            return jsonResponse(400, { error: "Company workspace is required." });
        }

        if (!allowedCompanyRoles.has(role)) {
            return jsonResponse(400, {
                error: "Selected role is not allowed for company user bootstrap.",
            });
        }

        // ADMIN COMPANY USER BOOTSTRAP - STEP 1A
        // Confirm the selected company exists and is active before assigning access.
        const { data: tenant, error: tenantError } = await supabaseAdmin
            .from("tenants")
            .select("id, company_name, tenant_code, status")
            .eq("id", tenantId)
            .single();

        if (tenantError || !tenant) {
            return jsonResponse(404, {
                error: "Selected company workspace could not be found.",
            });
        }

        if (cleanText(tenant.status).toLowerCase() !== "active") {
            return jsonResponse(400, {
                error: "Selected company workspace is not active.",
            });
        }

        const resolvedCompanyName = cleanText(tenant.company_name) || companyName;

        // ADMIN COMPANY USER BOOTSTRAP - STEP 1A
        // APP_URL should be the Vercel/test application base URL in Supabase secrets.
        // The invite returns to first-time password setup, matching the employee invite fix.
        const appOrigin = cleanText(Deno.env.get("APP_URL")) ||
            cleanText(req.headers.get("origin"));

        const redirectTo = appOrigin
            ? `${appOrigin}/reset-password.html?mode=first-time`
            : "/reset-password.html?mode=first-time";

        const { data: inviteData, error: inviteError } =
            await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
                data: {
                    full_name: fullName,
                    company_name: resolvedCompanyName,
                    tenant_id: tenant.id,
                    tenant_code: tenant.tenant_code,
                    role,
                },
                redirectTo,
            });

        if (inviteError) {
            const message = cleanText(inviteError.message).toLowerCase();

            if (
                message.includes("already registered") ||
                message.includes("already been registered") ||
                message.includes("user already exists")
            ) {
                return jsonResponse(409, {
                    error: `A login account already exists for ${email}. Use User Access Setup to assign or update company access.`,
                });
            }

            console.error("invite-company-user invite error:", inviteError);
            throw new Error(inviteError.message || "Company user invite could not be sent.");
        }

        const newUserId = inviteData?.user?.id;

        if (!newUserId) {
            return jsonResponse(500, {
                error: "Invite was sent but the created user id could not be resolved.",
            });
        }

        // ADMIN COMPANY USER BOOTSTRAP - STEP 1A
        // Create/update profile so login routing and tenant validation work immediately.
        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .upsert(
                {
                    id: newUserId,
                    email,
                    full_name: fullName,
                    role,
                    tenant_id: tenant.id,
                    is_active: true,
                    must_change_password: false,
                    department: role.includes("payroll") ? "Payroll" : "Human Resources",
                },
                { onConflict: "id" },
            );

        if (profileError) {
            console.error("invite-company-user profile upsert error:", profileError);

            return jsonResponse(500, {
                error:
                    "Invite was sent, but the company user profile could not be created.",
            });
        }

        return jsonResponse(200, {
            success: true,
            message: `${fullName} has been invited as ${role} for ${resolvedCompanyName}.`,
            userId: newUserId,
            email,
            role,
            tenantId: tenant.id,
            companyName: resolvedCompanyName,
            tenantCode: tenant.tenant_code,
        });
    } catch (error) {
        console.error("invite-company-user unexpected error:", error);

        return jsonResponse(500, {
            error:
                cleanText((error as Error).message) ||
                "An unexpected error occurred while inviting the company user.",
        });
    }
});