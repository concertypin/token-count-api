/**
 * @fileoverview
 * Model registry and counting logic.
 *
 * Counting backend per model:
 *   - deepseek-v4    → local Python worker (official HF tokenizer.json)
 *   - glm-5.2        → local Python worker (official HF tokenizer.json)
 *   - kimi-k3        → local Python worker (official tiktoken.model + pat_str)
 *   - gpt            → remote OpenAI /v1/responses/input_tokens (needs OPENAI_API_KEY)
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
    // All GPT-4o+ models share the o200k_base tokenizer, so one key covers
    // the whole GPT family. The value is the model ID sent to the API.
    gpt: "gpt-5.2",
} as const;

export type ModelKey = keyof typeof MODEL_IDS;

const PYTHON_MODELS = new Set(["deepseek-v4", "glm-5.2", "kimi-k3"]);
const OPENAI_MODELS = new Set(["gpt"]);
const GEMINI_MODELS = new Set(["gemini-3.6-flash"]);

/** Human-readable description of how each model is counted. */
export const MODEL_INFO: Record<ModelKey, string> = {
    "deepseek-v4": "DeepSeek V4 · local tokenizer",
    "glm-5.2": "GLM 5.2 · local tokenizer",
    "kimi-k3": "Kimi K3 · local tokenizer",
    "gemini-3.6-flash": "Gemini 3.6 Flash · official countTokens",
    gpt: "GPT · official tokenizer (o200k_base)",
};

export async function countTokens(
    models: string[],
    text: string
): Promise<{
    counts: Record<string, number>;
    approximate: string[];
    offset: Record<string, number>;
}> {
    const counts: Record<string, number> = {};
    const approximate: string[] = [];
    const offset: Record<string, number> = {};

    await Promise.all(
        models.map(async (key) => {
            const model = MODEL_IDS[key as ModelKey];
            try {
                if (PYTHON_MODELS.has(key)) {
                    // Local tokenizers run the official tokenizer files but
                    // still count locally, so they are marked approximate.
                    counts[key] = await countWithPython(key, text);
                    approximate.push(key);
                } else if (OPENAI_MODELS.has(key)) {
                    const off = await remoteOffset(key as ModelKey, model, text);
                    counts[key] = off.count;
                    offset[key] = off.offset;
                } else if (GEMINI_MODELS.has(key)) {
                    const off = await remoteOffset(key as ModelKey, model, text);
                    counts[key] = off.count;
                    offset[key] = off.offset;
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

    return { counts, approximate, offset };
}

/**
 * Per-model offset cache. Remote token counters (OpenAI input_tokens,
 * Gemini countTokens) appear to add a fixed overhead on top of the raw
 * text (e.g. system-prompt wrapping). We measure it once per model by
 * counting a single "." and subtracting the local count of the same
 * input, then report count(text) - offset so the result is the number
 * of tokens the document actually adds.
 */
const offsetCache = new Map<string, number>();

async function remoteOffset(
    key: ModelKey,
    model: string,
    text: string
): Promise<{ count: number; offset: number }> {
    let offset = offsetCache.get(key);
    if (offset === undefined) {
        const local = (await approximateCount(key, ".")) ?? 0;
        const remote = OPENAI_MODELS.has(key)
            ? await countOpenAI(model, ".")
            : await countGemini(model, ".");
        offset = Math.max(0, remote - local);
        offsetCache.set(key, offset);
    }
    const remote = OPENAI_MODELS.has(key)
        ? await countOpenAI(model, text)
        : await countGemini(model, text);
    return { count: Math.max(0, remote - offset), offset };
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
 * - gpt  → o200k_base via gpt-tokenizer (exact)
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
