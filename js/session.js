// js/session.js

(function () {
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1F-5
  // Central storage keys used by login and dashboard session handling.
  // Tenant context must be cleared whenever the user logs out or the session ends.
  const APP_SESSION_STORAGE_KEY = "hrPayrollSession";
  const TENANT_CONTEXT_STORAGE_KEY = "hrPayrollTenantContext";

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Stores a safe post-login destination when an employee opens a protected
  // payroll notification link while signed out.
  const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

  let idleTimer = null;
  let activityListenersAttached = false;
  let authListenerAttached = false;

  function getSupabaseClient() {
    // Single agreed global client name for the whole app
    if (!window.supabaseClient) {
      console.error("Supabase client is not available on window.supabaseClient");
      return null;
    }
    return window.supabaseClient;
  }

  async function getSession() {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("Error getting session:", error.message);
      return null;
    }

    return data?.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  /* =========================================================
     Expanded profile fetch
     ---------------------------------------------------------
     Safe expansion for manager dashboard and future stories.
     Existing pages that only need a subset will continue to work.
  ========================================================= */
  async function getProfile(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, email, full_name, role, department, is_active, must_change_password",
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching profile:", error.message);
      return null;
    }

    return data;
  }

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Preserve only the safe employee payroll landing path before redirecting
  // unauthenticated users to login. Do not store payroll IDs, salary values,
  // bank details, or arbitrary URLs.
  function cacheSafePostLoginRedirect() {
    try {
      const currentPath = window.location.pathname || "";
      const currentParams = new URLSearchParams(window.location.search || "");
      const requestedSection = String(currentParams.get("section") || "")
        .trim()
        .toLowerCase();

      const isEmployeeDashboard =
        currentPath.endsWith("/employee-dashboard.html") ||
        currentPath.endsWith("employee-dashboard.html");

      if (isEmployeeDashboard && requestedSection === "payroll") {
        sessionStorage.setItem(
          POST_LOGIN_REDIRECT_STORAGE_KEY,
          "/employee-dashboard.html?section=payroll",
        );
      }
    } catch (error) {
      console.warn("Safe post-login redirect could not be cached:", error);
    }
  }

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - RECOVERY PATCH
  // Clear local browser session data, including the validated tenant/company
  // context. This must exist because logoutUser calls it on logout, timeout,
  // expiry, and unauthorised redirects.
  //
  // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
  // Do not clear sessionStorage here because the safe payroll post-login
  // redirect is temporarily stored there while the user signs back in.
  function clearLocalSessionContext() {
    localStorage.removeItem(APP_SESSION_STORAGE_KEY);
    localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
  }

  async function logoutUser(reason = "logout") {
    const supabase = getSupabaseClient();

    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error("Error during logout:", error);
    }

    clearLocalSessionContext();

    if (reason === "timeout") {
      window.location.href = "index.html?message=session-timeout";
      return;
    }

    if (reason === "expired") {
      window.location.href = "index.html?message=session-expired";
      return;
    }

    if (reason === "unauthorized") {
      window.location.href = "index.html?message=unauthorized";
      return;
    }

    window.location.href = "index.html";
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();

    idleTimer = setTimeout(async () => {
      alert("You have been logged out due to inactivity.");
      await logoutUser("timeout");
    }, IDLE_TIMEOUT_MS);
  }

  function attachActivityListeners() {
    if (activityListenersAttached) return;

    const events = [
      "mousemove",
      "mousedown",
      "click",
      "scroll",
      "keypress",
      "touchstart",
    ];

    events.forEach((eventName) => {
      document.addEventListener(eventName, resetIdleTimer, true);
    });

    activityListenersAttached = true;
  }

  function startIdleTimeout() {
    attachActivityListeners();
    resetIdleTimer();
  }

  function stopIdleTimeout() {
    clearIdleTimer();
  }

  /* =========================================================
     Central role redirect
  ========================================================= */
  function redirectToRoleDashboard(role) {
    switch (role) {
      case "admin":
        window.location.href = "admin-dashboard.html";
        break;
      case "employee":
        window.location.href = "employee-dashboard.html";
        break;
      case "manager":
        window.location.href = "manager-dashboard.html";
        break;
      case "hr":
        window.location.href = "hr-dashboard.html";
        break;
      default:
        window.location.href = "index.html?message=no-role-dashboard";
        break;
    }
  }

  async function requireAuth() {
    const session = await getSession();

    if (!session) {
      // PAYROLL SECURE DELIVERY - STEP 2F-3B-1
      // If the employee opened a safe payroll notification link while signed out,
      // preserve the payroll section destination before redirecting to login.
      cacheSafePostLoginRedirect();

      await logoutUser("expired");
      return null;
    }

    return session;
  }

  /* =========================================================
     Flexible role matching
     ---------------------------------------------------------
     Supports a single role string or an array of roles.
  ========================================================= */
  function roleMatches(expectedRole, actualRole) {
    if (!expectedRole) return true;

    if (Array.isArray(expectedRole)) {
      return expectedRole.includes(actualRole);
    }

    return actualRole === expectedRole;
  }

  async function requireRole(expectedRole) {
    const session = await requireAuth();
    if (!session) return null;

    const profile = await getProfile(session.user.id);

    if (!profile) {
      await logoutUser("unauthorized");
      return null;
    }

    // Optional first-time password enforcement
    if (profile.must_change_password === true) {
      if (!window.location.pathname.endsWith("reset-password.html")) {
        window.location.href = "reset-password.html";
        return null;
      }
    }

    if (!roleMatches(expectedRole, profile.role)) {
      redirectToRoleDashboard(profile.role);
      return null;
    }

    return { session, profile };
  }

  async function protectPage(expectedRole = null) {
    const result = await requireRole(expectedRole);
    if (!result) return null;

    startIdleTimeout();
    attachAuthStateListener();

    return result;
  }

  function attachAuthStateListener() {
    if (authListenerAttached) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        stopIdleTimeout();
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        resetIdleTimer();
      }
    });

    authListenerAttached = true;
  }

  window.SessionManager = {
    getSession,
    getUser,
    getProfile,
    requireAuth,
    requireRole,
    protectPage,
    startIdleTimeout,
    stopIdleTimeout,
    resetIdleTimer,
    logoutUser,
    redirectToRoleDashboard,
  };
})();