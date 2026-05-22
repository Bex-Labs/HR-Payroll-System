// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the previous scroll position on long Leave/Payroll pages.
// Keep restoration manual so refresh always lands at the top of the restored workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Employee dashboard scroll restoration could not be set to manual.", error);
}
/* =========================================================
   employee-dashboard.js
========================================================= */

const PROFILE_IMAGES_BUCKET = "profile-images";
const PAYROLL_MODEL_GENERIC = "GENERIC";
const PAYROLL_MODEL_REGULAR = "REGULAR";

// EMPLOYEE PAYROLL PRIVACY - STEP 1H
// Browser-local preference for hiding payroll figures like a banking app.
const EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY = "employeePayrollFiguresHidden";
// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// These leave types are treated as single-application leave types
// in Employee Self Service. Do not apply this to Annual, Sick,
// Compassionate, or other repeatable entitlement/event leave types.
const SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS = [
  "maternity",
  "paternity",
  "adoption",
];

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Employee workspace tab for refresh recovery.
// No payroll, payslip, leave request, salary, or employee data is stored.
const EMPLOYEE_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastEmployeeWorkspace";

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by employee-dashboard.html to avoid first-paint
// Profile flash before employee-dashboard.js completes authentication startup.
const EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastEmployeeWorkspace:last";

document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindNavigationEvents();
    bindLeaveFormEvents();
    bindUtilityEvents();
    bindPayrollFilterEvents();

    // EMPLOYEE PAYROLL PRIVACY - STEP 1H
    // Restore the employee's browser-local hide/show preference before
    // Current Payslip Summary values are rendered.
    restoreEmployeePayrollFigureVisibility();

    // EMPLOYEE UI CLEANUP - STEP 1B
    // Bind Payroll History collapse only. Profile, Leave, and Current Payslip
    // Summary are deliberately not part of this step.
    bindEmployeePayrollHistoryCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1L-C
    // Bind Leave Balances collapse separately from Payroll History.
    bindEmployeeLeaveBalancesCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1N
    // Bind Latest Leave Decision collapse separately from Leave Balances.
    bindEmployeeLatestDecisionCardEvents();

    // EMPLOYEE UI CLEANUP - STEP 1O-C
    // Bind optional My Leave History collapse after the history cards
    // have been cleaned up.
    bindEmployeeLeaveHistoryCardEvents();

    bindProfileImageEvents();
    bindSyncEvents();

    const authResult = await window.SessionManager.protectPage("employee");
    if (!authResult) return;

    state.currentUser = authResult.session.user;
    state.currentProfile = authResult.profile;

    await loadLatestEmployeeProfile();

    if (state.dom.employeeDisplayEmail) {
      state.dom.employeeDisplayEmail.textContent =
        state.currentProfile?.email ||
        authResult.profile?.email ||
        authResult.session.user.email ||
        "No email";
    }

if (state.dom.heroRoleValue) {
  state.dom.heroRoleValue.textContent = String(
    state.currentProfile?.role || authResult.profile?.role || "employee",
  ).toLowerCase();
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the intended workspace before long leave/payroll data loading starts.
// Safe URL links such as ?section=payroll still take priority inside
// showInitialEmployeeDashboardSection().
showInitialEmployeeDashboardSection();

await loadEmployeeRecord(
      authResult.session.user.id,
      authResult.session.user.email,
    );

    await renderEmployeeProfileImage();
    await loadEmployeeLeaveBalances();
    await loadLeaveTypes();
    await loadEmployeeLeaveRequests();
    await loadEmployeePayroll();

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Workspace restore already happened early after authentication.
// Keep the final startup step focused on leave auto-refresh only.
forceEmployeeDashboardToTopAfterRefresh();

startLeaveAutoRefresh();
  } catch (error) {
    console.error("Error initialising employee dashboard:", error);
    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the employee dashboard.",
    );
  }
});

const state = {
  currentUser: null,
  currentProfile: null,
  employeeRecord: null,
  payrollRecords: [],

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Loaded leave requests are kept in memory so the Request Leave form
  // can block duplicate/overlapping active requests before insert.
  leaveRequests: [],
  isPayrollFiguresHidden: false,
  leaveRefreshTimer: null,
  pendingProfileImageFile: null,

  // EMPLOYEE LEAVE UX WIRING - STEP 1A
  // Controls the temporary bottom-right employee notification.
  // This is separate from the existing top page alert.
  dashboardToastTimeoutId: null,

  // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
  // When an employee edits a returned request, we update and resubmit the
  // same leave_requests row instead of creating a duplicate request. The
  // database audit trigger preserves the previous returned decision.
  returnedLeaveAmendmentRequestId: null,
  returnedLeaveAmendmentOriginalStatus: null,

  identity: {
    authUserId: null,
    employeeRowId: null,
    linkedUserId: null,
  },
  dom: {},
};

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these Employee top-level workspaces are safe to restore after refresh.
function isValidEmployeeWorkspaceKey(workspace = "") {
  return ["profile", "leave", "payroll"].includes(String(workspace || "").trim());
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Resolve tenant/company context where available so one company session
// does not bleed remembered workspace state into another.
function getEmployeeWorkspaceTenantScope() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    const tenantContext = rawContext ? JSON.parse(rawContext) : null;

    return String(
      tenantContext?.tenantId ||
      state.currentProfile?.tenant_id ||
      "no-tenant",
    ).trim();
  } catch (error) {
    console.warn("Employee tenant context could not be read for workspace memory.", error);

    return String(state.currentProfile?.tenant_id || "no-tenant").trim();
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope the stored workspace to the signed-in employee and company context.
function getEmployeeWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();
  const tenantScope = getEmployeeWorkspaceTenantScope();

  return `${EMPLOYEE_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}:${tenantScope}`;
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active workspace key. Do not store payroll, payslip, leave,
// salary, PDF, employee, or form data in browser storage.
function rememberEmployeeWorkspace(workspace = "") {
  if (!isValidEmployeeWorkspaceKey(workspace)) return;

  try {
    sessionStorage.setItem(getEmployeeWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to employee-dashboard.js.
    sessionStorage.setItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Employee workspace memory could not be saved.", error);
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered workspace for this employee session.
// Fresh login naturally falls back to Profile after logout clears the keys.
function getRememberedEmployeeWorkspace() {
  try {
    const scopedWorkspace = sessionStorage.getItem(getEmployeeWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY);
    const workspace = scopedWorkspace || bootWorkspace || "profile";

    return isValidEmployeeWorkspaceKey(workspace) ? workspace : "profile";
  } catch (error) {
    console.warn("Employee workspace memory could not be read.", error);
    return "profile";
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout must reset the next Employee session to Profile.
function clearRememberedEmployeeWorkspace() {
  try {
    sessionStorage.removeItem(getEmployeeWorkspaceMemoryKey());
    sessionStorage.removeItem(EMPLOYEE_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Employee workspace memory could not be cleared.", error);
  }
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceEmployeeDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateScrollToTopButtonVisibility();
}

// EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Employee workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long pages.
function restoreEmployeeWorkspaceAfterRefresh() {
  const workspace = getRememberedEmployeeWorkspace();

  showSection(workspace);
  forceEmployeeDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceEmployeeDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceEmployeeDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceEmployeeDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceEmployeeDashboardToTopAfterRefresh, 150);
}

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error(
      "Supabase client is not available on window.supabaseClient.",
    );
  }
  return window.supabaseClient;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

/* =========================================================
   Identity helpers
========================================================= */
function getEmployeeIdentityCandidates() {
  const candidates = [
    state.identity?.linkedUserId,
    state.identity?.authUserId,
    state.identity?.employeeRowId,
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function getPreferredEmployeeReferenceId() {
  return (
    state.identity?.linkedUserId ||
    state.identity?.authUserId ||
    state.identity?.employeeRowId ||
    null
  );
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Only returned requests can be edited and resubmitted by the employee.
// Approved, rejected, and pending requests remain read-only from Employee
// Self Service.
function isReturnedLeaveRequest(request = {}) {
  const status = normalizeText(request.status || "");

  return (
    status === "returned" ||
    status === "returned for clarification"
  );
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Keep the submit button label aligned with the current workflow mode.
function getLeaveSubmitButtonDefaultHtml() {
  if (state.returnedLeaveAmendmentRequestId) {
    return `<i class="bi bi-arrow-repeat me-2"></i>Resubmit Returned Request`;
  }

  return `<i class="bi bi-send-check me-2"></i>Submit for Approval`;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Find the returned request currently being amended.
function getReturnedLeaveAmendmentRequest() {
  if (!state.returnedLeaveAmendmentRequestId) return null;

  return (state.leaveRequests || []).find(
    (request) =>
      String(request.id) === String(state.returnedLeaveAmendmentRequestId),
  ) || null;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Put the Request Leave form into amendment mode using the returned request
// values. This does not save anything until the employee submits again.
function startReturnedLeaveAmendment(leaveRequestId) {
  const request = (state.leaveRequests || []).find(
    (item) => String(item.id) === String(leaveRequestId),
  );

  if (!request) {
    showPageAlert(
      "warning",
      "The returned leave request could not be found. Please refresh leave history and try again.",
    );
    return;
  }

  if (!isReturnedLeaveRequest(request)) {
    showPageAlert(
      "warning",
      "Only returned leave requests can be edited and resubmitted.",
    );
    return;
  }

  state.returnedLeaveAmendmentRequestId = request.id;
  state.returnedLeaveAmendmentOriginalStatus = request.status || null;

  if (state.dom.leaveType) {
    state.dom.leaveType.value = request.leave_type_id || "";
  }

  if (state.dom.startDate) {
    state.dom.startDate.value = request.start_date || "";
  }

  if (state.dom.endDate) {
    state.dom.endDate.value = request.end_date || "";
  }

  if (state.dom.leaveReason) {
    state.dom.leaveReason.value = request.reason || "";
  }

  calculateLeaveDays();
  updateLeaveRequestBlockNotice();

  if (state.dom.submitLeaveBtn) {
    state.dom.submitLeaveBtn.innerHTML = getLeaveSubmitButtonDefaultHtml();
  }

  updateLeaveSubmitButtonState();

  showSection("leave");
  setEmployeeLeaveHistoryCardExpanded(true);

  showPageAlert(
    "info",
    "Editing returned leave request. Update the details and resubmit for manager review.",
  );

  window.setTimeout(() => {
    state.dom.leaveRequestForm?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 50);
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
// Reset amendment mode after successful resubmission or when the form returns
// to normal submission mode.
function clearReturnedLeaveAmendmentMode() {
  state.returnedLeaveAmendmentRequestId = null;
  state.returnedLeaveAmendmentOriginalStatus = null;

  if (state.dom.submitLeaveBtn) {
    state.dom.submitLeaveBtn.innerHTML = getLeaveSubmitButtonDefaultHtml();
  }
}

/* =========================================================
   Safe user_id backfill
========================================================= */
async function tryBackfillEmployeeUserId(employee, authUserId, authUserEmail) {
  const supabase = getSupabaseClient();

  if (!employee?.id || !authUserId) {
    return { employee, status: "skipped" };
  }

  if (employee.user_id === authUserId) {
    return { employee, status: "already-linked" };
  }

  const employeeEmail = normalizeEmail(employee.work_email || employee.email);
  const signedInEmail = normalizeEmail(authUserEmail);

  if (!employeeEmail || !signedInEmail || employeeEmail !== signedInEmail) {
    return { employee, status: "email-mismatch" };
  }

  if (employee.user_id) {
    return { employee, status: "different-user-id-present" };
  }

  try {
    const { data, error } = await supabase
      .from("employees")
      .update({ user_id: authUserId })
      .eq("id", employee.id)
      .is("user_id", null)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Unable to backfill employees.user_id:", error);
      return { employee, status: "failed", error };
    }

    if (data) {
      return { employee: data, status: "linked" };
    }

    return {
      employee: { ...employee, user_id: authUserId },
      status: "linked-no-row-returned",
    };
  } catch (error) {
    console.error("Unexpected employees.user_id backfill error:", error);
    return { employee, status: "failed", error };
  }
}

function applyResolvedIdentity(employee) {
  state.identity = {
    authUserId: state.currentUser?.id || null,
    employeeRowId: employee?.id || null,
    linkedUserId: employee?.user_id || state.currentUser?.id || null,
  };
}

function cacheDomElements() {
  state.dom = {
    pageAlert: document.getElementById("pageAlert"),

    // EMPLOYEE UI CLEANUP - STEP 1I
    // Floating Back-to-Top button used only for page navigation.
    scrollToTopBtn: document.getElementById("scrollToTopBtn"),

    navProfileBtn: document.getElementById("navProfileBtn"),
    navLeaveBtn: document.getElementById("navLeaveBtn"),
    navPayrollBtn: document.getElementById("navPayrollBtn"),
    logoutBtn: document.getElementById("logoutBtn"),

    profileSection: document.getElementById("profileSection"),
    leaveSection: document.getElementById("leaveSection"),
    payrollSection: document.getElementById("payrollSection"),

    employeeDisplayEmail: document.getElementById("employeeDisplayEmail"),
    employeeInitials: document.getElementById("employeeInitials"),
    employeeHeroImage: document.getElementById("employeeHeroImage"),
    heroRoleValue: document.getElementById("heroRoleValue"),
    heroModuleValue: document.getElementById("heroModuleValue"),

    profileImage: document.getElementById("profileImage"),
    profileImageInput: document.getElementById("profileImageInput"),
    saveProfileImageBtn: document.getElementById("saveProfileImageBtn"),
    profileFullName: document.getElementById("profileFullName"),
    profileJobTitle: document.getElementById("profileJobTitle"),
    profileDepartment: document.getElementById("profileDepartment"),
    profileEmployeeId: document.getElementById("profileEmployeeId"),

    firstName: document.getElementById("firstName"),
    lastName: document.getElementById("lastName"),
    emailAddress: document.getElementById("emailAddress"),
    phoneNumber: document.getElementById("phoneNumber"),
    roleName: document.getElementById("roleName"),
    managerName: document.getElementById("managerName"),

    leaveBalancesEmptyState: document.getElementById("leaveBalancesEmptyState"),
    leaveBalancesGrid: document.getElementById("leaveBalancesGrid"),
    refreshLeaveBalancesBtn: document.getElementById("refreshLeaveBalancesBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1L-C
    // Leave Balances gets its own collapse controls.
    employeeLeaveBalancesCard: document.getElementById("employeeLeaveBalancesCard"),
    employeeLeaveBalancesHeader: document.getElementById("employeeLeaveBalancesHeader"),
    toggleLeaveBalancesCardBtn: document.getElementById("toggleLeaveBalancesCardBtn"),
    leaveBalancesCardCollapse: document.getElementById("leaveBalancesCardCollapse"),

    latestDecisionEmptyState: document.getElementById(
      "latestDecisionEmptyState",
    ),
    latestDecisionCard: document.getElementById("latestDecisionCard"),
    latestDecisionStatus: document.getElementById("latestDecisionStatus"),
    latestDecisionLeaveType: document.getElementById("latestDecisionLeaveType"),
    latestDecisionDateTime: document.getElementById("latestDecisionDateTime"),
    latestDecisionPeriod: document.getElementById("latestDecisionPeriod"),
    latestDecisionBy: document.getElementById("latestDecisionBy"),
    latestDecisionComment: document.getElementById("latestDecisionComment"),

    // EMPLOYEE UI CLEANUP - STEP 1N
    // Latest Leave Decision gets its own card-level refresh and collapse controls.
    employeeLatestDecisionCard: document.getElementById("employeeLatestDecisionCard"),
    employeeLatestDecisionHeader: document.getElementById("employeeLatestDecisionHeader"),
    refreshLatestDecisionBtn: document.getElementById("refreshLatestDecisionBtn"),
    toggleLatestDecisionCardBtn: document.getElementById("toggleLatestDecisionCardBtn"),
    latestDecisionCardCollapse: document.getElementById("latestDecisionCardCollapse"),

    leaveRequestForm: document.getElementById("leaveRequestForm"),
    leaveType: document.getElementById("leaveType"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    totalDays: document.getElementById("totalDays"),
    leaveReason: document.getElementById("leaveReason"),
    submitLeaveBtn: document.getElementById("submitLeaveBtn"),

    // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
    // Inline warning shown under Leave Type when the selected request
    // conflicts with an existing active leave request.
    leaveRequestBlockNotice: document.getElementById("leaveRequestBlockNotice"),

    refreshLeaveRequestsBtn: document.getElementById("refreshLeaveRequestsBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1O-C
    // My Leave History gets optional collapse controls.
    // It stays expanded by default to avoid an awkward empty right column
    // beside the Submit Leave Request form.
    employeeLeaveHistoryCard: document.getElementById("employeeLeaveHistoryCard"),
    employeeLeaveHistoryHeader: document.getElementById("employeeLeaveHistoryHeader"),
    toggleLeaveHistoryCardBtn: document.getElementById("toggleLeaveHistoryCardBtn"),
    leaveHistoryCardCollapse: document.getElementById("leaveHistoryCardCollapse"),

    leaveRequestsEmptyState: document.getElementById("leaveRequestsEmptyState"),

    // EMPLOYEE UI CLEANUP - STEP 1O-A
    // My Leave History now renders as stacked request cards instead of a table.
    leaveRequestsList: document.getElementById("leaveRequestsList"),

    refreshPayrollBtn: document.getElementById("refreshPayrollBtn"),
    currentPayrollEmptyState: document.getElementById(
      "currentPayrollEmptyState",
    ),
    currentPayrollSummaryGrid: document.getElementById(
      "currentPayrollSummaryGrid",
    ),
    currentPayCycle: document.getElementById("currentPayCycle"),
    currentGrossPay: document.getElementById("currentGrossPay"),
    currentTotalDeductions: document.getElementById("currentTotalDeductions"),
    currentNetPay: document.getElementById("currentNetPay"),
    togglePayrollFiguresBtn: document.getElementById("togglePayrollFiguresBtn"),

    // EMPLOYEE UI CLEANUP - STEP 1B
    // Payroll History gets its own collapse controls.
    // No other Employee dashboard card is included in this step.
    employeePayrollHistoryCard: document.getElementById("employeePayrollHistoryCard"),
    employeePayrollHistoryHeader: document.getElementById("employeePayrollHistoryHeader"),
    togglePayrollHistoryCardBtn: document.getElementById("togglePayrollHistoryCardBtn"),
    payrollHistoryCardCollapse: document.getElementById("payrollHistoryCardCollapse"),

    payrollHistoryEmptyState: document.getElementById(
      "payrollHistoryEmptyState",
    ),
    payrollHistoryTableWrapper: document.getElementById(
      "payrollHistoryTableWrapper",
    ),
    payrollHistoryTableBody: document.getElementById("payrollHistoryTableBody"),
    payrollSearchInput: document.getElementById("payrollSearchInput"),
    payrollDateFromInput: document.getElementById("payrollDateFromInput"),
    payrollDateToInput: document.getElementById("payrollDateToInput"),
    clearPayrollFiltersBtn: document.getElementById("clearPayrollFiltersBtn"),
  };
}

function bindNavigationEvents() {
  state.dom.navProfileBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberEmployeeWorkspace("profile");
    showSection("profile");
  });

  state.dom.navLeaveBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Leave Management only for refresh. No leave request data is stored.
    rememberEmployeeWorkspace("leave");
    showSection("leave");
  });

  state.dom.navPayrollBtn?.addEventListener("click", () => {
    // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Payroll only for refresh. No payslip, salary, or payroll data is stored.
    rememberEmployeeWorkspace("payroll");
    showSection("payroll");
  });
}

function bindUtilityEvents() {
state.dom.logoutBtn?.addEventListener("click", async () => {
  // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
  // Logout must reset the next Employee session to Profile.
  clearRememberedEmployeeWorkspace();

  await window.SessionManager.logoutUser("logout");
});

  state.dom.refreshLeaveBalancesBtn?.addEventListener("click", async () => {
    await refreshEmployeeLeaveBalancesManually();
  });

  state.dom.refreshLeaveRequestsBtn?.addEventListener("click", async () => {
    await refreshEmployeeLeaveHistoryManually();
  });

  // EMPLOYEE UI CLEANUP - STEP 1N
  // Refresh only the leave decision/history data from the card header.
  state.dom.refreshLatestDecisionBtn?.addEventListener("click", async () => {
    await refreshLatestDecisionManually();
  });

  state.dom.refreshPayrollBtn?.addEventListener("click", async () => {
    await refreshEmployeePayrollManually();
  });

  // EMPLOYEE UI CLEANUP - STEP 1I
  // Smoothly return the employee to the top of the dashboard.
  state.dom.scrollToTopBtn?.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  window.addEventListener("scroll", updateScrollToTopButtonVisibility, {
    passive: true,
  });

  window.addEventListener("resize", updateScrollToTopButtonVisibility);

  updateScrollToTopButtonVisibility();

  // EMPLOYEE PAYROLL PRIVACY - STEP 1H
  // Toggle only the on-screen Current Payslip Summary figures.
  // Payroll records, calculations, PDF generation, and Supabase data are not changed.
  state.dom.togglePayrollFiguresBtn?.addEventListener("click", () => {
    setEmployeePayrollFiguresHidden(!state.isPayrollFiguresHidden, true);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1I
// Show the Back-to-Top button only after the employee has scrolled down.
// This keeps the top of the dashboard clean on first load.
function updateScrollToTopButtonVisibility() {
  const button = state.dom.scrollToTopBtn;
  if (!button) return;

  const shouldShow = window.scrollY > 260;
  button.classList.toggle("d-none", !shouldShow);
}


function bindPayrollFilterEvents() {
  state.dom.payrollSearchInput?.addEventListener("input", () => {
    applyPayrollFilters();
  });

  state.dom.payrollDateFromInput?.addEventListener("change", () => {
    applyPayrollFilters();
  });

  state.dom.payrollDateToInput?.addEventListener("change", () => {
    applyPayrollFilters();
  });

  state.dom.clearPayrollFiltersBtn?.addEventListener("click", () => {
    clearPayrollFilters();
  });
}

// EMPLOYEE UI CLEANUP - STEP 1L-C
// Programmatic Leave Balances collapse state.
// This mirrors the Payroll History collapse pattern but is scoped only
// to the Leave Balances card.
function setEmployeeLeaveBalancesCardExpanded(shouldExpand) {
  const button = state.dom.toggleLeaveBalancesCardBtn;
  const panel = state.dom.leaveBalancesCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse leave balances" : "Expand leave balances";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }

  // EMPLOYEE LEAVE UX WIRING - STEP 1A
  // Keep double-click collapse visually identical to pressing the Collapse
  // button by clearing/reapplying the desktop equal-height calculation.
  requestEmployeeLeaveLayoutSync();
}

// EMPLOYEE UI CLEANUP - STEP 1L-C
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive controls are ignored so Refresh Balances remains safe.
function bindEmployeeLeaveBalancesCardEvents() {
  const card = state.dom.employeeLeaveBalancesCard;
  const button = state.dom.toggleLeaveBalancesCardBtn;
  const panel = state.dom.leaveBalancesCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Leave Balances collapsed by default.
  setEmployeeLeaveBalancesCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLeaveBalancesCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    // EMPLOYEE DASHBOARD FINAL QA - STEP 1R-A
    // Ignore double-clicks inside the scrollable history records area.
    // This prevents the card from collapsing while the employee is reviewing
    // or selecting text from manager decision comments.
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, .employee-leave-history-scroll-area, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeeLeaveBalancesCardExpanded(false);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Programmatic Latest Leave Decision collapse state.
// This mirrors the Leave Balances and Payroll History card behaviour.
function setEmployeeLatestDecisionCardExpanded(shouldExpand) {
  const button = state.dom.toggleLatestDecisionCardBtn;
  const panel = state.dom.latestDecisionCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand
    ? "Collapse latest leave decision"
    : "Expand latest leave decision";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive controls are ignored so Refresh Decision remains safe.
function bindEmployeeLatestDecisionCardEvents() {
  const card = state.dom.employeeLatestDecisionCard;
  const button = state.dom.toggleLatestDecisionCardBtn;
  const panel = state.dom.latestDecisionCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Latest Leave Decision collapsed by default.
  setEmployeeLatestDecisionCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLatestDecisionCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeeLatestDecisionCardExpanded(false);
  });
}

// EMPLOYEE UI CLEANUP - STEP 1O-C
// Programmatic My Leave History collapse state.
// Unlike Leave Balances and Latest Decision, this remains expanded by default
// because employees should immediately see their recent leave outcomes.
function setEmployeeLeaveHistoryCardExpanded(shouldExpand) {
  const button = state.dom.toggleLeaveHistoryCardBtn;
  const panel = state.dom.leaveHistoryCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse leave history" : "Expand leave history";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1O-C
// Bind the visible collapse button and header double-click behaviour.
// Double-click is limited to the header so employees do not accidentally
// collapse the card while reading decision comments.
function bindEmployeeLeaveHistoryCardEvents() {
  const card = state.dom.employeeLeaveHistoryCard;
  const button = state.dom.toggleLeaveHistoryCardBtn;
  const panel = state.dom.leaveHistoryCardCollapse;

  if (!card || !button || !panel) return;

  // EMPLOYEE UI CLEANUP - STEP 1O-C
  // Keep My Leave History expanded by default because recent leave
  // outcomes are high-value employee information.
  setEmployeeLeaveHistoryCardExpanded(true);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeeLeaveHistoryCardExpanded(!isExpanded);
  });

  // EMPLOYEE UI CLEANUP - STEP 1O-C FIX
  // Make double-click responsive across the whole history card shell,
  // matching the existing employee card collapse pattern.
  // Interactive controls are ignored so Refresh History remains safe.
  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, .employee-leave-history-scroll-area, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    // EMPLOYEE LEAVE UX WIRING - STEP 1B
    // Double-click should behave exactly like pressing the visible Collapse
    // button. The HTML layout-sync script already listens to that button click,
    // so using button.click() avoids the tall blank card left by the direct
    // collapse path.
    button.click();
  });
}

// EMPLOYEE UI CLEANUP - STEP 1B
// Programmatic Payroll History collapse state.
// This mirrors the HR/Admin pattern but is scoped only to Payroll History.
function setEmployeePayrollHistoryCardExpanded(shouldExpand) {
  const button = state.dom.togglePayrollHistoryCardBtn;
  const panel = state.dom.payrollHistoryCardCollapse;

  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  button.title = shouldExpand ? "Collapse payroll history" : "Expand payroll history";

  const icon = button.querySelector("i");
  const label = button.querySelector("span");

  if (icon) {
    icon.className = shouldExpand
      ? "bi bi-chevron-up me-2"
      : "bi bi-chevron-down me-2";
  }

  if (label) {
    label.textContent = shouldExpand ? "Collapse" : "Expand";
  }
}

// EMPLOYEE UI CLEANUP - STEP 1B
// Bind the visible collapse button and double-click-to-collapse behaviour.
// Interactive elements are ignored so filters, table scrolling, breakdown,
// and payslip download actions continue to work normally.
function bindEmployeePayrollHistoryCardEvents() {
  const card = state.dom.employeePayrollHistoryCard;
  const button = state.dom.togglePayrollHistoryCardBtn;
  const panel = state.dom.payrollHistoryCardCollapse;

  if (!card || !button || !panel) return;

  // Keep Payroll History collapsed by default on page load.
  setEmployeePayrollHistoryCardExpanded(false);

  button.addEventListener("click", () => {
    const isExpanded = !panel.classList.contains("d-none");
    setEmployeePayrollHistoryCardExpanded(!isExpanded);
  });

  card.addEventListener("dblclick", (event) => {
    const ignoredTarget = event.target.closest(
      "button, a, input, select, textarea, label, table, .dashboard-table-wrap, [contenteditable='true']",
    );

    if (ignoredTarget) return;

    const isExpanded = !panel.classList.contains("d-none");
    if (!isExpanded) return;

    setEmployeePayrollHistoryCardExpanded(false);
  });
}


function bindProfileImageEvents() {
  // EMPLOYEE UI CLEANUP - STEP 1J
  // Keep profile image upload disabled until a valid file is selected.
  updateProfileImageUploadButtonState();

  state.dom.profileImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    handlePendingProfileImage(file);
  });

  state.dom.saveProfileImageBtn?.addEventListener("click", async () => {
    await uploadEmployeeProfileImage();
  });
}

function bindSyncEvents() {
  window.addEventListener("storage", async (event) => {
    if (event.key !== "hrPayrollLeaveDecisionSync") return;
    await refreshEmployeeLeaveViewsSilently();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await refreshEmployeeLeaveViewsSilently();
    }
  });
}

function startLeaveAutoRefresh() {
  stopLeaveAutoRefresh();

  state.leaveRefreshTimer = window.setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    await refreshEmployeeLeaveViewsSilently();
  }, 10000);
}

function stopLeaveAutoRefresh() {
  if (state.leaveRefreshTimer) {
    window.clearInterval(state.leaveRefreshTimer);
    state.leaveRefreshTimer = null;
  }
}

async function refreshEmployeeLeaveViewsSilently() {
  try {
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
  } catch (error) {
    console.warn("Silent leave refresh failed:", error);
  }
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// My Leave History has a desktop equal-height helper in employee-dashboard.html.
// Button-click collapse already triggers that helper through its click listener,
// but double-click collapse happens inside this JS file. Dispatching resize here
// makes double-click produce the same compact result as the Collapse button.
function requestEmployeeLeaveLayoutSync() {
  window.setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 50);
}

async function refreshEmployeeLeaveBalancesManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLeaveBalancesBtn, true);
    await waitForNextPaint();
    await loadEmployeeLeaveBalances();
    await loadEmployeeLeaveRequests();
    clearPageAlert();
    showPageAlert("success", "Leave balances refreshed successfully.");
  } catch (error) {
    console.error("Manual leave balances refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh leave balances right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLeaveBalancesBtn, false);
  }
}

// EMPLOYEE UI CLEANUP - STEP 1N
// Card-level refresh for Latest Leave Decision.
// It reloads leave requests because Latest Decision is derived from leave request decisions.
// It also reloads balances because approved/rejected decisions can affect entitlement usage.
async function refreshLatestDecisionManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLatestDecisionBtn, true);
    await waitForNextPaint();
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
    clearPageAlert();
    showPageAlert("success", "Latest leave decision refreshed successfully.");
  } catch (error) {
    console.error("Manual latest leave decision refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh the latest leave decision right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLatestDecisionBtn, false);
  }
}


async function refreshEmployeeLeaveHistoryManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshLeaveRequestsBtn, true);
    await waitForNextPaint();
    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();
    clearPageAlert();
    showPageAlert("success", "Leave history refreshed successfully.");
  } catch (error) {
    console.error("Manual leave history refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh leave history right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshLeaveRequestsBtn, false);
  }
}

async function refreshEmployeePayrollManually() {
  if (!state.currentUser) return;

  try {
    setRefreshButtonLoading(state.dom.refreshPayrollBtn, true);
    await waitForNextPaint();
    await loadEmployeePayroll();
    clearPageAlert();
    showPageAlert("success", "Payroll information refreshed successfully.");
  } catch (error) {
    console.error("Manual payroll refresh failed:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to refresh payroll information right now.",
    );
  } finally {
    setRefreshButtonLoading(state.dom.refreshPayrollBtn, false);
  }
}

function setRefreshButtonLoading(button, isLoading) {
  if (!button) return;

  const isPayrollRefreshButton = button.id === "refreshPayrollBtn";

  button.disabled = isLoading;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    // EMPLOYEE UI CLEANUP - STEP 1Q-A
    // Keep the compact Payroll refresh action icon-only even while loading.
    // Other refresh buttons keep their existing "Refreshing..." text.
    if (isPayrollRefreshButton) {
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
      `;
      button.title = "Refreshing payroll";
      button.setAttribute("aria-label", "Refreshing payroll");
      return;
    }

    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Refreshing...
    `;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;

    if (isPayrollRefreshButton) {
      button.title = "Refresh payroll";
      button.setAttribute("aria-label", "Refresh payroll");
    }
  }
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-1
// Resolve the initial Employee Dashboard section from the URL.
// Example safe link: employee-dashboard.html?section=payroll
// Only known section names are allowed, so the URL cannot trigger
// unexpected behaviour or expose payroll-sensitive values.
function getInitialEmployeeDashboardSectionFromUrl() {
  const allowedSections = new Set(["profile", "leave", "payroll"]);

  try {
    const params = new URLSearchParams(window.location.search);
    const requestedSection = normalizeText(params.get("section") || "");

    if (allowedSections.has(requestedSection)) {
      return requestedSection;
    }
  } catch (error) {
    console.warn("Unable to resolve initial employee dashboard section:", error);
  }

  // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
  // No URL section was requested, so let workspace memory decide.
  return null;
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-1
// Open the requested safe section after all employee data has loaded.
// This keeps payslip access behind the normal authenticated employee dashboard.
function showInitialEmployeeDashboardSection() {
  // EMPLOYEE DASHBOARD WORKSPACE MEMORY - STEP 1A
  // URL section wins for secure notification links, for example:
  // employee-dashboard.html?section=payroll
  // Otherwise, browser refresh restores the remembered workspace.
  const requestedSection = getInitialEmployeeDashboardSectionFromUrl();
  const sectionToShow = requestedSection || getRememberedEmployeeWorkspace();

  rememberEmployeeWorkspace(sectionToShow);
  showSection(sectionToShow);
  restoreEmployeeWorkspaceAfterRefresh();
}

function showSection(sectionName) {
  const isProfile = sectionName === "profile";
  const isLeave = sectionName === "leave";
  const isPayroll = sectionName === "payroll";

  state.dom.profileSection?.classList.toggle("d-none", !isProfile);
  state.dom.leaveSection?.classList.toggle("d-none", !isLeave);
  state.dom.payrollSection?.classList.toggle("d-none", !isPayroll);

  [
    state.dom.navProfileBtn,
    state.dom.navLeaveBtn,
    state.dom.navPayrollBtn,
  ].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline-primary");
  });

  if (isProfile && state.dom.navProfileBtn) {
    state.dom.navProfileBtn.classList.remove("btn-outline-primary");
    state.dom.navProfileBtn.classList.add("btn-primary");
    if (state.dom.heroModuleValue) state.dom.heroModuleValue.textContent = "Profile";
  }

  if (isLeave && state.dom.navLeaveBtn) {
    state.dom.navLeaveBtn.classList.remove("btn-outline-primary");
    state.dom.navLeaveBtn.classList.add("btn-primary");
    if (state.dom.heroModuleValue) state.dom.heroModuleValue.textContent = "Leave Management";
  }

  if (isPayroll && state.dom.navPayrollBtn) {
    state.dom.navPayrollBtn.classList.remove("btn-outline-primary");
    state.dom.navPayrollBtn.classList.add("btn-primary");
    if (state.dom.heroModuleValue) state.dom.heroModuleValue.textContent = "Payroll";
  }
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
// Employee eligibility depends on HR master data such as gender.
// The original lookup used exact work_email matching after user_id lookup.
// That is too brittle for seeded/test data where email casing or profile email
// source can differ. This helper keeps the lookup employee-scoped but makes
// email matching case-insensitive.
async function findEmployeeRecordByKnownEmails(emailValues = []) {
  const supabase = getSupabaseClient();

  const emails = [
    ...new Set(
      emailValues
        .map((value) => normalizeEmail(value))
        .filter(Boolean),
    ),
  ];

  for (const email of emails) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .ilike("work_email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Employee lookup by case-insensitive work_email failed:", error);
      continue;
    }

    if (data) {
      return data;
    }
  }

  return null;
}

/* =========================================================
   Employee record loading
========================================================= */
async function loadEmployeeRecord(userId, userEmail) {
  const supabase = getSupabaseClient();

  let employee = null;
  let lookupMethod = "";

  try {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      employee = data;
      lookupMethod = "user_id";
    }
  } catch (err) {
    console.warn("Lookup by user_id failed:", err);
  }

  if (!employee) {
    try {
      // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
      // Use both auth email and profile email, case-insensitively, so the
      // signed-in employee resolves to the full employees row including gender.
      const emailMatchedEmployee = await findEmployeeRecordByKnownEmails([
        userEmail,
        state.currentProfile?.email,
        state.currentUser?.email,
      ]);

      if (emailMatchedEmployee) {
        employee = emailMatchedEmployee;
        lookupMethod = "work_email";
      }
    } catch (err) {
      console.warn("Lookup by known employee email failed:", err);
    }
  }

  if (!employee) {
    const fallbackEmployee = {
      id: userId,
      user_id: userId,
      first_name: "",
      last_name: "",
      work_email: userEmail || state.currentProfile?.email || "",
      phone_number: "",
      role: "Employee",
      department: "--",
      employee_id: "--",
      manager_name: "--",
      job_title: "Employee",
      profile_image_url: "",
    };

    state.employeeRecord = fallbackEmployee;
    applyResolvedIdentity(fallbackEmployee);
    renderEmployeeRecord(fallbackEmployee);

    showPageAlert(
      "warning",
      "Employee record was not found in employees table for this signed-in user.",
    );
    return;
  }

  if (lookupMethod === "work_email") {
    const linkResult = await tryBackfillEmployeeUserId(employee, userId, userEmail);

    if (
      linkResult.status === "linked" ||
      linkResult.status === "linked-no-row-returned"
    ) {
      employee = linkResult.employee;
    }
  }

  state.employeeRecord = employee;
  applyResolvedIdentity(employee);
  renderEmployeeRecord(employee);
}

function getEmployeeManagerDisplayName(employee) {
  return (
    employee.manager_name ||
    employee.line_manager_name ||
    employee.line_manager ||
    employee.supervisor_name ||
    employee.reporting_manager ||
    employee.manager_email ||
    employee.line_manager_email ||
    employee.supervisor_email ||
    "--"
  );
}

function getEmployeeIdDisplayValue(employee) {
  return (
    employee.employee_id ||
    employee.staff_id ||
    employee.employee_number ||
    employee.payroll_number ||
    "--"
  );
}

function getEmployeePhoneDisplayValue(employee) {
  return (
    employee.phone_number ||
    employee.phone ||
    employee.mobile ||
    employee.mobile_phone ||
    employee.work_phone ||
    ""
  );
}

function renderEmployeeRecord(employee) {
  const firstName = employee.first_name || "";
  const lastName = employee.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim() || "Employee";

  const email =
    employee.work_email ||
    employee.email ||
    state.currentProfile?.email ||
    state.currentUser?.email ||
    "";

  const phone = getEmployeePhoneDisplayValue(employee);
  const role = employee.role || state.currentProfile?.role || "Employee";
  const department = employee.department || "--";
  const employeeId = getEmployeeIdDisplayValue(employee);
  const managerName = getEmployeeManagerDisplayName(employee);
  const jobTitle = employee.job_title || employee.position || role || "Employee";

  if (state.dom.employeeDisplayEmail) {
    state.dom.employeeDisplayEmail.textContent = email || "No email";
  }

  if (state.dom.heroRoleValue) {
    state.dom.heroRoleValue.textContent = String(role || "employee").toLowerCase();
  }

  if (state.dom.employeeInitials) {
    const initials =
      `${(firstName || "").charAt(0)}${(lastName || "").charAt(0)}`.trim() ||
      "EM";
    state.dom.employeeInitials.textContent = initials.toUpperCase();
  }

  if (state.dom.profileFullName) {
    state.dom.profileFullName.textContent = fullName;
  }

  if (state.dom.profileJobTitle) {
    state.dom.profileJobTitle.textContent = jobTitle;
  }

  if (state.dom.profileDepartment) {
    state.dom.profileDepartment.textContent = `Department: ${department}`;
  }

  if (state.dom.profileEmployeeId) {
    state.dom.profileEmployeeId.textContent = `Employee ID: ${employeeId}`;
  }

  if (state.dom.firstName) state.dom.firstName.value = firstName;
  if (state.dom.lastName) state.dom.lastName.value = lastName;
  if (state.dom.emailAddress) state.dom.emailAddress.value = email;
  if (state.dom.phoneNumber) state.dom.phoneNumber.value = phone;
  if (state.dom.roleName) state.dom.roleName.value = role;
  if (state.dom.managerName) state.dom.managerName.value = managerName;
}

/* =========================================================
   Profile image
========================================================= */
async function loadLatestEmployeeProfile() {
  if (!state.currentUser?.id) return state.currentProfile;

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", state.currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      state.currentProfile = data;
    }

    return state.currentProfile;
  } catch (error) {
    console.error("Error loading latest employee profile:", error);
    return state.currentProfile;
  }
}

async function getSignedProfileImageUrl(filePath) {
  if (!filePath) return null;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error("Error creating signed profile image URL:", error);
    return null;
  }
}

async function renderEmployeeProfileImage() {
  const profileImageElement = state.dom.profileImage;
  const heroImageElement = state.dom.employeeHeroImage;
  const initialsElement = state.dom.employeeInitials;

  if (!profileImageElement) return;

  const initialsText = initialsElement?.textContent || "EMP";
  const fallbackImageUrl = `https://placehold.co/120x120?text=${encodeURIComponent(
    initialsText,
  )}`;

  const imagePath = state.currentProfile?.profile_image_path || "";

  if (!imagePath) {
    profileImageElement.src = fallbackImageUrl;

    if (heroImageElement) {
      heroImageElement.src = "";
      heroImageElement.classList.add("d-none");
    }

    if (initialsElement) {
      initialsElement.classList.remove("d-none");
    }

    return;
  }

  const signedUrl = await getSignedProfileImageUrl(imagePath);

  if (!signedUrl) {
    profileImageElement.src = fallbackImageUrl;

    if (heroImageElement) {
      heroImageElement.src = "";
      heroImageElement.classList.add("d-none");
    }

    if (initialsElement) {
      initialsElement.classList.remove("d-none");
    }

    return;
  }

  profileImageElement.src = signedUrl;

  if (heroImageElement) {
    heroImageElement.src = signedUrl;
    heroImageElement.classList.remove("d-none");
  }

  if (initialsElement) {
    initialsElement.classList.add("d-none");
  }
}

// EMPLOYEE UI CLEANUP - STEP 1J
// The upload button should behave like the admin profile upload:
// grey/disabled when no valid image is ready, active only after file selection.
function updateProfileImageUploadButtonState() {
  const button = state.dom.saveProfileImageBtn;
  if (!button) return;

  const hasPendingImage = Boolean(state.pendingProfileImageFile);

  button.disabled = !hasPendingImage;
  button.classList.toggle("profile-upload-empty", !hasPendingImage);
}

function handlePendingProfileImage(file) {
  state.pendingProfileImageFile = null;
  updateProfileImageUploadButtonState();

  if (!file) {
    void renderEmployeeProfileImage();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    updateProfileImageUploadButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    updateProfileImageUploadButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateProfileImageUploadButtonState();

  const reader = new FileReader();
  reader.onload = () => {
    if (state.dom.profileImage) {
      state.dom.profileImage.src = reader.result;
    }

    if (state.dom.employeeHeroImage) {
      state.dom.employeeHeroImage.src = reader.result;
      state.dom.employeeHeroImage.classList.remove("d-none");
    }

    if (state.dom.employeeInitials) {
      state.dom.employeeInitials.classList.add("d-none");
    }
  };

  reader.readAsDataURL(file);
}

function setProfileImageUploadLoading(isLoading) {
  const button = state.dom.saveProfileImageBtn;
  if (!button) return;

  button.disabled = isLoading || !state.pendingProfileImageFile;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Uploading...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  updateProfileImageUploadButtonState();
}

async function uploadEmployeeProfileImage() {
  if (!state.pendingProfileImageFile) {
    showPageAlert("warning", "Please choose an image before uploading.");
    return;
  }

  if (!state.currentUser?.id) {
    showPageAlert("danger", "No active employee session found.");
    return;
  }

  try {
    setProfileImageUploadLoading(true);

    const supabase = getSupabaseClient();
    const file = state.pendingProfileImageFile;
    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const filePath = `${state.currentUser.id}/profile-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("profiles")
      .update({
        profile_image_path: filePath,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      profile_image_path: filePath,
    };

    await loadLatestEmployeeProfile();

    state.pendingProfileImageFile = null;

    if (state.dom.profileImageInput) {
      state.dom.profileImageInput.value = "";
    }

    // EMPLOYEE UI CLEANUP - STEP 1J
    // After successful upload, no file is pending anymore, so the button
    // returns to the grey disabled state.
    updateProfileImageUploadButtonState();

    await renderEmployeeProfileImage();
    showPageAlert("success", "Profile picture uploaded successfully.");
  } catch (error) {
    console.error("Error uploading employee profile image:", error);
    showPageAlert(
      "danger",
      error.message || "Profile picture could not be uploaded.",
    );
  } finally {
    setProfileImageUploadLoading(false);
  }
}

/* =========================================================
   Leave balances
========================================================= */
async function loadEmployeeLeaveBalances() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    // EMPLOYEE UI CLEANUP - STEP 1L-A
    // Leave Balances should clear its own view when no employee identity
    // is available. Do not touch payroll records from the leave module.
    renderLeaveBalances([]);
    return;
  }

  let query = supabase.from("employee_leave_balances").select(`
      id,
      employee_id,
      entitled_days,
      used_days,
      remaining_days,
      leave_types (
        id,
        code,
        name
      )
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading leave balances:", error);
    showPageAlert("danger", "Unable to load leave balances.");
    return;
  }

  const balances = Array.isArray(data)
    ? data.filter(
      (balance, index, array) =>
        array.findIndex((item) => item.id === balance.id) === index,
    )
    : [];

  renderLeaveBalances(balances);
}

function renderLeaveBalances(balances) {
  const grid = state.dom.leaveBalancesGrid;
  if (!grid) return;

  grid.innerHTML = "";

  if (!balances.length) {
    state.dom.leaveBalancesEmptyState?.classList.remove("d-none");
    state.dom.leaveBalancesGrid?.classList.add("d-none");
    return;
  }

  state.dom.leaveBalancesEmptyState?.classList.add("d-none");
  state.dom.leaveBalancesGrid?.classList.remove("d-none");

  balances.forEach((balance) => {
    const leaveTypeName = balance.leave_types?.name || "Unknown Leave Type";

    const entitledDays = Number(balance.entitled_days || 0);
    const usedDays = Number(balance.used_days || 0);
    const remainingDays = Number(balance.remaining_days || 0);

    const usedPercent =
      entitledDays > 0
        ? Math.min(100, Math.max(0, (usedDays / entitledDays) * 100))
        : 0;

    const remainingPercent =
      entitledDays > 0
        ? Math.min(100, Math.max(0, (remainingDays / entitledDays) * 100))
        : 0;

    const statusClass =
      remainingDays <= 0
        ? "text-bg-danger"
        : remainingPercent <= 25
          ? "text-bg-warning"
          : "text-bg-success";

    const statusLabel =
      remainingDays <= 0
        ? "Fully Used"
        : remainingPercent <= 25
          ? "Low Balance"
          : "Available";

    const progressClass =
      remainingDays <= 0
        ? "bg-danger"
        : remainingPercent <= 25
          ? "bg-warning"
          : "bg-success";

    const card = document.createElement("div");
    card.className = "col-12 col-md-6 col-xl-4";

    // EMPLOYEE UI CLEANUP - STEP 1L-B
    // HR-style leave balance card:
    // - Clear leave type header
    // - Availability status badge
    // - Entitled / Used / Remaining hierarchy
    // - Progress bar showing used entitlement
    // This changes presentation only; leave balance data is not mutated.
    card.innerHTML = `
      <div class="info-tile h-100">
        <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <div class="info-tile-label mb-1">Leave Type</div>
            <div class="info-tile-value">
              ${escapeHtml(leaveTypeName)}
            </div>
          </div>

          <span class="badge ${statusClass}">
            ${escapeHtml(statusLabel)}
          </span>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-4">
            <div class="info-tile-label mb-1">Entitled</div>
            <div class="fw-bold">${entitledDays}</div>
          </div>

          <div class="col-4">
            <div class="info-tile-label mb-1">Used</div>
            <div class="fw-bold">${usedDays}</div>
          </div>

          <div class="col-4">
            <div class="info-tile-label mb-1">Remaining</div>
            <div class="fw-bold">${remainingDays}</div>
          </div>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-1">
          <div class="small text-secondary">Used entitlement</div>
          <div class="small fw-semibold">${usedPercent.toFixed(0)}%</div>
        </div>

        <div class="progress" style="height: 8px;">
          <div
            class="progress-bar ${progressClass}"
            role="progressbar"
            style="width: ${usedPercent.toFixed(0)}%;"
            aria-valuenow="${usedPercent.toFixed(0)}"
            aria-valuemin="0"
            aria-valuemax="100">
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

/* =========================================================
   Leave request form
========================================================= */

function bindLeaveFormEvents() {
  // EMPLOYEE UI CLEANUP - STEP 1P-F FIX
  // Keep the submit button grey/disabled until the leave request form is
  // ready. This mirrors the existing profile upload empty-button behaviour.
  state.dom.leaveType?.addEventListener("change", () => {
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.startDate?.addEventListener("change", () => {
    calculateLeaveDays();
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.endDate?.addEventListener("change", () => {
    calculateLeaveDays();
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
  });

  state.dom.leaveReason?.addEventListener("input", updateLeaveSubmitButtonState);

  state.dom.leaveRequestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleLeaveRequestSubmit();
  });

  updateLeaveSubmitButtonState();
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// The leave submit button should behave like the existing grey/active
// profile upload button: inactive when the form is incomplete, active when
// the employee has completed all required fields.
function isLeaveRequestFormReadyForSubmission() {
  const leaveType = state.dom.leaveType?.value?.trim();
  const startDate = state.dom.startDate?.value;
  const endDate = state.dom.endDate?.value;
  const reason = state.dom.leaveReason?.value?.trim();
  const totalDays = Number(state.dom.totalDays?.value || 0);

  if (!leaveType || !startDate || !endDate || !reason || totalDays < 1) {
    return false;
  }

  if (new Date(endDate) < new Date(startDate)) {
    return false;
  }

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1A
  // Keep the Submit button disabled when the selected leave type is
  // blocked for the selected leave year.
  return !getLeaveRequestPolicyBlock();
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// Empty form = grey disabled button.
// Completed required fields = blue active button.
// This is UI state only; validation and save logic still run on submit.
function updateLeaveSubmitButtonState() {
  const button = state.dom.submitLeaveBtn;
  if (!button) return;

  const isReady = isLeaveRequestFormReadyForSubmission();

  button.disabled = !isReady;

  button.classList.toggle("btn-secondary", !isReady);
  button.classList.toggle("btn-primary", isReady);
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Resolve the currently selected Leave Type without changing the dropdown.
function getSelectedLeaveTypeDetails() {
  const select = state.dom.leaveType;
  const selectedOption = select?.selectedOptions?.[0];

  return {
    id: String(select?.value || "").trim(),
    name: String(selectedOption?.textContent || "").trim(),
    code: String(selectedOption?.dataset?.code || "").trim(),

    // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
    // Eligibility is configured in leave_types. This keeps maternity/paternity
    // controls data-driven instead of hardcoded against leave names only.
    eligibilityRule: String(
      selectedOption?.dataset?.eligibilityRule || "all_employees",
    ).trim(),
  };
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Single-application leave types are blocked for the same leave year
// when an active request already exists.
function isSingleApplicationLeaveType(leaveType = {}) {
  const searchableValue = normalizeText(
    `${leaveType.name || ""} ${leaveType.code || ""}`,
  );

  return SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS.some((keyword) =>
    searchableValue.includes(keyword),
  );
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Use the selected first day of leave to determine the leave year.
function getSelectedLeaveRequestYear() {
  const startDateValue = String(state.dom.startDate?.value || "").trim();

  if (!startDateValue) return null;

  const startDate = new Date(startDateValue);

  if (Number.isNaN(startDate.getTime())) return null;

  return startDate.getFullYear();
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Detect whether an existing request touches the selected leave year.
function doesLeaveRequestTouchYear(request = {}, leaveYear) {
  if (!leaveYear) return false;

  const yearStart = new Date(leaveYear, 0, 1);
  const yearEnd = new Date(leaveYear, 11, 31, 23, 59, 59, 999);

  const requestStart = new Date(request.start_date || "");
  const requestEnd = new Date(request.end_date || request.start_date || "");

  if (
    Number.isNaN(requestStart.getTime()) ||
    Number.isNaN(requestEnd.getTime())
  ) {
    return false;
  }

  return requestStart <= yearEnd && requestEnd >= yearStart;
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Main HR policy guard:
// 1. Block any overlapping Pending/Approved leave period.
// 2. Also block duplicate single-application leave types in the same year.
// Rejected and Returned requests do not block a fresh request.
function getLeaveRequestPolicyBlock() {
  const selectedLeaveType = getSelectedLeaveTypeDetails();
  const leaveYear = getSelectedLeaveRequestYear();

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
  // Eligibility is checked before date-overlap and duplicate checks, because
  // an ineligible leave type should be blocked as soon as it is selected.
  const eligibilityBlock = getLeaveTypeEligibilityBlock(selectedLeaveType);

  if (eligibilityBlock) {
    return eligibilityBlock;
  }

  const startDateValue = String(state.dom.startDate?.value || "").trim();
  const endDateValue = String(state.dom.endDate?.value || "").trim();

  const selectedStartDate = new Date(startDateValue || "");
  const selectedEndDate = new Date(endDateValue || startDateValue || "");

  const hasValidSelectedDateRange =
    startDateValue &&
    endDateValue &&
    !Number.isNaN(selectedStartDate.getTime()) &&
    !Number.isNaN(selectedEndDate.getTime()) &&
    selectedEndDate >= selectedStartDate;

  const blockingStatuses = new Set([
    "approved",
    "pending approval",
  ]);

  const activeRequests = (state.leaveRequests || []).filter((request) =>
    blockingStatuses.has(normalizeText(request.status || "")),
  );

  if (hasValidSelectedDateRange) {
    const overlappingRequest = activeRequests.find((request) => {
      const requestStartDate = new Date(request.start_date || "");
      const requestEndDate = new Date(request.end_date || request.start_date || "");

      if (
        Number.isNaN(requestStartDate.getTime()) ||
        Number.isNaN(requestEndDate.getTime())
      ) {
        return false;
      }

      return selectedStartDate <= requestEndDate && selectedEndDate >= requestStartDate;
    });

    if (overlappingRequest) {
      const existingLeaveTypeName =
        overlappingRequest.leave_types?.name || "leave request";

      const existingStatusLabel =
        overlappingRequest.status || "active";

      const existingRequestPeriod =
        `${formatDate(overlappingRequest.start_date)} to ${formatDate(overlappingRequest.end_date)}`;

      const selectedRequestPeriod =
        `${formatDate(startDateValue)} to ${formatDate(endDateValue)}`;

      const sameLeaveType =
        String(overlappingRequest.leave_type_id || "").trim() === selectedLeaveType.id ||
        normalizeText(existingLeaveTypeName) === normalizeText(selectedLeaveType.name);

      return {
        message: sameLeaveType
          ? `${selectedLeaveType.name || "This leave type"} already has a ${existingStatusLabel} request covering ${existingRequestPeriod}. Wait for the manager decision or contact HR if this request needs to be amended.`
          : `The selected dates (${selectedRequestPeriod}) overlap with an existing ${existingStatusLabel} ${existingLeaveTypeName} request covering ${existingRequestPeriod}. Please choose different dates or contact HR if the existing request needs to be changed.`,
      };
    }
  }

  if (!selectedLeaveType.id || !leaveYear) return null;

  if (!isSingleApplicationLeaveType(selectedLeaveType)) {
    return null;
  }

  const existingRequest = activeRequests.find((request) => {
    const sameLeaveType =
      String(request.leave_type_id || "").trim() === selectedLeaveType.id ||
      normalizeText(request.leave_types?.name || "") ===
      normalizeText(selectedLeaveType.name);

    if (!sameLeaveType) return false;

    return doesLeaveRequestTouchYear(request, leaveYear);
  });

  if (!existingRequest) return null;

  const statusLabel = existingRequest.status || "recorded";
  const requestPeriod =
    `${formatDate(existingRequest.start_date)} to ${formatDate(existingRequest.end_date)}`;

  return {
    message:
      `${selectedLeaveType.name || "This leave type"} already has a ${statusLabel} request for ${leaveYear}. ` +
      `Existing request period: ${requestPeriod}. Contact HR if this relates to a different qualifying event.`,
  };
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
// Normalise employee gender values from HR master data.
// This avoids brittle comparisons if the stored value is "Male", "male", "M",
// "Female", "female", or "F".
function getNormalisedEmployeeGenderForLeaveEligibility() {
  const rawGender = normalizeText(
    state.employeeRecord?.gender ||
    state.employeeRecord?.sex ||
    state.employeeRecord?.gender_identity ||
    "",
  );

  if (["female", "f", "woman"].includes(rawGender)) {
    return "female";
  }

  if (["male", "m", "man"].includes(rawGender)) {
    return "male";
  }

  return "";
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
// HR-facing leave eligibility guard.
// Keep the employee message neutral and professional. Do not expose sensitive
// or embarrassing wording such as "male employees cannot apply for maternity".
function getLeaveTypeEligibilityBlock(leaveType = {}) {
  if (!leaveType.id) return null;

  const eligibilityRule = normalizeText(
    leaveType.eligibilityRule || "all_employees",
  );

  if (eligibilityRule === "all_employees") {
    return null;
  }

  if (eligibilityRule === "hr_review_only") {
    return {
      message:
        `${leaveType.name || "This leave type"} requires HR review before it can be requested through Employee Self Service. Please contact HR for support.`,
    };
  }

  const employeeGender = getNormalisedEmployeeGenderForLeaveEligibility();

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1E
  // If HR profile gender cannot be resolved, do not falsely say the leave is
  // unavailable. Tell the employee the profile could not be verified.
  if (!employeeGender && (eligibilityRule === "female_only" || eligibilityRule === "male_only")) {
    return {
      message:
        `${leaveType.name || "This leave type"} eligibility could not be verified from your employee profile. Please contact HR to check your profile details.`,
    };
  }

  if (eligibilityRule === "female_only" && employeeGender === "female") {
    return null;
  }

  if (eligibilityRule === "male_only" && employeeGender === "male") {
    return null;
  }

  if (eligibilityRule === "female_only" || eligibilityRule === "male_only") {
    return {
      message:
        `${leaveType.name || "This leave type"} is not available for your employee profile. Please contact HR if this is incorrect or requires special handling.`,
    };
  }

  return null;
}

// EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
// Show or hide the in-form block notice without touching page layout.
function updateLeaveRequestBlockNotice() {
  const notice = state.dom.leaveRequestBlockNotice;
  if (!notice) return;

  const block = getLeaveRequestPolicyBlock();

  if (!block) {
    notice.classList.add("d-none");
    notice.textContent = "";
    return;
  }

  notice.className = "alert alert-warning border mt-3 mb-0";
  notice.innerHTML = `
    <div class="fw-semibold mb-1">Leave request blocked</div>
    <div class="small">
      ${escapeHtml(block.message)}
    </div>
  `;
}

// EMPLOYEE UI CLEANUP - STEP 1P-F FIX
// Restores the leave type loader that is still called during employee
// dashboard initialisation. This only repopulates the Leave Type dropdown;
// it does not change submit validation, button state, or leave saving logic.
async function loadLeaveTypes() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("leave_types")
    .select("id, code, name, eligibility_rule")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error loading leave types:", error);
    showPageAlert("danger", "Unable to load leave types.");
    return;
  }

  if (!state.dom.leaveType) return;

  state.dom.leaveType.innerHTML = `<option value="">Select leave type</option>`;

  (data || []).forEach((leaveType) => {
    const option = document.createElement("option");
    option.value = leaveType.id;
    option.textContent = leaveType.name;
    option.dataset.code = leaveType.code;

    // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1C
    // Store the configured eligibility rule on the option so the existing
    // form policy guard can block ineligible leave before submission.
    option.dataset.eligibilityRule =
      leaveType.eligibility_rule || "all_employees";

    state.dom.leaveType.appendChild(option);
  });

  updateLeaveSubmitButtonState();
}

function calculateLeaveDays() {
  const startDateValue = state.dom.startDate.value;
  const endDateValue = state.dom.endDate.value;

  if (!startDateValue || !endDateValue) {
    state.dom.totalDays.value = "";
    return;
  }

  const startDate = new Date(startDateValue);
  const endDate = new Date(endDateValue);

  if (endDate < startDate) {
    state.dom.totalDays.value = "";
    return;
  }

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const differenceInMilliseconds = endDate - startDate;
  const totalDays =
    Math.floor(differenceInMilliseconds / millisecondsPerDay) + 1;

  state.dom.totalDays.value = totalDays;
}

function validateLeaveRequestForm() {
  let isValid = true;

  const leaveType = state.dom.leaveType.value.trim();
  const startDate = state.dom.startDate.value;
  const endDate = state.dom.endDate.value;
  const reason = state.dom.leaveReason.value.trim();
  const totalDays = Number(state.dom.totalDays.value);

  [
    state.dom.leaveType,
    state.dom.startDate,
    state.dom.endDate,
    state.dom.leaveReason,
  ].forEach((field) => field?.classList.remove("is-invalid"));

  if (!leaveType) {
    state.dom.leaveType.classList.add("is-invalid");
    isValid = false;
  }

  if (!startDate) {
    state.dom.startDate.classList.add("is-invalid");
    isValid = false;
  }

  if (!endDate) {
    state.dom.endDate.classList.add("is-invalid");
    isValid = false;
  }

  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    state.dom.endDate.classList.add("is-invalid");
    showPageAlert("warning", "End date cannot be earlier than start date.");
    isValid = false;
  }

  if (!reason) {
    state.dom.leaveReason.classList.add("is-invalid");
    isValid = false;
  }

  if (!totalDays || totalDays < 1) {
    showPageAlert("warning", "Total leave days must be at least 1.");
    isValid = false;
  }

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Final submit guard. This protects against direct submit even if
  // button state has not refreshed yet.
  const policyBlock = getLeaveRequestPolicyBlock();

  if (policyBlock) {
    state.dom.leaveType?.classList.add("is-invalid");
    updateLeaveRequestBlockNotice();
    showPageAlert("warning", policyBlock.message);
    isValid = false;
  }

  return isValid;
}

// RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C-FIX B
// Resubmit through a controlled Supabase RPC instead of a direct table update.
// The function validates ownership, returned status, dates, days, and reason
// before moving the same leave request row back to Pending Approval.
async function resubmitReturnedLeaveRequest(payload = {}) {
  const amendmentRequest = getReturnedLeaveAmendmentRequest();

  if (!amendmentRequest) {
    throw new Error(
      "Returned leave request could not be resolved for resubmission. Please refresh leave history and try again.",
    );
  }

  if (!isReturnedLeaveRequest(amendmentRequest)) {
    throw new Error(
      "Only returned leave requests can be edited and resubmitted.",
    );
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase.rpc(
    "resubmit_returned_leave_request",
    {
      p_leave_request_id: amendmentRequest.id,
      p_leave_type_id: payload.leave_type_id,
      p_start_date: payload.start_date,
      p_end_date: payload.end_date,
      p_total_days: payload.total_days,
      p_reason: payload.reason,
    },
  );

  if (error) throw error;

  const updatedRequest = Array.isArray(data) ? data[0] : data;

  if (!updatedRequest) {
    throw new Error(
      "Returned leave request was not resubmitted. Please refresh leave history and try again.",
    );
  }

  if (normalizeText(updatedRequest.status) !== "pending approval") {
    throw new Error(
      `Returned leave request resubmission verification failed. Expected Pending Approval but Supabase returned ${updatedRequest.status || "--"}.`,
    );
  }

  return updatedRequest;
}

async function handleLeaveRequestSubmit() {
  clearPageAlert();

  if (!state.currentUser) {
    showPageAlert("danger", "No active user session found.");
    return;
  }

  calculateLeaveDays();

  if (!validateLeaveRequestForm()) {
    return;
  }

  const supabase = getSupabaseClient();

  const payload = {
    employee_id: getPreferredEmployeeReferenceId(),
    leave_type_id: state.dom.leaveType.value,
    start_date: state.dom.startDate.value,
    end_date: state.dom.endDate.value,
    total_days: Number(state.dom.totalDays.value),
    reason: state.dom.leaveReason.value.trim(),
    status: "Pending Approval",
  };

  const isReturnedResubmission = Boolean(state.returnedLeaveAmendmentRequestId);

  try {
    setLeaveSubmitLoading(true);

    if (isReturnedResubmission) {
      await resubmitReturnedLeaveRequest(payload);
    } else {
      const { error } = await supabase.from("leave_requests").insert([payload]);

      if (error) {
        throw error;
      }
    }

    const successMessage = isReturnedResubmission
      ? "Returned leave request updated and resubmitted for manager review."
      : "Leave request submitted successfully and saved with Pending Approval status.";

    showPageAlert("success", successMessage);

    showEmployeeDashboardToast(
      "success",
      isReturnedResubmission ? "Leave request resubmitted" : "Leave request submitted",
      isReturnedResubmission
        ? "Your returned leave request was updated and sent back for manager review."
        : "Your leave request was submitted successfully and is pending manager review.",
    );

    clearReturnedLeaveAmendmentMode();

    state.dom.leaveRequestForm.reset();
    state.dom.totalDays.value = "";
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();

    await loadEmployeeLeaveRequests();
    await loadEmployeeLeaveBalances();

    // EMPLOYEE LEAVE POST-SUBMIT UX - STEP 1H-A
    // After a successful leave submission, open My Leave History so the
    // employee can immediately see the new Pending Approval record.
    // This changes only post-submit visibility; it does not change leave
    // saving, manager approval, balance calculation, or payroll behaviour.
    showSection("leave");
    setEmployeeLeaveHistoryCardExpanded(true);

    // EMPLOYEE LEAVE POST-SUBMIT UX - STEP 1H-A
    // Reuse the existing desktop height-sync listener after the card opens,
    // so Request Leave and My Leave History stay aligned.
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  } catch (error) {
    console.error("Error submitting leave request:", error);
    showPageAlert(
      "danger",
      error.message || "Unable to submit leave request. Please try again.",
    );
  } finally {
    setLeaveSubmitLoading(false);
  }
}

function setLeaveSubmitLoading(isLoading) {
  const button = state.dom.submitLeaveBtn;
  if (!button) return;

  button.disabled = isLoading;

  if (isLoading) {
    button.classList.remove("btn-secondary");
    button.classList.add("btn-primary");

    const loadingLabel = state.returnedLeaveAmendmentRequestId
      ? "Resubmitting for approval..."
      : "Submitting for approval...";

    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      ${loadingLabel}
    `;
  } else {
    button.innerHTML = getLeaveSubmitButtonDefaultHtml();

    updateLeaveSubmitButtonState();
  }
}

/* =========================================================
   Leave history + decision updates
========================================================= */
async function loadEmployeeLeaveRequests() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    state.leaveRequests = [];
    renderLeaveRequests([]);
    renderLatestDecisionCard([]);
    updateLeaveRequestBlockNotice();
    updateLeaveSubmitButtonState();
    return;
  }

  let query = supabase.from("leave_requests").select(`
      id,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      total_days,
      reason,
      status,
      submitted_at,
      decision_at,
      decision_by,
      decision_by_name,
      decision_comment,
      leave_types (
        name
      )
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query.order("submitted_at", {
    ascending: false,
  });

  if (error) {
    console.error("Error loading leave requests:", error);
    showPageAlert("danger", "Unable to load leave history.");
    return;
  }

  const requests = Array.isArray(data)
    ? data.filter(
      (request, index, array) =>
        array.findIndex((item) => item.id === request.id) === index,
    )
    : [];

  // EMPLOYEE LEAVE POLICY BLOCK - STEP 1C
  // Keep loaded leave requests available to the Request Leave form.
  state.leaveRequests = requests;

  renderLeaveRequests(requests);
  renderLatestDecisionCard(requests);
  updateLeaveRequestBlockNotice();
  updateLeaveSubmitButtonState();
}

function renderLeaveRequests(requests) {
  const list = state.dom.leaveRequestsList;
  if (!list) return;

  list.innerHTML = "";

  if (!requests.length) {
    state.dom.leaveRequestsEmptyState?.classList.remove("d-none");
    state.dom.leaveRequestsList?.classList.add("d-none");
    return;
  }

  state.dom.leaveRequestsEmptyState?.classList.add("d-none");
  state.dom.leaveRequestsList?.classList.remove("d-none");

  requests.forEach((request) => {
    const leaveTypeName = request.leave_types?.name || "Unknown Leave Type";
    const statusText = request.status || "Pending Approval";
    const normalizedStatus = normalizeText(statusText);
    const statusBadgeClass = getDecisionStatusBadgeClass(statusText);

    const startDate = formatDate(request.start_date);
    const endDate = formatDate(request.end_date);
    const totalDays = Number(request.total_days || 0);
    const submittedAt = formatDateTime(request.submitted_at);
    const decisionAt = formatDateTime(request.decision_at);
    const comment = request.decision_comment || "No comment provided.";

    const toneClass =
      normalizedStatus === "approved"
        ? "border-success"
        : normalizedStatus === "rejected"
          ? "border-danger"
          : normalizedStatus === "returned for clarification" ||
            normalizedStatus === "returned"
            ? "border-warning"
            : "border-secondary";

    const iconClass =
      normalizedStatus === "approved"
        ? "bi-check-circle-fill text-success"
        : normalizedStatus === "rejected"
          ? "bi-x-circle-fill text-danger"
          : normalizedStatus === "returned for clarification" ||
            normalizedStatus === "returned"
            ? "bi-exclamation-circle-fill text-warning"
            : "bi-hourglass-split text-secondary";

    const decisionLabel =
      request.decision_at ||
        normalizedStatus === "approved" ||
        normalizedStatus === "rejected" ||
        normalizedStatus === "returned for clarification" ||
        normalizedStatus === "returned"
        ? decisionAt
        : "Awaiting decision";

    // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
    // Returned requests should be amendable by the employee. Other statuses
    // remain read-only to protect approved, rejected, and pending workflows.
    const canEditAndResubmit = isReturnedLeaveRequest(request);

    const editAndResubmitActionHtml = canEditAndResubmit
      ? `
        <div class="d-flex justify-content-end border-top mt-3 pt-3">
          <button
            type="button"
            class="btn btn-sm btn-outline-primary dashboard-action-btn edit-returned-leave-request-btn"
            data-leave-request-id="${escapeHtml(request.id)}"
            title="Edit and resubmit this returned leave request"
            aria-label="Edit and resubmit this returned leave request">
            <i class="bi bi-arrow-repeat me-2"></i>Edit & Resubmit
          </button>
        </div>
      `
      : "";

    const item = document.createElement("div");
    item.className = "mb-2";

    // EMPLOYEE UI CLEANUP - STEP 1O-A
    // Employee-friendly request history card.
    // This replaces the table row layout only; no leave request data is changed.
    item.innerHTML = `
            <div class="border ${toneClass} border-start border-4 rounded-3 bg-white px-3 py-2">
               <div class="d-flex flex-column flex-lg-row justify-content-between gap-2 mb-2">
          <div class="d-flex align-items-start gap-3">
                        <div class="fs-6 lh-1">
              <i class="bi ${iconClass}"></i>
            </div>

            <div>
              <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                <span class="badge ${statusBadgeClass}">
                  ${escapeHtml(statusText)}
                </span>
                <span class="fw-semibold">
                  ${escapeHtml(leaveTypeName)}
                </span>
              </div>

              <div class="small text-secondary lh-sm">
                ${escapeHtml(startDate)} to ${escapeHtml(endDate)} • ${totalDays} day(s)
              </div>
            </div>
          </div>

          <div class="text-lg-end">
            <div class="small text-secondary">Submitted</div>
            <div class="fw-semibold small">${escapeHtml(submittedAt)}</div>
          </div>
        </div>

        <div class="row g-3">
          <div class="col-12 col-md-6">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Decision Date</div>
              <div class="fw-semibold">${escapeHtml(decisionLabel)}</div>
            </div>
          </div>

          <div class="col-12 col-md-6">
            <div class="bg-light border rounded-3 p-2 h-100">
              <div class="small text-secondary mb-1">Manager Comment</div>
              <div class="fw-semibold">${escapeHtml(comment)}</div>
            </div>
          </div>
        </div>

        ${editAndResubmitActionHtml}
      </div>
    `;

    list.appendChild(item);
    // RETURNED LEAVE AMENDMENT WORKFLOW - STEP 1C
    // Wire the returned-request amendment action after the card is rendered.
    item
      .querySelector(".edit-returned-leave-request-btn")
      ?.addEventListener("click", () => {
        startReturnedLeaveAmendment(request.id);
      });
  });
}

function renderLatestDecisionCard(requests) {
  const decisionItems = requests
    .filter(
      (item) =>
        !!item.decision_at ||
        normalizeText(item.status) === "approved" ||
        normalizeText(item.status) === "rejected" ||
        normalizeText(item.status) === "returned for clarification",
    )
    .sort((a, b) => {
      const aValue = a.decision_at || a.submitted_at || "";
      const bValue = b.decision_at || b.submitted_at || "";
      return new Date(bValue) - new Date(aValue);
    });

  if (!decisionItems.length) {
    state.dom.latestDecisionEmptyState?.classList.remove("d-none");
    state.dom.latestDecisionCard?.classList.add("d-none");
    return;
  }

  const latest = decisionItems[0];
  const leaveTypeName = latest.leave_types?.name || "Unknown Leave Type";
  const statusText = latest.status || "Decision Recorded";
  const normalizedStatus = normalizeText(statusText);

  const decisionDate = formatDateTime(latest.decision_at || latest.submitted_at);
  const requestedPeriod = `${formatDate(latest.start_date)} to ${formatDate(
    latest.end_date,
  )}`;
  const totalDays = Number(latest.total_days || 0);
  const decisionBy = latest.decision_by_name || "Manager / Supervisor";
  const decisionComment = latest.decision_comment || "No comment provided.";

  const statusBadgeClass = getDecisionStatusBadgeClass(statusText);

  const outcomeTone =
    normalizedStatus === "approved"
      ? "border-success bg-success-subtle"
      : normalizedStatus === "rejected"
        ? "border-danger bg-danger-subtle"
        : normalizedStatus === "returned for clarification" ||
          normalizedStatus === "returned"
          ? "border-warning bg-warning-subtle"
          : "border-secondary bg-light";

  const outcomeIcon =
    normalizedStatus === "approved"
      ? "bi-check-circle-fill text-success"
      : normalizedStatus === "rejected"
        ? "bi-x-circle-fill text-danger"
        : normalizedStatus === "returned for clarification" ||
          normalizedStatus === "returned"
          ? "bi-exclamation-circle-fill text-warning"
          : "bi-info-circle-fill text-secondary";

  state.dom.latestDecisionEmptyState?.classList.add("d-none");
  state.dom.latestDecisionCard?.classList.remove("d-none");

  // EMPLOYEE UI CLEANUP - STEP 1M
  // Professional HR-style decision summary:
  // - Decision outcome is visually dominant
  // - Leave type, period, approver, and comment are grouped clearly
  // - Presentation only; leave request data is not changed.
  state.dom.latestDecisionCard.innerHTML = `
    <div class="info-tile border-start border-4 ${outcomeTone}">
      <div class="d-flex flex-column flex-lg-row justify-content-between gap-3 mb-4">
        <div class="d-flex align-items-start gap-3">
          <div class="fs-4 lh-1">
            <i class="bi ${outcomeIcon}"></i>
          </div>

          <div>
            <div class="info-tile-label mb-1">Latest Decision</div>
            <div class="d-flex flex-wrap align-items-center gap-2">
              <span class="badge ${statusBadgeClass} fs-6">
                ${escapeHtml(statusText)}
              </span>
              <span class="fw-semibold">
                ${escapeHtml(leaveTypeName)}
              </span>
            </div>
          </div>
        </div>

        <div class="text-lg-end">
          <div class="info-tile-label mb-1">Decision Date & Time</div>
          <div class="fw-semibold">${escapeHtml(decisionDate)}</div>
        </div>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Requested Period</div>
            <div class="fw-semibold">${escapeHtml(requestedPeriod)}</div>
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Total Days</div>
            <div class="fw-semibold">${totalDays} day(s)</div>
          </div>
        </div>

        <div class="col-12 col-md-4">
          <div class="bg-white border rounded-3 p-3 h-100">
            <div class="info-tile-label mb-1">Decision By</div>
            <div class="fw-semibold">${escapeHtml(decisionBy)}</div>
          </div>
        </div>
      </div>

      <div class="bg-white border rounded-3 p-3">
        <div class="info-tile-label mb-1">Manager Comment</div>
        <div class="fw-semibold">${escapeHtml(decisionComment)}</div>
      </div>
    </div>
  `;
}

/* =========================================================
   Employee payroll figure privacy
========================================================= */
function readStoredEmployeePayrollFigureVisibility() {
  try {
    return (
      window.localStorage.getItem(EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY) ===
      "true"
    );
  } catch (error) {
    console.warn("Unable to read payroll figure visibility preference:", error);
    return false;
  }
}

function saveEmployeePayrollFigureVisibility(shouldHide) {
  try {
    window.localStorage.setItem(
      EMPLOYEE_PAYROLL_FIGURES_HIDDEN_KEY,
      shouldHide ? "true" : "false",
    );
  } catch (error) {
    console.warn("Unable to save payroll figure visibility preference:", error);
  }
}

function restoreEmployeePayrollFigureVisibility() {
  state.isPayrollFiguresHidden = readStoredEmployeePayrollFigureVisibility();
  updateEmployeePayrollFigureVisibilityButton();
}

function setEmployeePayrollFiguresHidden(shouldHide, shouldPersist = false) {
  state.isPayrollFiguresHidden = Boolean(shouldHide);

  if (shouldPersist) {
    saveEmployeePayrollFigureVisibility(state.isPayrollFiguresHidden);
  }

  updateEmployeePayrollFigureVisibilityButton();

  // EMPLOYEE PAYROLL PRIVACY - STEP 1H
  // Re-render summary values only. This does not reload, recalculate,
  // mutate, or save any payroll data.
  renderCurrentPayrollSummary(state.payrollRecords || []);
}

function updateEmployeePayrollFigureVisibilityButton() {
  const button = state.dom.togglePayrollFiguresBtn;
  if (!button) return;

  const icon = button.querySelector("i");

  const buttonLabel = state.isPayrollFiguresHidden
    ? "Show payroll figures"
    : "Hide payroll figures";

  button.setAttribute("aria-pressed", String(state.isPayrollFiguresHidden));
  button.setAttribute("aria-label", buttonLabel);
  button.title = buttonLabel;

  if (icon) {
    icon.className = state.isPayrollFiguresHidden
      ? "bi bi-eye"
      : "bi bi-eye-slash";
  }
}

function getEmployeePayrollFigureDisplay(displayValue) {
  return state.isPayrollFiguresHidden ? "••••••" : displayValue;
}

/* =========================================================
   Payroll helpers
========================================================= */
function getPayrollTaxValue(record) {
  const paye = Number(record?.paye_tax || 0);
  const wht = Number(record?.wht_tax || 0);
  return paye > 0 ? paye : wht;
}

function getPayrollTaxLabel(record) {
  const paye = Number(record?.paye_tax || 0);
  const wht = Number(record?.wht_tax || 0);

  // PAYROLL SECURE DELIVERY - STEP 2F-3B-2
  // Use employee-friendly tax labels that match HR payslip preview wording.
  if (paye > 0) return "PAYE Tax";
  if (wht > 0) return "WHT Tax";
  return "No Tax";
}

function getPayrollDisplayGroup(record) {
  return (
    record?.employee_group ||
    state.employeeRecord?.employee_group ||
    state.employeeRecord?.group ||
    state.employeeRecord?.staff_group ||
    state.employeeRecord?.role ||
    "Unassigned"
  );
}

// PAYROLL SECURE DELIVERY - STEP 2F-3B-2
// Convert stored payroll group codes into employee-friendly labels.
// This keeps the employee self-service view aligned with HR wording.
function formatPayrollDisplayGroupLabel(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "Unassigned";

  if (cleanValue.toUpperCase() === "REGULAR") {
    return "Regular";
  }

  return cleanValue
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizePayrollModel(value) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized) return PAYROLL_MODEL_GENERIC;
  if (
    normalized === PAYROLL_MODEL_REGULAR ||
    normalized === "REGULAR_INCREMENT_V1" ||
    normalized === "REGULAR_V1"
  ) {
    return PAYROLL_MODEL_REGULAR;
  }

  return PAYROLL_MODEL_GENERIC;
}

function getPayrollModel(record) {
  const explicitModel = normalizePayrollModel(record?.payroll_model || "");

  if (String(record?.payroll_model || "").trim()) {
    return explicitModel;
  }

  const group = String(getPayrollDisplayGroup(record) || "").trim().toUpperCase();
  return group === "REGULAR" ? PAYROLL_MODEL_REGULAR : PAYROLL_MODEL_GENERIC;
}

function isRegularPayrollRecord(record) {
  return getPayrollModel(record) === PAYROLL_MODEL_REGULAR;
}

function formatPayrollPercent(value, fallbackPercent = null) {
  const hasValue =
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "";

  const numericValue = hasValue ? Number(value) : Number(fallbackPercent);

  if (!Number.isFinite(numericValue)) return "--";

  const resolvedPercent = numericValue > 1 ? numericValue : numericValue * 100;
  return `${resolvedPercent.toFixed(1)}%`;
}

function getRegularStructureVariantLabel(record) {
  const variant = String(
    record?.structure_variant || record?.payroll_model_version || "REGULAR_INCREMENT_V1",
  )
    .trim()
    .toUpperCase();

  if (variant === "REGULAR_INCREMENT_V1" || variant === "V1") {
    return "Regular Increment v1";
  }

  return variant
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildMoneyDisplayItem(label, value, currency, options = {}) {
  return {
    label,
    displayValue: formatCurrency(value, currency),
    emphasis: Boolean(options.emphasis),
  };
}

function buildTextDisplayItem(label, value, options = {}) {
  return {
    label,
    displayValue: value || "--",
    emphasis: Boolean(options.emphasis),
  };
}

function buildGenericPayrollBreakdownItems(record) {
  const currency = record.currency || "NGN";
  const taxValue = getPayrollTaxValue(record);
  const taxLabel = getPayrollTaxLabel(record);

  const rawItems = [
    { label: "Employee Group", value: formatPayrollDisplayGroupLabel(getPayrollDisplayGroup(record)), type: "text" },
    { label: "Monthly Gross Salary", value: Number(record.base_salary || 0), type: "money" },
    { label: "Basic Pay", value: Number(record.basic_pay || 0), type: "money" },
    { label: "Housing Allowance", value: Number(record.housing_allowance || 0), type: "money" },
    { label: "Transport Allowance", value: Number(record.transport_allowance || 0), type: "money" },
    { label: "Utility Allowance", value: Number(record.utility_allowance || 0), type: "money" },
    { label: "Medical Allowance", value: Number(record.medical_allowance || 0), type: "money" },
    { label: "Other Allowance", value: Number(record.other_allowance || 0), type: "money" },
    { label: "Bonus", value: Number(record.bonus || 0), type: "money" },
    { label: "Overtime", value: Number(record.overtime || 0), type: "money" },
    { label: "Logistics Allowance", value: Number(record.logistics_allowance || 0), type: "money" },
    { label: "Data & Airtime", value: Number(record.data_airtime_allowance || 0), type: "money" },
    { label: "Gross Pay", value: Number(record.gross_pay || 0), type: "money", emphasis: true },
    { label: taxLabel, value: Number(taxValue || 0), type: "money" },
    { label: "Employee Pension", value: Number(record.employee_pension || 0), type: "money" },
    { label: "Employer Pension", value: Number(record.employer_pension || 0), type: "money" },
    { label: "Other Deductions", value: Number(record.other_deductions || 0), type: "money" },
    { label: "Total Deductions", value: Number(record.total_deductions || 0), type: "money", emphasis: true },
    { label: "Net Pay", value: Number(record.net_pay || 0), type: "money", emphasis: true },
  ];

  return rawItems
    .filter((item) => {
      if (item.type === "text") return true;
      if (["Gross Pay", "Total Deductions", "Net Pay"].includes(item.label)) {
        return true;
      }
      if (item.label === "No Tax") return false;
      return Number(item.value) !== 0;
    })
    .map((item) => {
      if (item.type === "money") {
        return {
          ...item,
          displayValue: formatCurrency(item.value, currency),
        };
      }

      return {
        ...item,
        displayValue: item.value || "--",
      };
    });
}

function buildRegularPayrollSections(record) {
  const currency = record.currency || "NGN";
  const payeTax = Number(record.paye_tax || 0);
  const whtTax = Number(record.wht_tax || 0);
  const employeePension = Number(record.employee_pension || 0);
  const employerPension = Number(record.employer_pension || 0);
  const otherDeductions = Number(record.other_deductions || 0);
  const logisticsAllowance = Number(record.logistics_allowance || 0);
  const monthlySalaryPlusLogistics = Number(record.monthly_salary_plus_logistics || 0);

  const netSalary =
    monthlySalaryPlusLogistics !== 0 || logisticsAllowance !== 0
      ? monthlySalaryPlusLogistics - logisticsAllowance
      : Number(record.new_base_salary || 0) -
      payeTax -
      whtTax -
      employeePension -
      otherDeductions;

  const salaryStructureItems = [
    buildTextDisplayItem(
      "Employee Group",
      formatPayrollDisplayGroupLabel(getPayrollDisplayGroup(record)),
    ),
    buildTextDisplayItem("Payroll Model", "Alpatech Regular"),
    buildMoneyDisplayItem(
      "Monthly Gross Salary",
      Number(record.base_salary || 0),
      currency,
      { emphasis: true },
    ),
    buildTextDisplayItem(
      "Increment %",
      formatPayrollPercent(record.increment_percent, 5),
    ),
    buildMoneyDisplayItem(
      "Increment Amount",
      Number(record.increment_amount || 0),
      currency,
    ),
    ...(Number(record.merit_increment || 0) !== 0
      ? [
        buildMoneyDisplayItem(
          "Merit Increment",
          Number(record.merit_increment || 0),
          currency,
        ),
      ]
      : []),
    buildMoneyDisplayItem(
      "Revised Monthly Gross Salary",
      Number(record.new_base_salary || 0),
      currency,
      { emphasis: true },
    ),
    buildTextDisplayItem(
      "Basic %",
      formatPayrollPercent(record.basic_percent, 50),
    ),
    buildTextDisplayItem(
      "Housing %",
      formatPayrollPercent(record.housing_percent, 10),
    ),
    buildTextDisplayItem(
      "Transport %",
      formatPayrollPercent(record.transport_percent, 10),
    ),
    buildTextDisplayItem(
      "Utility %",
      formatPayrollPercent(record.utility_percent, 10),
    ),
    buildTextDisplayItem(
      "Other Allowance %",
      formatPayrollPercent(record.other_allowance_percent, 20),
    ),
    buildMoneyDisplayItem(
      "BHT (Basic + Housing + Transport)",
      Number(record.bht || 0),
      currency,
    ),
  ];

  const earningsItems = [];

  if (Number(record.basic_pay || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Basic Pay", Number(record.basic_pay || 0), currency),
    );
  }

  if (Number(record.housing_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Housing Allowance",
        Number(record.housing_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.transport_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Transport Allowance",
        Number(record.transport_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.utility_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Utility Allowance",
        Number(record.utility_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.medical_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Medical Allowance",
        Number(record.medical_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.other_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Other Allowance",
        Number(record.other_allowance || 0),
        currency,
      ),
    );
  }

  if (Number(record.bonus || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Bonus", Number(record.bonus || 0), currency),
    );
  }

  if (Number(record.overtime || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem("Overtime", Number(record.overtime || 0), currency),
    );
  }

  if (logisticsAllowance !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Logistics Allowance",
        logisticsAllowance,
        currency,
      ),
    );
  }

  if (Number(record.data_airtime_allowance || 0) !== 0) {
    earningsItems.push(
      buildMoneyDisplayItem(
        "Data & Airtime",
        Number(record.data_airtime_allowance || 0),
        currency,
      ),
    );
  }

  earningsItems.push(
    buildMoneyDisplayItem(
      "Gross Pay",
      Number(record.gross_pay || 0),
      currency,
      { emphasis: true },
    ),
  );

  const deductionItems = [];

  if (payeTax !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("PAYE Tax", payeTax, currency),
    );
  }

  if (whtTax !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("WHT Tax", whtTax, currency),
    );
  }

  if (employeePension !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("Employee Pension", employeePension, currency),
    );
  }

  if (otherDeductions !== 0) {
    deductionItems.push(
      buildMoneyDisplayItem("Other Deductions", otherDeductions, currency),
    );
  }

  deductionItems.push(
    buildMoneyDisplayItem(
      "Total Deductions",
      Number(record.total_deductions || 0),
      currency,
      { emphasis: true },
    ),
  );

  const employerContributionItems = [];
  if (employerPension !== 0) {
    employerContributionItems.push(
      buildMoneyDisplayItem("Employer Pension", employerPension, currency),
    );
  }

  const netSummaryItems = [
    buildMoneyDisplayItem(
      "Net Salary before Logistics",
      netSalary,
      currency,
    ),
  ];

  if (monthlySalaryPlusLogistics !== 0) {
    netSummaryItems.push(
      buildMoneyDisplayItem(
        "Monthly Salary + Logistics",
        monthlySalaryPlusLogistics,
        currency,
      ),
    );
  }

  netSummaryItems.push(
    buildMoneyDisplayItem(
      "Net Pay",
      Number(record.net_pay || 0),
      currency,
      { emphasis: true },
    ),
  );

  return [
    { title: "Salary Structure", items: salaryStructureItems },
    { title: "Earnings", items: earningsItems },
    { title: "Deductions", items: deductionItems },
    ...(employerContributionItems.length
      ? [{ title: "Employer Contribution", items: employerContributionItems }]
      : []),
    { title: "Net Pay Summary", items: netSummaryItems },
  ];
}

function buildPayrollBreakdownSections(record) {
  if (isRegularPayrollRecord(record)) {
    return buildRegularPayrollSections(record);
  }

  return [
    {
      title: "Payroll Breakdown",
      items: buildGenericPayrollBreakdownItems(record),
    },
  ];
}

// EMPLOYEE UI CLEANUP - STEP 1Q-F FIX
// Build the employee payslip preview content used inside the modal.
// This follows the HR View Payslip card concept, but remains scoped to
// Employee self-service. It does not change payroll data, PDF generation,
// filtering, calculations, or authorised-record rules.
function buildEmployeePayslipPreviewContent(record) {
  const currency = record.currency || "NGN";
  const sections = buildPayrollBreakdownSections(record);

  const employeeName =
    `${state.employeeRecord?.first_name || ""} ${state.employeeRecord?.last_name || ""}`.trim() ||
    "Employee";

  const employeeEmail =
    state.employeeRecord?.work_email ||
    state.currentProfile?.email ||
    state.currentUser?.email ||
    "--";

  const employeeId = getEmployeeIdDisplayValue(state.employeeRecord || {});
  const department = state.employeeRecord?.department || "--";
  const jobTitle =
    state.employeeRecord?.job_title ||
    state.employeeRecord?.position ||
    "Employee";

  const renderPayslipModalItems = (items = []) => {
    const visibleItems = Array.isArray(items) ? items : [];

    if (!visibleItems.length) {
      return `
        <div class="text-secondary small border rounded-3 p-3">
          No payroll line items recorded.
        </div>
      `;
    }

    return visibleItems
      .map((item) => {
        const valueClass = item.emphasis ? "fw-bold" : "fw-semibold";

        return `
          <div class="d-flex justify-content-between gap-3 border-bottom py-2">
            <span>${escapeHtml(item.label)}</span>
            <span class="${valueClass} text-end">
              ${escapeHtml(item.displayValue)}
            </span>
          </div>
        `;
      })
      .join("");
  };

  const sectionCardsHtml = sections
    .map((section) => {
      const isHalfWidth =
        section.title === "Earnings" ||
        section.title === "Deductions" ||
        section.title === "Payroll Breakdown";

      return `
        <div class="${isHalfWidth ? "col-lg-6" : "col-12"}">
          <div class="border rounded-4 p-4 h-100">
            <h3 class="h6 fw-bold mb-3">${escapeHtml(section.title)}</h3>
            ${renderPayslipModalItems(section.items)}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="border rounded-4 p-3 p-lg-4 mb-4">
      <div class="d-flex flex-column flex-md-row justify-content-between gap-4">
        <div>
          <div class="text-secondary small">Employee</div>
          <div class="h5 mb-1">${escapeHtml(employeeName)}</div>
          <div class="text-secondary small text-break">
            ${escapeHtml(employeeEmail)}
          </div>
          <div class="text-secondary small">
            ${escapeHtml(department)} • ${escapeHtml(jobTitle)}
          </div>
        </div>

        <div class="text-md-end">
          <div class="text-secondary small">Employee No.</div>
          <div class="fw-semibold">${escapeHtml(employeeId)}</div>

          <div class="text-secondary small mt-3">Pay Cycle</div>
          <div class="fw-semibold">${escapeHtml(record.pay_cycle || "--")}</div>

          <div class="text-secondary small mt-3">Pay Date</div>
          <div class="fw-semibold">${formatDate(record.pay_date)}</div>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="border rounded-4 p-3 h-100">
          <div class="text-secondary small">Gross Pay</div>
          <div class="h5 mb-0">
            ${escapeHtml(formatCurrency(record.gross_pay, currency))}
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="border rounded-4 p-3 h-100">
          <div class="text-secondary small">Total Deductions</div>
          <div class="h5 mb-0">
            ${escapeHtml(formatCurrency(record.total_deductions, currency))}
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="border rounded-4 p-3 h-100">
          <div class="text-secondary small">Net Pay</div>
          <div class="h5 mb-0">
            ${escapeHtml(formatCurrency(record.net_pay, currency))}
          </div>
        </div>
      </div>
    </div>

    <div class="row g-4">
      ${sectionCardsHtml}
    </div>

    <div class="alert alert-light border mt-4 mb-0">
      <div class="fw-semibold mb-1">Authorised payslip details</div>
      <div class="small text-secondary">
        This is a read-only view of your authorised payslip details. Use the PDF action in Payroll History to download a payslip copy.
      </div>
    </div>
  `;
}


// EMPLOYEE UI CLEANUP - STEP 1Q-F FIX
// Create the payslip preview modal from JavaScript so employee-dashboard.html
// does not need another structural patch. This mirrors the HR payslip preview
// modal pattern while keeping Employee self-service scoped and read-only.
function ensureEmployeePayslipPreviewModal() {
  let modal = document.getElementById("employeePayslipPreviewModal");

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "employeePayslipPreviewModal";
  modal.className = "d-none position-fixed top-0 start-0 w-100 h-100";
  modal.style.zIndex = "1060";
  modal.style.background = "rgba(15, 23, 42, 0.45)";
  modal.setAttribute("aria-hidden", "true");

  modal.innerHTML = `
    <div class="container h-100 d-flex align-items-center justify-content-center py-4">
      <div class="card border-0 shadow-lg rounded-4 w-100" style="max-width: 880px; max-height: 92vh; overflow: auto;">
        <div class="card-header bg-white border-0 d-flex justify-content-between align-items-start gap-3 p-4">
          <div>
            <h2 id="employeePayslipPreviewTitle" class="h4 mb-1">
              Payslip Details
            </h2>
            <p class="text-secondary mb-0">
              Review your authorised payslip details for this pay cycle.
            </p>
          </div>

          <button type="button" id="closeEmployeePayslipPreviewBtn"
            class="btn btn-sm btn-outline-secondary"
            aria-label="Close payslip details">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div id="employeePayslipPreviewContent" class="card-body p-4">
          <div class="text-center text-secondary py-4">
            Select a payroll record to view payslip details.
          </div>
        </div>

        <div class="card-footer bg-light border-0 d-flex justify-content-end gap-2 p-4">
          <button type="button" id="closeEmployeePayslipPreviewFooterBtn"
            class="btn btn-outline-secondary dashboard-action-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal
    .querySelector("#closeEmployeePayslipPreviewBtn")
    ?.addEventListener("click", closeEmployeePayslipPreviewModal);

  modal
    .querySelector("#closeEmployeePayslipPreviewFooterBtn")
    ?.addEventListener("click", closeEmployeePayslipPreviewModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeEmployeePayslipPreviewModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEmployeePayslipPreviewModal();
    }
  });

  return modal;
}

// EMPLOYEE UI CLEANUP - STEP 1Q-F FIX
// Open the Employee payslip preview modal and prevent page scroll behind it.
function showEmployeePayslipPreviewModal() {
  const modal = ensureEmployeePayslipPreviewModal();

  modal.classList.remove("d-none");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("overflow-hidden");
}

// EMPLOYEE UI CLEANUP - STEP 1Q-F FIX
// Close the Employee payslip preview modal and restore page scroll.
function closeEmployeePayslipPreviewModal() {
  const modal = document.getElementById("employeePayslipPreviewModal");
  if (!modal) return;

  modal.classList.add("d-none");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("overflow-hidden");
}

// EMPLOYEE UI CLEANUP - STEP 1Q-F FIX
// Render one authorised payroll record into the modal card.
function openEmployeePayslipPreview(payrollId) {
  const payrollRecord = (state.payrollRecords || []).find(
    (record) => String(record.id) === String(payrollId),
  );

  if (!payrollRecord) {
    showPageAlert(
      "warning",
      "The selected payroll record could not be found. Please refresh payroll history and try again.",
    );
    return;
  }

  if (normalizeText(payrollRecord.status) !== "authorised" || !payrollRecord.is_finalised) {
    showPageAlert(
      "warning",
      "Payslip details are only available for authorised payroll records.",
    );
    return;
  }

  clearPageAlert();

  const modal = ensureEmployeePayslipPreviewModal();
  const title = modal.querySelector("#employeePayslipPreviewTitle");
  const content = modal.querySelector("#employeePayslipPreviewContent");

  if (title) {
    title.textContent = `Payslip Details - ${payrollRecord.pay_cycle || "Pay Cycle"}`;
  }

  if (content) {
    content.innerHTML = buildEmployeePayslipPreviewContent(payrollRecord);
  }

  showEmployeePayslipPreviewModal();
}


/* =========================================================
   Payroll
========================================================= */
async function loadEmployeePayroll() {
  const supabase = getSupabaseClient();
  const employeeIdentityCandidates = getEmployeeIdentityCandidates();

  if (!employeeIdentityCandidates.length) {
    renderPayroll([]);
    return;
  }

  let query = supabase.from("payroll_records").select(`
      id,
      employee_id,
      pay_cycle,
      pay_date,
      employee_group,

      payroll_model,
      payroll_model_version,
      structure_variant,
      payslip_layout,

      base_salary,
      increment_percent,
      increment_amount,
      merit_increment,
      new_base_salary,
      basic_percent,
      housing_percent,
      transport_percent,
      utility_percent,
      other_allowance_percent,
      bht,
      monthly_salary_plus_logistics,

      basic_pay,
      housing_allowance,
      transport_allowance,
      utility_allowance,
      medical_allowance,
      other_allowance,
      bonus,
      overtime,
      logistics_allowance,
      data_airtime_allowance,

      gross_pay,
      paye_tax,
      wht_tax,
      employee_pension,
      employer_pension,
      other_deductions,
      total_deductions,
      net_pay,

      currency,
      status,
      is_finalised,
      created_at,
      updated_at
    `);

  if (employeeIdentityCandidates.length === 1) {
    query = query.eq("employee_id", employeeIdentityCandidates[0]);
  } else {
    query = query.in("employee_id", employeeIdentityCandidates);
  }

  const { data, error } = await query
    .eq("status", "Authorised")
    .eq("is_finalised", true)
    .order("pay_date", { ascending: false });

  if (error) {
    console.error("Error loading payroll records:", error);
    showPageAlert("danger", "Unable to load payroll history.");
    return;
  }

  const records = Array.isArray(data)
    ? data.filter(
      (record, index, array) =>
        array.findIndex((item) => item.id === record.id) === index,
    )
    : [];

  state.payrollRecords = records;
  applyPayrollFilters();
}
function renderPayroll(records) {
  const historyRecords = Array.isArray(records) ? records : [];
  renderCurrentPayrollSummary(state.payrollRecords);
  renderPayrollHistory(historyRecords);
}

function getFilteredPayrollRecords() {
  const records = Array.isArray(state.payrollRecords) ? state.payrollRecords : [];

  const searchValue = normalizeText(state.dom.payrollSearchInput?.value || "");
  const fromDateValue = state.dom.payrollDateFromInput?.value || "";
  const toDateValue = state.dom.payrollDateToInput?.value || "";

  return records.filter((record) => {
    const payCycle = normalizeText(record?.pay_cycle || "");
    const matchesSearch = !searchValue || payCycle.includes(searchValue);

    if (!matchesSearch) {
      return false;
    }

    const recordDateValue = String(record?.pay_date || "").trim();
    if (!recordDateValue) {
      return !fromDateValue && !toDateValue;
    }

    const recordDate = new Date(recordDateValue);
    if (Number.isNaN(recordDate.getTime())) {
      return false;
    }

    if (fromDateValue) {
      const fromDate = new Date(fromDateValue);
      if (!Number.isNaN(fromDate.getTime()) && recordDate < fromDate) {
        return false;
      }
    }

    if (toDateValue) {
      const toDate = new Date(toDateValue);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        if (recordDate > toDate) {
          return false;
        }
      }
    }

    return true;
  });
}

function applyPayrollFilters() {
  renderPayroll(getFilteredPayrollRecords());
}

function clearPayrollFilters() {
  if (state.dom.payrollSearchInput) state.dom.payrollSearchInput.value = "";
  if (state.dom.payrollDateFromInput) state.dom.payrollDateFromInput.value = "";
  if (state.dom.payrollDateToInput) state.dom.payrollDateToInput.value = "";

  applyPayrollFilters();
}

function renderCurrentPayrollSummary(records) {
  const payrollRecords = Array.isArray(records) ? records : [];

  if (!payrollRecords.length) {
    state.dom.currentPayrollEmptyState?.classList.remove("d-none");
    state.dom.currentPayrollSummaryGrid?.classList.add("d-none");
    return;
  }

  const latest = payrollRecords[0];

  state.dom.currentPayrollEmptyState?.classList.add("d-none");
  state.dom.currentPayrollSummaryGrid?.classList.remove("d-none");

  if (state.dom.currentPayCycle) {
    state.dom.currentPayCycle.textContent = latest.pay_cycle || "--";
  }

  if (state.dom.currentGrossPay) {
    state.dom.currentGrossPay.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.gross_pay, latest.currency || "NGN"),
    );
  }

  if (state.dom.currentTotalDeductions) {
    state.dom.currentTotalDeductions.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.total_deductions, latest.currency || "NGN"),
    );
  }

  if (state.dom.currentNetPay) {
    state.dom.currentNetPay.textContent = getEmployeePayrollFigureDisplay(
      formatCurrency(latest.net_pay, latest.currency || "NGN"),
    );
  }
}

function renderPayrollHistory(records) {
  const tbody = state.dom.payrollHistoryTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!records.length) {
    state.dom.payrollHistoryEmptyState?.classList.remove("d-none");
    state.dom.payrollHistoryTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.payrollHistoryEmptyState?.classList.add("d-none");
  state.dom.payrollHistoryTableWrapper?.classList.remove("d-none");

  records.forEach((record) => {
    const currency = record.currency || "NGN";
    const taxValue = getPayrollTaxValue(record);
    const taxLabel = getPayrollTaxLabel(record);
    const employeePension = Number(record.employee_pension || 0);

    // EMPLOYEE UI CLEANUP - STEP 1F
    // Keep payroll group under the Pay Cycle cell, matching the compact
    // records-card style used elsewhere. This removes the separate Group column.
    const employeeGroup = formatPayrollDisplayGroupLabel(
      getPayrollDisplayGroup(record),
    );

    const row = document.createElement("tr");
    row.className = "payroll-summary-row";
    row.dataset.payrollId = record.id;

    const taxCellHtml =
      taxValue > 0
        ? `
          <div class="fw-semibold">${formatCurrency(taxValue, currency)}</div>
          <div class="small text-secondary">${escapeHtml(taxLabel)}</div>
        `
        : `
          <div class="small text-secondary">No Tax</div>
        `;

    // EMPLOYEE UI CLEANUP - STEP 1F
    // Compact row layout:
    // - Pay Cycle and Employee Group are grouped in the first cell.
    // - Action buttons remain icon-only.
    // - Column count is reduced from 11 to 10.
    row.innerHTML = `
      <td class="text-nowrap">
        <div class="fw-semibold">${escapeHtml(record.pay_cycle || "--")}</div>
        <div class="small text-secondary">${escapeHtml(employeeGroup || "--")}</div>
      </td>

      <td class="text-nowrap">${formatDate(record.pay_date)}</td>

      <td class="text-nowrap">${formatCurrency(record.gross_pay, currency)}</td>

      <td class="text-nowrap">${taxCellHtml}</td>

      <td class="text-nowrap">${formatCurrency(employeePension, currency)}</td>

      <td class="text-nowrap">${formatCurrency(record.total_deductions, currency)}</td>

      <td class="text-nowrap">
        <div class="fw-semibold">${formatCurrency(record.net_pay, currency)}</div>
      </td>

      <td class="text-center text-nowrap">
        <span class="badge text-bg-success">
          ${escapeHtml(record.status || "Authorised")}
        </span>
      </td>

      <td class="text-center text-nowrap">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary payroll-breakdown-btn d-inline-flex align-items-center justify-content-center"
          data-payroll-id="${escapeHtml(record.id)}"
          data-expanded="false"
          title="View payslip details"
          aria-label="View payslip details"
          style="width: 36px; height: 32px;"
        >
          <i class="bi bi-eye"></i>
        </button>
      </td>

      <td class="text-center text-nowrap">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary download-payslip-btn d-inline-flex align-items-center justify-content-center"
          data-payroll-id="${escapeHtml(record.id)}"
          title="Download payslip PDF"
          aria-label="Download payslip PDF"
          style="width: 36px; height: 32px;"
        >
          <i class="bi bi-file-earmark-pdf"></i>
        </button>
      </td>
    `;

    // EMPLOYEE UI CLEANUP - STEP 1Q-F PDF FIX
    // Append the payroll row, then wire each row action separately:
    // - PDF downloads the authorised payslip.
    // - View opens the payslip details modal.
    // This restores the PDF click handler removed during the modal conversion.
    tbody.appendChild(row);

    const downloadButton = row.querySelector(".download-payslip-btn");
    downloadButton?.addEventListener("click", async () => {
      const payrollId = downloadButton.getAttribute("data-payroll-id");
      await downloadPayslipPdf(payrollId, downloadButton);
    });

    const breakdownButton = row.querySelector(".payroll-breakdown-btn");
    breakdownButton?.addEventListener("click", () => {
      const payrollId = breakdownButton.getAttribute("data-payroll-id");
      openEmployeePayslipPreview(payrollId);
    });
  });
}

/* =========================================================
   Download payslip PDF with jsPDF
========================================================= */
function buildGenericPayslipBreakdownRows(payrollRecord) {
  const currency = payrollRecord.currency || "NGN";
  const taxValue = getPayrollTaxValue(payrollRecord);
  const taxLabel = getPayrollTaxLabel(payrollRecord);

  const rawRows = [
    ["Base Salary", Number(payrollRecord.base_salary || 0)],
    ["Basic Pay", Number(payrollRecord.basic_pay || 0)],
    ["Housing Allowance", Number(payrollRecord.housing_allowance || 0)],
    ["Transport Allowance", Number(payrollRecord.transport_allowance || 0)],
    ["Utility Allowance", Number(payrollRecord.utility_allowance || 0)],
    ["Medical Allowance", Number(payrollRecord.medical_allowance || 0)],
    ["Other Allowance", Number(payrollRecord.other_allowance || 0)],
    ["Bonus", Number(payrollRecord.bonus || 0)],
    ["Overtime", Number(payrollRecord.overtime || 0)],
    ["Logistics Allowance", Number(payrollRecord.logistics_allowance || 0)],
    ["Data & Airtime", Number(payrollRecord.data_airtime_allowance || 0)],
    ["Gross Pay", Number(payrollRecord.gross_pay || 0)],
    [taxLabel, Number(taxValue || 0)],
    ["Employee Pension", Number(payrollRecord.employee_pension || 0)],
    ["Employer Pension", Number(payrollRecord.employer_pension || 0)],
    ["Other Deductions", Number(payrollRecord.other_deductions || 0)],
    ["Total Deductions", Number(payrollRecord.total_deductions || 0)],
    ["Net Pay", Number(payrollRecord.net_pay || 0)],
  ];

  return rawRows
    .filter(([label, amount]) => {
      const alwaysShow = ["Gross Pay", "Total Deductions", "Net Pay"];
      if (alwaysShow.includes(label)) return true;
      if (label === "No Tax") return false;
      return Number(amount) !== 0;
    })
    .map(([label, amount]) => ({
      label,
      value: formatCurrency(amount, currency),
      emphasis: ["Gross Pay", "Total Deductions", "Net Pay"].includes(label),
    }));
}

function buildPayslipSections(payrollRecord) {
  if (isRegularPayrollRecord(payrollRecord)) {
    return buildRegularPayrollSections(payrollRecord).map((section) => ({
      title: section.title,
      rows: section.items.map((item) => ({
        label: item.label,
        value: item.displayValue,
        emphasis: Boolean(item.emphasis),
      })),
    }));
  }

  return [
    {
      title: "Payroll Breakdown",
      rows: buildGenericPayslipBreakdownRows(payrollRecord),
    },
  ];
}

function ensurePdfVerticalSpace(doc, currentY, requiredHeight) {
  if (currentY + requiredHeight <= 280) {
    return currentY;
  }

  doc.addPage();
  return 20;
}

function drawPdfSectionTable(doc, title, rows, startY) {
  let y = ensurePdfVerticalSpace(doc, startY, 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(17, 24, 39);
  doc.text(title, 14, y);

  y += 6;
  y = ensurePdfVerticalSpace(doc, y, 12);

  doc.setFillColor(243, 244, 246);
  doc.rect(14, y, 182, 9, "F");
  doc.setDrawColor(209, 213, 219);
  doc.rect(14, y, 182, 9);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Description", 18, y + 6);
  doc.text("Amount / Value", 170, y + 6, { align: "right" });

  y += 9;

  rows.forEach((row) => {
    y = ensurePdfVerticalSpace(doc, y, 10);

    doc.rect(14, y, 182, 9);

    doc.setFont("helvetica", row.emphasis ? "bold" : "normal");
    doc.setFontSize(10);
    doc.text(String(row.label || "--"), 18, y + 6);
    doc.text(String(row.value || "--"), 170, y + 6, { align: "right" });

    y += 9;
  });

  return y + 6;
}

async function downloadPayslipPdf(payrollId, buttonElement) {
  try {
    clearPageAlert();

    const payrollRecord = state.payrollRecords.find(
      (record) => record.id === payrollId,
    );

    if (!payrollRecord) {
      showPageAlert(
        "danger",
        "Payslip could not be generated because the payroll record was not found.",
      );
      return;
    }

    if ((payrollRecord.status || "").toLowerCase() !== "authorised") {
      showPageAlert(
        "warning",
        "Only authorised payroll records can be downloaded as payslips.",
      );
      return;
    }

    if (!window.jspdf || !window.jspdf.jsPDF) {
      showPageAlert("danger", "jsPDF library is not available.");
      return;
    }

    setPayslipDownloadLoading(buttonElement, true);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");

    const employeeName =
      `${state.employeeRecord?.first_name || ""} ${state.employeeRecord?.last_name || ""}`.trim() ||
      "Employee";

    const employeeEmail =
      state.employeeRecord?.work_email ||
      state.currentProfile?.email ||
      state.currentUser?.email ||
      "--";

    const employeeId = getEmployeeIdDisplayValue(state.employeeRecord || {});
    const department = state.employeeRecord?.department || "--";
    // PAYROLL SECURE DELIVERY - STEP 2F-3B-2
    // Use the same employee-friendly payroll group label in the PDF.
    const employeeGroup = formatPayrollDisplayGroupLabel(
      getPayrollDisplayGroup(payrollRecord),
    );
    const currency = (payrollRecord.currency || "NGN").toUpperCase();
    const payslipSections = buildPayslipSections(payrollRecord);

    doc.setFillColor(185, 106, 16);
    doc.rect(0, 0, 210, 28, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("HR & Payroll System", 14, 14);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Official Employee Payslip", 14, 21);

    doc.setTextColor(17, 24, 39);

    let y = 40;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Employee Details", 14, y);

    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(`Name: ${employeeName}`, 14, y);
    y += 6;
    doc.text(`Email: ${employeeEmail}`, 14, y);
    y += 6;
    doc.text(`Employee ID: ${employeeId}`, 14, y);
    y += 6;
    doc.text(`Department: ${department}`, 14, y);
    y += 6;
    doc.text(`Employee Group: ${employeeGroup}`, 14, y);

    let rightY = 48;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Pay Details", 120, 40);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(`Pay Cycle: ${payrollRecord.pay_cycle || "--"}`, 120, rightY);
    rightY += 6;
    doc.text(`Pay Date: ${formatDate(payrollRecord.pay_date)}`, 120, rightY);
    rightY += 6;
    doc.text(`Status: ${payrollRecord.status || "--"}`, 120, rightY);
    rightY += 6;
    doc.text(`Currency: ${currency}`, 120, rightY);
    if (!isRegularPayrollRecord(payrollRecord)) {
      rightY += 6;
      doc.text("Payroll Model: Generic", 120, rightY);
    }

    y = 86;
    doc.setDrawColor(209, 213, 219);
    doc.line(14, y, 196, y);
    y += 10;

    payslipSections.forEach((section) => {
      y = drawPdfSectionTable(doc, section.title, section.rows, y);
    });

    y = ensurePdfVerticalSpace(doc, y + 6, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(
      "This payslip was generated from an authorised payroll record in the HR & Payroll System.",
      14,
      y,
    );

    const safePayCycle = (payrollRecord.pay_cycle || "Payslip")
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "");

    const safeEmployeeName =
      employeeName.replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "Employee";

    const filename = `Payslip_${safePayCycle}_${safeEmployeeName}.pdf`;
    doc.save(filename);

    showPageAlert("success", "Payslip PDF downloaded successfully.");
  } catch (error) {
    console.error("Error generating payslip PDF:", error);
    showPageAlert("danger", error.message || "Unable to generate payslip PDF.");
  } finally {
    setPayslipDownloadLoading(buttonElement, false);
  }
}

function setPayslipDownloadLoading(buttonElement, isLoading) {
  if (!buttonElement) return;

  buttonElement.disabled = isLoading;

  if (isLoading) {
    buttonElement.innerHTML = `
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
    `;
    buttonElement.title = "Generating payslip PDF";
    buttonElement.setAttribute("aria-label", "Generating payslip PDF");
    return;
  }

  // EMPLOYEE UI CLEANUP - STEP 1E
  // Restore icon-only PDF action after payslip generation completes.
  buttonElement.innerHTML = `<i class="bi bi-file-earmark-pdf"></i>`;
  buttonElement.title = "Download payslip PDF";
  buttonElement.setAttribute("aria-label", "Download payslip PDF");
}

/* =========================================================
   Common helpers
========================================================= */
function getDecisionStatusBadgeClass(status) {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "text-bg-success";
    case "rejected":
      return "text-bg-danger";
    case "returned":
    case "returned for clarification":
      return "text-bg-warning";
    case "pending approval":
    default:
      return "text-bg-secondary";
  }
}

function showPageAlert(type, message) {
  if (!state.dom.pageAlert) return;
  state.dom.pageAlert.className = `alert alert-${type} mb-4`;
  state.dom.pageAlert.textContent = message;
  state.dom.pageAlert.classList.remove("d-none");
}

function clearPageAlert() {
  if (!state.dom.pageAlert) return;
  state.dom.pageAlert.className = "alert d-none mb-4";
  state.dom.pageAlert.textContent = "";
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Creates a lightweight bottom-right toast from JS so employee-dashboard.html
// does not need a structural patch. This is notification-only.
function ensureEmployeeDashboardToast() {
  let toast = document.getElementById("employeeDashboardToast");

  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = "employeeDashboardToast";
  toast.className =
    "position-fixed bottom-0 end-0 m-4 bg-white border shadow-lg rounded-4 overflow-hidden d-none";
  toast.style.zIndex = "1080";
  toast.style.width = "calc(100% - 2rem)";
  toast.style.maxWidth = "360px";

  toast.innerHTML = `
    <div id="employeeDashboardToastAccent" class="bg-primary" style="height: 4px;"></div>

    <div class="d-flex align-items-start gap-3 p-3">
      <div id="employeeDashboardToastIcon"
        class="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 text-bg-primary"
        style="width: 36px; height: 36px;">
        <i class="bi bi-info-circle"></i>
      </div>

      <div class="flex-grow-1">
        <div id="employeeDashboardToastTitle" class="fw-semibold">
          Notification
        </div>
        <div id="employeeDashboardToastMessage" class="small text-secondary mt-1">
        </div>
      </div>

      <button type="button" id="employeeDashboardToastCloseBtn"
        class="btn btn-sm btn-link text-secondary p-0"
        aria-label="Close notification">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  `;

  document.body.appendChild(toast);

  toast
    .querySelector("#employeeDashboardToastCloseBtn")
    ?.addEventListener("click", hideEmployeeDashboardToast);

  return toast;
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Bottom-right employee feedback. Used after successful leave submission so
// the employee sees confirmation even when the top alert is out of view.
function showEmployeeDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = ensureEmployeeDashboardToast();

  const accent = toast.querySelector("#employeeDashboardToastAccent");
  const icon = toast.querySelector("#employeeDashboardToastIcon");
  const titleEl = toast.querySelector("#employeeDashboardToastTitle");
  const messageEl = toast.querySelector("#employeeDashboardToastMessage");

  const themeMap = {
    success: {
      accentClass: "bg-success",
      iconClass: "text-bg-success",
      iconHtml: '<i class="bi bi-check-circle"></i>',
    },
    warning: {
      accentClass: "bg-warning",
      iconClass: "text-bg-warning",
      iconHtml: '<i class="bi bi-exclamation-triangle"></i>',
    },
    danger: {
      accentClass: "bg-danger",
      iconClass: "text-bg-danger",
      iconHtml: '<i class="bi bi-x-octagon"></i>',
    },
    info: {
      accentClass: "bg-primary",
      iconClass: "text-bg-primary",
      iconHtml: '<i class="bi bi-info-circle"></i>',
    },
  };

  const theme = themeMap[type] || themeMap.info;

  if (accent) {
    accent.className = theme.accentClass;
    accent.style.height = "4px";
  }

  if (icon) {
    icon.className =
      `rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 ${theme.iconClass}`;
    icon.style.width = "36px";
    icon.style.height = "36px";
    icon.innerHTML = theme.iconHtml;
  }

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message || "";

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideEmployeeDashboardToast();
  }, 8000);
}

// EMPLOYEE LEAVE UX WIRING - STEP 1A
// Hide the toast without touching leave form, history, balance, or payroll data.
function hideEmployeeDashboardToast() {
  const toast = document.getElementById("employeeDashboardToast");
  toast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

function formatDate(dateValue) {
  if (!dateValue) return "--";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateValue) {
  if (!dateValue) return "--";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value, currency = "NGN") {
  const numericValue = Number(value || 0);
  const resolvedCurrency = String(currency || "NGN").toUpperCase();

  if (resolvedCurrency === "NGN") {
    return `NGN ${numericValue.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
  } catch (error) {
    return `${resolvedCurrency} ${numericValue.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}