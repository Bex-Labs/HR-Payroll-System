/**
 * Unit tests – app.js: Alert HTML generation & query-string message mapping
 * BexHR HR-Payroll-System
 */

const {
  buildAlertHTML,
  getMessageFromQueryString,
} = require("./helpers/app-utils");

// ---------------------------------------------------------------------------
// buildAlertHTML
// ---------------------------------------------------------------------------
describe("buildAlertHTML", () => {
  test("includes the alert type class", () => {
    const html = buildAlertHTML("Test message", "danger");
    expect(html).toContain("alert-danger");
  });

  test("includes the message text", () => {
    const html = buildAlertHTML("Something went wrong", "warning");
    expect(html).toContain("Something went wrong");
  });

  test("includes a dismiss button", () => {
    const html = buildAlertHTML("Info", "info");
    expect(html).toContain("btn-close");
  });

  test("sets role=alert on the container", () => {
    const html = buildAlertHTML("Info", "info");
    expect(html).toContain('role="alert"');
  });

  test("works for type 'success'", () => {
    const html = buildAlertHTML("Done!", "success");
    expect(html).toContain("alert-success");
    expect(html).toContain("Done!");
  });
});

// ---------------------------------------------------------------------------
// getMessageFromQueryString
// ---------------------------------------------------------------------------
describe("getMessageFromQueryString", () => {
  test("returns null when no message param is present", () => {
    expect(getMessageFromQueryString("")).toBeNull();
    expect(getMessageFromQueryString("?tab=payroll")).toBeNull();
  });

  test("maps 'session-timeout' to a warning", () => {
    const result = getMessageFromQueryString("?message=session-timeout");
    expect(result).not.toBeNull();
    expect(result.type).toBe("warning");
    expect(result.text).toMatch(/inactivity/i);
  });

  test("maps 'session-expired' to a warning", () => {
    const result = getMessageFromQueryString("?message=session-expired");
    expect(result.type).toBe("warning");
    expect(result.text).toMatch(/expired/i);
  });

  test("maps 'unauthorized' to danger", () => {
    const result = getMessageFromQueryString("?message=unauthorized");
    expect(result.type).toBe("danger");
    expect(result.text).toMatch(/not authorized/i);
  });

  test("maps 'password-reset-success' to success", () => {
    const result = getMessageFromQueryString("?message=password-reset-success");
    expect(result.type).toBe("success");
    expect(result.text).toMatch(/reset/i);
  });

  test("maps 'first-time-setup-success' to success", () => {
    const result = getMessageFromQueryString("?message=first-time-setup-success");
    expect(result.type).toBe("success");
    expect(result.text).toMatch(/setup is complete/i);
  });

  test("returns null for an unknown message key", () => {
    expect(getMessageFromQueryString("?message=foobar")).toBeNull();
  });

  test("handles extra query params alongside message", () => {
    const result = getMessageFromQueryString(
      "?redirect=/dashboard&message=unauthorized&tab=overview",
    );
    expect(result).not.toBeNull();
    expect(result.type).toBe("danger");
  });
});
