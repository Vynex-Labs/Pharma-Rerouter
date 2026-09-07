# Product-Surface Extension to `DESIGN.md`

**Status:** ACCEPTED · **Date:** 2026-09-07 · **Owner:** UI/UX Designer · **Review:** Visual QA, Product Manager
**Resolves:** P0 finding **R0-2** (HIGH) and **R0-3** (MEDIUM)
**Requirement:** REQ-091 — *any product-surface token added MUST be an additive, documented extension.*

---

## 1. Why an extension is needed, and why it is not a violation

`DESIGN.md` is the UI authority (Master Prompt §29.6) and it is explicit:

> *Don't introduce a second chromatic accent (orange, pink, green for marketing).*

But `DESIGN.md` documents Linear's **marketing canvas** — `pricing-card`, `testimonial-card`,
`customer-logo-tile`, "product UI screenshots are the protagonist". We are building an
**operational control tower** that must distinguish CRITICAL from WARNING from HEALTHY at a glance.
A colourless severity system in a medical supply-chain tool is not minimalism, it is a defect.

The authority to extend comes from `DESIGN.md` itself, in **Known Gaps**:

> *"Linear's actual product UI uses a richer color-tag palette (red, orange, yellow, green, blue,
> purple) for issue priorities and project labels — those colors live in the in-product surfaces
> shown in mockups."*

So the marketing prohibition and the product palette are **not in conflict**: they govern different
surfaces. This extension is scoped strictly to in-product surfaces.

## 2. Binding rules for this extension

1. **Additive only.** No token in `DESIGN.md` is altered, overridden or removed.
2. **Scoped to product surfaces.** Status colour may only encode *state*. It may never be used as
   a section background, a card fill, or decoration.
3. **Lavender stays scarce.** `#5e6ad2` remains reserved for brand mark, primary CTA, focus ring and
   link emphasis. It is **not** repurposed as an "info" status.
4. **Never colour alone.** Every status carries a text label and/or icon (WCAG 1.4.1, REQ-097).
5. **The surface ladder still carries hierarchy.** Status tints are borders/dots/text, not fills.

## 3. Added tokens — status semantics

Hues chosen to sit on `canvas #010102` at AA contrast, tuned toward the muted register of the
existing palette rather than saturated alert colours.

```yaml
status:
  critical:      "#f2555a"   # cover <= 3 days, BLOCKED actions, chain verification failure
  critical-dim:  "#2a1416"   # tint for badge backgrounds on dark
  warning:       "#e0a23c"   # cover <= 7 days, INFEASIBLE options, degraded data source
  warning-dim:   "#2a2214"
  healthy:       "#27a644"   # ALREADY IN DESIGN.md as semantic-success — reused, not added
  healthy-dim:   "#12261a"
  info:          "#5e88d2"   # neutral operational state; deliberately distinct from brand lavender
  info-dim:      "#141c2a"
  neutral:       "#8a8f98"   # ink-subtle, reused
```

**Note:** `healthy` is not a new colour — it is `semantic-success` already defined in `DESIGN.md`.
Only three genuinely new hues are introduced.

## 4. Added tokens — provenance semantics (REQ-092, REQ-093)

Condition **PM-1** requires that computed values be visually distinguishable from model-generated
text. This is a governance requirement expressed visually: an operator must never mistake prose for
a number, or simulated data for live data.

```yaml
provenance:
  computed-ink:    "#f7f8f8"   # engine output — normal ink, full confidence
  computed-rule:   "#23252a"   # hairline under computed figures
  generated-ink:   "#d0d6e0"   # model prose — ink-muted, visually recessive
  generated-edge:  "#3e3e44"   # 2px left border marking a generated block
  generated-label: "AI-GENERATED"
  fallback-label:  "TEMPLATE"  # deterministic fallback, not model output
```

**Rendering rule:** every model-generated block carries a 2px left border in `generated-edge`,
`ink-muted` text, and a `caption`-sized label. Computed figures use `ink` and the `mono` type token.
The result is that a screenshot alone tells you which parts a model wrote.

## 5. Added components

| Component | Base | Purpose |
|---|---|---|
| `status-pill` | `status-badge` from `DESIGN.md` | severity with label + dot |
| `metric-tile` | `feature-card` | one computed figure, `mono`, with delta and provenance badge |
| `data-source-badge` | `status-badge` | `LIVE_SAP` / `SAP_SANDBOX` / `SIMULATED` — mandatory (REQ-093) |
| `classification-badge` | `status-badge` | `SYNTHETIC` / `ASSUMED` — mandatory (REQ-100) |
| `generated-block` | new | model prose with provenance edge and label |
| `scenario-row` | `changelog-row` | one option: score, figures, feasibility, reason |
| `approval-card` | `pricing-card` | requested action, evidence, policy, approver, actions |
| `agent-trace-row` | `changelog-row` | seam, agent, tools called, validation result, fallback |
| `timeline-step` | new | state-machine progress |

All reuse `DESIGN.md` radii (`md 8px` buttons, `lg 12px` cards), spacing scale and type ramp.

## 6. Typography substitution (resolves R0-3)

`DESIGN.md` Known Gaps: *"The custom display, text, and mono families are proprietary; an
open-source substitute is acceptable."*

| Role | Substitute | Rationale |
|---|---|---|
| Linear Display | **Inter** (600) | Closest geometric grotesque; supports the negative tracking spec |
| Linear Text | **Inter** (400) | Single family reduces load weight |
| Linear Mono | **JetBrains Mono** (400) | Used for IDs, hashes and computed figures |

Negative letter-spacing values from `DESIGN.md` are applied unchanged.

## 7. What this extension does NOT do

- Does not introduce a light mode.
- Does not use lavender as a fill or as a status colour.
- Does not add gradients, spotlight cards or pill-rounded CTAs.
- Does not change any existing token value.
- Does not apply status colour to marketing-style surfaces.

## 8. Verification
Enforced by `tests/design.test.mjs`: token values match this document, no `DESIGN.md` value is
overridden, contrast ratios meet AA, and every status has a non-colour label.
