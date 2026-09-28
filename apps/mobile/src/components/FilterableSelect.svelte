<script lang="ts">
  import { tick } from "svelte";

  interface Option {
    key?: string;
    value?: string;
    label: string;
  }

  let {
    value = $bindable(""),
    options = [],
    ariaLabel = "Select",
    testId = "select",
    onchange,
    placeholder = "Type to filter…",
  }: {
    value?: string;
    options: Option[];
    ariaLabel?: string;
    testId?: string;
    onchange?: (val: string) => void;
    placeholder?: string;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let isEditing = $state(false);
  let highlightedIndex = $state(-1);
  let inputEl: HTMLInputElement | undefined = $state();
  let rootEl: HTMLDivElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const normalized = $derived(
    options.map((o) => ({
      val: (o.value ?? o.key ?? "") as string,
      label: o.label,
    }))
  );

  const selected = $derived(
    normalized.find((o) => o.val === value) ?? normalized[0]
  );

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter(
      (o) => o.label.toLowerCase().includes(q) || o.val.toLowerCase().includes(q)
    );
  });

  // Display text in the textbox: shows user query while typing, or selected label when not editing
  const displayValue = $derived(
    isEditing ? query : (selected?.label ?? "")
  );

  function openDropdown() {
    if (!open) {
      open = true;
      highlightedIndex = -1;
    }
  }

  function closeDropdown() {
    open = false;
    isEditing = false;
    query = "";
    highlightedIndex = -1;
  }

  function choose(val: string) {
    value = val;
    closeDropdown();
    onchange?.(val);
  }

  function onInputFocus() {
    openDropdown();
    inputEl?.select();
  }

  function onTextInput(e: Event) {
    const text = (e.target as HTMLInputElement).value;
    query = text;
    isEditing = true;
    highlightedIndex = 0;
    if (!open) open = true;
  }

  function clearFilter() {
    query = "";
    isEditing = true;
    if (inputEl) {
      inputEl.value = "";
      inputEl.focus();
    }
    highlightedIndex = -1;
    openDropdown();
  }

  function toggleOpen() {
    if (open) {
      closeDropdown();
    } else {
      openDropdown();
      inputEl?.focus();
    }
  }

  function onSelectChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    value = val;
    onchange?.(val);
  }

  function onDoc(e: PointerEvent) {
    if (open && rootEl && !rootEl.contains(e.target as Node)) {
      closeDropdown();
    }
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        openDropdown();
      } else if (filtered.length > 0) {
        highlightedIndex = (highlightedIndex + 1) % filtered.length;
        scrollToHighlighted();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openDropdown();
      } else if (filtered.length > 0) {
        highlightedIndex = (highlightedIndex - 1 + filtered.length) % filtered.length;
        scrollToHighlighted();
      }
    } else if (e.key === "Enter") {
      if (open && filtered.length > 0) {
        e.preventDefault();
        const target =
          highlightedIndex >= 0 && highlightedIndex < filtered.length
            ? filtered[highlightedIndex]
            : filtered[0];
        choose(target.val);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    }
  }

  async function scrollToHighlighted() {
    await tick();
    if (!listEl) return;
    const items = listEl.querySelectorAll<HTMLElement>(".option-item");
    const item = items[highlightedIndex];
    item?.scrollIntoView({ block: "nearest" });
  }
</script>

<svelte:document onpointerdown={onDoc} />

<div class="f-combobox" bind:this={rootEl}>
  <!-- Native select for test accessibility and form interactions -->
  <select
    data-testid={testId}
    aria-label={ariaLabel}
    {value}
    onchange={onSelectChange}
    class="native-select"
    tabindex="-1"
  >
    {#each normalized as opt (opt.val)}
      <option value={opt.val}>{opt.label}</option>
    {/each}
  </select>

  <!-- Visible Combobox: A real textbox with options where the user types directly to filter -->
  <div class="combo-box" class:open>
    <div class="search-icon-wrap" aria-hidden="true">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
      </svg>
    </div>

    <input
      type="text"
      class="combo-input"
      bind:this={inputEl}
      value={displayValue}
      oninput={onTextInput}
      onfocus={onInputFocus}
      onkeydown={onInputKeydown}
      {placeholder}
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls="{testId}-panel"
      role="combobox"
      data-testid="{testId}-filter-input"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />

    {#if isEditing && query}
      <button
        type="button"
        class="action-btn clear-btn"
        aria-label="Clear filter"
        tabindex="-1"
        onpointerdown={(e) => { e.preventDefault(); clearFilter(); }}
        data-testid="{testId}-clear"
      >✕</button>
    {/if}

    <button
      type="button"
      class="action-btn arrow-btn"
      aria-label="Toggle options"
      tabindex="-1"
      data-testid="{testId}-trigger"
      onpointerdown={(e) => { e.preventDefault(); toggleOpen(); }}
    >
      <span class="arrow" class:rotated={open} aria-hidden="true">▾</span>
    </button>
  </div>

  {#if open}
    <div class="popover" role="listbox" id="{testId}-panel" aria-label={ariaLabel} data-testid="{testId}-panel">
      <div class="popover-header">
        <span class="count-badge">{filtered.length} {filtered.length === 1 ? "option" : "options"}</span>
        {#if query}
          <span class="filter-hint">Matching "{query}"</span>
        {/if}
      </div>

      <div class="options-list" bind:this={listEl}>
        {#each filtered as opt, idx (opt.val)}
          <button
            type="button"
            class="option-item"
            class:selected={opt.val === value}
            class:highlighted={idx === highlightedIndex}
            role="option"
            aria-selected={opt.val === value}
            data-option-value={opt.val}
            onpointerdown={(e) => { e.preventDefault(); choose(opt.val); }}
          >
            <span class="opt-label">{opt.label}</span>
            {#if opt.val === value}
              <span class="check" aria-hidden="true">✓</span>
            {/if}
          </button>
        {:else}
          <div class="no-options">
            No options match "{query}"
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .f-combobox {
    position: relative;
    min-width: 0;
    flex: 1;
    display: flex;
  }
  .native-select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.001;
    pointer-events: none;
    z-index: -1;
  }
  .combo-box {
    width: 100%;
    display: flex;
    align-items: center;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: .85rem;
    color: var(--ink);
    min-height: 36px;
    padding: 0 4px 0 8px;
    gap: 4px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .combo-box:focus-within, .combo-box.open {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .search-icon-wrap {
    display: flex;
    align-items: center;
    color: var(--muted);
    flex: none;
  }
  .search-icon {
    width: 14px;
    height: 14px;
  }
  .combo-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    font-size: .85rem;
    color: var(--ink);
    padding: 6px 2px;
    outline: none;
    text-overflow: ellipsis;
  }
  .combo-input::placeholder {
    color: var(--muted);
  }
  .action-btn {
    background: none;
    border: none;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    flex: none;
    padding: 0;
    transition: background .1s ease, color .1s ease;
  }
  .action-btn:hover {
    background: var(--chip);
    color: var(--ink);
  }
  .clear-btn {
    font-size: .8rem;
  }
  .arrow {
    font-size: .8rem;
    transition: transform .15s ease;
  }
  .arrow.rotated {
    transform: rotate(180deg);
  }
  .popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    min-width: 260px;
    max-width: min(380px, 92vw);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: pop .12s ease-out;
  }
  @keyframes pop {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--ground);
    border-bottom: 1px solid var(--line);
    font-size: .72rem;
    color: var(--muted);
  }
  .count-badge {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .filter-hint {
    font-style: italic;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .options-list {
    max-height: 250px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    overscroll-behavior: contain;
  }
  .option-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: none;
    border: 0;
    color: var(--ink);
    font-size: .85rem;
    text-align: left;
    cursor: pointer;
    min-height: 36px;
    transition: background .1s ease;
    width: 100%;
  }
  .option-item:hover, .option-item.highlighted {
    background: var(--chip);
  }
  .option-item.selected {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .opt-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    color: var(--accent);
    font-weight: 700;
    font-size: .85rem;
  }
  .no-options {
    padding: 16px;
    text-align: center;
    color: var(--muted);
    font-size: .82rem;
  }
</style>
