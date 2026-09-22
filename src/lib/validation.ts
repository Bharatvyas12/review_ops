import { z } from "zod";

export const uuidSchema = z.string().uuid("Must be a valid id.");

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

/**
 * Login input. The password is only bounded  it is never trimmed, mutated or
 * logged, and it is handed straight to Supabase Auth.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

/** "" | null | undefined -> null; numeric strings -> numbers. */
const optionalMoney = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().min(0).max(max).nullable(),
  );

/** The same empty-string handling, restricted to whole numbers. */
const optionalCount = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(min).max(max).nullable(),
  );

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  // `brand` is the brand_name field on the form; kept for backward compatibility.
  brand: z.string().trim().max(120).optional().nullable(),
  brandId: uuidSchema.optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  imageUrl: z.string().trim().max(1024).optional().nullable(),
  totalSlots: z.coerce.number().int().min(1).max(100000),
  cashbackAmount: optionalMoney(1_000_000).optional().default(null),
  productLink: z.string().trim().max(1024).optional().nullable(),
  campaign: z.string().trim().max(120).optional().nullable(),
  campaignId: uuidSchema.optional().nullable(),
  asinCode: z.string().trim().max(16).optional().nullable(),
  // 0 and blank both mean "no staggering"; the RPC turns that into a null limit.
  dailyReleaseLimit: optionalCount(0, 100000).optional().default(null),
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  brandId: uuidSchema.nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  imageUrl: z.string().trim().max(1024).nullable().optional(),
  totalSlots: z.coerce.number().int().min(1).max(100000).optional(),
  cashbackAmount: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  status: z.enum(["open", "closed"]).optional(),
  productLink: z.string().trim().max(1024).nullable().optional(),
  campaign: z.string().trim().max(120).nullable().optional(),
  campaignId: uuidSchema.nullable().optional(),
  asinCode: z.string().trim().max(16).nullable().optional(),
  // null leaves the stored limit alone (the close/reopen action sends only
  // `status`); 0 clears it.
  dailyReleaseLimit: optionalCount(0, 100000).optional(),
});

export const orderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim().min(3, "Give the user a reason.").max(1000),
  }),
]);

export const reviewActionSchema = orderActionSchema;

export const paymentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reveal") }),
  z.object({
    action: z.literal("mark_paid"),
    paymentReference: z.string().trim().min(3, "A payment reference is required.").max(120),
  }),
]);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url("Enter a full https URL.").max(1024).nullable().optional(),
);

export const brandCreateSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required.").max(200),
  pocName: z.string().trim().max(120).optional().nullable(),
  pocNumber: z.string().trim().max(40).optional().nullable(),
  pocEmail: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().email("Enter a valid email.").max(254).nullable().optional(),
    ),
  website: optionalUrl,
});

export const brandUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  pocName: z.string().trim().max(120).nullable().optional(),
  pocNumber: z.string().trim().max(40).nullable().optional(),
  pocEmail: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().trim().email("Enter a valid email.").max(254).nullable().optional(),
    ),
  website: optionalUrl,
});

export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;

export const campaignCreateSchema = z.object({
  brandId: uuidSchema,
  campaignNumber: z.coerce.number().int().min(1, "Campaign number must be between 1 and 10.").max(10, "Campaign number must be between 1 and 10."),
});

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const signedUrlSchema = z.object({
  bucket: z.enum(["screenshots", "product-images"]),
  path: z.string().trim().min(1).max(1024),
  scope: z.enum(["screenshot", "share"]).default("screenshot"),
});

export const uploadPurposeSchema = z.enum(["screenshot", "product-image", "share"]);

export type LoginInput = z.infer<typeof loginSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type OrderActionInput = z.infer<typeof orderActionSchema>;
export type PaymentActionInput = z.infer<typeof paymentActionSchema>;

// -----------------------------------------------------------------------------
// User panel
// -----------------------------------------------------------------------------

/** Indian mobile number, normalised to +91XXXXXXXXXX for storage and lookup. */
export const phoneSchema = z
  .string()
  .trim()
  .min(10, "Enter a valid mobile number.")
  .max(24, "Enter a valid mobile number.")
  .transform((value) => value.replace(/[\s()\-.]/g, ""))
  .transform((value) => (value.startsWith("0") ? value.slice(1) : value))
  .refine(
    (value) => /^(\+?91)?[6-9][0-9]{9}$/.test(value),
    "Enter a valid 10-digit Indian mobile number.",
  )
  .transform((value) => `+91${value.replace(/[^0-9]/g, "").slice(-10)}`);

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Tell us your name.").max(120),
  email: emailSchema,
  phone: phoneSchema,
  // Supabase Auth hashes this; we only bound it. 72 is bcrypt's effective limit,
  // so a longer password would silently lose entropy.
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(72, "Passwords can be at most 72 characters."),
});

export const otpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "Enter the 6-digit code."),
});

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

export const orderProofSchema = z.object({
  screenshotPath: z.string().trim().min(1, "Upload the order screenshot.").max(1024),
  name: optionalText(200),
  orderRef: z.string().trim().min(3, "Enter the order id from the screenshot.").max(200),
  phone: optionalText(40),
  productName: optionalText(300),
});

export const reviewProofSchema = z
  .object({
    screenshotPath: optionalText(1024),
    reviewLink: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string()
        .trim()
        .max(1024)
        .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), "Enter a full https link.")
        .nullable()
        .optional(),
    ),
  })
  .refine(
    (value) => Boolean(value.screenshotPath || value.reviewLink),
    "Attach a review screenshot or paste the review link.",
  );

export const bankDetailsSchema = z.object({
  accountHolderName: optionalText(120),
  // The raw value is normalised first, so "1234 5678 9012" and "123456789012"
  // are the same number. An empty string means "keep what is stored".
  accountNumber: z
    .union([z.string().trim().max(40), z.null()])
    .optional()
    .transform((value) => (value ?? "").replace(/[\s-]/g, ""))
    .refine(
      (value) => value === "" || /^[0-9]{6,34}$/.test(value),
      "Account numbers are 6 to 34 digits.",
    )
    .transform((value) => (value === "" ? null : value)),
  ifscCode: optionalText(20),
  upiId: optionalText(256),
});

export const notificationReadSchema = z.object({
  id: uuidSchema.optional(),
  all: z.boolean().optional(),
});

const handleTransform = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
};

export const socialProfilesSchema = z.object({
  instagramUsername: z.preprocess(handleTransform, z.string().max(100).nullable().optional()),
  youtubeUsername: z.preprocess(handleTransform, z.string().max(100).nullable().optional()),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type OrderProofInput = z.infer<typeof orderProofSchema>;
export type ReviewProofInput = z.infer<typeof reviewProofSchema>;
export type BankDetailsInput = z.infer<typeof bankDetailsSchema>;
export type SocialProfilesInput = z.infer<typeof socialProfilesSchema>;
