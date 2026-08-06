import { router } from "@/route";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { cors } from "@/utils/cors";
import type { HonoEnv } from "@/types";
/**
 * @fileoverview
 * Main Hono app: token counting API.
 *   GET  /count?models=...&text=...   (same params/response as POST)
 *   POST /count?models=...            (Content-Type: text/markdown)
 */

const app = new Hono<HonoEnv>().use("*", cors).route("/", router);

// OpenAPI-related
app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
        documentation: {
            info: {
                title: "Token Count API",
                version: "1.0.0",
                description:
                    "Count tokens for DeepSeek V4, GLM 5.2, Kimi K3, Gemini 3.6 Flash, Claude 4.x and GPT-5.",
            },
            servers: [
                { url: "http://localhost:5178", description: "Local Server" },
            ],
        },
    })
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
