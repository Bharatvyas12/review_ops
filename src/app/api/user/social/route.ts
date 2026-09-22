import { requireUserSession } from "@/lib/auth";
import { errorResponse, jsonOk, parseJson } from "@/lib/http";
import { socialProfilesSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireUserSession();
    const input = await parseJson(request, socialProfilesSchema);

    const { error } = await session.supabase
      .from("profiles")
      .update({
        instagram_username: input.instagramUsername ?? null,
        youtube_username: input.youtubeUsername ?? null,
      })
      .eq("id", session.userId);

    if (error) throw error;

    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
