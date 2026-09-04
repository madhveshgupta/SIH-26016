import { redirect } from "next/navigation";
import { getSession } from "@backend/auth/session";
import Shell from "@frontend/components/Shell";

export const dynamic = "force-dynamic";

/** Every page in this group requires a session. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Shell session={session}>{children}</Shell>;
}
