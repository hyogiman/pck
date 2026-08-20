# Thought Garden AI v2 implementation guardrails

## Product goal

Thought Garden AI should help the user expand perspective, discover meaningful links across accumulated thoughts, and receive practical help while writing. AI should not speak merely because an API call is available.

Core rule:

> If the AI cannot add more value than silence, it stays silent.

## Model routing

- Embedding: `text-embedding-3-small`
- High-volume indexing/discovery: `gpt-5.6-luna`
- User-visible questions/guidance: `gpt-5.6-terra`
- User-visible reasoning baseline: `medium`

Model routing lives in `functions/ai-v2-core.js` and should be evaluated against representative Thought Garden examples before production rollout.

## Question gate

All user-visible AI questions must pass the same gate:

1. grounded in actual stored text
2. not already answered in the source
3. specific to this record/context
4. understandable on first read
5. natural conversational Korean
6. likely to produce a new thought
7. non-leading / no invented psychology
8. relevant at this moment

Hard minimums: grounding, natural Korean and insight potential must each score at least 4/5. Overall quality must be consistently high. Model self-evaluation alone is not sufficient: the server also checks exact evidence against source text and rejects known vague pseudo-insight phrasing.

## Blooming v2

- Do not invite first and invent a question later.
- First determine whether a genuinely useful unexplored angle exists.
- Create several candidate questions internally.
- Show the Blooming interruption only after a question passes the gate.
- If there is no strong question, do nothing.

## Between Thoughts v2

- The purpose is not merely to report a similarity.
- A useful pair should create a third thought that would not arise from either source alone.
- Final validation must use both original texts.
- The question must fail if it could have been generated from A alone or B alone.
- The UI may show a short `함께 놓아본 이유`, but it must be observational and grounded rather than a psychological conclusion.

## Studio Gardener v2

The Gardener remains primarily a thinking partner, not merely an editor.

Priority:
1. expand by connecting relevant past thoughts/materials
2. deepen the current idea with a useful question
3. challenge the current direction with a grounded alternative/counterexample
4. offer a short editorial suggestion when thinking is already sufficiently developed

It should use current Studio context plus relevant fragments, Thread context and source materials so accumulated Thought Garden data becomes more useful over time.

## Thought Index evolution

Do not reduce the current multi-angle index by deleting analytical layers merely to save tokens. Keep the existing layers used by the app and Diary MCP, but make entries concise, evidence-based and non-duplicative. New fields such as growth opportunities must be additive.

## Diary MCP compatibility — hard constraint

Diary MCP reads Thought Garden Firestore directly. AI v2 must therefore preserve:

- collections: `users/{uid}/sources`, `fragments`, `threads`, `projects`
- fragment core fields such as `id`, `date`, `thought`, `externalText`, `locator`, `context`, `sourceId`, `threadIds`, `continuedFrom`, timestamps and attachment metadata
- existing `aiIndex` layers and their current field names
- existing context metadata used for Blooming / Between Thoughts history

AI v2 may add fields and bump index versions, but must not remove or rename existing fields until Diary MCP is intentionally upgraded and regression-tested.

## Rollout order

1. shared model routing + deterministic Question Gate
2. Blooming v2
3. Between Thoughts v2
4. Gardener v2 with cross-garden retrieval
5. Thought Index optimization without schema breakage
6. remove legacy AI paths only after production validation

Do not deploy all phases at once. Each phase must be tested on representative good/bad questions before moving the production app to the new path.
