// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the old scroll position before the selected
// workspace finishes loading. Keep restoration manual so refresh always lands
// at the top of the restored Manager workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Manager dashboard scroll restoration could not be set to manual.", error);
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindEvents();

    const access = await window.SessionManager.protectPage("manager");

    if (!access) return;

    state.currentUser = access.session.user;
    state.currentProfile = access.profile;

    await loadLatestManagerProfile();
    renderManagerProfile(state.currentProfile, access.session.user);

    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Fresh login opens Profile because logout clears memory.
    // Browser refresh restores the last Manager workspace and lands at the top.
    restoreManagerWorkspaceAfterRefresh();

    initialiseDecisionModal();

    window.managerHandleLeaveAction = function (leaveId, action, button) {
      openDecisionModal(leaveId, action, button);
    };

    await refreshManagerWorkspace();
  } catch (error) {
    console.error("Error initialising manager dashboard:", error);
    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the manager dashboard.",
    );
  }
});

const PROFILE_IMAGES_BUCKET = "profile-images";
// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Manager workspace tab for refresh recovery.
// No employee, leave, decision, comment, or team data is stored.
const MANAGER_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastManagerWorkspace";

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by manager-dashboard.html to avoid first-paint
// Profile flash before manager-dashboard.js completes authentication startup.
const MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastManagerWorkspace:last";

const state = {
  currentUser: null,
  currentProfile: null,
  currentManagerEmployeeRecord: null,

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // Stores the last loaded/saved editable profile values.
  // Save Profile Changes should only activate when the manager changes these values.
  currentProfileEditableBaseline: null,

  teamMembers: [],
  filteredTeamMembers: [],
  pendingLeaveRequests: [],
  processedLeaveRequests: [],
  teamLeaveSchedule: [],
  pendingProfileImageFile: null,
  pendingDecisionAction: null,
  pendingDecisionRequest: null,
  pendingDecisionButton: null,
  leaveDecisionModal: null,

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Controls the temporary bottom-right manager notification.
  dashboardToastTimeoutId: null,

  dom: {},
};

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these top-level Manager workspaces are safe to restore after refresh.
function isValidManagerWorkspaceKey(workspace = "") {
  return ["profile", "team", "selfservice"].includes(String(workspace || "").trim());
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Resolve a tenant/company scope where available so one company/user context
// does not bleed into another. Manager pages do not need to store operational data.
function getManagerWorkspaceTenantScope() {
  try {
    const rawContext = localStorage.getItem("hrPayrollTenantContext");
    const tenantContext = rawContext ? JSON.parse(rawContext) : null;

    return String(
      tenantContext?.tenantId ||
      state.currentProfile?.tenant_id ||
      "no-tenant",
    ).trim();
  } catch (error) {
    console.warn("Manager tenant context could not be read for workspace memory.", error);

    return String(state.currentProfile?.tenant_id || "no-tenant").trim();
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope the stored workspace to the signed-in manager and company context.
function getManagerWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();
  const tenantScope = getManagerWorkspaceTenantScope();

  return `${MANAGER_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}:${tenantScope}`;
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active workspace key. Do not store leave, employee, team,
// decision, comment, or manager-sensitive data in browser storage.
// In-memory fallback — survives the page session even when
// sessionStorage is blocked by browser tracking prevention.
let _managerWorkspaceInMemory = null;

function rememberManagerWorkspace(workspace = "") {
  if (!isValidManagerWorkspaceKey(workspace)) return;

  _managerWorkspaceInMemory = workspace;

  try {
    sessionStorage.setItem(getManagerWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to manager-dashboard.js.
    sessionStorage.setItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Manager workspace memory could not be saved.", error);
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered workspace for this manager session.
// Fresh login naturally falls back to Profile after logout clears the keys.
function getRememberedManagerWorkspace() {
  // Prefer in-memory value (set when user clicks a tab this session).
  if (isValidManagerWorkspaceKey(_managerWorkspaceInMemory)) return _managerWorkspaceInMemory;

  try {
    const scopedWorkspace = sessionStorage.getItem(getManagerWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY);
    const workspace = scopedWorkspace || bootWorkspace || "profile";

    return isValidManagerWorkspaceKey(workspace) ? workspace : "profile";
  } catch (error) {
    console.warn("Manager workspace memory could not be read.", error);
    return "profile";
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout must reset the next Manager session to Profile.
function clearRememberedManagerWorkspace() {
  try {
    sessionStorage.removeItem(getManagerWorkspaceMemoryKey());
    sessionStorage.removeItem(MANAGER_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Manager workspace memory could not be cleared.", error);
  }
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceManagerDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateManagerBackToTopButtonVisibility();
}

// MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Manager workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long pages.
function restoreManagerWorkspaceAfterRefresh() {
  const workspace = getRememberedManagerWorkspace();

  switchManagerWorkspace(workspace);
  forceManagerDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceManagerDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceManagerDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceManagerDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceManagerDashboardToTopAfterRefresh, 150);
}

function getSupabaseClient() {
  if (!window.supabaseClient) {
    throw new Error(
      "Supabase client is not available on window.supabaseClient.",
    );
  }

  return window.supabaseClient;
}

function cacheDomElements() {
  state.dom = {
    pageAlert: document.getElementById("pageAlert"),

    logoutBtn: document.getElementById("logoutBtn"),
    refreshTeamBtn: document.getElementById("refreshTeamBtn"),
    teamSearchInput: document.getElementById("teamSearchInput"),

    managerTabProfileBtn: document.getElementById("managerTabProfileBtn"),
    managerTabTeamBtn: document.getElementById("managerTabTeamBtn"),

    // EMPLOYEE SELF-SERVICE - MANAGER
    // Self-Service workspace tab and section for Managers to manage their own
    // leave and payroll as if they were using the employee dashboard.
    managerTabSelfServiceBtn: document.getElementById("managerTabSelfServiceBtn"),
    managerProfileSection: document.getElementById("managerProfileSection"),
    managerTeamSection: document.getElementById("managerTeamSection"),

    // EMPLOYEE SELF-SERVICE - MANAGER
    managerSelfServiceSection: document.getElementById("managerSelfServiceSection"),

    managerEmail: document.getElementById("managerEmail"),
    managerRole: document.getElementById("managerRole"),
    managerModuleValue: document.getElementById("managerModuleValue"),
    managerInitials: document.getElementById("managerInitials"),
    managerHeroImage: document.getElementById("managerHeroImage"),

    managerFullName: document.getElementById("managerFullName"),
    managerEmailTile: document.getElementById("managerEmailTile"),
    managerRoleTile: document.getElementById("managerRoleTile"),
    managerDepartment: document.getElementById("managerDepartment"),

    managerProfileAvatar: document.getElementById("managerProfileAvatar"),
    managerProfileCardName: document.getElementById("managerProfileCardName"),
    managerProfileCardEmail: document.getElementById("managerProfileCardEmail"),
    managerProfileForm: document.getElementById("managerProfileForm"),
    managerProfileFullName: document.getElementById("managerProfileFullName"),
    managerProfileEmail: document.getElementById("managerProfileEmail"),
    managerProfileRole: document.getElementById("managerProfileRole"),
    managerProfileDepartment: document.getElementById(
      "managerProfileDepartment",
    ),
    saveManagerProfileBtn: document.getElementById("saveManagerProfileBtn"),

    managerProfileImageInput: document.getElementById(
      "managerProfileImageInput",
    ),
    managerProfileImagePreview: document.getElementById(
      "managerProfileImagePreview",
    ),
    saveManagerProfileImageBtn: document.getElementById(
      "saveManagerProfileImageBtn",
    ),

    leaveDecisionModal: document.getElementById("leaveDecisionModal"),
    leaveDecisionModalLabel: document.getElementById("leaveDecisionModalLabel"),
    leaveDecisionModalSubtext: document.getElementById("leaveDecisionModalSubtext"),
    decisionEmployeeName: document.getElementById("decisionEmployeeName"),
    decisionLeaveType: document.getElementById("decisionLeaveType"),
    decisionStartDate: document.getElementById("decisionStartDate"),
    decisionEndDate: document.getElementById("decisionEndDate"),
    decisionTotalDays: document.getElementById("decisionTotalDays"),
    decisionConflictStatus: document.getElementById("decisionConflictStatus"),
    decisionActionBadge: document.getElementById("decisionActionBadge"),
    decisionCommentInput: document.getElementById("decisionCommentInput"),
    decisionCommentHelpText: document.getElementById("decisionCommentHelpText"),
    decisionCommentRequiredMarker: document.getElementById("decisionCommentRequiredMarker"),
    closeDecisionModalBtn: document.getElementById("closeDecisionModalBtn"),
    confirmDecisionBtn: document.getElementById("confirmDecisionBtn"),

    teamCountValue: document.getElementById("teamCountValue"),
    activeCountValue: document.getElementById("activeCountValue"),
    pendingCountValue: document.getElementById("pendingCountValue"),
    departmentCountValue: document.getElementById("departmentCountValue"),

    pendingLeaveCountValue: document.getElementById("pendingLeaveCountValue"),
    upcomingLeaveCountValue: document.getElementById("upcomingLeaveCountValue"),
    overlapCountValue: document.getElementById("overlapCountValue"),
    leaveTypeCountValue: document.getElementById("leaveTypeCountValue"),

    pendingRequestsEmptyState: document.getElementById(
      "pendingRequestsEmptyState",
    ),
    pendingRequestsTableWrapper: document.getElementById(
      "pendingRequestsTableWrapper",
    ),
    pendingRequestsTableBody: document.getElementById(
      "pendingRequestsTableBody",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Pending Leave Requests now supports default collapse and safe
    // double-click collapse like the other cleaned manager cards.
    pendingRequestsCardHeader: document.getElementById(
      "pendingRequestsCardHeader",
    ),
    togglePendingRequestsCardBtn: document.getElementById(
      "togglePendingRequestsCardBtn",
    ),
    pendingRequestsCardCollapse: document.getElementById(
      "pendingRequestsCardCollapse",
    ),

    processedRequestsEmptyState: document.getElementById(
      "processedRequestsEmptyState",
    ),
    processedRequestsTableWrapper: document.getElementById(
      "processedRequestsTableWrapper",
    ),
    processedRequestsTableBody: document.getElementById(
      "processedRequestsTableBody",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
    // Processed leave decisions card supports default collapse and
    // double-click collapse like other cleaned dashboard cards.
    processedRequestsCardHeader: document.getElementById(
      "processedRequestsCardHeader",
    ),
    toggleProcessedRequestsCardBtn: document.getElementById(
      "toggleProcessedRequestsCardBtn",
    ),
    processedRequestsCardCollapse: document.getElementById(
      "processedRequestsCardCollapse",
    ),

    teamScheduleEmptyState: document.getElementById("teamScheduleEmptyState"),
    teamScheduleTableWrapper: document.getElementById(
      "teamScheduleTableWrapper",
    ),
    teamScheduleTableBody: document.getElementById("teamScheduleTableBody"),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
    // Team Leave Schedule is open by default but can be collapsed like the
    // processed audit card, without touching leave approval logic.
    teamScheduleCardHeader: document.getElementById("teamScheduleCardHeader"),
    toggleTeamScheduleCardBtn: document.getElementById(
      "toggleTeamScheduleCardBtn",
    ),
    teamScheduleCardCollapse: document.getElementById(
      "teamScheduleCardCollapse",
    ),

    teamEmptyState: document.getElementById("teamEmptyState"),
    teamTableWrapper: document.getElementById("teamTableWrapper"),
    teamTableBody: document.getElementById("teamTableBody"),

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
    // Assigned Employee Records is a default-collapsed reference panel.
    assignedEmployeeRecordsCardHeader: document.getElementById(
      "assignedEmployeeRecordsCardHeader",
    ),
    toggleAssignedEmployeeRecordsCardBtn: document.getElementById(
      "toggleAssignedEmployeeRecordsCardBtn",
    ),
    assignedEmployeeRecordsCardCollapse: document.getElementById(
      "assignedEmployeeRecordsCardCollapse",
    ),

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Floating navigation and bottom-right notification controls.
    backToTopBtn: document.getElementById("backToTopBtn"),
    dashboardToast: document.getElementById("dashboardToast"),
    dashboardToastAccent: document.getElementById("dashboardToastAccent"),
    dashboardToastIcon: document.getElementById("dashboardToastIcon"),
    dashboardToastTitle: document.getElementById("dashboardToastTitle"),
    dashboardToastMessage: document.getElementById("dashboardToastMessage"),
    dashboardToastCloseBtn: document.getElementById("dashboardToastCloseBtn"),
  };
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
// Reusable card collapse behaviour for manager dashboard cards.
// Mirrors the HR dashboard pattern but keeps the implementation local
// to this file so no shared approval or RLS logic is disturbed.
function setManagerCardExpanded(button, panel, shouldExpand) {
  if (!button || !panel) return;

  panel.classList.toggle("d-none", !shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));

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

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
// Button toggles expand/collapse.
// Double-click is collapse-only so it never accidentally opens an audit card.
// The expanded panel also listens for double-click, so managers can collapse
// the card even when they are deep inside long processed records.
function bindManagerCardCollapseToggle(button, panel, header) {
  if (!button || !panel) return;

  const toggleCardFromButton = () => {
    const shouldExpand = panel.classList.contains("d-none");
    setManagerCardExpanded(button, panel, shouldExpand);
  };

  const collapseCardFromDoubleClick = (event) => {
    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-C
    // Double-click is collapse-only. It should work on safe card surfaces
    // such as the top/header, side padding, and bottom blank area, but must
    // not collapse while the manager double-clicks inside actual records.
    const blockedTarget = event?.target?.closest(
      "button, a, input, select, textarea, label, table, thead, tbody, tr, th, td",
    );

    if (blockedTarget) return;
    if (panel.classList.contains("d-none")) return;

    setManagerCardExpanded(button, panel, false);
  };

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-C
  // Listen from the whole card, not only the header/panel. This lets the
  // manager collapse from top, side, and bottom blank areas while record cells
  // remain protected by the blockedTarget guard above.
  const cardSurface =
    header?.closest(".dashboard-section-card") ||
    panel.closest(".dashboard-section-card") ||
    panel;

  button.addEventListener("click", toggleCardFromButton);
  cardSurface.addEventListener("dblclick", collapseCardFromDoubleClick);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
// After a manager decision, show the audit-history card automatically.
// This confirms the decision moved from Pending Requests into Processed Decisions.
function openProcessedRequestsCardAfterDecision() {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I-B
  // After a decision, show the processed audit card exactly from the top:
  // card heading visible, newest processed row visible, and inner scrollbar reset.
  setManagerCardExpanded(
    state.dom.toggleProcessedRequestsCardBtn,
    state.dom.processedRequestsCardCollapse,
    true,
  );

  if (state.dom.processedRequestsTableWrapper) {
    state.dom.processedRequestsTableWrapper.scrollTop = 0;
  }

  window.requestAnimationFrame(() => {
    const targetCard =
      state.dom.processedRequestsCardHeader?.closest(".dashboard-section-card") ||
      state.dom.processedRequestsCardHeader;

    if (!targetCard) return;

    const topWithBreathingRoom =
      targetCard.getBoundingClientRect().top + window.scrollY - 24;

    window.scrollTo({
      top: Math.max(topWithBreathingRoom, 0),
      behavior: "smooth",
    });
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Show the blue Back to Top button only after the manager has scrolled down.
function updateManagerBackToTopButtonVisibility() {
  const button = state.dom.backToTopBtn;
  if (!button) return;

  button.classList.toggle("d-none", window.scrollY <= 420);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Bottom-right manager toast. This mirrors the HR dashboard pattern but is
// local to Manager so no HR/payroll functions are touched.
function showManagerDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = state.dom.dashboardToast;
  if (!toast) return;

  const accent = state.dom.dashboardToastAccent;
  const icon = state.dom.dashboardToastIcon;
  const titleEl = state.dom.dashboardToastTitle;
  const messageEl = state.dom.dashboardToastMessage;

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

  if (titleEl) {
    titleEl.textContent = title;
  }

  if (messageEl) {
    messageEl.textContent = message || "";
  }

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideManagerDashboardToast();
  }, 8000);
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Hide the manager toast without touching page data or leave workflow state.
function hideManagerDashboardToast() {
  state.dom.dashboardToast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
// Business-friendly notification title for manager decisions.
function getLeaveDecisionToastTitle(status = "") {
  const normalisedStatus = normalizeText(status);

  if (normalisedStatus === "approved") return "Leave approved";
  if (normalisedStatus === "rejected") return "Leave rejected";
  if (
    normalisedStatus === "returned" ||
    normalisedStatus === "returned for clarification"
  ) {
    return "Leave returned";
  }

  return "Leave decision saved";
}

function bindEvents() {
  state.dom.logoutBtn?.addEventListener("click", async () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Logout must reset the next Manager session to Profile.
    clearRememberedManagerWorkspace();

    await window.SessionManager.logoutUser("logout");
  });

  state.dom.managerTabProfileBtn?.addEventListener("click", () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberManagerWorkspace("profile");
    switchManagerWorkspace("profile");
  });

  state.dom.managerTabTeamBtn?.addEventListener("click", () => {
    // MANAGER DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Team Management only for refresh. No team or leave data is stored.
    rememberManagerWorkspace("team");
    switchManagerWorkspace("team");
  });

  // EMPLOYEE SELF-SERVICE - MANAGER
  // Manager opens their own employee self-service workspace (leave + payroll).
  // Data loads lazily on first open; subsequent opens simply show the section.
  state.dom.managerTabSelfServiceBtn?.addEventListener("click", () => {
    rememberManagerWorkspace("selfservice");
    switchManagerWorkspace("selfservice");
    initManagerSelfServiceOnFirstOpen();
  });

  state.dom.managerProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveManagerOwnProfile();
  });

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // Keep Save Profile Changes grey until Full Name is actually changed.
  // Department is read-only (sourced from the employee record) and excluded.
  [
    state.dom.managerProfileFullName,
  ].forEach((field) => {
    field?.addEventListener("input", updateManagerProfileSaveButtonState);
    field?.addEventListener("change", updateManagerProfileSaveButtonState);
  });

  updateManagerProfileSaveButtonState();

  state.dom.managerProfileImageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    handlePendingProfileImage(file);
  });

  state.dom.saveManagerProfileImageBtn?.addEventListener("click", async () => {
    await uploadManagerProfileImage();
  });

  state.dom.confirmDecisionBtn?.addEventListener("click", async () => {
    await submitLeaveDecisionFromModal();
  });

  state.dom.leaveDecisionModal?.addEventListener("hidden.bs.modal", () => {
    resetDecisionModalState();
  });

  state.dom.refreshTeamBtn?.addEventListener("click", async () => {
    await refreshManagerWorkspace();
  });

  state.dom.teamSearchInput?.addEventListener("input", () => {
    applyTeamFilter();
  });

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Page-level navigation and toast controls.
  window.addEventListener("scroll", updateManagerBackToTopButtonVisibility, {
    passive: true,
  });

  state.dom.backToTopBtn?.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });

  state.dom.dashboardToastCloseBtn?.addEventListener("click", () => {
    hideManagerDashboardToast();
  });

  updateManagerBackToTopButtonVisibility();

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
  // Pending Requests starts collapsed and uses safe double-click collapse.
  // Double-click does not open a collapsed card and does not fire from table cells.
  bindManagerCardCollapseToggle(
    state.dom.togglePendingRequestsCardBtn,
    state.dom.pendingRequestsCardCollapse,
    state.dom.pendingRequestsCardHeader,
  );

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
  // Processed Decisions starts collapsed by HTML default and can be toggled
  // by the button or by double-clicking the card header.
  bindManagerCardCollapseToggle(
    state.dom.toggleProcessedRequestsCardBtn,
    state.dom.processedRequestsCardCollapse,
    state.dom.processedRequestsCardHeader,
  );

  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
  // Team Schedule stays open by default and can be collapsed from safe card
  // surfaces. Double-click remains collapse-only via the shared helper.
  bindManagerCardCollapseToggle(
    state.dom.toggleTeamScheduleCardBtn,
    state.dom.teamScheduleCardCollapse,
    state.dom.teamScheduleCardHeader,
  );

  // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
  // Assigned Employee Records starts collapsed and uses the same safe
  // double-click-collapse pattern as the other cleaned manager cards.
  bindManagerCardCollapseToggle(
    state.dom.toggleAssignedEmployeeRecordsCardBtn,
    state.dom.assignedEmployeeRecordsCardCollapse,
    state.dom.assignedEmployeeRecordsCardHeader,
  );
}

function initialiseDecisionModal() {
  if (!state.dom.leaveDecisionModal || !window.bootstrap?.Modal) return;
  state.leaveDecisionModal = new window.bootstrap.Modal(state.dom.leaveDecisionModal);
}

function resetDecisionModalState() {
  state.pendingDecisionAction = null;
  state.pendingDecisionRequest = null;
  state.pendingDecisionButton = null;

  if (state.dom.decisionEmployeeName) state.dom.decisionEmployeeName.textContent = "--";
  if (state.dom.decisionLeaveType) state.dom.decisionLeaveType.textContent = "--";
  if (state.dom.decisionStartDate) state.dom.decisionStartDate.textContent = "--";
  if (state.dom.decisionEndDate) state.dom.decisionEndDate.textContent = "--";
  if (state.dom.decisionTotalDays) state.dom.decisionTotalDays.textContent = "--";
  if (state.dom.decisionConflictStatus) state.dom.decisionConflictStatus.innerHTML = "--";
  if (state.dom.decisionActionBadge) state.dom.decisionActionBadge.innerHTML = "--";
  if (state.dom.decisionCommentInput) state.dom.decisionCommentInput.value = "";
  if (state.dom.decisionCommentRequiredMarker) state.dom.decisionCommentRequiredMarker.classList.add("d-none");
  if (state.dom.decisionCommentHelpText) {
    state.dom.decisionCommentHelpText.textContent =
      "Approval comments are optional. Reject and return actions require a comment.";
  }
  setDecisionModalLoading(false);
}

function getDecisionActionConfig(action) {
  switch (action) {
    case "approve":
      return {
        label: "Approve Request",
        buttonClass: "btn btn-success dashboard-action-btn",
        badgeClass: "badge text-bg-success",
        badgeLabel: "Approve",
        helpText: "Approval comments are optional.",
        commentRequired: false,
      };
    case "reject":
      return {
        label: "Reject Request",
        buttonClass: "btn btn-danger dashboard-action-btn",
        badgeClass: "badge text-bg-danger",
        badgeLabel: "Reject",
        helpText: "A rejection comment is required.",
        commentRequired: true,
      };
    case "return":
      return {
        label: "Return for Clarification",
        buttonClass: "btn btn-warning dashboard-action-btn",
        badgeClass: "badge text-bg-warning",
        badgeLabel: "Return",
        helpText: "A clarification comment is required before returning the request.",
        commentRequired: true,
      };
    default:
      return {
        label: "Confirm Decision",
        buttonClass: "btn btn-primary dashboard-action-btn",
        badgeClass: "badge text-bg-primary",
        badgeLabel: "Decision",
        helpText: "Add your comment here.",
        commentRequired: false,
      };
  }
}

function openDecisionModal(leaveId, action, buttonElement) {
  clearPageAlert();

  const request = state.pendingLeaveRequests.find(
    (item) => String(item.id) === String(leaveId),
  );

  if (!request) {
    showPageAlert(
      "warning",
      "The selected leave request could not be resolved. Please refresh and try again.",
    );
    return;
  }

  const config = getDecisionActionConfig(action);
  state.pendingDecisionAction = action;
  state.pendingDecisionRequest = request;
  state.pendingDecisionButton = buttonElement || null;

  if (state.dom.decisionEmployeeName) state.dom.decisionEmployeeName.textContent = request.employeeName || "--";
  if (state.dom.decisionLeaveType) state.dom.decisionLeaveType.textContent = request.leaveTypeName || "--";
  if (state.dom.decisionStartDate) state.dom.decisionStartDate.textContent = formatDate(request.start_date);
  if (state.dom.decisionEndDate) state.dom.decisionEndDate.textContent = formatDate(request.end_date);
  if (state.dom.decisionTotalDays) state.dom.decisionTotalDays.textContent = String(request.total_days || "--");
  if (state.dom.decisionConflictStatus) {
    state.dom.decisionConflictStatus.innerHTML = buildOverlapCellHtml(request);
  }
  if (state.dom.decisionActionBadge) {
    state.dom.decisionActionBadge.innerHTML = `<span class="${config.badgeClass}">${config.badgeLabel}</span>`;
  }
  if (state.dom.decisionCommentInput) {
    state.dom.decisionCommentInput.value = "";
    state.dom.decisionCommentInput.placeholder = config.commentRequired
      ? "Enter your required comment here"
      : "Optional comment";
  }
  if (state.dom.decisionCommentHelpText) {
    state.dom.decisionCommentHelpText.textContent = config.helpText;
  }
  if (state.dom.decisionCommentRequiredMarker) {
    state.dom.decisionCommentRequiredMarker.classList.toggle("d-none", !config.commentRequired);
  }
  if (state.dom.confirmDecisionBtn) {
    state.dom.confirmDecisionBtn.textContent = config.label;
    state.dom.confirmDecisionBtn.className = config.buttonClass;
  }
  if (state.dom.leaveDecisionModalLabel) {
    state.dom.leaveDecisionModalLabel.textContent = config.label;
  }
  if (state.dom.leaveDecisionModalSubtext) {
    state.dom.leaveDecisionModalSubtext.textContent =
      `Review ${request.employeeName}'s ${request.leaveTypeName} request before you continue.`;
  }

  state.leaveDecisionModal?.show();
}

function setDecisionModalLoading(isLoading) {
  if (state.dom.confirmDecisionBtn) {
    state.dom.confirmDecisionBtn.disabled = isLoading;

    if (isLoading) {
      state.dom.confirmDecisionBtn.dataset.originalHtml = state.dom.confirmDecisionBtn.innerHTML;
      state.dom.confirmDecisionBtn.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Saving...
      `;
    } else if (state.dom.confirmDecisionBtn.dataset.originalHtml) {
      state.dom.confirmDecisionBtn.innerHTML = state.dom.confirmDecisionBtn.dataset.originalHtml;
      delete state.dom.confirmDecisionBtn.dataset.originalHtml;
    }
  }

  if (state.dom.closeDecisionModalBtn) {
    state.dom.closeDecisionModalBtn.disabled = isLoading;
  }
}

async function submitLeaveDecisionFromModal() {
  clearPageAlert();

  const request = state.pendingDecisionRequest;
  const action = state.pendingDecisionAction;

  if (!request || !action) {
    showPageAlert("warning", "No leave decision is currently selected.");
    return;
  }

  const status = getDecisionStatusFromAction(action);
  const comment = String(state.dom.decisionCommentInput?.value || "").trim();
  const { commentRequired } = getDecisionActionConfig(action);

  if (commentRequired && !comment) {
    showPageAlert("warning", "A comment is required for this leave decision.");
    state.dom.decisionCommentInput?.focus();
    return;
  }

  try {
    setDecisionModalLoading(true);
    setActionButtonLoading(state.pendingDecisionButton, true);

    if (status === "Approved") {
      // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
      // Defensive manager-side eligibility check. This blocks old bad pending
      // rows such as an ineligible Maternity/Paternity request before any
      // balance update or decision save can occur.
      assertLeaveTypeEligibleForManagerApproval(request);

      // MANAGER DASHBOARD WIRING - STEP 2F
      // Validate same-employee overlap before reducing balance or saving the
      // decision. Future leave is allowed, but overlapping approved leave for
      // the same employee is not HR-safe.
      await assertNoOverlappingApprovedLeaveForEmployee(request);

      await applyApprovedLeaveToBalance(request);
    }

    await persistLeaveDecision(request.id, status, comment);

    notifyLeaveDecisionChanged();

    const successMessage =
      `${request.employeeName}'s leave request was ${status.toLowerCase()} successfully.`;

    showPageAlert("success", successMessage);

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Show a bottom-right notification immediately after approve/reject/return
    // so the manager gets feedback even when the top alert is out of view.
    showManagerDashboardToast(
      "success",
      getLeaveDecisionToastTitle(status),
      successMessage,
    );

    state.leaveDecisionModal?.hide();
    await loadTeamLeaveVisibility();

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1I
    // A completed decision belongs in audit history, so open and focus the
    // Processed Leave Decisions card immediately after the workspace refreshes.
    openProcessedRequestsCardAfterDecision();
  } catch (error) {
    console.error("Error saving leave decision:", error);

    const errorMessage =
      error?.message ||
      error?.details ||
      error?.hint ||
      "The leave decision could not be saved. Please try again.";

    showPageAlert("danger", errorMessage);

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1L
    // Keep failure feedback visible near the manager's current viewport.
    showManagerDashboardToast(
      "danger",
      "Leave decision failed",
      errorMessage,
    );

    window.alert(`Leave decision save failed:

${errorMessage}`);
  } finally {
    setDecisionModalLoading(false);
    setActionButtonLoading(state.pendingDecisionButton, false);
  }
}

function switchManagerWorkspace(workspace) {
  const isProfile = workspace === "profile";
  const isTeam = workspace === "team";
  const isSelfService = workspace === "selfservice";

  state.dom.managerProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.managerTeamSection?.classList.toggle("d-none", !isTeam);
  state.dom.managerSelfServiceSection?.classList.toggle("d-none", !isSelfService);

  state.dom.managerTabProfileBtn.className = isProfile
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-outline-primary dashboard-action-btn";

  state.dom.managerTabTeamBtn.className = isTeam
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-outline-primary dashboard-action-btn";

  if (state.dom.managerTabSelfServiceBtn) {
    state.dom.managerTabSelfServiceBtn.className = isSelfService
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.managerModuleValue) {
    state.dom.managerModuleValue.textContent = isProfile
      ? "Profile"
      : isSelfService
        ? "My Self-Service"
        : "Team Management";
  }

  // CROSS-DASHBOARD SIDEBAR REPLICATION - MANAGER STEP 1C-2
  // Keep the Manager desktop sidebar active state aligned with the existing
  // Manager workspace tabs. This does not change routing, leave approval,
  // reporting-line visibility, or workspace memory logic.
  [
    { id: "sidebarManagerProfileBtn", active: isProfile },
    { id: "sidebarManagerTeamBtn", active: isTeam },
    { id: "sidebarManagerSelfServiceBtn", active: isSelfService },
  ].forEach(({ id, active }) => {
    const item = document.getElementById(id);
    if (item) item.classList.toggle("active", active);
  });
}

// EMPLOYEE SELF-SERVICE - MANAGER
// Lazily initialises the self-service module on the first time the Manager opens
// the Self-Service tab. Subsequent clicks only remember/switch the workspace.
let _managerSelfServiceInitialised = false;

function initManagerSelfServiceOnFirstOpen() {
  if (_managerSelfServiceInitialised) return;

  if (!window.EmployeeSelfService) {
    console.warn("EmployeeSelfService module is not loaded.");
    return;
  }

  _managerSelfServiceInitialised = true;
  window.EmployeeSelfService.init(state.currentUser, state.currentProfile).catch((err) => {
    console.error("Manager self-service init error:", err);
    _managerSelfServiceInitialised = false; // allow retry on next open
  });
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Date-only leave fields should display without timezone drift.
// This keeps manager approval dates compact and predictable.
function getDashboardDisplayDate(value) {
  if (!value) return null;

  const rawValue = String(value || "").trim();
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

  const date = dateOnlyPattern.test(rawValue)
    ? new Date(`${rawValue}T00:00:00`)
    : new Date(rawValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Format as "Jul 1" so Leave Period can show "Jul 1 - Jul 5"
// with the year stacked underneath.
function formatShortMonthDayFromDate(date) {
  if (!date) return "--";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Split submitted timestamp into date and time, matching the cleaner HR-style
// stacked timestamp pattern used elsewhere in the dashboards.
function formatSubmittedDateTimeParts(value) {
  const date = getDashboardDisplayDate(value);

  if (!date) {
    return {
      dateLabel: "--",
      timeLabel: "--",
    };
  }

  return {
    dateLabel: date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    timeLabel: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function getInitials(fullName, fallback = "MG") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return fallback;

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

// MANAGER PROFILE DEPARTMENT SEEDING
// Resolves the manager's department from their employees record (set by HR
// from the controlled organization_departments list). Syncs the value into
// profiles.department if the profile department is blank or out of date.
// Does not insert into organization_departments — department setup is owned
// by HR/Admin through Manage Organization.
async function ensureManagerProfileDepartment(supabase, profileData) {
  if (!profileData) return profileData;

  try {
    const userId = String(state.currentUser?.id || "").trim();
    const email = normalizeText(
      profileData.email || state.currentUser?.email,
    );

    // Look up the manager's employee record to get their HR-assigned department.
    let employeeDept = "";

    if (userId) {
      const { data: empByUser } = await supabase
        .from("employees")
        .select("department")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      employeeDept = String(empByUser?.department || "").trim();
    }

    if (!employeeDept && email) {
      const { data: empByEmail } = await supabase
        .from("employees")
        .select("department")
        .ilike("work_email", email)
        .limit(1)
        .maybeSingle();

      employeeDept = String(empByEmail?.department || "").trim();
    }

    // Nothing to sync if no employee record department was found.
    if (!employeeDept) return profileData;

    // CROSS-DASHBOARD SIDEBAR REPLICATION - MANAGER STEP 1C-2B
    // Manager dashboard must not create controlled organization setup values.
    // Department setup is owned by HR/Admin through Manage Organization.
    // The manager profile can still display/sync the department assigned on
    // the employee record, but it must not insert into organization_departments.
    // Sync into profiles.department if blank or different from employee record.
    const profileDept = String(profileData.department || "").trim();
    if (profileDept !== employeeDept) {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({ department: employeeDept })
        .eq("id", profileData.id)
        .select("*")
        .maybeSingle();

      if (updateError) {
        console.warn("Manager department seed: profile update failed:", updateError);
      } else if (updatedProfile) {
        return updatedProfile;
      }
    }
  } catch (err) {
    console.error("ensureManagerProfileDepartment unexpected error:", err);
  }

  return profileData;
}

async function loadLatestManagerProfile() {
  if (!state.currentUser?.id) return state.currentProfile;

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", state.currentUser.id)
      .maybeSingle();

    if (error) throw error;

    // MANAGER PROFILE DEPARTMENT SEEDING
    // Sync department from the manager's employee record (HR-assigned, controlled list).
    const profile = await ensureManagerProfileDepartment(supabase, data);

    if (profile) state.currentProfile = profile;
    return state.currentProfile;
  } catch (error) {
    console.error("Error loading latest manager profile:", error);
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

function renderManagerProfile(profile, user) {
  const fullName = profile?.full_name || "Manager";
  const email = profile?.email || user?.email || "No email";
  const role = String(profile?.role || "manager").toLowerCase();
  const department = profile?.department || "";
  const initials = getInitials(fullName, "MG");

  if (state.dom.managerEmail) state.dom.managerEmail.textContent = email;
  if (state.dom.managerRole) state.dom.managerRole.textContent = role;
  if (state.dom.managerInitials) {
    state.dom.managerInitials.textContent = initials;
    state.dom.managerInitials.classList.remove("d-none");
  }
  if (state.dom.managerFullName) state.dom.managerFullName.textContent = fullName;
  if (state.dom.managerEmailTile) state.dom.managerEmailTile.textContent = email;
  if (state.dom.managerRoleTile) state.dom.managerRoleTile.textContent = role;
  if (state.dom.managerDepartment) {
    state.dom.managerDepartment.textContent = department || "--";
  }

  if (state.dom.managerProfileAvatar) {
    state.dom.managerProfileAvatar.textContent = initials;
    state.dom.managerProfileAvatar.classList.remove("d-none");
  }

  if (state.dom.managerProfileCardName) {
    state.dom.managerProfileCardName.textContent = fullName;
  }

  if (state.dom.managerProfileCardEmail) {
    state.dom.managerProfileCardEmail.textContent = email;
  }

  if (state.dom.managerProfileFullName) {
    state.dom.managerProfileFullName.value = fullName;
  }

  if (state.dom.managerProfileEmail) {
    state.dom.managerProfileEmail.value = email;
  }

  if (state.dom.managerProfileRole) {
    state.dom.managerProfileRole.value = role;
  }

  if (state.dom.managerProfileDepartment) {
    state.dom.managerProfileDepartment.value = department;
  }

  if (state.dom.managerProfileImagePreview) {
    state.dom.managerProfileImagePreview.src = "";
    state.dom.managerProfileImagePreview.classList.add("d-none");
  }

  if (state.dom.managerHeroImage) {
    state.dom.managerHeroImage.src = "";
    state.dom.managerHeroImage.classList.add("d-none");
  }

  void loadManagerProfileImages(profile?.profile_image_path, initials);

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // After rendering loaded/saved profile data, treat it as the clean baseline.
  state.currentProfileEditableBaseline = getManagerProfileEditableSnapshot();
  updateManagerProfileSaveButtonState();
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Shared button readiness behaviour for this manager page.
// Incomplete or unchanged form = grey and disabled.
// Changed and valid form = blue and enabled.
function setPrimaryActionButtonReadyState(button, canSubmit) {
  if (!button) return;

  button.disabled = !canSubmit;
  button.classList.toggle("btn-primary", canSubmit);
  button.classList.toggle("btn-secondary", !canSubmit);
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Capture only fields the manager can edit from My Profile.
// Department is read-only (sourced from the employee record) and excluded.
function getManagerProfileEditableSnapshot() {
  return {
    full_name: String(state.dom.managerProfileFullName?.value || "").trim(),
  };
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Detect whether the manager changed an editable profile field.
function hasManagerProfileEditableChanges() {
  const currentSnapshot = getManagerProfileEditableSnapshot();
  const baselineSnapshot = state.currentProfileEditableBaseline || {};

  return Object.keys(currentSnapshot).some(
    (key) => currentSnapshot[key] !== String(baselineSnapshot[key] || ""),
  );
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Full Name remains required; Department is optional.
function isManagerProfileFormReadyForSubmit() {
  const hasFullName = Boolean(
    String(state.dom.managerProfileFullName?.value || "").trim(),
  );

  return hasFullName && hasManagerProfileEditableChanges();
}

// MANAGER PROFILE UI CLEANUP - STEP 1A
// Keep Save Profile Changes aligned with the HR/Admin profile behaviour.
function updateManagerProfileSaveButtonState() {
  setPrimaryActionButtonReadyState(
    state.dom.saveManagerProfileBtn,
    isManagerProfileFormReadyForSubmit(),
  );
}

async function saveManagerOwnProfile() {
  const fullName = String(state.dom.managerProfileFullName?.value || "").trim();

  if (!fullName) {
    showPageAlert("warning", "Full name is required before saving your profile.");
    state.dom.managerProfileFullName?.focus();
    return;
  }

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // Pressing Enter inside the form should not save when no editable value changed.
  if (!hasManagerProfileEditableChanges()) {
    updateManagerProfileSaveButtonState();
    return;
  }

  try {
    setProfileSaveLoading(true);

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      full_name: fullName,
    };

    renderManagerProfile(state.currentProfile, state.currentUser);
    showPageAlert("success", "Your profile was updated successfully.");
  } catch (error) {
    console.error("Error updating manager profile:", error);
    showPageAlert(
      "danger",
      error.message || "Your profile could not be updated.",
    );
  } finally {
    setProfileSaveLoading(false);
  }
}

function setProfileImageSaveLoading(isLoading) {
  const button = state.dom.saveManagerProfileImageBtn;
  if (!button) return;

  button.disabled = isLoading;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.dataset.originalClass = button.className;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Uploading...
    `;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    button.className = button.dataset.originalClass || "btn btn-outline-primary dashboard-action-btn";
    delete button.dataset.originalHtml;
    delete button.dataset.originalClass;
    // Re-evaluate: keep disabled if no file is pending
    button.disabled = !state.pendingProfileImageFile;
    button.className = state.pendingProfileImageFile
      ? "btn btn-outline-primary dashboard-action-btn"
      : "btn btn-secondary dashboard-action-btn";
  }
}

function updateManagerProfileImageButtonState() {
  const button = state.dom.saveManagerProfileImageBtn;
  if (!button) return;

  const hasFile = Boolean(state.pendingProfileImageFile);
  button.disabled = !hasFile;
  button.className = hasFile
    ? "btn btn-outline-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function handlePendingProfileImage(file) {
  state.pendingProfileImageFile = null;

  if (!file) {
    if (state.currentProfile) {
      renderManagerProfile(state.currentProfile, state.currentUser);
    }
    updateManagerProfileImageButtonState();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }
    updateManagerProfileImageButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }
    updateManagerProfileImageButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateManagerProfileImageButtonState();

  const reader = new FileReader();
  reader.onload = () => {
    if (state.dom.managerProfileImagePreview) {
      state.dom.managerProfileImagePreview.src = reader.result;
      state.dom.managerProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.classList.add("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = reader.result;
      state.dom.managerHeroImage.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.classList.add("d-none");
    }
  };
  reader.readAsDataURL(file);
}

async function loadManagerProfileImages(profileImagePath, initials) {
  if (!profileImagePath) {
    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.textContent = initials;
      state.dom.managerProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.textContent = initials;
      state.dom.managerInitials.classList.remove("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = "";
      state.dom.managerHeroImage.classList.add("d-none");
    }

    return;
  }

  try {
    const signedImageUrl = await getSignedProfileImageUrl(profileImagePath);
    if (!signedImageUrl) return;

    if (state.dom.managerProfileImagePreview) {
      state.dom.managerProfileImagePreview.src = signedImageUrl;
      state.dom.managerProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.managerProfileAvatar) {
      state.dom.managerProfileAvatar.classList.add("d-none");
    }

    if (state.dom.managerHeroImage) {
      state.dom.managerHeroImage.src = signedImageUrl;
      state.dom.managerHeroImage.classList.remove("d-none");
    }

    if (state.dom.managerInitials) {
      state.dom.managerInitials.classList.add("d-none");
    }
  } catch (error) {
    console.error("Error lazy-loading manager profile image:", error);
  }
}

async function uploadManagerProfileImage() {
  if (!state.pendingProfileImageFile) {
    showPageAlert("warning", "Please choose an image before uploading.");
    return;
  }

  try {
    setProfileImageSaveLoading(true);

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

    state.pendingProfileImageFile = null;
    if (state.dom.managerProfileImageInput) {
      state.dom.managerProfileImageInput.value = "";
    }

    await loadLatestManagerProfile();
    renderManagerProfile(state.currentProfile, state.currentUser);

    showPageAlert("success", "Your profile photo was uploaded successfully.");
  } catch (error) {
    console.error("Error uploading manager profile image:", error);
    showPageAlert(
      "danger",
      error.message || "Profile photo could not be uploaded.",
    );
  } finally {
    setProfileImageSaveLoading(false);
  }
}

function setProfileSaveLoading(isLoading) {
  const button = state.dom.saveManagerProfileBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  // MANAGER PROFILE UI CLEANUP - STEP 1A
  // After saving/loading ends, recalculate whether editable profile changes still exist.
  updateManagerProfileSaveButtonState();
}

function getFirstAvailableValue(row, keys) {
  for (const key of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      const value = row[key];
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }
  }

  return "";
}

function getEmployeeFullName(row) {
  const firstName = getFirstAvailableValue(row, ["first_name", "firstname"]);
  const lastName = getFirstAvailableValue(row, ["last_name", "lastname"]);
  const combined = `${firstName} ${lastName}`.trim();

  if (combined) return combined;

  return (
    getFirstAvailableValue(row, ["full_name", "name"]) || "Unnamed Employee"
  );
}

function rowMatchesManager(row, managerEmail, managerFullName) {
  const possibleManagerEmailFields = [
    "approver_email",
    "manager_email",
    "line_manager_email",
    "supervisor_email",
    "reports_to_email",
    "reporting_manager_email",
  ];

  const possibleManagerNameFields = [
    "line_manager",
    "line_manager_name",
    "manager_name",
    "supervisor_name",
    "reports_to_name",
    "reporting_manager",
    "approver_name",
  ];

  const emailMatch = possibleManagerEmailFields.some((fieldName) => {
    const value = normalizeText(row[fieldName]);
    return value && managerEmail && value === managerEmail;
  });

  const nameMatch = possibleManagerNameFields.some((fieldName) => {
    const value = normalizeText(row[fieldName]);
    return value && managerFullName && value === managerFullName;
  });

  return emailMatch || nameMatch;
}

function getManagerRelationshipLabel(row, managerEmail, managerFullName) {
  const relationshipLabels = [];

  const emailFieldMap = [
    { field: "approver_email", label: "Approver" },
    { field: "manager_email", label: "Manager" },
    { field: "line_manager_email", label: "Line Manager" },
    { field: "supervisor_email", label: "Supervisor" },
    { field: "reports_to_email", label: "Reports To" },
    { field: "reporting_manager_email", label: "Reporting Manager" },
  ];

  const nameFieldMap = [
    { field: "line_manager", label: "Line Manager" },
    { field: "line_manager_name", label: "Line Manager" },
    { field: "manager_name", label: "Manager" },
    { field: "supervisor_name", label: "Supervisor" },
    { field: "reports_to_name", label: "Reports To" },
    { field: "reporting_manager", label: "Reporting Manager" },
    { field: "approver_name", label: "Approver" },
  ];

  emailFieldMap.forEach((item) => {
    const value = normalizeText(row[item.field]);
    if (value && managerEmail && value === managerEmail) {
      relationshipLabels.push(item.label);
    }
  });

  nameFieldMap.forEach((item) => {
    const value = normalizeText(row[item.field]);
    if (value && managerFullName && value === managerFullName) {
      relationshipLabels.push(item.label);
    }
  });

  const uniqueLabels = [...new Set(relationshipLabels)];

  // MANAGER APPROVAL WIRING HARDENING - STEP 1B
  // When RLS has already scoped the employee through employee_reporting_lines,
  // old free-text manager fields may be blank or different. Show a stable
  // HR-facing relationship label instead of implying the row is unassigned.
  return uniqueLabels.length ? uniqueLabels.join(" / ") : "Primary Manager";
}

function getEmploymentDate(row) {
  return getFirstAvailableValue(row, [
    "employment_date",
    "hire_date",
    "date_of_employment",
    "start_date",
    "joining_date",
  ]);
}

function getDepartment(row) {
  return getFirstAvailableValue(row, ["department", "department_name"]) || "--";
}

function getJobTitle(row) {
  return (
    getFirstAvailableValue(row, ["job_title", "position", "role_title"]) || "--"
  );
}

function getWorkEmail(row) {
  return getFirstAvailableValue(row, [
    "work_email",
    "email",
    "official_email",
    "employee_email",
  ]);
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Resolve the logged-in manager to their employee master record.
// The reporting-line table uses employees.id as manager_employee_id, so the
// dashboard must not rely on free-text manager names or global employee RLS.
async function loadCurrentManagerEmployeeRecord() {
  const supabase = getSupabaseClient();
  const managerUserId = String(state.currentUser?.id || "").trim();
  const managerEmail = normalizeText(
    state.currentProfile?.email || state.currentUser?.email,
  );

  if (managerUserId) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", managerUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Manager employee lookup by user_id failed:", error);
    } else if (data) {
      return data;
    }
  }

  if (managerEmail) {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .ilike("work_email", managerEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Load active employee_reporting_lines rows for the resolved manager employee.
// This is the source of truth for the manager's assigned team.
async function loadActiveManagerReportingLineRows(managerEmployeeId) {
  const supabase = getSupabaseClient();

  // MANAGER DASHBOARD WIRING - STEP 2A FIX
  // Use the manager-safe RPC first. Direct frontend reads from
  // employee_reporting_lines can return 0 rows under RLS even when the
  // reporting-line data exists. The RPC resolves the logged-in manager from
  // auth.uid()/auth email and returns only that manager's active assignments.
  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "get_manager_reporting_line_assignments",
  );

  if (!rpcError && Array.isArray(rpcRows)) {
    return rpcRows.filter(
      (row) => normalizeText(row.status) === "active",
    );
  }

  console.warn(
    "Manager reporting-line RPC failed; falling back to direct table read:",
    rpcError,
  );

  // MANAGER DASHBOARD WIRING - STEP 2A FIX
  // Fallback only. This keeps the page usable in local/dev environments where
  // the RPC has not yet been deployed, but production should use the RPC path.
  if (!managerEmployeeId) return [];

  const { data, error } = await supabase
    .from("employee_reporting_lines")
    .select("id, employee_id, manager_employee_id, manager_type, status, effective_date")
    .eq("manager_employee_id", managerEmployeeId)
    .order("effective_date", { ascending: false });

  if (error) throw error;

  return (Array.isArray(data) ? data : []).filter(
    (row) => normalizeText(row.status) === "active",
  );
}

// MANAGER DASHBOARD WIRING - STEP 2A
// If an employee has more than one active row for the same manager, keep the
// most HR-relevant row: Primary first, then latest effective date.
function compareReportingLinePriority(left = {}, right = {}) {
  const leftPrimaryRank = normalizeText(left.manager_type) === "primary" ? 0 : 1;
  const rightPrimaryRank = normalizeText(right.manager_type) === "primary" ? 0 : 1;

  if (leftPrimaryRank !== rightPrimaryRank) {
    return leftPrimaryRank - rightPrimaryRank;
  }

  const leftDate = new Date(left.effective_date || 0).getTime();
  const rightDate = new Date(right.effective_date || 0).getTime();

  return rightDate - leftDate;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Build a quick lookup so employee records, leave requests, and relationship
// labels are all tied back to employee_reporting_lines rather than hardcoded
// names such as a single test employee.
function buildReportingLineByEmployeeId(reportingLineRows = []) {
  const reportingLineByEmployeeId = new Map();

  [...reportingLineRows]
    .sort(compareReportingLinePriority)
    .forEach((row) => {
      const employeeId = String(row.employee_id || "").trim();
      if (!employeeId || reportingLineByEmployeeId.has(employeeId)) return;

      reportingLineByEmployeeId.set(employeeId, row);
    });

  return reportingLineByEmployeeId;
}

// MANAGER DASHBOARD WIRING - STEP 2A
// Display-only relationship text. The security/wiring decision is still made
// by employee_reporting_lines and Supabase RLS.
function getReportingLineRelationshipLabel(reportingLineRow = {}) {
  const managerType = String(reportingLineRow.manager_type || "").trim();

  if (managerType) {
    return `${managerType} Manager`;
  }

  return "Reporting Line Manager";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
// Employee portal access should be resolved by linked profile/user ID where
// available, not email only. This keeps manually seeded/Supabase-created
// employee records from showing "No login" when a real profile exists.
function getEmployeeProfileIdCandidates(row = {}) {
  const candidates = [
    row.user_id,
    row.profile_id,
    row.auth_user_id,
    row.profile_user_id,
    row.employee_user_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(candidates)];
}

function getTeamStatusLabel(profile) {
  if (!profile) return "Employees Missing Login";
  if (profile.is_active === false) return "Inactive";
  return "Active";
}

function getTeamStatusBadgeClass(profile) {
  if (!profile) return "text-bg-warning";
  if (profile.is_active === false) return "text-bg-secondary";
  return "text-bg-success";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Read portal access from a manager-safe RPC instead of relying on direct
// frontend reads from profiles, which can be blocked by RLS for other employees.
async function loadManagerTeamPortalAccessStatusRows() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc(
      "get_manager_team_portal_access_status",
    );

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Unable to load manager team portal access status:", error);
    return [];
  }
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Portal Access is not live presence. It means the employee has a linked
// auth user and profile account for employee self-service.
function getTeamStatusLabelFromPortalAccess(portalAccessRow, fallbackProfile) {
  if (!portalAccessRow) {
    return getTeamStatusLabel(fallbackProfile);
  }

  if (portalAccessRow.has_portal_access && portalAccessRow.portal_is_active) {
    return "Active";
  }

  if (portalAccessRow.has_portal_access && !portalAccessRow.portal_is_active) {
    return "Inactive";
  }

  return "Employees Missing Login";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
// Keep badge styling consistent with the existing manager table.
function getTeamStatusBadgeClassFromPortalAccess(portalAccessRow, fallbackProfile) {
  if (!portalAccessRow) {
    return getTeamStatusBadgeClass(fallbackProfile);
  }

  if (portalAccessRow.has_portal_access && portalAccessRow.portal_is_active) {
    return "text-bg-success";
  }

  if (portalAccessRow.has_portal_access && !portalAccessRow.portal_is_active) {
    return "text-bg-secondary";
  }

  return "text-bg-warning";
}

function getLeaveIdentityCandidatesForMember(member) {
  const candidates = [
    member?.id,
    member?.raw?.id,
    member?.raw?.user_id,
    member?.matchedProfile?.id,
  ].filter(Boolean);

  return [...new Set(candidates.map((value) => String(value)))];
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA);
  const aEnd = new Date(endA);
  const bStart = new Date(startB);
  const bEnd = new Date(endB);

  if (
    Number.isNaN(aStart.getTime()) ||
    Number.isNaN(aEnd.getTime()) ||
    Number.isNaN(bStart.getTime()) ||
    Number.isNaN(bEnd.getTime())
  ) {
    return false;
  }

  return aStart <= bEnd && bStart <= aEnd;
}

function addOverlapFlagsToLeaveItems(items) {
  return items.map((currentItem) => {
    const overlappingItems = items.filter((otherItem) => {
      if (String(currentItem.id) === String(otherItem.id)) return false;
      if (currentItem.employeeName === otherItem.employeeName) return false;

      return rangesOverlap(
        currentItem.start_date,
        currentItem.end_date,
        otherItem.start_date,
        otherItem.end_date,
      );
    });

    const overlappingEmployees = [
      ...new Set(
        overlappingItems
          .map((item) => String(item.employeeName || "").trim())
          .filter(Boolean),
      ),
    ];

    return {
      ...currentItem,
      hasOverlap: overlappingEmployees.length > 0,
      overlapCount: overlappingEmployees.length,
      overlappingEmployees,
    };
  });
}

function getOverlapSummaryText(item) {
  const names = Array.isArray(item?.overlappingEmployees)
    ? item.overlappingEmployees.filter(Boolean)
    : [];

  if (!names.length) {
    return "Clear";
  }

  if (names.length <= 3) {
    return `Conflict with ${names.join(", ")}`;
  }

  return `Conflict with ${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

function buildOverlapCellHtml(item) {
  if (!item?.hasOverlap) {
    return '<span class="badge text-bg-success">Clear</span>';
  }

  return `
    <div>
      <span class="badge text-bg-warning">Conflict (${escapeHtml(item.overlapCount)})</span>
    </div>
    <div class="small text-secondary mt-1">
      ${escapeHtml(getOverlapSummaryText(item))}
    </div>
  `;
}

// MANAGER DASHBOARD WIRING - STEP 2G
// Pending approval rows should tell the manager when approval cannot succeed
// because the employee has no remaining balance for the requested leave type.
// This is display/readiness logic only; applyApprovedLeaveToBalance() remains
// the final save-time control.
function getPendingRequestBalanceWarning(request = {}) {
  if (!request.leave_type_id) {
    return "Leave type is missing, so approval cannot be completed.";
  }

  if (request.leaveBalanceMissing) {
    return `No ${request.leaveTypeName || "leave"} balance record exists for this employee.`;
  }

  const requestedDays = Number(request.total_days || 0);
  const remainingDays = Number(request.leaveBalanceRemainingDays);

  if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
    return "Requested days are invalid, so approval cannot be completed.";
  }

  if (!Number.isFinite(remainingDays)) {
    return null;
  }

  if (remainingDays < requestedDays) {
    return `Remaining ${request.leaveTypeName || "leave"} balance is ${remainingDays}; requested days is ${requestedDays}.`;
  }

  return null;
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Normalise employee gender from the HR employee record for manager-side
// eligibility checks. This mirrors the Employee Dashboard rule but uses
// the enriched manager request item.
function getNormalisedEmployeeGenderForManagerEligibility(request = {}) {
  const rawGender = normalizeText(
    request.employeeGender ||
    request.gender ||
    request.sex ||
    request.gender_identity ||
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

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Manager-facing eligibility warning. Keep wording professional and neutral;
// do not expose blunt gender wording in the approval queue.
function getPendingRequestEligibilityWarning(request = {}) {
  const eligibilityRule = normalizeText(
    request.leaveTypeEligibilityRule || "all_employees",
  );

  if (!request.leave_type_id || eligibilityRule === "all_employees") {
    return null;
  }

  const leaveTypeName = request.leaveTypeName || "This leave type";
  const employeeName = request.employeeName || "this employee";

  if (eligibilityRule === "hr_review_only") {
    return `${leaveTypeName} requires HR review before manager approval. Return or reject the request, or contact HR for special handling.`;
  }

  const employeeGender = getNormalisedEmployeeGenderForManagerEligibility(request);

  if (eligibilityRule === "female_only" && employeeGender === "female") {
    return null;
  }

  if (eligibilityRule === "male_only" && employeeGender === "male") {
    return null;
  }

  if (eligibilityRule === "female_only" || eligibilityRule === "male_only") {
    return `${leaveTypeName} is not available for ${employeeName}'s employee profile. Return or reject the request, or contact HR if special handling is required.`;
  }

  return null;
}

// EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
// Save-time defensive check. This protects against old pending rows, direct
// database inserts, stale browser DOM, or any route that bypasses the visible
// disabled Approve button.
function assertLeaveTypeEligibleForManagerApproval(request = {}) {
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);

  if (eligibilityWarning) {
    throw new Error(eligibilityWarning);
  }
}

// MANAGER DASHBOARD WIRING - STEP 2G
// Keep this as a small wrapper so future HR controls can block approval
// without disabling reject/return actions.
function getPendingRequestApproveBlockReason(request = {}) {
  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
  // Eligibility is checked before balance. If the employee profile is not
  // eligible for the leave type, approval must not proceed regardless of
  // remaining entitlement.
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);

  if (eligibilityWarning) {
    return eligibilityWarning;
  }

  return getPendingRequestBalanceWarning(request);
}

// MANAGER DASHBOARD WIRING - STEP 2F FIX
// HR control: an employee can hold multiple future leave bookings, but they
// must not have two approved leave records covering the same calendar days.
// This check must query leave_requests using the leave-request identity
// candidates, not only employees.id, because leave_requests.employee_id is
// linked to the user/profile identity in this build.
async function assertNoOverlappingApprovedLeaveForEmployee(request = {}) {
  const supabase = getSupabaseClient();

  const leaveRequestEmployeeIds = [
    request.employee_id,
    request.employeeRecordId,
    ...(Array.isArray(request.employeeLeaveIdentityCandidates)
      ? request.employeeLeaveIdentityCandidates
      : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const uniqueLeaveRequestEmployeeIds = [...new Set(leaveRequestEmployeeIds)];

  if (
    !uniqueLeaveRequestEmployeeIds.length ||
    !request.start_date ||
    !request.end_date
  ) {
    throw new Error(
      "Employee or leave dates could not be resolved, so overlap validation could not be completed.",
    );
  }

  const { data, error } = await supabase
    .from("leave_requests")
    .select(`
      id,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      total_days,
      status,
      leave_types (
        id,
        code,
        name
      )
    `)
    .in("employee_id", uniqueLeaveRequestEmployeeIds)
    .neq("id", request.id);

  if (error) throw error;

  const overlappingApprovedLeave = (Array.isArray(data) ? data : []).find(
    (existingLeave) =>
      normalizeText(existingLeave.status) === "approved" &&
      rangesOverlap(
        request.start_date,
        request.end_date,
        existingLeave.start_date,
        existingLeave.end_date,
      ),
  );

  if (!overlappingApprovedLeave) return;

  const existingLeaveType =
    overlappingApprovedLeave.leave_types?.name || "approved leave";

  throw new Error(
    `${request.employeeName} already has approved ${existingLeaveType} from ${formatDate(overlappingApprovedLeave.start_date)} to ${formatDate(overlappingApprovedLeave.end_date)}. Return, reject, or amend the duplicate/overlapping request before approving another leave for the same period.`,
  );
}

function getStatusBadgeClass(status) {
  switch (normalizeText(status)) {
    case "approved":
      return "text-bg-success";
    case "rejected":
      return "text-bg-danger";
    case "returned":
    case "returned for clarification":
      return "text-bg-warning";
    default:
      return "text-bg-secondary";
  }
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
// Keep long workflow labels compact in audit tables.
// The saved status remains unchanged; this only affects display text.
function getCompactDecisionStatusLabel(status) {
  const normalizedStatus = normalizeText(status);

  if (
    normalizedStatus === "returned for clarification" ||
    normalizedStatus === "returned"
  ) {
    return "Returned";
  }

  return status || "--";
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Keep pending approval rows readable by grouping identity, period,
// review signals, and actions. These helpers are display-only and do
// not change approval, RLS, employee_reporting_lines, or balance logic.
function getPendingRequestStableEmployeeKey(request = {}) {
  return String(
    request.employeeRecordId ||
    request.employee_id ||
    request.employeeEmail ||
    request.employeeName ||
    "",
  ).trim();
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Detect other pending requests for the same employee in the visible manager queue.
// This gives the manager a review signal without changing the saved leave data.
function getSameEmployeePendingRequestCount(request = {}, requests = []) {
  const currentId = String(request.id || "").trim();
  const currentEmployeeKey = getPendingRequestStableEmployeeKey(request);

  if (!currentEmployeeKey) return 0;

  return requests.filter((item) => {
    return (
      String(item.id || "").trim() !== currentId &&
      getPendingRequestStableEmployeeKey(item) === currentEmployeeKey
    );
  }).length;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Compact employee identity block for the pending approval queue.
function buildPendingRequestIdentityHtml(request = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(request.employeeName || "Unknown Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(request.employeeEmail || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(request.employeeDepartment || "--")}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Compact leave-period block keeps the table narrower than separate
// Start Date and End Date columns.
function buildPendingRequestPeriodHtml(request = {}) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
  // Show compact period first, then the year underneath:
  // "Jul 1 - Jul 5" / "2026".
  const startDate = getDashboardDisplayDate(request.start_date);
  const endDate = getDashboardDisplayDate(request.end_date);

  const startLabel = formatShortMonthDayFromDate(startDate);
  const endLabel = formatShortMonthDayFromDate(endDate);

  const startYear = startDate ? String(startDate.getFullYear()) : "";
  const endYear = endDate ? String(endDate.getFullYear()) : "";

  const yearLabel =
    startYear && endYear && startYear !== endYear
      ? `${startYear} - ${endYear}`
      : startYear || endYear || "--";

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(startLabel)} - ${escapeHtml(endLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(yearLabel)}
    </div>
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(request.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
// Submitted date should be readable at a glance:
// "May 19, 2026" with the time underneath.
function buildPendingRequestSubmittedHtml(value) {
  const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(value);

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(dateLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(timeLabel)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Review signals combine workflow status, team conflict, and same-employee
// duplicate pending-request warning. Balance is still enforced on approval
// by applyApprovedLeaveToBalance().
function buildPendingRequestReviewSignalsHtml(request = {}, requests = []) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1E
  // HR behaviour is exception-first:
  // - pending status is already implied by the Pending Leave Requests queue;
  // - clear rows should show one readiness badge;
  // - warning badges appear only when the manager should pause before deciding.
  const duplicateCount = getSameEmployeePendingRequestCount(request, requests);
  const hasTeamConflict = Boolean(request?.hasOverlap);
  const hasDuplicatePendingRequest = duplicateCount > 0;

  // MANAGER DASHBOARD WIRING - STEP 2G
  // Approval readiness must include leave balance, otherwise managers see a
  // false "Ready for decision" badge for requests that the system will later
  // reject because the remaining balance is too low.
  const balanceWarning = getPendingRequestBalanceWarning(request);
  const hasBalanceWarning = Boolean(balanceWarning);

  // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
  // Existing ineligible pending rows should be visible to the manager as
  // profile-eligibility exceptions, not as "Ready for decision".
  const eligibilityWarning = getPendingRequestEligibilityWarning(request);
  const hasEligibilityWarning = Boolean(eligibilityWarning);

  if (
    !hasTeamConflict &&
    !hasDuplicatePendingRequest &&
    !hasBalanceWarning &&
    !hasEligibilityWarning
  ) {
    return `
      <span class="badge text-bg-success">
        Ready for decision
      </span>
    `;
  }

  const warningBadges = [];

  if (hasTeamConflict) {
    warningBadges.push(`
      <span class="badge text-bg-warning">
        Team conflict (${escapeHtml(request.overlapCount || 0)})
      </span>
    `);
  }

  if (hasDuplicatePendingRequest) {
    warningBadges.push(`
      <span class="badge text-bg-warning">
        Duplicate request (${escapeHtml(duplicateCount)})
      </span>
    `);
  }

  if (hasBalanceWarning) {
    warningBadges.push(`
      <span class="badge text-bg-danger">
        Insufficient balance
      </span>
    `);
  }

  if (hasEligibilityWarning) {
    warningBadges.push(`
      <span class="badge text-bg-danger">
        Profile eligibility
      </span>
    `);
  }

  const warningDetails = [];

  if (hasTeamConflict) {
    warningDetails.push(getOverlapSummaryText(request));
  }

  if (hasDuplicatePendingRequest) {
    warningDetails.push(
      `Same employee has ${duplicateCount} other pending request${duplicateCount === 1 ? "" : "s"}.`,
    );
  }

  if (hasBalanceWarning) {
    warningDetails.push(balanceWarning);
  }

  if (hasEligibilityWarning) {
    warningDetails.push(eligibilityWarning);
  }

  return `
    <div class="d-flex flex-column gap-2">
      <div class="d-inline-flex flex-wrap gap-2 align-items-center">
        ${warningBadges.join("")}
      </div>

      <div class="small text-secondary">
        ${escapeHtml(warningDetails.join(" "))}
      </div>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
// Keep the existing window.managerHandleLeaveAction wiring intact.
// This only groups the decision buttons into a cleaner manager action area.
function buildPendingRequestDecisionActionsHtml(request = {}) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
  // Keep action buttons inline and icon-only, but preserve title/aria-label
  // so the controls remain understandable and accessible.
  const safeLeaveId = String(request.id || "").replaceAll("'", "\\'");
  const approveBlockReason = getPendingRequestApproveBlockReason(request);
  const approveBlockedTitle = approveBlockReason
    ? `Cannot approve: ${approveBlockReason}`
    : "Approve request";

  return `
    <div class="d-inline-flex justify-content-end gap-2">
      <button
        type="button"
        class="btn btn-sm ${approveBlockReason ? "btn-secondary" : "btn-success"} dashboard-action-btn px-2"
        title="${escapeHtml(approveBlockedTitle)}"
        aria-label="${escapeHtml(approveBlockedTitle)}"
        ${approveBlockReason ? "disabled" : `onclick="window.managerHandleLeaveAction('${safeLeaveId}','approve',this)"`}
      >
        <i class="bi bi-check-circle"></i>
      </button>

      <button
        type="button"
        class="btn btn-sm btn-danger dashboard-action-btn px-2"
        title="Reject request"
        aria-label="Reject request"
        onclick="window.managerHandleLeaveAction('${safeLeaveId}','reject',this)"
      >
        <i class="bi bi-x-circle"></i>
      </button>

      <button
        type="button"
        class="btn btn-sm btn-warning dashboard-action-btn px-2"
        title="Return for clarification"
        aria-label="Return for clarification"
        onclick="window.managerHandleLeaveAction('${safeLeaveId}','return',this)"
      >
        <i class="bi bi-arrow-return-left"></i>
      </button>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Processed leave decisions are audit records. These helpers format the
// existing data only; they do not change workflow, RLS, or decision persistence.
function buildProcessedRequestIdentityHtml(request = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(request.employeeName || "Unknown Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(request.employeeEmail || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(request.employeeDepartment || "--")}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Keep processed leave period consistent with the pending queue format.
function buildProcessedRequestPeriodHtml(request = {}) {
  const startDate = getDashboardDisplayDate(request.start_date);
  const endDate = getDashboardDisplayDate(request.end_date);

  const startLabel = formatShortMonthDayFromDate(startDate);
  const endLabel = formatShortMonthDayFromDate(endDate);

  const startYear = startDate ? String(startDate.getFullYear()) : "";
  const endYear = endDate ? String(endDate.getFullYear()) : "";

  const yearLabel =
    startYear && endYear && startYear !== endYear
      ? `${startYear} - ${endYear}`
      : startYear || endYear || "--";

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(startLabel)} - ${escapeHtml(endLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(yearLabel)}
    </div>
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(request.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Stack decision maker and timestamp so the audit trail is readable.
function buildProcessedDecisionAuditHtml(request = {}) {
  const { dateLabel, timeLabel } = formatSubmittedDateTimeParts(request.decision_at);

  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(request.decision_by_name || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(dateLabel)}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(timeLabel)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
// Keep comments readable without making empty comments look like missing rows.
function buildProcessedDecisionCommentHtml(request = {}) {
  const comment = String(request.decision_comment || "").trim();

  if (!comment) {
    return `
      <span class="text-secondary small">
        No comment recorded
      </span>
    `;
  }

  return `
    <div class="small text-break">
      ${escapeHtml(comment)}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Team schedule is a coverage-planning view. These helpers format existing
// approved leave records only; they do not change approval or RLS logic.
function buildTeamScheduleIdentityHtml(item = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(item.employeeName || "Unknown Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(item.employeeEmail || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(item.employeeDepartment || "--")}
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Same-year leave remains compact. Cross-year leave is explicit so managers
// do not have to infer which date belongs to which year.
function buildTeamSchedulePeriodHtml(item = {}) {
  const startDate = getDashboardDisplayDate(item.start_date);
  const endDate = getDashboardDisplayDate(item.end_date);

  if (!startDate || !endDate) {
    return `
      <div class="fw-semibold lh-sm">
        ${escapeHtml(formatDate(item.start_date))} - ${escapeHtml(formatDate(item.end_date))}
      </div>
      <div class="mt-2">
        <span class="badge rounded-pill text-bg-light border text-dark">
          ${escapeHtml(item.leaveTypeName || "--")}
        </span>
      </div>
    `;
  }

  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  const periodHtml =
    startYear === endYear
      ? `
        <div class="fw-semibold lh-sm">
          ${escapeHtml(formatShortMonthDayFromDate(startDate))} - ${escapeHtml(formatShortMonthDayFromDate(endDate))}
        </div>
        <div class="text-secondary small mt-1">
          ${escapeHtml(startYear)}
        </div>
      `
      : `
        <div class="fw-semibold lh-sm">
          ${escapeHtml(formatDate(item.start_date))}
        </div>
        <div class="text-secondary small mt-1">
          to ${escapeHtml(formatDate(item.end_date))}
        </div>
      `;

  return `
    ${periodHtml}
    <div class="mt-2">
      <span class="badge rounded-pill text-bg-light border text-dark">
        ${escapeHtml(item.leaveTypeName || "--")}
      </span>
    </div>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J-C
// Display-only timing signal for approved team leave.
// This does not change approval logic or the leave schedule query.
function buildTeamScheduleTimingHtml(item = {}) {
  const startDate = getDashboardDisplayDate(item.start_date);
  const endDate = getDashboardDisplayDate(item.end_date);

  if (!startDate || !endDate) {
    return `
      <span class="badge text-bg-light border text-dark">
        Date unclear
      </span>
    `;
  }

  const today = new Date();
  const todayDateOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const startDateOnly = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  const endDateOnly = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilStart = Math.round(
    (startDateOnly.getTime() - todayDateOnly.getTime()) / dayMs,
  );

  if (todayDateOnly >= startDateOnly && todayDateOnly <= endDateOnly) {
    return `
      <div class="d-flex flex-column gap-1">
        <span class="badge text-bg-primary align-self-start">
          In progress
        </span>
        <span class="small text-secondary">
          Ends ${escapeHtml(formatShortMonthDayFromDate(endDate))}
        </span>
      </div>
    `;
  }

  if (daysUntilStart === 0) {
    return `
      <span class="badge text-bg-primary">
        Starts today
      </span>
    `;
  }

  if (daysUntilStart > 0) {
    return `
      <div class="d-flex flex-column gap-1">
        <span class="badge text-bg-light border text-dark align-self-start">
          Upcoming
        </span>
        <span class="small text-secondary">
          Starts in ${escapeHtml(daysUntilStart)} day${daysUntilStart === 1 ? "" : "s"}
        </span>
      </div>
    `;
  }

  return `
    <span class="badge text-bg-secondary">
      Current schedule
    </span>
  `;
}

// MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
// Replace raw "Conflict Details" with HR-facing coverage status.
function buildTeamScheduleCoverageHtml(item = {}) {
  // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J-B
  // This is an overlap signal, not a full workforce coverage calculation.
  // Keep the label HR-accurate: no overlap unless another approved team
  // leave item intersects this period.
  if (!item?.hasOverlap) {
    return `
      <span class="badge text-bg-success">
        No overlap
      </span>
    `;
  }

  return `
    <div class="d-flex flex-column gap-2">
      <div>
        <span class="badge text-bg-warning">
          Overlap risk (${escapeHtml(item.overlapCount || 0)})
        </span>
      </div>
      <div class="small text-secondary">
        ${escapeHtml(getOverlapSummaryText(item))}
      </div>
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Assigned employee rows are display-only. Do not change the RLS-trusted
// employee list returned by loadAssignedTeamMembers().
function buildAssignedEmployeeIdentityHtml(member = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(member.employeeFullName || "Unnamed Employee")}
    </div>
    <div class="text-secondary small text-break mt-1">
      ${escapeHtml(member.work_email || "--")}
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Combine role and department so the table reads like a people-management view,
// not a raw employee export.
function buildAssignedEmployeeRoleDepartmentHtml(member = {}) {
  return `
    <div class="fw-semibold lh-sm">
      ${escapeHtml(member.job_title || "--")}
    </div>
    <div class="text-secondary small mt-1">
      ${escapeHtml(member.department || "--")}
    </div>
  `;
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Keep long technical status values compact while preserving meaning.
function getCompactAssignedEmployeeStatusLabel(statusLabel) {
  const normalizedStatus = normalizeText(statusLabel);

  if (normalizedStatus === "employees missing login") {
    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-C
    // Shorter HR-facing badge label. Full meaning remains available through
    // the helper text and title/aria-label.
    return "No login";
  }

  return statusLabel || "--";
}

// MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
// Add a small explanation only for missing-login records so managers understand
// the warning without expanding the table width.
function buildAssignedEmployeeStatusHtml(member = {}) {
  const statusLabel = member.teamStatusLabel || "--";
  const compactLabel = getCompactAssignedEmployeeStatusLabel(statusLabel);

  const helpText =
    normalizeText(statusLabel) === "employees missing login"
      ? "No linked user login"
      : "";

  return `
    <div class="d-flex flex-column gap-1">
      <span class="badge ${member.teamStatusBadgeClass || "text-bg-secondary"} align-self-start"
        title="${escapeHtml(statusLabel)}"
        aria-label="${escapeHtml(statusLabel)}">
        ${escapeHtml(compactLabel)}
      </span>
      ${helpText
      ? `<span class="small text-secondary">${escapeHtml(helpText)}</span>`
      : ""
    }
    </div>
  `;
}


function notifyLeaveDecisionChanged() {
  try {
    localStorage.setItem(
      "hrPayrollLeaveDecisionSync",
      JSON.stringify({
        changedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.warn("Unable to broadcast leave decision change:", error);
  }
}

async function refreshManagerWorkspace() {
  renderPendingRequestsLoadingState();
  renderProcessedRequestsLoadingState();
  renderTeamScheduleLoadingState();
  renderTeamLoadingState();

  const teamLoaded = await loadAssignedTeamMembers();

  if (!teamLoaded) {
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];
    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
    return;
  }

  await loadTeamLeaveVisibility();
}

async function loadAssignedTeamMembers() {
  const managerEmail = normalizeText(
    state.currentProfile?.email || state.currentUser?.email,
  );

  if (!state.currentUser?.id && !managerEmail) {
    showPageAlert(
      "warning",
      "Your manager profile is missing a login identity and email, so assigned team members could not be resolved.",
    );
    renderTeamTable([]);
    renderSummaryTiles([]);
    return false;
  }

  try {
    const supabase = getSupabaseClient();

    // MANAGER DASHBOARD WIRING - STEP 2A
    // Resolve the logged-in manager to employees.id first, then use that ID
    // against employee_reporting_lines.manager_employee_id. This prevents the
    // dashboard from showing all employees or behaving as if only one test
    // employee is wired.
    const managerEmployeeRecord = await loadCurrentManagerEmployeeRecord();

    state.currentManagerEmployeeRecord = managerEmployeeRecord;

    if (!managerEmployeeRecord?.id) {
      showPageAlert(
        "warning",
        "Your login could not be matched to an employee manager record. Please check employees.user_id or employees.work_email for this manager.",
      );
      renderTeamTable([]);
      renderSummaryTiles([]);
      return false;
    }

    const reportingLineRows = await loadActiveManagerReportingLineRows(
      managerEmployeeRecord.id,
    );

    const reportingLineByEmployeeId =
      buildReportingLineByEmployeeId(reportingLineRows);

    const assignedEmployeeIds = [...reportingLineByEmployeeId.keys()];

    if (!assignedEmployeeIds.length) {
      showPageAlert(
        "warning",
        "No active reporting-line employees were found for this manager.",
      );
      renderTeamTable([]);
      renderSummaryTiles([]);
      return false;
    }

    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .in("id", assignedEmployeeIds)
      .order("created_at", { ascending: false });

    if (employeeError) throw employeeError;

    // MANAGER DASHBOARD WIRING - STEP 2A
    // Keep only employees backed by active employee_reporting_lines rows.
    // The table query is explicit, so the page no longer depends on broad
    // employees RLS or legacy manager-name fields for assignment scope.
    const matchedEmployees = (Array.isArray(employeeRows) ? employeeRows : [])
      .filter((employee) =>
        reportingLineByEmployeeId.has(String(employee.id)),
      );

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
    // Load manager-safe portal access status for all employees currently in
    // this manager's reporting scope. This fixes false "No login" values
    // caused by profiles RLS blocking direct frontend reads.
    const portalAccessRows = await loadManagerTeamPortalAccessStatusRows();
    const portalAccessByEmployeeId = new Map(
      portalAccessRows.map((row) => [String(row.employee_id), row]),
    );

    const workEmails = matchedEmployees
      .map((employee) => normalizeText(getWorkEmail(employee)))
      .filter(Boolean);

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
    // Resolve linked portal profiles by both email and known profile/user ID.
    // This fixes cases where an employee can sign in from another browser
    // but the manager table still shows "No login" because email-only matching
    // did not resolve the profile row.
    const profileIdCandidates = matchedEmployees.flatMap((employee) =>
      getEmployeeProfileIdCandidates(employee),
    );

    let profilesByEmail = new Map();
    let profilesById = new Map();

    if (workEmails.length) {
      const uniqueEmails = [...new Set(workEmails)];

      const { data: profileRowsByEmail, error: profileEmailError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .in("email", uniqueEmails);

      if (profileEmailError) throw profileEmailError;

      (profileRowsByEmail || []).forEach((profile) => {
        if (profile?.email) {
          profilesByEmail.set(normalizeText(profile.email), profile);
        }

        if (profile?.id) {
          profilesById.set(String(profile.id), profile);
        }
      });
    }

    if (profileIdCandidates.length) {
      const uniqueProfileIds = [...new Set(profileIdCandidates)];

      const { data: profileRowsById, error: profileIdError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .in("id", uniqueProfileIds);

      if (profileIdError) throw profileIdError;

      (profileRowsById || []).forEach((profile) => {
        if (profile?.id) {
          profilesById.set(String(profile.id), profile);
        }

        if (profile?.email) {
          profilesByEmail.set(normalizeText(profile.email), profile);
        }
      });
    }

    const enrichedTeamMembers = matchedEmployees.map((employee) => {
      const workEmail = getWorkEmail(employee);
      const reportingLineRow =
        reportingLineByEmployeeId.get(String(employee.id)) || null;

      // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
      // Portal access is now resolved by employee_id from the safe RPC.
      const portalAccessRow =
        portalAccessByEmployeeId.get(String(employee.id)) || null;
      const profileIdMatch = getEmployeeProfileIdCandidates(employee).find(
        (profileId) => profilesById.has(profileId),
      );

      // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-E
      // Prefer email match where it exists, then fall back to linked profile/user ID.
      const matchedProfile =
        profilesByEmail.get(normalizeText(workEmail)) ||
        (profileIdMatch ? profilesById.get(profileIdMatch) : null) ||
        null;

      return {
        id: employee.id,
        raw: employee,
        employeeFullName: getEmployeeFullName(employee),
        work_email: workEmail || "--",
        department: getDepartment(employee),
        job_title: getJobTitle(employee),
        employment_date: getEmploymentDate(employee),
        matchedProfile,
        // MANAGER DASHBOARD WIRING - STEP 2A
        // Relationship now comes from employee_reporting_lines, not legacy
        // text columns or a hardcoded fallback.
        relationshipLabel: getReportingLineRelationshipLabel(reportingLineRow),
        // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-F
        // Use the RPC status first. Fall back to the old profile match only
        // if the RPC does not return this employee.
        teamStatusLabel: getTeamStatusLabelFromPortalAccess(
          portalAccessRow,
          matchedProfile,
        ),
        teamStatusBadgeClass: getTeamStatusBadgeClassFromPortalAccess(
          portalAccessRow,
          matchedProfile,
        ),
      };
    });

    state.teamMembers = enrichedTeamMembers;
    applyTeamFilter();

    if (!enrichedTeamMembers.length) {
      showPageAlert(
        "warning",
        "No assigned employee records were returned for the active reporting lines. Please check employees RLS for manager team visibility.",
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error loading assigned team members:", error);
    showPageAlert(
      "danger",
      error.message || "Assigned team members could not be loaded.",
    );
    renderTeamTable([]);
    renderSummaryTiles([]);
    return false;
  }
}

function applyTeamFilter() {
  const searchTerm = normalizeText(state.dom.teamSearchInput?.value || "");

  if (!searchTerm) {
    state.filteredTeamMembers = [...state.teamMembers];
  } else {
    state.filteredTeamMembers = state.teamMembers.filter((member) => {
      const searchableText = [
        member.employeeFullName,
        member.work_email,
        member.department,
        member.job_title,
        member.relationshipLabel,
        member.teamStatusLabel,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });
  }

  renderSummaryTiles(state.teamMembers);
  renderTeamTable(state.filteredTeamMembers);
}

function renderSummaryTiles(teamMembers) {
  const activeCount = teamMembers.filter(
    (member) => member.teamStatusLabel === "Active",
  ).length;

  const pendingCount = teamMembers.filter(
    (member) => member.teamStatusLabel === "Employees Missing Login",
  ).length;

  const uniqueDepartments = new Set(
    teamMembers
      .map((member) => String(member.department || "").trim())
      .filter(Boolean),
  );

  if (state.dom.teamCountValue) {
    state.dom.teamCountValue.textContent = String(teamMembers.length);
  }

  if (state.dom.activeCountValue) {
    state.dom.activeCountValue.textContent = String(activeCount);
  }

  if (state.dom.pendingCountValue) {
    state.dom.pendingCountValue.textContent = String(pendingCount);
  }

  if (state.dom.departmentCountValue) {
    state.dom.departmentCountValue.textContent = String(uniqueDepartments.size);
  }
}

function renderTeamLoadingState() {
  if (!state.dom.teamTableBody) return;

  state.dom.teamEmptyState.classList.add("d-none");
  state.dom.teamTableWrapper.classList.remove("d-none");
  state.dom.teamTableBody.innerHTML = `
    <tr>
      <!-- MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-D
           Assigned employee records now render in four manager-facing columns. -->
      <td colspan="4" class="text-center text-secondary py-4">
        Loading assigned team records...
      </td>
    </tr>
  `;
}

function renderTeamTable(teamMembers) {
  const tbody = state.dom.teamTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!teamMembers.length) {
    state.dom.teamEmptyState.classList.remove("d-none");
    state.dom.teamTableWrapper.classList.add("d-none");
    return;
  }

  state.dom.teamEmptyState.classList.add("d-none");
  state.dom.teamTableWrapper.classList.remove("d-none");

  teamMembers.forEach((member) => {
    const row = document.createElement("tr");

    // MANAGER TEAM RECORDS UI CLEANUP - STEP 1K
    // Render assigned employees as grouped HR-facing records while keeping
    // the underlying RLS-scoped employee data unchanged.
    row.innerHTML = `
      <td class="px-3 py-3 align-top">
        ${buildAssignedEmployeeIdentityHtml(member)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildAssignedEmployeeRoleDepartmentHtml(member)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildAssignedEmployeeStatusHtml(member)}
      </td>

      <td class="px-3 py-3 align-top text-nowrap">
        <!-- MANAGER TEAM RECORDS UI CLEANUP - STEP 1K-D
             Manager assignment/scope labels are intentionally not shown here.
             If the employee is visible, reporting-line/RLS has already scoped
             the record to this manager. -->
        ${formatDate(member.employment_date)}
      </td>
    `;

    tbody.appendChild(row);
  });
}

async function loadTeamLeaveVisibility() {
  const supabase = getSupabaseClient();

  const leaveIdentityCandidates = state.teamMembers.flatMap((member) =>
    getLeaveIdentityCandidatesForMember(member),
  );

  const uniqueLeaveIds = [...new Set(leaveIdentityCandidates)];

  if (!uniqueLeaveIds.length) {
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];
    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
    return;
  }

  try {
    const today = new Date();
    const todayIso = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
    )
      .toISOString()
      .split("T")[0];

    const { data: leaveRows, error: leaveError } = await supabase
      .from("leave_requests")
      .select(
        `
        id,
        employee_id,
        leave_type_id,
        start_date,
        end_date,
        total_days,
        status,
        reason,
        submitted_at,
        decision_at,
        decision_by,
        decision_by_name,
        decision_comment,
        leave_types (
          id,
          code,
          name,
          eligibility_rule
        )
      `,
      )
      .in("employee_id", uniqueLeaveIds)
      .order("start_date", { ascending: true });

    if (leaveError) throw leaveError;

    const leaveRowsArray = Array.isArray(leaveRows) ? leaveRows : [];

    // MANAGER DASHBOARD WIRING - STEP 2G
    // Load leave balances for the visible manager-team leave rows so Pending
    // Leave Requests can show accurate approval readiness before the manager
    // opens the modal. Approval is still protected again at save time.
    const leaveBalanceByEmployeeAndType = new Map();

    const leaveBalanceEmployeeIds = [
      ...new Set(
        state.teamMembers
          .map((member) =>
            String(member.id || member.raw?.id || "").trim(),
          )
          .filter(Boolean),
      ),
    ];

    const leaveBalanceTypeIds = [
      ...new Set(
        leaveRowsArray
          .map((row) => String(row.leave_type_id || "").trim())
          .filter(Boolean),
      ),
    ];

    if (leaveBalanceEmployeeIds.length && leaveBalanceTypeIds.length) {
      const { data: balanceRows, error: balanceError } = await supabase
        .from("employee_leave_balances")
        .select("id, employee_id, leave_type_id, entitled_days, used_days, remaining_days")
        .in("employee_id", leaveBalanceEmployeeIds)
        .in("leave_type_id", leaveBalanceTypeIds);

      if (balanceError) throw balanceError;

      (balanceRows || []).forEach((balanceRow) => {
        const balanceKey = `${balanceRow.employee_id}|${balanceRow.leave_type_id}`;
        leaveBalanceByEmployeeAndType.set(balanceKey, balanceRow);
      });
    }

    const teamMembersByIdentity = new Map();

    state.teamMembers.forEach((member) => {
      getLeaveIdentityCandidatesForMember(member).forEach((candidate) => {
        teamMembersByIdentity.set(String(candidate), member);
      });
    });

    const enrichedLeaveItems = leaveRowsArray
      .map((leaveRow) => {
        const owner = teamMembersByIdentity.get(String(leaveRow.employee_id));
        if (!owner) return null;

        // MANAGER DASHBOARD WIRING - STEP 2G FIX
        // Leave requests can be loaded through multiple identity candidates,
        // but leave balances are keyed by the real employees.id record.
        // Use owner.id here so the pending queue does not falsely report
        // "No balance record" when the balance exists but is fully used.
        const balanceKey = `${owner.id}|${leaveRow.leave_type_id}`;
        const leaveBalance = leaveBalanceByEmployeeAndType.get(balanceKey) || null;

        return {
          ...leaveRow,
          employeeName: owner.employeeFullName,
          employeeEmail: owner.work_email,
          employeeDepartment: owner.department,
          leaveTypeName: leaveRow.leave_types?.name || "Unknown",

          // EMPLOYEE LEAVE POLICY ELIGIBILITY - STEP 1D
          // Manager approval must respect the same leave-type eligibility
          // rule used by Employee Self Service. Keep these values on the
          // request item so pending readiness and save-time approval checks
          // can block ineligible requests without affecting reject/return.
          leaveTypeCode: leaveRow.leave_types?.code || "",
          leaveTypeEligibilityRule:
            leaveRow.leave_types?.eligibility_rule || "all_employees",
          employeeGender:
            owner.raw?.gender ||
            owner.raw?.sex ||
            owner.raw?.gender_identity ||
            "",

          employeeRecordId: owner.id,

          // MANAGER DASHBOARD WIRING - STEP 2F FIX
          // leave_requests.employee_id can be the linked user/profile ID,
          // while balances use employees.id. Keep all known identity values
          // so overlap validation checks the correct leave_request owner.
          employeeLeaveIdentityCandidates: getLeaveIdentityCandidatesForMember(owner),

          // MANAGER DASHBOARD WIRING - STEP 2G
          // Balance values support manager-facing readiness badges and disabled
          // approval buttons for impossible approvals. They do not replace the
          // final save-time balance validation.
          leaveBalanceMissing: !leaveBalance,
          leaveBalanceEntitledDays: leaveBalance
            ? Number(leaveBalance.entitled_days || 0)
            : null,
          leaveBalanceUsedDays: leaveBalance
            ? Number(leaveBalance.used_days || 0)
            : null,
          leaveBalanceRemainingDays: leaveBalance
            ? Number(leaveBalance.remaining_days || 0)
            : null,
        };
      })
      .filter(Boolean);

    const pendingRequests = enrichedLeaveItems
      .filter((item) => normalizeText(item.status) === "pending approval")
      .sort((left, right) => {
        // MANAGER DASHBOARD WIRING - STEP 2C
        // Pending approval is a manager action queue, not a leave calendar.
        // Show the newest submitted request first so managers review current
        // requests before older pending items.
        const leftSubmittedDate = new Date(
          left.submitted_at || left.start_date || 0,
        ).getTime();

        const rightSubmittedDate = new Date(
          right.submitted_at || right.start_date || 0,
        ).getTime();

        return rightSubmittedDate - leftSubmittedDate;
      });

    const processedRequests = enrichedLeaveItems
      .filter((item) =>
        ["approved", "rejected", "returned", "returned for clarification"].includes(
          normalizeText(item.status),
        ),
      )
      .sort((left, right) => {
        const leftDate = new Date(
          left.decision_at || left.submitted_at || left.start_date || 0,
        ).getTime();
        const rightDate = new Date(
          right.decision_at || right.submitted_at || right.start_date || 0,
        ).getTime();
        return rightDate - leftDate;
      });

    const upcomingScheduleItems = enrichedLeaveItems.filter((item) => {
      const normalizedStatus = normalizeText(item.status);

      if (normalizedStatus !== "approved") {
        return false;
      }

      return String(item.end_date || "") >= todayIso;
    });

    state.pendingLeaveRequests = addOverlapFlagsToLeaveItems(pendingRequests);
    state.processedLeaveRequests = processedRequests;
    state.teamLeaveSchedule = addOverlapFlagsToLeaveItems(
      upcomingScheduleItems,
    ).sort((left, right) => {
      const leftDate = new Date(left.start_date || 0).getTime();
      const rightDate = new Date(right.start_date || 0).getTime();
      return leftDate - rightDate;
    });

    renderPendingLeaveRequests(state.pendingLeaveRequests);
    renderProcessedLeaveRequests(state.processedLeaveRequests);
    renderTeamLeaveSchedule(state.teamLeaveSchedule);
    renderLeaveSummaryTiles(
      state.pendingLeaveRequests,
      state.teamLeaveSchedule,
    );
  } catch (error) {
    console.error("Error loading team leave visibility:", error);
    showPageAlert(
      "danger",
      error.message ||
      "Team leave requests and leave schedule could not be loaded.",
    );
    state.pendingLeaveRequests = [];
    state.processedLeaveRequests = [];
    state.teamLeaveSchedule = [];
    renderPendingLeaveRequests([]);
    renderProcessedLeaveRequests([]);
    renderTeamLeaveSchedule([]);
    renderLeaveSummaryTiles([], []);
  }
}

function renderLeaveSummaryTiles(pendingRequests, scheduleItems) {
  const overlapCount = scheduleItems.filter((item) => item.hasOverlap).length;

  const uniqueLeaveTypes = new Set(
    [...pendingRequests, ...scheduleItems]
      .map((item) => String(item.leaveTypeName || "").trim())
      .filter(Boolean),
  );

  if (state.dom.pendingLeaveCountValue) {
    state.dom.pendingLeaveCountValue.textContent = String(pendingRequests.length);
  }

  if (state.dom.upcomingLeaveCountValue) {
    state.dom.upcomingLeaveCountValue.textContent = String(scheduleItems.length);
  }

  if (state.dom.overlapCountValue) {
    state.dom.overlapCountValue.textContent = String(overlapCount);
  }

  if (state.dom.leaveTypeCountValue) {
    state.dom.leaveTypeCountValue.textContent = String(uniqueLeaveTypes.size);
  }
}

function renderPendingRequestsLoadingState() {
  if (!state.dom.pendingRequestsTableBody) return;

  state.dom.pendingRequestsEmptyState.classList.add("d-none");
  state.dom.pendingRequestsTableWrapper.classList.remove("d-none");
  state.dom.pendingRequestsTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
           Pending approval table now has six manager-facing review columns. -->
      <td colspan="6" class="text-center text-secondary py-4">
        Loading pending leave requests...
      </td>
    </tr>
  `;
}

function renderPendingLeaveRequests(requests) {
  const tbody = state.dom.pendingRequestsTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!requests.length) {
    state.dom.pendingRequestsEmptyState.classList.remove("d-none");
    state.dom.pendingRequestsTableWrapper.classList.add("d-none");
    return;
  }

  state.dom.pendingRequestsEmptyState.classList.add("d-none");
  state.dom.pendingRequestsTableWrapper.classList.remove("d-none");

  requests.forEach((request) => {
    const row = document.createElement("tr");

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1C
    // Render each pending leave request as a compact manager review row.
    // Existing IDs, status values, modal launch, and approval persistence
    // remain unchanged.
    row.innerHTML = `
      <td class="px-3 py-3 align-top">
        ${buildPendingRequestIdentityHtml(request)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildPendingRequestPeriodHtml(request)}
      </td>

      <td class="px-3 py-3 align-top text-center">
        <span class="badge rounded-pill text-bg-light border text-dark px-3 py-2">
          ${escapeHtml(request.total_days || "--")}
        </span>
      </td>

      <td class="px-3 py-3 align-top text-nowrap">
        <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1D
             Stack submitted date and time for easier manager review. -->
        ${buildPendingRequestSubmittedHtml(request.submitted_at)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildPendingRequestReviewSignalsHtml(request, requests)}
      </td>

      <td class="px-3 py-3 align-top text-end">
        ${buildPendingRequestDecisionActionsHtml(request)}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function renderProcessedRequestsLoadingState() {
  if (!state.dom.processedRequestsTableBody) return;

  state.dom.processedRequestsEmptyState?.classList.add("d-none");
  state.dom.processedRequestsTableWrapper?.classList.remove("d-none");
  state.dom.processedRequestsTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
           Processed decisions now render in six audit-focused columns. -->
      <td colspan="6" class="text-center text-secondary py-4">
        Loading processed leave decisions...
      </td>
    </tr>
  `;
}

function renderProcessedLeaveRequests(requests) {
  const tbody = state.dom.processedRequestsTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!requests.length) {
    state.dom.processedRequestsEmptyState?.classList.remove("d-none");
    state.dom.processedRequestsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.processedRequestsEmptyState?.classList.add("d-none");
  state.dom.processedRequestsTableWrapper?.classList.remove("d-none");

  requests.forEach((request) => {
    const row = document.createElement("tr");

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1G
    // Render processed leave decisions as audit history:
    // request identity, leave period, days, final decision, audit, and comment.
    row.innerHTML = `
      <td class="px-3 py-3 align-top">
        ${buildProcessedRequestIdentityHtml(request)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildProcessedRequestPeriodHtml(request)}
      </td>

      <td class="px-3 py-3 align-top text-center">
        <span class="badge rounded-pill text-bg-light border text-dark px-3 py-2">
          ${escapeHtml(request.total_days || "--")}
        </span>
      </td>

      <td class="px-3 py-3 align-top">
        <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1H
             Show a compact badge label while preserving the full saved
             status in title/aria-label for clarity and accessibility. -->
        <span class="badge ${getStatusBadgeClass(request.status)}"
          title="${escapeHtml(request.status || "--")}"
          aria-label="${escapeHtml(request.status || "--")}">
          ${escapeHtml(getCompactDecisionStatusLabel(request.status))}
        </span>
      </td>

      <td class="px-3 py-3 align-top">
        ${buildProcessedDecisionAuditHtml(request)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildProcessedDecisionCommentHtml(request)}
      </td>
    `;

    tbody.appendChild(row);
  });
}

function renderTeamScheduleLoadingState() {
  if (!state.dom.teamScheduleTableBody) return;

  state.dom.teamScheduleEmptyState.classList.add("d-none");
  state.dom.teamScheduleTableWrapper.classList.remove("d-none");
  state.dom.teamScheduleTableBody.innerHTML = `
    <tr>
      <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
           Team schedule now renders in four coverage-planning columns. -->
      <td colspan="5" class="text-center text-secondary py-4">
        Loading team leave schedule...
      </td>
    </tr>
  `;
}

function renderTeamLeaveSchedule(scheduleItems) {
  const tbody = state.dom.teamScheduleTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!scheduleItems.length) {
    state.dom.teamScheduleEmptyState.classList.remove("d-none");
    state.dom.teamScheduleTableWrapper.classList.add("d-none");
    return;
  }

  state.dom.teamScheduleEmptyState.classList.add("d-none");
  state.dom.teamScheduleTableWrapper.classList.remove("d-none");

  scheduleItems.forEach((item) => {
    const row = document.createElement("tr");

    // MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J
    // Render approved/current/upcoming leave as a coverage-planning view.
    // Status is intentionally not repeated because this card only shows
    // approved schedule items.
    row.innerHTML = `
      <td class="px-3 py-3 align-top">
        ${buildTeamScheduleIdentityHtml(item)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildTeamSchedulePeriodHtml(item)}
      </td>

      <td class="px-3 py-3 align-top text-center">
        <span class="badge rounded-pill text-bg-light border text-dark px-3 py-2">
          ${escapeHtml(item.total_days || "--")}
        </span>
      </td>

      <td class="px-3 py-3 align-top">
        <!-- MANAGER LEAVE APPROVAL UI CLEANUP - STEP 1J-C
             Timing is display-only and helps managers plan upcoming absence. -->
        ${buildTeamScheduleTimingHtml(item)}
      </td>

      <td class="px-3 py-3 align-top">
        ${buildTeamScheduleCoverageHtml(item)}
      </td>
    `;

    tbody.appendChild(row);
  });
}

function getDecisionStatusFromAction(action) {
  switch (action) {
    case "approve":
      return "Approved";
    case "reject":
      return "Rejected";
    case "return":
      return "Returned for Clarification";
    default:
      return "Pending Approval";
  }
}

async function handleDecisionAction(leaveId, action, buttonElement) {
  openDecisionModal(leaveId, action, buttonElement);
}

function setActionButtonLoading(buttonElement, isLoading) {
  if (!buttonElement) return;

  buttonElement.disabled = isLoading;

  if (isLoading) {
    buttonElement.dataset.originalHtml = buttonElement.innerHTML;
    buttonElement.innerHTML = `
      <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
    `;
  } else if (buttonElement.dataset.originalHtml) {
    buttonElement.innerHTML = buttonElement.dataset.originalHtml;
    delete buttonElement.dataset.originalHtml;
  }
}

async function applyApprovedLeaveToBalance(request) {
  const supabase = getSupabaseClient();

  if (!request?.employeeRecordId) {
    throw new Error(
      "Employee record could not be resolved for this leave request, so the leave balance could not be updated.",
    );
  }

  if (!request?.leave_type_id) {
    throw new Error(
      "Leave type could not be resolved for this leave request, so the leave balance could not be updated.",
    );
  }

  const approvedDays = Number(request.total_days || 0);

  if (!approvedDays || approvedDays <= 0) {
    throw new Error(
      "Approved leave days are invalid, so the leave balance could not be updated.",
    );
  }

  const { data: balanceRow, error: balanceError } = await supabase
    .from("employee_leave_balances")
    .select("id, employee_id, leave_type_id, entitled_days, used_days, remaining_days")
    .eq("employee_id", request.employeeRecordId)
    .eq("leave_type_id", request.leave_type_id)
    .maybeSingle();

  if (balanceError) throw balanceError;

  if (!balanceRow) {
    throw new Error(
      `No leave balance record exists for ${request.employeeName} under ${request.leaveTypeName}.`,
    );
  }

  const entitledDays = Number(balanceRow.entitled_days || 0);
  const usedDays = Number(balanceRow.used_days || 0);
  const remainingDays = Number(balanceRow.remaining_days || 0);

  if (remainingDays < approvedDays) {
    throw new Error(
      `${request.employeeName} does not have enough remaining ${request.leaveTypeName} balance. Remaining: ${remainingDays}, requested: ${approvedDays}.`,
    );
  }

  const nextUsedDays = usedDays + approvedDays;
  const nextRemainingDays = Math.max(entitledDays - nextUsedDays, 0);

  const { error: updateBalanceError } = await supabase
    .from("employee_leave_balances")
    .update({
      used_days: nextUsedDays,
      remaining_days: nextRemainingDays,
    })
    .eq("id", balanceRow.id);

  if (updateBalanceError) throw updateBalanceError;
}

async function persistLeaveDecision(leaveRequestId, status, comment) {
  const supabase = getSupabaseClient();

  const decisionPayload = {
    status,
    decision_at: new Date().toISOString(),
    decision_by: state.currentUser?.id || null,
    decision_by_name:
      state.currentProfile?.full_name ||
      state.currentProfile?.email ||
      state.currentUser?.email ||
      "Manager",
    decision_comment: comment || null,
  };

  // MANAGER APPROVAL WORKFLOW SMOKE TEST - STEP 1F
  // A manager decision is not complete unless the audit fields are saved.
  // Do not fall back to a status-only update, because that creates false
  // success messages and leaves Employee Leave History unable to show the
  // decision date, decision maker, or manager comment.
  const { data, error } = await supabase
    .from("leave_requests")
    .update(decisionPayload)
    .eq("id", leaveRequestId)
    .select(`
      id,
      status,
      decision_at,
      decision_by,
      decision_by_name,
      decision_comment
    `)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Leave request was not updated. This usually means the update was blocked by row-level security or the row did not match the update filter.",
    );
  }

  const expectedStatus = normalizeText(status);
  const savedStatus = normalizeText(data.status);

  if (savedStatus !== expectedStatus) {
    throw new Error(
      `Leave decision save verification failed. Expected status "${status}" but Supabase returned "${data.status || "--"}".`,
    );
  }

  const requiresAuditComment = [
    "rejected",
    "returned for clarification",
    "returned",
  ].includes(expectedStatus);

  if (!data.decision_at || !data.decision_by_name) {
    throw new Error(
      "Leave decision save verification failed. Decision audit fields were not saved.",
    );
  }

  if (requiresAuditComment && !String(data.decision_comment || "").trim()) {
    throw new Error(
      "Leave decision save verification failed. A rejection or clarification comment was required but was not saved.",
    );
  }

  return data;
}