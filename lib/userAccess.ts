export type UserRole =
  | "chief_mechanic"
  | "number1_mechanic"
  | "number2_mechanic"
  | "engineer"
  | "guest"
  | "unknown";

export type Permission =
  | "dashboard:view"
  | "cars:view"
  | "cars:manage"
  | "job_lists:view"
  | "job_lists:edit"
  | "evening_jobs:view"
  | "evening_jobs:edit"
  | "team_jobs:view"
  | "team_jobs:create"
  | "team_jobs:publish"
  | "team_jobs:complete"
  | "post_event:view"
  | "post_event:edit"
  | "clutch:view"
  | "clutch:edit"
  | "calendar:view"
  | "calendar:manage"
  | "drain_out:view"
  | "drain_out:manage"
  | "recorded_issues:view"
  | "recorded_issues:edit"
  | "recorded_issues:delete"
  | "sticker_list:view"
  | "sticker_list:edit"
  | "sticker_list:delete"
  | "sticker_list:send";

export type UserAccess = {
  role: UserRole;
  assignedCar: number | null;
  permissions: Permission[];
  readOnly: boolean;
};

const VIEW_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "cars:view",
  "job_lists:view",
  "evening_jobs:view",
  "team_jobs:view",
  "post_event:view",
  "clutch:view",
  "calendar:view",
  "drain_out:view",
  "recorded_issues:view",
  "sticker_list:view",
];

const ALL_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "cars:view",
  "cars:manage",
  "job_lists:view",
  "job_lists:edit",
  "evening_jobs:view",
  "evening_jobs:edit",
  "team_jobs:view",
  "team_jobs:create",
  "team_jobs:publish",
  "team_jobs:complete",
  "post_event:view",
  "post_event:edit",
  "clutch:view",
  "clutch:edit",
  "calendar:view",
  "calendar:manage",
  "drain_out:view",
  "drain_out:manage",
  "recorded_issues:view",
  "recorded_issues:edit",
  "recorded_issues:delete",
  "sticker_list:view",
  "sticker_list:edit",
  "sticker_list:delete",
  "sticker_list:send",
];

const NUMBER1_MECHANIC_PERMISSIONS: Permission[] = [
  "job_lists:view",
  "job_lists:edit",
  "evening_jobs:view",
  "evening_jobs:edit",
  "team_jobs:view",
  "team_jobs:complete",
  "post_event:view",
  "post_event:edit",
  "clutch:view",
  "clutch:edit",
  "drain_out:view",
  "recorded_issues:view",
  "recorded_issues:edit",
  "sticker_list:view",
  "sticker_list:edit",
];

const NUMBER2_MECHANIC_PERMISSIONS: Permission[] = [
  "team_jobs:view",
  "team_jobs:complete",
  "drain_out:view",
  "recorded_issues:view",
  "recorded_issues:edit",
  "sticker_list:view",
];

const ENGINEER_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "cars:view",
  "team_jobs:view",
  "post_event:view",
  "clutch:view",
  "calendar:view",
  "drain_out:view",
  "recorded_issues:view",
  "recorded_issues:edit",
  "sticker_list:view",
];

/*
 * Showcase guest profile.
 * Guest can view the whole app, but cannot write/edit/delete/send/clear/submit.
 */
const GUEST_PERMISSIONS: Permission[] = VIEW_PERMISSIONS;

const LOGIN_ALIASES: Record<string, string> = {
  iamaguest: "guest@rodinmotorsport.com",
};

const USER_ACCESS: Record<string, UserAccess> = {
  "dan.crain@rodinmotorsport.com": {
    role: "chief_mechanic",
    assignedCar: null,
    permissions: ALL_PERMISSIONS,
    readOnly: false,
  },

  "simon.crain@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 1,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
    readOnly: false,
  },

  "olli.moss@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 2,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
    readOnly: false,
  },

  "jack.carter@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 3,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
    readOnly: false,
  },

  "ben.southern@rodinmotorsport.com": {
    role: "number2_mechanic",
    assignedCar: null,
    permissions: NUMBER2_MECHANIC_PERMISSIONS,
    readOnly: false,
  },

  "charlie.lawman@rodinmotorsport.com": {
    role: "number2_mechanic",
    assignedCar: null,
    permissions: NUMBER2_MECHANIC_PERMISSIONS,
    readOnly: false,
  },

  "alec.dixon@rodinmotorsport.com": {
    role: "engineer",
    assignedCar: null,
    permissions: ENGINEER_PERMISSIONS,
    readOnly: false,
  },

  "guest@rodinmotorsport.com": {
    role: "guest",
    assignedCar: null,
    permissions: GUEST_PERMISSIONS,
    readOnly: true,
  },
};

export function normaliseEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function resolveLoginIdentifier(
  identifier: string | null | undefined,
): string {
  const cleanIdentifier = normaliseEmail(identifier);

  return LOGIN_ALIASES[cleanIdentifier] ?? cleanIdentifier;
}

export function getUserAccess(email: string | null | undefined): UserAccess {
  const cleanEmail = normaliseEmail(email);

  return (
    USER_ACCESS[cleanEmail] ?? {
      role: "unknown",
      assignedCar: null,
      permissions: [],
      readOnly: true,
    }
  );
}

export function getUserRole(email: string | null | undefined): UserRole {
  return getUserAccess(email).role;
}

export function getAssignedCar(email: string | null | undefined): number | null {
  return getUserAccess(email).assignedCar;
}

export function getUserPermissions(
  email: string | null | undefined,
): Permission[] {
  return getUserAccess(email).permissions;
}

export function hasPermission(
  email: string | null | undefined,
  permission: Permission,
): boolean {
  return getUserAccess(email).permissions.includes(permission);
}

export function hasAnyPermission(
  email: string | null | undefined,
  permissions: Permission[],
): boolean {
  const userPermissions = getUserAccess(email).permissions;

  return permissions.some((permission) => userPermissions.includes(permission));
}

/*
 * This is the key guest lockout.
 * Anything that writes, edits, deletes, sends, clears, allocates, uploads,
 * completes, publishes, or submits must use canWrite() or isReadOnlyUser().
 */
export function isReadOnlyUser(email: string | null | undefined): boolean {
  const access = getUserAccess(email);

  return access.readOnly === true || access.role === "guest";
}

export function canWrite(
  email: string | null | undefined,
  permission: Permission,
): boolean {
  return !isReadOnlyUser(email) && hasPermission(email, permission);
}

export function canAccessDashboard(email: string | null | undefined): boolean {
  return hasPermission(email, "dashboard:view");
}

export function canManageCars(email: string | null | undefined): boolean {
  return canWrite(email, "cars:manage");
}

export function canAccessTeamJobs(email: string | null | undefined): boolean {
  return hasPermission(email, "team_jobs:view");
}

export function canCreateTeamJobs(email: string | null | undefined): boolean {
  return canWrite(email, "team_jobs:create");
}

export function canPublishTeamJobs(email: string | null | undefined): boolean {
  return canWrite(email, "team_jobs:publish");
}

export function canCompleteTeamJobs(email: string | null | undefined): boolean {
  return canWrite(email, "team_jobs:complete");
}

export function canManageTeamJobs(email: string | null | undefined): boolean {
  return (
    canCreateTeamJobs(email) &&
    canPublishTeamJobs(email)
  );
}

export function canAccessDrainOut(email: string | null | undefined): boolean {
  return hasPermission(email, "drain_out:view");
}

export function canManageDrainOut(email: string | null | undefined): boolean {
  return canWrite(email, "drain_out:manage");
}

export function canAccessRecordedIssues(
  email: string | null | undefined,
): boolean {
  return hasPermission(email, "recorded_issues:view");
}

export function canEditRecordedIssues(
  email: string | null | undefined,
): boolean {
  return canWrite(email, "recorded_issues:edit");
}

export function canDeleteRecordedIssues(
  email: string | null | undefined,
): boolean {
  return canWrite(email, "recorded_issues:delete");
}

export function canAccessStickerList(email: string | null | undefined): boolean {
  return hasPermission(email, "sticker_list:view");
}

export function canEditStickerList(email: string | null | undefined): boolean {
  return canWrite(email, "sticker_list:edit");
}

export function canDeleteStickerList(email: string | null | undefined): boolean {
  return canWrite(email, "sticker_list:delete");
}

export function canSendStickerList(email: string | null | undefined): boolean {
  return canWrite(email, "sticker_list:send");
}

export function canAccessClutch(email: string | null | undefined): boolean {
  return hasPermission(email, "clutch:view");
}

export function canEditClutch(email: string | null | undefined): boolean {
  return canWrite(email, "clutch:edit");
}

export function canAccessPostEvent(email: string | null | undefined): boolean {
  return hasPermission(email, "post_event:view");
}

export function canEditPostEvent(email: string | null | undefined): boolean {
  return canWrite(email, "post_event:edit");
}

export function canAccessCalendar(email: string | null | undefined): boolean {
  return hasPermission(email, "calendar:view");
}

export function canManageCalendar(email: string | null | undefined): boolean {
  return canWrite(email, "calendar:manage");
}

export function canAccessCarPages(
  email: string | null | undefined,
  carId: number,
): boolean {
  const access = getUserAccess(email);

  if (access.role === "chief_mechanic") {
    return true;
  }

  if (access.role === "engineer" || access.role === "guest") {
    return hasPermission(email, "cars:view");
  }

  if (access.role === "number1_mechanic") {
    return access.assignedCar === carId;
  }

  return false;
}

export function getLoginRedirect(email: string | null | undefined): string {
  const access = getUserAccess(email);

  if (access.role === "chief_mechanic") {
    return "/dashboard";
  }

  if (access.role === "number1_mechanic" && access.assignedCar) {
    return `/car/${access.assignedCar}/job-list`;
  }

  if (access.role === "number2_mechanic") {
    return "/drain-out";
  }

  if (access.role === "engineer") {
    return "/recorded-issues";
  }

  if (access.role === "guest") {
    return "/dashboard";
  }

  return "/login";
}

/*
 * Convenience helpers.
 */
export function isChiefMechanic(email: string | null | undefined): boolean {
  return getUserRole(email) === "chief_mechanic";
}

export function isNumber1Mechanic(email: string | null | undefined): boolean {
  return getUserRole(email) === "number1_mechanic";
}

export function isNumber2Mechanic(email: string | null | undefined): boolean {
  return getUserRole(email) === "number2_mechanic";
}

export function isEngineer(email: string | null | undefined): boolean {
  return getUserRole(email) === "engineer";
}

export function isGuest(email: string | null | undefined): boolean {
  return getUserRole(email) === "guest";
}

/*
 * Use this in pages to show a small banner or disable forms.
 */
export function getReadOnlyMessage(email: string | null | undefined): string {
  if (isGuest(email)) {
    return "Guest mode is view-only. Editing, deleting, submitting, sending, uploading and clearing actions are disabled.";
  }

  return "";
}