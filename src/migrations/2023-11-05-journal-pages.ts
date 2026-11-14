import ReferenceCollection from '../api/ReferenceCollection';
import getMessage from '../foundry/getMessage';
import { updateJournalEntry } from '../foundry/journalEntries';
import { showInfo } from '../foundry/notifications';
import type { KankaApiChildEntity } from '../types/kanka';

function assertType<T>(_value: unknown): asserts _value is T {}

/** The entity as a pre-page journal stored it, with the keys the API has since renamed. */
type LegacyEntity = KankaApiChildEntity & {
    entity_notes?: KankaApiChildEntity['posts'];
    entity_files?: KankaApiChildEntity['entity_assets'];
    entity_events?: Array<{ calendar_id: number }>;
};

async function migrateEntry(entry: JournalEntry) {
    // A journal still in the pre-page format carries the whole entity in this flag;
    // the flag has held only a reference since wh40k-rpg#739.
    const legacy: unknown = entry.getFlag('kanka-foundry', 'snapshot');
    assertType<LegacyEntity>(legacy);
    const snapshot = legacy;

    if (snapshot.entity_notes) snapshot.posts = snapshot.entity_notes;
    if (snapshot.entity_files) snapshot.entity_assets = snapshot.entity_files;

    const references = ReferenceCollection.fromRecord(entry.getFlag('kanka-foundry', 'campaign'), entry.getFlag('kanka-foundry', 'references'));

    await Promise.all((snapshot.entity_events ?? []).map(async (event: { calendar_id: number }) => references.addById(event.calendar_id, 'calendar')));

    return updateJournalEntry(entry, snapshot, references);
}

// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const entries = game.journal?.filter((e) => e.getFlag('kanka-foundry', 'version')?.startsWith('000001')) ?? [];

    if (entries.length > 0) {
        SceneNavigation.displayProgressBar({ label: getMessage('migration.journalPages.progress'), pct: 0 });
        let i = 0;

        for (const entry of entries) {
            await migrateEntry(entry);
            i += 1;
            SceneNavigation.displayProgressBar({
                label: getMessage('migration.journalPages.progress'),
                pct: Math.round((i / entries.length) * 100),
            });
        }

        showInfo('migration.journalPages.success');
    }
}
