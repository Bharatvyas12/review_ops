import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".vercel/**",
      ".wrangler/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Screenshots and product images are served from private storage buckets through
      // short-lived signed URLs, so next/image optimisation cannot be applied to them.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
