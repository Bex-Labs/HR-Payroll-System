/**
 * Unit tests – app.js: Role-based routing & redirect logic
 * BexHR HR-Payroll-System
 */

const {
  getDashboardByRole,
  getSafePostLoginRedirectForRole,
  POST_LOGIN_REDIRECT_STORAGE_KEY,
} = require("./helpers/app-utils");

// ---------------------------------------------------------------------------
// getDashboardByRole
// ---------------------------------------------------------------------------
describe("getDashboardByRole", () => {
  test("returns /employee-dashboard.html for role 'employee'", () => {
    expect(getDashboardByRole("employee")).toBe("/employee-dashboard.html");
  });

  test("returns /manager-dashboard.html for role 'manager'", () => {
    expect(getDashboardByRole("manager")).toBe("/manager-dashboard.html");
  });

  test("returns /hr-dashboard.html for role 'hr'", () => {
    expect(getDashboardByRole("hr")).toBe("/hr-dashboard.html");
  });

  test("returns /admin-dashboard.html for role 'admin'", () => {
    expect(getDashboardByRole("admin")).toBe("/admin-dashboard.html");
  });

  test("returns /index.html for an unknown role", () => {
    expect(getDashboardByRole("superuser")).toBe("/index.html");
  });

  test("returns /index.html for an empty string role", () => {
    expect(getDashboardByRole("")).toBe("/index.html");
  });

  test("returns /index.html when role is undefined", () => {
    expect(getDashboardByRole(undefined)).toBe("/index.html");
  });

  test("is case-sensitive – 'Admin' (capitalised) falls back to /index.html", () => {
    expect(getDashboardByRole("Admin")).toBe("/index.html");
  });

  test("is case-sensitive – 'EMPLOYEE' (all-caps) falls back to /index.html", () => {
    expect(getDashboardByRole("EMPLOYEE")).toBe("/index.html");
  });
});

// ---------------------------------------------------------------------------
// getSafePostLoginRedirectForRole
// ---------------------------------------------------------------------------
describe("getSafePostLoginRedirectForRole", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test("returns payroll URL when role is 'employee' and the redirect is stored", () => {
    sessionStorage.setItem(
      POST_LOGIN_REDIRECT_STORAGE_KEY,
      "/employee-dashboard.html?section=payroll",
    );
    expect(getSafePostLoginRedirectForRole("employee")).toBe(
      "/employee-dashboard.html?section=payroll",
    );
  });

  test("returns empty string for non-employee role even if redirect is stored", () => {
    sessionStorage.setItem(
      POST_LOGIN_REDIRECT_STORAGE_KEY,
      "/employee-dashboard.html?section=payroll",
    );
    expect(getSafePostLoginRedirectForRole("hr")).toBe("");
  });

  test("returns empty string when no redirect is stored", () => {
    expect(getSafePostLoginRedirectForRole("employee")).toBe("");
  });

  test("removes the stored redirect after reading it (single-use)", () => {
    sessionStorage.setItem(
      POST_LOGIN_REDIRECT_STORAGE_KEY,
      "/employee-dashboard.html?section=payroll",
    );
    getSafePostLoginRedirectForRole("employee");
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  test("returns empty string for 'admin' role even when redirect is stored", () => {
    sessionStorage.setItem(
      POST_LOGIN_REDIRECT_STORAGE_KEY,
      "/employee-dashboard.html?section=payroll",
    );
    expect(getSafePostLoginRedirectForRole("admin")).toBe("");
  });

  test("handles null role gracefully", () => {
    expect(getSafePostLoginRedirectForRole(null)).toBe("");
  });

  test("handles uppercase 'EMPLOYEE' role – no match (case-sensitive normalisation)", () => {
    sessionStorage.setItem(
      POST_LOGIN_REDIRECT_STORAGE_KEY,
      "/employee-dashboard.html?section=payroll",
    );
    // role is trimmed + lowercased inside the function, so 'EMPLOYEE' becomes 'employee'
    expect(getSafePostLoginRedirectForRole("EMPLOYEE")).toBe(
      "/employee-dashboard.html?section=payroll",
    );
  });
});
