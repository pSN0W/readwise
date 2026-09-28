from pathlib import Path

from rh_ingest.config import Settings
from rh_ingest.contract.writer import LibraryWriter
from rh_ingest.ingest.base import DocBuilder, ingestor_for
from rh_ingest.ingest.markdown import MarkdownIngestor
from rh_ingest.intake.refs import SourceRef, normalize_url


def test_source_ref_normalization(tmp_path: Path):
    # Path ref
    f = tmp_path / "test.md"
    f.write_text("Hello world", encoding="utf-8")
    ref = SourceRef.from_path(f)
    assert ref.sid.startswith("s_")
    assert len(ref.sid) == 12

    # URL normalizations
    assert (
        normalize_url("HTTPS://Example.COM/page?utm_source=twitter&foo=bar#section")
        == "https://example.com/page?foo=bar"
    )
    assert (
        normalize_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s") == "youtube:dQw4w9WgXcQ"
    )
    assert normalize_url("https://youtu.be/dQw4w9WgXcQ") == "youtube:dQw4w9WgXcQ"


def test_doc_builder(tmp_path: Path):
    assets_dir = tmp_path / "assets"
    doc = DocBuilder(assets_dir)

    doc.page(1)
    l1 = doc.heading(1, "Title")
    assert l1 == 1

    l2 = doc.text("Paragraph one line 1\nParagraph one line 2")
    assert l2 == 2

    # Dummy image
    img_file = tmp_path / "fig.png"
    img_file.write_bytes(b"fake-png-data")
    img_line = doc.image(img_file, "Caption", "figure")

    built = doc.build()
    assert built.pages == [[1, 1]]
    assert len(built.toc) == 1
    assert built.toc[0].title == "Title"
    assert len(built.assets) == 1
    assert built.assets[0].line == img_line


def test_markdown_ingestor_sample(tmp_path: Path):
    sample_path = Path(__file__).resolve().parents[1] / "inputs" / "sample.md"
    assert sample_path.exists(), f"sample.md not found at {sample_path}"

    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    cfg = Settings(library_dir=lib_dir, work_dir=work_dir)

    ref = SourceRef.from_path(sample_path)
    ingestor = ingestor_for(ref, cfg)
    assert isinstance(ingestor, MarkdownIngestor)

    writer = LibraryWriter(lib_dir)
    meta = ingestor.ingest(ref, writer)

    assert meta.id == ref.sid
    assert meta.kind == "markdown"
    assert meta.n_lines >= 300
    assert len(meta.toc) >= 3
    assert len(meta.assets) >= 1
    assert (lib_dir / "sources" / ref.sid / "content.md").exists()
    assert (lib_dir / "sources" / ref.sid / "meta.json").exists()
