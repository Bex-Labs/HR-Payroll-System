/**
 * Pure utility helpers extracted from js/session.js for unit testing.
 * These mirror the real implementations exactly so tests validate
 * production behaviour without modifying the source files.
 */

// ---------------------------------------------------------------------------
// Role matching (session.js: roleMatches)
// ---------------------------------------------------------------------------
function roleMatches(expectedRole, actualRole) {
  if (!expectedRole) return true;
  if (Array.isArray(expectedRole)) {
    return expectedRole.includes(actualRole);
  }
  return actualRole === expectedRole;
}

// ---------------------------------------------------------------------------
// Role → dashboard redirect target (session.js: redirectToRoleDashboard)
// ---------------------------------------------------------------------------
function getRedirectTargetForRole(role) {
  switch (role) {
    case "admin":    return "admin-dashboard.html";
    case "employee": return "employee-dashboard.html";
    case "manager":  return "manager-dashboard.html";
    case "hr":       return "hr-dashboard.html";
    default:         return "index.html?message=no-role-dashboard";
  }
}

// ---------------------------------------------------------------------------
// Logout reason → redirect URL (session.js: logoutUser)
// ---------------------------------------------------------------------------
function getLogoutRedirectUrl(reason = "logout") {
  if (reason === "timeout")      return "index.html?message=session-timeout";
  if (reason === "expired")      return "index.html?message=session-expired";
  if (reason === "unauthorized") return "index.html?message=unauthorized";
  return "index.html";
}

// ---------------------------------------------------------------------------
// Safe payroll redirect caching (session.js: cacheSafePostLoginRedirect)
// ---------------------------------------------------------------------------
const POST_LOGIN_REDIRECT_STORAGE_KEY = "hrPayrollPostLoginRedirect";

function cacheSafePostLoginRedirect(pathname, search) {
  try {
    const currentPath = pathname || "";
    const currentParams = new URLSearchParams(search || "");
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
      return true;
    }
  } catch (error) {
    console.warn("Safe post-login redirect could not be cached:", error);
  }
  return false;
}

module.exports = {
  roleMatches,
  getRedirectTargetForRole,
  getLogoutRedirectUrl,
  cacheSafePostLoginRedirect,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
};
