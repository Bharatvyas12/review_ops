#!/usr/bin/env node
/**
 * Generates a 32-byte AES-256-GCM key for BANK_ENCRYPTION_KEY.
 * The key is printed once to stdout so it can be pasted into the server
 * environment. It is never written to a file by this script.
 */
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");

console.log("Add this to your server-side environment (never to the repo):\n");
console.log(`BANK_ENCRYPTION_KEY=${key}\n`);
console.log("Rotating? Move the old value to BANK_ENCRYPTION_KEY_PREVIOUS and re-encrypt at your own pace.");
