import { redirect } from "next/navigation";
import { getSessionUser, isAdminProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env/public";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (!isSupabaseConfigured) redirect("/app/login?setup=1");

  const session = await getSessionUser();

  // Staff go to the console; everyone else belongs in the tracking app. A
  // signed-out visitor lands on the user sign-in, which is the larger audience.
  if (isAdminProfile(session?.profile)) redirect("/admin");
  redirect(session ? "/app" : "/app/login");
}
