import "server-only";
import { z } from "zod";
import { serverEnv } from "@/lib/env/server";

/**
 * Claude screenshot extraction. Server-side only.
 *
 * Guards required by the spec:
 *   * one request carries exactly one image  no unrelated user data is bundled;
 *   * the model is instructed to answer with JSON only, and the answer is
 *     re-validated here rather than trusted;
 *   * the API key never leaves this module.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 45_000;

export const extractionResultSchema = z.object({
  name: z.string().trim().max(200).nullable(),
  order_id: z.string().trim().max(200).nullable(),
  phone: z.string().trim().max(40).nullable(),
  product_name: z.string().trim().max(300).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

const SYSTEM_PROMPT = [
  "You extract order details from a single e-commerce order screenshot.",
  "Reply with JSON only. No prose, no markdown fences.",
  'Schema: {"name": string|null, "order_id": string|null, "phone": string|null, "product_name": string|null, "confidence": "high"|"medium"|"low"}',
  "Use null for any field you cannot read confidently. Never invent values.",
].join("\n");

export type ExtractOrderScreenshotInput = {
  bytes: Uint8Array;
  mimeType: string;
};

function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractOrderFromScreenshot(
  input: ExtractOrderScreenshotInput,
): Promise<ExtractionResult> {
  const base64 = toBase64(input.bytes);

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": serverEnv.anthropicApiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: serverEnv.anthropicModel,
      max_tokens: 512,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: input.mimeType, data: base64 },
            },
            { type: "text", text: "Extract the order details from this screenshot." },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude extraction failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");

  const parsed = extractionResultSchema.safeParse(parseModelJson(text));
  if (!parsed.success) {
    throw new Error("Claude returned an unexpected shape; nothing was saved.");
  }
  return parsed.data;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
