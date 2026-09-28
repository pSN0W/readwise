import json
from pathlib import Path

from rh_ingest.contract.models import (
    CardsDocument,
    DeviceState,
    IngestReport,
    LibraryManifest,
    SourceMeta,
    TagSuggestionsDocument,
)

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "library"


def test_models_load_fixtures_library():
    assert FIXTURES_DIR.exists(), f"Fixtures dir not found at {FIXTURES_DIR}"

    # 1. library.json
    lib_path = FIXTURES_DIR / "library.json"
    with open(lib_path, "r", encoding="utf-8") as f:
        lib_data = json.load(f)
    lib = LibraryManifest.model_validate(lib_data)
    assert lib.schema_version == 1
    assert len(lib.sources) > 0

    # 2. cards.json
    cards_path = FIXTURES_DIR / "cards.json"
    with open(cards_path, "r", encoding="utf-8") as f:
        cards_data = json.load(f)
    cards = CardsDocument.model_validate(cards_data)
    assert cards.schema_version == 1
    assert len(cards.cards) > 0

    # 3. tag_suggestions.json
    tags_path = FIXTURES_DIR / "tag_suggestions.json"
    with open(tags_path, "r", encoding="utf-8") as f:
        tags_data = json.load(f)
    tags = TagSuggestionsDocument.model_validate(tags_data)
    assert tags.schema_version == 1

    # 4. reports/*.json
    reports_dir = FIXTURES_DIR / "reports"
    for report_file in reports_dir.glob("*.json"):
        with open(report_file, "r", encoding="utf-8") as f:
            rep_data = json.load(f)
        rep = IngestReport.model_validate(rep_data)
        assert rep.schema_version == 1

    # 5. sources/*/meta.json
    sources_dir = FIXTURES_DIR / "sources"
    for meta_file in sources_dir.glob("*/meta.json"):
        with open(meta_file, "r", encoding="utf-8") as f:
            meta_data = json.load(f)
        meta = SourceMeta.model_validate(meta_data)
        assert meta.schema_version == 1
        assert meta.id.startswith("s_")

    # 6. state/*.json
    state_dir = FIXTURES_DIR / "state"
    for state_file in state_dir.glob("*.json"):
        with open(state_file, "r", encoding="utf-8") as f:
            state_data = json.load(f)
        st = DeviceState.model_validate(state_data)
        assert st.schema_version == 1
        assert st.device_id
