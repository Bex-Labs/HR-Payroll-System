/**
 * Unit tests – app.js: Tenant / Company context caching & retrieval
 * BexHR HR-Payroll-System
 */

const {
  cacheValidatedTenantContext,
  getCachedTenantContext,
  TENANT_CONTEXT_STORAGE_KEY,
} = require("./helpers/app-utils");

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// cacheValidatedTenantContext
// ---------------------------------------------------------------------------
describe("cacheValidatedTenantContext", () => {
  test("stores the tenant context in localStorage", () => {
    cacheValidatedTenantContext({
      userId: "user-1",
      tenantId: "tenant-abc",
      tenantCode: "abc",
      companyName: "Acme Corp",
    });

    const raw = localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY);
    expect(raw).not.toBeNull();
  });

  test("normalises tenantCode to uppercase", () => {
    const result = cacheValidatedTenantContext({
      userId: "user-1",
      tenantId: "tenant-abc",
      tenantCode: "abc",
      companyName: "Acme Corp",
    });
    expect(result.tenantCode).toBe("ABC");
  });

  test("trims whitespace from tenantCode", () => {
    const result = cacheValidatedTenantContext({
      userId: "user-1",
      tenantId: "tenant-abc",
      tenantCode: "  abc  ",
      companyName: "Acme Corp",
    });
    expect(result.tenantCode).toBe("ABC");
  });

  test("trims whitespace from companyName", () => {
    const result = cacheValidatedTenantContext({
      userId: "user-1",
      tenantId: "tenant-abc",
      tenantCode: "abc",
      companyName: "  Acme Corp  ",
    });
    expect(result.companyName).toBe("Acme Corp");
  });

  test("includes a cachedAt ISO timestamp", () => {
    const result = cacheValidatedTenantContext({
      userId: "u1",
      tenantId: "t1",
      tenantCode: "T1",
      companyName: "Test Co",
    });
    expect(result.cachedAt).toBeDefined();
    expect(() => new Date(result.cachedAt)).not.toThrow();
    expect(new Date(result.cachedAt).toISOString()).toBe(result.cachedAt);
  });

  test("handles missing optional fields gracefully (empty strings)", () => {
    const result = cacheValidatedTenantContext({});
    expect(result.tenantCode).toBe("");
    expect(result.companyName).toBe("");
    expect(result.userId).toBe("");
    expect(result.tenantId).toBe("");
  });

  test("handles call with no argument (default param)", () => {
    expect(() => cacheValidatedTenantContext()).not.toThrow();
  });

  test("overwrites a previously cached tenant context", () => {
    cacheValidatedTenantContext({ userId: "u1", tenantId: "t1", tenantCode: "T1", companyName: "Co1" });
    cacheValidatedTenantContext({ userId: "u2", tenantId: "t2", tenantCode: "T2", companyName: "Co2" });

    const stored = JSON.parse(localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY));
    expect(stored.tenantCode).toBe("T2");
    expect(stored.companyName).toBe("Co2");
  });
});

// ---------------------------------------------------------------------------
// getCachedTenantContext
// ---------------------------------------------------------------------------
describe("getCachedTenantContext", () => {
  test("returns null when nothing is cached", () => {
    expect(getCachedTenantContext()).toBeNull();
  });

  test("returns the cached object when a valid context exists", () => {
    cacheValidatedTenantContext({
      userId: "u1",
      tenantId: "t-123",
      tenantCode: "bex",
      companyName: "Bex Ltd",
    });

    const result = getCachedTenantContext();
    expect(result).not.toBeNull();
    expect(result.tenantCode).toBe("BEX");
    expect(result.companyName).toBe("Bex Ltd");
  });

  test("returns null if the cached value has no tenantCode", () => {
    localStorage.setItem(
      TENANT_CONTEXT_STORAGE_KEY,
      JSON.stringify({ userId: "u1", tenantId: "t1" }),
    );
    expect(getCachedTenantContext()).toBeNull();
  });

  test("returns null and clears the entry if JSON is malformed", () => {
    localStorage.setItem(TENANT_CONTEXT_STORAGE_KEY, "not-valid-json{{{");
    expect(getCachedTenantContext()).toBeNull();
    expect(localStorage.getItem(TENANT_CONTEXT_STORAGE_KEY)).toBeNull();
  });

  test("returns null if the cached value is an empty object", () => {
    localStorage.setItem(TENANT_CONTEXT_STORAGE_KEY, JSON.stringify({}));
    expect(getCachedTenantContext()).toBeNull();
  });

  test("round-trips correctly after cacheValidatedTenantContext", () => {
    const input = {
      userId: "u-99",
      tenantId: "tid-99",
      tenantCode: "xyz",
      companyName: "XYZ Holdings",
    };
    cacheValidatedTenantContext(input);
    const result = getCachedTenantContext();

    expect(result.tenantCode).toBe("XYZ");
    expect(result.companyName).toBe("XYZ Holdings");
    expect(result.userId).toBe("u-99");
    expect(result.tenantId).toBe("tid-99");
  });
});
