You turn one part of a document into study cards for a fast reader.

Rules:
1. One card = one idea. A paragraph with two ideas gets two cards.
2. start_line and end_line are the numbers at the start of the lines ("0168|" = line 168). Use only numbers you see.
3. Two cards never share a line.
4. Cover every line that has content. Blank lines, page furniture and lines only with a heading may be left out.
   Lines after {own_end} are repeated in the next part; you may leave them out if an idea continues past the end.
5. Fields. Write everything in clean, simple English that a non-native speaker can understand easily, even if the text is
   in another language: short sentences, common words, no idioms or slang. Keep technical terms from the text, and explain
   them in simple words the first time they appear.
   - title: 2–6 words.
   - what: a SHORT, SELF-CONTAINED SUMMARY, strictly under {max_description_words} words. A reader who sees only this line
     must still get the full meaning of the card: the claim itself, with the key specifics (names, numbers, conditions, the
     rule and its main consequence). Write a complete statement, not a label, and do not just name the topic or say
     "this card explains…". MANDATORY for every card; never empty or null.
   - why, how, when, extra: the DETAIL fields. A reader who reads the card's detail should understand the idea completely
     and not need the source. Write them in full, using Markdown paragraphs or lists. Use everything the text says about
     the idea.
     - why: the problem it solves, motivation, background, consequences of ignoring it.
     - how: the complete mechanism, every step in order, formulas, parameters. Copy relevant code, commands and config
       exactly, in fenced code blocks. Never replace code with a description.
     - when: when to use it, conditions, prerequisites, thresholds, trade-offs, and when NOT to use it.
     - extra: worked examples with concrete numbers, edge cases, pitfalls, warnings, measurements, related ideas.
     Use only what the text gives you: never invent facts or add outside knowledge.
     Use null for why/how/when/extra ONLY if the text truly says nothing about it.

   Example of a good card (different subject, shown for shape only):
   {{
     "title": "Retry With Backoff And Jitter",
     "what": "Retry failed requests with exponentially growing waits plus random jitter, so many clients do not retry at the same moment and overload a server that is already struggling.",
     "why": "When a server is slow or down, every client that fails will try again. If they all retry after the same fixed wait, they hit the server together, in waves, and the server can never recover. This is called a retry storm. Longer waits give the server time to recover. Random waits spread the clients out, so the load arrives as a smooth stream and not as one big spike.",
     "how": "Follow these steps:\n\n1. Send the request. If it works, stop.\n2. If it fails with a temporary error (timeout, HTTP 429, HTTP 503), compute the maximum wait: `min(cap, base * 2 ** attempt)`.\n3. Pick a random wait between 0 and that maximum. This random part is the jitter.\n4. Sleep for that time, then try again.\n5. After `max_tries` attempts, stop and raise the error.\n\n```python\nimport random, time\n\ndef call_with_retry(request, max_tries=5, base=0.5, cap=30.0):\n    for attempt in range(max_tries):\n        try:\n            return request()\n        except TransientError:\n            if attempt == max_tries - 1:\n                raise\n            wait = random.uniform(0, min(cap, base * 2 ** attempt))\n            time.sleep(wait)\n```\n\nThe wait limit doubles each time, so it grows fast, and `cap` stops it from growing without end.",
     "when": "Use it for temporary failures: network timeouts, rate limits (HTTP 429) and overloaded servers (HTTP 503). Only retry a request that is safe to repeat (idempotent), or one that carries an idempotency key. Do not retry permanent errors such as HTTP 400 or 404, because the result will never change. Do not use it when the user is waiting and needs a fast answer; fail early instead.",
     "extra": "Example with base = 0.5 s and cap = 30 s: the maximum wait is 0.5 s, 1 s, 2 s, 4 s and 8 s for attempts 1 to 5. With no jitter, 1,000 clients that fail together all return at the same second. With jitter, they are spread over that whole range, about 125 clients per second in the last step instead of 1,000 at once. Common mistakes: retrying without any limit, retrying at every layer of the system (three layers with 3 tries each make 27 calls), and forgetting to honor a `Retry-After` header when the server sends one.",
     "start_line": 10, "end_line": 24, "topics": [], "suggested_topics": []
   }}
6. Keep math as $…$ or $$…$$.
7. topics: pick 1–2 paths from the topic list below, exactly as written. If none fits, use [] and put a new path
   (at most 3 levels, joined by "/") in suggested_topics.

Topic list:
{topics}
---USER---
Document: {title}
Lines {start}–{end}:

{numbered_lines}
