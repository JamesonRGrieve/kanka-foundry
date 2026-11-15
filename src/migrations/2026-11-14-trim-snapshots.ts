import { hasOpenPageConflicts } from '../foundry/journalPageSync';
import { entityReference, overviewSnapshot, replacing } from '../foundry/snapshotFields';
import { logError, logInfo } from '../util/logger';
import { asRecord, assertType, type PlainObject, readProp } from '../util/reflection';

/**
 * Trim the Kanka copies already stored in a world (wh40k-rpg#739).
 *
 * Earlier versions kept the whole Kanka entity on every post page, the overview
 * page and the journal / actor / item `snapshot` flag, which put ~47 MB into the
 * world payload of the live campaign. This keeps what is read back: the
 * reference fields on the flags, the overview's fields on the overview page, and
 * nothing on a post page (its content is its own text). Each value is written as
 * a forced replacement, as an update otherwise merges and keeps the old keys.
 *
 * It changes nothing a reader sees: every field a template or reader uses is kept
 * (the template guard test holds the overview list to the templates). A journal
 * with a page conflict still open in the Conflict Resolver is left for later.
 */

/** A page as the migration reads it. */
export interface StoredPage {
    readonly id: string;
    readonly type: string;
    readonly snapshot: object | undefined;
}

/** The trimmed snapshot for a stored page, or null when it needs no change. */
export function trimmedPageSnapshot(page: StoredPage): PlainObject | null {
    if (page.snapshot === undefined) return null;
    if (page.type === 'kanka-foundry.post') return Object.keys(page.snapshot).length === 0 ? null : {};
    if (page.type === 'kanka-foundry.overview') {
        // By content: a trim can now shorten a kept field (the relations), not only drop fields.
        const trimmed = overviewSnapshot(page.snapshot);
        return JSON.stringify(trimmed) === JSON.stringify(page.snapshot) ? null : trimmed;
    }
    return null;
}

/** The trimmed `snapshot` flag, or null when it is already a reference. */
export function trimmedFlagSnapshot(snapshot: object | undefined): PlainObject | null {
    if (snapshot === undefined) return null;
    const reference: PlainObject = { ...entityReference(snapshot) };
    return Object.keys(reference).length === Object.keys(snapshot).length ? null : reference;
}

/** A Kanka flag value as an object, or undefined. */
function flagObject(document: { readonly flags: object }, key: string): object | undefined {
    return asRecord(asRecord(Reflect.get(document.flags, 'kanka-foundry'))?.[key]);
}

/** A page's stored snapshot, as an object, or undefined. */
function pageSnapshot(page: JournalEntryPage): object | undefined {
    return asRecord(asRecord(page.system)?.['snapshot']);
}

/** The page updates that trim one journal, typed at the Foundry boundary. */
function pageUpdates(entry: JournalEntry): JournalEntryPage.UpdateData[] {
    const updates = Array.from(entry.pages.values()).flatMap((page) => {
        const snapshot = trimmedPageSnapshot({ id: page.id, type: page.type, snapshot: pageSnapshot(page) });
        return snapshot === null ? [] : [{ _id: page.id, system: { snapshot: replacing(snapshot) } }];
    });
    assertType<JournalEntryPage.UpdateData[]>(updates);
    return updates;
}

/** The `snapshot` flag update for each document that still carries a whole entity, by id. */
function flagUpdates<T>(documents: ReadonlyArray<{ readonly id: string | null; readonly flags: object }>): T[] {
    const updates = documents.flatMap((document) => {
        const flag = trimmedFlagSnapshot(flagObject(document, 'snapshot'));
        return flag === null || document.id === null ? [] : [{ _id: document.id, flags: { 'kanka-foundry': { snapshot: replacing(flag) } } }];
    });
    assertType<T[]>(updates);
    return updates;
}

/** Whether a document was made by the importer. */
function isKankaDocument(document: { readonly flags: object }, idKey: string): boolean {
    return asRecord(Reflect.get(document.flags, 'kanka-foundry'))?.[idKey] !== undefined;
}

export default async function migrate(): Promise<void> {
    const journals = Array.from(game.journal?.values() ?? []).filter((entry) => isKankaDocument(entry, 'id') && !hasOpenPageConflicts(entry.id));
    const pageResults = await Promise.allSettled(
        journals.map(async (entry) => {
            const updates = pageUpdates(entry);
            if (updates.length > 0) await entry.updateEmbeddedDocuments('JournalEntryPage', updates);
            return updates.length;
        }),
    );
    const failed = pageResults.filter((result) => result.status === 'rejected');
    for (const result of failed) logError("Trim snapshots: a journal's pages failed", readProp(result, 'reason'));

    const journalFlags = flagUpdates<JournalEntry.UpdateData>(journals);
    const actorFlags = flagUpdates<Actor.UpdateData>(Array.from(game.actors?.values() ?? []).filter((actor) => isKankaDocument(actor, 'kankaEntityId')));
    // A world Item made by the item bridge carries the same flag (itemBridge.ts).
    const itemFlags = flagUpdates<Item.UpdateData>(Array.from(game.items?.values() ?? []).filter((item) => isKankaDocument(item, 'kankaEntityId')));
    try {
        if (journalFlags.length > 0) await JournalEntry.updateDocuments(journalFlags);
        if (actorFlags.length > 0) await Actor.updateDocuments(actorFlags);
        if (itemFlags.length > 0) await Item.updateDocuments(itemFlags);
    } catch (error) {
        logError('Trim snapshots: a flag update failed', error);
    }

    const pagesTrimmed = pageResults.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
    logInfo(
        `Trim snapshots: ${pagesTrimmed} pages and ${journalFlags.length + actorFlags.length + itemFlags.length} flags trimmed${failed.length > 0 ? `, ${failed.length} journals failed` : ''}.`,
    );
}
