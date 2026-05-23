/**
 * Unit tests – session.js: Role matching, redirects, logout routing,
 *               and safe payroll redirect caching
 * BexHR HR-Payroll-System
 */

const {
  roleMatches,
  getRedirectTargetForRole,
  getLogoutRedirectUrl,
  cacheSafePostLoginRedirect,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
} = require("./helpers/session-utils");

// ---------------------------------------------------------------------------
// roleMatches
// ---------------------------------------------------------------------------
describe("roleMatches", () => {
  test("returns true when expectedRole is null (public page)", () => {
    expect(roleMatches(null, "employee")).toBe(true);
  });

  test("returns true when expectedRole is undefined (public page)", () => {
    expect(roleMatches(undefined, "hr")).toBe(true);
  });

  test("returns true when single role string matches", () => {
    expect(roleMatches("admin", "admin")).toBe(true);
  });

  test("returns false when single role string does not match", () => {
    expect(roleMatches("admin", "employee")).toBe(false);
  });

  test("returns true when role is in an allowed array", () => {
    expect(roleMatches(["hr", "admin"], "hr")).toBe(true);
  });

  test("returns true when role is the only item in an allowed array", () => {
    expect(roleMatches(["manager"], "manager")).toBe(true);
  });

  test("returns false when role is not in the allowed array", () => {
    expect(roleMatches(["hr", "admin"], "employee")).toBe(false);
  });

  test("is case-sensitive – 'Admin' does not match 'admin'", () => {
    expect(roleMatches("admin", "Admin")).toBe(false);
  });

  test("returns false for an empty string role against a specified role", () => {
    expect(roleMatches("admin", "")).toBe(false);
  });

  test("handles an empty array as expectedRole", () => {
    expect(roleMatches([], "admin")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRedirectTargetForRole
// ---------------------------------------------------------------------------
describe("getRedirectTargetForRole", () => {
  test("returns admin-dashboard.html for 'admin'", () => {
    expect(getRedirectTargetForRole("admin")).toBe("admin-dashboard.html");
  });

  test("returns employee-dashboard.html for 'employee'", () => {
    expect(getRedirectTargetForRole("employee")).toBe("employee-dashboard.html");
  });

  test("returns manager-dashboard.html for 'manager'", () => {
    expect(getRedirectTargetForRole("manager")).toBe("manager-dashboard.html");
  });

  test("returns hr-dashboard.html for 'hr'", () => {
    expect(getRedirectTargetForRole("hr")).toBe("hr-dashboard.html");
  });

  test("returns index.html?message=no-role-dashboard for an unknown role", () => {
    expect(getRedirectTargetForRole("guest")).toBe(
      "index.html?message=no-role-dashboard",
    );
  });

  test("returns index.html?message=no-role-dashboard for an empty string", () => {
    expect(getRedirectTargetForRole("")).toBe(
      "index.html?message=no-role-dashboard",
    );
  });

  test("returns index.html?message=no-role-dashboard when role is undefined", () => {
    expect(getRedirectTargetForRole(undefined)).toBe(
      "index.html?message=no-role-dashboard",
    );
  });
});

// ---------------------------------------------------------------------------
// getLogoutRedirectUrl
// ---------------------------------------------------------------------------
describe("getLogoutRedirectUrl", () => {
  test("returns session-timeout URL for 'timeout'", () => {
    expect(getLogoutRedirectUrl("timeout")).toBe(
      "index.html?message=session-timeout",
    );
  });

  test("returns session-expired URL for 'expired'", () => {
    expect(getLogoutRedirectUrl("expired")).toBe(
      "index.html?message=session-expired",
    );
  });

  test("returns unauthorized URL for 'unauthorized'", () => {
    expect(getLogoutRedirectUrl("unauthorized")).toBe(
      "index.html?message=unauthorized",
    );
  });

  test("returns plain index.html for default 'logout'", () => {
    expect(getLogoutRedirectUrl("logout")).toBe("index.html");
  });

  test("returns plain index.html when no reason is provided", () => {
    expect(getLogoutRedirectUrl()).toBe("index.html");
  });

  test("returns plain index.html for an unrecognised reason", () => {
    expect(getLogoutRedirectUrl("unknown-reason")).toBe("index.html");
  });
});

// ---------------------------------------------------------------------------
// cacheSafePostLoginRedirect
// ---------------------------------------------------------------------------
describe("cacheSafePostLoginRedirect", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test("caches the payroll redirect for employee-dashboard with ?section=payroll", () => {
    const cached = cacheSafePostLoginRedirect(
      "/employee-dashboard.html",
      "?section=payroll",
    );
    expect(cached).toBe(true);
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBe(
      "/employee-dashboard.html?section=payroll",
    );
  });

  test("works when path uses relative form (no leading slash)", () => {
    const cached = cacheSafePostLoginRedirect(
      "employee-dashboard.html",
      "?section=payroll",
    );
    expect(cached).toBe(true);
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBe(
      "/employee-dashboard.html?section=payroll",
    );
  });

  test("does NOT cache when section is not 'payroll'", () => {
    const cached = cacheSafePostLoginRedirect(
      "/employee-dashboard.html",
      "?section=leave",
    );
    expect(cached).toBe(false);
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  test("does NOT cache for a non-employee dashboard path", () => {
    const cached = cacheSafePostLoginRedirect(
      "/hr-dashboard.html",
      "?section=payroll",
    );
    expect(cached).toBe(false);
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  test("does NOT cache when section param is missing", () => {
    const cached = cacheSafePostLoginRedirect("/employee-dashboard.html", "");
    expect(cached).toBe(false);
  });

  test("section matching is case-insensitive (PAYROLL → payroll)", () => {
    const cached = cacheSafePostLoginRedirect(
      "/employee-dashboard.html",
      "?section=PAYROLL",
    );
    expect(cached).toBe(true);
  });
});
