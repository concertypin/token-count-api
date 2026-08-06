import { spawn, type SpawnOptions } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * @fileoverview
 * Bridge to the Python tokenizer worker (uv-managed).
 * Protocol: newline-delimited JSON over stdio.
 * Request : {"id": 1, "model": "...", "text": "..."}
 * Response: {"id": 1, "count": 123}
 */

const WORKER_PATH = fileURLToPath(
    new URL("../python/worker.py", import.meta.url)
);
const TOKENIZERS_DIR = fileURLToPath(new URL("../tokenizers", import.meta.url));

let child: ReturnType<typeof spawn> | null = null;
const pending = new Map<
    number,
    { resolve: (n: number) => void; reject: (e: Error) => void }
>();
let nextId = 1;
let buffer = "";

async function ensureWorker(): Promise<ReturnType<typeof spawn>> {
    if (child && !child.killed) return child;
    // In dev: uv (with python/pyproject.toml). On Heroku: python3 (buildpack installs deps).
    const uv = process.env.UV_BIN ?? "uv";
    const python3 = process.env.PYTHON_BIN ?? "python3";
    const home = process.env.HOME ?? "";
    const candidates = [
        {
            bin: uv,
            args: ["run", "--project", "python", WORKER_PATH, TOKENIZERS_DIR],
        },
        {
            bin: `${home}/.local/bin/uv`,
            args: ["run", "--project", "python", WORKER_PATH, TOKENIZERS_DIR],
        },
        { bin: python3, args: [WORKER_PATH, TOKENIZERS_DIR] },
    ];
    const spawnOpts: SpawnOptions = {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: ["pipe", "pipe", "pipe"],
    };
    let spawned: ReturnType<typeof spawn> | null = null;
    for (const { bin, args } of candidates) {
        try {
            spawned = spawn(bin, args, spawnOpts);
        } catch (err) {
            console.error(
                `[python-worker] failed to spawn ${bin}: ${(err as Error).message}`
            );
            continue;
        }
        // ENOENT arrives asynchronously via the error event; wait for 'spawn'.
        const ready = new Promise<boolean>((resolve) => {
            spawned!.once("spawn", () => resolve(true));
            spawned!.once("error", (err: NodeJS.ErrnoException) => {
                console.error(
                    `[python-worker] spawn error (${bin}): ${err.message}`
                );
                resolve(false);
            });
        });
        if (await ready) {
            child = spawned;
            break;
        }
    }
    if (!child) {
        throw new Error("no python runtime found; set UV_BIN or PYTHON_BIN");
    }
    buffer = "";
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
        throw new Error("python worker stdio is not piped");
    }
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line) as {
                    id?: number;
                    count?: number;
                    error?: string;
                };
                const p =
                    msg.id !== undefined ? pending.get(msg.id) : undefined;
                if (!p) continue;
                pending.delete(msg.id!);
                if (msg.error) p.reject(new Error(msg.error));
                else p.resolve(msg.count ?? 0);
            } catch {
                // ignore malformed lines
            }
        }
    });
    stderr.on("data", (chunk: Buffer) => {
        console.error(`[python-worker] ${chunk.toString().trimEnd()}`);
    });
    child.on("exit", (code) => {
        const err = new Error(`python worker exited with code ${code}`);
        for (const [, p] of pending) p.reject(err);
        pending.clear();
        child = null;
    });
    return child;
}

export async function countWithPython(
    model: string,
    text: string
): Promise<number> {
    const worker = await ensureWorker();
    const id = nextId++;
    return new Promise<number>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const stdin = worker.stdin;
        if (!stdin) {
            pending.delete(id);
            reject(new Error("python worker stdin is not piped"));
            return;
        }
        stdin.write(`${JSON.stringify({ id, model, text })}\n`);
        // safety timeout in case the worker dies without an exit event
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`python worker timeout for ${model}`));
            }
        }, 30_000);
    });
}
