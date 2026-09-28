from pathlib import Path

import respx

from rh_ingest.config import Settings
from rh_ingest.contract.writer import LibraryWriter
from rh_ingest.ingest.blog import BlogIngestor
from rh_ingest.ingest.pdf import FakeEngine, PdfIngestor
from rh_ingest.ingest.youtube import YouTubeIngestor, dedupe_rolling_cues, parse_vtt
from rh_ingest.intake.refs import SourceRef


def test_blog_ingestor(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    cfg = Settings(library_dir=lib_dir, work_dir=work_dir)
    writer = LibraryWriter(lib_dir)

    blog_html = Path(__file__).resolve().parents[1] / "inputs" / "blog.html"
    assert blog_html.exists()

    ref = SourceRef(
        kind_hint="blog", path=blog_html, url="https://example.com/posts/circuits", sid="s_blog_01"
    )
    ingestor = BlogIngestor(cfg)

    with respx.mock(base_url="https://example.com") as respx_mock:
        respx_mock.get("/images/circuit.png").respond(
            status_code=200,
            content=b"\x89PNG\r\n\x1a\nfake-png-data",
            headers={"Content-Type": "image/png"},
        )
        meta = ingestor.ingest(ref, writer)

    assert meta.id == "s_blog_01"
    assert meta.kind == "blog"
    assert meta.title == "Understanding Neural Network Circuits"
    assert meta.n_lines > 5

    content = (lib_dir / "sources" / "s_blog_01" / "content.md").read_text(encoding="utf-8")
    assert "Understanding Neural Network Circuits" in content
    assert "Induction heads are two-layer circuits" in content
    assert len(meta.assets) == 1
    assert "assets/" in meta.assets[0].path


def test_pdf_ingestor_fake_engine(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    cfg = Settings(library_dir=lib_dir, work_dir=work_dir)
    writer = LibraryWriter(lib_dir)

    pages_json = Path(__file__).resolve().parents[1] / "inputs" / "pdf_pages.json"
    assert pages_json.exists()

    dummy_pdf = tmp_path / "sample.pdf"
    dummy_pdf.write_bytes(b"%PDF-1.4 fake pdf data")

    ref = SourceRef(kind_hint="pdf", path=dummy_pdf, url=None, sid="s_pdf_01")
    engine = FakeEngine(pages_json)
    ingestor = PdfIngestor(cfg, engine=engine)

    meta = ingestor.ingest(ref, writer)

    assert meta.id == "s_pdf_01"
    assert meta.kind == "pdf"
    assert meta.title == "Chapter 1: Introduction"

    # Verify pages: exactly 3 pages, strictly sorted line numbers
    assert meta.pages is not None
    assert len(meta.pages) == 3
    assert meta.pages[0][1] == 1
    assert meta.pages[1][1] == 2
    assert meta.pages[2][1] == 3
    # Check lines strictly increasing: line_1 < line_2 < line_3
    assert meta.pages[0][0] < meta.pages[1][0] < meta.pages[2][0]

    content = (lib_dir / "sources" / "s_pdf_01" / "content.md").read_text(encoding="utf-8")
    assert "Chapter 1: Introduction" in content
    assert "Linear probes can measure the presence" in content
    assert "Sparse autoencoders offer a promising path forward" in content


def test_youtube_ingestor_cues_and_chapters(tmp_path: Path):
    lib_dir = tmp_path / "library"
    work_dir = tmp_path / "work"
    cfg = Settings(library_dir=lib_dir, work_dir=work_dir)
    writer = LibraryWriter(lib_dir)

    info_json = Path(__file__).resolve().parents[1] / "inputs" / "video.info.json"
    vtt_file = Path(__file__).resolve().parents[1] / "inputs" / "video.en.vtt"
    assert info_json.exists()
    assert vtt_file.exists()

    ref = SourceRef(
        kind_hint="video",
        path=info_json,
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sid="s_vid_01",
    )
    ingestor = YouTubeIngestor(cfg)
    meta = ingestor.ingest(ref, writer)

    assert meta.id == "s_vid_01"
    assert meta.kind == "video"
    assert meta.title == "Lecture on Transformers"

    # Verify times strictly sorted
    assert meta.times is not None
    for i in range(len(meta.times) - 1):
        assert meta.times[i][0] < meta.times[i + 1][0]

    # Verify TOC has chapters
    assert len(meta.toc) == 2
    assert meta.toc[0].title == "Introduction"
    assert meta.toc[1].title == "Self-Attention Mechanism"

    content = (lib_dir / "sources" / "s_vid_01" / "content.md").read_text(encoding="utf-8")
    assert "## Introduction" in content
    assert "## Self-Attention Mechanism" in content
    assert "[0:00]" in content
    assert "welcome everyone to the lecture on transformers" in content

    # Test rolling deduplication helper directly
    cues = parse_vtt(vtt_file.read_text(encoding="utf-8"))
    deduped = dedupe_rolling_cues(cues)
    orig_words = sum(len(c.text.split()) for c in cues)
    dedup_words = sum(len(c.text.split()) for c in deduped)
    assert dedup_words < orig_words
    full_text = " ".join(c.text for c in deduped)
    assert full_text.count("welcome everyone to") == 1
