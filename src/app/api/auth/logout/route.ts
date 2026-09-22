import { createServerSupabaseClient } from "@/lib/supabase/server";
import { errorResponse, jsonOk } from "@/lib/http";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    return jsonOk({ ok: true, redirectTo: "/login" });
  } catch (error) {
    return errorResponse(error);
  }
}
