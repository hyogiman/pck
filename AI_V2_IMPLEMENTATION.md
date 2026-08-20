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

## Blooming v2 — past thoughts bloom again

Blooming is **not** a save-time follow-up-question feature. Its identity is that Thought Garden remembers a thought the user left earlier and, at a later natural moment, brings it back with one worthwhile question.

### Preparation

- Saving a Fragment must never wait for Blooming.
- Existing Thought Index work continues independently.
- While the app is being used, a low-cost discovery pass can scan older eligible Fragments and choose one that still has real room to grow.
- Sources younger than roughly 12 hours are excluded so Blooming does not collapse back into an immediate post-save interview.
- A candidate is only useful when revisiting it can plausibly create a new thought now; emotional intensity or length alone is not a reason to choose it.
- `gpt-5.6-luna` scouts candidates, then `gpt-5.6-terra` creates up to three final question candidates.
- The shared Question Gate rejects weak candidates. If none pass, Blooming stays silent.

### Ready / claim / shown lifecycle

A good question is stored separately from the user's Fragment in `users/{uid}/aiArtifacts/blooming-v2`.

1. `ready` — a high-quality question has been prepared.
2. `claimed` — one active app session reserves it briefly before display.
3. `shown` — the popup actually appears; only then is it counted as an appearance.

Claims expire after a short period so closing the app at the wrong moment does not permanently lose the question. This also reduces duplicate popups across multiple devices.

### When Blooming may appear

A prepared question may surface while the app is open, but **never simply because a timer fired**. The UI must first be in a safe non-writing moment.

Do not show when:

- another dialog is open
- a text input / textarea / contenteditable currently has focus
- the user has just typed
- the Capture screen contains an unsaved-looking text draft
- Studio is open; Studio is treated as a sustained writing workspace
- the app is hidden/backgrounded

It may show after a short idle moment while the user is reading or browsing, including the landing/Capture screen only when there is no active draft or text-editing state.

The spontaneous popup must not autofocus its textarea, because forcing the mobile keyboard open would make the interruption unnecessarily disruptive.

### Rarity

- Maximum three shown Blooming interviews in any rolling seven-day period.
- After a shown interview, the next preparation window is randomized roughly 36–60 hours later.
- The same source Fragment is blocked from another Blooming appearance for about 30 days.
- A prepared question can wait for a later session; it does not need to appear in the session where it was generated.

### User experience

The popup should feel like:

> "전에 남긴 이 생각이 다시 눈에 들어왔어요."

It shows the older thought and the already-prepared question directly. There is no "invite first, then wait while AI invents something" step.

If the user answers, the existing Blooming answer path remains useful: the answer becomes a new Fragment connected to the source via `continuedFrom`. If the user passes, the shown question is not immediately repeated.

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

`aiArtifacts` is an additive internal collection for prepared AI output. Diary MCP does not need it to continue reading the user's original Thought Garden records.

## Rollout order

1. shared model routing + deterministic Question Gate
2. Blooming v2
3. Between Thoughts v2
4. Gardener v2 with cross-garden retrieval
5. Thought Index optimization without schema breakage
6. remove legacy AI paths only after production validation

Do not deploy all phases at once. Each phase must be tested on representative good/bad questions before moving the production app to the new path.
