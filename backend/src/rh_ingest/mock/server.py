"""Deterministic mock model server for development and testing."""

import hashlib
import json
import re
import time
from typing import Any

import numpy as np
from fastapi import FastAPI, Request, Response

app = FastAPI(title="Reading Helper Mock Model Server")

# In-memory mock state
faults: dict[str, int] = {}
calls: list[dict[str, Any]] = []


def _consume_fault(name: str) -> bool:
    if faults.get(name, 0) > 0:
        faults[name] -= 1
        return True
    return False


@app.get("/v1/models")
def get_models():
    return {
        "object": "list",
        "data": [
            {"id": "mock-cards", "object": "model", "owned_by": "mock"},
            {"id": "mock-embed", "object": "model", "owned_by": "mock"},
        ],
    }


@app.post("/_mock/faults")
async def set_faults(req: Request):
    global faults
    data = await req.json()
    faults.update(data)
    return {"status": "ok", "faults": faults}


@app.get("/_mock/calls")
def get_calls():
    return {"calls": calls}


@app.post("/_mock/reset")
def reset_mock():
    global faults, calls
    faults.clear()
    calls.clear()
    return {"status": "ok"}


def _text_to_vector(text: str, dim: int = 64) -> list[float]:
    words = re.findall(r"\b\w+\b", text.lower())
    if not words:
        v = np.zeros(dim, dtype=np.float32)
        v[0] = 1.0
        return v.tolist()

    v = np.zeros(dim, dtype=np.float32)
    for word in words:
        h = hashlib.sha256(word.encode("utf-8")).digest()
        # Derive 64 values in {-1, 1}
        # 32 bytes in sha256 -> 64 nibbles
        for i in range(dim):
            byte = h[i % len(h)]
            # bit or sign from byte
            val = 1.0 if ((byte >> (i % 8)) & 1) else -1.0
            v[i] += val

    norm = np.linalg.norm(v) + 1e-12
    v /= norm
    return v.tolist()


@app.post("/v1/embeddings")
async def post_embeddings(req: Request):
    calls.append({"route": "/v1/embeddings"})
    data = await req.json()
    inputs = data.get("input", "")
    if isinstance(inputs, str):
        inputs = [inputs]

    results = []
    total_tokens = 0
    for idx, inp in enumerate(inputs):
        vec = _text_to_vector(inp, dim=64)
        total_tokens += len(inp.split())
        results.append(
            {
                "object": "embedding",
                "embedding": vec,
                "index": idx,
            }
        )

    return {
        "object": "list",
        "data": results,
        "model": data.get("model", "mock-embed"),
        "usage": {"prompt_tokens": total_tokens, "total_tokens": total_tokens},
    }


@app.post("/v1/chat/completions")
async def post_chat_completions(req: Request):
    data = await req.json()
    calls.append(
        {
            "route": "/v1/chat/completions",
            "model": data.get("model"),
            "data": data,
        }
    )

    # Check network faults
    if _consume_fault("http500"):
        return Response(status_code=500, content="Internal Server Error (mock fault)")

    if _consume_fault("timeout"):
        time.sleep(5.0)

    if _consume_fault("bad_json"):
        return {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": '{"cards": [oops'}}
            ],
        }

    # Determine schema
    resp_format = data.get("response_format", {})
    schema_name = ""
    if isinstance(resp_format, dict):
        if "json_schema" in resp_format:
            schema_name = resp_format["json_schema"].get("name", "")
        elif "schema" in resp_format:
            schema_name = resp_format["schema"].get("title", "")

    messages = data.get("messages", [])
    user_msg = ""
    system_msg = ""
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "system":
            system_msg += content + "\n"
        elif role == "user":
            user_msg += content + "\n"

    if not schema_name:
        if (
            "ChunkCards" in system_msg
            or "CardDraft" in system_msg
            or "numbered_lines" in user_msg
            or "Lines " in user_msg
        ):
            schema_name = "ChunkCards"
        elif "MergeVerdict" in system_msg or "Card A" in user_msg:
            schema_name = "MergeVerdict"

    if schema_name == "MergeVerdict":
        # Parse Card A and Card B
        title_a = "Concept A"
        title_b = "Concept B"
        ma = re.search(r"title:\s*(.*)", user_msg)
        if ma:
            title_a = ma.group(1).strip()
            # look for second title
            mb = re.search(r"title:\s*(.*)", user_msg[ma.end() :])
            if mb:
                title_b = mb.group(1).strip()

        # Same title -> merge
        is_same = title_a.strip().lower() == title_b.strip().lower()
        if is_same:
            ans = {
                "decision": "merge",
                "reason": "Both cards explain the exact same concept.",
                "title": title_a,
                "what": f"Merged brief description of {title_a}.",
                "why": "Detailed explanation of why this concept matters across sources.",
                "how": "Detailed mechanism of how this works synthesized from both sources.",
                "when": "Useful in relevant situations.",
                "extra": "Additional synthesized context from both cards.",
                "topics": ["ML/Interpretability"],
            }
        else:
            ans = {
                "decision": "separate",
                "reason": "These cards describe separate concepts.",
                "title": None,
                "what": None,
                "why": None,
                "how": None,
                "when": None,
                "extra": None,
                "topics": [],
            }
        content_str = json.dumps(ans)
    else:
        # ChunkCards
        # 1. Parse numbered lines: ^(\d{4,})\| (.*)$
        parsed_lines: list[tuple[int, str]] = []
        for line in user_msg.splitlines():
            m = re.match(r"^(\d{4,})\|\s*(.*)$", line)
            if m:
                parsed_lines.append((int(m.group(1)), m.group(2)))

        if not parsed_lines:
            # Fallback if unnumbered or test message
            parsed_lines = [(1, "Default line of content for mock card extraction.")]

        # 2. Group into blocks (ends at blank line or before heading)
        raw_blocks: list[list[tuple[int, str]]] = []
        curr_block: list[tuple[int, str]] = []

        for line_no, text in parsed_lines:
            is_heading = text.strip().startswith("#")
            is_blank = not text.strip()

            if is_blank or is_heading:
                if curr_block:
                    raw_blocks.append(curr_block)
                    curr_block = []
                if is_heading:
                    curr_block.append((line_no, text))
            else:
                curr_block.append((line_no, text))

        if curr_block:
            raw_blocks.append(curr_block)

        # 3. Join blocks < 5 lines, cut > 40 lines
        merged_blocks: list[list[tuple[int, str]]] = []
        accum: list[tuple[int, str]] = []
        for b in raw_blocks:
            accum.extend(b)
            if len(accum) >= 5:
                # If too long, cut
                while len(accum) > 40:
                    merged_blocks.append(accum[:40])
                    accum = accum[40:]
                if accum:
                    merged_blocks.append(accum)
                    accum = []
        if accum:
            if merged_blocks:
                merged_blocks[-1].extend(accum)
            else:
                merged_blocks.append(accum)

        if not merged_blocks:
            merged_blocks = [parsed_lines]

        # Extract topics list from system prompt
        topic_list = []
        for line in system_msg.splitlines():
            line = line.strip()
            if line and not line.startswith("-") and not line.startswith("Rules:") and "/" in line:
                topic_list.append(line)

        # 4. Generate cards
        cards = []
        for idx, block in enumerate(merged_blocks):
            non_heading = [t for _, t in block if not t.strip().startswith("#") and t.strip()]
            first_text = (
                non_heading[0] if non_heading else (block[0][1] if block else "Concept Idea")
            )
            first_words = re.findall(r"\b\w+\b", first_text)
            title = " ".join(first_words[:4]).title() if first_words else "Concept Idea"

            # Sentence 1 for what
            sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", first_text) if s.strip()]
            what = sentences[0] if sentences else first_text
            # Ensure strictly less than 50 words by default
            what_words = what.split()
            if len(what_words) > 45:
                what = " ".join(what_words[:40]) + "."

            # Long description fault
            if _consume_fault("long_description"):
                what = what + " " + " ".join(["extra-word"] * 60)

            why = (
                f"Needed for {title} because it addresses the underlying requirements."
                if idx % 2 == 0
                else None
            )
            how = sentences[1] if len(sentences) > 1 else None

            start_l = block[0][0]
            end_l = block[-1][0]

            # Find matching topic
            block_text = " ".join(t for _, t in block).lower()
            matched_topics = []
            for tp in topic_list:
                last_part = tp.split("/")[-1].lower()
                if last_part in block_text:
                    matched_topics.append(tp)
                    break

            suggested = []
            if not matched_topics:
                first_w = first_words[0] if first_words else "General"
                suggested = [f"Misc/{first_w}"]

            cards.append(
                {
                    "title": title,
                    "what": what,
                    "why": why,
                    "how": how,
                    "when": None,
                    "extra": None,
                    "start_line": start_l,
                    "end_line": end_l,
                    "topics": matched_topics,
                    "suggested_topics": suggested,
                }
            )

        # Apply card faults
        if cards:
            if _consume_fault("out_of_range"):
                cards[-1]["end_line"] += 30
            if _consume_fault("small_slip"):
                cards[-1]["end_line"] += 2
            if len(cards) >= 2 and _consume_fault("overlap"):
                cards[1]["start_line"] = cards[0]["start_line"] + 5
            if len(cards) >= 3 and _consume_fault("gap"):
                # drop middle card
                cards.pop(len(cards) // 2)

        content_str = json.dumps({"cards": cards})

    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": data.get("model", "mock-cards"),
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content_str,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 150,
            "total_tokens": 270,
        },
    }
