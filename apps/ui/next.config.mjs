import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envFiles = [
  path.resolve(__dirname, "../../.env.local"),
  path.resolve(__dirname, "../../.env")
];

for (const envPath of envFiles) {
  dotenv.config({ path: envPath, override: false });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true
  },
  typescript: {
    tsconfigPath: './tsconfig.json'
  },
  webpack: (config) => {
    const alias = config.resolve?.alias ?? {};
    const sourceRoot = path.resolve(__dirname, "../../src");

    alias["@pip/core"] = sourceRoot;
    alias["@pip/config"] = path.resolve(sourceRoot, "config.ts");
    alias["@pip/agents"] = path.resolve(sourceRoot, "agents");
    alias["@pip/mcp"] = path.resolve(sourceRoot, "mcp");
    alias["@pip/types"] = path.resolve(sourceRoot, "types");
    alias["@pip/utils"] = path.resolve(sourceRoot, "utils");
    alias["@pip/server"] = path.resolve(sourceRoot, "server");
    alias["@pip/pipeline"] = path.resolve(sourceRoot, "pipeline");
    alias["@"] = __dirname;

    config.resolve = config.resolve ?? {};
    config.resolve.alias = alias;
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".mjs", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };
    return config;
  }
};

export default nextConfig;
