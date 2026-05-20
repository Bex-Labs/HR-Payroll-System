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

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Load tenant/company records after Admin access is confirmed.
    await refreshTenantWorkspace();

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
    // Load profiles so Admin can manage company-scoped user access.
    await refreshProfileTenantLinkingWorkspace();

    // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
    // Load the controlled event catalogue and latest audit ledger rows.
    // This only reads the new audit tables; individual modules are not wired yet.
    await refreshAdminAuditCentre();

    switchAdminWorkspace("profile");

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Expose tenant edit action for the Tenant Records table.
    window.adminEditTenantRecord = (tenantId) => {
      startTenantEdit(tenantId);
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

const state = {
  currentUser: null,
  currentProfile: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Holds tenant/company records created by Admin.
  tenants: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Tracks the tenant currently being edited.
  currentEditingTenant: null,

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Holds user profiles for Admin access setup.
  profilesForTenantLinking: [],

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1E-2
  // Tracks the profile currently being edited for company access.
  currentEditingProfileTenantLink: null,

  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
  // Read-only shell state for controlled audit/activity events.
  // Future module wiring will write into system_activity_events through the RPC.
  systemEventTypes: [],
  systemActivityEvents: [],
  filteredSystemActivityEvents: [],

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

    // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
    // Dedicated workspace tab and section for audit visibility.
    adminTabAuditBtn: document.getElementById("adminTabAuditBtn"),

    // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
    // Tenant workspace tab and section.
    adminTabTenantsBtn: document.getElementById("adminTabTenantsBtn"),

    adminProfileSection: document.getElementById("adminProfileSection"),
    adminOverviewSection: document.getElementById("adminOverviewSection"),

    // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
    // Read-only audit/notification workspace section.
    adminAuditSection: document.getElementById("adminAuditSection"),

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
    // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
    // Summary, filter, and table controls for the controlled event ledger.
    adminAuditActiveNotificationCount: document.getElementById("adminAuditActiveNotificationCount"),
    adminAuditCriticalCount: document.getElementById("adminAuditCriticalCount"),
    adminAuditWarningCount: document.getElementById("adminAuditWarningCount"),
    adminAuditRoutineCount: document.getElementById("adminAuditRoutineCount"),
    adminAuditRefreshBtn: document.getElementById("adminAuditRefreshBtn"),
    adminAuditClearFiltersBtn: document.getElementById("adminAuditClearFiltersBtn"),
    // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B CLEANUP
    // Keep the visible Audit Centre filters lean:
    // search, event type, severity, status, and date range.
    adminAuditEventTypeFilter: document.getElementById("adminAuditEventTypeFilter"),
    adminAuditSeverityFilter: document.getElementById("adminAuditSeverityFilter"),
    adminAuditStatusFilter: document.getElementById("adminAuditStatusFilter"),
    adminAuditDateFrom: document.getElementById("adminAuditDateFrom"),
    adminAuditDateTo: document.getElementById("adminAuditDateTo"),
    adminAuditSearchInput: document.getElementById("adminAuditSearchInput"),
    adminAuditVisibleCount: document.getElementById("adminAuditVisibleCount"),
    adminAuditRecordsEmptyState: document.getElementById("adminAuditRecordsEmptyState"),
    adminAuditRecordsTableWrapper: document.getElementById("adminAuditRecordsTableWrapper"),
    adminAuditRecordsTableBody: document.getElementById("adminAuditRecordsTableBody"),

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

  collapseAdminDashboardWorkingCardsByDefault();

  state.dom.dashboardToastCloseBtn?.addEventListener("click", () => {
    hideDashboardToast();
  });

  window.addEventListener("scroll", updateBackToTopButtonVisibility);
  updateBackToTopButtonVisibility();

  state.dom.adminTabProfileBtn?.addEventListener("click", () => {
    switchAdminWorkspace("profile");
  });

  state.dom.adminTabOverviewBtn?.addEventListener("click", () => {
    switchAdminWorkspace("overview");
  });

  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
  // Open the read-only audit and notification workspace.
  state.dom.adminTabAuditBtn?.addEventListener("click", () => {
    switchAdminWorkspace("audit");
  });

  // HRP-80 - TENANT / COMPANY LOGIN SEGMENTATION - STEP 1C
  // Open tenant/company setup workspace.
  state.dom.adminTabTenantsBtn?.addEventListener("click", () => {
    switchAdminWorkspace("tenants");
  });

  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
  // Keep the audit shell responsive without wiring any business modules yet.
  state.dom.adminAuditRefreshBtn?.addEventListener("click", async () => {
    await refreshAdminAuditCentre({ showToast: true });
  });

  state.dom.adminAuditClearFiltersBtn?.addEventListener("click", () => {
    clearAdminAuditFilters();
  });

  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B CLEANUP
  // Bind only the lean professional filter set.
  [
    state.dom.adminAuditEventTypeFilter,
    state.dom.adminAuditSeverityFilter,
    state.dom.adminAuditStatusFilter,
    state.dom.adminAuditDateFrom,
    state.dom.adminAuditDateTo,
    state.dom.adminAuditSearchInput,
  ].forEach((field) => {
    field?.addEventListener("input", applyAdminAuditFilters);
    field?.addEventListener("change", applyAdminAuditFilters);
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
    } finally {
      setAdminActionButtonLoading(state.dom.refreshTenantsBtn, false);
    }
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

  state.dom.resetPasswordToggleBtn?.addEventListener("click", () => {
    const input = state.dom.resetPasswordTempInput;
    const icon = state.dom.resetPasswordToggleIcon;
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    if (icon) {
      icon.className = isPassword ? "bi bi-eye-slash" : "bi bi-eye";
    }
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

  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
  // Add Audit Centre as a fourth Admin workspace without changing
  // Profile, Overview, or Companies behaviour.
  const isAudit = workspace === "audit";

  const isTenants = workspace === "tenants";

  state.dom.adminProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.adminOverviewSection?.classList.toggle("d-none", !isOverview);
  state.dom.adminAuditSection?.classList.toggle("d-none", !isAudit);
  state.dom.adminTenantsSection?.classList.toggle("d-none", !isTenants);

  // ADMIN UI CLEANUP - STEP 1A
  // Keep Admin workspace tabs visually aligned with the HR dashboard switcher.
  // Existing IDs and workspace keys are unchanged to avoid breaking current event bindings.
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

  if (state.dom.adminTabAuditBtn) {
    state.dom.adminTabAuditBtn.className = isAudit
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
        : isAudit
          ? "Notification & Audit Centre"
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

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Normalise text for client-side filtering without changing saved database values.
function normalizeAdminAuditText(value = "") {
  return String(value || "").trim().toLowerCase();
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Audit rows need date and time because they are evidence records, not just summary records.
function formatAdminAuditDateTime(value) {
  if (!value) return "--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Keep UUID display compact until employee/profile joins are added in later wiring steps.
function formatAdminAuditShortId(value = "") {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return "--";

  return cleanValue.length > 12
    ? `${cleanValue.slice(0, 8)}...`
    : cleanValue;
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Badge colours reflect HR/Admin attention level only. They do not change stored severity.
function getAdminAuditSeverityBadgeClass(severity = "") {
  const normalisedSeverity = normalizeAdminAuditText(severity);

  if (normalisedSeverity === "critical") return "text-bg-danger";
  if (normalisedSeverity === "warning") return "text-bg-warning";
  if (normalisedSeverity === "success") return "text-bg-success";
  if (normalisedSeverity === "info") return "text-bg-primary";

  return "text-bg-light border text-dark";
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Status badge is display-only and supports both activity status and notification status.
function getAdminAuditStatusBadgeClass(status = "") {
  const normalisedStatus = normalizeAdminAuditText(status);

  if (normalisedStatus === "open") return "text-bg-warning";
  if (normalisedStatus === "in progress") return "text-bg-primary";
  if (normalisedStatus === "resolved") return "text-bg-success";
  if (normalisedStatus === "dismissed") return "text-bg-secondary";
  if (normalisedStatus === "logged") return "text-bg-light border text-dark";

  return "text-bg-light border text-dark";
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Find the configured event type label from the event catalogue loaded from Supabase.
function getAdminAuditEventType(eventTypeKey = "") {
  const key = String(eventTypeKey || "").trim();

  return (state.systemEventTypes || []).find(
    (eventType) => String(eventType.event_type_key || "").trim() === key,
  ) || null;
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Rebuild the Event Type filter from system_event_types so Admin filters remain database-driven.
function populateAdminAuditEventTypeOptions() {
  const select = state.dom.adminAuditEventTypeFilter;
  if (!select) return;

  const currentValue = String(select.value || "").trim();

  select.innerHTML = `<option value="">All event types</option>`;

  [...(state.systemEventTypes || [])]
    .sort((a, b) => {
      const aOrder = Number(a.sort_order || 100);
      const bOrder = Number(b.sort_order || 100);

      if (aOrder !== bOrder) return aOrder - bOrder;

      return String(a.event_label || "").localeCompare(
        String(b.event_label || ""),
        undefined,
        { sensitivity: "base" },
      );
    })
    .forEach((eventType) => {
      const option = document.createElement("option");
      option.value = eventType.event_type_key;
      option.textContent = eventType.event_label || eventType.event_type_key;
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
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Loading row for the read-only audit table.
function renderAdminAuditLoadingState() {
  const tbody = state.dom.adminAuditRecordsTableBody;
  if (!tbody) return;

  state.dom.adminAuditRecordsEmptyState?.classList.add("d-none");
  state.dom.adminAuditRecordsTableWrapper?.classList.remove("d-none");

  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center text-secondary py-4">
        Loading audit and notification records.
      </td>
    </tr>
  `;
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Summary counts are calculated from all loaded ledger rows, not only visible filtered rows.
function renderAdminAuditSummary(records = []) {
  const rows = Array.isArray(records) ? records : [];

  const activeNotifications = rows.filter((record) => {
    const notificationStatus = normalizeAdminAuditText(record.notification_status);
    return Boolean(record.is_active_notification) &&
      ["open", "in progress"].includes(notificationStatus);
  }).length;

  const criticalEvents = rows.filter(
    (record) => normalizeAdminAuditText(record.severity) === "critical",
  ).length;

  const warningEvents = rows.filter(
    (record) => normalizeAdminAuditText(record.severity) === "warning",
  ).length;

  const routineEvents = rows.filter(
    (record) => !record.is_active_notification,
  ).length;

  if (state.dom.adminAuditActiveNotificationCount) {
    state.dom.adminAuditActiveNotificationCount.textContent = String(activeNotifications);
  }

  if (state.dom.adminAuditCriticalCount) {
    state.dom.adminAuditCriticalCount.textContent = String(criticalEvents);
  }

  if (state.dom.adminAuditWarningCount) {
    state.dom.adminAuditWarningCount.textContent = String(warningEvents);
  }

  if (state.dom.adminAuditRoutineCount) {
    state.dom.adminAuditRoutineCount.textContent = String(routineEvents);
  }
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Render latest audit rows. No resolve/dismiss actions are added in this shell step.
function renderAdminAuditRecords(records = []) {
  const tbody = state.dom.adminAuditRecordsTableBody;
  if (!tbody) return;

  const rows = Array.isArray(records) ? records : [];

  if (state.dom.adminAuditVisibleCount) {
    state.dom.adminAuditVisibleCount.textContent = String(rows.length);
  }

  tbody.innerHTML = "";

  if (!rows.length) {
    state.dom.adminAuditRecordsEmptyState?.classList.remove("d-none");
    state.dom.adminAuditRecordsTableWrapper?.classList.add("d-none");
    return;
  }

  state.dom.adminAuditRecordsEmptyState?.classList.add("d-none");
  state.dom.adminAuditRecordsTableWrapper?.classList.remove("d-none");

  rows.forEach((record) => {
    const eventType = getAdminAuditEventType(record.event_type_key);
    const eventLabel = eventType?.event_label || record.event_type_key || "System Event";

    const employeeOrTarget =
      String(record.target_email || "").trim() ||
      String(record.employee_id || "").trim() ||
      String(record.target_profile_id || "").trim() ||
      "--";

    const notificationLabel = record.is_active_notification
      ? record.notification_status || "Open"
      : "Audit Only";

    const sourceLabel = [
      record.source_module,
      record.source_table,
      record.related_reference,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" / ") || "--";

    const row = document.createElement("tr");

    row.innerHTML = `
      <td class="text-nowrap">
        ${escapeHtml(formatAdminAuditDateTime(record.created_at))}
      </td>

      <td>
        <div class="fw-semibold">${escapeHtml(record.event_title || eventLabel)}</div>
        <div class="text-secondary small">${escapeHtml(eventLabel)}</div>
        ${record.event_message
        ? `<div class="small text-secondary mt-1">${escapeHtml(record.event_message)}</div>`
        : ""}
      </td>

      <td>
        <div class="text-break">${escapeHtml(employeeOrTarget.includes("@") ? employeeOrTarget : formatAdminAuditShortId(employeeOrTarget))}</div>
      </td>

      <td>
        <span class="badge rounded-pill text-bg-light border">
          ${escapeHtml(record.actor_role || "--")}
        </span>
        <div class="small text-secondary text-break mt-1">
          ${escapeHtml(record.actor_email || "--")}
        </div>
      </td>

      <td>
        <span class="badge ${getAdminAuditSeverityBadgeClass(record.severity)}">
          ${escapeHtml(record.severity || "--")}
        </span>
      </td>

      <td>
        <span class="badge ${getAdminAuditStatusBadgeClass(record.event_status)}">
          ${escapeHtml(record.event_status || "--")}
        </span>
      </td>

      <td>
        <span class="badge ${record.is_active_notification ? getAdminAuditStatusBadgeClass(notificationLabel) : "text-bg-light border text-dark"}">
          ${escapeHtml(notificationLabel)}
        </span>
      </td>

      <td class="small text-secondary">
        ${escapeHtml(sourceLabel)}
      </td>
    `;

    tbody.appendChild(row);
  });
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Apply client-side filters against the loaded audit ledger rows.
function applyAdminAuditFilters() {
  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B CLEANUP
  // Employee/target and actor role are covered by the keyword search.
  // This keeps the visible filter surface lean while preserving investigation capability.
  const eventTypeFilter = String(state.dom.adminAuditEventTypeFilter?.value || "").trim();
  const severityFilter = normalizeAdminAuditText(state.dom.adminAuditSeverityFilter?.value || "");
  const statusFilter = normalizeAdminAuditText(state.dom.adminAuditStatusFilter?.value || "");
  const dateFrom = String(state.dom.adminAuditDateFrom?.value || "").trim();
  const dateTo = String(state.dom.adminAuditDateTo?.value || "").trim();
  const searchTerm = normalizeAdminAuditText(state.dom.adminAuditSearchInput?.value || "");

  const fromTime = dateFrom
    ? new Date(`${dateFrom}T00:00:00`).getTime()
    : null;

  const toTime = dateTo
    ? new Date(`${dateTo}T23:59:59`).getTime()
    : null;

  let rows = [...(state.systemActivityEvents || [])];

  rows = rows.filter((record) => {
    if (eventTypeFilter && String(record.event_type_key || "").trim() !== eventTypeFilter) {
      return false;
    }

    if (severityFilter && normalizeAdminAuditText(record.severity) !== severityFilter) {
      return false;
    }


    if (statusFilter) {
      const eventStatus = normalizeAdminAuditText(record.event_status);
      const notificationStatus = normalizeAdminAuditText(record.notification_status);

      if (eventStatus !== statusFilter && notificationStatus !== statusFilter) {
        return false;
      }
    }

    if (fromTime || toTime) {
      const createdTime = new Date(record.created_at || "").getTime();

      if (!Number.isFinite(createdTime)) return false;
      if (fromTime && createdTime < fromTime) return false;
      if (toTime && createdTime > toTime) return false;
    }


    if (searchTerm) {
      const eventType = getAdminAuditEventType(record.event_type_key);

      const searchableText = [
        record.event_type_key,
        eventType?.event_label,
        eventType?.event_category,
        record.event_title,
        record.event_message,

        // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B CLEANUP
        // Include employee and target profile identifiers in the single keyword search
        // so Admin can investigate employee/target records without separate noisy filters.
        record.employee_id,
        record.target_profile_id,

        record.actor_email,
        record.actor_role,
        record.target_email,
        record.source_module,
        record.source_table,
        record.related_reference,
        record.severity,
        record.event_status,
        record.notification_status,
      ].join(" ").toLowerCase();

      if (!searchableText.includes(searchTerm)) {
        return false;
      }
    }

    return true;
  });

  state.filteredSystemActivityEvents = rows;
  renderAdminAuditRecords(rows);
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Clear filters only; do not delete or update any audit records.
function clearAdminAuditFilters() {
  // ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B CLEANUP
  // Clear only the visible professional filter set.
  [
    state.dom.adminAuditEventTypeFilter,
    state.dom.adminAuditSeverityFilter,
    state.dom.adminAuditStatusFilter,
    state.dom.adminAuditDateFrom,
    state.dom.adminAuditDateTo,
    state.dom.adminAuditSearchInput,
  ].forEach((field) => {
    if (field) field.value = "";
  });

  applyAdminAuditFilters();

  showDashboardToast(
    "info",
    "Audit filters cleared",
    "All audit and notification filters have been reset.",
  );
}

// ADMIN / HR NOTIFICATION & AUDIT CENTRE - STEP 1B
// Read the controlled event catalogue and latest activity ledger rows.
// This is intentionally read-only in the UI shell step.
async function refreshAdminAuditCentre(options = {}) {
  const { showToast = false } = options;
  const button = state.dom.adminAuditRefreshBtn;

  try {
    setAdminActionButtonLoading(button, true, "Refreshing Audit...");
    renderAdminAuditLoadingState();

    const supabase = getSupabaseClient();

    const [eventTypesResponse, eventsResponse] = await Promise.all([
      supabase
        .from("system_event_types")
        .select("event_type_key, event_label, event_category, default_severity, default_requires_notification, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),

      supabase
        .from("system_activity_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (eventTypesResponse.error) throw eventTypesResponse.error;
    if (eventsResponse.error) throw eventsResponse.error;

    state.systemEventTypes = Array.isArray(eventTypesResponse.data)
      ? eventTypesResponse.data
      : [];

    state.systemActivityEvents = Array.isArray(eventsResponse.data)
      ? eventsResponse.data
      : [];

    populateAdminAuditEventTypeOptions();
    renderAdminAuditSummary(state.systemActivityEvents);
    applyAdminAuditFilters();

    if (showToast) {
      showDashboardToast(
        "success",
        "Audit refreshed",
        `${state.systemActivityEvents.length} audit record(s) loaded.`,
      );
    }
  } catch (error) {
    console.error("Error loading Admin Audit Centre:", error);

    state.systemEventTypes = [];
    state.systemActivityEvents = [];
    state.filteredSystemActivityEvents = [];

    populateAdminAuditEventTypeOptions();
    renderAdminAuditSummary([]);
    renderAdminAuditRecords([]);

    showPageAlert(
      "danger",
      error.message || "Notification and audit records could not be loaded.",
    );
  } finally {
    setAdminActionButtonLoading(button, false);
  }
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

function clearResetPasswordModal() {
  state.currentResetTarget = null;

  if (state.dom.resetPasswordTempInput) {
    state.dom.resetPasswordTempInput.value = "";
    state.dom.resetPasswordTempInput.type = "password";
  }

  if (state.dom.resetPasswordToggleIcon) {
    state.dom.resetPasswordToggleIcon.className = "bi bi-eye";
  }

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

  // Focus the password field once the modal finishes opening.
  modalEl.addEventListener(
    "shown.bs.modal",
    () => {
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

