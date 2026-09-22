import "server-only";
import { ApiError } from "@/lib/http";

type DatabaseError = { code?: string | null; message?: string | null; hint?: string | null };

/**
 * Translates a database rejection into something a user can act on.
 *
 * The hints are set deliberately by the functions in migration 0006; anything
 * without a recognised hint becomes a generic 500 so internal detail (SQL,
 * constraint names, stack traces) never reaches the client.
 */
export function mapUserMutationError(error: DatabaseError): ApiError {
  switch (error.hint ?? "") {
    case "phone_unverified":
      return new ApiError(403, "Verify your phone number to continue.", "phone_unverified");
    case "order_not_found":
    case "product_not_found":
      return new ApiError(404, "We could not find that.", "not_found");
    case "order_locked":
      return new ApiError(409, "That step has already been completed.", "order_locked");
    case "duplicate_claim":
      return new ApiError(
        409,
        "You already hold an active claim on this product.",
        "duplicate_claim",
      );
    case "invalid_path":
      return new ApiError(
        400,
        "That upload could not be verified. Please upload the screenshot again.",
        "invalid_path",
      );
    case "order_ref_required":
      return new ApiError(400, "Enter the order id shown on the screenshot.", "order_ref_required");
    case "proof_required":
      return new ApiError(
        400,
        "Attach a review screenshot or paste the review link.",
        "proof_required",
      );
    case "invalid_link":
      return new ApiError(400, "Enter a full https link to the review.", "invalid_link");
    case "payout_required":
      return new ApiError(400, "Add a bank account or a UPI id.", "payout_required");
    case "invalid_ifsc":
      return new ApiError(400, "Enter a valid IFSC code.", "invalid_ifsc");
    case "invalid_upi":
      return new ApiError(400, "Enter a valid UPI id.", "invalid_upi");
    case "invalid_last4":
    case "invalid_ciphertext":
    case "invalid_field":
      return new ApiError(400, "One of the values is not valid.", "invalid_field");
    case "auth_required":
      return new ApiError(401, "You must sign in to continue.", "unauthorized");
    default:
      return new ApiError(500, "Something went wrong. Please try again.", "internal_error");
  }
}
