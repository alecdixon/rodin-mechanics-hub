export type UserRole = "chief" | "mechanic" | "unknown";

const CHIEF_MECHANIC_EMAILS = ["dan.crain@rodinmotorsport.com"];

const MECHANIC_CAR_ASSIGNMENTS: Record<string, number> = {
  "simon.crain@rodinmotorsport.com": 1,
  "olli.moss@rodinmotorsport.com": 2,
  "jack.carter@rodinmotorsport.com": 3,
};

export function normaliseEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function getUserRole(email: string | null | undefined): UserRole {
  const cleanEmail = normaliseEmail(email);

  if (CHIEF_MECHANIC_EMAILS.includes(cleanEmail)) {
    return "chief";
  }

  if (MECHANIC_CAR_ASSIGNMENTS[cleanEmail]) {
    return "mechanic";
  }

  return "unknown";
}

export function getAssignedCar(email: string | null | undefined): number | null {
  const cleanEmail = normaliseEmail(email);
  return MECHANIC_CAR_ASSIGNMENTS[cleanEmail] ?? null;
}

export function getLoginRedirect(email: string | null | undefined): string {
  const role = getUserRole(email);

  if (role === "chief") {
    return "/dashboard";
  }

  if (role === "mechanic") {
    const carId = getAssignedCar(email);
    return `/car/${carId}`;
  }

  return "/login";
}