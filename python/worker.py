#!/usr/bin/env python3
"""
@fileoverview
Token counting worker for models whose tokenizers are only available in Python:

- kimi-k3   : tiktoken.model + pat_str (official Moonshot tokenizer)
- deepseek-v4 : HF tokenizer.json (official DeepSeek-V4-Pro)
- glm-5.2   : HF tokenizer.json (official zai-org/GLM-5.2)

Protocol: newline-delimited JSON over stdio.
Request : {"id": 1, "model": "kimi-k3", "text": "..."}
Response: {"id": 1, "count": 123}
Error   : {"id": 1, "error": "..."}

Run: python3 worker.py <tokenizers_dir>
"""

import json
import os
import sys

TOKENIZERS_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "tokenizers"
)

# ---------------------------------------------------------------------------
# kimi-k3 — replicated from moonshotai/Kimi-K3 tokenization_kimi.py
# ---------------------------------------------------------------------------

KIMI_PAT_STR = "|".join([
    r"""[\p{Han}]+""",
    r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
    r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]+[\p{Ll}\p{Lm}\p{Lo}\p{M}&&[^\p{Han}]]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
    r"""\p{N}{1,3}""",
    r""" ?[^\s\p{L}\p{N}]+[\r\n]*""",
    r"""\s*[\r\n]+""",
    r"""\s+(?!\S)""",
    r"""\s+""",
])

_kimi_encoding = None


def _load_kimi():
    global _kimi_encoding
    if _kimi_encoding is not None:
        return _kimi_encoding
    import tiktoken
    from tiktoken.load import load_tiktoken_bpe

    vocab_file = os.path.join(TOKENIZERS_DIR, "kimi", "tiktoken.model")
    config_file = os.path.join(TOKENIZERS_DIR, "kimi", "tokenizer_config.json")

    mergeable_ranks = load_tiktoken_bpe(vocab_file)
    num_base_tokens = len(mergeable_ranks)

    # added tokens decoder from official tokenizer_config.json
    added = {}
    with open(config_file, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    for token_id, entry in (cfg.get("added_tokens_decoder") or {}).items():
        added[entry["content"]] = int(token_id)

    # 256 reserved tokens like the official implementation
    special_tokens = {
        f"<|reserved_token_{i}|>": i
        for i in range(num_base_tokens, num_base_tokens + 256)
    }
    special_tokens.update(added)

    _kimi_encoding = tiktoken.Encoding(
        name="kimi-k3",
        pat_str=KIMI_PAT_STR,
        mergeable_ranks=mergeable_ranks,
        special_tokens=special_tokens,
    )
    return _kimi_encoding


# ---------------------------------------------------------------------------
# deepseek-v4 / glm-5.2 — HF tokenizer.json via the `tokenizers` library
# ---------------------------------------------------------------------------

_tokenizers = {}


_HF_DIRS = {
    "deepseek-v4": "deepseek",
    "glm-5.2": "glm",
}


def _load_hf(name: str):
    if name not in _tokenizers:
        from tokenizers import Tokenizer

        path = os.path.join(TOKENIZERS_DIR, _HF_DIRS[name], "tokenizer.json")
        _tokenizers[name] = Tokenizer.from_file(path)
    return _tokenizers[name]


def count(model: str, text: str) -> int:
    if model == "kimi-k3":
        return len(_load_kimi().encode(text))
    if model in ("deepseek-v4", "glm-5.2"):
        return len(_load_hf(model).encode(text, add_special_tokens=False).ids)
    raise ValueError(f"unsupported model: {model}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req["id"]
            model = req["model"]
            text = req["text"]
            result = count(model, text)
            sys.stdout.write(json.dumps({"id": rid, "count": result}) + "\n")
            sys.stdout.flush()
        except Exception as e:  # noqa: BLE001 - worker must never die
            sys.stdout.write(
                json.dumps({"id": req.get("id"), "error": str(e)}) + "\n"
            )
            sys.stdout.flush()


if __name__ == "__main__":
    main()
