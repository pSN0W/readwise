"""LLM and Embedding client using LangChain ChatOpenAI and OpenAIEmbeddings."""

from dataclasses import dataclass
from typing import Any, TypeVar

import numpy as np
from langchain_core.messages import BaseMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from rh_ingest.config import EmbedSettings, LLMSettings

T = TypeVar("T")


class LLMFormatError(Exception):
    def __init__(self, raw: str, error: str):
        self.raw = raw
        self.error = error
        super().__init__(f"LLM format error: {error}\nRaw content:\n{raw}")


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    def add(self, usage_meta: dict[str, Any] | None) -> None:
        if not usage_meta:
            return
        p = usage_meta.get("input_tokens") or usage_meta.get("prompt_tokens") or 0
        c = usage_meta.get("output_tokens") or usage_meta.get("completion_tokens") or 0
        tot = usage_meta.get("total_tokens") or (p + c)
        self.prompt_tokens += p
        self.completion_tokens += c
        self.total_tokens += tot


class LLMClient:
    """Wrapper around LangChain chat and embeddings for Reading Helper."""

    def __init__(self, llm: LLMSettings, emb: EmbedSettings):
        self.cfg = llm
        self.chat = ChatOpenAI(
            base_url=llm.base_url,
            api_key=llm.api_key.get_secret_value(),
            model=llm.model,
            temperature=llm.temperature,
            max_tokens=llm.max_tokens,
            timeout=llm.timeout_s,
            max_retries=llm.max_retries,
            extra_body=llm.extra_body or None,
        )
        self.emb = OpenAIEmbeddings(
            base_url=emb.base_url,
            api_key=emb.api_key.get_secret_value(),
            model=emb.model,
            chunk_size=emb.batch,
            check_embedding_ctx_length=False,
        )
        self.usage = Usage()

    def chat_json(self, schema: type[T], messages: list[BaseMessage]) -> T:
        method = self.cfg.structured_method
        strict = self.cfg.strict if method == "json_schema" else None

        runnable = self.chat.with_structured_output(
            schema,
            method=method,
            include_raw=True,
            strict=strict,
        )

        try:
            out = runnable.invoke(messages)
        except Exception as exc:
            raw_text = ""
            if hasattr(exc, "errors") and callable(exc.errors):
                try:
                    err_list = exc.errors()
                    if err_list and "input" in err_list[0]:
                        raw_text = str(err_list[0]["input"])
                except Exception:
                    pass
            if not raw_text and hasattr(exc, "response"):
                try:
                    raw_text = str(exc.response.text)
                except Exception:
                    pass
            raise LLMFormatError(raw=raw_text, error=str(exc)) from exc

        raw_msg = out.get("raw")
        if hasattr(raw_msg, "usage_metadata") and raw_msg.usage_metadata:
            self.usage.add(raw_msg.usage_metadata)
        elif hasattr(raw_msg, "response_metadata") and "token_usage" in raw_msg.response_metadata:
            self.usage.add(raw_msg.response_metadata["token_usage"])

        parsed = out.get("parsed")
        if parsed is None:
            raw_content = str(getattr(raw_msg, "content", ""))
            err = str(out.get("parsing_error", "Failed to parse structured output"))
            raise LLMFormatError(raw=raw_content, error=err)

        return parsed

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, 64), dtype="float32")
        v = np.asarray(self.emb.embed_documents(texts), dtype="float32")
        if v.ndim == 1:
            v = v.reshape(1, -1)
        # L2-normalise -> inner product = cosine
        norms = np.linalg.norm(v, axis=1, keepdims=True) + 1e-12
        v /= norms
        return v
