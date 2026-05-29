// EMPLOYEE SELF-SERVICE MODULE
// ============================
// Shared self-service workspace used inside the HR Dashboard and Manager
// Dashboard so staff who hold those roles can still apply for leave, view
// their own leave balances and history, and print their own payslips.
//
// All DOM IDs in this module are prefixed with "ss" to avoid collisions
// with the host dashboard's own elements.
//
// Usage:
//   await window.EmployeeSelfService.init(currentUser, currentProfile);
//
// The init() call is idempotent — calling it again after the first load
// silently refreshes data without re-wiring event listeners.

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  const SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS = [
    "maternity",
    "paternity",
    "adoption",
  ];

  // -----------------------------------------------------------------------
  // Module-scoped state
  // -----------------------------------------------------------------------
  const ssState = {
    currentUser: null,
    currentProfile: null,
    employeeRecord: null,
    identity: {
      authUserId: null,
      employeeRowId: null,
      linkedUserId: null,
    },
    leaveRequests: [],
    payrollRecords: [],
    isPayrollFiguresHidden: false,
    returnedLeaveAmendmentRequestId: null,
    isInitialized: false,
    dom: {},
  };

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  function getSupabaseClient() {
    if (!window.supabaseClient) {
      throw new Error("Supabase client is not available.");
    }
    return window.supabaseClient;
  }

  function ssNormalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function ssNormalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function ssEscapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ssFormatCurrency(value, currency = "NGN") {
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
    } catch {
      return `${resolvedCurrency} ${numericValue.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }

  function ssFormatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return ssEscapeHtml(value);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function ssFormatDateTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return ssEscapeHtml(value);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function showSsAlert(type, message) {
    const el = ssState.dom.ssSelfServiceAlert;
    if (!el) return;
    el.className = `alert alert-${type} mb-4`;
    el.textContent = message;
    el.classList.remove("d-none");
  }

  function clearSsAlert() {
    const el = ssState.dom.ssSelfServiceAlert;
    if (!el) return;
    el.classList.add("d-none");
    el.textContent = "";
  }

  // -----------------------------------------------------------------------
  // Identity
  // -----------------------------------------------------------------------
  function getSsIdentityCandidates() {
    const candidates = [
      ssState.identity?.linkedUserId,
      ssState.identity?.authUserId,
      ssState.identity?.employeeRowId,
    ].filter(Boolean);
    return [...new Set(candidates)];
  }

  function getPreferredSsEmployeeId() {
    return (
      ssState.identity?.linkedUserId ||
      ssState.identity?.authUserId ||
      ssState.identity?.employeeRowId ||
      null
    );
  }

  function applySsResolvedIdentity(employee) {
    if (!employee) return;
    ssState.identity.authUserId = ssState.currentUser?.id || null;
    ssState.identity.employeeRowId = employee.id || null;
    ssState.identity.linkedUserId = employee.user_id || ssState.currentUser?.id || null;
  }

  // -----------------------------------------------------------------------
  // DOM caching
  // -----------------------------------------------------------------------
  function cacheSsDomElements() {
    ssState.dom = {
      ssSelfServiceAlert: document.getElementById("ssSelfServiceAlert"),

      ssNavLeaveBtn: document.getElementById("ssNavLeaveBtn"),
      ssNavPayrollBtn: document.getElementById("ssNavPayrollBtn"),

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-2
      // Visible shortcut from the Leave screen back to Payroll.
      ssGoToPayrollFromLeaveBtn: document.getElementById("ssGoToPayrollFromLeaveBtn"),

      ssLeaveSection: document.getElementById("ssLeaveSection"),
      ssPayrollSection: document.getElementById("ssPayrollSection"),

      // Leave balances collapse
      ssLeaveBalancesCardCollapse: document.getElementById("ssLeaveBalancesCardCollapse"),
      ssToggleLeaveBalancesCardBtn: document.getElementById("ssToggleLeaveBalancesCardBtn"),
      ssRefreshLeaveBalancesBtn: document.getElementById("ssRefreshLeaveBalancesBtn"),
      ssLeaveBalancesEmptyState: document.getElementById("ssLeaveBalancesEmptyState"),
      ssLeaveBalancesGrid: document.getElementById("ssLeaveBalancesGrid"),

      // Latest leave decision collapse
      ssLatestDecisionCardCollapse: document.getElementById("ssLatestDecisionCardCollapse"),
      ssToggleLatestDecisionCardBtn: document.getElementById("ssToggleLatestDecisionCardBtn"),
      ssRefreshLatestDecisionBtn: document.getElementById("ssRefreshLatestDecisionBtn"),
      ssLatestDecisionEmptyState: document.getElementById("ssLatestDecisionEmptyState"),
      ssLatestDecisionCard: document.getElementById("ssLatestDecisionCard"),
      ssLatestDecisionStatus: document.getElementById("ssLatestDecisionStatus"),
      ssLatestDecisionLeaveType: document.getElementById("ssLatestDecisionLeaveType"),
      ssLatestDecisionDateTime: document.getElementById("ssLatestDecisionDateTime"),
      ssLatestDecisionPeriod: document.getElementById("ssLatestDecisionPeriod"),
      ssLatestDecisionBy: document.getElementById("ssLatestDecisionBy"),
      ssLatestDecisionComment: document.getElementById("ssLatestDecisionComment"),

      // Leave request form
      ssLeaveRequestForm: document.getElementById("ssLeaveRequestForm"),
      ssLeaveType: document.getElementById("ssLeaveType"),
      ssStartDate: document.getElementById("ssStartDate"),
      ssEndDate: document.getElementById("ssEndDate"),
      ssTotalDays: document.getElementById("ssTotalDays"),
      ssLeaveReason: document.getElementById("ssLeaveReason"),
      ssSubmitLeaveBtn: document.getElementById("ssSubmitLeaveBtn"),
      ssLeaveRequestBlockNotice: document.getElementById("ssLeaveRequestBlockNotice"),

      // Leave history
      ssLeaveHistoryCardCollapse: document.getElementById("ssLeaveHistoryCardCollapse"),
      ssToggleLeaveHistoryCardBtn: document.getElementById("ssToggleLeaveHistoryCardBtn"),
      ssRefreshLeaveRequestsBtn: document.getElementById("ssRefreshLeaveRequestsBtn"),
      ssLeaveRequestsEmptyState: document.getElementById("ssLeaveRequestsEmptyState"),
      ssLeaveRequestsList: document.getElementById("ssLeaveRequestsList"),

      // Payroll summary
      ssCurrentPayrollEmptyState: document.getElementById("ssCurrentPayrollEmptyState"),
      ssCurrentPayrollSummaryGrid: document.getElementById("ssCurrentPayrollSummaryGrid"),
      ssCurrentPayCycle: document.getElementById("ssCurrentPayCycle"),
      ssCurrentGrossPay: document.getElementById("ssCurrentGrossPay"),
      ssCurrentTotalDeductions: document.getElementById("ssCurrentTotalDeductions"),
      ssCurrentNetPay: document.getElementById("ssCurrentNetPay"),
      ssTogglePayrollFiguresBtn: document.getElementById("ssTogglePayrollFiguresBtn"),

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-1
      // Visible payroll-header shortcut back to HR's own Leave Management.
      ssGoToLeaveFromPayrollBtn: document.getElementById("ssGoToLeaveFromPayrollBtn"),

      ssRefreshPayrollBtn: document.getElementById("ssRefreshPayrollBtn"),

      // Payroll history
      ssPayrollHistoryCardCollapse: document.getElementById("ssPayrollHistoryCardCollapse"),
      ssTogglePayrollHistoryCardBtn: document.getElementById("ssTogglePayrollHistoryCardBtn"),
      ssPayrollHistoryEmptyState: document.getElementById("ssPayrollHistoryEmptyState"),
      ssPayrollHistoryTableWrapper: document.getElementById("ssPayrollHistoryTableWrapper"),
      ssPayrollHistoryTableBody: document.getElementById("ssPayrollHistoryTableBody"),
      ssPayrollSearchInput: document.getElementById("ssPayrollSearchInput"),
      ssPayrollDateFromInput: document.getElementById("ssPayrollDateFromInput"),
      ssPayrollDateToInput: document.getElementById("ssPayrollDateToInput"),
      ssClearPayrollFiltersBtn: document.getElementById("ssClearPayrollFiltersBtn"),
    };
  }

  // -----------------------------------------------------------------------
  // Sub-navigation (Leave / Payroll)
  // -----------------------------------------------------------------------
  function switchSsSubSection(section) {
    const isLeave = section === "leave";
    const isPayroll = section === "payroll";

    ssState.dom.ssLeaveSection?.classList.toggle("d-none", !isLeave);
    ssState.dom.ssPayrollSection?.classList.toggle("d-none", !isPayroll);

    if (ssState.dom.ssNavLeaveBtn) {
      ssState.dom.ssNavLeaveBtn.className = isLeave
        ? "btn btn-primary dashboard-action-btn"
        : "btn btn-outline-primary dashboard-action-btn";
    }

    if (ssState.dom.ssNavPayrollBtn) {
      ssState.dom.ssNavPayrollBtn.className = isPayroll
        ? "btn btn-primary dashboard-action-btn"
        : "btn btn-outline-primary dashboard-action-btn";
    }

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3
    // Employee Dashboard behaviour:
    // - Leave Balances stays closed by default.
    // - Latest Leave Decision stays closed by default.
    // - My Leave History opens so the employee/HR user can immediately
    //   see submitted requests and manager decisions.
    if (isLeave) {
      setSsCardExpanded(
        ssState.dom.ssToggleLeaveBalancesCardBtn,
        ssState.dom.ssLeaveBalancesCardCollapse,
        false,
      );

      setSsCardExpanded(
        ssState.dom.ssToggleLatestDecisionCardBtn,
        ssState.dom.ssLatestDecisionCardCollapse,
        false,
      );

      setSsCardExpanded(
        ssState.dom.ssToggleLeaveHistoryCardBtn,
        ssState.dom.ssLeaveHistoryCardCollapse,
        true,
      );
    }

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3
    // Payroll opens with Payroll History visible because this is where HR
    // confirms their own authorised payslip records.
    if (isPayroll) {
      setSsCardExpanded(
        ssState.dom.ssTogglePayrollHistoryCardBtn,
        ssState.dom.ssPayrollHistoryCardCollapse,
        true,
      );
    }
  }

  function bindSsNavigationEvents() {
    ssState.dom.ssNavLeaveBtn?.addEventListener("click", () => {
      switchSsSubSection("leave");
    });

    ssState.dom.ssNavPayrollBtn?.addEventListener("click", () => {
      switchSsSubSection("payroll");
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-2
    // Let HR return from Leave to Payroll without refreshing the dashboard.
    ssState.dom.ssGoToPayrollFromLeaveBtn?.addEventListener("click", () => {
      switchSsSubSection("payroll");

      window.requestAnimationFrame(() => {
        ssState.dom.ssPayrollSection?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  // -----------------------------------------------------------------------
  // Card expand/collapse helper
  // -----------------------------------------------------------------------
  function setSsCardExpanded(btn, body, shouldExpand) {
    if (!btn || !body) return;

    body.classList.toggle("d-none", !shouldExpand);
    btn.querySelector("i")?.classList.toggle("bi-chevron-down", !shouldExpand);
    btn.querySelector("i")?.classList.toggle("bi-chevron-up", shouldExpand);

    const label = btn.querySelector("span");
    if (label) label.textContent = shouldExpand ? "Collapse" : "Expand";

    btn.setAttribute("aria-expanded", String(shouldExpand));

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
    // Keep Request Leave and My Leave History aligned only while history
    // is expanded. Collapsed history must shrink to header-only.
    scheduleSsLeaveMainCardHeightSync();
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Recalculate card height after the browser has applied collapse/expand
  // changes. The second delayed pass covers rendered leave-history records.
  function scheduleSsLeaveMainCardHeightSync() {
    window.setTimeout(syncSsLeaveMainCardHeights, 0);
    window.setTimeout(syncSsLeaveMainCardHeights, 120);
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Match Employee Dashboard leave behaviour:
  // - while My Leave History is expanded on desktop, align it with Request Leave
  // - when My Leave History is collapsed, remove the forced height
  // - keep leave records scrolling inside the existing inner scroll area
  function syncSsLeaveMainCardHeights() {
    window.requestAnimationFrame(() => {
      const row = document.querySelector("#hrSelfServiceSection .ss-leave-main-row");
      const requestCard = document.querySelector(
        "#hrSelfServiceSection .dashboard-form-card.ss-leave-equal-card",
      );
      const historyPanel =
        ssState.dom.ssLeaveHistoryCardCollapse ||
        document.getElementById("ssLeaveHistoryCardCollapse");
      const selfServiceSection = document.getElementById("hrSelfServiceSection");
      const leaveSection =
        ssState.dom.ssLeaveSection ||
        document.getElementById("ssLeaveSection");

      if (!row || !requestCard || !historyPanel) return;

      const clearHeight = () => {
        row.style.removeProperty("--ss-leave-card-height");
        row.removeAttribute("data-ss-leave-card-height");
      };

      const isDesktop = window.matchMedia("(min-width: 1200px)").matches;
      const isHistoryExpanded = !historyPanel.classList.contains("d-none");
      const isSelfServiceHidden = selfServiceSection?.classList.contains("d-none");
      const isLeaveHidden = leaveSection?.classList.contains("d-none");

      if (!isDesktop || isSelfServiceHidden || isLeaveHidden || !isHistoryExpanded) {
        clearHeight();
        return;
      }

      clearHeight();

      const measuredHeight = Math.ceil(requestCard.getBoundingClientRect().height);

      if (measuredHeight > 0) {
        row.style.setProperty("--ss-leave-card-height", `${measuredHeight}px`);
        row.setAttribute("data-ss-leave-card-height", "true");
      }
    });
  }

  // HR SELF-SERVICE REFRESH UX - STEP 1C-3D
  // Let the browser paint the spinner before the async reload starts.
  function waitForSsNextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  // HR SELF-SERVICE REFRESH UX - STEP 1C-3D
  // One shared refresh loading helper for both icon-only and labelled buttons.
  // This replaces the duplicate helper versions previously introduced.
  function setSsRefreshButtonLoading(
    button,
    isLoading,
    { iconOnly = false, loadingLabel = "Refreshing..." } = {},
  ) {
    if (!button) return;

    button.disabled = isLoading;

    if (isLoading) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }

      button.innerHTML = iconOnly
        ? `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>`
        : `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${loadingLabel}`;

      return;
    }

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  // HR SELF-SERVICE PAYROLL REFRESH - STEP 1C-3D
  // Refresh the signed-in staff member's own authorised payroll records.
  // This does not run payroll and does not touch HR payroll operations.
  async function refreshSsPayrollManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshPayrollBtn;

    try {
      setSsRefreshButtonLoading(button, true, { iconOnly: true });
      await waitForSsNextPaint();

      await loadSsPayroll();

      clearSsAlert();
      showSsAlert("success", "Payroll information refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual payroll refresh failed:", error);
      showSsAlert(
        "danger",
        error.message || "Unable to refresh payroll information right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false, { iconOnly: true });
    }
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Refresh leave history using visible feedback and reload balances as well
  // because manager decisions can affect used/remaining leave figures.
  async function refreshSsLeaveHistoryManually() {
    if (!ssState.currentUser) return;

    const button = ssState.dom.ssRefreshLeaveRequestsBtn;

    try {
      setSsRefreshButtonLoading(button, true, { loadingLabel: "Refreshing..." });
      await waitForSsNextPaint();

      await loadSsLeaveRequests();
      await loadSsLeaveBalances();

      clearSsAlert();
      showSsAlert("success", "Leave history refreshed successfully.");
    } catch (error) {
      console.error("[SS] Manual leave history refresh failed:", error);
      showSsAlert(
        "danger",
        error.message || "Unable to refresh leave history right now.",
      );
    } finally {
      setSsRefreshButtonLoading(button, false);
      scheduleSsLeaveMainCardHeightSync();
    }
  }

  // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
  // Whole-card double-click collapse. Interactive controls and the existing
  // leave-history inner scroll area are ignored, so normal clicking/scrolling
  // does not accidentally collapse the card.
  function bindSsCardDoubleClickCollapse(btn, body) {
    if (!btn || !body) return;

    const card = body.closest(".dashboard-section-card");
    if (!card) return;

    if (card.dataset.ssDoubleClickCollapseBound === "true") return;
    card.dataset.ssDoubleClickCollapseBound = "true";

    card.addEventListener("dblclick", (event) => {
      const ignoredTarget = event.target.closest(
        "button, a, input, select, textarea, label, table, .employee-leave-history-scroll-area, [contenteditable='true']",
      );

      if (ignoredTarget) return;

      const isExpanded = !body.classList.contains("d-none");
      if (!isExpanded) return;

      // Use the visible button path so double-click behaves exactly like
      // pressing Collapse.
      btn.click();
    });
  }

  // -----------------------------------------------------------------------
  // Leave Balances collapse
  // -----------------------------------------------------------------------
  function bindSsLeaveBalancesCardEvents() {
    const btn = ssState.dom.ssToggleLeaveBalancesCardBtn;
    const body = ssState.dom.ssLeaveBalancesCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3A
    // One safe double-click collapse binding for Leave Balances only.
    bindSsCardDoubleClickCollapse(btn, body);

    ssState.dom.ssRefreshLeaveBalancesBtn?.addEventListener("click", async () => {
      await loadSsLeaveBalances();
    });
  }

  // -----------------------------------------------------------------------
  // Latest Leave Decision collapse
  // -----------------------------------------------------------------------
  function bindSsLatestDecisionCardEvents() {
    const btn = ssState.dom.ssToggleLatestDecisionCardBtn;
    const body = ssState.dom.ssLatestDecisionCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C
    // Allow whole-card shell double-click collapse on Latest Leave Decision.
    bindSsCardDoubleClickCollapse(btn, body);

    ssState.dom.ssRefreshLatestDecisionBtn?.addEventListener("click", async () => {
      await loadSsLeaveRequests();
    });
  }

  // -----------------------------------------------------------------------
  // Leave History collapse
  // -----------------------------------------------------------------------
  function bindSsLeaveHistoryCardEvents() {
    const btn = ssState.dom.ssToggleLeaveHistoryCardBtn;
    const body = ssState.dom.ssLeaveHistoryCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
      // Use the shared helper so normal click collapse, double-click collapse,
      // and programmatic collapse all follow the same state/height behaviour.
      setSsCardExpanded(btn, body, isCollapsed);
    });

    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-3D
    // Double-clicking the open card shell behaves exactly like pressing
    // the visible Collapse button.
    bindSsCardDoubleClickCollapse(btn, body);

    ssState.dom.ssRefreshLeaveRequestsBtn?.addEventListener("click", async () => {
      await refreshSsLeaveHistoryManually();
    });
  }

  // -----------------------------------------------------------------------
  // Payroll History collapse
  // -----------------------------------------------------------------------
  function bindSsPayrollHistoryCardEvents() {
    const btn = ssState.dom.ssTogglePayrollHistoryCardBtn;
    const body = ssState.dom.ssPayrollHistoryCardCollapse;
    if (!btn || !body) return;

    btn.addEventListener("click", () => {
      const isCollapsed = body.classList.contains("d-none");
      body.classList.toggle("d-none", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-down", !isCollapsed);
      btn.querySelector("i")?.classList.toggle("bi-chevron-up", isCollapsed);
      btn.querySelector("span").textContent = isCollapsed ? "Collapse" : "Expand";
      btn.setAttribute("aria-expanded", String(isCollapsed));
    });
  }

  // -----------------------------------------------------------------------
  // Payroll figures visibility
  // -----------------------------------------------------------------------
  function updateSsPayrollFigureVisibility() {
    const btn = ssState.dom.ssTogglePayrollFiguresBtn;
    if (!btn) return;

    const isHidden = ssState.isPayrollFiguresHidden;
    const icon = btn.querySelector("i");
    if (icon) {
      icon.classList.toggle("bi-eye-slash", !isHidden);
      icon.classList.toggle("bi-eye", isHidden);
    }
    btn.setAttribute("aria-label", isHidden ? "Show payroll figures" : "Hide payroll figures");
    btn.setAttribute("title", isHidden ? "Show payroll figures" : "Hide payroll figures");
  }

  function getSsPayrollFigureDisplay(value) {
    return ssState.isPayrollFiguresHidden ? "•••••" : value;
  }

  function bindSsPayrollEvents() {
    // HR SELF-SERVICE LEAVE PARITY - STEP 1C-1
    // Payroll opens first, so provide a visible route back to Leave Management
    // from the payroll screen itself.
    ssState.dom.ssGoToLeaveFromPayrollBtn?.addEventListener("click", () => {
      switchSsSubSection("leave");

      window.requestAnimationFrame(() => {
        ssState.dom.ssLeaveSection?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
    ssState.dom.ssTogglePayrollFiguresBtn?.addEventListener("click", () => {
      ssState.isPayrollFiguresHidden = !ssState.isPayrollFiguresHidden;
      updateSsPayrollFigureVisibility();
      renderSsCurrentPayrollSummary(ssState.payrollRecords);
    });

    ssState.dom.ssRefreshPayrollBtn?.addEventListener("click", async () => {
      // HR SELF-SERVICE PAYROLL REFRESH - STEP 1C-3C
      // Use Employee Dashboard-style refresh feedback for the compact
      // Current Payslip Summary refresh icon.
      await refreshSsPayrollManually();
    });

    ssState.dom.ssClearPayrollFiltersBtn?.addEventListener("click", () => {
      if (ssState.dom.ssPayrollSearchInput) ssState.dom.ssPayrollSearchInput.value = "";
      if (ssState.dom.ssPayrollDateFromInput) ssState.dom.ssPayrollDateFromInput.value = "";
      if (ssState.dom.ssPayrollDateToInput) ssState.dom.ssPayrollDateToInput.value = "";
      applySsPayrollFilters();
    });

    ["ssPayrollSearchInput", "ssPayrollDateFromInput", "ssPayrollDateToInput"].forEach((key) => {
      ssState.dom[key]?.addEventListener("input", () => applySsPayrollFilters());
    });
  }

  // -----------------------------------------------------------------------
  // Employee record lookup
  // -----------------------------------------------------------------------
  async function loadSsEmployeeRecord() {
    const supabase = getSupabaseClient();
    const userId = ssState.currentUser?.id;
    const userEmail = ssState.currentUser?.email || ssState.currentProfile?.email;

    let employee = null;

    // First: look up by user_id
    if (userId) {
      try {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (!error && data) {
          employee = data;
        }
      } catch (err) {
        console.warn("[SS] Lookup by user_id failed:", err);
      }
    }

    // Fallback: look up by email
    if (!employee && userEmail) {
      const emails = [
        userEmail,
        ssState.currentProfile?.email,
        ssState.currentUser?.email,
      ]
        .filter(Boolean)
        .map(ssNormalizeEmail)
        .filter((e) => e.length > 0);

      const uniqueEmails = [...new Set(emails)];

      for (const email of uniqueEmails) {
        try {
          const { data, error } = await supabase
            .from("employees")
            .select("*")
            .ilike("work_email", email)
            .maybeSingle();

          if (!error && data) {
            employee = data;
            break;
          }
        } catch (err) {
          console.warn("[SS] Lookup by work_email failed:", err);
        }
      }
    }

    if (!employee) {
      showSsAlert(
        "warning",
        "Your employee record could not be found. Leave and payroll self-service may be limited.",
      );
      return;
    }

    ssState.employeeRecord = employee;
    applySsResolvedIdentity(employee);
  }

  // -----------------------------------------------------------------------
  // Leave types
  // -----------------------------------------------------------------------
  async function loadSsLeaveTypes() {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("leave_types")
      .select("id, code, name, eligibility_rule")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("[SS] Error loading leave types:", error);
      return;
    }

    const select = ssState.dom.ssLeaveType;
    if (!select) return;

    select.innerHTML = `<option value="">Select leave type</option>`;

    (data || []).forEach((leaveType) => {
      const option = document.createElement("option");
      option.value = leaveType.id;
      option.textContent = leaveType.name;
      option.dataset.code = leaveType.code;
      option.dataset.eligibilityRule = leaveType.eligibility_rule || "all_employees";
      select.appendChild(option);
    });

    updateSsLeaveSubmitButtonState();
  }

  // -----------------------------------------------------------------------
  // Leave balances
  // -----------------------------------------------------------------------
  async function loadSsLeaveBalances() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      renderSsLeaveBalances([]);
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

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) {
      console.error("[SS] Error loading leave balances:", error);
      return;
    }

    const balances = Array.isArray(data)
      ? data.filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i)
      : [];

    renderSsLeaveBalances(balances);
  }

  function renderSsLeaveBalances(balances) {
    const grid = ssState.dom.ssLeaveBalancesGrid;
    if (!grid) return;

    grid.innerHTML = "";

    if (!balances.length) {
      ssState.dom.ssLeaveBalancesEmptyState?.classList.remove("d-none");
      grid.classList.add("d-none");
      return;
    }

    ssState.dom.ssLeaveBalancesEmptyState?.classList.add("d-none");
    grid.classList.remove("d-none");

    balances.forEach((balance) => {
      const leaveTypeName = balance.leave_types?.name || "Unknown Leave Type";
      const entitled = Number(balance.entitled_days || 0);
      const used = Number(balance.used_days || 0);
      const remaining = Number(balance.remaining_days ?? entitled - used);

      const usedPercent =
        entitled > 0
          ? Math.min(100, Math.max(0, (used / entitled) * 100))
          : 0;

      const remainingPercent =
        entitled > 0
          ? Math.min(100, Math.max(0, (remaining / entitled) * 100))
          : 0;

      const statusClass =
        remaining <= 0
          ? "text-bg-danger"
          : remainingPercent <= 25
            ? "text-bg-warning"
            : "text-bg-success";

      const statusLabel =
        remaining <= 0
          ? "Fully Used"
          : remainingPercent <= 25
            ? "Low Balance"
            : "Available";

      const progressClass =
        remaining <= 0
          ? "bg-danger"
          : remainingPercent <= 25
            ? "bg-warning"
            : "bg-success";

      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-xl-4";

      // HR SELF-SERVICE LEAVE PARITY - STEP 1C
      // Match Employee Dashboard leave balance presentation:
      // clear leave type, availability status, entitlement breakdown,
      // and used-entitlement progress bar. This is display-only.
      col.innerHTML = `
        <div class="info-tile h-100">
          <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <div class="info-tile-label mb-1">Leave Type</div>
              <div class="fw-bold">${ssEscapeHtml(leaveTypeName)}</div>
            </div>
            <span class="badge ${statusClass}">${statusLabel}</span>
          </div>

          <div class="row g-3 mb-3">
            <div class="col-4">
              <div class="small text-secondary">Entitled</div>
              <div class="fw-semibold">${entitled}</div>
            </div>
            <div class="col-4">
              <div class="small text-secondary">Used</div>
              <div class="fw-semibold">${used}</div>
            </div>
            <div class="col-4">
              <div class="small text-secondary">Remaining</div>
              <div class="fw-semibold ${remaining <= 0 ? "text-danger" : ""}">
                ${remaining}
              </div>
            </div>
          </div>

          <div class="progress" style="height: 0.5rem;">
            <div class="progress-bar ${progressClass}" role="progressbar"
              style="width: ${usedPercent}%"
              aria-valuenow="${usedPercent.toFixed(0)}"
              aria-valuemin="0"
              aria-valuemax="100">
            </div>
          </div>

          <div class="small text-secondary mt-2">
            ${usedPercent.toFixed(0)}% of entitlement used.
          </div>
        </div>
      `;

      grid.appendChild(col);
    });
  }

  // -----------------------------------------------------------------------
  // Leave requests + latest decision
  // -----------------------------------------------------------------------
  async function loadSsLeaveRequests() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      ssState.leaveRequests = [];
      renderSsLeaveRequests([]);
      renderSsLatestDecision([]);
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
      leave_types ( name )
    `);

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query.order("submitted_at", { ascending: false });

    if (error) {
      console.error("[SS] Error loading leave requests:", error);
      showSsAlert("danger", "Unable to load leave history.");
      return;
    }

    const requests = Array.isArray(data)
      ? data.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
      : [];

    ssState.leaveRequests = requests;
    renderSsLeaveRequests(requests);
    renderSsLatestDecision(requests);
    updateSsLeaveRequestBlockNotice();
  }

  function getSsLeaveStatusBadgeClass(status) {
    const normalized = ssNormalizeText(status || "");
    if (normalized === "approved") return "text-bg-success";
    if (normalized === "rejected" || normalized === "declined") return "text-bg-danger";
    if (normalized.includes("pending")) return "text-bg-warning";
    if (normalized === "cancelled") return "text-bg-secondary";
    if (normalized === "returned" || normalized.includes("returned")) return "text-bg-info";
    return "text-bg-secondary";
  }

  function renderSsLeaveRequests(requests) {
    const list = ssState.dom.ssLeaveRequestsList;
    if (!list) return;

    list.innerHTML = "";

    if (!requests.length) {
      ssState.dom.ssLeaveRequestsEmptyState?.classList.remove("d-none");
      list.classList.add("d-none");
      return;
    }

    ssState.dom.ssLeaveRequestsEmptyState?.classList.add("d-none");
    list.classList.remove("d-none");

    requests.forEach((request) => {
      const leaveTypeName = request.leave_types?.name || "Leave";
      const status = request.status || "Pending";
      const badgeClass = getSsLeaveStatusBadgeClass(status);
      const startDate = ssFormatDate(request.start_date);
      const endDate = ssFormatDate(request.end_date);
      const totalDays = request.total_days || 0;
      const submittedAt = ssFormatDate(request.submitted_at);
      const isReturned = ssNormalizeText(status).includes("returned");

      const card = document.createElement("div");
      card.className = "border rounded-3 p-3 mb-3";
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div class="fw-semibold">${ssEscapeHtml(leaveTypeName)}</div>
          <span class="badge ${badgeClass} text-nowrap">${ssEscapeHtml(status)}</span>
        </div>
        <div class="small text-secondary mb-1">
          ${ssEscapeHtml(startDate)} to ${ssEscapeHtml(endDate)} • ${totalDays} day(s)
        </div>
        <div class="small text-secondary">Submitted: ${ssEscapeHtml(submittedAt)}</div>
        ${request.decision_comment ? `<div class="small mt-2 text-secondary fst-italic">"${ssEscapeHtml(request.decision_comment)}"</div>` : ""}
        ${isReturned ? `
          <div class="mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary ss-amend-leave-btn"
              data-request-id="${ssEscapeHtml(String(request.id))}">
              <i class="bi bi-pencil me-1"></i>Edit &amp; Resubmit
            </button>
          </div>
        ` : ""}
      `;

      if (isReturned) {
        card.querySelector(".ss-amend-leave-btn")?.addEventListener("click", () => {
          startSsReturnedLeaveAmendment(request.id);
        });
      }

      list.appendChild(card);
    });
  }

  function renderSsLatestDecision(requests) {
    const decisionEmptyState = ssState.dom.ssLatestDecisionEmptyState;
    const decisionCard = ssState.dom.ssLatestDecisionCard;

    if (!decisionEmptyState || !decisionCard) return;

    const decided = (requests || []).filter((r) => {
      const status = ssNormalizeText(r.status || "");
      return (
        status === "approved" ||
        status === "rejected" ||
        status === "declined" ||
        status === "returned" ||
        status === "returned for clarification"
      );
    });

    if (!decided.length) {
      decisionEmptyState.classList.remove("d-none");
      decisionCard.classList.add("d-none");
      return;
    }

    const latest = decided[0];
    const leaveTypeName = latest.leave_types?.name || "Leave";
    const decisionDate = latest.decision_at;
    const decisionBy = latest.decision_by_name || latest.decision_by || "--";
    const comment = latest.decision_comment || "No comment provided.";

    decisionEmptyState.classList.add("d-none");
    decisionCard.classList.remove("d-none");

    if (ssState.dom.ssLatestDecisionStatus) {
      ssState.dom.ssLatestDecisionStatus.textContent = latest.status || "--";
    }
    if (ssState.dom.ssLatestDecisionLeaveType) {
      ssState.dom.ssLatestDecisionLeaveType.textContent = leaveTypeName;
    }
    if (ssState.dom.ssLatestDecisionDateTime) {
      ssState.dom.ssLatestDecisionDateTime.textContent = ssFormatDateTime(decisionDate);
    }
    if (ssState.dom.ssLatestDecisionPeriod) {
      ssState.dom.ssLatestDecisionPeriod.textContent =
        `${ssFormatDate(latest.start_date)} to ${ssFormatDate(latest.end_date)}`;
    }
    if (ssState.dom.ssLatestDecisionBy) {
      ssState.dom.ssLatestDecisionBy.textContent = decisionBy;
    }
    if (ssState.dom.ssLatestDecisionComment) {
      ssState.dom.ssLatestDecisionComment.textContent = comment;
    }
  }

  // -----------------------------------------------------------------------
  // Leave policy block
  // -----------------------------------------------------------------------
  function getSsLeaveRequestPolicyBlock() {
    const leaveTypeId = ssState.dom.ssLeaveType?.value || "";
    const startDate = ssState.dom.ssStartDate?.value || "";
    const endDate = ssState.dom.ssEndDate?.value || "";

    if (!leaveTypeId || !startDate || !endDate) return null;

    const selectedOption = ssState.dom.ssLeaveType?.options[
      ssState.dom.ssLeaveType?.selectedIndex
    ];
    const leaveTypeName = ssNormalizeText(selectedOption?.textContent || "");
    const isSingleApplicationType = SINGLE_APPLICATION_LEAVE_TYPE_KEYWORDS.some((kw) =>
      leaveTypeName.includes(kw),
    );

    const activeRequests = (ssState.leaveRequests || []).filter((r) => {
      const status = ssNormalizeText(r.status || "");
      return status === "pending approval" || status === "approved";
    });

    if (isSingleApplicationType) {
      const existing = activeRequests.find(
        (r) =>
          String(r.leave_type_id) === String(leaveTypeId) &&
          (ssNormalizeText(r.status) === "pending approval" ||
            ssNormalizeText(r.status) === "approved"),
      );
      if (existing) {
        return {
          message: `You already have an active ${selectedOption?.textContent || "leave"} request. This type of leave can only be applied for once.`,
        };
      }
    }

    if (startDate && endDate) {
      const newStart = new Date(startDate);
      const newEnd = new Date(endDate);

      const overlap = activeRequests.find((r) => {
        if (!r.start_date || !r.end_date) return false;
        const existStart = new Date(r.start_date);
        const existEnd = new Date(r.end_date);
        return newStart <= existEnd && newEnd >= existStart;
      });

      if (overlap) {
        return {
          message: `These dates overlap with an existing ${ssNormalizeText(overlap.status) === "approved" ? "approved" : "pending"} leave request (${ssFormatDate(overlap.start_date)} to ${ssFormatDate(overlap.end_date)}). Please choose different dates.`,
        };
      }
    }

    return null;
  }

  function updateSsLeaveRequestBlockNotice() {
    const notice = ssState.dom.ssLeaveRequestBlockNotice;
    if (!notice) return;

    const block = getSsLeaveRequestPolicyBlock();

    if (block) {
      notice.textContent = block.message;
      notice.classList.remove("d-none");
    } else {
      notice.classList.add("d-none");
      notice.textContent = "";
    }

    updateSsLeaveSubmitButtonState();
  }

  function updateSsLeaveSubmitButtonState() {
    const btn = ssState.dom.ssSubmitLeaveBtn;
    if (!btn) return;

    const leaveType = ssState.dom.ssLeaveType?.value || "";
    const startDate = ssState.dom.ssStartDate?.value || "";
    const endDate = ssState.dom.ssEndDate?.value || "";
    const reason = ssState.dom.ssLeaveReason?.value?.trim() || "";
    const block = getSsLeaveRequestPolicyBlock();

    const isValid = leaveType && startDate && endDate && reason && !block;

    btn.disabled = !isValid;
    btn.className = isValid
      ? "btn btn-primary dashboard-action-btn"
      : "btn btn-secondary dashboard-action-btn";
  }

  // -----------------------------------------------------------------------
  // Leave form
  // -----------------------------------------------------------------------
  function calculateSsLeaveDays() {
    const startDateValue = ssState.dom.ssStartDate?.value;
    const endDateValue = ssState.dom.ssEndDate?.value;

    if (!startDateValue || !endDateValue || !ssState.dom.ssTotalDays) return;

    const startDate = new Date(startDateValue);
    const endDate = new Date(endDateValue);

    if (endDate < startDate) {
      ssState.dom.ssTotalDays.value = "";
      return;
    }

    const totalDays =
      Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    ssState.dom.ssTotalDays.value = totalDays;
  }

  function bindSsLeaveFormEvents() {
    ssState.dom.ssLeaveType?.addEventListener("change", () => {
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssStartDate?.addEventListener("change", () => {
      calculateSsLeaveDays();
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssEndDate?.addEventListener("change", () => {
      calculateSsLeaveDays();
      updateSsLeaveRequestBlockNotice();
    });

    ssState.dom.ssLeaveReason?.addEventListener("input", () => {
      updateSsLeaveSubmitButtonState();
    });

    ssState.dom.ssLeaveRequestForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleSsLeaveRequestSubmit();
    });
  }

  function validateSsLeaveRequestForm() {
    let isValid = true;

    const fields = [
      ssState.dom.ssLeaveType,
      ssState.dom.ssStartDate,
      ssState.dom.ssEndDate,
      ssState.dom.ssLeaveReason,
    ];

    fields.forEach((f) => f?.classList.remove("is-invalid"));

    if (!ssState.dom.ssLeaveType?.value) {
      ssState.dom.ssLeaveType?.classList.add("is-invalid");
      isValid = false;
    }
    if (!ssState.dom.ssStartDate?.value) {
      ssState.dom.ssStartDate?.classList.add("is-invalid");
      isValid = false;
    }
    if (!ssState.dom.ssEndDate?.value) {
      ssState.dom.ssEndDate?.classList.add("is-invalid");
      isValid = false;
    }

    const start = ssState.dom.ssStartDate?.value;
    const end = ssState.dom.ssEndDate?.value;
    if (start && end && new Date(end) < new Date(start)) {
      ssState.dom.ssEndDate?.classList.add("is-invalid");
      showSsAlert("warning", "End date cannot be earlier than start date.");
      isValid = false;
    }

    if (!ssState.dom.ssLeaveReason?.value?.trim()) {
      ssState.dom.ssLeaveReason?.classList.add("is-invalid");
      isValid = false;
    }

    const totalDays = Number(ssState.dom.ssTotalDays?.value || 0);
    if (!totalDays || totalDays < 1) {
      showSsAlert("warning", "Total leave days must be at least 1.");
      isValid = false;
    }

    const block = getSsLeaveRequestPolicyBlock();
    if (block) {
      ssState.dom.ssLeaveType?.classList.add("is-invalid");
      showSsAlert("warning", block.message);
      isValid = false;
    }

    return isValid;
  }

  async function handleSsLeaveRequestSubmit() {
    clearSsAlert();

    if (!ssState.currentUser) {
      showSsAlert("danger", "No active user session found.");
      return;
    }

    calculateSsLeaveDays();

    if (!validateSsLeaveRequestForm()) return;

    const supabase = getSupabaseClient();
    const employeeId = getPreferredSsEmployeeId();

    if (!employeeId) {
      showSsAlert("danger", "Employee record could not be resolved. Cannot submit leave request.");
      return;
    }

    const submitBtn = ssState.dom.ssSubmitLeaveBtn;
    const originalHtml = submitBtn?.innerHTML || "";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Submitting…`;
    }

    try {
      // Check if this is a resubmission of a returned request
      if (ssState.returnedLeaveAmendmentRequestId) {
        const { data, error } = await supabase.rpc("resubmit_returned_leave_request", {
          p_leave_request_id: ssState.returnedLeaveAmendmentRequestId,
          p_leave_type_id: ssState.dom.ssLeaveType.value,
          p_start_date: ssState.dom.ssStartDate.value,
          p_end_date: ssState.dom.ssEndDate.value,
          p_total_days: Number(ssState.dom.ssTotalDays.value),
          p_reason: ssState.dom.ssLeaveReason.value.trim(),
        });

        if (error) throw error;

        ssState.returnedLeaveAmendmentRequestId = null;
        if (submitBtn) {
          submitBtn.innerHTML = `<i class="bi bi-send-check me-2"></i>Submit for Approval`;
        }
        showSsAlert("success", "Leave request resubmitted successfully.");
      } else {
        const { error } = await supabase.from("leave_requests").insert({
          employee_id: employeeId,
          leave_type_id: ssState.dom.ssLeaveType.value,
          start_date: ssState.dom.ssStartDate.value,
          end_date: ssState.dom.ssEndDate.value,
          total_days: Number(ssState.dom.ssTotalDays.value),
          reason: ssState.dom.ssLeaveReason.value.trim(),
          status: "Pending Approval",
        });

        if (error) throw error;
        showSsAlert("success", "Leave request submitted successfully.");
      }

      // Reset form
      ssState.dom.ssLeaveType.value = "";
      ssState.dom.ssStartDate.value = "";
      ssState.dom.ssEndDate.value = "";
      ssState.dom.ssTotalDays.value = "";
      ssState.dom.ssLeaveReason.value = "";
      updateSsLeaveSubmitButtonState();
      updateSsLeaveRequestBlockNotice();

      await loadSsLeaveRequests();
      await loadSsLeaveBalances();
    } catch (error) {
      console.error("[SS] Leave submission error:", error);
      showSsAlert("danger", error.message || "Leave request could not be submitted.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        updateSsLeaveSubmitButtonState();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Returned leave amendment
  // -----------------------------------------------------------------------
  function startSsReturnedLeaveAmendment(leaveRequestId) {
    const request = (ssState.leaveRequests || []).find(
      (r) => String(r.id) === String(leaveRequestId),
    );

    if (!request) {
      showSsAlert("warning", "Returned leave request could not be found.");
      return;
    }

    ssState.returnedLeaveAmendmentRequestId = request.id;

    if (ssState.dom.ssLeaveType) ssState.dom.ssLeaveType.value = request.leave_type_id || "";
    if (ssState.dom.ssStartDate) ssState.dom.ssStartDate.value = request.start_date || "";
    if (ssState.dom.ssEndDate) ssState.dom.ssEndDate.value = request.end_date || "";
    if (ssState.dom.ssLeaveReason) ssState.dom.ssLeaveReason.value = request.reason || "";

    calculateSsLeaveDays();
    updateSsLeaveRequestBlockNotice();

    if (ssState.dom.ssSubmitLeaveBtn) {
      ssState.dom.ssSubmitLeaveBtn.innerHTML = `<i class="bi bi-arrow-repeat me-2"></i>Resubmit Returned Request`;
    }

    // Switch to leave section and scroll to form
    switchSsSubSection("leave");
    ssState.dom.ssLeaveRequestForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // -----------------------------------------------------------------------
  // Payroll
  // -----------------------------------------------------------------------
  async function loadSsPayroll() {
    const supabase = getSupabaseClient();
    const candidates = getSsIdentityCandidates();

    if (!candidates.length) {
      renderSsPayroll([]);
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

    if (candidates.length === 1) {
      query = query.eq("employee_id", candidates[0]);
    } else {
      query = query.in("employee_id", candidates);
    }

    const { data, error } = await query
      .eq("status", "Authorised")
      .eq("is_finalised", true)
      .order("pay_date", { ascending: false });

    if (error) {
      console.error("[SS] Error loading payroll:", error);
      showSsAlert("danger", "Unable to load payroll history.");
      return;
    }

    const records = Array.isArray(data)
      ? data.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i)
      : [];

    ssState.payrollRecords = records;
    applySsPayrollFilters();
  }

  function getFilteredSsPayrollRecords() {
    const records = Array.isArray(ssState.payrollRecords) ? ssState.payrollRecords : [];
    const searchValue = ssNormalizeText(ssState.dom.ssPayrollSearchInput?.value || "");
    const fromDateValue = ssState.dom.ssPayrollDateFromInput?.value || "";
    const toDateValue = ssState.dom.ssPayrollDateToInput?.value || "";

    return records.filter((record) => {
      const payCycle = ssNormalizeText(record?.pay_cycle || "");
      if (searchValue && !payCycle.includes(searchValue)) return false;

      const recordDateValue = String(record?.pay_date || "").trim();
      if (!recordDateValue) return !fromDateValue && !toDateValue;

      const recordDate = new Date(recordDateValue);
      if (Number.isNaN(recordDate.getTime())) return false;

      if (fromDateValue) {
        const fromDate = new Date(fromDateValue);
        if (!Number.isNaN(fromDate.getTime()) && recordDate < fromDate) return false;
      }

      if (toDateValue) {
        const toDate = new Date(toDateValue);
        if (!Number.isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          if (recordDate > toDate) return false;
        }
      }

      return true;
    });
  }

  function applySsPayrollFilters() {
    renderSsPayroll(getFilteredSsPayrollRecords());
  }

  function renderSsPayroll(records) {
    renderSsCurrentPayrollSummary(ssState.payrollRecords);
    renderSsPayrollHistory(records);
  }

  function renderSsCurrentPayrollSummary(records) {
    const payrollRecords = Array.isArray(records) ? records : [];

    if (!payrollRecords.length) {
      ssState.dom.ssCurrentPayrollEmptyState?.classList.remove("d-none");
      ssState.dom.ssCurrentPayrollSummaryGrid?.classList.add("d-none");
      return;
    }

    const latest = payrollRecords[0];

    ssState.dom.ssCurrentPayrollEmptyState?.classList.add("d-none");
    ssState.dom.ssCurrentPayrollSummaryGrid?.classList.remove("d-none");

    if (ssState.dom.ssCurrentPayCycle) {
      ssState.dom.ssCurrentPayCycle.textContent = latest.pay_cycle || "--";
    }
    if (ssState.dom.ssCurrentGrossPay) {
      ssState.dom.ssCurrentGrossPay.textContent = getSsPayrollFigureDisplay(
        ssFormatCurrency(latest.gross_pay, latest.currency || "NGN"),
      );
    }
    if (ssState.dom.ssCurrentTotalDeductions) {
      ssState.dom.ssCurrentTotalDeductions.textContent = getSsPayrollFigureDisplay(
        ssFormatCurrency(latest.total_deductions, latest.currency || "NGN"),
      );
    }
    if (ssState.dom.ssCurrentNetPay) {
      ssState.dom.ssCurrentNetPay.textContent = getSsPayrollFigureDisplay(
        ssFormatCurrency(latest.net_pay, latest.currency || "NGN"),
      );
    }
  }

  function renderSsPayrollHistory(records) {
    const tbody = ssState.dom.ssPayrollHistoryTableBody;
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!records.length) {
      ssState.dom.ssPayrollHistoryEmptyState?.classList.remove("d-none");
      ssState.dom.ssPayrollHistoryTableWrapper?.classList.add("d-none");
      return;
    }

    ssState.dom.ssPayrollHistoryEmptyState?.classList.add("d-none");
    ssState.dom.ssPayrollHistoryTableWrapper?.classList.remove("d-none");

    records.forEach((record) => {
      const currency = record.currency || "NGN";
      const taxValue = Number(record.paye_tax || record.wht_tax || 0);
      const employeePension = Number(record.employee_pension || 0);

      const row = document.createElement("tr");
      row.className = "payroll-summary-row";
      row.dataset.payrollId = record.id;

      row.innerHTML = `
        <td class="text-nowrap">
          <div class="fw-semibold">${ssEscapeHtml(record.pay_cycle || "--")}</div>
          <div class="small text-secondary">${ssEscapeHtml(record.employee_group || "")}</div>
        </td>
        <td class="text-nowrap">${ssFormatDate(record.pay_date)}</td>
        <td class="text-nowrap">${ssFormatCurrency(record.gross_pay, currency)}</td>
        <td class="text-nowrap">${taxValue > 0 ? ssFormatCurrency(taxValue, currency) : '<span class="small text-secondary">No Tax</span>'}</td>
        <td class="text-nowrap">${ssFormatCurrency(employeePension, currency)}</td>
        <td class="text-nowrap">${ssFormatCurrency(record.total_deductions, currency)}</td>
        <td class="text-nowrap"><div class="fw-semibold">${ssFormatCurrency(record.net_pay, currency)}</div></td>
        <td class="text-center text-nowrap">
          <span class="badge text-bg-success">${ssEscapeHtml(record.status || "Authorised")}</span>
        </td>
        <td class="text-center text-nowrap">
          <button type="button"
            class="btn btn-sm btn-outline-primary ss-download-payslip-btn d-inline-flex align-items-center justify-content-center"
            data-payroll-id="${ssEscapeHtml(record.id)}"
            title="Download payslip PDF"
            aria-label="Download payslip PDF"
            style="width:36px;height:32px;">
            <i class="bi bi-file-earmark-pdf"></i>
          </button>
        </td>
      `;

      tbody.appendChild(row);

      row.querySelector(".ss-download-payslip-btn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        await downloadSsPayslipPdf(record.id, btn);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Payslip PDF
  // -----------------------------------------------------------------------
  async function downloadSsPayslipPdf(payrollId, buttonElement) {
    try {
      clearSsAlert();

      const record = ssState.payrollRecords.find((r) => r.id === payrollId);
      if (!record) {
        showSsAlert("danger", "Payroll record not found.");
        return;
      }

      if (!window.jspdf?.jsPDF) {
        showSsAlert("danger", "PDF library (jsPDF) is not available. Please refresh the page.");
        return;
      }

      if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF("p", "mm", "a4");

      const employeeName =
        `${ssState.employeeRecord?.first_name || ""} ${ssState.employeeRecord?.last_name || ""}`.trim() ||
        ssState.currentProfile?.full_name ||
        "Staff Member";

      const employeeEmail =
        ssState.employeeRecord?.work_email ||
        ssState.currentProfile?.email ||
        ssState.currentUser?.email ||
        "--";

      const employeeId =
        ssState.employeeRecord?.employee_id ||
        ssState.employeeRecord?.staff_id ||
        ssState.employeeRecord?.employee_number ||
        "--";

      const department = ssState.employeeRecord?.department || "--";
      const currency = (record.currency || "NGN").toUpperCase();

      // Header bar
      doc.setFillColor(185, 106, 16);
      doc.rect(0, 0, 210, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("BexHR", 14, 14);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Official Employee Payslip", 14, 21);

      doc.setTextColor(17, 24, 39);

      // Employee details
      let y = 40;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Employee Details", 14, y);
      y += 8;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.text(`Name: ${employeeName}`, 14, y); y += 6;
      doc.text(`Email: ${employeeEmail}`, 14, y); y += 6;
      doc.text(`Employee ID: ${employeeId}`, 14, y); y += 6;
      doc.text(`Department: ${department}`, 14, y);

      // Pay details
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("Pay Details", 120, 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      let rightY = 48;
      doc.text(`Pay Cycle: ${record.pay_cycle || "--"}`, 120, rightY); rightY += 6;
      doc.text(`Pay Date: ${ssFormatDate(record.pay_date)}`, 120, rightY); rightY += 6;
      doc.text(`Status: ${record.status || "--"}`, 120, rightY); rightY += 6;
      doc.text(`Currency: ${currency}`, 120, rightY);

      // Divider
      y = 86;
      doc.setDrawColor(209, 213, 219);
      doc.line(14, y, 196, y);
      y += 10;

      // Pay breakdown sections
      const sections = [
        {
          title: "Earnings",
          rows: [
            { label: "Basic Pay", value: record.basic_pay },
            { label: "Housing Allowance", value: record.housing_allowance },
            { label: "Transport Allowance", value: record.transport_allowance },
            { label: "Utility Allowance", value: record.utility_allowance },
            { label: "Medical Allowance", value: record.medical_allowance },
            { label: "Other Allowance", value: record.other_allowance },
            { label: "Bonus", value: record.bonus },
            { label: "Overtime", value: record.overtime },
            { label: "Logistics Allowance", value: record.logistics_allowance },
            { label: "Data / Airtime Allowance", value: record.data_airtime_allowance },
            { label: "Gross Pay", value: record.gross_pay, bold: true },
          ].filter((r) => r.bold || Number(r.value || 0) > 0),
        },
        {
          title: "Deductions",
          rows: [
            { label: "PAYE Tax", value: record.paye_tax },
            { label: "WHT Tax", value: record.wht_tax },
            { label: "Employee Pension", value: record.employee_pension },
            { label: "Other Deductions", value: record.other_deductions },
            { label: "Total Deductions", value: record.total_deductions, bold: true },
          ].filter((r) => r.bold || Number(r.value || 0) > 0),
        },
        {
          title: "Net Pay",
          rows: [
            { label: "Net Pay", value: record.net_pay, bold: true },
          ],
        },
      ];

      sections.forEach((section) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(17, 24, 39);
        doc.text(section.title, 14, y);
        y += 6;

        doc.setFontSize(10);

        section.rows.forEach((row) => {
          if (y > 275) {
            doc.addPage();
            y = 20;
          }

          doc.setFont("helvetica", row.bold ? "bold" : "normal");
          doc.text(String(row.label), 14, y);
          doc.text(ssFormatCurrency(row.value, currency), 140, y, { align: "right" });
          y += 6;
        });

        y += 6;
      });

      // Footer
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text("This payslip was generated from an authorised payroll record in BexHR.", 14, y);

      const safePayCycle = (record.pay_cycle || "Payslip")
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, "");
      const safeName =
        employeeName.replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "Staff";

      doc.save(`${safeName}-Payslip-${safePayCycle}.pdf`);
    } catch (error) {
      console.error("[SS] PDF generation error:", error);
      showSsAlert("danger", "Payslip PDF could not be generated.");
    } finally {
      if (buttonElement) {
        buttonElement.disabled = false;
        buttonElement.innerHTML = `<i class="bi bi-file-earmark-pdf"></i>`;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public init
  // -----------------------------------------------------------------------
  async function init(currentUser, currentProfile) {
    if (!currentUser) {
      console.warn("[SS] init() called without currentUser — aborting.");
      return;
    }

    ssState.currentUser = currentUser;
    ssState.currentProfile = currentProfile;

    cacheSsDomElements();

    if (!ssState.isInitialized) {
      // Wire up events only on first open
      bindSsNavigationEvents();
      bindSsLeaveBalancesCardEvents();
      bindSsLatestDecisionCardEvents();
      bindSsLeaveHistoryCardEvents();
      bindSsLeaveFormEvents();
      bindSsPayrollHistoryCardEvents();
      bindSsPayrollEvents();
      ssState.isInitialized = true;
    }

    // Load data
    clearSsAlert();

    await loadSsEmployeeRecord();
    await Promise.all([
      loadSsLeaveTypes(),
      loadSsLeaveBalances(),
      loadSsLeaveRequests(),
      loadSsPayroll(),
    ]);

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // HR users often enter My Self-Service from payslip email/payment context.
    // Show Payroll first so their own authorised payslip records are immediately visible.
    // Leave remains available through the Leave Management sub-tab.
    switchSsSubSection("payroll");

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // Keep leave cards closed by default. This avoids the Leave workspace
    // taking over the self-service page when HR is trying to check payroll.
    setSsCardExpanded(
      ssState.dom.ssToggleLeaveBalancesCardBtn,
      ssState.dom.ssLeaveBalancesCardCollapse,
      false,
    );
    setSsCardExpanded(
      ssState.dom.ssToggleLeaveHistoryCardBtn,
      ssState.dom.ssLeaveHistoryCardCollapse,
      false,
    );

    // HR SELF-SERVICE PAYROLL VISIBILITY - STEP 1B
    // Payroll History should be open when Payroll is the default sub-section.
    setSsCardExpanded(
      ssState.dom.ssTogglePayrollHistoryCardBtn,
      ssState.dom.ssPayrollHistoryCardCollapse,
      true,
    );
  }

  // -----------------------------------------------------------------------
  // Expose module
  // -----------------------------------------------------------------------
  window.EmployeeSelfService = {
    init,
  };
})();
