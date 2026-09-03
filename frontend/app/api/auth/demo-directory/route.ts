import { demoDirectory } from "@backend/auth/accounts";
import { isDemoMode } from "@backend/auth/otp";
import { apiJson } from "@backend/http/respond";

/** The Role → State → District account picker for the login page. */
export async function GET() {
  if (!isDemoMode()) return await apiJson({ error: "Not available" }, { status: 404 });
  return await apiJson(await demoDirectory());
}
