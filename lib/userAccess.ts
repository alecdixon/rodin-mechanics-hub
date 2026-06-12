export type UserRole =
  | "chief_mechanic"
  | "number1_mechanic"
  | "number2_mechanic"
  | "engineer"
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
  | "calendar:manage"
  | "drain_out:view"
  | "drain_out:manage"
  | "recorded_issues:view"
  | "recorded_issues:edit"
  | "recorded_issues:delete";

type UserAccess = {
  role: UserRole;
  assignedCar: number | null;
  permissions: Permission[];
};

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
  "calendar:manage",
  "drain_out:view",
  "drain_out:manage",
  "recorded_issues:view",
  "recorded_issues:edit",
  "recorded_issues:delete",
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
];

const NUMBER2_MECHANIC_PERMISSIONS: Permission[] = [
  "team_jobs:view",
  "team_jobs:complete",
  "drain_out:view",
  "recorded_issues:view",
  "recorded_issues:edit",
];

const ENGINEER_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "cars:view",
  "team_jobs:view",
  "post_event:view",
  "clutch:view",
  "drain_out:view",
  "recorded_issues:view",
  "recorded_issues:edit",
];

const USER_ACCESS: Record<string, UserAccess> = {
  "dan.crain@rodinmotorsport.com": {
    role: "chief_mechanic",
    assignedCar: null,
    permissions: ALL_PERMISSIONS,
  },

  "simon.crain@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 1,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
  },

  "olli.moss@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 2,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
  },

  "jack.carter@rodinmotorsport.com": {
    role: "number1_mechanic",
    assignedCar: 3,
    permissions: NUMBER1_MECHANIC_PERMISSIONS,
  },

  /*
   * Number 2 mechanics.
   * These users now land on /drain-out first after login.
   * They can then use the Team Jobs button on the drain-out page.
   */
  "ben.southern@rodinmotorsport.com": {
    role: "number2_mechanic",
    assignedCar: null,
    permissions: NUMBER2_MECHANIC_PERMISSIONS,
  },

  "charlie.lawman@rodinmotorsport.com": {
    role: "number2_mechanic",
    assignedCar: null,
    permissions: NUMBER2_MECHANIC_PERMISSIONS,
  },

  /*
   * Engineers.
   * Add real engineer Supabase Auth email addresses here.
   * Example:
   * "first.last@rodinmotorsport.com": {
   *   role: "engineer",
   *   assignedCar: null,
   *   permissions: ENGINEER_PERMISSIONS,
   * },
   */
  "alec.dixon@rodinmotorsport.com": {
    role: "engineer",
    assignedCar: null,
    permissions: ENGINEER_PERMISSIONS,
  },
};

export function normaliseEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function getUserAccess(email: string | null | undefined): UserAccess {
  const cleanEmail = normaliseEmail(email);

  return (
    USER_ACCESS[cleanEmail] ?? {
      role: "unknown",
      assignedCar: null,
      permissions: [],
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

export function canAccessDashboard(email: string | null | undefined): boolean {
  return hasPermission(email, "dashboard:view");
}

export function canManageCars(email: string | null | undefined): boolean {
  return hasPermission(email, "cars:manage");
}

export function canAccessTeamJobs(email: string | null | undefined): boolean {
  return hasPermission(email, "team_jobs:view");
}

export function canCompleteTeamJobs(email: string | null | undefined): boolean {
  return hasPermission(email, "team_jobs:complete");
}

export function canManageTeamJobs(email: string | null | undefined): boolean {
  return (
    hasPermission(email, "team_jobs:create") &&
    hasPermission(email, "team_jobs:publish")
  );
}

export function canAccessDrainOut(email: string | null | undefined): boolean {
  return hasPermission(email, "drain_out:view");
}

export function canManageDrainOut(email: string | null | undefined): boolean {
  return hasPermission(email, "drain_out:manage");
}

export function canAccessRecordedIssues(
  email: string | null | undefined,
): boolean {
  return hasPermission(email, "recorded_issues:view");
}

export function canEditRecordedIssues(
  email: string | null | undefined,
): boolean {
  return hasPermission(email, "recorded_issues:edit");
}

export function canDeleteRecordedIssues(
  email: string | null | undefined,
): boolean {
  return hasPermission(email, "recorded_issues:delete");
}

export function canAccessCarPages(
  email: string | null | undefined,
  carId: number,
): boolean {
  const access = getUserAccess(email);

  if (access.role === "chief_mechanic") {
    return true;
  }

  if (access.role === "engineer") {
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

  return "/login";
}

/*
 * Backwards compatibility helpers.
 * These let old pages that still check "chief" or "mechanic" be updated gradually.
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
