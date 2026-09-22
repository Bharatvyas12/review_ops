import { requireAdminSession } from "@/lib/auth";
import { badRequest, errorResponse, jsonOk, parseJson } from "@/lib/http";
import { uuidSchema, brandUpdateSchema } from "@/lib/validation";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const { id } = await context.params;
    const brandId = uuidSchema.safeParse(id);
    if (!brandId.success) throw badRequest("Invalid brand id.");

    const input = await parseJson(request, brandUpdateSchema);

    const { data, error } = await supabase.rpc("admin_update_brand", {
      p_brand_id: brandId.data,
      p_name: input.name ?? null,
      p_poc_name: input.pocName ?? null,
      p_poc_number: input.pocNumber ?? null,
      p_poc_email: input.pocEmail ?? null,
      p_website: input.website ?? null,
    });

    if (error) throw error;
    return jsonOk({ brand: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { supabase } = await requireAdminSession();

    const { id } = await context.params;
    const brandId = uuidSchema.safeParse(id);
    if (!brandId.success) throw badRequest("Invalid brand id.");

    const { error } = await supabase.rpc("admin_delete_brand", {
      p_brand_id: brandId.data,
    });

    if (error) throw error;
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
