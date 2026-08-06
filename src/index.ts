import { router } from "@/route";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { cors } from "@/utils/cors";
import type { HonoEnv } from "@/types";
/**
 * @fileoverview
 * Main Hono app: token counting API.
 *   GET  /count?models=...&text=...   (same params/response as POST)
 *   POST /count?models=...            (Content-Type: text/markdown)
 */

const app = new Hono<HonoEnv>().use("*", cors).route("/", router);

// OpenAPI-related. The server URL is derived from the request origin so the
// spec works both locally and on Heroku without hardcoding a host.
app.get(
    "/openapi.json",
    async (c) => {
        const origin = new URL(c.req.url).origin;
        // Heroku serves HTTPS; keep the docs URL scheme consistent.
        const url = c.req.header("x-forwarded-proto") === "https"
            ? origin.replace(/^http:/, "https:")
            : origin;
        const spec = await generateSpecs(app, {
            documentation: {
                info: {
                    title: "Token Count API",
                    version: "1.0.0",
                    description:
                        "Count tokens for DeepSeek V4, GLM 5.2, Kimi K3, Gemini 3.6 Flash and GPT-5.",
                },
                servers: [{ url, description: "Current origin" }],
            },
        }, c);
        return c.json(spec);
    }
);
app.get(
    "/docs",
    Scalar({
        defaultHttpClient: {
            clientKey: "fetch",
            targetKey: "js",
        },
        url: "/openapi.json",
    })
);
export default app;
