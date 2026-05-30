document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("loginForm");

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
  // Company/Tenant ID is collected during login before tenant validation
  // is wired in the next step.
  const loginTenantCodeInput = document.getElementById("loginTenantCode");

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const alertContainer = document.getElementById("loginAlertContainer");
  const togglePasswordBtn = document.getElementById("togglePasswordBtn");
  const togglePasswordIcon = document.getElementById("togglePasswordIcon");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");

  const SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
  );

  window.SUPABASE_URL = "https://zoeglonuxkiwnaabzjqo.supabase.co";
  window.SUPABASE_ANON_KEY = "sb_publishable_zNz3vsLoaw9ul1UmwEDAMg_YX-MxMG_";

  const supabaseClient = window.supabaseClient;
  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Dedicated browser cache key for the validated tenant/company context.
  // This allows dashboards to know which company workspace the signed-in user belongs to.
  const TENANT_CONTEXT_STORAGE_KEY = "hrPayrollTenantContext";
  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Matches the safe post-login redirect key used by session.js.
  const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

  function showAlert(message, type) {
    if (!alertContainer) return;

    alertContainer.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    `;
  }

  function clearValidationStates() {
    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
    // Clear Tenant ID validation together with existing login fields.
    if (loginTenantCodeInput) loginTenantCodeInput.classList.remove("is-invalid");

    if (emailInput) emailInput.classList.remove("is-invalid");
    if (passwordInput) passwordInput.classList.remove("is-invalid");
  }

  /* =========================================================
     Role-to-dashboard routing
  ========================================================= */
  function getDashboardByRole(role) {
    const roleRoutes = {
      employee: "/employee-dashboard.html",
      manager: "/manager-dashboard.html",
      hr: "/hr-dashboard.html",
      admin: "/admin-dashboard.html",
    };

    return roleRoutes[role] || "/index.html";
  }

  // PAYSLIP EMAIL DEEP LINK ROUTING - STEP 4A
  // Return a stored safe post-login payroll destination based on the signed-in
  // user's role. Payslip email login also carries source=payslip-email so the
  // Employee Dashboard can open Payroll History by default only for this journey.
  function getSafePostLoginRedirectForRole(role = "") {
    const userRole = String(role || "").trim().toLowerCase();

    try {
      const storedRedirect = sessionStorage.getItem(
        POST_LOGIN_REDIRECT_STORAGE_KEY,
      );

      sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);

      const isPayslipEmailRedirect =
        storedRedirect === "/employee-dashboard.html?section=payroll&source=payslip-email";

      const isStandardPayrollRedirect = [
        "/employee-dashboard.html?section=payroll",
        "/hr-dashboard.html?workspace=selfservice&section=payroll",
      ].includes(storedRedirect);

      if (!isPayslipEmailRedirect && !isStandardPayrollRedirect) {
        return "";
      }

      if (userRole === "employee") {
        return isPayslipEmailRedirect
          ? "/employee-dashboard.html?section=payroll&source=payslip-email"
          : "/employee-dashboard.html?section=payroll";
      }

      if (userRole === "hr") {
        return "/hr-dashboard.html?workspace=selfservice&section=payroll";
      }
    } catch (error) {
      console.warn("Safe post-login redirect could not be resolved:", error);
    }

    return "";
  }

  // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4C
  // The email button opens the public login/landing page first.
  // When ?payslip=1&source=payslip-email is present, cache a safe payroll
  // destination for after successful login. The source flag is intentionally
  // preserved so Employee Dashboard can open Payroll History automatically
  // only for this email journey.
  // No payroll ID, salary value, bank detail, employee ID, or arbitrary URL is stored.
  function cachePayslipEmailLandingIntentFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const isPayslipEmailLanding =
        String(params.get("payslip") || "").trim() === "1" &&
        String(params.get("source") || "").trim() === "payslip-email";

      if (!isPayslipEmailLanding) return;

      sessionStorage.setItem(
        POST_LOGIN_REDIRECT_STORAGE_KEY,
        "/employee-dashboard.html?section=payroll&source=payslip-email",
      );
    } catch (error) {
      console.warn("Payslip email landing intent could not be cached:", error);
    }
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-3
  // Validate the entered Company/Tenant ID after Supabase email/password
  // authentication succeeds. This uses the safe database function created in
  // Step 1F-1 and does not directly query or update tenant/profile tables here.
  async function validateTenantLoginForSignedInUser(loginTenantCode = "") {
    const cleanTenantCode = String(loginTenantCode || "").trim().toUpperCase();

    const { data, error } = await supabaseClient.rpc(
      "validate_current_user_tenant_login",
      {
        input_tenant_code: cleanTenantCode,
      },
    );

    if (error) {
      throw error;
    }

    const validationResult = Array.isArray(data) ? data[0] : data;

    return {
      isValid: Boolean(validationResult?.is_valid),
      tenantId: validationResult?.tenant_id || null,
      tenantCode: validationResult?.tenant_code || cleanTenantCode,
      companyName: validationResult?.company_name || "",
      reason:
        validationResult?.reason ||
        "Tenant login validation failed. Please check your Company/Tenant ID.",
    };
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Store the validated tenant context after login succeeds.
  // This is only written after the database confirms the user belongs to
  // the entered Company/Tenant ID.
  function cacheValidatedTenantContext({
    userId = "",
    tenantId = "",
    tenantCode = "",
    companyName = "",
  } = {}) {
    const tenantContext = {
      userId,
      tenantId,
      tenantCode: String(tenantCode || "").trim().toUpperCase(),
      companyName: String(companyName || "").trim(),
      cachedAt: new Date().toISOString(),
    };

    localStorage.setItem(
      TENANT_CONTEXT_STORAGE_KEY,
      JSON.stringify(tenantContext),
    );

    return tenantContext;
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Read the cached tenant context safely.
  // If the cache is missing or corrupted, return null and let login continue normally.
  function getCachedTenantContext() {
    try {
      const rawValue = localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY);
      if (!rawValue) return null;

      const parsedValue = JSON.parse(rawValue);

      if (!parsedValue?.tenantCode) {
        return null;
      }

      return parsedValue;
    } catch (error) {
      localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
      return null;
    }
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // If a tenant was validated earlier and the cache still exists, prefill the
  // Company/Tenant ID field so the user does not need to retype it.
  function prefillTenantCodeFromCache() {
    if (!loginTenantCodeInput || loginTenantCodeInput.value) return;

    const cachedTenant = getCachedTenantContext();
    if (!cachedTenant?.tenantCode) return;

    loginTenantCodeInput.value = cachedTenant.tenantCode;
  }

  async function handleForgotPassword(event) {
    event.preventDefault();

    if (!emailInput) return;

    clearValidationStates();
    alertContainer.innerHTML = "";

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      emailInput.classList.add("is-invalid");
      showAlert(
        "Enter your email address first, then click Forgot password again.",
        "warning",
      );
      return;
    }

    const resetRedirectUrl = `${window.location.origin}/reset-password.html?mode=recovery`;

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: resetRedirectUrl,
      });

      if (error) {
        showAlert(
          error.message || "Password reset request could not be sent.",
          "danger",
        );
        return;
      }

      showAlert(
        `A password reset link has been sent to <strong>${email}</strong>. Please check your inbox.`,
        "success",
      );
    } catch (error) {
      console.error("Forgot password error:", error);
      showAlert(
        "An unexpected error occurred while sending reset email.",
        "danger",
      );
    }
  }

  function showMessageFromQueryString() {
    const params = new URLSearchParams(window.location.search);
    const message = params.get("message");

    if (!message) return;

    switch (message) {
      case "session-timeout":
        showAlert(
          "Your session expired due to inactivity. Please sign in again.",
          "warning",
        );
        break;
      case "session-expired":
        showAlert("Your session has expired. Please sign in again.", "warning");
        break;
      case "unauthorized":
        showAlert("You are not authorized to access that page.", "danger");
        break;
      case "password-reset-success":
        showAlert(
          "Your password has been reset successfully. You can now sign in.",
          "success",
        );
        break;
      case "first-time-setup-success":
        showAlert(
          "Your account setup is complete. Please sign in with your new password.",
          "success",
        );
        break;
      default:
        break;
    }
  }

  if (togglePasswordBtn && passwordInput && togglePasswordIcon) {
    togglePasswordBtn.addEventListener("click", function () {
      const isPasswordHidden =
        passwordInput.getAttribute("type") === "password";

      passwordInput.setAttribute(
        "type",
        isPasswordHidden ? "text" : "password",
      );

      togglePasswordIcon.className = isPasswordHidden
        ? "bi bi-eye-slash"
        : "bi bi-eye";
    });
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", handleForgotPassword);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      clearValidationStates();
      alertContainer.innerHTML = "";

      // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-2
      // Capture Company/Tenant ID from the login form.
      // Full Supabase tenant validation is added in the next step.
      const loginTenantCode = String(loginTenantCodeInput?.value || "")
        .trim()
        .toUpperCase();

      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;

      let isValid = true;

      // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
      // Do not block blank Tenant ID at this early stage.
      // We must first sign in and read the profile role, because Admin/System Admin
      // can log in without Tenant ID while other roles still require it later.
      if (!email) {
        emailInput.classList.add("is-invalid");
        isValid = false;
      }

      if (!password) {
        passwordInput.classList.add("is-invalid");
        isValid = false;
      }

      if (!isValid) {
        // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
        // Tenant ID is role-dependent. Admin can skip it, but username/email
        // and password are always required for Supabase authentication.
        showAlert(
          "Please enter username/email and password.",
          "warning",
        );
        return;
      }

      const submitButton = loginForm.querySelector("button[type='submit']");
      const originalButtonHtml = submitButton.innerHTML;

      submitButton.disabled = true;
      submitButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Signing In...`;

      try {
        const { data: authData, error: authError } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password,
          });

        if (authError) {
          showAlert(
            authError.message || "Invalid credentials. Please try again.",
            "danger",
          );
          return;
        }

        if (!authData || !authData.user) {
          showAlert(
            "Sign-in could not be completed. Please try again.",
            "danger",
          );
          return;
        }

        const { data: profile, error: profileError } = await supabaseClient
          .from("profiles")
          .select(
            "id, email, full_name, role, department, is_active, must_change_password",
          )
          .eq("id", authData.user.id)
          .single();

        if (profileError) {
          console.error("Profile fetch error:", profileError);
          showAlert(
            "You signed in successfully, but your profile record could not be found. Please contact support.",
            "warning",
          );
          return;
        }

        if (!profile) {
          showAlert(
            "You signed in successfully, but no profile is attached to your account.",
            "warning",
          );
          return;
        }

        if (profile.is_active === false) {
          showAlert(
            "Your account is inactive. Please contact support.",
            "danger",
          );
          await supabaseClient.auth.signOut();
          return;
        }

        // Admin is a platform-level owner. They can log in without a
        // Company/Tenant ID so they can create tenants and assign users.
        // Tenant validation remains mandatory for all other roles.
        const userRole = String(profile.role || "").trim().toLowerCase();
        const isPlatformAdmin = userRole === "admin";

        if (!isPlatformAdmin && !loginTenantCode) {
          localStorage.removeItem("hrPayrollSession");
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          loginTenantCodeInput?.classList.add("is-invalid");

          showAlert(
            "Company/Tenant ID is required for this user role.",
            "warning",
          );

          return;
        }

        // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-3
        // Email/password sign-in succeeded. Non-admin users must belong to the
        // entered Company/Tenant ID before the app creates a local session or redirects.
        let tenantValidation;

        try {
          // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
          // Platform Admin bypasses tenant validation. Other roles still use the
          // tenant validation RPC exactly as before.
          tenantValidation = isPlatformAdmin
            ? {
              isValid: true,
              tenantId: null,
              tenantCode: "",
              companyName: "Platform Admin",
              reason: "Admin tenant validation bypassed.",
            }
            : await validateTenantLoginForSignedInUser(loginTenantCode);
        } catch (tenantValidationError) {
          console.error("Tenant login validation error:", tenantValidationError);

          localStorage.removeItem("hrPayrollSession");

          // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
          // Clear any previous tenant context if tenant validation fails.
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          showAlert(
            "Tenant validation could not be completed. Please try again or contact support.",
            "danger",
          );

          return;
        }

        if (!tenantValidation.isValid) {
          localStorage.removeItem("hrPayrollSession");

          // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
          // Wrong tenant login must not leave an old tenant/company cached locally.
          localStorage.removeItem("hrPayrollTenantContext");

          await supabaseClient.auth.signOut();

          loginTenantCodeInput?.classList.add("is-invalid");

          showAlert(
            tenantValidation.reason ||
            "The entered Company/Tenant ID is not linked to this user profile.",
            "warning",
          );

          return;
        }

        // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
        // Cache tenant context only for tenant-based users.
        // Platform Admin does not belong to one tenant and should not inherit a stale
        // tenant cache from a previous login.
        let cachedTenantContext = null;

        if (isPlatformAdmin) {
          localStorage.removeItem("hrPayrollTenantContext");
        } else {
          cachedTenantContext = cacheValidatedTenantContext({
            userId: authData.user.id,
            tenantId: tenantValidation.tenantId,
            tenantCode: tenantValidation.tenantCode,
            companyName: tenantValidation.companyName,
          });
        }

        localStorage.setItem(
          "hrPayrollSession",
          JSON.stringify({
            userId: authData.user.id,
            email: profile.email || authData.user.email,
            fullName: profile.full_name || "",
            role: profile.role,
            department: profile.department || "",

            // HRP-80 - ADMIN TENANT LOGIN EXEMPTION - STEP 4B
            // Admin is platform-level. Other roles retain tenant context.
            tenantId: cachedTenantContext?.tenantId || null,
            tenantCode: cachedTenantContext?.tenantCode || "",
            companyName: cachedTenantContext?.companyName || "Platform Admin",

            loginTime: new Date().toISOString(),
          }),
        );

        if (profile.must_change_password === true) {
          showAlert(
            "First-time setup required. Redirecting you to set a new password...",
            "warning",
          );

          setTimeout(function () {
            window.location.href = "/reset-password.html?mode=first-time";
          }, 1200);

          return;
        }

        const redirectTarget =
          getSafePostLoginRedirectForRole(profile.role) ||
          getDashboardByRole(profile.role);

        showAlert(
          `Sign-in successful. Welcome <strong>${profile.full_name || authData.user.email}</strong>. Company: <strong>${tenantValidation.companyName || tenantValidation.tenantCode}</strong>. Redirecting...`,
          "success",
        );

        console.log("Supabase sign-in success:", {
          userId: authData.user.id,
          email: profile.email || authData.user.email,
          role: profile.role,
          redirectTarget,
          source: "profiles.role",
        });

        setTimeout(function () {
          window.location.href = redirectTarget;
        }, 1200);
      } catch (unexpectedError) {
        console.error("Unexpected sign-in error:", unexpectedError);
        showAlert("An unexpected error occurred while signing in.", "danger");
      } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonHtml;
      }
    });
  }

  // PAYSLIP EMAIL LANDING LINK QUICK FIX - STEP 4C
  // Cache safe payroll intent once before sign-in so the user lands on Payroll
  // after authentication without first touching a protected dashboard URL.
  cachePayslipEmailLandingIntentFromUrl();

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-4
  // Prefill Company/Tenant ID if a valid tenant context is already cached.
  prefillTenantCodeFromCache();

  showMessageFromQueryString();
});
