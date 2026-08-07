import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  canAccessCarPages,
  getAssignedCar,
  getLoginRedirect,
  getUserRole,
  hasPermission,
  normaliseEmail,
} from "@/lib/userAccess";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = request.nextUrl.pathname;
  const email = normaliseEmail(request.cookies.get("user-email")?.value);

  if (!email) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const role = getUserRole(email);

  if (role === "unknown") {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/recorded-issues")) {
    if (!hasPermission(email, "recorded_issues:view")) {
      url.pathname = getLoginRedirect(email);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (path.startsWith("/dashboard")) {
    if (!hasPermission(email, "dashboard:view")) {
      url.pathname = getLoginRedirect(email);
      return NextResponse.redirect(url);
    }

    if (path === "/dashboard" && role === "engineer") {
      url.pathname = "/engineer-dashboard";
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (path.startsWith("/engineer-dashboard")) {
    if (role !== "engineer") {
      url.pathname = getLoginRedirect(email);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (path.startsWith("/car/")) {
    const carIdMatch = path.match(/^\/car\/(\d+)/);
    const carId = carIdMatch ? Number(carIdMatch[1]) : null;

    if (!carId || !canAccessCarPages(email, carId)) {
      const assignedCar = getAssignedCar(email);
      url.pathname =
        role === "number1_mechanic" && assignedCar
          ? `/car/${assignedCar}/job-list`
          : getLoginRedirect(email);
      return NextResponse.redirect(url);
    }

    if (
      role === "engineer" &&
      (path.endsWith("/job-list") || path.endsWith("/evening-job-list"))
    ) {
      url.pathname = path.endsWith("/evening-job-list")
        ? `/dashboard/car/${carId}/evening-job-list`
        : `/dashboard/car/${carId}/job-list`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/engineer-dashboard/:path*", "/car/:path*", "/recorded-issues", "/recorded-issues/:path*"],
};
