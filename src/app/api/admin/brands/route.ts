import { requireAdminSession } from "@/lib/auth";
import { errorResponse, jsonOk, parseJson } from "@/lib/http";
import { brandCreateSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const input = await parseJson(request, brandCreateSchema);

    const { data, error } = await supabase.rpc("admin_create_brand", {
      p_name: input.name,
      p_poc_name: input.pocName ?? null,
      p_poc_number: input.pocNumber ?? null,
      p_poc_email: input.pocEmail ?? null,
      p_website: input.website ?? null,
    });

    if (error) throw error;
    return jsonOk({ brand: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
