/**
 * @fileoverview
 * Model registry and counting logic.
 *
 * Counting backend per model:
 *   - deepseek-v4    → local Python worker (official HF tokenizer.json)
 *   - glm-5.2        → local Python worker (official HF tokenizer.json)
 *   - kimi-k3        → local Python worker (official tiktoken.model + pat_str)
 *   - gpt-5.x        → remote OpenAI /v1/responses/input_tokens (needs OPENAI_API_KEY)
 *   - gemini-3.6-flash → remote Google :countTokens (needs GEMINI_API_KEY)
 *
 * Remote models fall back to a local approximation when the API key is
 * missing or the request fails; those entries are listed in `approximate`.
 * Claude models are intentionally unsupported (no public tokenizer, API key
 * friction) — requesting one returns a 400 with a clear message.
 *
 * Env vars (see .env.example):
 *   OPENAI_API_KEY, GEMINI_API_KEY
 */

import { countWithPython } from "@/python";

export const MODEL_IDS = {
    "deepseek-v4": "deepseek-v4",
    "glm-5.2": "glm-5.2",
    "kimi-k3": "kimi-k3",
    "gemini-3.6-flash": "gemini-3.6-flash",
    "gpt-5.2": "gpt-5.2",
    "gpt-5.1": "gpt-5.1",
    "gpt-5": "gpt-5",
} as const;

export type ModelKey = keyof typeof MODEL_IDS;

const PYTHON_MODELS = new Set(["deepseek-v4", "glm-5.2", "kimi-k3"]);
const OPENAI_MODELS = new Set(["gpt-5.2", "gpt-5.1", "gpt-5"]);
const GEMINI_MODELS = new Set(["gemini-3.6-flash"]);

/** Human-readable description of how each model is counted. */
export const MODEL_INFO: Record<ModelKey, string> = {
    "deepseek-v4": "local · official DeepSeek-V4-Pro tokenizer (Python worker)",
    "glm-5.2": "local · official zai-org/GLM-5.2 tokenizer (Python worker)",
    "kimi-k3": "local · official moonshotai/Kimi-K3 tiktoken model (Python worker)",
    "gemini-3.6-flash": "remote · Google countTokens (GEMINI_API_KEY) · local fallback",
    "gpt-5.2": "remote · OpenAI input_tokens (OPENAI_API_KEY) · local fallback",
    "gpt-5.1": "remote · OpenAI input_tokens (OPENAI_API_KEY) · local fallback",
    "gpt-5": "remote · OpenAI input_tokens (OPENAI_API_KEY) · local fallback",
};

export async function countTokens(
    models: string[],
    text: string
): Promise<{ counts: Record<string, number>; approximate: string[] }> {
    const counts: Record<string, number> = {};
    const approximate: string[] = [];

    await Promise.all(
        models.map(async (key) => {
            const model = MODEL_IDS[key as ModelKey];
            try {
                if (PYTHON_MODELS.has(key)) {
                    counts[key] = await countWithPython(key, text);
                } else if (OPENAI_MODELS.has(key)) {
                    counts[key] = await countOpenAI(model, text);
                } else if (GEMINI_MODELS.has(key)) {
                    counts[key] = await countGemini(model, text);
                } else {
                    throw new Error(`no counter for ${key}`);
                }
            } catch (err) {
                // A failing remote counter falls back to a local approximation
                // when available, and is marked as approximate.
                const approx = await approximateCount(key, text);
                if (approx !== null) {
                    counts[key] = approx;
                    approximate.push(key);
                } else {
                    throw err;
                }
            }
        })
    );

    return { counts, approximate };
}

async function countOpenAI(model: string, text: string): Promise<number> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const res = await fetch(
        "https://api.openai.com/v1/responses/input_tokens",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, input: text }),
        }
    );
    const data = (await res.json()) as {
        input_tokens?: number;
        error?: { message: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `OpenAI ${res.status}`);
    return data.input_tokens ?? 0;
}

async function countGemini(model: string, text: string): Promise<number> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${key}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
    });
    const data = (await res.json()) as {
        totalTokens?: number;
        error?: { message: string };
    };
    if (!res.ok) throw new Error(data.error?.message ?? `Gemini ${res.status}`);
    return data.totalTokens ?? 0;
}

/**
 * Local approximation fallback.
 * - gpt-5.x  → o200k_base via gpt-tokenizer (exact)
 * - gemini   → @lenml/tokenizer-gemini
 */
async function approximateCount(
    key: string,
    text: string
): Promise<number | null> {
    try {
        if (OPENAI_MODELS.has(key)) {
            const { encode } = await import("gpt-tokenizer");
            return encode(text).length;
        }
        if (GEMINI_MODELS.has(key)) {
            const { fromPreTrained } = await import("@lenml/tokenizer-gemini");
            const t = fromPreTrained();
            return t.encode(text).length;
        }
        return null;
    } catch {
        return null;
    }
}
