import httpx
import numpy as np
import pytest
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import SecretStr

from rh_ingest.config import EmbedSettings, LLMSettings
from rh_ingest.llm.client import LLMClient, LLMFormatError
from rh_ingest.llm.schemas import ChunkCards


def test_llm_client_chat_json_cards(mock_server: str):
    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-cards"
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-embed"
    )
    client = LLMClient(llm_cfg, emb_cfg)

    # Reset mock
    httpx.post(f"{mock_server}/_mock/reset")

    messages = [
        SystemMessage("Rules:\nTopic list:\nML/Features\n"),
        HumanMessage(
            "Lines 1-20:\n0001| Neural networks store features in superposition.\n0002| This allows more concepts than neurons."
        ),
    ]
    res = client.chat_json(ChunkCards, messages)
    assert isinstance(res, ChunkCards)
    assert len(res.cards) > 0
    assert res.cards[0].title
    assert res.cards[0].what
    assert res.cards[0].start_line >= 1
    assert client.usage.total_tokens > 0


def test_llm_client_bad_json_fault(mock_server: str):
    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-cards"
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-embed"
    )
    client = LLMClient(llm_cfg, emb_cfg)

    httpx.post(f"{mock_server}/_mock/reset")
    httpx.post(f"{mock_server}/_mock/faults", json={"bad_json": 1})

    messages = [HumanMessage("0001| Some text here")]
    with pytest.raises(LLMFormatError) as exc:
        client.chat_json(ChunkCards, messages)
    assert "LLM format error" in str(exc.value)


def test_llm_client_http500_retries(mock_server: str):
    # Set max_retries = 3 in LLMSettings
    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-cards", max_retries=3
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-embed"
    )
    client = LLMClient(llm_cfg, emb_cfg)

    httpx.post(f"{mock_server}/_mock/reset")
    # 2 http500 faults -> fails twice, succeeded on 3rd attempt
    httpx.post(f"{mock_server}/_mock/faults", json={"http500": 2})

    messages = [HumanMessage("0001| Line of text for retry test")]
    res = client.chat_json(ChunkCards, messages)
    assert len(res.cards) > 0


def test_llm_client_embed_vectors(mock_server: str):
    llm_cfg = LLMSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-cards"
    )
    emb_cfg = EmbedSettings(
        base_url=f"{mock_server}/v1", api_key=SecretStr("dev"), model="mock-embed"
    )
    client = LLMClient(llm_cfg, emb_cfg)

    # Embed two identical descriptions and one different
    desc_a = "Neural networks store features in superposition packing them closely."
    desc_b = "Neural networks store features in superposition packing them closely."
    desc_c = "Quantum computing uses qubits and entanglement for parallelism."

    vecs = client.embed([desc_a, desc_b, desc_c])
    assert vecs.shape == (3, 64)

    # Verify unit vectors (L2 norm == 1.0)
    norms = np.linalg.norm(vecs, axis=1)
    np.testing.assert_allclose(norms, [1.0, 1.0, 1.0], atol=1e-5)

    # Same description gives cosine > 0.95 (in fact ~ 1.0)
    cos_ab = np.dot(vecs[0], vecs[1])
    assert cos_ab > 0.95

    # Different description gives lower cosine
    cos_ac = np.dot(vecs[0], vecs[2])
    assert cos_ac < cos_ab
