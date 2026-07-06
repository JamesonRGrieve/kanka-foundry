/**
 * Guarded reflection helpers for reading from Foundry framework objects.
 *
 * Foundry's runtime documents (Item, Actor, JournalEntry, the `game` global,
 * folders, …) are not statically typed at our boundary. Rather than sprinkle
 * `const x: unknown = Reflect.get(obj, key)` plus a `typeof` guard at every
 * call site, the boundary `unknown` is confined to this single module: callers
 * get a value already narrowed to the shape they asked for, or `undefined`.
 * Every `unknown` below is a true framework-boundary read fed straight into a
 * runtime guard on the next line — the one sanctioned use of the keyword.
 */

/** A plain object with string keys and opaque values — the shape of untyped Foundry/JSON data. */
// eslint-disable-next-line no-restricted-syntax -- boundary: the canonical "arbitrary object" type for framework/JSON data
export type PlainObject = Record<string, unknown>;

/** Read a property as an opaque value. The only raw `unknown` boundary read. */
// eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry document property, guarded by the caller
export function readProp(target: unknown, key: string): unknown {
    // Allow function targets too: Foundry document classes (Item, Folder, …)
    // are constructors, and their factory methods (Item.create, Folder.create)
    // are static members read off the class itself.
    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) return undefined;
    return Reflect.get(target, key);
}

/** True when the value is a non-null, non-array object. */
// eslint-disable-next-line no-restricted-syntax -- boundary: type-guard parameter fed straight into the guard below
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Narrow an opaque value to a plain record, or undefined. */
// eslint-disable-next-line no-restricted-syntax -- boundary: opaque value fed straight into the isRecord guard below
export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}

/** Read a property and return it only if it is a string. */
// eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry document property, guarded below
export function readString(target: unknown, key: string): string | undefined {
    const value = readProp(target, key);
    return typeof value === 'string' ? value : undefined;
}

/**
 * True when the value is a non-empty string. The "did the source actually
 * supply this field" guard: an absent or empty value must never overwrite
 * existing data — e.g. a Kanka entity with no custom image (`img` undefined
 * or `''`) must not wipe a Foundry actor's portrait on sync.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: type-guard parameter fed straight into the guard below
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

/** Read a property and return it only if it is a plain record/object. */
// eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry document property, guarded by isRecord
export function readRecord(target: unknown, key: string): Record<string, unknown> | undefined {
    const value = readProp(target, key);
    return isRecord(value) ? value : undefined;
}

/** Assertion form of a structural cast — covered by type-coverage (no `as`). */
// eslint-disable-next-line no-restricted-syntax -- boundary: assertion-function parameter, the one sanctioned use of `unknown`
function assertSignature<F>(_value: unknown): asserts _value is F {}

/**
 * Read a property and return it typed as the caller-supplied function
 * signature, but only when it is actually callable. The signature is asserted,
 * not checked — use only at a framework boundary where the shape is known.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry callable, checked with typeof below
export function readFunction<F extends (...args: never[]) => unknown>(target: unknown, key: string): F | undefined {
    const value = readProp(target, key);
    if (typeof value !== 'function') return undefined;
    assertSignature<F>(value);
    return value;
}
