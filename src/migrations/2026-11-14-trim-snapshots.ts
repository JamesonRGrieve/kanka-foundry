import { entityReference, overviewSnapshot, replacing } from '../foundry/snapshotFields';
import { logError, logInfo } from '../util/logger';

function assertType<T>(_value: unknown): asserts _value is T {}

/** The flag update for `snapshot`, typed at the Foundry boundary: the typings can't express a forced replacement. */
function flagUpdate<T>(snapshot: Record<string, unknown>): T {
    const update: unknown = { flags: { 'kanka-foundry': { snapshot: replacing(snapshot) } } };
    assertType<T>(update);
    return update;
}

/**
 * Trim the Kanka copies already stored in a world (wh40k-rpg#739).
 *
 * Earlier versions kept the whole Kanka entity on every post page, the overview
 * page and the journal / actor / item `snapshot` flag, which put ~47 MB into the
 * world payload of the live campaign. This keeps what is read back: the
 * reference fields on the flags, the overview's fields on the overview page, and
 * nothing on a post page (its content is its own text). Each value is written as
 * a forced replacement, as an update otherwise merges and keeps the old keys.
 */

/** A page as the migration reads it. */
export interface StoredPage {
    readonly id: string;
    readonly type: string;
    readonly snapshot: object | undefined;
}

/** The trimmed snapshot for a stored page, or null when it needs no change. */
export function trimmedPageSnapshot(page: StoredPage): Record<string, unknown> | null {
    if (page.snapshot === undefined) return null;
    if (page.type === 'kanka-foundry.post') return Object.keys(page.snapshot).length === 0 ? null : {};
    if (page.type === 'kanka-foundry.overview') {
        const trimmed = overviewSnapshot(page.snapshot);
        return Object.keys(trimmed).length === Object.keys(page.snapshot).length ? null : trimmed;
    }
    return null;
}

/** The trimmed `snapshot` flag, or null when it is already a reference. */
export function trimmedFlagSnapshot(snapshot: object | undefined): Record<string, unknown> | null {
    if (snapshot === undefined) return null;
    const reference: Record<string, unknown> = { ...entityReference(snapshot) };
    return Object.keys(reference).length === Object.keys(snapshot).length ? null : reference;
}

function objectOrUndefined(value: unknown): object | undefined {
    return value !== null && typeof value === 'object' ? value : undefined;
}

function pageSnapshot(page: JournalEntryPage): object | undefined {
    return objectOrUndefined(Reflect.get(objectOrUndefined(page.system) ?? {}, 'snapshot'));
}

export default async function migrate(): Promise<void> {
    let trimmed = 0;
    let failed = 0;

    const journals = Array.from(game.journal?.values() ?? []).filter((e) => e.getFlag('kanka-foundry', 'id'));
    for (const entry of journals) {
        try {
            const pageUpdates: unknown = Array.from(entry.pages.values()).flatMap((page) => {
                const snapshot = trimmedPageSnapshot({ id: page.id ?? '', type: page.type, snapshot: pageSnapshot(page) });
                return snapshot === null ? [] : [{ _id: page.id, system: { snapshot: replacing(snapshot) } }];
            });
            assertType<JournalEntryPage.UpdateData[]>(pageUpdates);
            if (pageUpdates.length > 0) await entry.updateEmbeddedDocuments('JournalEntryPage', pageUpdates);
            const flag = trimmedFlagSnapshot(objectOrUndefined(entry.getFlag('kanka-foundry', 'snapshot')));
            if (flag !== null) await entry.update(flagUpdate<JournalEntry.UpdateData>(flag));
            if (pageUpdates.length > 0 || flag !== null) trimmed += 1;
        } catch (error) {
            failed += 1;
            logError(`Trim snapshots: journal "${entry.name}" failed`, error);
        }
    }

    for (const actor of Array.from(game.actors?.values() ?? []).filter((a: Actor) => a.getFlag('kanka-foundry', 'kankaEntityId'))) {
        try {
            const flag = trimmedFlagSnapshot(objectOrUndefined(actor.getFlag('kanka-foundry', 'snapshot')));
            if (flag === null) continue;
            await actor.update(flagUpdate<Actor.UpdateData>(flag));
            trimmed += 1;
        } catch (error) {
            failed += 1;
            logError(`Trim snapshots: actor "${actor.name}" failed`, error);
        }
    }
    // A world Item made by the item bridge carries the same flag (itemBridge.ts).
    for (const item of Array.from(game.items?.values() ?? [])) {
        const raw: unknown = Reflect.get(objectOrUndefined(Reflect.get(objectOrUndefined(item.flags) ?? {}, 'kanka-foundry')) ?? {}, 'snapshot');
        const flag = trimmedFlagSnapshot(objectOrUndefined(raw));
        if (flag === null) continue;
        try {
            await item.update(flagUpdate<Item.UpdateData>(flag));
            trimmed += 1;
        } catch (error) {
            failed += 1;
            logError(`Trim snapshots: item "${item.name}" failed`, error);
        }
    }

    logInfo(`Trim snapshots: trimmed ${trimmed} documents${failed > 0 ? `, ${failed} failed` : ''}.`);
}
