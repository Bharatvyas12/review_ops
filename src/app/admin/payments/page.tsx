import type { Metadata } from "next";
import { requireAdminOrRedirect } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/StatusBadge";
import { PaymentsQueue, type PaymentRow } from "@/components/admin/PaymentsQueue";
import { IconShield } from "@/components/ui/icons";
import type { BankDetailsMasked, OrderWithRelations } from "@/lib/types";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const { supabase } = await requireAdminOrRedirect();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "*, product:products(id, name, brand, cashback_amount), user:profiles!orders_user_id_fkey(id, full_name, phone)",
    )
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderWithRelations[];
  const userIds = [...new Set(orders.map((order) => order.user_id))];

  // Only the safe columns are requested. account_number_encrypted is not even
  // selectable from an authenticated session, so `select("*")` would fail here.
  const { data: bankRows } = userIds.length
    ? await supabase
        .from("bank_details")
        .select("user_id, account_holder_name, account_number_last4, ifsc_code, upi_id, updated_at")
        .in("user_id", userIds)
    : { data: [] as BankDetailsMasked[] };

  const bankByUser = new Map(
    ((bankRows ?? []) as BankDetailsMasked[]).map((row) => [row.user_id, row]),
  );

  const rows: PaymentRow[] = orders.map((order) => {
    const bank = bankByUser.get(order.user_id);
    return {
      orderId: order.id,
      userName: order.user?.full_name ?? "Unknown user",
      userPhone: order.user?.phone ?? null,
      productName: order.product?.name ?? null,
      productBrand: order.product?.brand ?? null,
      cashbackAmount:
        order.product?.cashback_amount === null || order.product?.cashback_amount === undefined
          ? null
          : Number(order.product.cashback_amount),
      approvedAt: order.approved_at,
      bank: bank
        ? {
            accountHolderName: bank.account_holder_name,
            accountNumberLast4: bank.account_number_last4,
            ifscCode: bank.ifsc_code,
            upiId: bank.upi_id,
          }
        : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Payments"
        description="Approved orders waiting for a payout. Account numbers stay encrypted until you reveal them."
        action={
          <Badge tone="info">
            <IconShield className="h-3 w-3" /> Reveals are audit-logged
          </Badge>
        }
      />
      <PaymentsQueue rows={rows} />
    </>
  );
}
