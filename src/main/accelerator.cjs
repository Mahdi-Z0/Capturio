/**
 * Global shortcut validation — the single source of truth.
 *
 * Plain CommonJS with no imports at all, for the same reason as recordingPath.cjs:
 * the settings handlers in src/main/index.ts and scripts/verify-shortcuts.cjs must
 * run the SAME rules, or the verifier stays green while the shipped check drifts.
 *
 * A global shortcut takes its combination away from every other program on the
 * machine, so the rules here are about not breaking typing: a key that types or
 * moves the caret needs Ctrl, Alt or Win before it can be taken.
 */

/**
 * Written in this order, so one combination has exactly one spelling. Win comes
 * first because that is how Windows itself writes it: Win+Shift+S.
 */
const MODIFIERS = ['Super', 'Control', 'Alt', 'Shift'];

/** Three keys at most: two modifiers and a key. Four is a chord, not a shortcut. */
const MAX_MODIFIERS = 2;

const MODIFIER_ALIASES = {
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
};

const FUNCTION_KEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);

/** Keys that may stand alone: nothing types them, and they exist to be bound. */
const STANDALONE_KEYS = [...FUNCTION_KEYS, 'PrintScreen'];

/**
 * Everything else that may be bound, given a modifier.
 *
 * Punctuation is deliberately absent. Electron resolves it through the current
 * keyboard layout, so the key shown in Settings and the key that fires can differ
 * -- a shortcut that says one thing and does another is worse than none.
 */
const MODIFIED_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  'Space',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
];

const KEYS = [...STANDALONE_KEYS, ...MODIFIED_KEYS];

/** Case-insensitive lookup that returns the canonical spelling. */
const KEY_LOOKUP = new Map(KEYS.map((k) => [k.toLowerCase(), k]));

/**
 * Validate an accelerator and return its canonical spelling.
 *
 * @param {unknown} input e.g. `Control+Shift+R`, `ctrl+alt+shift+b`, `PrintScreen`
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
function normalizeAccelerator(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'not a string' };
  if (input.length === 0 || input.length > 64) return { ok: false, reason: 'bad length' };

  const parts = input.split('+').map((p) => p.trim());
  if (parts.some((p) => p === '')) return { ok: false, reason: 'empty part' };

  const mods = new Set();
  let key = null;
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (mod) {
      if (mods.has(mod)) return { ok: false, reason: 'repeated modifier' };
      mods.add(mod);
      continue;
    }
    const k = KEY_LOOKUP.get(part.toLowerCase());
    if (!k) return { ok: false, reason: 'unknown key' };
    if (key !== null) return { ok: false, reason: 'more than one key' };
    key = k;
  }

  if (key === null) return { ok: false, reason: 'no key' };
  if (mods.size > MAX_MODIFIERS) return { ok: false, reason: 'more than three keys' };

  // Shift does not count: Shift+A is a capital A, and taking it would break typing.
  const guarded = mods.has('Control') || mods.has('Alt') || mods.has('Super');
  if (!guarded && !STANDALONE_KEYS.includes(key)) {
    return { ok: false, reason: 'needs Ctrl, Alt or Win' };
  }

  const ordered = MODIFIERS.filter((m) => mods.has(m));
  return { ok: true, value: [...ordered, key].join('+') };
}

module.exports = { normalizeAccelerator, KEYS, MODIFIERS, MAX_MODIFIERS, STANDALONE_KEYS };
