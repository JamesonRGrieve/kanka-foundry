import moduleConfig from '../../public/module.json';
import type ReferenceCollection from '../api/ReferenceCollection';
import type Reference from '../types/Reference';
function assertType<T>(_value: unknown): asserts _value is T {}
import type {
    AnyConstrainable,
    KankaApiChildEntity,
    KankaApiChildEntityWithChildren,
    KankaApiEntity,
    KankaApiEntityId,
    KankaApiId,
    KankaApiModuleType,
} from '../types/kanka';
import isSecret from '../util/isSecret';
import PageFactory from './PageFactory';
import { addConflicts } from './conflicts/conflictStore';
import { ensureFolderPath } from './journalFolders';
import { journalPages, markImported, type PageData, planPageSync, toPageConflict } from './journalPageSync';
import { showInfo } from './notifications';
import { entityReference } from './snapshotFields';

const CURRENT_JOURNAL_VERSION = '000003';

function buildVersionString(entity: { updated_at: string }): string {
    return `${CURRENT_JOURNAL_VERSION}-${entity.updated_at}`;
}

function getOwnership(
    entities: AnyConstrainable[],
    currentOwnership?: Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS>,
): Record<string, CONST.DOCUMENT_OWNERSHIP_LEVELS> | undefined {
    const setting = game.settings?.get('kanka-foundry', 'automaticPermissions');

    if (setting === 'never') return currentOwnership ?? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
    if (setting === 'initial' && currentOwnership) return currentOwnership;

    if (entities.every((entity) => isSecret(entity))) {
        return {
            ...(currentOwnership ?? {}),
            default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
        };
    }

    return { ...(currentOwnership ?? {}), default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
}

export function findEntryByEntityId(id: KankaApiEntityId): JournalEntry | undefined {
    return game.journal?.find((e) => e.getFlag('kanka-foundry', 'id') === id) ?? undefined;
}

export function findEntriesByType(type: KankaApiModuleType): JournalEntry[] {
    return game.journal?.filter((e) => e.getFlag('kanka-foundry', 'type') === type) ?? [];
}

export function hasOutdatedEntryByEntity(entity: KankaApiEntity): boolean {
    const entry = findEntryByEntityId(entity.id);

    if (!entry) return false; // No entry means it cannot be outdated

    const currentVersion = entry.getFlag('kanka-foundry', 'version');
    if (!currentVersion) return true; // Should be updated!

    return buildVersionString(entity) > currentVersion;
}

/** The pages an import writes for `entity`, each marked as the import's own (journalPageSync). */
export function buildJournalPages(
    campaignId: KankaApiId,
    type: KankaApiModuleType,
    entity: KankaApiChildEntity | KankaApiChildEntityWithChildren,
    references: ReferenceCollection,
    journal?: JournalEntry,
): PageData[] {
    const pages: unknown = createAllPages(campaignId, type, entity, references, journal);
    assertType<PageData[]>(pages);
    return pages;
}

function createAllPages(
    campaignId: KankaApiId,
    type: KankaApiModuleType,
    entity: KankaApiChildEntity | KankaApiChildEntityWithChildren,
    references: ReferenceCollection,
    journal?: JournalEntry,
): JournalEntry.CreateData['pages'] {
    const pageFactory = new PageFactory(campaignId, type, entity, references, journal);

    return [
        pageFactory.createEntityImagePage(),
        pageFactory.createOverviewPage(),
        pageFactory.createCharacterProfilePage(),
        ...pageFactory.createPostPages(),
        pageFactory.createRelationsPage(),
        pageFactory.createCharacterOrganisationsPage(),
        pageFactory.createFamilyMembersPage(),
        pageFactory.createOrganisationMembersPage(),
        pageFactory.createQuestElementsPage(),
        pageFactory.createAssetsPage(),
        ...pageFactory.createAssetFilePages(),
        pageFactory.createAttributesPage(),
        pageFactory.createAbilitiesPage(),
        pageFactory.createInventoryPage(),
        pageFactory.createEventsPage(),
        pageFactory.createChildrenPage(),
    ]
        .filter((page) => !!page)
        .map(markImported);
}

export async function createJournalEntry(
    campaignId: KankaApiId,
    type: KankaApiModuleType,
    entity: KankaApiChildEntity | KankaApiChildEntityWithChildren,
    references: ReferenceCollection,
): Promise<JournalEntry> {
    const withChildren = 'parents' in entity ? entity : undefined;
    const path =
        [...(withChildren?.parents ?? [])]
            .reverse()
            .map((id) => references.findByIdAndType(id, type))
            .filter((ref): ref is Reference => !!ref) ?? [];

    const folder = await ensureFolderPath(type, path);

    const created: unknown = await JournalEntry.create({
        name: entity.name,
        pages: createAllPages(campaignId, type, entity, references),
        flags: {
            'core': {
                sheetClass: `${moduleConfig.name}.KankaJournalApplication`,
            },
            'kanka-foundry': {
                campaign: campaignId,
                type,
                id: entity.entity_id,
                version: buildVersionString(entity),
                snapshot: entityReference(entity),
                references: references.getRecord(),
            },
        },
        ownership: getOwnership([entity], undefined),
        folder: folder?.id,
    });
    assertType<JournalEntry>(created);
    return created;
}

export async function updateJournalEntry(
    entry: JournalEntry,
    entity: KankaApiChildEntity | KankaApiChildEntityWithChildren,
    references: ReferenceCollection,
): Promise<JournalEntry> {
    const campaignId = entry.getFlag('kanka-foundry', 'campaign');
    const type = entry.getFlag('kanka-foundry', 'type');
    const oldName = entry.getFlag('kanka-foundry', 'snapshot')?.name;

    if (!campaignId || !type) throw new Error('Missing flags on journal entry');

    // Recompute the folder path on update so entries imported before their
    // Kanka ancestry existed (or that have since been re-parented) get moved
    // into the correct nested folder, mirroring createJournalEntry.
    const withChildren = 'parents' in entity ? entity : undefined;
    const path =
        [...(withChildren?.parents ?? [])]
            .reverse()
            .map((id) => references.findByIdAndType(id, type))
            .filter((ref): ref is Reference => !!ref) ?? [];
    const folder = await ensureFolderPath(type, path);

    // Compare before overwriting (wh40k-rpg#739): pages the journal lacks are
    // created; a page that differs from Kanka's version, or that Kanka removed,
    // goes to the Conflict Resolver; matching pages and a GM's own pages are kept.
    const plan = planPageSync(journalPages(entry), buildJournalPages(campaignId, type, entity, references, entry));
    await entry.update({
        name: oldName === undefined || entry.name === oldName ? entity.name : oldName, // Keep existing journal name if it was renamed by user
        folder: folder?.id,
        flags: {
            'core': {
                sheetClass: `${moduleConfig.name}.KankaJournalApplication`,
            },
            'kanka-foundry': {
                version: buildVersionString(entity),
                snapshot: entityReference(entity),
                references: references.getRecord(),
            },
        },
        ownership: getOwnership([entity], entry.ownership),
    });
    if (plan.create.length > 0) {
        const created: unknown = plan.create;
        assertType<JournalEntryPage.CreateData[]>(created);
        await entry.createEmbeddedDocuments('JournalEntryPage', created);
    }
    if (plan.conflicts.length > 0) {
        await addConflicts(plan.conflicts.map((conflict) => toPageConflict(entry.id ?? '', entry.name, conflict)));
        showInfo('conflicts', 'journalPages', { count: String(plan.conflicts.length), name: entry.name });
    }

    return entry;
}
