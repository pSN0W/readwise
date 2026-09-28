<script lang="ts">
  import { tick } from "svelte";

  export interface FilterOption {
    value: string;
    label: string;
    sub?: string;
    group?: string;
  }

  export interface FilterGroup {
    group: string;
    options: FilterOption[];
  }

  export type FilterItem = FilterOption | FilterGroup;

  let {
    id = "",
    value = $bindable(""),
    items = [],
    ariaLabel = "",
    placeholder = "Type to filter…",
    className = "",
    onchange,
  }: {
    id?: string;
    value?: string;
    items: FilterItem[];
    ariaLabel?: string;
    placeholder?: string;
    className?: string;
    onchange?: (val: string) => void;
  } = $props();

  let isOpen = $state(false);
  let filterQuery = $state("");
  let activeIndex = $state(0);
  let isEditing = $state(false);

  let wrapEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let dropdownEl = $state<HTMLDivElement | null>(null);
  let selectEl = $state<HTMLSelectElement | null>(null);

  const listboxId = $derived((id ? id : "fsel") + "-listbox");

  // Normalize items into groups
  const normalizedGroups = $derived.by((): FilterGroup[] => {
    const res: FilterGroup[] = [];
    let currentUngrouped: FilterOption[] = [];

    for (const it of items) {
      if ("options" in it && Array.isArray(it.options)) {
        if (currentUngrouped.length > 0) {
          res.push({ group: "", options: currentUngrouped });
          currentUngrouped = [];
        }
        res.push(it);
      } else if ("value" in it) {
        const opt = it as FilterOption;
        if (opt.group) {
          let g = res.find((x) => x.group === opt.group);
          if (!g) {
            g = { group: opt.group, options: [] };
            res.push(g);
          }
          g.options.push(opt);
        } else {
          currentUngrouped.push(opt);
        }
      }
    }
    if (currentUngrouped.length > 0) {
      res.unshift({ group: "", options: currentUngrouped });
    }
    return res;
  });

  // Flat list of all options
  const allFlatOptions = $derived.by((): FilterOption[] => {
    const list: FilterOption[] = [];
    for (const g of normalizedGroups) {
      for (const opt of g.options) {
        list.push(opt);
      }
    }
    return list;
  });

  // Selected option label
  const selectedOption = $derived.by(() => allFlatOptions.find((o) => o.value === value));
  const selectedLabel = $derived.by(() => selectedOption?.label ?? value ?? "");

  // Text shown in the input box
  const displayValue = $derived(isEditing ? filterQuery : selectedLabel);

  // Filtered groups based on typed text
  const filteredGroups = $derived.by((): FilterGroup[] => {
    const sq = filterQuery.trim().toLowerCase();
    if (!sq) return normalizedGroups;

    const out: FilterGroup[] = [];
    for (const g of normalizedGroups) {
      const gMatch = g.group && g.group.toLowerCase().includes(sq);
      const matchingOpts = g.options.filter(
        (o) =>
          gMatch ||
          o.label.toLowerCase().includes(sq) ||
          (o.sub && o.sub.toLowerCase().includes(sq)) ||
          o.value.toLowerCase().includes(sq)
      );
      if (matchingOpts.length > 0) {
        out.push({ group: g.group, options: matchingOpts });
      }
    }
    return out;
  });

  // Flat list of filtered options for keyboard navigation
  const filteredFlatOptions = $derived.by((): FilterOption[] => {
    const list: FilterOption[] = [];
    for (const g of filteredGroups) {
      for (const o of g.options) {
        list.push(o);
      }
    }
    return list;
  });

  // Reset active index when filtered options change
  $effect(() => {
    void filterQuery;
    activeIndex = 0;
  });

  function openDropdown(prefillQuery = "") {
    filterQuery = prefillQuery;
    isOpen = true;
    isEditing = true;
    const currentIdx = filteredFlatOptions.findIndex((o) => o.value === value);
    activeIndex = currentIdx >= 0 ? currentIdx : 0;
  }

  function closeDropdown() {
    isOpen = false;
    isEditing = false;
    filterQuery = "";
  }

  let updatingFromNative = false;

  function choose(newVal: string) {
    const changed = value !== newVal;
    if (changed) {
      value = newVal;
      onchange?.(newVal);
    }
    if (selectEl && selectEl.value !== newVal && !updatingFromNative) {
      selectEl.value = newVal;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeDropdown();
    inputEl?.blur();
  }

  function onFocus() {
    isEditing = true;
    filterQuery = "";
    openDropdown();
    inputEl?.select();
  }

  function onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    filterQuery = input.value;
    if (!isOpen) {
      isOpen = true;
      isEditing = true;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      inputEl?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      if (filteredFlatOptions.length > 0) {
        activeIndex = (activeIndex + 1) % filteredFlatOptions.length;
        scrollActiveIntoView();
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      if (filteredFlatOptions.length > 0) {
        activeIndex = (activeIndex - 1 + filteredFlatOptions.length) % filteredFlatOptions.length;
        scrollActiveIntoView();
      }
      return;
    }
    if (e.key === "Enter") {
      if (isOpen && filteredFlatOptions.length > 0) {
        e.preventDefault();
        const picked = filteredFlatOptions[activeIndex] ?? filteredFlatOptions[0];
        if (picked) choose(picked.value);
        inputEl?.blur();
      }
      return;
    }
    if (e.key === "Tab") {
      closeDropdown();
    }
  }

  function scrollActiveIntoView() {
    if (!dropdownEl) return;
    const activeEl = dropdownEl.querySelector<HTMLElement>(".fsel-opt.active");
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  function onDocClick(e: MouseEvent) {
    if (isOpen && wrapEl) {
      const target = e.target as Node;
      if (!wrapEl.contains(target)) {
        closeDropdown();
      }
    }
  }

  function toggle() {
    if (isOpen) {
      closeDropdown();
      inputEl?.blur();
    } else {
      inputEl?.focus();
    }
  }

  function clearInput(e: MouseEvent) {
    e.stopPropagation();
    filterQuery = "";
    inputEl?.focus();
  }
</script>

<svelte:document onclick={onDocClick} />

<div class="fsel-wrap" bind:this={wrapEl}>
  <!-- Native select kept in DOM for automated tests and standard form compatibility -->
  <select
    {id}
    class="fsel-native"
    aria-label={ariaLabel || id}
    tabindex="-1"
    bind:this={selectEl}
    {value}
    onchange={(e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      updatingFromNative = true;
      try {
        choose(v);
      } finally {
        updatingFromNative = false;
      }
    }}
  >
    {#each normalizedGroups as g}
      {#if g.group}
        <optgroup label={g.group}>
          {#each g.options as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </optgroup>
      {:else}
        {#each g.options as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      {/if}
    {/each}
  </select>

  <!-- Filterable input text box control -->
  <div class="fsel-control {className}" class:open={isOpen}>
    <input
      bind:this={inputEl}
      type="text"
      role="combobox"
      class="fsel-input"
      aria-label={ariaLabel || id}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-controls={listboxId}
      placeholder={placeholder || "Type to filter…"}
      value={displayValue}
      onfocus={onFocus}
      oninput={onInput}
      onkeydown={onKeyDown}
      autocomplete="off"
      spellcheck="false"
    />
    {#if isEditing && filterQuery}
      <button
        type="button"
        class="fsel-clear"
        aria-label="Clear filter"
        tabindex="-1"
        onclick={clearInput}
      >×</button>
    {/if}
    <button
      type="button"
      class="fsel-toggle"
      aria-label="Toggle options list"
      tabindex="-1"
      onclick={toggle}
    >
      <span class="fsel-arrow" aria-hidden="true">▾</span>
    </button>
  </div>

  {#if isOpen}
    <div
      bind:this={dropdownEl}
      id={listboxId}
      class="fsel-dropdown"
      role="listbox"
      aria-label={ariaLabel || "Options"}
      tabindex="-1"
    >
      <div class="fsel-scroll">
        {#each filteredGroups as g}
          {#if g.group}
            <div class="fsel-group-header">{g.group}</div>
          {/if}
          {#each g.options as opt}
            {@const isSelected = opt.value === value}
            {@const isAct = filteredFlatOptions[activeIndex]?.value === opt.value}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="fsel-opt"
              class:selected={isSelected}
              class:active={isAct}
              role="option"
              aria-selected={isSelected}
              tabindex="-1"
              onmousemove={() => {
                const idx = filteredFlatOptions.findIndex((o) => o.value === opt.value);
                if (idx >= 0 && activeIndex !== idx) activeIndex = idx;
              }}
              onmousedown={(e) => {
                e.preventDefault();
                choose(opt.value);
              }}
            >
              <span class="fsel-opt-check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
              <span class="fsel-opt-label">{opt.label}</span>
              {#if opt.sub}
                <span class="fsel-opt-sub">{opt.sub}</span>
              {/if}
            </div>
          {/each}
        {:else}
          <div class="fsel-empty">No options match "{filterQuery}"</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .fsel-wrap {
    position: relative;
    display: inline-block;
  }

  .fsel-native {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
    opacity: 0.001;
    pointer-events: none;
  }

  .fsel-control {
    display: inline-flex;
    align-items: center;
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 6px;
    min-width: 120px;
    max-width: 280px;
    box-sizing: border-box;
    transition: border-color 0.15s, box-shadow 0.15s;
    position: relative;
  }

  .fsel-control:focus-within,
  .fsel-control.open {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .fsel-input {
    border: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 0.82rem;
    padding: 4px 6px 4px 8px;
    outline: none;
    width: 100%;
    min-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
  }

  .fsel-clear {
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .fsel-clear:hover {
    color: var(--ink);
  }

  .fsel-toggle {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 4px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .fsel-toggle:hover {
    color: var(--ink);
  }

  .fsel-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 100%;
    width: max-content;
    max-width: 340px;
    max-height: 280px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    z-index: 99;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .fsel-scroll {
    overflow-y: auto;
    max-height: 280px;
    padding: 4px;
  }

  .fsel-group-header {
    font-family: var(--mono);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding: 6px 8px 2px;
  }

  .fsel-opt {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 5px;
    font-size: 0.8rem;
    cursor: pointer;
    user-select: none;
  }

  .fsel-opt.active {
    background: var(--accent-soft);
  }

  .fsel-opt.selected {
    font-weight: 600;
  }

  .fsel-opt-check {
    width: 12px;
    font-size: 0.75rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .fsel-opt-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .fsel-opt-sub {
    font-size: 0.7rem;
    color: var(--muted);
    flex-shrink: 0;
  }

  .fsel-empty {
    padding: 12px;
    font-size: 0.78rem;
    color: var(--muted);
    text-align: center;
  }
</style>
