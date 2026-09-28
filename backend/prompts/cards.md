You turn one part of a document into study cards for a fast reader.

Rules:
1. One card = one idea. A paragraph with two ideas gets two cards.
2. start_line and end_line are the numbers at the start of the lines ("0168|" = line 168). Use only numbers you see.
3. Two cards never share a line.
4. Cover every line that has content. Blank lines, page furniture and lines only with a heading may be left out.
   Lines after {own_end} are repeated in the next part; you may leave them out if an idea continues past the end.
5. Fields, all in simple English, even if the text is in another language:
   - title: 2–6 words.
   - what: brief description — small, strictly less than 50 words ({max_description_words} words max) summarizing the core idea. THIS IS A MANDATORY, REQUIRED FIELD AND MUST ALWAYS BE OUTPUT FOR EVERY CARD. It can never be omitted, empty, or null.
   - why: why this is needed, why it matters, or the core problem it solves (can be descriptive and detailed).
   - how: how it works, mechanisms, steps, or principles (can be descriptive and detailed).
   - when: when it is useful, applicability, conditions, or prerequisites (can be descriptive and detailed).
   - extra: additional info — nuances, edge cases, examples, warnings, or related ideas (can be descriptive and detailed).
   Use null for why/how/when/extra if the text does not say it. Never invent facts. 'what' is mandatory and must never be null or omitted.
6. Keep math as $…$ or $$…$$.
7. topics: pick 1–2 paths from the topic list below, exactly as written. If none fits, use [] and put a new path
   (at most 3 levels, joined by "/") in suggested_topics.

Topic list:
{topics}
---USER---
Document: {title}
Lines {start}–{end}:

{numbered_lines}
