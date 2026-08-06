/// <reference types="vitest/config" />
import { type UserConfig, defineConfig } from "vite";
import { fileURLToPath } from "node:url";

type Config = Required<UserConfig>;

/**
 * Directories to ignore for any file-watching features.
 */
const ignoredDir = [
    "node_modules",
    "dist",
    "coverage",
    ".wrangler",
    ".git",
    "dist-ts",
].map((dir) => `**/${dir}/**`);

/**
 * Import aliases.
 * Should be exactly matched in tsconfig.base.json's "paths" field for type safety.
 */
const resolve: Config["resolve"] = {
    alias: {
        "@": fileURLToPath(new URL("src", import.meta.url)),
    },
    external: [],
};

const testConfig: Config["test"] = {
    coverage: {
        enabled: true,
        include: ["src/**/*.ts"],
        provider: "istanbul",
        reportOnFailure: true,
        reporter: ["text", "json-summary", "html"],
    },
    environment: "node",
    exclude: ignoredDir,
    globals: true,
    include: ["tests/**/*.test.ts"],
    silent: "passed-only",
    env: {
        VITEST: "true",
    },
};

export default defineConfig(() => {
    return {
        server: {
            watch: {
                ignored: ignoredDir,
            },
        },
        clearScreen: false,
        resolve,
        test: testConfig,
    } satisfies UserConfig;
});
