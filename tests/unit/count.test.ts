import { describe, expect, it } from "vitest";
import app from "@/index";

describe("POST /count", () => {
    it("should reject non-markdown content type", async () => {
        const resp = await app.request("/count?models=deepseek-v4", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: "hello",
        });
        expect(resp.status).toBe(415);
    });

    it("should count tokens for local models", async () => {
        const resp = await app.request(
            "/count?models=deepseek-v4,glm-5.2,kimi-k3",
            {
                method: "POST",
                headers: { "Content-Type": "text/markdown" },
                body: "hello world",
            }
        );
        expect(resp.status).toBe(200);
        const data = (await resp.json()) as {
            input: { chars: number };
            counts: Record<string, number>;
        };
        expect(data.input.chars).toBe(11);
        expect(data.counts["deepseek-v4"]).toBe(2);
        expect(data.counts["glm-5.2"]).toBe(2);
        expect(data.counts["kimi-k3"]).toBe(2);
    });
});

describe("GET /count", () => {
    it("should reject unknown models with 400", async () => {
        const resp = await app.request("/count?models=foo&text=hello");
        expect(resp.status).toBe(400);
    });

    it("should reject claude with 400 and clear message", async () => {
        const resp = await app.request(
            "/count?models=claude-4.8-opus&text=hello"
        );
        expect(resp.status).toBe(400);
        const body = (await resp.json()) as { error: string };
        expect(body.error).toContain("unsupported");
    });

    it("should list supported models", async () => {
        const resp = await app.request("/models");
        expect(resp.status).toBe(200);
        const data = (await resp.json()) as Record<string, string>;
        expect(data["deepseek-v4"]).toContain("local");
        expect(data["gpt-5.2"]).toContain("remote");
    });

    it("should count via query text", async () => {
        const resp = await app.request("/count?models=deepseek-v4&text=hello");
        expect(resp.status).toBe(200);
        const data = (await resp.json()) as { counts: Record<string, number> };
        expect(data.counts["deepseek-v4"]).toBe(1);
    });
});
