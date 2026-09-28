<script lang="ts">
  // W12 Ingest report (reports/latest.json): the 4 checks per source, chunks, retries, merges, errors.
  import { app } from "../lib/app.svelte.ts";
  import { readHref } from "../lib/router.svelte.ts";

  const lib = $derived(app.lib!);
  const rep = $derived(lib.report);
  const fmt = (iso: string) => new Date(iso).toLocaleString();
</script>

<div class="view" data-testid="report-view">
  {#if !rep}
    <p class="empty">No ingest report yet (reports/latest.json is missing).</p>
  {:else}
    <div class="toolbar">
      <b>Last ingest run</b>
      <span class="small mono">{rep.run_id}</span>
      <span class="small">{fmt(rep.started_at)} → {fmt(rep.finished_at)} · checks run after every model call</span>
    </div>
    <div class="col wrap" data-keep-scroll="report">
      <div class="tbl">
        <table class="chk">
          <thead><tr><th>Source</th><th>Status</th><th>Chunks</th><th>JSON valid</th><th>Ranges in chunk</th><th>No overlaps</th><th>Line coverage</th><th>Cards</th><th>Errors</th></tr></thead>
          <tbody>
            {#each rep.sources as s (s.source)}
              {@const c = s.checks}
              <tr data-sid={s.source}>
                <td><a href={readHref(s.source)}><b>{s.title}</b></a><div class="small mono">{s.source}</div></td>
                <td><span class={s.status === "ok" ? "ok" : s.status === "warning" ? "wn" : "bad"}>{s.status}</span></td>
                <td class="mono small">{s.chunks_ok} / {s.chunks_total}{s.retries ? ` · ${s.retries} retr${s.retries === 1 ? "y" : "ies"}` : ""}</td>
                <td><span class={c.json_valid.ok ? "ok" : "bad"}>{c.json_valid.ok ? "✓" : "✗"}</span>{#if c.json_valid.detail}<div class="small">{c.json_valid.detail}</div>{/if}</td>
                <td><span class={c.ranges.ok ? "ok" : "bad"}>{c.ranges.ok ? "✓" : "✗"}</span>{#if c.ranges.detail}<div class="small">{c.ranges.detail}</div>{/if}</td>
                <td><span class={c.overlaps.ok ? "ok" : "bad"}>{c.overlaps.ok ? "✓" : "✗"}</span>{#if c.overlaps.detail}<div class="small">{c.overlaps.detail}</div>{/if}</td>
                <td>
                  <span class={c.coverage.ok ? "ok" : "wn"}>{c.coverage.ok ? "✓" : "⚠"} {c.coverage.covered_pct}%</span>
                  <div class="small">limit: {c.coverage.limit} lines in a row{c.coverage.detail ? " · " + c.coverage.detail : ""}</div>
                  {#if c.coverage.gaps.length}
                    <div class="gaps">
                      {#each c.coverage.gaps as [a, b] (a)}
                        <a class="src" class:long={b - a + 1 > c.coverage.limit} href={readHref(s.source, a)} title="Open the reader at line {a}">L{a}–{b} ({b - a + 1})</a>
                      {/each}
                    </div>
                  {/if}
                </td>
                <td class="small">{s.cards_created} created · {s.cards_merged} merged · {s.splits_applied} splits applied</td>
                <td class="small">{#each s.errors as e, i (i)}<div class="bad">{e}</div>{:else}—{/each}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="excerpt small">
        <b>What each check means.</b> JSON valid: the model answer matches the card schema. Ranges in chunk: every card's lines are inside the chunk it came from.
        No overlaps: two cards from one chunk do not share lines (the chunk overlap is allowed). Line coverage: at most “limit” lines in a row may have no card.
        Failed chunks are retried, then listed here. Red gaps are longer than the limit.
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap{padding:18px;gap:14px;border:0}
  .tbl{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--paper)}
  table{border-collapse:collapse;width:100%;font-size:.84rem}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-family:var(--mono);font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
  tr:last-child td{border-bottom:0}
  td a{color:inherit}
  .gaps{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .src.long{border-color:var(--rule-red);color:var(--rule-red)}
  .excerpt{background:var(--ground);border:1px solid var(--line);border-radius:6px;padding:10px 12px;line-height:1.5}
</style>
