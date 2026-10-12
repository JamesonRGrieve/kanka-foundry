import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type KankaApiEntityId,
    type KankaApiId,
    type KankaApiModuleType,
    type KankaApiQuestElement,
    type KankaApiTimelineElement,
    KankaVisibility,
} from '../types/kanka';
import {
    ATTITUDE_SAVE_DEBOUNCE_MS,
    CAMPAIGN_TIMELINE_NAME,
    type ChangeContext,
    type CoreEventTracker,
    EventTrackerSync,
    type ImportedJournal,
    type KankaSyncApi,
    RESOLVED_COLOUR,
    attitudesFromAttributes,
    indexEventElements,
    legacyDayToMigrate,
    readCoreEventTracker,
    resolveImportedJournal,
} from './eventTrackerSync';

vi.mock('../api');

const SYNC: ChangeContext = { origin: 'sync' };
const MANUAL: ChangeContext = { origin: 'manual' };
const CAMPAIGN: KankaApiId = 7;
const QUEST: KankaApiId = 11;
const TIMELINE: KankaApiId = 21;
const VARO: KankaApiEntityId = 301;

function questElement(id: number, role: string | null, colour: string | null): KankaApiQuestElement {
    return { id, name: `Quest element ${id}`, entity_id: 900 + id, colour, entry: '', entry_parsed: null, role, visibility_id: KankaVisibility.all };
}

function timelineElement(id: number, date: string | null, colour: string | null): KankaApiTimelineElement {
    return {
        id,
        era_id: 1,
        timeline_id: TIMELINE,
        entity_id: null,
        name: `Timeline element ${id}`,
        entry: '',
        entry_parsed: null,
        date,
        colour,
        position: id,
        icon: null,
        is_collapsed: false,
        visibility_id: KankaVisibility.all,
    };
}

/** A test double of an API: every method becomes a typed vitest mock property. */
type Fake<T> = { -readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };

/** A Kanka campaign holding one quest, the campaign timeline and one NPC (Garrick Varo). */
function fakeKanka(attributes: Array<{ id: KankaApiId; name: string; value: string | null }> = []): Fake<KankaSyncApi> {
    return {
        isReady: true,
        getAllCampaigns: vi.fn<KankaSyncApi['getAllCampaigns']>().mockResolvedValue([{ id: CAMPAIGN }]),
        getAllQuests: vi
            .fn<KankaSyncApi['getAllQuests']>()
            .mockResolvedValue([{ id: QUEST, elements: [questElement(1, 'QUEST_DONE', RESOLVED_COLOUR), questElement(2, 'QUEST_OPEN', null)] }]),
        getAllTimelines: vi.fn<KankaSyncApi['getAllTimelines']>().mockResolvedValue([
            { id: 99, name: 'Some Other Timeline' },
            { id: TIMELINE, name: CAMPAIGN_TIMELINE_NAME },
        ]),
        getTimelineElements: vi
            .fn<KankaSyncApi['getTimelineElements']>()
            .mockResolvedValue([timelineElement(3, 'DAY_DONE', RESOLVED_COLOUR), timelineElement(4, 'DAY_OPEN', '#ffffff')]),
        patchQuestElement: vi.fn<KankaSyncApi['patchQuestElement']>().mockResolvedValue({}),
        patchTimelineElement: vi.fn<KankaSyncApi['patchTimelineElement']>().mockResolvedValue({}),
        getAllCharacters: vi.fn<KankaSyncApi['getAllCharacters']>().mockResolvedValue([{ name: 'Garrick Varo', entity_id: VARO }]),
        getEntityAttributes: vi.fn<KankaSyncApi['getEntityAttributes']>().mockResolvedValue(attributes),
        createEntityAttribute: vi.fn<KankaSyncApi['createEntityAttribute']>().mockResolvedValue({}),
        updateEntityAttribute: vi.fn<KankaSyncApi['updateEntityAttribute']>().mockResolvedValue({}),
    };
}

function fakeTracker(day = 0): Fake<CoreEventTracker> {
    return {
        characters: { 'Garrick Varo': { dispositions: [{ attitude: 'wary' }] }, 'Walk-on': { dispositions: [] } },
        setResolved: vi.fn<CoreEventTracker['setResolved']>().mockResolvedValue(undefined),
        getCampaignDay: vi.fn<CoreEventTracker['getCampaignDay']>().mockReturnValue(day),
        setCampaignDay: vi.fn<CoreEventTracker['setCampaignDay']>().mockResolvedValue(undefined),
        setPcAttitude: vi.fn<CoreEventTracker['setPcAttitude']>().mockResolvedValue(undefined),
        registerJournalLinkResolver: vi.fn<CoreEventTracker['registerJournalLinkResolver']>(),
    };
}

describe('indexEventElements', () => {
    it('indexes quest roles and timeline dates, and reads the resolved colour', () => {
        const index = indexEventElements(
            [{ id: QUEST, elements: [questElement(1, 'A', RESOLVED_COLOUR), questElement(2, 'B', null), questElement(5, null, RESOLVED_COLOUR)] }],
            {
                id: TIMELINE,
                elements: [timelineElement(3, 'C', RESOLVED_COLOUR), timelineElement(4, '', RESOLVED_COLOUR)],
            },
        );
        expect([...index.elementsByEventId.keys()].sort()).toEqual(['A', 'B', 'C']);
        expect([...index.resolvedIds].sort()).toEqual(['A', 'C']);
        expect(index.elementsByEventId.get('C')).toMatchObject({ type: 'timeline', parentId: TIMELINE });
        expect(index.elementsByEventId.get('A')).toMatchObject({ type: 'quest', parentId: QUEST });
    });

    it('lets a timeline element replace a quest element as the push target', () => {
        const index = indexEventElements([{ id: QUEST, elements: [questElement(1, 'A', null)] }], { id: TIMELINE, elements: [timelineElement(3, 'A', null)] });
        expect(index.elementsByEventId.get('A')?.type).toBe('timeline');
    });

    it('works without a campaign timeline', () => {
        expect(indexEventElements([], null).elementsByEventId.size).toBe(0);
    });
});

describe('attitudesFromAttributes', () => {
    it('maps attitude_<pc> attributes to per-PC attitudes, skipping blanks and other attributes', () => {
        expect(
            attitudesFromAttributes([
                { name: 'attitude_Ibnad', value: ' warm ' },
                { name: 'attitude_Magnus', value: '' },
                { name: 'attitude_Gus', value: null },
                { name: 'attitude_', value: 'orphan' },
                { name: 'Status', value: 'Alive' },
            ]),
        ).toEqual({ Ibnad: 'warm' });
    });
});

describe('legacyDayToMigrate', () => {
    it('copies a non-zero legacy day only into a core day still at 0', () => {
        expect(legacyDayToMigrate(0, 12)).toBe(12);
        expect(legacyDayToMigrate(3, 12)).toBeNull();
        expect(legacyDayToMigrate(0, 0)).toBeNull();
        expect(legacyDayToMigrate(0, undefined)).toBeNull();
        expect(legacyDayToMigrate(0, -1)).toBeNull();
        expect(legacyDayToMigrate(0, 2.5)).toBeNull();
    });
});

describe('resolveImportedJournal', () => {
    const byType: Partial<Record<KankaApiModuleType, ImportedJournal[]>> = {
        character: [{ uuid: 'JournalEntry.varo', entityName: 'Garrick Varo' }],
        location: [{ uuid: 'JournalEntry.sump', entityName: 'The Sump' }],
        item: [{ uuid: 'JournalEntry.slate', entityName: 'Data-Slate' }],
        quest: [
            { uuid: 'JournalEntry.quest', entityName: 'Find Eva' },
            { uuid: 'JournalEntry.questDay', entityName: 'Day 4' },
        ],
        journal: [{ uuid: 'JournalEntry.day4', entityName: 'Day 4' }],
    };
    const journalsOfType = (type: KankaApiModuleType): readonly ImportedJournal[] => byType[type] ?? [];

    it('maps each reference kind to its Kanka entity type', () => {
        expect(resolveImportedJournal({ kind: 'character', name: 'Garrick Varo' }, journalsOfType)).toBe('JournalEntry.varo');
        expect(resolveImportedJournal({ kind: 'location', name: 'The Sump' }, journalsOfType)).toBe('JournalEntry.sump');
        expect(resolveImportedJournal({ kind: 'item', name: 'Data-Slate' }, journalsOfType)).toBe('JournalEntry.slate');
        expect(resolveImportedJournal({ kind: 'quest', name: 'Find Eva' }, journalsOfType)).toBe('JournalEntry.quest');
    });

    it('resolves an event source to a journal first, then a quest', () => {
        expect(resolveImportedJournal({ kind: 'event-source', name: 'Day 4' }, journalsOfType)).toBe('JournalEntry.day4');
        expect(resolveImportedJournal({ kind: 'event-source', name: 'Find Eva' }, journalsOfType)).toBe('JournalEntry.quest');
    });

    it('never crosses types, and returns null so the core falls back to its own lookup', () => {
        expect(resolveImportedJournal({ kind: 'location', name: 'Garrick Varo' }, journalsOfType)).toBeNull();
        expect(resolveImportedJournal({ kind: 'character', name: 'Nobody' }, journalsOfType)).toBeNull();
        expect(resolveImportedJournal({ kind: 'character', name: '' }, journalsOfType)).toBeNull();
    });
});

describe('EventTrackerSync pull', () => {
    it('marks Kanka-resolved events resolved and pulls attitudes, all with the sync origin', async () => {
        const kanka = fakeKanka([
            { id: 1, name: 'attitude_Ibnad', value: 'warm' },
            { id: 2, name: 'attitude_Magnus', value: '' },
        ]);
        const tracker = fakeTracker();
        await expect(new EventTrackerSync(kanka, tracker).pull()).resolves.toBe(true);

        expect(tracker.setResolved.mock.calls.map(([id]) => id).sort()).toEqual(['DAY_DONE', 'QUEST_DONE']);
        for (const [, resolved, options] of tracker.setResolved.mock.calls) {
            expect(resolved).toBe(true);
            expect(options).toEqual({ origin: 'sync' });
        }
        // Only NPCs with dispositions are read, and their ids come from ONE character list.
        expect(kanka.getAllCharacters).toHaveBeenCalledTimes(1);
        expect(kanka.getEntityAttributes).toHaveBeenCalledTimes(1);
        expect(kanka.getEntityAttributes).toHaveBeenCalledWith(CAMPAIGN, VARO);
        expect(tracker.setPcAttitude.mock.calls).toEqual([['Garrick Varo', 'Ibnad', 'warm', { origin: 'sync' }]]);
        // Only the campaign timeline's elements are fetched.
        expect(kanka.getTimelineElements).toHaveBeenCalledWith(CAMPAIGN, TIMELINE);
    });

    it('does nothing when Kanka is not configured', async () => {
        const kanka = fakeKanka();
        kanka.isReady = false;
        const tracker = fakeTracker();
        await expect(new EventTrackerSync(kanka, tracker).pull()).resolves.toBe(false);
        expect(kanka.getAllCampaigns).not.toHaveBeenCalled();
        expect(tracker.setResolved).not.toHaveBeenCalled();
    });

    it('logs and reports failure when Kanka is unreachable, without throwing', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const kanka = fakeKanka();
        kanka.getAllCampaigns.mockRejectedValue(new Error('offline'));
        await expect(new EventTrackerSync(kanka, fakeTracker()).pull()).resolves.toBe(false);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('migrates the legacy campaign day only into an unset core day', async () => {
        const unset = fakeTracker(0);
        await new EventTrackerSync(fakeKanka(), unset).migrateLegacyDay(14);
        expect(unset.setCampaignDay).toHaveBeenCalledWith(14, expect.objectContaining({ origin: 'sync' }));

        const set = fakeTracker(3);
        await new EventTrackerSync(fakeKanka(), set).migrateLegacyDay(14);
        expect(set.setCampaignDay).not.toHaveBeenCalled();

        const zero = fakeTracker(0);
        await new EventTrackerSync(fakeKanka(), zero).migrateLegacyDay(0);
        expect(zero.setCampaignDay).not.toHaveBeenCalled();
    });
});

describe('EventTrackerSync push', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('pushes a resolved event to its quest or timeline element colour', async () => {
        const kanka = fakeKanka();
        const sync = new EventTrackerSync(kanka, fakeTracker());
        await sync.onEventResolved('QUEST_OPEN', true, MANUAL);
        expect(kanka.patchQuestElement).toHaveBeenCalledWith(CAMPAIGN, QUEST, 2, { colour: RESOLVED_COLOUR, name: 'Quest element 2' });
        await sync.onEventResolved('DAY_DONE', false, { origin: 'auto' });
        expect(kanka.patchTimelineElement).toHaveBeenCalledWith(CAMPAIGN, TIMELINE, 3, { colour: null, name: 'Timeline element 3' });
    });

    it('skips changes that came from its own pull', async () => {
        const kanka = fakeKanka();
        const sync = new EventTrackerSync(kanka, fakeTracker());
        await sync.onEventResolved('QUEST_OPEN', true, SYNC);
        expect(kanka.getAllQuests).not.toHaveBeenCalled();
        expect(kanka.patchQuestElement).not.toHaveBeenCalled();

        vi.useFakeTimers();
        sync.onPcAttitudeChanged('Garrick Varo', 'Ibnad', 'warm', SYNC);
        await vi.runAllTimersAsync();
        expect(kanka.getEntityAttributes).not.toHaveBeenCalled();
    });

    it('ignores an event no Kanka element carries, and never rejects on a Kanka failure', async () => {
        const kanka = fakeKanka();
        const sync = new EventTrackerSync(kanka, fakeTracker());
        await sync.onEventResolved('UNKNOWN', true, MANUAL);
        expect(kanka.patchQuestElement).not.toHaveBeenCalled();
        expect(kanka.patchTimelineElement).not.toHaveBeenCalled();

        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        kanka.patchQuestElement.mockRejectedValueOnce(new Error('503'));
        await expect(sync.onEventResolved('QUEST_OPEN', true, MANUAL)).resolves.toBeUndefined();
        expect(error).toHaveBeenCalled();
    });

    it('debounces attitude pushes and writes only the last value', async () => {
        vi.useFakeTimers();
        const kanka = fakeKanka([{ id: 41, name: 'attitude_Ibnad', value: 'wary' }]);
        const sync = new EventTrackerSync(kanka, fakeTracker());
        sync.onPcAttitudeChanged('Garrick Varo', 'Ibnad', 'w', MANUAL);
        sync.onPcAttitudeChanged('Garrick Varo', 'Ibnad', 'warm', MANUAL);
        await vi.advanceTimersByTimeAsync(ATTITUDE_SAVE_DEBOUNCE_MS - 1);
        expect(kanka.updateEntityAttribute).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(kanka.updateEntityAttribute).toHaveBeenCalledTimes(1);
        expect(kanka.updateEntityAttribute).toHaveBeenCalledWith(CAMPAIGN, VARO, 41, { value: 'warm' });
    });

    it('creates the attribute when missing, but never creates a blank one', async () => {
        const kanka = fakeKanka();
        const sync = new EventTrackerSync(kanka, fakeTracker());
        await sync.pushPcAttitude('Garrick Varo', 'Magnus', 'hostile');
        expect(kanka.createEntityAttribute).toHaveBeenCalledWith(CAMPAIGN, VARO, { name: 'attitude_Magnus', value: 'hostile' });
        kanka.createEntityAttribute.mockClear();
        await sync.pushPcAttitude('Garrick Varo', 'Magnus', '');
        expect(kanka.createEntityAttribute).not.toHaveBeenCalled();
    });

    it('re-fetches the character list once for an unknown NPC, then gives up quietly', async () => {
        const kanka = fakeKanka();
        const sync = new EventTrackerSync(kanka, fakeTracker());
        await sync.pushPcAttitude('Nobody', 'Ibnad', 'warm');
        expect(kanka.getAllCharacters).toHaveBeenCalledTimes(2);
        expect(kanka.getEntityAttributes).not.toHaveBeenCalled();
    });
});

describe('readCoreEventTracker', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the system tracker only when it exposes the API the adapter needs', () => {
        const tracker = fakeTracker();
        vi.stubGlobal('game', { wh40k: { EventTracker: tracker } });
        expect(readCoreEventTracker()).toBe(tracker);
        vi.stubGlobal('game', { wh40k: { EventTracker: { setResolved: () => undefined } } });
        expect(readCoreEventTracker()).toBeUndefined();
        vi.stubGlobal('game', {});
        expect(readCoreEventTracker()).toBeUndefined();
    });
});
