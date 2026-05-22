// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Browser refresh can restore the previous scroll position on long Admin pages.
// Keep restoration manual so refresh always lands at the top of the restored workspace.
try {
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
} catch (error) {
  console.warn("Admin dashboard scroll restoration could not be set to manual.", error);
}
document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacheDomElements();
    bindEvents();

    const access = await window.SessionManager.protectPage("admin");

    if (!access) return;

    state.currentUser = access.session.user;
    state.currentProfile = access.profile;

    // ADMIN UI CLEANUP - STEP 1D
    // Reload the latest Admin profile so profile_image_path is available
    // before rendering the avatar/photo preview.
    await loadLatestAdminProfile();

    renderAdminProfile(state.currentProfile, access.session.user);

    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Restore the remembered Admin workspace before long company/user-access
    // refreshes continue. Fresh login still opens Profile because logout clears memory.
    restoreAdminWorkspaceAfterRefresh();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Load tenant/company records after Admin access is confirmed.
    await refreshTenantWorkspace();

    // ADMIN EMAIL SETUP - STEP 1D
    // Load Admin-owned approved validation recipients after companies are loaded,
    // because each recipient is scoped to a company workspace.
    await refreshAdminEmailSetupWorkspace();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Load profiles so Admin can manage company-scoped user access.
    await refreshProfileTenantLinkingWorkspace();

    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Workspace was already restored early. Re-assert top after async startup loads.
    forceAdminDashboardToTopAfterRefresh();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Expose tenant edit action for the Tenant Records table.
    window.adminEditTenantRecord = (tenantId) => {
      startTenantEdit(tenantId);
    };
    // ADMIN EMAIL SETUP - STEP 1D
    // Expose approved validation recipient edit action for the records table.
    window.adminEditEmailRecipientRecord = (recipientId) => {
      startAdminEmailRecipientEdit(recipientId);
    };

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Expose user access setup edit action for the records table.
    window.adminEditProfileTenantLink = (profileId) => {
      startProfileTenantLinkEdit(profileId);
    };

    // ADMIN PASSWORD RESET
    // Expose reset password action for the user access records table.
    window.adminResetUserPassword = (profileId) => {
      openResetPasswordModal(profileId);
    };
  } catch (error) {
    console.error("Error initialising admin dashboard:", error);
    showPageAlert(
      "danger",
      error.message ||
      "An unexpected error occurred while loading the admin dashboard.",
    );
  }
});

// ADMIN UI CLEANUP - STEP 1D
// Reuse the existing profile image storage bucket already used by HR profile photos.
const PROFILE_IMAGES_BUCKET = "profile-images";

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Stores only the active Admin workspace tab for refresh recovery.
// No company, user access, password reset, or profile data is stored.
const ADMIN_DASHBOARD_WORKSPACE_MEMORY_PREFIX = "hrPayroll:lastAdminWorkspace";

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Lightweight boot key used by admin-dashboard.html to avoid first-paint
// Profile flash before admin-dashboard.js completes authentication startup.
const ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY = "hrPayroll:lastAdminWorkspace:last";

const state = {
  currentUser: null,
  currentProfile: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Holds tenant/company records created by Admin.
  tenants: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Tracks the tenant currently being edited.
  currentEditingTenant: null,
  // ADMIN EMAIL SETUP - STEP 1D
  // Admin-owned approved validation recipients and company-scoped email history.
  // HR Setup > Email Integration reads these tenant-scoped recipient records.
  adminEmailSetupRecipients: [],
  adminEmailSetupLogs: [],
  currentEditingAdminEmailRecipient: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Holds user profiles for Admin access setup.
  profilesForTenantLinking: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Tracks the profile currently being edited for company access.
  currentEditingProfileTenantLink: null,

  // ADMIN UI CLEANUP - STEP 1D
  // Holds the Admin profile image selected in the browser before upload.
  pendingProfileImageFile: null,

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Stores the last clean Admin profile form values.
  // Save Profile Changes should stay grey until Admin changes an editable value.
  currentProfileEditableBaseline: null,

  // ADMIN UI CLEANUP - STEP 1H
  // Timer id for floating dashboard notification auto-hide.
  dashboardToastTimeoutId: null,

  // ADMIN PASSWORD RESET
  // Holds the profile currently targeted for a password reset.
  currentResetTarget: null,

  dom: {},
};

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Only these Admin top-level workspaces are safe to restore after refresh.
function isValidAdminWorkspaceKey(workspace = "") {
  return ["profile", "overview", "tenants"].includes(
    String(workspace || "").trim(),
  );
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Scope workspace memory to the signed-in Admin user.
// Admin is platform-level, so tenant scoping is intentionally not used here.
function getAdminWorkspaceMemoryKey() {
  const userId = String(state.currentUser?.id || "anonymous").trim();

  return `${ADMIN_DASHBOARD_WORKSPACE_MEMORY_PREFIX}:${userId}`;
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Save only the active Admin workspace key. Do not store company,
// user-access, password-reset, or profile form data in browser storage.
function rememberAdminWorkspace(workspace = "") {
  if (!isValidAdminWorkspaceKey(workspace)) return;

  try {
    sessionStorage.setItem(getAdminWorkspaceMemoryKey(), workspace);

    // Used only for first-paint HTML restore before currentUser/currentProfile
    // is available to admin-dashboard.js.
    sessionStorage.setItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY, workspace);
  } catch (error) {
    console.warn("Admin workspace memory could not be saved.", error);
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Read the remembered Admin workspace for this browser session.
// Fresh login naturally falls back to Profile after logout clears the keys.
function getRememberedAdminWorkspace() {
  try {
    const scopedWorkspace = sessionStorage.getItem(getAdminWorkspaceMemoryKey());
    const bootWorkspace = sessionStorage.getItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY);
    const workspace = scopedWorkspace || bootWorkspace || "profile";

    return isValidAdminWorkspaceKey(workspace) ? workspace : "profile";
  } catch (error) {
    console.warn("Admin workspace memory could not be read.", error);
    return "profile";
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Logout must reset the next Admin session to Profile.
function clearRememberedAdminWorkspace() {
  try {
    sessionStorage.removeItem(getAdminWorkspaceMemoryKey());
    sessionStorage.removeItem(ADMIN_DASHBOARD_WORKSPACE_BOOT_KEY);
  } catch (error) {
    console.warn("Admin workspace memory could not be cleared.", error);
  }
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Force refresh restore to the top without smooth scrolling.
function forceAdminDashboardToTopAfterRefresh() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  updateBackToTopButtonVisibility();
}

// ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
// Restore the remembered Admin workspace and force the page to the top.
// Multiple calls protect against browser scroll restoration on long Admin pages.
function restoreAdminWorkspaceAfterRefresh() {
  const workspace = getRememberedAdminWorkspace();

  switchAdminWorkspace(workspace);
  forceAdminDashboardToTopAfterRefresh();

  window.requestAnimationFrame(() => {
    forceAdminDashboardToTopAfterRefresh();

    window.requestAnimationFrame(() => {
      forceAdminDashboardToTopAfterRefresh();
    });
  });

  window.setTimeout(forceAdminDashboardToTopAfterRefresh, 0);
  window.setTimeout(forceAdminDashboardToTopAfterRefresh, 150);
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

    // ADMIN UI CLEANUP - STEP 1H
    // Floating Admin UX controls copied from the HR dashboard pattern.
    backToTopBtn: document.getElementById("backToTopBtn"),
    dashboardToast: document.getElementById("dashboardToast"),
    dashboardToastAccent: document.getElementById("dashboardToastAccent"),
    dashboardToastIcon: document.getElementById("dashboardToastIcon"),
    dashboardToastTitle: document.getElementById("dashboardToastTitle"),
    dashboardToastMessage: document.getElementById("dashboardToastMessage"),
    dashboardToastCloseBtn: document.getElementById("dashboardToastCloseBtn"),

    adminTabProfileBtn: document.getElementById("adminTabProfileBtn"),
    adminTabOverviewBtn: document.getElementById("adminTabOverviewBtn"),


    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Tenant workspace tab and section.
    adminTabTenantsBtn: document.getElementById("adminTabTenantsBtn"),

    adminProfileSection: document.getElementById("adminProfileSection"),
    adminOverviewSection: document.getElementById("adminOverviewSection"),

    adminTenantsSection: document.getElementById("adminTenantsSection"),

    // ADMIN UI CLEANUP - STEP 1I
    // Collapse controls for long Admin Company Setup panels.
    toggleAdminCompanyIdentityCardBtn: document.getElementById("toggleAdminCompanyIdentityCardBtn"),
    adminCompanyIdentityCollapse: document.getElementById("adminCompanyIdentityCollapse"),
    toggleAdminUserCompanyAssignmentCardBtn: document.getElementById("toggleAdminUserCompanyAssignmentCardBtn"),
    adminUserCompanyAssignmentCollapse: document.getElementById("adminUserCompanyAssignmentCollapse"),

    adminInitials: document.getElementById("adminInitials"),

    // ADMIN UI CLEANUP - STEP 1D
    // Hero profile image used when Admin uploads a profile photo.
    adminHeroImage: document.getElementById("adminHeroImage"),

    adminEmail: document.getElementById("adminEmail"),
    adminRole: document.getElementById("adminRole"),
    adminModuleValue: document.getElementById("adminModuleValue"),

    adminFullName: document.getElementById("adminFullName"),
    adminEmailTile: document.getElementById("adminEmailTile"),
    adminRoleTile: document.getElementById("adminRoleTile"),
    adminDepartment: document.getElementById("adminDepartment"),

    // ADMIN UI CLEANUP - STEP 1E
    // Admin Overview summary values are calculated from already-loaded
    // company and user/company assignment data.
    adminOverviewCompanyCount: document.getElementById("adminOverviewCompanyCount"),
    adminOverviewActiveCompanyCount: document.getElementById("adminOverviewActiveCompanyCount"),
    adminOverviewLinkedUserCount: document.getElementById("adminOverviewLinkedUserCount"),
    adminOverviewUnlinkedUserCount: document.getElementById("adminOverviewUnlinkedUserCount"),

    // ADMIN UI CLEANUP - STEP 1G
    // Access-health panel shown on the Admin Overview tab.
    adminOverviewAccessHealthPanel: document.getElementById("adminOverviewAccessHealthPanel"),
    adminOverviewAccessHealthTitle: document.getElementById("adminOverviewAccessHealthTitle"),
    adminOverviewAccessHealthMessage: document.getElementById("adminOverviewAccessHealthMessage"),
    adminOverviewOpenCompaniesBtn: document.getElementById("adminOverviewOpenCompaniesBtn"),

    adminProfileAvatar: document.getElementById("adminProfileAvatar"),
    adminProfileCardName: document.getElementById("adminProfileCardName"),
    adminProfileCardEmail: document.getElementById("adminProfileCardEmail"),

    // ADMIN UI CLEANUP - STEP 1D
    // Admin profile image upload controls.
    adminProfileImageInput: document.getElementById("adminProfileImageInput"),
    adminProfileImagePreview: document.getElementById("adminProfileImagePreview"),
    saveAdminProfileImageBtn: document.getElementById("saveAdminProfileImageBtn"),

    adminProfileForm: document.getElementById("adminProfileForm"),
    adminProfileFullName: document.getElementById("adminProfileFullName"),
    adminProfileEmail: document.getElementById("adminProfileEmail"),
    adminProfileRole: document.getElementById("adminProfileRole"),
    adminProfileDepartment: document.getElementById("adminProfileDepartment"),
    saveAdminProfileBtn: document.getElementById("saveAdminProfileBtn"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Tenant / Company setup form and records table.
    tenantCreateForm: document.getElementById("tenantCreateForm"),
    editingTenantId: document.getElementById("editingTenantId"),
    tenantCompanyName: document.getElementById("tenantCompanyName"),
    tenantCode: document.getElementById("tenantCode"),
    tenantStatus: document.getElementById("tenantStatus"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
    // Notes was removed from the first tenant setup UI to keep the feature lean.
    saveTenantBtn: document.getElementById("saveTenantBtn"),
    saveTenantBtnText: document.getElementById("saveTenantBtnText"),
    cancelTenantEditBtn: document.getElementById("cancelTenantEditBtn"),
    refreshTenantsBtn: document.getElementById("refreshTenantsBtn"),
    tenantRecordsHeader: document.getElementById("tenantRecordsHeader"),
    tenantRecordsEmptyState: document.getElementById("tenantRecordsEmptyState"),
    tenantRecordsTableWrapper: document.getElementById("tenantRecordsTableWrapper"),
    tenantRecordsTableBody: document.getElementById("tenantRecordsTableBody"),
    // ADMIN EMAIL SETUP - STEP 1D
    // Admin controls company-scoped validation recipients used by HR Email Integration.
    toggleAdminEmailSetupCardBtn: document.getElementById("toggleAdminEmailSetupCardBtn"),
    adminEmailSetupCollapse: document.getElementById("adminEmailSetupCollapse"),
    adminEmailRecipientCountValue: document.getElementById("adminEmailRecipientCountValue"),
    adminEmailActiveRecipientCountValue: document.getElementById("adminEmailActiveRecipientCountValue"),
    adminEmailDeliveryLogCountValue: document.getElementById("adminEmailDeliveryLogCountValue"),
    adminEmailLastResultValue: document.getElementById("adminEmailLastResultValue"),
    adminEmailRecipientForm: document.getElementById("adminEmailRecipientForm"),
    editingAdminEmailRecipientId: document.getElementById("editingAdminEmailRecipientId"),
    adminEmailSetupCompanyId: document.getElementById("adminEmailSetupCompanyId"),
    adminEmailRecipientDisplayName: document.getElementById("adminEmailRecipientDisplayName"),
    adminEmailRecipientEmail: document.getElementById("adminEmailRecipientEmail"),
    adminEmailRecipientStatus: document.getElementById("adminEmailRecipientStatus"),
    saveAdminEmailRecipientBtn: document.getElementById("saveAdminEmailRecipientBtn"),
    saveAdminEmailRecipientBtnText: document.getElementById("saveAdminEmailRecipientBtnText"),
    cancelAdminEmailRecipientEditBtn: document.getElementById("cancelAdminEmailRecipientEditBtn"),
    refreshAdminEmailSetupBtn: document.getElementById("refreshAdminEmailSetupBtn"),
    adminEmailRecipientsHeader: document.getElementById("adminEmailRecipientsHeader"),
    adminEmailRecipientsEmptyState: document.getElementById("adminEmailRecipientsEmptyState"),
    adminEmailRecipientsTableWrapper: document.getElementById("adminEmailRecipientsTableWrapper"),
    adminEmailRecipientsTableBody: document.getElementById("adminEmailRecipientsTableBody"),
    adminEmailDeliveryLogsEmptyState: document.getElementById("adminEmailDeliveryLogsEmptyState"),
    adminEmailDeliveryLogsTableWrapper: document.getElementById("adminEmailDeliveryLogsTableWrapper"),
    adminEmailDeliveryLogsTableBody: document.getElementById("adminEmailDeliveryLogsTableBody"),

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Platform Admin invites a company-scoped HR/payroll/manager/employee user
    // into a selected company workspace through the secure invite-company-user
    // Edge Function. This does not create employee records.
    companyUserInviteForm: document.getElementById("companyUserInviteForm"),
    companyUserFullName: document.getElementById("companyUserFullName"),
    companyUserEmail: document.getElementById("companyUserEmail"),
    companyUserRole: document.getElementById("companyUserRole"),
    companyUserTenantId: document.getElementById("companyUserTenantId"),
    companyUserInviteAlert: document.getElementById("companyUserInviteAlert"),
    inviteCompanyUserBtn: document.getElementById("inviteCompanyUserBtn"),
    inviteCompanyUserBtnText: document.getElementById("inviteCompanyUserBtnText"),
    clearCompanyUserInviteBtn: document.getElementById("clearCompanyUserInviteBtn"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // User access setup controls.
    profileTenantLinkForm: document.getElementById("profileTenantLinkForm"),
    editingProfileTenantLinkProfileId: document.getElementById("editingProfileTenantLinkProfileId"),
    profileTenantProfileId: document.getElementById("profileTenantProfileId"),
    profileTenantTenantId: document.getElementById("profileTenantTenantId"),
    saveProfileTenantLinkBtn: document.getElementById("saveProfileTenantLinkBtn"),
    saveProfileTenantLinkBtnText: document.getElementById("saveProfileTenantLinkBtnText"),
    cancelProfileTenantLinkEditBtn: document.getElementById("cancelProfileTenantLinkEditBtn"),
    refreshProfileTenantLinksBtn: document.getElementById("refreshProfileTenantLinksBtn"),
    profileTenantLinksHeader: document.getElementById("profileTenantLinksHeader"),
    profileTenantLinksEmptyState: document.getElementById("profileTenantLinksEmptyState"),
    profileTenantLinksTableWrapper: document.getElementById("profileTenantLinksTableWrapper"),
    profileTenantLinksTableBody: document.getElementById("profileTenantLinksTableBody"),

    // ADMIN PASSWORD RESET
    // Modal controls for the admin-initiated temporary password flow.
    resetPasswordModal: document.getElementById("resetPasswordModal"),
    resetPasswordTargetName: document.getElementById("resetPasswordTargetName"),
    resetPasswordTargetEmail: document.getElementById("resetPasswordTargetEmail"),
    resetPasswordTempInput: document.getElementById("resetPasswordTempInput"),
    resetPasswordToggleBtn: document.getElementById("resetPasswordToggleBtn"),
    resetPasswordToggleIcon: document.getElementById("resetPasswordToggleIcon"),
    resetPasswordSubmitBtn: document.getElementById("resetPasswordSubmitBtn"),
    resetPasswordAlert: document.getElementById("resetPasswordAlert"),
  };
}

function setAdminActionButtonLoading(button, isLoading, loadingText = "Working...") {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    if (!button.dataset.originalClass) {
      button.dataset.originalClass = button.className;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      ${loadingText}
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  button.disabled = false;
  button.className = button.dataset.originalClass || "btn btn-outline-primary dashboard-action-btn";
  delete button.dataset.originalClass;
}

function updateBackToTopButtonVisibility() {
  const button = state.dom.backToTopBtn;
  if (!button) return;

  // ADMIN UI CLEANUP - STEP 1H
  // Show the shortcut only after Admin has scrolled down.
  const shouldShow = window.scrollY > 420;
  button.classList.toggle("d-none", !shouldShow);
}

function scrollDashboardBackToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function hideDashboardToast() {
  state.dom.dashboardToast?.classList.add("d-none");

  if (state.dashboardToastTimeoutId) {
    window.clearTimeout(state.dashboardToastTimeoutId);
    state.dashboardToastTimeoutId = null;
  }
}

function showDashboardToast(type = "info", title = "Notification", message = "") {
  const toast = state.dom.dashboardToast;
  if (!toast) return;

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

  if (state.dom.dashboardToastAccent) {
    state.dom.dashboardToastAccent.className = theme.accentClass;
    state.dom.dashboardToastAccent.style.height = "4px";
  }

  if (state.dom.dashboardToastIcon) {
    state.dom.dashboardToastIcon.className =
      `rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 ${theme.iconClass}`;
    state.dom.dashboardToastIcon.style.width = "36px";
    state.dom.dashboardToastIcon.style.height = "36px";
    state.dom.dashboardToastIcon.innerHTML = theme.iconHtml;
  }

  if (state.dom.dashboardToastTitle) {
    state.dom.dashboardToastTitle.textContent = title;
  }

  if (state.dom.dashboardToastMessage) {
    state.dom.dashboardToastMessage.textContent = message || "";
  }

  toast.classList.remove("d-none");

  window.clearTimeout(state.dashboardToastTimeoutId);

  state.dashboardToastTimeoutId = window.setTimeout(() => {
    hideDashboardToast();
  }, 8000);
}

function bindAdminCardCollapseToggle(button, panel) {
  if (!button || !panel) return;

  button.addEventListener("click", () => {
    const isNowHidden = panel.classList.toggle("d-none");
    button.setAttribute("aria-expanded", String(!isNowHidden));

    const icon = button.querySelector("i");
    const label = button.querySelector("span");

    if (icon) {
      icon.className = isNowHidden
        ? "bi bi-chevron-down me-2"
        : "bi bi-chevron-up me-2";
    }

    if (label) {
      label.textContent = isNowHidden ? "Expand" : "Collapse";
    }
  });

  const card = button.closest(".border");

  if (!card) return;

  // ADMIN UI CLEANUP - STEP 1K RECOVERY
  // Double-clicking a card closes it, but form controls and tables must not
  // accidentally collapse while Admin is editing or selecting records.
  card.addEventListener("dblclick", (event) => {
    const interactiveTarget = event.target.closest(
      "input, select, textarea, button, a, label, table",
    );

    if (interactiveTarget) return;

    const isExpanded = !panel.classList.contains("d-none");

    if (isExpanded) {
      setAdminDashboardCardExpanded(button, panel, false);
    }
  });
}

function setAdminDashboardCardExpanded(button, panel, shouldExpand) {
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

function openAdminCompanyIdentityPanel() {
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    true,
  );
}

function openAdminCompanyRecordsPanel() {
  // ADMIN UI CLEANUP - STEP 1K RECOVERY
  // Company Records now live inside the main Company Setup card,
  // so opening records means opening the Company Setup collapse panel.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    true,
  );
}

function openAdminUserCompanyAssignmentPanel() {
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
    true,
  );
}

function collapseAdminDashboardWorkingCardsByDefault() {
  // ADMIN UI CLEANUP - STEP 1K RECOVERY
  // Match HR behaviour: long Admin working panels start collapsed by default.
  // Company Identity and Company Records are now one combined setup card.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    false,
  );

  setAdminDashboardCardExpanded(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
    false,
  );
  // ADMIN EMAIL SETUP - STEP 1D
  // Start Email Setup collapsed so Company Setup remains scan-friendly.
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    false,
  );
}

function scrollToAdminDashboardTarget(target, offset = 96) {
  if (!target) return;

  const targetTop =
    target.getBoundingClientRect().top + window.pageYOffset - offset;

  window.scrollTo({
    top: Math.max(targetTop, 0),
    behavior: "smooth",
  });
}

function redirectToAdminCompanyRecordsAfterSave() {
  // ADMIN UI CLEANUP - STEP 1J
  // After company create/update, open the records panel and land on the
  // Company Records header without cutting it off.
  // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
  // Programmatic navigation to Companies should also survive refresh.
  rememberAdminWorkspace("tenants");
  switchAdminWorkspace("tenants");
  openAdminCompanyRecordsPanel();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      openAdminCompanyRecordsPanel();

      // ADMIN UI CLEANUP - STEP 1L
      // Company Records now lives inside the Company Identity card.
      // Removed stale adminCompanyRecordsCollapse fallback.
      scrollToAdminDashboardTarget(
        state.dom.tenantRecordsHeader ||
        state.dom.tenantRecordsTableWrapper ||
        state.dom.adminCompanyIdentityCollapse,
        96,
      );
    });
  });
}

function scrollToAdminOpenedPanel(button, panel, offset = 150) {
  // ADMIN UI CLEANUP - STEP 1K
  // Scroll to the full card/panel wrapper so the panel header is visible
  // instead of landing halfway inside the form.
  const target =
    button?.closest(".border") ||
    panel ||
    button;

  if (!target) return;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollToAdminDashboardTarget(target, offset);
    });
  });
}

function focusAdminFieldWithoutJump(field) {
  // ADMIN UI CLEANUP - STEP 1K
  // Focus the editable field without allowing browser focus to override
  // our clean panel-level scroll position.
  if (!field) return;

  try {
    field.focus({ preventScroll: true });
  } catch (error) {
    field.focus();
  }
}

function redirectToAdminUserCompanyLinksAfterSave() {
  // ADMIN UI CLEANUP - STEP 1J
  // After user/company link save, open the assignment panel and land on
  // User Company Links without cutting the header.
  // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
  // Programmatic navigation to Companies should also survive refresh.
  rememberAdminWorkspace("tenants");
  switchAdminWorkspace("tenants");
  openAdminUserCompanyAssignmentPanel();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      openAdminUserCompanyAssignmentPanel();

      scrollToAdminDashboardTarget(
        state.dom.profileTenantLinksHeader ||
        state.dom.profileTenantLinksTableWrapper ||
        state.dom.adminUserCompanyAssignmentCollapse,
        96,
      );
    });
  });
}

function bindEvents() {
  state.dom.logoutBtn?.addEventListener("click", async () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Logout must reset the next Admin session to Profile.
    clearRememberedAdminWorkspace();

    await window.SessionManager.logoutUser("logout");
  });

  // ADMIN UI CLEANUP - STEP 1H
  // Back to Top and floating notification close behaviour.
  state.dom.backToTopBtn?.addEventListener("click", () => {
    scrollDashboardBackToTop();
  });

  // ADMIN UI CLEANUP - STEP 1I
  // Bind collapse controls for long Admin Company Setup panels.
  bindAdminCardCollapseToggle(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
  );

  bindAdminCardCollapseToggle(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
  );

  // ADMIN EMAIL SETUP - STEP 1D
  // Email Setup follows the same Admin collapse behaviour as Company Identity
  // and User Access Setup.
  bindAdminCardCollapseToggle(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
  );

  collapseAdminDashboardWorkingCardsByDefault();

  state.dom.dashboardToastCloseBtn?.addEventListener("click", () => {
    hideDashboardToast();
  });

  window.addEventListener("scroll", updateBackToTopButtonVisibility);
  updateBackToTopButtonVisibility();

  state.dom.adminTabProfileBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Profile only for refresh in the current browser session.
    rememberAdminWorkspace("profile");
    switchAdminWorkspace("profile");
  });

  state.dom.adminTabOverviewBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Overview only for refresh. No overview data is stored.
    rememberAdminWorkspace("overview");
    switchAdminWorkspace("overview");
  });

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Open tenant/company setup workspace.
  state.dom.adminTabTenantsBtn?.addEventListener("click", () => {
    // ADMIN DASHBOARD WORKSPACE MEMORY - STEP 1A
    // Remember Companies only for refresh. No company or user-access data is stored.
    rememberAdminWorkspace("tenants");
    switchAdminWorkspace("tenants");
  });


  // ADMIN UI CLEANUP - STEP 1G
  // Let Admin jump from Overview access-health message to Company/User assignment.
  state.dom.adminOverviewOpenCompaniesBtn?.addEventListener("click", () => {
    // ADMIN UI CLEANUP - STEP 1J FINAL POLISH
    // From Overview, Open Companies should land directly on opened Company Records,
    // not just switch to the Companies tab with all panels collapsed.
    redirectToAdminCompanyRecordsAfterSave();
  });

  state.dom.tenantCreateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveTenantRecord();
  });

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
  // Only the required tenant setup fields control save readiness.
  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
  // Reset only the fields still used by the lean tenant setup form.
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
  ].forEach((field) => {
    field?.addEventListener("input", updateTenantSaveButtonState);
    field?.addEventListener("change", updateTenantSaveButtonState);
  });

  state.dom.cancelTenantEditBtn?.addEventListener("click", () => {
    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // Cancel should only exit edit mode. Successful save handles redirect-to-records.
    resetTenantForm();
    showPageAlert("info", "Company edit was cancelled.");
  });

  state.dom.refreshTenantsBtn?.addEventListener("click", async () => {
    // ADMIN UI CLEANUP - STEP 1F
    // Give Admin visible feedback while company records reload.
    // Existing refresh logic is unchanged.
    try {
      setAdminActionButtonLoading(
        state.dom.refreshTenantsBtn,
        true,
        "Refreshing Companies...",
      );

      await refreshTenantWorkspace();

      // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
      // Keep the tenant assignment dropdown current after tenant refresh.
      populateProfileTenantTenantOptions();

      // ADMIN EMAIL SETUP - STEP 1D
      // Keep Email Setup company selector and records current after company refresh.
      populateAdminEmailSetupCompanyOptions();
      await refreshAdminEmailSetupWorkspace({ preserveCompany: true });
    } finally {
      setAdminActionButtonLoading(state.dom.refreshTenantsBtn, false);
    }
  });

  // ADMIN EMAIL SETUP - STEP 1D-2
  // Bind Email Setup directly during page startup.
  // This must not sit inside the company-user invite submit handler,
  // otherwise the Add Approved Recipient button will never turn blue
  // until an unrelated invite form is submitted.
  state.dom.adminEmailRecipientForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAdminEmailRecipient();
  });

  [
    state.dom.adminEmailSetupCompanyId,
    state.dom.adminEmailRecipientDisplayName,
    state.dom.adminEmailRecipientEmail,
    state.dom.adminEmailRecipientStatus,
  ].forEach((field) => {
    field?.addEventListener("input", updateAdminEmailRecipientSaveButtonState);
    field?.addEventListener("keyup", updateAdminEmailRecipientSaveButtonState);
    field?.addEventListener("blur", updateAdminEmailRecipientSaveButtonState);

    field?.addEventListener("change", async () => {
      updateAdminEmailRecipientSaveButtonState();

      if (field === state.dom.adminEmailSetupCompanyId) {
        await refreshAdminEmailSetupWorkspace({ preserveCompany: true });
        updateAdminEmailRecipientSaveButtonState();
      }
    });
  });

  state.dom.cancelAdminEmailRecipientEditBtn?.addEventListener("click", () => {
    resetAdminEmailRecipientForm({ preserveCompany: true });
    showPageAlert("info", "Approved validation recipient edit was cancelled.");
  });

  state.dom.refreshAdminEmailSetupBtn?.addEventListener("click", async () => {
    await refreshAdminEmailSetupWorkspace({
      showAlert: true,
      preserveCompany: true,
    });
  });

  window.requestAnimationFrame(() => {
    updateAdminEmailRecipientSaveButtonState();
  });

  // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
  // Invite a company-scoped user directly from Admin.
  // This is for first HR/payroll/company access setup after a company is created.
  state.dom.companyUserInviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await inviteCompanyUser();
  });

  [
    state.dom.companyUserFullName,
    state.dom.companyUserEmail,
    state.dom.companyUserRole,
    state.dom.companyUserTenantId,
  ].forEach((field) => {
    field?.addEventListener("input", updateCompanyUserInviteButtonState);
    field?.addEventListener("change", updateCompanyUserInviteButtonState);
  });

  state.dom.clearCompanyUserInviteBtn?.addEventListener("click", () => {
    resetCompanyUserInviteForm();
    showCompanyUserInviteAlert("info", "Company user invite form cleared.");
  });

  state.dom.profileTenantLinkForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveProfileTenantLink();
  });

  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    field?.addEventListener("input", updateProfileTenantLinkSaveButtonState);
    field?.addEventListener("change", updateProfileTenantLinkSaveButtonState);
  });

  state.dom.cancelProfileTenantLinkEditBtn?.addEventListener("click", () => {
    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // Cancel should only exit edit mode. Successful save handles redirect-to-records.
    resetProfileTenantLinkForm();
    showPageAlert("info", "User access setup edit was cancelled.");
  });

  state.dom.refreshProfileTenantLinksBtn?.addEventListener("click", async () => {
    // ADMIN UI CLEANUP - STEP 1F
    // Give Admin visible feedback while user/company links reload.
    // Existing profile-link refresh logic is unchanged.
    try {
      setAdminActionButtonLoading(
        state.dom.refreshProfileTenantLinksBtn,
        true,
        "Refreshing Access Records...",
      );

      await refreshProfileTenantLinkingWorkspace();
    } finally {
      setAdminActionButtonLoading(state.dom.refreshProfileTenantLinksBtn, false);
    }
  });

  state.dom.adminProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAdminOwnProfile();
  });

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Keep Save Profile Changes grey until Admin edits the editable profile fields.
  [
    state.dom.adminProfileFullName,
    state.dom.adminProfileDepartment,
  ].forEach((field) => {
    field?.addEventListener("input", updateAdminProfileSaveButtonState);
    field?.addEventListener("change", updateAdminProfileSaveButtonState);
  });

  // ADMIN UI CLEANUP - STEP 1D
  // Match HR profile photo behaviour: validate on file selection, then upload on button click.
  state.dom.adminProfileImageInput?.addEventListener("change", (event) => {
    handlePendingAdminProfileImage(event.target.files?.[0] || null);
  });

  state.dom.saveAdminProfileImageBtn?.addEventListener("click", async () => {
    await saveAdminProfileImage();
  });

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Start the upload button greyed out until a valid file is selected.
  updateAdminProfileImageSaveButtonState();

  // ADMIN PASSWORD RESET — modal event bindings.
  state.dom.resetPasswordTempInput?.addEventListener("input", () => {
    updateResetPasswordSubmitButtonState();
    clearResetPasswordAlert();
  });

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Toggle visual masking only. The field remains type="text" to avoid
  // browser password-manager overlays inside the Admin reset modal.
  state.dom.resetPasswordToggleBtn?.addEventListener("click", () => {
    const isCurrentlyVisible =
      state.dom.resetPasswordTempInput?.dataset?.passwordVisible === "true";

    setResetPasswordVisibility(!isCurrentlyVisible);
  });

  state.dom.resetPasswordSubmitBtn?.addEventListener("click", async () => {
    await submitPasswordReset();
  });

  // Clear temp password when modal closes so it does not linger.
  state.dom.resetPasswordModal?.addEventListener("hidden.bs.modal", () => {
    clearResetPasswordModal();
  });
}

function renderAdminOverviewSummary() {
  const companies = Array.isArray(state.tenants) ? state.tenants : [];
  const profiles = Array.isArray(state.profilesForTenantLinking)
    ? state.profilesForTenantLinking
    : [];

  // ADMIN UI CLEANUP - STEP 1E
  // Overview is display-only. It uses data already loaded for Company Setup
  // and User Access Setup, so no extra database calls are introduced here.
  const totalCompanies = companies.length;
  const activeCompanies = companies.filter(
    (company) => String(company.status || "").toLowerCase() === "active",
  ).length;

  const linkedUsers = profiles.filter(
    (profile) => String(profile.tenant_id || "").trim(),
  ).length;

  const unlinkedUsers = Math.max(profiles.length - linkedUsers, 0);

  if (state.dom.adminOverviewCompanyCount) {
    state.dom.adminOverviewCompanyCount.textContent = totalCompanies;
  }

  if (state.dom.adminOverviewActiveCompanyCount) {
    state.dom.adminOverviewActiveCompanyCount.textContent = activeCompanies;
  }

  if (state.dom.adminOverviewLinkedUserCount) {
    state.dom.adminOverviewLinkedUserCount.textContent = linkedUsers;
  }

  if (state.dom.adminOverviewUnlinkedUserCount) {
    state.dom.adminOverviewUnlinkedUserCount.textContent = unlinkedUsers;
  }

  // ADMIN UI CLEANUP - STEP 1G
  // Give Admin a plain-language status for company-scoped user access readiness.
  if (state.dom.adminOverviewAccessHealthPanel) {
    const hasProfiles = profiles.length > 0;
    const hasUnlinkedUsers = unlinkedUsers > 0;

    state.dom.adminOverviewAccessHealthPanel.className = hasUnlinkedUsers
      ? "alert alert-warning border mt-4 mb-0"
      : "alert alert-success border mt-4 mb-0";

    if (state.dom.adminOverviewAccessHealthTitle) {
      state.dom.adminOverviewAccessHealthTitle.textContent = hasUnlinkedUsers
        ? "Some users still need company access"
        : "User company access is fully linked";
    }

    if (state.dom.adminOverviewAccessHealthMessage) {
      state.dom.adminOverviewAccessHealthMessage.textContent = !hasProfiles
        ? "No user profiles are currently available for access setup."
        : hasUnlinkedUsers
          ? `${unlinkedUsers} user profile(s) do not have company workspace access yet. Open Companies to complete access setup.`
          : "All available user profiles have company workspace access.";
    }
  }
}

function switchAdminWorkspace(workspace) {
  const isProfile = workspace === "profile";
  const isOverview = workspace === "overview";
  const isTenants = workspace === "tenants";

  // ADMIN AUDIT CENTRE REMOVAL
  // Admin is platform-level across multiple companies. The central Audit Centre
  // has been removed to avoid company-wide notification overload.
  state.dom.adminProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.adminOverviewSection?.classList.toggle("d-none", !isOverview);
  state.dom.adminTenantsSection?.classList.toggle("d-none", !isTenants);

  if (state.dom.adminTabProfileBtn) {
    state.dom.adminTabProfileBtn.className = isProfile
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.adminTabOverviewBtn) {
    state.dom.adminTabOverviewBtn.className = isOverview
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.adminTabTenantsBtn) {
    state.dom.adminTabTenantsBtn.className = isTenants
      ? "btn btn-primary dashboard-action-btn text-nowrap"
      : "btn btn-outline-primary dashboard-action-btn text-nowrap";
  }

  if (state.dom.adminModuleValue) {
    state.dom.adminModuleValue.textContent = isProfile
      ? "Profile"
      : isOverview
        ? "Overview"
        : "Company Setup";
  }
}

function getInitials(fullName, fallback = "AD") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return fallback;

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function showPageAlert(type, message) {
  if (!state.dom.pageAlert) return;

  state.dom.pageAlert.className = `alert alert-${type} mb-4`;
  state.dom.pageAlert.textContent = message;
  state.dom.pageAlert.classList.remove("d-none");
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
// Simple HTML escaping for tenant records rendered into table rows.
function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function getTenantStatusBadgeClass(status = "") {
  return String(status || "").toLowerCase() === "active"
    ? "text-bg-success"
    : "text-bg-secondary";
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
// Tenant ID is a login code, so keep it clean and consistent.
function normaliseTenantCode(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isTenantCodeValid(value = "") {
  return /^[A-Z0-9_-]{2,40}$/.test(normaliseTenantCode(value));
}

function updateTenantSaveButtonState() {
  const canSubmit = Boolean(
    String(state.dom.tenantCompanyName?.value || "").trim() &&
    isTenantCodeValid(state.dom.tenantCode?.value || "") &&
    String(state.dom.tenantStatus?.value || "").trim(),
  );

  const button = state.dom.saveTenantBtn;
  if (!button) return;

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearTenantValidationState() {
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
    state.dom.tenantStatus,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateTenantForm() {
  clearTenantValidationState();

  const companyName = String(state.dom.tenantCompanyName?.value || "").trim();
  const tenantCode = normaliseTenantCode(state.dom.tenantCode?.value || "");
  const status = String(state.dom.tenantStatus?.value || "").trim();

  if (!companyName) {
    state.dom.tenantCompanyName?.classList.add("is-invalid");
    showPageAlert("warning", "Company name is required before creating a company.");
    state.dom.tenantCompanyName?.focus();
    return false;
  }

  if (!tenantCode || !isTenantCodeValid(tenantCode)) {
    state.dom.tenantCode?.classList.add("is-invalid");
    showPageAlert(
      "warning",
      "Tenant ID / Company ID must be 2-40 characters and can only contain letters, numbers, hyphen, or underscore.",
    );
    state.dom.tenantCode?.focus();
    return false;
  }

  if (!status) {
    state.dom.tenantStatus?.classList.add("is-invalid");
    showPageAlert("warning", "Company status is required.");
    state.dom.tenantStatus?.focus();
    return false;
  }

  return true;
}

function buildTenantPayload() {
  return {
    company_name: String(state.dom.tenantCompanyName?.value || "").trim(),
    tenant_code: normaliseTenantCode(state.dom.tenantCode?.value || ""),
    status: String(state.dom.tenantStatus?.value || "Active").trim(),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
    // Notes is not collected in the first tenant setup UI.
    // Keep saved payload focused on login segmentation fields only.
    created_by: state.currentUser?.id || null,
    updated_by: state.currentUser?.id || null,
  };
}

function setTenantSaveLoading(isLoading) {
  const button = state.dom.saveTenantBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Company...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();
}

function resetTenantForm() {
  state.currentEditingTenant = null;

  if (state.dom.editingTenantId) {
    state.dom.editingTenantId.value = "";
  }

  // ADMIN UI CLEANUP - STEP 1L
  // Only reset fields that still exist in the current Company Identity form.
  [
    state.dom.tenantCompanyName,
    state.dom.tenantCode,
  ].forEach((field) => {
    if (field) {
      field.value = "";
      field.classList.remove("is-invalid");
    }
  });

  if (state.dom.tenantStatus) {
    state.dom.tenantStatus.value = "Active";
    state.dom.tenantStatus.classList.remove("is-invalid");
  }

  state.dom.cancelTenantEditBtn?.classList.add("d-none");

  if (state.dom.saveTenantBtn) {
    state.dom.saveTenantBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveTenantBtnText">Create Company</span>
    `;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();
}

function renderTenantRecordsLoadingState() {
  if (!state.dom.tenantRecordsTableBody) return;

  state.dom.tenantRecordsEmptyState?.classList.add("d-none");
  state.dom.tenantRecordsTableWrapper?.classList.remove("d-none");

  state.dom.tenantRecordsTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="text-center text-secondary py-4">
        Loading company records.
      </td>
    </tr>
  `;
}

function renderTenantRecords(records = []) {
  const tbody = state.dom.tenantRecordsTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!records.length) {
    state.dom.tenantRecordsEmptyState?.classList.remove("d-none");
    state.dom.tenantRecordsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.tenantRecordsEmptyState?.classList.add("d-none");
  state.dom.tenantRecordsTableWrapper?.classList.remove("d-none");

  records.forEach((record) => {
    const row = document.createElement("tr");

    row.innerHTML = `
<td>
  <!-- HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1D
       Tenant Records show only the core company name for the first version. -->
  <div class="fw-semibold">${escapeHtml(record.company_name || "--")}</div>
</td>

      <td>
        <span class="badge rounded-pill text-bg-light border">
          ${escapeHtml(record.tenant_code || "--")}
        </span>
      </td>

      <td>
        <span class="badge ${getTenantStatusBadgeClass(record.status)}">
          ${escapeHtml(record.status || "--")}
        </span>
      </td>

      <td class="text-nowrap">${formatDate(record.updated_at || record.created_at)}</td>

      <td class="text-center">
        <!-- HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
             Edit existing tenant/company setup without creating duplicates. -->
        <button
          type="button"
          class="btn btn-sm btn-outline-primary"
          title="Edit company"
          onclick="window.adminEditTenantRecord('${escapeHtml(record.id)}')"
        >
          <i class="bi bi-pencil-square"></i>
        </button>
      </td>
    `;

    tbody.appendChild(row);
  });
}

async function refreshTenantWorkspace() {
  renderTenantRecordsLoadingState();

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("tenants")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) throw error;

    state.tenants = Array.isArray(data) ? data : [];
    renderTenantRecords(state.tenants);
    updateTenantSaveButtonState();

    // ADMIN UI CLEANUP - STEP 1E
    // Keep Overview company counts in sync after tenant/company refresh.
    renderAdminOverviewSummary();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Keep tenant assignment dropdown in sync with saved tenant records.
    populateProfileTenantTenantOptions();

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Keep the company invite dropdown in sync with active company records.
    populateCompanyUserTenantOptions();
    // ADMIN EMAIL SETUP - STEP 1D
    // Keep the Email Setup company dropdown in sync with active company records.
    populateAdminEmailSetupCompanyOptions();
  } catch (error) {
    console.error("Error loading tenant records:", error);
    state.tenants = [];
    renderTenantRecords([]);

    showPageAlert(
      "danger",
      error.message || "Company records could not be loaded.",
    );
  }
}

function getTenantById(tenantId = "") {
  const id = String(tenantId || "").trim();

  if (!id) return null;

  return (state.tenants || []).find(
    (tenant) => String(tenant.id || "").trim() === id,
  ) || null;
}

function startTenantEdit(tenantId) {
  const tenant = getTenantById(tenantId);

  if (!tenant) {
    showPageAlert(
      "warning",
      "The selected company record could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingTenant = tenant;
  // ADMIN UI CLEANUP - STEP 1I
  // If Company Identity is collapsed, open it before loading the edit values.
  openAdminCompanyIdentityPanel();

  if (state.dom.editingTenantId) {
    state.dom.editingTenantId.value = tenant.id || "";
  }

  if (state.dom.tenantCompanyName) {
    state.dom.tenantCompanyName.value = tenant.company_name || "";
  }

  if (state.dom.tenantCode) {
    state.dom.tenantCode.value = tenant.tenant_code || "";
  }

  if (state.dom.tenantStatus) {
    state.dom.tenantStatus.value = tenant.status || "Active";
  }


  state.dom.cancelTenantEditBtn?.classList.remove("d-none");

  if (state.dom.saveTenantBtn) {
    state.dom.saveTenantBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveTenantBtnText">Update Company</span>
    `;
    state.dom.saveTenantBtnText = document.getElementById("saveTenantBtnText");
  }

  updateTenantSaveButtonState();

  // ADMIN UI CLEANUP - STEP 1K
  // Editing a company should open Company Identity and scroll to the panel
  // header cleanly without cutting it off.
  focusAdminFieldWithoutJump(state.dom.tenantCompanyName);
  scrollToAdminOpenedPanel(
    state.dom.toggleAdminCompanyIdentityCardBtn,
    state.dom.adminCompanyIdentityCollapse,
    150,
  );
}

async function saveTenantRecord() {
  if (!validateTenantForm()) {
    updateTenantSaveButtonState();
    return;
  }

  const payload = buildTenantPayload();
  const editingId = String(
    state.currentEditingTenant?.id || state.dom.editingTenantId?.value || "",
  ).trim();

  try {
    setTenantSaveLoading(true);

    const supabase = getSupabaseClient();

    let response;

    if (editingId) {
      const updatePayload = {
        ...payload,
        updated_by: state.currentUser?.id || null,
      };

      delete updatePayload.created_by;

      response = await supabase
        .from("tenants")
        .update(updatePayload)
        .eq("id", editingId)
        .select("*")
        .maybeSingle();
    } else {
      response = await supabase
        .from("tenants")
        .insert([payload])
        .select("*")
        .maybeSingle();
    }

    if (response.error) throw response.error;

    await refreshTenantWorkspace();

    showPageAlert(
      "success",
      `Company record was ${editingId ? "updated" : "created"} successfully.`,
    );

    // ADMIN UI CLEANUP - STEP 1H
    // Mirror HR dashboard floating feedback for important Admin save actions.
    showDashboardToast(
      "success",
      editingId ? "Company updated" : "Company created",
      `Company record was ${editingId ? "updated" : "created"} successfully.`,
    );

    resetTenantForm();

    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // After successful company create/update, open Company Records and scroll there cleanly.
    redirectToAdminCompanyRecordsAfterSave();
  } catch (error) {
    console.error("Error saving tenant record:", error);

    const message = String(error.message || "").toLowerCase();

    if (
      message.includes("duplicate key value") ||
      message.includes("tenants_tenant_code_lower_unique") ||
      message.includes("tenant_code")
    ) {
      showPageAlert(
        "warning",
        "This Tenant ID / Company ID already exists. Please use a different ID.",
      );
      return;
    }

    showPageAlert(
      "danger",
      error.message || "Company record could not be saved.",
    );
  } finally {
    setTenantSaveLoading(false);
  }
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Display name used in profile dropdowns and user tenant link records.
function getProfileDisplayName(profile = {}) {
  return (
    String(profile.full_name || "").trim() ||
    String(profile.email || "").trim() ||
    "Unnamed profile"
  );
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Find tenant record from already-loaded Admin tenant records.
function getTenantByTenantId(tenantId = "") {
  const id = String(tenantId || "").trim();

  if (!id) return null;

  return (state.tenants || []).find(
    (tenant) => String(tenant.id || "").trim() === id,
  ) || null;
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Populate the User/Profile dropdown from loaded profiles.
function populateProfileTenantProfileOptions() {
  const select = state.dom.profileTenantProfileId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select user/profile</option>`;

  const profiles = [...(state.profilesForTenantLinking || [])].sort((a, b) =>
    getProfileDisplayName(a).localeCompare(getProfileDisplayName(b), undefined, {
      sensitivity: "base",
    }),
  );

  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${getProfileDisplayName(profile)} — ${profile.email || "No email"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateProfileTenantLinkSaveButtonState();
}

// HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
// Populate the Tenant/Company dropdown from Admin-created tenant records.
function populateProfileTenantTenantOptions() {
  const select = state.dom.profileTenantTenantId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  // ADMIN UI CLEANUP - STEP 1B FINAL
  // Admin users select a company here, although the stored value remains tenant_id.
  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(String(b.company_name || ""), undefined, {
        sensitivity: "base",
      }),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    option.textContent = `${tenant.company_name || "Unnamed Company"} — ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateProfileTenantLinkSaveButtonState();
}

// ADMIN COMPANY USER BOOTSTRAP - STEP 1D
// Populate the company dropdown used by the Admin company-user invite form.
function populateCompanyUserTenantOptions() {
  const select = state.dom.companyUserTenantId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(
        String(b.company_name || ""),
        undefined,
        { sensitivity: "base" },
      ),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    option.textContent = `${tenant.company_name || "Unnamed Company"} — ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  if (currentValue) {
    const stillExists = Array.from(select.options).some(
      (option) => option.value === currentValue,
    );

    if (stillExists) {
      select.value = currentValue;
    }
  }

  updateCompanyUserInviteButtonState();
}
// ADMIN EMAIL SETUP - STEP 1D
// Populate the company dropdown used by Admin Email Setup.
function populateAdminEmailSetupCompanyOptions() {
  const select = state.dom.adminEmailSetupCompanyId;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">Select company</option>`;

  const activeTenants = [...(state.tenants || [])]
    .filter((tenant) => String(tenant.status || "").toLowerCase() === "active")
    .sort((a, b) =>
      String(a.company_name || "").localeCompare(
        String(b.company_name || ""),
        undefined,
        { sensitivity: "base" },
      ),
    );

  activeTenants.forEach((tenant) => {
    const option = document.createElement("option");
    option.value = tenant.id;
    option.textContent = `${tenant.company_name || "Unnamed Company"} — ${tenant.tenant_code || "--"}`;
    select.appendChild(option);
  });

  const hasCurrentValue = currentValue &&
    activeTenants.some((tenant) => String(tenant.id || "") === currentValue);

  if (hasCurrentValue) {
    select.value = currentValue;
  } else if (activeTenants.length) {
    select.value = activeTenants[0].id;
  }

  updateAdminEmailRecipientSaveButtonState();
}

function getSelectedAdminEmailSetupTenant() {
  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

  if (!tenantId) return null;

  return getTenantByTenantId(tenantId);
}

function normaliseAdminEmailSetupStatus(status = "") {
  return String(status || "").trim().toLowerCase();
}

function getAdminEmailSetupStatusBadgeClass(status = "") {
  const normalisedStatus = normaliseAdminEmailSetupStatus(status);

  if (normalisedStatus === "active" || normalisedStatus === "sent") {
    return "text-bg-success";
  }

  if (normalisedStatus === "failed") {
    return "text-bg-danger";
  }

  if (normalisedStatus === "pending") {
    return "text-bg-secondary";
  }

  return "text-bg-light border text-dark";
}

function getAdminEmailSetupDisplayStatus(status = "") {
  const normalisedStatus = normaliseAdminEmailSetupStatus(status);

  if (normalisedStatus === "sent") return "Successful";
  if (normalisedStatus === "failed") return "Needs Review";
  if (normalisedStatus === "pending") return "Pending";
  if (normalisedStatus === "active") return "Active";
  if (normalisedStatus === "inactive") return "Inactive";

  return String(status || "--").trim() || "--";
}

function updateAdminEmailSetupSummary() {
  const recipients = Array.isArray(state.adminEmailSetupRecipients)
    ? state.adminEmailSetupRecipients
    : [];

  const logs = Array.isArray(state.adminEmailSetupLogs)
    ? state.adminEmailSetupLogs
    : [];

  const activeRecipientCount = recipients.filter(
    (recipient) => normaliseAdminEmailSetupStatus(recipient.status) === "active",
  ).length;

  if (state.dom.adminEmailRecipientCountValue) {
    state.dom.adminEmailRecipientCountValue.textContent = String(recipients.length);
  }

  if (state.dom.adminEmailActiveRecipientCountValue) {
    state.dom.adminEmailActiveRecipientCountValue.textContent = String(activeRecipientCount);
  }

  if (state.dom.adminEmailDeliveryLogCountValue) {
    state.dom.adminEmailDeliveryLogCountValue.textContent = String(logs.length);
  }

  if (state.dom.adminEmailLastResultValue) {
    const latestLog = logs[0] || null;

    state.dom.adminEmailLastResultValue.textContent = latestLog
      ? getAdminEmailSetupDisplayStatus(latestLog.status)
      : "--";

    state.dom.adminEmailLastResultValue.className = latestLog
      ? `summary-tile-value h6 mb-0 ${normaliseAdminEmailSetupStatus(latestLog.status) === "sent"
        ? "text-success"
        : normaliseAdminEmailSetupStatus(latestLog.status) === "failed"
          ? "text-danger"
          : "text-secondary"
      }`
      : "summary-tile-value h6 mb-0";
  }
}

function renderAdminEmailRecipients(records = []) {
  const tbody = state.dom.adminEmailRecipientsTableBody;
  if (!tbody) return;

  const tenant = getSelectedAdminEmailSetupTenant();
  const recipients = Array.isArray(records) ? records : [];

  tbody.innerHTML = "";

  if (!recipients.length) {
    state.dom.adminEmailRecipientsEmptyState?.classList.remove("d-none");
    state.dom.adminEmailRecipientsTableWrapper?.classList.add("d-none");
    updateAdminEmailSetupSummary();
    return;
  }

  state.dom.adminEmailRecipientsEmptyState?.classList.add("d-none");
  state.dom.adminEmailRecipientsTableWrapper?.classList.remove("d-none");

  recipients.forEach((recipient) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(recipient.display_name || "--")}</div>
        <div class="text-secondary small text-break">${escapeHtml(recipient.recipient_email || "--")}</div>
      </td>

      <td>
        <div class="fw-semibold">${escapeHtml(tenant?.company_name || "--")}</div>
        <div class="text-secondary small">${escapeHtml(tenant?.tenant_code || "--")}</div>
      </td>

      <td>
        <span class="badge ${getAdminEmailSetupStatusBadgeClass(recipient.status)}">
          ${escapeHtml(getAdminEmailSetupDisplayStatus(recipient.status))}
        </span>
      </td>

      <td class="text-nowrap">${formatDate(recipient.updated_at || recipient.created_at)}</td>

      <td class="text-center">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary"
          title="Edit approved recipient"
          onclick="window.adminEditEmailRecipientRecord('${escapeHtml(recipient.id)}')"
        >
          <i class="bi bi-pencil-square"></i>
        </button>
      </td>
    `;

    tbody.appendChild(row);
  });

  updateAdminEmailSetupSummary();
}

function renderAdminEmailDeliveryLogs(records = []) {
  const tbody = state.dom.adminEmailDeliveryLogsTableBody;
  if (!tbody) return;

  const logs = Array.isArray(records) ? records : [];

  tbody.innerHTML = "";

  if (!logs.length) {
    state.dom.adminEmailDeliveryLogsEmptyState?.classList.remove("d-none");
    state.dom.adminEmailDeliveryLogsTableWrapper?.classList.add("d-none");
    updateAdminEmailSetupSummary();
    return;
  }

  state.dom.adminEmailDeliveryLogsEmptyState?.classList.add("d-none");
  state.dom.adminEmailDeliveryLogsTableWrapper?.classList.remove("d-none");

  logs.forEach((log) => {
    const sentOrCreatedDate = log.sent_at || log.created_at;
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(log.recipient_name || "--")}</div>
        <div class="text-secondary small text-break">${escapeHtml(log.recipient_email || "--")}</div>
      </td>

      <td>
        <span class="badge ${getAdminEmailSetupStatusBadgeClass(log.status)}">
          ${escapeHtml(getAdminEmailSetupDisplayStatus(log.status))}
        </span>
      </td>

      <td>${escapeHtml(log.provider_name || "--")}</td>

      <td class="text-nowrap">${formatDate(sentOrCreatedDate)}</td>
    `;

    tbody.appendChild(row);
  });

  updateAdminEmailSetupSummary();
}

function getAdminEmailRecipientById(recipientId = "") {
  const id = String(recipientId || "").trim();

  if (!id) return null;

  return (state.adminEmailSetupRecipients || []).find(
    (recipient) => String(recipient.id || "").trim() === id,
  ) || null;
}

function updateAdminEmailRecipientSaveButtonState() {
  const button = state.dom.saveAdminEmailRecipientBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();
  const displayName = String(state.dom.adminEmailRecipientDisplayName?.value || "").trim();
  const email = String(state.dom.adminEmailRecipientEmail?.value || "").trim();
  const status = String(state.dom.adminEmailRecipientStatus?.value || "").trim();

  const canSubmit = Boolean(
    tenantId &&
    displayName &&
    isCompanyUserEmailValid(email) &&
    status,
  );

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearAdminEmailRecipientValidationState() {
  [
    state.dom.adminEmailSetupCompanyId,
    state.dom.adminEmailRecipientDisplayName,
    state.dom.adminEmailRecipientEmail,
    state.dom.adminEmailRecipientStatus,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateAdminEmailRecipientForm() {
  clearAdminEmailRecipientValidationState();

  const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();
  const displayName = String(state.dom.adminEmailRecipientDisplayName?.value || "").trim();
  const email = String(state.dom.adminEmailRecipientEmail?.value || "").trim();
  const status = String(state.dom.adminEmailRecipientStatus?.value || "").trim();

  if (!tenantId) {
    state.dom.adminEmailSetupCompanyId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the company before adding an approved validation recipient.");
    state.dom.adminEmailSetupCompanyId?.focus();
    return false;
  }

  if (!displayName) {
    state.dom.adminEmailRecipientDisplayName?.classList.add("is-invalid");
    // ADMIN EMAIL SETUP - STEP 1D-2
    // Recipient Label is the friendly mailbox label HR sees in Email Integration.
    showPageAlert("warning", "Enter a clear recipient label for the approved validation recipient.");
    state.dom.adminEmailRecipientDisplayName?.focus();
    return false;
  }

  if (!isCompanyUserEmailValid(email)) {
    state.dom.adminEmailRecipientEmail?.classList.add("is-invalid");
    showPageAlert("warning", "Enter a valid approved validation recipient email address.");
    state.dom.adminEmailRecipientEmail?.focus();
    return false;
  }

  if (!status) {
    state.dom.adminEmailRecipientStatus?.classList.add("is-invalid");
    showPageAlert("warning", "Select the approved validation recipient status.");
    state.dom.adminEmailRecipientStatus?.focus();
    return false;
  }

  return true;
}

function buildAdminEmailRecipientPayload() {
  return {
    tenant_id: String(state.dom.adminEmailSetupCompanyId?.value || "").trim(),
    display_name: String(state.dom.adminEmailRecipientDisplayName?.value || "").trim(),
    recipient_email: String(state.dom.adminEmailRecipientEmail?.value || "").trim().toLowerCase(),
    status: String(state.dom.adminEmailRecipientStatus?.value || "Active").trim(),
    created_by: state.currentUser?.id || null,
    updated_at: new Date().toISOString(),
  };
}

function setAdminEmailRecipientSaveLoading(isLoading) {
  const button = state.dom.saveAdminEmailRecipientBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Recipient...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  delete button.dataset.isLoading;
  updateAdminEmailRecipientSaveButtonState();
}

function resetAdminEmailRecipientForm(options = {}) {
  const { preserveCompany = false } = options;
  const selectedCompanyId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

  state.currentEditingAdminEmailRecipient = null;

  if (state.dom.editingAdminEmailRecipientId) {
    state.dom.editingAdminEmailRecipientId.value = "";
  }

  if (state.dom.adminEmailRecipientDisplayName) {
    state.dom.adminEmailRecipientDisplayName.value = "";
  }

  if (state.dom.adminEmailRecipientEmail) {
    state.dom.adminEmailRecipientEmail.value = "";
  }

  if (state.dom.adminEmailRecipientStatus) {
    state.dom.adminEmailRecipientStatus.value = "Active";
  }

  if (!preserveCompany && state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = "";
  }

  if (preserveCompany && selectedCompanyId && state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = selectedCompanyId;
  }

  state.dom.cancelAdminEmailRecipientEditBtn?.classList.add("d-none");

  if (state.dom.saveAdminEmailRecipientBtn) {
    state.dom.saveAdminEmailRecipientBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveAdminEmailRecipientBtnText">Add Approved Recipient</span>
    `;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  clearAdminEmailRecipientValidationState();
  updateAdminEmailRecipientSaveButtonState();
}

async function refreshAdminEmailSetupWorkspace(options = {}) {
  const { showAlert = false, preserveCompany = false } = options;
  const selectedCompanyIdBeforeRefresh = String(
    state.dom.adminEmailSetupCompanyId?.value || "",
  ).trim();

  try {
    setAdminActionButtonLoading(
      state.dom.refreshAdminEmailSetupBtn,
      true,
      "Refreshing Email Setup...",
    );

    populateAdminEmailSetupCompanyOptions();

    if (
      preserveCompany &&
      selectedCompanyIdBeforeRefresh &&
      state.dom.adminEmailSetupCompanyId
    ) {
      const stillExists = Array.from(state.dom.adminEmailSetupCompanyId.options)
        .some((option) => option.value === selectedCompanyIdBeforeRefresh);

      if (stillExists) {
        state.dom.adminEmailSetupCompanyId.value = selectedCompanyIdBeforeRefresh;
      }
    }

    const tenantId = String(state.dom.adminEmailSetupCompanyId?.value || "").trim();

    if (!tenantId) {
      state.adminEmailSetupRecipients = [];
      state.adminEmailSetupLogs = [];
      renderAdminEmailRecipients([]);
      renderAdminEmailDeliveryLogs([]);

      if (showAlert) {
        showPageAlert("warning", "Create or activate a company before configuring Email Setup.");
      }

      return;
    }

    const supabase = getSupabaseClient();

    const [recipientsResponse, logsResponse] = await Promise.all([
      supabase
        .from("email_integration_test_recipients")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false }),

      supabase
        .from("email_delivery_logs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (recipientsResponse.error) throw recipientsResponse.error;
    if (logsResponse.error) throw logsResponse.error;

    state.adminEmailSetupRecipients = Array.isArray(recipientsResponse.data)
      ? recipientsResponse.data
      : [];

    state.adminEmailSetupLogs = Array.isArray(logsResponse.data)
      ? logsResponse.data
      : [];

    renderAdminEmailRecipients(state.adminEmailSetupRecipients);
    renderAdminEmailDeliveryLogs(state.adminEmailSetupLogs);
    updateAdminEmailRecipientSaveButtonState();

    if (showAlert) {
      showPageAlert("success", "Email Setup was refreshed successfully.");
    }
  } catch (error) {
    console.error("Error refreshing Admin Email Setup:", error);

    state.adminEmailSetupRecipients = [];
    state.adminEmailSetupLogs = [];
    renderAdminEmailRecipients([]);
    renderAdminEmailDeliveryLogs([]);

    showPageAlert(
      "danger",
      error.message || "Email Setup could not be loaded.",
    );
  } finally {
    setAdminActionButtonLoading(state.dom.refreshAdminEmailSetupBtn, false);
  }
}

function startAdminEmailRecipientEdit(recipientId) {
  const recipient = getAdminEmailRecipientById(recipientId);

  if (!recipient) {
    showPageAlert(
      "warning",
      "The selected approved validation recipient could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingAdminEmailRecipient = recipient;

  openAdminEmailSetupPanel();

  if (state.dom.editingAdminEmailRecipientId) {
    state.dom.editingAdminEmailRecipientId.value = recipient.id || "";
  }

  if (state.dom.adminEmailSetupCompanyId) {
    state.dom.adminEmailSetupCompanyId.value = recipient.tenant_id || "";
  }

  if (state.dom.adminEmailRecipientDisplayName) {
    state.dom.adminEmailRecipientDisplayName.value = recipient.display_name || "";
  }

  if (state.dom.adminEmailRecipientEmail) {
    state.dom.adminEmailRecipientEmail.value = recipient.recipient_email || "";
  }

  if (state.dom.adminEmailRecipientStatus) {
    state.dom.adminEmailRecipientStatus.value = recipient.status || "Active";
  }

  state.dom.cancelAdminEmailRecipientEditBtn?.classList.remove("d-none");

  if (state.dom.saveAdminEmailRecipientBtn) {
    state.dom.saveAdminEmailRecipientBtn.innerHTML = `
      <i class="bi bi-save me-2"></i>
      <span id="saveAdminEmailRecipientBtnText">Update Approved Recipient</span>
    `;
    state.dom.saveAdminEmailRecipientBtnText =
      document.getElementById("saveAdminEmailRecipientBtnText");
  }

  updateAdminEmailRecipientSaveButtonState();

  focusAdminFieldWithoutJump(state.dom.adminEmailRecipientDisplayName);
  scrollToAdminOpenedPanel(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    150,
  );
}

function openAdminEmailSetupPanel() {
  setAdminDashboardCardExpanded(
    state.dom.toggleAdminEmailSetupCardBtn,
    state.dom.adminEmailSetupCollapse,
    true,
  );
}

async function saveAdminEmailRecipient() {
  if (!validateAdminEmailRecipientForm()) {
    updateAdminEmailRecipientSaveButtonState();
    return;
  }

  const payload = buildAdminEmailRecipientPayload();
  const editingId = String(
    state.currentEditingAdminEmailRecipient?.id ||
    state.dom.editingAdminEmailRecipientId?.value ||
    "",
  ).trim();

  try {
    setAdminEmailRecipientSaveLoading(true);

    const supabase = getSupabaseClient();

    let response;

    if (editingId) {
      const updatePayload = { ...payload };
      delete updatePayload.created_by;

      response = await supabase
        .from("email_integration_test_recipients")
        .update(updatePayload)
        .eq("id", editingId)
        .select("*")
        .maybeSingle();
    } else {
      response = await supabase
        .from("email_integration_test_recipients")
        .insert([payload])
        .select("*")
        .maybeSingle();
    }

    if (response.error) throw response.error;

    await refreshAdminEmailSetupWorkspace({ preserveCompany: true });

    showPageAlert(
      "success",
      `Approved validation recipient was ${editingId ? "updated" : "added"} successfully.`,
    );

    showDashboardToast(
      "success",
      editingId ? "Recipient updated" : "Recipient added",
      "HR Email Integration will now reflect the approved recipient for the selected company.",
    );

    resetAdminEmailRecipientForm({ preserveCompany: true });

    openAdminEmailSetupPanel();

    window.requestAnimationFrame(() => {
      scrollToAdminDashboardTarget(
        state.dom.adminEmailRecipientsHeader ||
        state.dom.adminEmailRecipientsTableWrapper ||
        state.dom.adminEmailSetupCollapse,
        96,
      );
    });
  } catch (error) {
    console.error("Error saving approved validation recipient:", error);

    const message = String(error.message || "").toLowerCase();

    if (
      message.includes("duplicate key value") ||
      message.includes("recipient_email") ||
      message.includes("email_integration_test_recipients")
    ) {
      showPageAlert(
        "warning",
        "This approved validation recipient email already exists. Edit the existing recipient instead.",
      );
      return;
    }

    showPageAlert(
      "danger",
      error.message || "Approved validation recipient could not be saved.",
    );
  } finally {
    setAdminEmailRecipientSaveLoading(false);
  }
}
// ADMIN COMPANY USER BOOTSTRAP - STEP 1D
// Email validation is kept lightweight and client-side only.
// The Edge Function remains the authoritative security boundary.
function isCompanyUserEmailValid(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function clearCompanyUserInviteAlert() {
  const alert = state.dom.companyUserInviteAlert;
  if (!alert) return;

  alert.className = "alert d-none mb-3";
  alert.textContent = "";
}

function showCompanyUserInviteAlert(type, message) {
  const alert = state.dom.companyUserInviteAlert;
  if (!alert) {
    showPageAlert(type, message);
    return;
  }

  alert.className = `alert alert-${type} mb-3`;
  alert.textContent = message;
}

function clearCompanyUserInviteValidationState() {
  [
    state.dom.companyUserFullName,
    state.dom.companyUserEmail,
    state.dom.companyUserRole,
    state.dom.companyUserTenantId,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function updateCompanyUserInviteButtonState() {
  const button = state.dom.inviteCompanyUserBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const fullName = String(state.dom.companyUserFullName?.value || "").trim();
  const email = String(state.dom.companyUserEmail?.value || "").trim();
  const role = String(state.dom.companyUserRole?.value || "").trim();
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  const canSubmit = Boolean(
    fullName &&
    isCompanyUserEmailValid(email) &&
    role &&
    tenantId,
  );

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function validateCompanyUserInviteForm() {
  clearCompanyUserInviteValidationState();
  clearCompanyUserInviteAlert();

  const fullName = String(state.dom.companyUserFullName?.value || "").trim();
  const email = String(state.dom.companyUserEmail?.value || "").trim();
  const role = String(state.dom.companyUserRole?.value || "").trim();
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  if (!fullName) {
    state.dom.companyUserFullName?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Enter the company user’s full name.");
    state.dom.companyUserFullName?.focus();
    return false;
  }

  if (!isCompanyUserEmailValid(email)) {
    state.dom.companyUserEmail?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Enter a valid email address.");
    state.dom.companyUserEmail?.focus();
    return false;
  }

  if (!role) {
    state.dom.companyUserRole?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Select the company user role.");
    state.dom.companyUserRole?.focus();
    return false;
  }

  if (!tenantId) {
    state.dom.companyUserTenantId?.classList.add("is-invalid");
    showCompanyUserInviteAlert("warning", "Select the company workspace.");
    state.dom.companyUserTenantId?.focus();
    return false;
  }

  return true;
}

function getSelectedCompanyUserTenant() {
  const tenantId = String(state.dom.companyUserTenantId?.value || "").trim();

  if (!tenantId) return null;

  return getTenantByTenantId(tenantId);
}

function buildCompanyUserInvitePayload() {
  const tenant = getSelectedCompanyUserTenant();

  return {
    fullName: String(state.dom.companyUserFullName?.value || "").trim(),
    email: String(state.dom.companyUserEmail?.value || "").trim().toLowerCase(),
    role: String(state.dom.companyUserRole?.value || "hr").trim().toLowerCase(),
    tenantId: String(tenant?.id || state.dom.companyUserTenantId?.value || "").trim(),
    companyName: String(tenant?.company_name || "").trim(),
  };
}

function setCompanyUserInviteLoading(isLoading) {
  const button = state.dom.inviteCompanyUserBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    if (!button.dataset.originalClass) {
      button.dataset.originalClass = button.className;
    }

    button.disabled = true;
    button.className = "btn btn-secondary dashboard-action-btn";
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Sending Invite...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }

  button.className =
    button.dataset.originalClass || "btn btn-secondary dashboard-action-btn";

  delete button.dataset.originalClass;
  delete button.dataset.isLoading;

  updateCompanyUserInviteButtonState();
}

function resetCompanyUserInviteForm() {
  if (state.dom.companyUserInviteForm) {
    state.dom.companyUserInviteForm.reset();
  }

  clearCompanyUserInviteValidationState();
  updateCompanyUserInviteButtonState();
}

async function inviteCompanyUser() {
  if (!validateCompanyUserInviteForm()) {
    updateCompanyUserInviteButtonState();
    return;
  }

  const payload = buildCompanyUserInvitePayload();

  try {
    setCompanyUserInviteLoading(true);
    clearCompanyUserInviteAlert();

    const supabase = getSupabaseClient();

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Secure backend creates/invites Auth user, creates profile, and links
    // profile to the selected company tenant. Frontend never creates Auth users.
    const { data, error } = await supabase.functions.invoke(
      "invite-company-user",
      {
        body: payload,
      },
    );

    if (error) throw error;

    showCompanyUserInviteAlert(
      "success",
      data?.message ||
      `${payload.fullName} has been invited to ${payload.companyName || "the selected company"}.`,
    );

    showPageAlert(
      "success",
      data?.message ||
      `${payload.fullName} has been invited successfully.`,
    );

    showDashboardToast(
      "success",
      "Company user invited",
      `${payload.fullName} was invited to ${payload.companyName || "the selected company"}.`,
    );

    resetCompanyUserInviteForm();

    // ADMIN COMPANY USER BOOTSTRAP - STEP 1D
    // Refresh access records so the newly created profile appears in the
    // existing User Access Records table.
    await refreshProfileTenantLinkingWorkspace();

    redirectToAdminUserCompanyLinksAfterSave();
  } catch (error) {
    console.error("Company user invite error:", error);

    const message =
      String(error?.message || "").trim() ||
      "Company user invite could not be sent.";

    showCompanyUserInviteAlert("danger", message);
    showPageAlert("danger", message);

    showDashboardToast(
      "danger",
      "Invite failed",
      message,
    );
  } finally {
    setCompanyUserInviteLoading(false);
  }
}

function updateProfileTenantLinkSaveButtonState() {
  const canSubmit = Boolean(
    String(state.dom.profileTenantProfileId?.value || "").trim() &&
    String(state.dom.profileTenantTenantId?.value || "").trim(),
  );

  const button = state.dom.saveProfileTenantLinkBtn;
  if (!button) return;

  button.disabled = !canSubmit;
  button.className = canSubmit
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearProfileTenantLinkValidationState() {
  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    field?.classList.remove("is-invalid");
  });
}

function validateProfileTenantLinkForm() {
  clearProfileTenantLinkValidationState();

  const profileId = String(state.dom.profileTenantProfileId?.value || "").trim();
  const tenantId = String(state.dom.profileTenantTenantId?.value || "").trim();

  if (!profileId) {
    state.dom.profileTenantProfileId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the user/profile for access setup.");
    state.dom.profileTenantProfileId?.focus();
    return false;
  }

  if (!tenantId) {
    state.dom.profileTenantTenantId?.classList.add("is-invalid");
    showPageAlert("warning", "Select the company for this user.");
    state.dom.profileTenantTenantId?.focus();
    return false;
  }

  return true;
}

function setProfileTenantLinkSaveLoading(isLoading) {
  const button = state.dom.saveProfileTenantLinkBtn;
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving Access Setup...
    `;
    return;
  }

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();
}

function resetProfileTenantLinkForm() {
  state.currentEditingProfileTenantLink = null;

  if (state.dom.editingProfileTenantLinkProfileId) {
    state.dom.editingProfileTenantLinkProfileId.value = "";
  }

  [
    state.dom.profileTenantProfileId,
    state.dom.profileTenantTenantId,
  ].forEach((field) => {
    if (field) {
      field.value = "";
      field.classList.remove("is-invalid");
    }
  });

  state.dom.cancelProfileTenantLinkEditBtn?.classList.add("d-none");

  if (state.dom.saveProfileTenantLinkBtn) {
    state.dom.saveProfileTenantLinkBtn.innerHTML = `
      <i class="bi bi-link-45deg me-2"></i>
<span id="saveProfileTenantLinkBtnText">Save Access Setup</span>
    `;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();
}

function renderProfileTenantLinksLoadingState() {
  if (!state.dom.profileTenantLinksTableBody) return;

  state.dom.profileTenantLinksEmptyState?.classList.add("d-none");
  state.dom.profileTenantLinksTableWrapper?.classList.remove("d-none");

  state.dom.profileTenantLinksTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="text-center text-secondary py-4">
        Loading user access records.
      </td>
    </tr>
  `;
}

function renderProfileTenantLinks(records = []) {
  const tbody = state.dom.profileTenantLinksTableBody;
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!records.length) {
    state.dom.profileTenantLinksEmptyState?.classList.remove("d-none");
    state.dom.profileTenantLinksTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.profileTenantLinksEmptyState?.classList.add("d-none");
  state.dom.profileTenantLinksTableWrapper?.classList.remove("d-none");

  const recordsToRender = [...records].sort((a, b) =>
    getProfileDisplayName(a).localeCompare(getProfileDisplayName(b), undefined, {
      sensitivity: "base",
    }),
  );

  recordsToRender.forEach((profile) => {
    const tenant = getTenantByTenantId(profile.tenant_id);
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(getProfileDisplayName(profile))}</div>
        <div class="text-secondary small text-break">${escapeHtml(profile.email || "--")}</div>
      </td>

      <td>
        <span class="badge rounded-pill text-bg-light border">
          ${escapeHtml(profile.role || "--")}
        </span>
      </td>

      <td>${escapeHtml(tenant?.company_name || "Not linked")}</td>

      <td>
        <span class="badge rounded-pill text-bg-light border">
          ${escapeHtml(tenant?.tenant_code || "--")}
        </span>
      </td>

      <td class="text-center">
        <div class="d-flex gap-1 justify-content-center">
          <!-- HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
               Load this profile into the user access setup form. -->
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            title="Edit user access setup"
            onclick="window.adminEditProfileTenantLink('${escapeHtml(profile.id)}')"
          >
            <i class="bi bi-pencil-square"></i>
          </button>

          <!-- ADMIN PASSWORD RESET
               Open the reset password modal for this user. -->
          <button
            type="button"
            class="btn btn-sm btn-outline-warning"
            title="Reset password"
            onclick="window.adminResetUserPassword('${escapeHtml(profile.id)}')"
          >
            <i class="bi bi-key"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(row);
  });
}

async function refreshProfileTenantLinkingWorkspace() {
  renderProfileTenantLinksLoadingState();

  try {
    const supabase = getSupabaseClient();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2B
    // Use the safe Admin RPC instead of selecting directly from profiles.
    // This avoids adding risky profiles RLS policies that previously broke login.
    const { data, error } = await supabase.rpc(
      "admin_list_profiles_for_tenant_linking",
    );

    if (error) throw error;

    state.profilesForTenantLinking = Array.isArray(data) ? data : [];

    populateProfileTenantProfileOptions();
    populateProfileTenantTenantOptions();
    renderProfileTenantLinks(state.profilesForTenantLinking);

    // ADMIN UI CLEANUP - STEP 1E
    // Keep Overview user/company link counts in sync after profile link refresh.
    renderAdminOverviewSummary();
  } catch (error) {
    console.error("Error loading profiles for tenant linking:", error);

    state.profilesForTenantLinking = [];
    renderProfileTenantLinks([]);

    showPageAlert(
      "danger",
      error.message || "User access records could not be loaded.",
    );
  }
}

function getProfileForTenantLinkById(profileId = "") {
  const id = String(profileId || "").trim();

  if (!id) return null;

  return (state.profilesForTenantLinking || []).find(
    (profile) => String(profile.id || "").trim() === id,
  ) || null;
}

function startProfileTenantLinkEdit(profileId) {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "The selected user/profile could not be found. Please refresh and try again.",
    );
    return;
  }

  state.currentEditingProfileTenantLink = profile;
  // ADMIN UI CLEANUP - STEP 1I
  // If User Company Assignment is collapsed, open it before loading edit values.
  openAdminUserCompanyAssignmentPanel();

  if (state.dom.editingProfileTenantLinkProfileId) {
    state.dom.editingProfileTenantLinkProfileId.value = profile.id || "";
  }

  if (state.dom.profileTenantProfileId) {
    state.dom.profileTenantProfileId.value = profile.id || "";
  }

  if (state.dom.profileTenantTenantId) {
    state.dom.profileTenantTenantId.value = profile.tenant_id || "";
  }

  state.dom.cancelProfileTenantLinkEditBtn?.classList.remove("d-none");

  if (state.dom.saveProfileTenantLinkBtn) {
    state.dom.saveProfileTenantLinkBtn.innerHTML = `
      <i class="bi bi-link-45deg me-2"></i>
<span id="saveProfileTenantLinkBtnText">Update Access Setup</span>
    `;
    state.dom.saveProfileTenantLinkBtnText =
      document.getElementById("saveProfileTenantLinkBtnText");
  }

  updateProfileTenantLinkSaveButtonState();

  // ADMIN UI CLEANUP - STEP 1K
  // Editing a user/company link should open User Company Assignment and
  // scroll to the panel header cleanly without cutting it off.
  focusAdminFieldWithoutJump(state.dom.profileTenantTenantId);
  scrollToAdminOpenedPanel(
    state.dom.toggleAdminUserCompanyAssignmentCardBtn,
    state.dom.adminUserCompanyAssignmentCollapse,
    150,
  );
}

async function saveProfileTenantLink() {
  if (!validateProfileTenantLinkForm()) {
    updateProfileTenantLinkSaveButtonState();
    return;
  }

  const profileId = String(state.dom.profileTenantProfileId?.value || "").trim();
  const tenantId = String(state.dom.profileTenantTenantId?.value || "").trim();

  try {
    setProfileTenantLinkSaveLoading(true);

    const supabase = getSupabaseClient();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2B
    // Use the safe Admin RPC instead of updating profiles directly.
    // This keeps tenant assignment controlled without weakening profile RLS.
    const { error } = await supabase.rpc("admin_assign_profile_to_tenant", {
      target_profile_id: profileId,
      target_tenant_id: tenantId,
    });

    if (error) throw error;

    await refreshProfileTenantLinkingWorkspace();

    showPageAlert(
      "success",
      "User access setup was saved successfully.",
    );

    // ADMIN UI CLEANUP - STEP 1H
    // Keep user/company link feedback visible even when Admin is lower on the page.
    showDashboardToast(
      "success",
      "User access setup saved",
      "User access setup was saved successfully.",
    );

    resetProfileTenantLinkForm();

    // ADMIN UI CLEANUP - STEP 1J RECOVERY
    // After successful user/company assignment, open User Company Links and scroll there cleanly.
    redirectToAdminUserCompanyLinksAfterSave();
  } catch (error) {
    console.error("Error saving user tenant link:", error);

    showPageAlert(
      "danger",
      error.message || "User access setup could not be saved.",
    );
  } finally {
    setProfileTenantLinkSaveLoading(false);
  }
}

async function loadAdminProfileImages(profileImagePath, initials) {
  if (!profileImagePath) {
    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.textContent = initials;
      state.dom.adminProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.textContent = initials;
      state.dom.adminInitials.classList.remove("d-none");
    }

    if (state.dom.adminProfileImagePreview) {
      state.dom.adminProfileImagePreview.src = "";
      state.dom.adminProfileImagePreview.classList.add("d-none");
    }

    if (state.dom.adminHeroImage) {
      state.dom.adminHeroImage.src = "";
      state.dom.adminHeroImage.classList.add("d-none");
    }

    return;
  }

  const signedUrl = await getSignedAdminProfileImageUrl(profileImagePath);

  if (!signedUrl) {
    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.textContent = initials;
      state.dom.adminProfileAvatar.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.textContent = initials;
      state.dom.adminInitials.classList.remove("d-none");
    }

    return;
  }

  if (state.dom.adminProfileImagePreview) {
    state.dom.adminProfileImagePreview.src = signedUrl;
    state.dom.adminProfileImagePreview.classList.remove("d-none");
  }

  if (state.dom.adminProfileAvatar) {
    state.dom.adminProfileAvatar.classList.add("d-none");
  }

  if (state.dom.adminHeroImage) {
    state.dom.adminHeroImage.src = signedUrl;
    state.dom.adminHeroImage.classList.remove("d-none");
  }

  if (state.dom.adminInitials) {
    state.dom.adminInitials.classList.add("d-none");
  }
}

async function loadLatestAdminProfile() {
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
    console.error("Error loading latest admin profile:", error);
    return state.currentProfile;
  }
}

async function getSignedAdminProfileImageUrl(filePath) {
  if (!filePath) return null;

  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) throw error;

    return data?.signedUrl || null;
  } catch (error) {
    console.error("Error creating signed admin profile image URL:", error);
    return null;
  }
}



function renderAdminProfile(profile, user) {
  const fullName = profile?.full_name || "Administrator";
  const email = profile?.email || user?.email || "No email";
  const role = String(profile?.role || "admin").toLowerCase();
  const department = profile?.department || "";
  const initials = getInitials(fullName, "AD");

  if (state.dom.adminInitials) {
    state.dom.adminInitials.textContent = initials;
    state.dom.adminInitials.classList.remove("d-none");
  }

  if (state.dom.adminHeroImage) {
    state.dom.adminHeroImage.src = "";
    state.dom.adminHeroImage.classList.add("d-none");
  }

  if (state.dom.adminEmail) {
    state.dom.adminEmail.textContent = email;
  }

  if (state.dom.adminRole) {
    state.dom.adminRole.textContent = role;
  }

  if (state.dom.adminFullName) {
    state.dom.adminFullName.textContent = fullName;
  }

  if (state.dom.adminEmailTile) {
    state.dom.adminEmailTile.textContent = email;
  }

  if (state.dom.adminRoleTile) {
    state.dom.adminRoleTile.textContent = role;
  }

  if (state.dom.adminDepartment) {
    state.dom.adminDepartment.textContent = department || "--";
  }

  if (state.dom.adminProfileAvatar) {
    state.dom.adminProfileAvatar.textContent = initials;
    state.dom.adminProfileAvatar.classList.remove("d-none");
  }

  if (state.dom.adminProfileImagePreview) {
    state.dom.adminProfileImagePreview.src = "";
    state.dom.adminProfileImagePreview.classList.add("d-none");
  }

  if (state.dom.adminProfileCardName) {
    state.dom.adminProfileCardName.textContent = fullName;
  }

  if (state.dom.adminProfileCardEmail) {
    state.dom.adminProfileCardEmail.textContent = email;
  }

  if (state.dom.adminProfileFullName) {
    state.dom.adminProfileFullName.value = fullName;
  }

  if (state.dom.adminProfileEmail) {
    state.dom.adminProfileEmail.value = email;
  }

  if (state.dom.adminProfileRole) {
    state.dom.adminProfileRole.value = role;
  }

  if (state.dom.adminProfileDepartment) {
    state.dom.adminProfileDepartment.value = department;
  }

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // Render saved Admin profile photo after fallback initials are in place.
  void loadAdminProfileImages(profile?.profile_image_path, initials);

  // ADMIN UI CLEANUP - STEP 1D RECOVERY
  // After profile data is rendered, capture the clean baseline and keep
  // Save Profile Changes grey until Admin edits an editable field.
  state.currentProfileEditableBaseline = getAdminProfileEditableSnapshot();
  updateAdminProfileSaveButtonState();
}

function updateAdminProfileImageSaveButtonState() {
  const button = state.dom.saveAdminProfileImageBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const hasValidPendingFile = Boolean(state.pendingProfileImageFile);

  button.disabled = !hasValidPendingFile;
  button.className = hasValidPendingFile
    ? "btn btn-outline-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function setAdminProfileImageSaveLoading(isLoading) {
  const button = state.dom.saveAdminProfileImageBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";
  button.disabled = true;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.className = "btn btn-secondary dashboard-action-btn";
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

  delete button.dataset.isLoading;
  updateAdminProfileImageSaveButtonState();
}

function sanitiseAdminProfileImageFileName(fileName = "") {
  return String(fileName || "profile-image")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "profile-image";
}

function handlePendingAdminProfileImage(file) {
  state.pendingProfileImageFile = null;

  if (!file) {
    if (state.currentProfile) {
      renderAdminProfile(state.currentProfile, state.currentUser);
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const maxBytes = 5 * 1024 * 1024;

  if (!allowedTypes.includes(file.type)) {
    showPageAlert("warning", "Only PNG, JPG, JPEG, and WEBP images are allowed.");

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  if (file.size > maxBytes) {
    showPageAlert("warning", "Profile image must be 5MB or smaller.");

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    updateAdminProfileImageSaveButtonState();
    return;
  }

  state.pendingProfileImageFile = file;
  updateAdminProfileImageSaveButtonState();

  const reader = new FileReader();

  reader.onload = () => {
    if (state.dom.adminProfileImagePreview) {
      state.dom.adminProfileImagePreview.src = reader.result;
      state.dom.adminProfileImagePreview.classList.remove("d-none");
    }

    if (state.dom.adminProfileAvatar) {
      state.dom.adminProfileAvatar.classList.add("d-none");
    }

    if (state.dom.adminHeroImage) {
      state.dom.adminHeroImage.src = reader.result;
      state.dom.adminHeroImage.classList.remove("d-none");
    }

    if (state.dom.adminInitials) {
      state.dom.adminInitials.classList.add("d-none");
    }
  };

  reader.readAsDataURL(file);
}

async function saveAdminProfileImage() {
  const file = state.pendingProfileImageFile;

  if (!file) {
    showPageAlert("warning", "Choose a profile photo before uploading.");
    return;
  }

  if (!state.currentUser?.id) {
    showPageAlert("danger", "Signed-in Admin user could not be confirmed.");
    return;
  }

  try {
    setAdminProfileImageSaveLoading(true);

    const supabase = getSupabaseClient();
    const safeFileName = sanitiseAdminProfileImageFileName(file.name);
    const filePath = `${state.currentUser.id}/${Date.now()}-${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Profile photo upload failed: ${uploadError.message}`);
    }

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

    if (state.dom.adminProfileImageInput) {
      state.dom.adminProfileImageInput.value = "";
    }

    await loadLatestAdminProfile();
    renderAdminProfile(state.currentProfile, state.currentUser);

    showPageAlert("success", "Your profile photo was uploaded successfully.");
  } catch (error) {
    console.error("Error uploading admin profile image:", error);

    showPageAlert(
      "danger",
      error.message || "Profile photo could not be uploaded.",
    );
  } finally {
    setAdminProfileImageSaveLoading(false);
  }
}

function getAdminProfileEditableSnapshot() {
  return {
    fullName: String(state.dom.adminProfileFullName?.value || "").trim(),
    department: String(state.dom.adminProfileDepartment?.value || "").trim(),
  };
}

function updateAdminProfileSaveButtonState() {
  const button = state.dom.saveAdminProfileBtn;
  if (!button || button.dataset.isLoading === "true") return;

  const currentValues = getAdminProfileEditableSnapshot();
  const baseline = state.currentProfileEditableBaseline;

  const hasBaseline = Boolean(baseline);
  const hasValidName = Boolean(currentValues.fullName);

  const hasChanged = hasBaseline && (
    currentValues.fullName !== baseline.fullName ||
    currentValues.department !== baseline.department
  );

  const canSave = hasValidName && hasChanged;

  button.disabled = !canSave;
  button.className = canSave
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

async function saveAdminOwnProfile() {
  const fullName = String(state.dom.adminProfileFullName?.value || "").trim();
  const department = String(
    state.dom.adminProfileDepartment?.value || "",
  ).trim();

  if (!fullName) {
    showPageAlert(
      "warning",
      "Full name is required before saving your profile.",
    );
    state.dom.adminProfileFullName?.focus();
    return;
  }

  try {
    setProfileSaveLoading(true);

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        department: department || null,
      })
      .eq("id", state.currentUser.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;

    state.currentProfile = {
      ...state.currentProfile,
      ...(data || {}),
      full_name: fullName,
      department,
    };

    renderAdminProfile(state.currentProfile, state.currentUser);
    showPageAlert("success", "Your profile was updated successfully.");
  } catch (error) {
    console.error("Error updating admin profile:", error);
    showPageAlert(
      "danger",
      error.message || "Your profile could not be updated.",
    );
  } finally {
    setProfileSaveLoading(false);
  }
}

function setProfileSaveLoading(isLoading) {
  const button = state.dom.saveAdminProfileBtn;
  if (!button) return;

  button.dataset.isLoading = isLoading ? "true" : "false";
  button.disabled = true;

  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.className = "btn btn-secondary dashboard-action-btn";
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

  delete button.dataset.isLoading;
  updateAdminProfileSaveButtonState();
}

/* =========================================================
   ADMIN PASSWORD RESET
   ========================================================= */

function updateResetPasswordSubmitButtonState() {
  const btn = state.dom.resetPasswordSubmitBtn;
  if (!btn) return;

  const pw = String(state.dom.resetPasswordTempInput?.value || "").trim();
  const ready = pw.length >= 8;

  btn.disabled = !ready;
  btn.className = ready
    ? "btn btn-warning dashboard-action-btn"
    : "btn btn-secondary dashboard-action-btn";
}

function clearResetPasswordAlert() {
  const el = state.dom.resetPasswordAlert;
  if (!el) return;
  el.className = "alert d-none mb-0";
  el.textContent = "";
}

function showResetPasswordAlert(type, message) {
  const el = state.dom.resetPasswordAlert;
  if (!el) return;
  el.className = `alert alert-${type} mb-0`;
  el.textContent = message;
}

// ADMIN PASSWORD RESET VISIBILITY - STEP 1H
// Keep the temporary password visually masked without using type="password".
// This avoids browser password-manager dropdowns covering the reset modal.
// The typed value is unchanged and is still sent only through submitPasswordReset().
function setResetPasswordVisibility(isVisible = false) {
  const input = state.dom.resetPasswordTempInput;
  const icon = state.dom.resetPasswordToggleIcon;
  const button = state.dom.resetPasswordToggleBtn;

  if (!input) return;

  input.type = "text";
  input.dataset.passwordVisible = isVisible ? "true" : "false";

  input.style.setProperty(
    "-webkit-text-security",
    isVisible ? "none" : "disc",
  );

  input.style.setProperty(
    "text-security",
    isVisible ? "none" : "disc",
  );

  if (icon) {
    icon.className = isVisible ? "bi bi-eye-slash" : "bi bi-eye";
  }

  if (button) {
    button.title = isVisible ? "Hide temporary password" : "Show temporary password";
    button.setAttribute(
      "aria-label",
      isVisible ? "Hide temporary password" : "Show temporary password",
    );
  }
}

function clearResetPasswordModal() {
  state.currentResetTarget = null;

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Clear the temporary password and return the field to masked display.
  // Do not switch back to type="password"; that reopens browser password-manager prompts.
  if (state.dom.resetPasswordTempInput) {
    state.dom.resetPasswordTempInput.value = "";
  }

  setResetPasswordVisibility(false);

  clearResetPasswordAlert();
  updateResetPasswordSubmitButtonState();
}

function openResetPasswordModal(profileId) {
  const profile = getProfileForTenantLinkById(profileId);

  if (!profile) {
    showPageAlert(
      "warning",
      "User profile not found. Please refresh the page and try again.",
    );
    return;
  }

  state.currentResetTarget = profile;

  if (state.dom.resetPasswordTargetName) {
    state.dom.resetPasswordTargetName.textContent =
      getProfileDisplayName(profile);
  }

  if (state.dom.resetPasswordTargetEmail) {
    state.dom.resetPasswordTargetEmail.textContent =
      profile.email || "No email on record";
  }

  clearResetPasswordModal();
  state.currentResetTarget = profile;

  const modalEl = state.dom.resetPasswordModal;
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  // ADMIN PASSWORD RESET VISIBILITY - STEP 1H
  // Ensure every fresh modal open starts masked, then focus the input.
  modalEl.addEventListener(
    "shown.bs.modal",
    () => {
      setResetPasswordVisibility(false);
      state.dom.resetPasswordTempInput?.focus();
    },
    { once: true },
  );
}

async function submitPasswordReset() {
  const profile = state.currentResetTarget;
  if (!profile) return;

  const tempPassword = String(
    state.dom.resetPasswordTempInput?.value || "",
  ).trim();

  if (tempPassword.length < 8) {
    showResetPasswordAlert(
      "warning",
      "Temporary password must be at least 8 characters.",
    );
    return;
  }

  const btn = state.dom.resetPasswordSubmitBtn;

  try {
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalHtml = btn.innerHTML;
      btn.className = "btn btn-secondary dashboard-action-btn";
      btn.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        Resetting...
      `;
    }

    clearResetPasswordAlert();

    const supabase = getSupabaseClient();

    const { data, error } = await supabase.functions.invoke(
      "reset-employee-password",
      {
        body: {
          targetEmail: String(profile.email || "").toLowerCase().trim(),
          tempPassword,
        },
      },
    );

    if (error) throw error;

    // Close the modal on success.
    const modalEl = state.dom.resetPasswordModal;
    if (modalEl) {
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    showPageAlert(
      "success",
      data?.message ||
      `Password reset successfully for ${profile.email || "user"}.`,
    );

    showDashboardToast(
      "success",
      "Password reset",
      `Temporary password set for ${getProfileDisplayName(profile)}.`,
    );
  } catch (error) {
    console.error("Password reset error:", error);
    showResetPasswordAlert(
      "danger",
      String(error?.message || "Password could not be reset. Please try again."),
    );
  } finally {
    if (btn && btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
    updateResetPasswordSubmitButtonState();
  }
}

