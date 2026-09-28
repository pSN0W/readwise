"""LineChunker wrapping LangChain RecursiveCharacterTextSplitter with exact line ranges."""

from collections.abc import Callable
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from rh_ingest.config import ChunkSettings


@dataclass(frozen=True)
class Chunk:
    idx: int
    start: int  # first line, inclusive (1-based)
    end: int  # last line, inclusive (1-based)
    own_end: int  # lines own_end+1 .. end are also in the next chunk (overlap zone)


def get_tokenizer_counter(tokenizer_name: str) -> Callable[[str], int]:
    if tokenizer_name == "chars/4":
        return lambda t: max(1, len(t) // 4)
    if tokenizer_name.startswith("tiktoken:"):
        enc_name = tokenizer_name.split(":", 1)[1]
        import tiktoken

        enc = tiktoken.get_encoding(enc_name)
        return lambda t: max(1, len(enc.encode(t)))
    return lambda t: max(1, len(t) // 4)


class LineChunker:
    """Chunks text by lines using RecursiveCharacterTextSplitter without cutting mid-line."""

    def __init__(self, cfg: ChunkSettings):
        self.cfg = cfg
        count_fn = get_tokenizer_counter(cfg.tokenizer)
        overlap_tokens = int(cfg.max_tokens * cfg.overlap)
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=cfg.max_tokens,
            chunk_overlap=overlap_tokens,
            length_function=count_fn,
            separators=cfg.separators,
            keep_separator="start",
            strip_whitespace=False,
        )

    def split(self, text: str) -> list[Chunk]:
        if not text.strip():
            return []

        pieces = self.splitter.split_text(text)
        if not pieces:
            return []

        chunks: list[Chunk] = []
        pos = 0
        for idx, piece in enumerate(pieces):
            # Locate piece in text from around previous pos (taking overlap into account)
            search_from = max(0, pos - 4000)
            found = text.find(piece, search_from)
            if found == -1:
                found = text.find(piece)
            if found == -1:
                # Fallback to piece without leading newlines
                p_core = piece.lstrip("\n")
                found = text.find(p_core, search_from)

            char_start = max(0, found)
            char_end = char_start + len(piece) - 1
            pos = char_start + len(piece)

            start_line = text.count("\n", 0, char_start) + 1
            end_line = text.count("\n", 0, char_end) + 1

            chunks.append(Chunk(idx=idx, start=start_line, end=end_line, own_end=end_line))

        # Adjust own_end and enforce no holes
        final_chunks: list[Chunk] = []
        for i in range(len(chunks)):
            c = chunks[i]
            if i + 1 < len(chunks):
                next_c = chunks[i + 1]
                if next_c.start > c.end + 1:
                    raise ValueError(f"LangChain produced gap between chunks {c} and {next_c}")
                own_end = min(c.end, next_c.start - 1)
            else:
                own_end = c.end
            final_chunks.append(Chunk(idx=c.idx, start=c.start, end=c.end, own_end=own_end))

        return final_chunks

    def chunk_lines(self, lines: list[str]) -> list[Chunk]:
        """Convenience method to chunk list of lines."""
        text = "\n".join(lines)
        return self.split(text)
