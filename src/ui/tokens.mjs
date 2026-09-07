/**
 * Design tokens — single source of truth for the UI.
 *
 * Authority: DESIGN.md (marketing canvas, UNCHANGED) + docs/design-extension.md (product surfaces).
 * Requirement REQ-091: additive only. A test asserts no DESIGN.md value is overridden here.
 */

/** Verbatim from DESIGN.md front matter. DO NOT EDIT — these are the design authority. */
export const BASE = Object.freeze({
  primary: '#5e6ad2',
  'on-primary': '#ffffff',
  'primary-hover': '#828fff',
  'primary-focus': '#5e69d1',
  ink: '#f7f8f8',
  'ink-muted': '#d0d6e0',
  'ink-subtle': '#8a8f98',
  'ink-tertiary': '#62666d',
  canvas: '#010102',
  'surface-1': '#0f1011',
  'surface-2': '#141516',
  'surface-3': '#18191a',
  'surface-4': '#191a1b',
  hairline: '#23252a',
  'hairline-strong': '#34343a',
  'hairline-tertiary': '#3e3e44',
  'semantic-success': '#27a644',
});

/** Additive product-surface tokens (docs/design-extension.md §3). */
export const STATUS = Object.freeze({
  critical: '#f2555a',
  'critical-dim': '#2a1416',
  warning: '#e0a23c',
  'warning-dim': '#2a2214',
  healthy: BASE['semantic-success'], // reused, not a new colour
  'healthy-dim': '#12261a',
  info: '#5e88d2',
  'info-dim': '#141c2a',
  neutral: BASE['ink-subtle'],
});

/** Provenance tokens (§4) — condition PM-1 / REQ-092. */
export const PROVENANCE = Object.freeze({
  'computed-ink': BASE.ink,
  'computed-rule': BASE.hairline,
  'generated-ink': BASE['ink-muted'],
  'generated-edge': BASE['hairline-tertiary'],
});

export const SPACING = Object.freeze({
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, section: 96,
});

export const RADIUS = Object.freeze({
  xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 24, pill: 9999,
});

export const FONTS = Object.freeze({
  display: "'Inter', -apple-system, 'SF Pro Display', sans-serif",
  text: "'Inter', -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
});

/** Maps a domain state to a status token + MANDATORY text label (never colour alone, §2.4). */
export function statusOf(kind, value) {
  const map = {
    cover: {
      CRITICAL: ['critical', 'Critical'],
      WARNING: ['warning', 'Warning'],
      WATCH: ['info', 'Watch'],
      HEALTHY: ['healthy', 'Healthy'],
    },
    feasibility: {
      FEASIBLE: ['healthy', 'Feasible'],
      INFEASIBLE: ['warning', 'Infeasible'],
      BLOCKED: ['critical', 'Blocked'],
    },
    dataSource: {
      LIVE_SAP: ['healthy', 'Live SAP'],
      SAP_SANDBOX: ['info', 'SAP Sandbox'],
      SIMULATED: ['warning', 'Simulated'],
    },
    severity: {
      LOW: ['info', 'Low'], MEDIUM: ['warning', 'Medium'],
      HIGH: ['warning', 'High'], CRITICAL: ['critical', 'Critical'],
    },
  };
  const [token, label] = map[kind]?.[value] ?? ['neutral', String(value ?? 'Unknown')];
  return { token, colour: STATUS[token], label };
}

/** WCAG relative luminance + contrast, used by the accessibility test (REQ-097). */
export function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
