/**
 * Pure utility helpers extracted from js/app.js for unit testing.
 * These mirror the real implementations exactly so tests validate
 * production behaviour without modifying the source files.
 */

const TENANT_CONTEXT_STORAGE_KEY = "hrPayrollTenantContext";
const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

// ---------------------------------------------------------------------------
// Role → dashboard routing (app.js: getDashboardByRole)
// ---------------------------------------------------------------------------
function getDashboardByRole(role) {
  const roleRoutes = {
    employee: "/employee-dashboard.html",
    manager: "/manager-dashboard.html",
    hr: "/hr-dashboard.html",
    admin: "/admin-dashboard.html",
  };
  return roleRoutes[role] || "/index.html";
}

// ---------------------------------------------------------------------------
// Safe post-login redirect (app.js: getSafePostLoginRedirectForRole)
// ---------------------------------------------------------------------------
function getSafePostLoginRedirectForRole(role = "") {
  const userRole = String(role || "").trim().toLowerCase();
  try {
    const storedRedirect = sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
    if (
      userRole === "employee" &&
      storedRedirect === "/employee-dashboard.html?section=payroll"
    ) {
      return storedRedirect;
    }
  } catch (error) {
    console.warn("Safe post-login redirect could not be resolved:", error);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Tenant context caching (app.js: cacheValidatedTenantContext)
// ---------------------------------------------------------------------------
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
  localStorage.setItem(TENANT_CONTEXT_STORAGE_KEY, JSON.stringify(tenantContext));
  return tenantContext;
}

// ---------------------------------------------------------------------------
// Tenant context retrieval (app.js: getCachedTenantContext)
// ---------------------------------------------------------------------------
function getCachedTenantContext() {
  try {
    const rawValue = localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY);
    if (!rawValue) return null;
    const parsedValue = JSON.parse(rawValue);
    if (!parsedValue?.tenantCode) return null;
    return parsedValue;
  } catch (error) {
    localStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Alert HTML builder (app.js: showAlert)
// ---------------------------------------------------------------------------
function buildAlertHTML(message, type) {
  return `<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>`;
}

// ---------------------------------------------------------------------------
// Message-from-querystring mapping (app.js: showMessageFromQueryString)
// ---------------------------------------------------------------------------
function getMessageFromQueryString(search) {
  const params = new URLSearchParams(search);
  const message = params.get("message");
  if (!message) return null;

  const map = {
    "session-timeout": {
      text: "Your session expired due to inactivity. Please sign in again.",
      type: "warning",
    },
    "session-expired": {
      text: "Your session has expired. Please sign in again.",
      type: "warning",
    },
    unauthorized: {
      text: "You are not authorized to access that page.",
      type: "danger",
    },
    "password-reset-success": {
      text: "Your password has been reset successfully. You can now sign in.",
      type: "success",
    },
    "first-time-setup-success": {
      text: "Your account setup is complete. Please sign in with your new password.",
      type: "success",
    },
  };

  return map[message] || null;
}

module.exports = {
  getDashboardByRole,
  getSafePostLoginRedirectForRole,
  cacheValidatedTenantContext,
  getCachedTenantContext,
  buildAlertHTML,
  getMessageFromQueryString,
  TENANT_CONTEXT_STORAGE_KEY,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
};
