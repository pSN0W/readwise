#!/usr/bin/env python3
"""Build fixtures/library: an example library that follows docs/contract.

Standard library only. Deterministic: running it twice gives the same bytes.
Usage:  python3 fixtures/make_fixture.py            (writes fixtures/library)
        python3 fixtures/make_fixture.py --check    (also validates against the schemas if `jsonschema` is installed)
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "library"
SCHEMAS = ROOT.parent / "docs" / "contract" / "schemas"
T0 = "2026-09-27T03:10:00Z"
MS = 1758942600000  # 2026-09-27T03:10:00Z in ms
GENERATION = 7
ANCHOR_STEP = 100  # one [line, byte] anchor every 100 lines

# ---------------------------------------------------------------- cards (text only; refs are computed)
CARDS = {
    "c_0001": dict(title="Linear probe", topics=["ML/Interpretability/Probing"],
        what="Train a tiny linear model on hidden activations to test if some information is inside them.",
        why="You cannot read activations by eye. You need a test that says 'yes, this layer knows the word is a verb'.",
        how="Save the activations for many inputs. Fit logistic regression from activations to the label. Compare accuracy across layers.",
        when="When you ask what a layer knows.",
        extra="Like logistic regression, but the inputs are a network's hidden numbers."),
    "c_0002": dict(title="Probe accuracy trap", topics=["ML/Interpretability/Probing"],
        what="A probe that scores high does not prove the model uses that information.",
        why="People claimed 'the model uses X' from probe scores alone. That was often wrong.",
        how="Compare against a control task, or follow up with a causal test such as activation patching.",
        when="Before you trust any probe result."),
    "c_0003": dict(title="Superposition", topics=["ML/Interpretability/Features"],
        what="A network stores more ideas than it has neurons, by packing them at almost-right angles.",
        why="Single neurons are confusing. One neuron fires for cats, cars and French text.",
        how="Each feature is a direction. Sparse features rarely fire together, so their directions can overlap a little.",
        when="Any time you look inside a model.",
        extra="Like PCA, but with more directions than dimensions: $k > d$."),
    "c_0004": dict(title="Polysemantic neuron", topics=["ML/Interpretability/Features"],
        what="One neuron takes part in many unrelated ideas.",
        why="It explains why 'what does neuron 42 do?' has no clean answer.",
        when="When a neuron's top examples look random.",
        extra="Opposite: a monosemantic neuron, which means one thing."),
    "c_0005": dict(title="Sparse autoencoder", topics=["ML/Interpretability/Features"],
        what="A small network that pulls the packed ideas apart, so each unit means one thing.",
        why="Superposition hides features. We need a tool to un-mix them.",
        how="Train a wide autoencoder on the activations with an L1 penalty: $\\mathcal{L} = \\|x-\\hat x\\|^2 + \\lambda\\|h\\|_1$.",
        when="When you want a list of the features a layer uses.",
        extra="Also called dictionary learning."),
    "c_0006": dict(title="Dead features", topics=["ML/Interpretability/Features"],
        what="Some autoencoder units never turn on, so they waste space.",
        why="They make the feature list look bigger than it is.",
        how="Count how often each unit fires during training. Re-start the units that never fire.",
        when="When you train your own sparse autoencoder."),
    "c_0007": dict(title="Circuit", topics=["ML/Interpretability/Circuits"],
        what="A small group of connected parts inside the model that does one job together.",
        why="Features tell you what is stored. Circuits tell you how it is used.",
        how="Trace which heads and neurons pass information to each other, then test the path by patching.",
        when="When you ask how the model computes an answer."),
    "c_0008": dict(title="Induction head", topics=["ML/Interpretability/Circuits", "ML/Transformers/Attention"],
        what="Two attention heads that work together to copy what came after the last time a token appeared.",
        why="It is the first circuit found that explains in-context learning.",
        how="Head 1 marks each token with the token before it. Head 2 looks for a match and copies the next token.",
        when="When a model repeats patterns from its prompt."),
    "c_0009": dict(title="Activation patching", topics=["ML/Interpretability/Circuits"],
        what="Swap one part of the network's activations and see what breaks.",
        why="It tests cause, not just correlation. It fixes the probe trap.",
        how="Run a clean input and a broken input. Copy one activation from clean to broken. If the output recovers, that part matters.",
        when="When you want proof that a part matters."),
    "c_0010": dict(title="Attention as lookup", topics=["ML/Transformers/Attention"],
        what="Attention is a soft dictionary lookup: a query finds matching keys and takes their values.",
        how="$\\mathrm{softmax}(QK^\\top/\\sqrt{d})\\,V$",
        when="Whenever you read transformer code."),
    "c_0011": dict(title="Habit loop", topics=["Mind/Habits/Routines"],
        what="A habit is a cue, then a routine, then a reward. Change the routine, keep the cue.",
        why="Willpower alone fails. Changing the loop works better.",
        how="Write down the cue and the reward. Keep them, and swap in a new routine.",
        when="When you want to stop or start a habit."),
    "c_0012": dict(title="Deep focus blocks", topics=["Mind/Focus/Deep work"],
        what="Plan long blocks with no switching. Hard thinking needs time to warm up.",
        why="Short gaps between meetings are too short for hard work.",
        how="Block 90 minutes in the calendar. Turn off messages. Do one task only.",
        when="When you plan a study or coding day."),
    "c_0013": dict(title="Attention residue", topics=["Mind/Focus/Deep work"],
        what="After you switch tasks, part of your mind stays on the old task for a while.",
        why="It explains why checking messages ruins focus even when it is quick.",
        when="When you decide whether to check your phone.",
        extra="Not the same as attention in transformers; the merge step kept them apart."),
}
TEXT = {
    "c_0001": ["A probe is a small linear classifier trained on activations.", "If it predicts the label well, the information is present.", "We train one probe per layer and compare the scores."],
    "c_0002": ["High probe accuracy does not mean the model uses the feature.", "The probe may learn the task by itself from rich activations.", "We need a causal test as well."],
    "c_0003": ["A layer with $n$ neurons can still hold more than $n$ features,", "if each feature is sparse. Each feature is a direction", "in activation space, not a single neuron (see Figure 3)."],
    "c_0004": ["Because directions overlap, one neuron takes part in many features.", "Its top examples then look like a mix of unrelated things."],
    "c_0005": ["To pull the features apart, train a sparse autoencoder on the activations.", "Its hidden layer is wider than the input,", "and an L1 penalty keeps most units off:", "$$\\mathcal{L} = \\|x - \\hat{x}\\|_2^2 + \\lambda \\|h\\|_1$$"],
    "c_0006": ["Some units in the autoencoder never activate.", "We call them dead features and resample them during training."],
    "c_0007": ["A circuit is a subgraph of the model: a few heads and neurons", "connected by weights, that together compute one behaviour."],
    "c_0008": ["An induction head looks back for the previous copy of the current token", "and attends to the token after it, then copies it forward."],
    "c_0009": ["Run the model on a clean and a corrupted input.", "Copy one activation from the clean run into the corrupted run.", "If the output recovers, that activation matters."],
    "c_0010": ["Think of attention as a soft lookup table.", "Each query compares itself with every key.", "The output is a weighted mix of the values."],
    "c_0011": ["Every habit has three parts: a cue, a routine and a reward.", "To change a habit, keep the cue and the reward, and swap the routine."],
    "c_0012": ["Hard work needs long, unbroken time.", "Plan blocks of 90 minutes and protect them."],
    "c_0013": ["When you switch from task A to task B, some attention stays on A.", "This residue lowers your performance on B."],
}

FIG_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect width="200" height="120" fill="#eef1f4"/>
<g stroke="#2b5c8a" stroke-width="2"><line x1="100" y1="110" x2="100" y2="15"/><line x1="100" y1="110" x2="185" y2="60"/>
<line x1="100" y1="110" x2="15" y2="55"/><line x1="100" y1="110" x2="165" y2="18" stroke-dasharray="5 3"/>
<line x1="100" y1="110" x2="35" y2="18" stroke-dasharray="5 3"/></g>
<text x="100" y="12" font-size="9" text-anchor="middle" fill="#5b6474">5 features in 2 dimensions</text></svg>
"""


def slide_svg(label: str, t: str) -> str:
    label = label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1d2330"/>'
            f'<text x="160" y="85" font-size="24" text-anchor="middle" fill="#e6eaf0">{label}</text>'
            f'<text x="160" y="120" font-size="12" text-anchor="middle" fill="#9aa4b3">slide at {t}</text></svg>\n')


class Doc:
    """Builds one content.md and records where things landed (1-based lines)."""

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.toc: list[dict] = []
        self.assets: list[dict] = []
        self.spans: dict[str, tuple[int, int]] = {}

    @property
    def next_line(self) -> int:
        return len(self.lines) + 1

    def heading(self, level: int, title: str) -> None:
        self.toc.append({"title": title, "level": level, "line": self.next_line})
        self.lines += ["#" * level + " " + title, ""]

    def filler(self, n: int, label: str) -> None:
        for i in range(n):
            self.lines.append(f"{label} supporting text, sentence {i + 1}." if i % 6 != 5 else "")

    def card(self, cid: str, pad_before: int = 0, pad_after: int = 0, label: str = "") -> None:
        start = self.next_line
        self.filler(pad_before, label)
        self.lines += TEXT[cid]
        self.filler(pad_after, label)
        self.spans[cid] = (start, self.next_line - 1)

    def image(self, path: str, caption: str, kind: str, time_s: float | None = None) -> None:
        a = {"path": path, "line": self.next_line, "caption": caption, "kind": kind}
        if time_s is not None:
            a["time_s"] = time_s
        self.assets.append(a)
        self.lines.append(f"![{caption}]({path})")


def mmss(t: int) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def build_book_a() -> tuple[Doc, list]:
    d = Doc()
    d.lines += ["# Interpretability Notes", "", "An example book for the reading helper fixture.", ""]
    d.filler(30, "Preface")
    d.heading(2, "3 · Probing")
    d.card("c_0001", 10, 40, "Probing")
    d.card("c_0002", 8, 60, "Probing")
    d.filler(5, "Transition")                                   # small gap (5 lines)
    d.heading(2, "4 · Features")
    d.card("c_0003", 4, 6, "Features")
    d.image("assets/fig-003.svg", "Figure 3: five features in two dimensions", "figure")
    s, e = d.spans["c_0003"]
    d.spans["c_0003"] = (s, d.next_line - 1)                    # the figure belongs to the card
    d.card("c_0004", 2, 12, "Features")
    d.card("c_0005", 6, 70, "Features")
    d.card("c_0006", 3, 20, "Features")
    d.filler(10, "Summary")                                     # gap of 10 lines
    d.heading(2, "5 · Circuits")
    d.card("c_0007", 10, 90, "Circuits")
    d.card("c_0008", 6, 45, "Circuits")
    d.filler(39, "Aside")                                       # gap of 39 lines (> limit 20)
    d.card("c_0009", 5, 40, "Circuits")
    d.filler(3, "End")
    pages, line, page = [], 1, 1
    while line <= len(d.lines):
        pages.append([line, page])
        line += 40
        page += 1
    return d, pages


def build_blog_b() -> tuple[Doc, list]:
    d = Doc()
    d.lines += ["# A post about probes", "", "*Example blog post for the fixture.*", ""]
    d.heading(2, "What a probe is")
    d.card("c_0001", 4, 20, "Blog")
    d.filler(4, "Blog aside")
    d.heading(2, "From probes to autoencoders")
    d.card("c_0005", 6, 30, "Blog")
    d.filler(2, "Blog end")
    return d, None


VIDEO_LEN = 2890


def build_video_c() -> tuple[Doc, list]:
    d = Doc()
    times: list[list] = []
    d.lines += ["# Talk: looking inside LLMs", ""]
    plan = [  # (chapter title, [(card, t_start, t_end)])
        ("Attention", [("c_0010", 130, 390)]),
        ("Features", [("c_0003", 750, 910), ("c_0005", 1080, 1480)]),
        ("Circuits", [("c_0008", 1860, 2180)]),
        ("Questions", []),
    ]
    slides = {130: "QKV", 750: "features", 1080: "SAE", 1480: "results", 1860: "induction", 2400: "Q&A"}
    t = 0
    card_at: dict[int, str] = {}
    card_end: dict[str, int] = {}
    for _, cs in plan:
        for cid, a, b in cs:
            card_at[a] = cid
            card_end[cid] = b
    chapter_starts = {0: "Attention", 700: "Features", 1800: "Circuits", 2380: "Questions"}
    open_card: tuple[str, int, list[str]] | None = None
    while t < VIDEO_LEN:
        if t in chapter_starts:
            d.toc.append({"title": chapter_starts[t], "level": 2, "line": d.next_line})
            d.lines.append("## " + chapter_starts[t])
            times.append([len(d.lines), t])
        if t in card_at:
            cid = card_at[t]
            open_card = (cid, d.next_line, list(TEXT[cid]))
        if t in slides:
            d.image(f"assets/slide-{t:06d}.svg", f"Slide at {mmss(t)}: {slides[t]}", "slide", t)
            times.append([len(d.lines), t])
        if open_card and open_card[2]:
            text = open_card[2].pop(0)
        else:
            text = f"(talking about the topic at {mmss(t)})"
        d.lines.append(f"[{mmss(t)}] {text}")
        times.append([len(d.lines), t])
        if open_card and t + 10 >= card_end[open_card[0]]:
            d.spans[open_card[0]] = (open_card[1], len(d.lines))
            open_card = None
        t += 10
    return d, times


def build_book_d() -> tuple[Doc, list]:
    d = Doc()
    d.lines += ["# Focus and Habits", "", "An example non-fiction book for the fixture.", ""]
    d.heading(2, "Part 1 · Habits")
    d.filler(40, "Habits intro")
    d.card("c_0011", 5, 25, "Habits")
    d.filler(8, "Habits end")
    d.heading(2, "Part 2 · Focus")
    d.filler(20, "Focus intro")
    d.card("c_0012", 5, 40, "Focus")
    d.card("c_0013", 3, 20, "Focus")
    d.filler(2, "End")
    pages, line, page = [], 1, 1
    while line <= len(d.lines):
        pages.append([line, page])
        line += 35
        page += 1
    return d, pages


SOURCES = [
    ("s_booka", "pdf", "Interpretability Notes", ["A. Example"], {"filename": "interpretability-notes.pdf"}, build_book_a, "original.pdf"),
    ("s_blogb", "blog", "A post about probes", ["B. Blogger"], {"url": "https://example.com/blog/probes"}, build_blog_b, "original.html"),
    ("s_videoc", "video", "Talk: looking inside LLMs", ["C. Speaker"], {"url": "https://www.youtube.com/watch?v=EXAMPLE0001"}, build_video_c, "original.info.json"),
    ("s_bookd", "pdf", "Focus and Habits", ["D. Writer"], {"filename": "focus-and-habits.pdf"}, build_book_d, "original.pdf"),
]

# which sources each card appears in, in this order (first = primary ref)
CARD_SOURCES = {
    "c_0001": ["s_booka", "s_blogb"], "c_0002": ["s_booka"], "c_0003": ["s_booka", "s_videoc"],
    "c_0004": ["s_booka"], "c_0005": ["s_booka", "s_blogb", "s_videoc"], "c_0006": ["s_booka"],
    "c_0007": ["s_booka"], "c_0008": ["s_booka", "s_videoc"], "c_0009": ["s_booka"],
    "c_0010": ["s_videoc"], "c_0011": ["s_bookd"], "c_0012": ["s_bookd"], "c_0013": ["s_bookd"],
}
REV = {"c_0005": 2, "c_0003": 2}


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    spans: dict[tuple[str, str], tuple[int, int]] = {}
    lib_sources = []
    for sid, kind, title, authors, origin, builder, original in SOURCES:
        doc, runs = builder()
        folder = OUT / "sources" / sid
        (folder / "assets").mkdir(parents=True)
        content = "\n".join(doc.lines) + "\n"
        (folder / "content.md").write_text(content, encoding="utf-8")
        for a in doc.assets:
            svg = FIG_SVG if a["kind"] == "figure" else slide_svg(a["caption"].split(": ")[-1], mmss(int(a.get("time_s", 0))))
            (folder / a["path"]).write_text(svg, encoding="utf-8")
        extra = []
        if kind == "pdf":
            (folder / original).write_bytes(b"%PDF-1.4\n% fixture placeholder: the real original PDF lives here\n%%EOF\n")
        elif kind == "blog":
            (folder / original).write_text(f"<!doctype html><html><head><title>{title}</title></head><body><p>Fixture placeholder for the downloaded page.</p></body></html>\n", encoding="utf-8")
        else:
            dump(folder / original, {"id": "EXAMPLE0001", "title": title, "duration": VIDEO_LEN,
                                     "chapters": [{"title": t["title"], "start_time": 0} for t in doc.toc]})
            (folder / "original.en.vtt").write_text("WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n(fixture placeholder)\n", encoding="utf-8")
            extra = ["original.en.vtt"]
        n_lines = len(doc.lines)
        anchors, pos = [], 0
        for i, line in enumerate(doc.lines):
            if i % ANCHOR_STEP == 0:
                anchors.append([i + 1, pos])
            pos += len(line.encode("utf-8")) + 1
        meta = {"schema_version": 1, "id": sid, "kind": kind, "title": title, "original": original,
                "content_sha256": hashlib.sha256(content.encode()).hexdigest(), "n_lines": n_lines,
                "content_bytes": len(content.encode("utf-8")), "anchor_step": ANCHOR_STEP, "anchors": anchors,
                "toc": doc.toc, "pages": runs if kind == "pdf" else None,
                "times": runs if kind == "video" else None, "assets": doc.assets}
        if extra:
            meta["original_extra"] = extra
        dump(folder / "meta.json", meta)
        for cid, span in doc.spans.items():
            spans[(cid, sid)] = span
        n_cards = sum(1 for c, srcs in CARD_SOURCES.items() if sid in srcs)
        lib_sources.append({"id": sid, "kind": kind, "title": title, "authors": authors, "origin": origin,
                            "added_at": T0, "status": "ready", "n_lines": n_lines, "n_cards": n_cards,
                            "pages": runs[-1][1] if kind == "pdf" else None,
                            "duration_s": VIDEO_LEN if kind == "video" else None,
                            "keywords": [t["title"] for t in doc.toc if t["level"] <= 2]})
        globals().setdefault("ASSETS", {})[sid] = doc.assets

    cards = []
    for cid, c in CARDS.items():
        refs = []
        images = []
        for sid in CARD_SOURCES[cid]:
            a, b = spans[(cid, sid)]
            refs.append({"source": sid, "start": a, "end": b})
            images += [f"sources/{sid}/{x['path']}" for x in ASSETS[sid] if a <= x["line"] <= b]  # noqa: F821
        card = {"id": cid, "rev": REV.get(cid, 1), "title": c["title"]}
        for f in ("what", "why", "how", "when", "extra"):
            if c.get(f):
                card[f] = c[f]
        card.update({"topics": c["topics"], "refs": refs, "images": images,
                     "created_at": T0, "updated_at": T0})
        cards.append(card)
    dump(OUT / "cards.json", {"schema_version": 1, "generation": GENERATION, "cards": cards,
                              "retired": [{"id": "c_0099", "into": ["c_0005"]}]})

    topics = sorted({t for c in CARDS.values() for t in c["topics"]})
    dump(OUT / "library.json", {"schema_version": 1, "generation": GENERATION, "updated_at": T0,
                                "sources": lib_sources, "topics": [{"path": p} for p in topics]})
    (OUT / "topics.yaml").write_text(
        "ML:\n  Interpretability:\n    Probing: {}\n    Features: {}\n    Circuits: {}\n  Transformers:\n    Attention: {}\n"
        "Mind:\n  Habits:\n    Routines: {}\n  Focus:\n    Deep work: {}\n", encoding="utf-8")
    dump(OUT / "tag_suggestions.json", {"schema_version": 1, "generation": GENERATION, "suggestions": [
        {"id": "t_0001", "path": "ML/Interpretability/Dictionary learning", "card_ids": ["c_0005", "c_0006"],
         "reason": "Two cards are about learning a feature dictionary.", "created_at": T0},
        {"id": "t_0002", "path": "ML/Interp/Features", "card_ids": ["c_0003"],
         "reason": "Close to an existing topic.", "similar_existing": "ML/Interpretability/Features", "created_at": T0},
        {"id": "t_0003", "path": "ML/Interpretability/Causal methods", "card_ids": ["c_0009"],
         "reason": "Patching is a causal test.", "created_at": T0},
        {"id": "t_0004", "path": "Mind/Attention", "card_ids": ["c_0013"], "reason": "About human attention.", "created_at": T0}]})

    # coverage gaps of book A, for the report (lines not inside any card range)
    def gaps(sid: str, n: int) -> list:
        covered = [False] * (n + 1)
        for (cid, s2), (a, b) in spans.items():
            if s2 == sid:
                for i in range(a, b + 1):
                    covered[i] = True
        out, i = [], 1
        while i <= n:
            if not covered[i]:
                j = i
                while j + 1 <= n and not covered[j + 1]:
                    j += 1
                out.append([i, j])
                i = j + 1
            else:
                i += 1
        return out

    report_sources = []
    for s in lib_sources:
        g = gaps(s["id"], s["n_lines"])
        inner = [x for x in g if x[0] != 1 and x[1] != s["n_lines"]]  # front/back matter is allowed
        worst = max((b - a + 1 for a, b in inner), default=0)
        cov = 100.0 * (1 - sum(b - a + 1 for a, b in g) / s["n_lines"])
        ok = worst <= 20
        report_sources.append({"source": s["id"], "title": s["title"], "status": "ok" if ok else "warning",
            "chunks_total": max(1, s["n_lines"] // 120), "chunks_ok": max(1, s["n_lines"] // 120),
            "retries": 1 if s["id"] == "s_bookd" else 0,
            "checks": {"json_valid": {"ok": True}, "ranges": {"ok": True}, "overlaps": {"ok": True},
                       "coverage": {"ok": ok, "covered_pct": round(cov, 1), "limit": 20, "gaps": inner,
                                    "detail": "" if ok else f"largest gap is {worst} lines"}},
            "cards_created": s["n_cards"], "cards_merged": 0, "splits_applied": 0, "errors": []})
    dump(OUT / "reports" / "latest.json", {"schema_version": 1, "run_id": "run_20260927_0310",
        "started_at": T0, "finished_at": "2026-09-27T03:24:00Z", "sources": report_sources})

    dump(OUT / "state" / "pixel-8.json", {"schema_version": 1, "device_id": "pixel-8", "updated_at": MS + 5000,
        "copy_prompt": {"v": "You are my tutor. I know the card below at a basic level. Go deeper using the source text. Use simple words. End with one question to check I understood.", "ts": MS},
        "my_tags": {"revisit": {"ts": MS}, "important": {"ts": MS}, "confusing": {"ts": MS}, "read later": {"ts": MS}},
        "cards": {"c_0001": {"viewed": {"rev": 1, "ts": MS}, "known": {"v": True, "ts": MS}},
                  "c_0002": {"viewed": {"rev": 1, "ts": MS}},
                  "c_0005": {"viewed": {"rev": 1, "ts": MS}, "tags": {"v": ["revisit"], "ts": MS}},
                  "c_0008": {"viewed": {"rev": 1, "ts": MS}, "explored": {"ts": MS + 1000}, "tags": {"v": ["important"], "ts": MS}},
                  "c_0010": {"viewed": {"rev": 1, "ts": MS}, "known": {"v": True, "ts": MS}}},
        "topic_decisions": {}})
    dump(OUT / "state" / "laptop-web.json", {"schema_version": 1, "device_id": "laptop-web", "updated_at": MS + 9000,
        "my_tags": {"important": {"ts": MS + 100}},
        "cards": {"c_0012": {"tags": {"v": ["important"], "ts": MS + 2000}},
                  "c_0013": {"viewed": {"rev": 1, "ts": MS + 3000}},
                  "c_0005": {"tags": {"v": ["revisit", "confusing"], "ts": MS + 4000}}},
        "topic_decisions": {"t_0004": {"action": "reject", "ts": MS + 5000}}})
    (OUT / "notes").mkdir()
    (OUT / "notes" / "c_0008.md").write_text("Compare with copying heads in small models.\n", encoding="utf-8")
    (OUT / "notes" / "c_0001.md").write_text("Why not **MLP** probes?\n", encoding="utf-8")
    (OUT / "inbox").mkdir()
    (OUT / "inbox" / "links.txt").write_text("# one URL per line; the GPU machine picks these up\n", encoding="utf-8")

    if "--check" in sys.argv:
        validate()
    print(f"wrote {OUT}")


def validate() -> None:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        print("jsonschema not installed; skipped schema validation")
        return
    def v(file: Path, name: str) -> None:
        schema = json.loads((SCHEMAS / f"{name}.schema.json").read_text())
        jsonschema.validate(json.loads(file.read_text()), schema)
    v(OUT / "library.json", "library")
    v(OUT / "cards.json", "cards")
    v(OUT / "tag_suggestions.json", "tag_suggestions")
    v(OUT / "reports" / "latest.json", "report")
    for f in (OUT / "state").glob("*.json"):
        v(f, "state")
    for f in (OUT / "sources").glob("*/meta.json"):
        v(f, "meta")
    print("schemas: all files valid")


if __name__ == "__main__":
    main()
