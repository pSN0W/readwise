// Types for every file in the library. They mirror docs/contract/schemas/*.schema.json exactly.
// Keep this file free of runtime code.

export type SourceKind = "pdf" | "blog" | "video" | "markdown";
export type SourceStatus = "processing" | "ready" | "failed";

export interface SourceSummary {
  id: string;
  kind: SourceKind;
  title: string;
  authors?: string[];
  origin: { url?: string; filename?: string };
  added_at: string;
  status: SourceStatus;
  n_lines: number;
  n_cards: number;
  pages?: number | null;
  duration_s?: number | null;
  keywords?: string[];
}

export interface LibraryManifest {
  schema_version: 1;
  generation: number;
  updated_at: string;
  sources: SourceSummary[];
  topics: { path: string }[];
}

/** [line, value] runs sorted by line: page P starts at line L, or line L starts at t seconds. */
export type Run = [number, number];

export interface TocEntry { title: string; level: number; line: number }
export interface Asset { path: string; line: number; caption?: string; kind: "figure" | "slide" | "image"; time_s?: number }

export interface SourceMeta {
  schema_version: 1;
  id: string;
  kind: SourceKind;
  title: string;
  original: string;
  original_extra?: string[];
  content_sha256: string;
  n_lines: number;
  /** Size of content.md in bytes (UTF-8). */
  content_bytes: number;
  /** An anchor every this many lines. */
  anchor_step: number;
  /** [line, byte]: where that line starts in content.md. First is [1, 0]. */
  anchors: Run[];
  toc: TocEntry[];
  pages: Run[] | null;
  times: Run[] | null;
  assets: Asset[];
}

export interface CardRef { source: string; start: number; end: number }

export const CARD_FIELDS = ["what", "why", "how", "when", "extra"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
export const CARD_FIELD_LABELS: Record<CardField, string> = {
  what: "What", why: "Why", how: "How", when: "When", extra: "Additional info",
};

export interface Card {
  id: string;
  rev: number;
  title: string;
  what?: string;
  why?: string;
  how?: string;
  when?: string;
  extra?: string;
  topics: string[];
  refs: CardRef[];
  images: string[];
  created_at: string;
  updated_at: string;
}

export interface CardsFile {
  schema_version: 1;
  generation: number;
  cards: Card[];
  retired: { id: string; into: string[] }[];
}

export interface TopicSuggestion {
  id: string;
  path: string;
  card_ids: string[];
  reason?: string;
  similar_existing?: string;
  created_at: string;
}
export interface TagSuggestionsFile { schema_version: 1; generation: number; suggestions: TopicSuggestion[] }

export interface Stamped<T> { v: T; ts: number }
export interface CardStateEntry {
  viewed?: { rev: number; ts: number };
  explored?: { ts: number };
  known?: Stamped<boolean>;
  tags?: Stamped<string[]>;
  split?: Stamped<boolean>;
}
export type TopicAction = "accept" | "rename" | "combine" | "reject";
export interface TopicDecision { action: TopicAction; path?: string; ts: number }

export interface DeviceState {
  schema_version: 1;
  device_id: string;
  updated_at: number;
  copy_prompt?: Stamped<string>;
  my_tags?: Record<string, { ts: number; deleted?: boolean }>;
  cards: Record<string, CardStateEntry>;
  topic_decisions?: Record<string, TopicDecision>;
}

export interface CheckResult { ok: boolean; detail?: string }
export interface SourceReport {
  source: string;
  title: string;
  status: "ok" | "warning" | "failed" | "skipped";
  chunks_total: number;
  chunks_ok: number;
  retries: number;
  checks: {
    json_valid: CheckResult;
    ranges: CheckResult;
    overlaps: CheckResult;
    coverage: { ok: boolean; covered_pct: number; limit: number; gaps: [number, number][]; detail?: string };
  };
  cards_created: number;
  cards_merged: number;
  /** Same-source cards with overlapping lines that the merge model kept apart (optional). */
  overlap_pairs_kept_apart?: [string, string][];
  splits_applied: number;
  errors: string[];
}
export interface IngestReport { schema_version: 1; run_id: string; started_at: string; finished_at: string; sources: SourceReport[] }

/** What a UI shows for one card, after merging all device state files. */
export type ReadStatus = "new" | "viewed" | "explored";
export interface CardView {
  status: ReadStatus;
  known: boolean;
  updated: boolean;
  tags: string[];
  split: boolean;
}
