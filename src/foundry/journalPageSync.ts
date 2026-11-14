/**
 * Re-importing a Kanka entity compares before it overwrites (wh40k-rpg#739).
 *
 * A re-import used to delete every page of the journal and recreate them,
 * silently replacing whatever the world held, a page a GM added included. Now
 * the pages the import would write are compared with the journal's own:
 *
 * - a page the journal lacks is created (nothing is overwritten);
 * - a page that matches is left as it is (its id, and every link to it, stays);
 * - a page that differs, or that Kanka no longer has, is recorded as a conflict
 *   for the Conflict Resolver. The GM chooses: Kanka's version replaces the page
 *   in place, or Foundry's is kept and that Kanka version is not asked about
 *   again;
 * - a page the import did not make (a GM's own) is never touched.
 *
 * The planning is pure (`planPageSync`); the Foundry writes are the thin
 * functions below it.
 */
import { asRecord, assertType, isUnknownArray, type PlainObject, readProp } from '../util/reflection';
import { listConflicts } from './conflicts/conflictStore';
import { conflictId, type ConflictChoice, type StoredConflict } from './conflicts/types';
import { replacing } from './snapshotFields';

/** The flag scope this module writes on pages. */
const SCOPE = 'kanka-foundry';

/** A page as the planner reads it: an existing one, or one the import would write. */
export interface PageData {
    readonly _id?: string | null | undefined;
    readonly name: string;
    readonly type: string;
    readonly text?: { readonly content?: string | null | undefined } | null | undefined;
    readonly src?: string | null | undefined;
    readonly system?: object | null | undefined;
    readonly flags?: Record<string, PlainObject | undefined> | null | undefined;
}

/** One page difference the GM decides. `incoming` is null when Kanka no longer has the page. */
export interface PageConflict {
    readonly key: string;
    readonly name: string;
    readonly existing: PageData;
    readonly incoming: PageData | null;
}

/** What a re-import does to a journal's pages. */
export interface PagePlan {
    readonly create: PageData[];
    readonly conflicts: PageConflict[];
}

/** A page's identity within its journal: its name and type. */
export function pageKey(page: Pick<PageData, 'name' | 'type'>): string {
    return `${page.type}|${page.name}`;
}

/** A page's system data, or an empty object for a page with none (an image page). */
function systemOf(page: PageData): PlainObject {
    return asRecord(page.system) ?? {};
}

/** JSON with sorted object keys, so equal content compares equal. */
// eslint-disable-next-line no-restricted-syntax -- boundary: serialises any page value; narrowed by the guards below
function stableJson(value: unknown): string {
    if (isUnknownArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const record = asRecord(value);
    if (record !== undefined) {
        const entries = Object.entries(record)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/**
 * The content of a page that a reader sees, as one comparable string. The page
 * model's `version` (which moves with the entity's updated_at even when this page
 * is unchanged) is left out.
 */
export function pageSignature(page: PageData): string {
    const system: PlainObject = { ...systemOf(page) };
    delete system['version'];
    return stableJson({ type: page.type, name: page.name, text: page.text?.content ?? null, src: page.src ?? null, system });
}

/** Whether a page was made by the import (flagged since #739; recognised by type or name before that). */
function isImportedPage(page: PageData, incomingKeys: ReadonlySet<string>): boolean {
    if (page.flags?.[SCOPE]?.['page'] === true) return true;
    if (page.type.startsWith(`${SCOPE}.`) || page.name.startsWith('KANKA.')) return true;
    return (page.type === 'image' || page.type === 'video') && incomingKeys.has(pageKey(page));
}

/** The Kanka version (signature hash, or the removal marker) the GM declined to take on this page, if any. */
function declinedMark(page: PageData): string | undefined {
    const declined = page.flags?.[SCOPE]?.['declined'];
    return typeof declined === 'string' ? declined : undefined;
}

/** The marker a declined removal records, as no incoming page has a signature. */
const REMOVED = 'removed';

/** A short, stable hash of a page signature (FNV-1a, 32-bit), so a conflict stores a few bytes, not the page. */
export function signatureHash(signature: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < signature.length; i += 1) {
        hash ^= signature.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** The Kanka version a conflict compares against: the hash of its signature, or the removal marker. */
function incomingMark(page: PageData | null): string {
    return page === null ? REMOVED : signatureHash(pageSignature(page));
}

/** Compare the pages a re-import would write with the journal's own. Pure. */
export function planPageSync(existing: readonly PageData[], incoming: readonly PageData[]): PagePlan {
    const incomingKeys = new Set(incoming.map(pageKey));
    const byKey = new Map(existing.map((page) => [pageKey(page), page] as const));
    const create: PageData[] = [];
    const conflicts: PageConflict[] = [];
    for (const page of incoming) {
        const key = pageKey(page);
        const current = byKey.get(key);
        if (current === undefined) {
            create.push(page);
            continue;
        }
        if (pageSignature(current) === pageSignature(page) || declinedMark(current) === incomingMark(page)) continue;
        conflicts.push({ key, name: page.name, existing: current, incoming: page });
    }
    for (const page of existing) {
        if (incomingKeys.has(pageKey(page)) || !isImportedPage(page, incomingKeys)) continue;
        if (declinedMark(page) === REMOVED) continue;
        conflicts.push({ key: pageKey(page), name: page.name, existing: page, incoming: null });
    }
    return { create, conflicts };
}

/** Longest side a stored conflict keeps for display: the registry is a world setting, sent to every client. */
const DISPLAY_LIMIT = 240;

/** The text a resolver row shows for one side of a page conflict, clipped. */
function pageDisplay(page: PageData | null): string {
    if (page === null) return '(removed in Kanka)';
    const text = page.text?.content;
    let shown: string;
    if (typeof text === 'string' && text !== '')
        shown = text
            .replace(/<[^>]+>/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim();
    else if (typeof page.src === 'string' && page.src !== '') shown = page.src;
    else shown = stableJson(systemOf(page)['snapshot'] ?? systemOf(page));
    return shown.length > DISPLAY_LIMIT ? `${shown.slice(0, DISPLAY_LIMIT)}…` : shown;
}

/** What a page conflict keeps to apply or revalidate: the page, its key, and Kanka's version as a hash. */
interface PageConflictPayload {
    readonly existingId: string;
    readonly key: string;
    readonly incoming: string;
}

/** The resolver record for one page conflict on `entry`. */
export function toPageConflict(entryId: string, entryName: string, conflict: PageConflict): StoredConflict {
    const payload: PageConflictPayload = { existingId: conflict.existing._id ?? '', key: conflict.key, incoming: incomingMark(conflict.incoming) };
    return {
        id: conflictId('journal', entryId, conflict.key),
        kind: 'journalPage',
        entityType: 'journal',
        entityId: entryId,
        entityName: entryName,
        label: conflict.name,
        kankaAttr: '',
        foundryPath: '',
        kankaValue: pageDisplay(conflict.incoming),
        foundryValue: pageDisplay(conflict.existing),
        payload: JSON.stringify(payload),
    };
}

function readPayload(conflict: StoredConflict): PageConflictPayload | null {
    if (conflict.payload === undefined) return null;
    try {
        // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse of the stored payload, checked below
        const parsed: unknown = JSON.parse(conflict.payload);
        if (parsed === null || typeof parsed !== 'object' || !('existingId' in parsed) || !('key' in parsed) || !('incoming' in parsed)) return null;
        assertType<PageConflictPayload>(parsed);
        return parsed;
    } catch {
        return null;
    }
}

/** A journal page as this module reads it from Foundry. */
function readPage(page: JournalEntryPage): PageData {
    const data = page.toObject();
    assertType<PageData>(data);
    return data;
}

/** The journal's pages, as the planner reads them. */
export function journalPages(entry: JournalEntry): PageData[] {
    return Array.from(entry.pages.values(), readPage);
}

/** Whether `entry` has a page conflict the GM has not resolved. */
export function hasOpenPageConflicts(entryId: string): boolean {
    return listConflicts().some((conflict) => conflict.entityType === 'journal' && conflict.entityId === entryId);
}

/** The update that writes `incoming` over an existing page outright (an update would otherwise merge). */
function replacePageUpdate(id: string, incoming: PageData): JournalEntryPage.UpdateData {
    const update = {
        _id: id,
        name: incoming.name,
        text: replacing(incoming.text ?? {}),
        src: incoming.src ?? null,
        system: replacing(systemOf(incoming)),
        flags: { [SCOPE]: { page: true, declined: null } },
    };
    assertType<JournalEntryPage.UpdateData>(update);
    return update;
}

/** Rebuilds the import's version of one page of a journal (a fresh Kanka fetch), or null when Kanka no longer has it. */
export type PageRebuilder = (entry: JournalEntry, key: string) => Promise<PageData | null>;

/**
 * Apply the GM's choice for a page conflict. Kanka's side replaces the page in
 * place with a freshly built version (or deletes it, when Kanka removed it);
 * Foundry's side keeps the page and records the declined Kanka version so the
 * same version is not asked again.
 */
export async function applyJournalConflict(conflict: StoredConflict, choice: ConflictChoice, rebuild: PageRebuilder): Promise<boolean> {
    const entry = game.journal?.get(conflict.entityId);
    const payload = readPayload(conflict);
    if (entry === undefined || payload === null) return false;
    const page = entry.pages.get(payload.existingId);
    if (page === undefined) return true;
    if (choice === 'foundry') {
        // The typings declare only core flags on a page; the update is typed here.
        const declined = { flags: { [SCOPE]: { declined: payload.incoming } } };
        assertType<JournalEntryPage.UpdateData>(declined);
        await page.update(declined);
        return true;
    }
    if (payload.incoming === REMOVED) {
        await entry.deleteEmbeddedDocuments('JournalEntryPage', [payload.existingId]);
        return true;
    }
    const incoming = await rebuild(entry, payload.key);
    if (incoming === null) return false;
    await entry.updateEmbeddedDocuments('JournalEntryPage', [replacePageUpdate(payload.existingId, incoming)]);
    return true;
}

/** Whether a stored page conflict still holds: the page exists, differs from Kanka's version, and that version is not declined. */
export function isJournalConflictValid(conflict: StoredConflict): boolean {
    const entry = game.journal?.get(conflict.entityId);
    const payload = readPayload(conflict);
    if (entry === undefined || payload === null) return false;
    const page = entry.pages.get(payload.existingId);
    if (page === undefined) return false;
    const current = readPage(page);
    if (declinedMark(current) === payload.incoming) return false;
    return payload.incoming === REMOVED || signatureHash(pageSignature(current)) !== payload.incoming;
}

/** Mark the pages an import writes as its own, so a later re-import tells them from a GM's. */
export function markImported<T extends object>(page: T): T {
    const scoped: PlainObject = { ...asRecord(readProp(page, 'flags')) };
    scoped[SCOPE] = { ...asRecord(scoped[SCOPE]), page: true };
    return { ...page, flags: scoped };
}
