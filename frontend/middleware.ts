import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@backend/security/headers";

/** Every response leaves with the same security headers. */
export function middleware(request: NextRequest) {
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  // The shell reads the address to decide whether the sidebar opens a
  // project's sections (a layout is not otherwise told which page it wraps).
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);

  const response = NextResponse.next({ request: { headers } });
  for (const [header, value] of Object.entries(securityHeaders({ https }))) {
    response.headers.set(header, value);
  }
  return response;
}

const PATH_HEADER = "x-bs-path";
