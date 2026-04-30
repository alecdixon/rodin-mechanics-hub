import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();

  const email = request.cookies.get("user-email")?.value;

  if (!email) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const chiefEmails = ["dan.crain@rodinmotorsport.com"];

  const mechanicCars: Record<string, number> = {
    "simon.crain@rodinmotorsport.com": 1,
    "olli.moss@rodinmotorsport.com": 2,
    "jack.carter@rodinmotorsport.com": 3,
  };

  const isChief = chiefEmails.includes(email);
  const assignedCar = mechanicCars[email];

  const path = request.nextUrl.pathname;

  // Chief trying to access mechanic routes
  if (path.startsWith("/car") && isChief) {
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Mechanic trying to access dashboard
  if (path.startsWith("/dashboard") && !isChief) {
    url.pathname = `/car/${assignedCar}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/car/:path*"],
};