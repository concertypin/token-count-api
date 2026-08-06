import type { Context } from "hono";
import type { HonoEnv } from "@/types";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import * as z from "zod";
import { countTokens, MODEL_IDS, MODEL_INFO } from "@/counters";

const outputSchema = z.object({
    input: z.object({
        chars: z.number(),
        bytes: z.number(),
    }),
    counts: z.record(z.string(), z.number()),
    approximate: z.array(z.string()).optional(),
});

const AVAILABLE = Object.keys(MODEL_IDS);

/**
 * GET /count?models=deepseek-v4,glm-5.2&text=...
 * POST /count?models=...  (body: text/markdown)
 * GET /models — list supported models and how they are counted.
 *
 * count endpoints share the same parameters and response shape.
 */
export const router = new Hono<HonoEnv>()
    .get(
        "/models",
        describeRoute({
            responses: {
                200: {
                    description: "Supported models and counting backends",
                    content: {
                        "application/json": {
                            schema: resolver(
                                z.record(z.string(), z.string())
                            ),
                        },
                    },
                },
            },
        }),
        (c) => c.json(MODEL_INFO)
    )
    .get(
        "/count",
        describeRoute({
            parameters: [
                {
                    name: "models",
                    in: "query",
                    required: false,
                    description:
                        "Comma-separated model keys; defaults to all supported models.",
                    schema: { type: "string" },
                },
                {
                    name: "text",
                    in: "query",
                    required: true,
                    description: "Text to count tokens for.",
                    schema: { type: "string" },
                },
            ],
            responses: {
                200: {
                    description: "Token counts per model",
                    content: {
                        "application/json": { schema: resolver(outputSchema) },
                    },
                },
                400: { description: "Bad request" },
            },
        }),
        async (c) => {
            let models: string[];
            try {
                models = parseModels(c.req.query("models"));
            } catch (err) {
                return c.json({ error: (err as Error).message }, 400);
            }
            const text = c.req.query("text");
            if (text === undefined) {
                return c.json(
                    { error: "Missing required query parameter: text" },
                    400
                );
            }
            return runCount(c, models, text);
        }
    )
    .post(
        "/count",
        describeRoute({
            requestBody: {
                required: true,
                description: "Markdown text to count tokens for",
                content: {
                    "text/markdown": {
                        schema: { type: "string" },
                    },
                },
            },
            responses: {
                200: {
                    description: "Token counts per model",
                    content: {
                        "application/json": { schema: resolver(outputSchema) },
                    },
                },
                400: { description: "Bad request" },
                415: { description: "Content-Type must be text/markdown" },
            },
        }),
        async (c) => {
            const contentType = c.req.header("Content-Type") ?? "";
            if (!contentType.includes("text/markdown")) {
                return c.json(
                    {
                        error: "Content-Type must be text/markdown (e.g. text/markdown; charset=utf-8)",
                    },
                    415
                );
            }
            const models = c.req.query("models") ?? "";
            let parsed: string[];
            try {
                parsed = parseModels(models);
            } catch (err) {
                return c.json({ error: (err as Error).message }, 400);
            }
            const text = await c.req.text();
            return runCount(c, parsed, text);
        }
    );

function parseModels(raw: string | undefined): string[] {
    if (!raw) return AVAILABLE;
    const requested = raw
        .split(",")
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean);
    const claude = requested.filter((m) => m.startsWith("claude"));
    if (claude.length > 0) {
        throw new Error(
            `Claude models are unsupported: ${claude.join(", ")} (no public tokenizer; Anthropic count_tokens requires an API key)`
        );
    }
    const unknown = requested.filter((m) => !(m in MODEL_IDS));
    if (unknown.length > 0) {
        throw new Error(`Unknown model(s): ${unknown.join(", ")}`);
    }
    return requested;
}

async function runCount(c: Context<HonoEnv>, models: string[], text: string) {
    try {
        const result = await countTokens(models, text);
        const input = {
            chars: text.length,
            bytes: new TextEncoder().encode(text).length,
        };
        return c.json({ input, ...result });
    } catch (err) {
        return c.json(
            { error: err instanceof Error ? err.message : String(err) },
            400
        );
    }
}
