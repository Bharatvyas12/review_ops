import { requireUserSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { notificationReadSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Marks one notification, or all of them, as read.
 *
 * RLS already limits the rows to the caller, but the owner filter is repeated
 * explicitly: the request must never rely on a single layer for authorization.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireUserSession();
    const input = await parseJson(request, notificationReadSchema);

    if (input.all) {
      const { error } = await session.supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", session.userId)
        .eq("is_read", false);

      if (error) throw error;
      return jsonOk({ ok: true, scope: "all" });
    }

    if (!input.id) throw badRequest("Provide a notification id, or all: true.");

    const { error } = await session.supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", input.id)
      .eq("user_id", session.userId);

    if (error) throw error;
    return jsonOk({ ok: true, scope: "one" });
  } catch (error) {
    return errorResponse(error);
  }
}
