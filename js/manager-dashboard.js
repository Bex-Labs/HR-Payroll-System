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
    switchManagerWorkspace("profile");
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

const state = {
  currentUser: null,
  currentProfile: null,
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
    refreshTeamBtn: document.getElementById("refreshTeamBtn"),
    teamSearchInput: document.getElementById("teamSearchInput"),

    managerTabProfileBtn: document.getElementById("managerTabProfileBtn"),
    managerTabTeamBtn: document.getElementById("managerTabTeamBtn"),
    managerProfileSection: document.getElementById("managerProfileSection"),
    managerTeamSection: document.getElementById("managerTeamSection"),

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

    processedRequestsEmptyState: document.getElementById(
      "processedRequestsEmptyState",
    ),
    processedRequestsTableWrapper: document.getElementById(
      "processedRequestsTableWrapper",
    ),
    processedRequestsTableBody: document.getElementById(
      "processedRequestsTableBody",
    ),

    teamScheduleEmptyState: document.getElementById("teamScheduleEmptyState"),
    teamScheduleTableWrapper: document.getElementById(
      "teamScheduleTableWrapper",
    ),
    teamScheduleTableBody: document.getElementById("teamScheduleTableBody"),

    teamEmptyState: document.getElementById("teamEmptyState"),
    teamTableWrapper: document.getElementById("teamTableWrapper"),
    teamTableBody: document.getElementById("teamTableBody"),
  };
}

function bindEvents() {
  state.dom.logoutBtn?.addEventListener("click", async () => {
    await window.SessionManager.logoutUser("logout");
  });

  state.dom.managerTabProfileBtn?.addEventListener("click", () => {
    switchManagerWorkspace("profile");
  });

  state.dom.managerTabTeamBtn?.addEventListener("click", () => {
    switchManagerWorkspace("team");
  });

  state.dom.managerProfileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveManagerOwnProfile();
  });

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
      await applyApprovedLeaveToBalance(request);
    }

    await persistLeaveDecision(request.id, status, comment);

    notifyLeaveDecisionChanged();

    showPageAlert(
      "success",
      `${request.employeeName}'s leave request was ${status.toLowerCase()} successfully.`,
    );

    state.leaveDecisionModal?.hide();
    await loadTeamLeaveVisibility();
  } catch (error) {
    console.error("Error saving leave decision:", error);

    const errorMessage =
      error?.message ||
      error?.details ||
      error?.hint ||
      "The leave decision could not be saved. Please try again.";

    showPageAlert("danger", errorMessage);
    window.alert(`Leave decision save failed:

${errorMessage}`);
  } finally {
    setDecisionModalLoading(false);
    setActionButtonLoading(state.pendingDecisionButton, false);
  }
}

function switchManagerWorkspace(workspace) {
  const isProfile = workspace === "profile";

  state.dom.managerProfileSection?.classList.toggle("d-none", !isProfile);
  state.dom.managerTeamSection?.classList.toggle("d-none", isProfile);

  state.dom.managerTabProfileBtn.className = isProfile
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-outline-primary dashboard-action-btn";

  state.dom.managerTabTeamBtn.className = !isProfile
    ? "btn btn-primary dashboard-action-btn"
    : "btn btn-outline-primary dashboard-action-btn";

  if (state.dom.managerModuleValue) {
    state.dom.managerModuleValue.textContent = isProfile
      ? "Profile"
      : "Team Management";
  }
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

function getInitials(fullName, fallback = "MG") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return fallback;

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
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
    if (data) state.currentProfile = data;
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
}

async function saveManagerOwnProfile() {
  const fullName = String(state.dom.managerProfileFullName?.value || "").trim();
  const department = String(
    state.dom.managerProfileDepartment?.value || "",
  ).trim();

  if (!fullName) {
    showPageAlert("warning", "Full name is required before saving your profile.");
    state.dom.managerProfileFullName?.focus();
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

  button.disabled = isLoading;

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.innerHTML = `
      <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Saving...
    `;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
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
  const supabase = getSupabaseClient();

  const managerEmail = normalizeText(
    state.currentProfile?.email || state.currentUser?.email,
  );
  const managerFullName = normalizeText(state.currentProfile?.full_name || "");

  if (!managerEmail && !managerFullName) {
    showPageAlert(
      "warning",
      "Your manager profile is missing both email and full name, so assigned team members could not be resolved.",
    );
    renderTeamTable([]);
    renderSummaryTiles([]);
    return false;
  }

  try {
    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .order("created_at", { ascending: false });

    if (employeeError) throw employeeError;

    // MANAGER APPROVAL WIRING HARDENING - STEP 1B
    // Employee visibility is now controlled by employee_reporting_lines + RLS.
    // Do not re-filter with old free-text manager fields here, otherwise
    // valid reporting-line employees can disappear from the Manager dashboard.
    const matchedEmployees = Array.isArray(employeeRows) ? employeeRows : [];

    const workEmails = matchedEmployees
      .map((employee) => normalizeText(getWorkEmail(employee)))
      .filter(Boolean);

    let profilesByEmail = new Map();

    if (workEmails.length) {
      const uniqueEmails = [...new Set(workEmails)];

      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .in("email", uniqueEmails);

      if (profileError) throw profileError;

      profilesByEmail = new Map(
        (profileRows || []).map((profile) => [
          normalizeText(profile.email),
          profile,
        ]),
      );
    }

    const enrichedTeamMembers = matchedEmployees.map((employee) => {
      const workEmail = getWorkEmail(employee);
      const matchedProfile =
        profilesByEmail.get(normalizeText(workEmail)) || null;

      return {
        id: employee.id,
        raw: employee,
        employeeFullName: getEmployeeFullName(employee),
        work_email: workEmail || "--",
        department: getDepartment(employee),
        job_title: getJobTitle(employee),
        employment_date: getEmploymentDate(employee),
        matchedProfile,
        // MANAGER APPROVAL WIRING HARDENING - STEP 1B
        // RLS has already confirmed this employee is assigned to the manager.
        // Keep any legacy label if present, otherwise show the new source-of-truth label.
        relationshipLabel:
          getManagerRelationshipLabel(employee, managerEmail, managerFullName) ||
          "Primary Manager",
        teamStatusLabel: getTeamStatusLabel(matchedProfile),
        teamStatusBadgeClass: getTeamStatusBadgeClass(matchedProfile),
      };
    });

    state.teamMembers = enrichedTeamMembers;
    applyTeamFilter();

    if (!enrichedTeamMembers.length) {
      showPageAlert(
        "warning",
        "No assigned team members were found. This usually means no employees are assigned to this manager, or employee visibility is blocked.",
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
      <td colspan="7" class="text-center text-secondary py-4">
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

    row.innerHTML = `
      <td><div class="fw-semibold">${escapeHtml(member.employeeFullName)}</div></td>
      <td class="text-break">${escapeHtml(member.work_email || "--")}</td>
      <td>${escapeHtml(member.department || "--")}</td>
      <td>${escapeHtml(member.job_title || "--")}</td>
      <td>
        <span class="badge ${member.teamStatusBadgeClass}">
          ${escapeHtml(member.teamStatusLabel)}
        </span>
      </td>
      <td>${escapeHtml(member.relationshipLabel)}</td>
      <td>${formatDate(member.employment_date)}</td>
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
          name
        )
      `,
      )
      .in("employee_id", uniqueLeaveIds)
      .order("start_date", { ascending: true });

    if (leaveError) throw leaveError;

    const leaveRowsArray = Array.isArray(leaveRows) ? leaveRows : [];
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

        return {
          ...leaveRow,
          employeeName: owner.employeeFullName,
          employeeEmail: owner.work_email,
          employeeDepartment: owner.department,
          leaveTypeName: leaveRow.leave_types?.name || "Unknown",
          employeeRecordId: owner.id,
        };
      })
      .filter(Boolean);

    const pendingRequests = enrichedLeaveItems.filter(
      (item) => normalizeText(item.status) === "pending approval",
    );

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
      <td colspan="9" class="text-center text-secondary py-4">
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

    row.innerHTML = `
      <td>${escapeHtml(request.employeeName)}</td>
      <td>${escapeHtml(request.leaveTypeName)}</td>
      <td>${formatDate(request.start_date)}</td>
      <td>${formatDate(request.end_date)}</td>
      <td>${escapeHtml(request.total_days)}</td>
      <td>
        <span class="badge ${getStatusBadgeClass(request.status)}">
          ${escapeHtml(request.status)}
        </span>
      </td>
      <td>${buildOverlapCellHtml(request)}</td>
      <td>${formatDateTime(request.submitted_at)}</td>
      <td>
        <div class="d-flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-sm btn-success"
            onclick="window.managerHandleLeaveAction('${String(request.id).replaceAll("'", "\\'")}','approve',this)"
          >
            Approve
          </button>

          <button
            type="button"
            class="btn btn-sm btn-danger"
            onclick="window.managerHandleLeaveAction('${String(request.id).replaceAll("'", "\\'")}','reject',this)"
          >
            Reject
          </button>

          <button
            type="button"
            class="btn btn-sm btn-warning"
            onclick="window.managerHandleLeaveAction('${String(request.id).replaceAll("'", "\\'")}','return',this)"
          >
            Return
          </button>
        </div>
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
      <td colspan="8" class="text-center text-secondary py-4">
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

    row.innerHTML = `
      <td>${escapeHtml(request.employeeName)}</td>
      <td>${escapeHtml(request.leaveTypeName)}</td>
      <td>
        <div>${formatDate(request.start_date)}</div>
        <div class="text-secondary small">to ${formatDate(request.end_date)}</div>
      </td>
      <td>${escapeHtml(request.total_days)}</td>
      <td>
        <span class="badge ${getStatusBadgeClass(request.status)}">
          ${escapeHtml(request.status)}
        </span>
      </td>
      <td>${escapeHtml(request.decision_by_name || "--")}</td>
      <td>${formatDateTime(request.decision_at)}</td>
      <td>${escapeHtml(request.decision_comment || "--")}</td>
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
      <td colspan="7" class="text-center text-secondary py-4">
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

    row.innerHTML = `
      <td>${escapeHtml(item.employeeName)}</td>
      <td>${escapeHtml(item.leaveTypeName)}</td>
      <td>${formatDate(item.start_date)}</td>
      <td>${formatDate(item.end_date)}</td>
      <td>${escapeHtml(item.total_days)}</td>
      <td>
        <span class="badge ${getStatusBadgeClass(item.status)}">
          ${escapeHtml(item.status)}
        </span>
      </td>
      <td>${buildOverlapCellHtml(item)}</td>
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