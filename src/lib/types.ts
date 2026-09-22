export type UserRole = "user" | "admin";

export type ProductStatus = "open" | "closed";

export type OrderStatus =
  | "claimed"
  | "order_submitted"
  | "order_confirmed"
  | "review_pending"
  | "review_submitted"
  | "approved"
  | "paid"
  | "rejected";

export type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  phone_verified: boolean;
  role: UserRole;
  created_at: string;
  instagram_username?: string | null;
  youtube_username?: string | null;
};

export type BankDetailsRow = {
  user_id: string;
  account_holder_name: string | null;
  account_number_last4: string | null;
  ifsc_code: string | null;
  upi_id: string | null;
  updated_at: string;
};

/** Safe projection: `account_number_encrypted` is never selected client side. */
export type BankDetailsMasked = BankDetailsRow;

export type ProductRow = {
  id: string;
  name: string;
  /** The brand_name the admin typed; there is only one brand column. */
  brand: string | null;
  brand_id: string | null;
  description: string | null;
  image_url: string | null;
  total_slots: number;
  slots_filled: number;
  /** Slots that are claimable right now: what the feed and the claim rule use. */
  released_slots: number;
  /** Slots opened per day, or null when every slot is open immediately. */
  daily_release_limit: number | null;
  /** IST calendar day of the last daily top-up. */
  last_release_date: string;
  cashback_amount: number | null;
  status: ProductStatus;
  created_by: string | null;
  created_at: string;
  product_link: string | null;
  campaign: string | null;
  campaign_id: string | null;
  asin_code: string | null;
};

export type OrderRow = {
  id: string;
  user_id: string;
  product_id: string;
  status: OrderStatus;
  order_screenshot_url: string | null;
  extracted_name: string | null;
  extracted_order_id: string | null;
  extracted_phone: string | null;
  extracted_product_name: string | null;
  user_confirmed: boolean;
  order_confirmed_at: string | null;
  review_screenshot_url: string | null;
  review_link: string | null;
  review_submitted_at: string | null;
  approved_at: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  message: string;
  related_order_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  admin_id: string;
  action: string;
  target_table: string;
  target_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Row shapes for the hand-written schema in supabase/migrations.
 *
 * The Supabase clients are deliberately created WITHOUT a generated `Database`
 * generic: `supabase gen types` needs a live project, and a hand-rolled
 * equivalent has to satisfy postgrest-js's exact `GenericSchema` shape for
 * embedded selects to type-check. Instead, every query result is typed here at
 * the boundary where it is consumed (see OrderWithRelations).
 */

export type OrderWithRelations = OrderRow & {
  product: Pick<ProductRow, "id" | "name" | "brand" | "cashback_amount"> | null;
  user: Pick<ProfileRow, "id" | "full_name" | "phone"> | null;
};

export type BrandRow = {
  id: string;
  /** Monotonic sequence — formatted as 'BR-' + padStart(3, '0') in the UI. */
  brand_seq: number;
  name: string;
  poc_name: string | null;
  poc_number: string | null;
  poc_email: string | null;
  website: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignRow = {
  id: string;
  brand_id: string;
  campaign_number: number;
  created_by: string | null;
  created_at: string;
};

export type CampaignWithBrand = CampaignRow & {
  brand: Pick<BrandRow, "id" | "brand_seq" | "name"> | null;
};
