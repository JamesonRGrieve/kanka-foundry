/**
 * Kanka sync adapter for the wh40k-rpg system's Event Tracker (dh-campaign#40).
 *
 * The system owns the tracker — the event graph, resolved events, the campaign
 * day, per-PC attitudes and the GM dashboard — and publishes it as
 * `game.wh40k.EventTracker`. While Kanka is still in use this module keeps it in
 * step with Kanka, and does nothing else:
 *
 * - on `ready` it PULLS Kanka's state into the core once, with `origin: 'sync'`:
 *   events whose quest/timeline element carries {@link RESOLVED_COLOUR} are
 *   marked resolved, and each NPC's `attitude_<pc>` attributes become per-PC
 *   attitudes. The pull is additive — it never un-resolves an event or clears
 *   an attitude the core already holds;
 * - it PUSHES each later core change back to Kanka (element colour, attitude
 *   attribute), skipping changes whose origin is `'sync'` — its own pull — so
 *   nothing echoes back;
 * - it registers a journal-link resolver that maps tracker references to the
 *   JournalEntries this module imported.
 *
 * The campaign day was only ever a Foundry world setting, so it needs no push;
 * the legacy `kanka-foundry.currentDay` value is migrated into the core once.
 *
 * Every Kanka failure is logged and swallowed: a missing token or an
 * unreachable Kanka must never throw into a Foundry hook.
 */

import api from '../api';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId, KankaApiModuleType, KankaApiQuestElement, KankaApiTimelineElement } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { readFunction, readProp, readString } from '../util/reflection';
import { findEntriesByType } from './journalEntries';

/** The element colour that marks an event resolved in Kanka. */
export const RESOLVED_COLOUR = '#22cc66';

/** Name of the Kanka timeline that carries the campaign event graph. */
export const CAMPAIGN_TIMELINE_NAME = 'Campaign Timeline';

/** Idle time after the last change before a PC attitude is pushed to Kanka. */
export const ATTITUDE_SAVE_DEBOUNCE_MS = 1500;

/** Prefix of the Kanka entity attribute holding one PC's attitude toward an NPC. */
const ATTITUDE_ATTRIBUTE_PREFIX = 'attitude_';

/** Who made a core Event Tracker change (mirrors the system's `ChangeOrigin`). */
type ChangeOrigin = 'manual' | 'sync' | 'auto';

/** The final argument of every core Event Tracker hook. */
export interface ChangeContext {
    readonly origin: ChangeOrigin;
    readonly detail?: string;
}

/** `wh40k-rpg.eventResolved`: an event was marked resolved (or unresolved) in the core tracker. */
export type EventResolvedHook = (eventId: string, resolved: boolean, context: ChangeContext) => void;

/** `wh40k-rpg.campaignDayChanged`: the core campaign day changed. */
export type CampaignDayChangedHook = (day: number, context: ChangeContext) => void;

/** `wh40k-rpg.pcAttitudeChanged`: a PC's attitude toward an NPC changed (`''` when cleared). */
export type PcAttitudeChangedHook = (npc: string, pc: string, attitude: string, context: ChangeContext) => void;

/** What a tracker reference names (mirrors the system's `JournalRefKind`). */
type JournalRefKind = 'character' | 'location' | 'event-source' | 'quest' | 'item';

/** A named reference the core dashboard wants linked to its journal. */
export interface JournalRef {
    readonly kind: JournalRefKind;
    readonly name: string;
}

interface ChangeOptions {
    origin?: ChangeOrigin;
    detail?: string;
}

/** One disposition entry of a graph character; only its presence matters here. */
interface CoreDisposition {
    readonly attitude?: string;
}

/** The slice of `game.wh40k.EventTracker` this adapter uses. */
export interface CoreEventTracker {
    readonly characters: Readonly<Record<string, { readonly dispositions?: readonly CoreDisposition[] }>> | null;
    setResolved(eventId: string, resolved?: boolean, options?: ChangeOptions): Promise<void>;
    getCampaignDay(): number;
    setCampaignDay(day: number, options?: ChangeOptions): Promise<void>;
    setPcAttitude(npc: string, pc: string, attitude: string, options?: ChangeOptions): Promise<void>;
    registerJournalLinkResolver(resolver: ((ref: JournalRef) => string | null) | null): void;
}

/** The colour/name patch both element endpoints take. */
type ElementPatch = Partial<Pick<KankaApiQuestElement, 'colour' | 'name'>>;

/**
 * The Kanka API calls this adapter makes, narrowed to the fields it reads —
 * the module's `KankaApi` satisfies it structurally.
 */
export interface KankaSyncApi {
    readonly isReady: boolean;
    getAllCampaigns(): Promise<ReadonlyArray<{ readonly id: KankaApiId }>>;
    getAllQuests(campaignId: KankaApiId): Promise<readonly QuestElements[]>;
    getAllTimelines(campaignId: KankaApiId): Promise<ReadonlyArray<{ readonly id: KankaApiId; readonly name: string }>>;
    getTimelineElements(campaignId: KankaApiId, timelineId: KankaApiId): Promise<readonly KankaApiTimelineElement[]>;
    patchQuestElement(campaignId: KankaApiId, questId: KankaApiId, elementId: KankaApiId, data: ElementPatch): Promise<object>;
    patchTimelineElement(campaignId: KankaApiId, timelineId: KankaApiId, elementId: KankaApiId, data: ElementPatch): Promise<object>;
    getAllCharacters(campaignId: KankaApiId): Promise<ReadonlyArray<{ readonly name: string; readonly entity_id: KankaApiEntityId }>>;
    getEntityAttributes(campaignId: KankaApiId, entityId: KankaApiEntityId): Promise<ReadonlyArray<Pick<KankaApiAttribute, 'id' | 'name' | 'value'>>>;
    createEntityAttribute(campaignId: KankaApiId, entityId: KankaApiEntityId, data: { name: string; value: string }): Promise<object>;
    updateEntityAttribute(campaignId: KankaApiId, entityId: KankaApiEntityId, attributeId: KankaApiId, data: { value: string }): Promise<object>;
}

/** The Kanka quest/timeline element that carries one event. */
interface EventElementRef {
    readonly type: 'quest' | 'timeline';
    readonly parentId: KankaApiId;
    readonly element: KankaApiQuestElement | KankaApiTimelineElement;
}

/** Kanka's events, indexed by the event id each element carries. */
export interface KankaEventIndex {
    readonly elementsByEventId: Map<string, EventElementRef>;
    readonly resolvedIds: Set<string>;
}

/** The parts of a Kanka quest the index reads. */
interface QuestElements {
    readonly id: KankaApiId;
    readonly elements: readonly KankaApiQuestElement[];
}

/** The campaign timeline and its (separately fetched) elements. */
interface TimelineElements {
    readonly id: KankaApiId;
    readonly elements: readonly KankaApiTimelineElement[];
}

function indexElement(index: KankaEventIndex, eventId: string | null, ref: EventElementRef): void {
    if (eventId === null || eventId === '') return;
    index.elementsByEventId.set(eventId, ref);
    if (ref.element.colour === RESOLVED_COLOUR) index.resolvedIds.add(eventId);
}

/**
 * Index Kanka's quest elements (event id in `role`) and campaign-timeline
 * elements (event id in `date`) by event id, noting which are resolved. A
 * timeline element replaces a quest element carrying the same id as the push
 * target; an id is resolved when any of its elements is.
 */
export function indexEventElements(quests: readonly QuestElements[], timeline: TimelineElements | null): KankaEventIndex {
    const index: KankaEventIndex = { elementsByEventId: new Map(), resolvedIds: new Set() };
    for (const quest of quests) {
        for (const element of quest.elements) indexElement(index, element.role, { type: 'quest', parentId: quest.id, element });
    }
    if (timeline !== null) {
        for (const element of timeline.elements) indexElement(index, element.date, { type: 'timeline', parentId: timeline.id, element });
    }
    return index;
}

/** The parts of a Kanka attribute the attitude pull reads. */
interface NamedAttribute {
    readonly name: string;
    readonly value: string | null;
}

/** `{ [pc]: attitude }` from an NPC's `attitude_<pc>` attributes; blank values are skipped. */
export function attitudesFromAttributes(attributes: readonly NamedAttribute[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const attribute of attributes) {
        if (!attribute.name.startsWith(ATTITUDE_ATTRIBUTE_PREFIX)) continue;
        const pc = attribute.name.slice(ATTITUDE_ATTRIBUTE_PREFIX.length);
        const value = attribute.value?.trim() ?? '';
        if (pc !== '' && value !== '') out[pc] = value;
    }
    return out;
}

/**
 * The legacy `kanka-foundry.currentDay` value to copy into the core, or null.
 * Only a core day still at 0 is overwritten, and only by a non-zero legacy day.
 */
export function legacyDayToMigrate(coreDay: number, legacyDay: number | undefined): number | null {
    if (coreDay !== 0 || legacyDay === undefined) return null;
    return Number.isInteger(legacyDay) && legacyDay > 0 ? legacyDay : null;
}

/** The Kanka entity types that fit each reference kind, most preferred first. */
const MODULE_TYPES_FOR_KIND: Readonly<Record<JournalRefKind, readonly KankaApiModuleType[]>> = {
    'character': ['character'],
    'location': ['location'],
    'item': ['item'],
    'quest': ['quest'],
    'event-source': ['journal', 'quest'],
};

/** An imported JournalEntry as the resolver sees it. */
export interface ImportedJournal {
    readonly uuid: string;
    /** The Kanka entity name (the import snapshot's), which survives a GM renaming the journal. */
    readonly entityName: string;
}

/** The imported JournalEntries of one Kanka entity type. */
export type ImportedJournalsOfType = (type: KankaApiModuleType) => readonly ImportedJournal[];

/** The UUID of the imported journal whose Kanka entity name and type fit `ref`, or null. */
export function resolveImportedJournal(ref: JournalRef, journalsOfType: ImportedJournalsOfType): string | null {
    if (ref.name === '') return null;
    for (const type of MODULE_TYPES_FOR_KIND[ref.kind]) {
        const match = journalsOfType(type).find((journal) => journal.entityName === ref.name);
        if (match !== undefined) return match.uuid;
    }
    return null;
}

/** This module's imported JournalEntries of one type, read from their `kanka-foundry` flags. */
function importedJournalsOfType(type: KankaApiModuleType): ImportedJournal[] {
    const journals: ImportedJournal[] = [];
    for (const entry of findEntriesByType(type)) {
        // A world JournalEntry always has a uuid; only an unsaved document lacks one.
        if (entry.uuid === null) continue;
        const snapshotName = readString(entry.getFlag('kanka-foundry', 'snapshot'), 'name');
        journals.push({ uuid: entry.uuid, entityName: snapshotName ?? entry.name });
    }
    return journals;
}

/** The Kanka sync state and the pull/push operations over it. */
export class EventTrackerSync {
    readonly #kanka: KankaSyncApi;
    readonly #tracker: CoreEventTracker;
    #campaignId: KankaApiId | null = null;
    #index: KankaEventIndex | null = null;
    #npcEntityIds: Map<string, KankaApiEntityId> | null = null;
    readonly #attitudeTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(kanka: KankaSyncApi, tracker: CoreEventTracker) {
        this.#kanka = kanka;
        this.#tracker = tracker;
    }

    /** Copy a non-zero legacy campaign day into a core day still at 0. */
    async migrateLegacyDay(legacyDay: number | undefined): Promise<void> {
        const day = legacyDayToMigrate(this.#tracker.getCampaignDay(), legacyDay);
        if (day === null) return;
        try {
            await this.#tracker.setCampaignDay(day, { origin: 'sync', detail: 'kanka-foundry.currentDay migration' });
            logInfo(`EventTrackerSync: migrated the campaign day (${day}) into the wh40k-rpg Event Tracker`);
        } catch (err) {
            logError('EventTrackerSync: failed to migrate the campaign day', err);
        }
    }

    /**
     * Pull Kanka's resolved events and PC attitudes into the core once.
     * Returns false when Kanka is not configured or not reachable.
     */
    async pull(): Promise<boolean> {
        if (!this.#kanka.isReady) {
            logInfo('EventTrackerSync: Kanka is not configured — skipping Event Tracker sync');
            return false;
        }
        try {
            const index = await this.#loadIndex();
            for (const eventId of index.resolvedIds) {
                // eslint-disable-next-line no-await-in-loop -- each write persists a world setting; serialized so they never race
                await this.#tracker.setResolved(eventId, true, { origin: 'sync' });
            }
            await this.#pullAttitudes();
            logInfo(`EventTrackerSync: pulled ${index.resolvedIds.size} resolved events from Kanka`);
            return true;
        } catch (err) {
            logError('EventTrackerSync: failed to pull Event Tracker state from Kanka', err);
            return false;
        }
    }

    /** Push a resolved-state change to the event's Kanka element. Never rejects. */
    async onEventResolved(eventId: string, resolved: boolean, context: ChangeContext): Promise<void> {
        if (context.origin === 'sync') return;
        try {
            const campaignId = await this.#ensureCampaignId();
            const ref = (await this.#ensureIndex()).elementsByEventId.get(eventId);
            if (ref === undefined) {
                logInfo(`EventTrackerSync: no Kanka element carries event ${eventId} — nothing to push`);
                return;
            }
            const colour = resolved ? RESOLVED_COLOUR : null;
            const patch = { colour, name: ref.element.name };
            if (ref.type === 'quest') await this.#kanka.patchQuestElement(campaignId, ref.parentId, ref.element.id, patch);
            else await this.#kanka.patchTimelineElement(campaignId, ref.parentId, ref.element.id, patch);
            ref.element.colour = colour;
            logInfo(`EventTrackerSync: ${eventId} → ${resolved ? 'resolved' : 'pending'} in Kanka`);
        } catch (err) {
            logError(`EventTrackerSync: failed to push event ${eventId} to Kanka`, err);
        }
    }

    /** Debounce an attitude change; the last value within the window is pushed. */
    onPcAttitudeChanged(npc: string, pc: string, attitude: string, context: ChangeContext): void {
        if (context.origin === 'sync') return;
        const key = JSON.stringify([npc, pc]);
        const pending = this.#attitudeTimers.get(key);
        if (pending !== undefined) clearTimeout(pending);
        this.#attitudeTimers.set(
            key,
            setTimeout(() => {
                this.#attitudeTimers.delete(key);
                void this.pushPcAttitude(npc, pc, attitude);
            }, ATTITUDE_SAVE_DEBOUNCE_MS),
        );
    }

    /** Write one PC's attitude to the NPC's `attitude_<pc>` Kanka attribute. Never rejects. */
    async pushPcAttitude(npc: string, pc: string, attitude: string): Promise<void> {
        const attributeName = `${ATTITUDE_ATTRIBUTE_PREFIX}${pc}`;
        try {
            const campaignId = await this.#ensureCampaignId();
            const entityId = await this.#npcEntityId(npc);
            if (entityId === undefined) {
                logInfo(`EventTrackerSync: no Kanka character named "${npc}" — attitude not pushed`);
                return;
            }
            const existing = (await this.#kanka.getEntityAttributes(campaignId, entityId)).find((attribute) => attribute.name === attributeName);
            if (existing !== undefined) await this.#kanka.updateEntityAttribute(campaignId, entityId, existing.id, { value: attitude });
            else if (attitude !== '') await this.#kanka.createEntityAttribute(campaignId, entityId, { name: attributeName, value: attitude });
            logInfo(`EventTrackerSync: saved ${attributeName} for ${npc} in Kanka`);
        } catch (err) {
            logError(`EventTrackerSync: failed to push ${attributeName} for ${npc} to Kanka`, err);
        }
    }

    /** The campaign the tracker syncs with: the first one the token can see (the plugin's long-standing rule). */
    async #ensureCampaignId(): Promise<KankaApiId> {
        if (this.#campaignId !== null) return this.#campaignId;
        const campaign = (await this.#kanka.getAllCampaigns()).at(0);
        if (campaign === undefined) throw new Error('No Kanka campaigns found. Check the Kanka API token and base URL.');
        this.#campaignId = campaign.id;
        return campaign.id;
    }

    async #ensureIndex(): Promise<KankaEventIndex> {
        if (this.#index !== null) return this.#index;
        return this.#loadIndex();
    }

    /** Fetch the quests (elements inline) and the campaign timeline's elements, and index them. */
    async #loadIndex(): Promise<KankaEventIndex> {
        const campaignId = await this.#ensureCampaignId();
        const quests = await this.#kanka.getAllQuests(campaignId);
        const campaignTimeline = (await this.#kanka.getAllTimelines(campaignId)).find((candidate) => candidate.name === CAMPAIGN_TIMELINE_NAME);
        const timeline =
            campaignTimeline === undefined
                ? null
                : { id: campaignTimeline.id, elements: await this.#kanka.getTimelineElements(campaignId, campaignTimeline.id) };
        this.#index = indexEventElements(quests, timeline);
        return this.#index;
    }

    /** Kanka character entity ids by name, fetched in ONE request; `refresh` re-fetches. */
    async #loadNpcEntityIds(refresh: boolean): Promise<Map<string, KankaApiEntityId>> {
        if (this.#npcEntityIds !== null && !refresh) return this.#npcEntityIds;
        const characters = await this.#kanka.getAllCharacters(await this.#ensureCampaignId());
        this.#npcEntityIds = new Map(characters.map((character) => [character.name, character.entity_id]));
        return this.#npcEntityIds;
    }

    /** The NPC's Kanka entity id, re-fetching the list once when the name is unknown (a new or renamed character). */
    async #npcEntityId(npc: string): Promise<KankaApiEntityId | undefined> {
        const known = (await this.#loadNpcEntityIds(false)).get(npc);
        return known ?? (await this.#loadNpcEntityIds(true)).get(npc);
    }

    /** Pull each graph NPC's `attitude_<pc>` attributes into the core. */
    async #pullAttitudes(): Promise<void> {
        const characters = this.#tracker.characters;
        if (characters === null) return;
        const npcs = Object.entries(characters)
            .filter(([, character]) => (character.dispositions?.length ?? 0) > 0)
            .map(([name]) => name);
        if (npcs.length === 0) return;
        const campaignId = await this.#ensureCampaignId();
        const entityIds = await this.#loadNpcEntityIds(true);
        for (const npc of npcs) {
            const entityId = entityIds.get(npc);
            if (entityId === undefined) continue;
            try {
                // eslint-disable-next-line no-await-in-loop -- deliberate: one request per NPC, serialized so a large cast does not burst Kanka's rate limit
                const attitudes = attitudesFromAttributes(await this.#kanka.getEntityAttributes(campaignId, entityId));
                for (const [pc, attitude] of Object.entries(attitudes)) {
                    // eslint-disable-next-line no-await-in-loop -- each write persists a world setting; serialized so they never race
                    await this.#tracker.setPcAttitude(npc, pc, attitude, { origin: 'sync' });
                }
            } catch (err) {
                logError(`EventTrackerSync: failed to pull attitudes for ${npc}`, err);
            }
        }
    }
}

/** Every method this adapter calls on the core tracker; all must exist for the adapter to start. */
const CORE_TRACKER_METHODS = ['setResolved', 'getCampaignDay', 'setCampaignDay', 'setPcAttitude', 'registerJournalLinkResolver'] as const;

/** Structural assertion with no runtime check and no `as`, after the methods were verified. */
// eslint-disable-next-line no-restricted-syntax -- boundary: assertion-function parameter, the one sanctioned use of `unknown`
function assertShape<T>(_value: unknown): asserts _value is T {}

/** `game.wh40k.EventTracker` when the wh40k-rpg system provides it, else undefined. */
export function readCoreEventTracker(): CoreEventTracker | undefined {
    const tracker = readProp(readProp(game, 'wh40k'), 'EventTracker');
    if (CORE_TRACKER_METHODS.some((method) => readFunction<() => void>(tracker, method) === undefined)) return undefined;
    assertShape<CoreEventTracker>(tracker);
    return tracker;
}

/** Listen for core changes and push them to Kanka. The day is Foundry-only, so it has no listener. */
function registerPushListeners(sync: EventTrackerSync): void {
    Hooks.on('wh40k-rpg.eventResolved', (eventId, resolved, context) => {
        void sync.onEventResolved(eventId, resolved, context);
    });
    Hooks.on('wh40k-rpg.pcAttitudeChanged', (npc, pc, attitude, context) => {
        sync.onPcAttitudeChanged(npc, pc, attitude, context);
    });
}

/**
 * Start the adapter. Call from the `ready` hook; it is a no-op on a player
 * client or without the wh40k-rpg Event Tracker, and never rejects.
 */
export async function startEventTrackerSync(): Promise<void> {
    try {
        if (game.user?.isGM !== true) return;
        const tracker = readCoreEventTracker();
        if (tracker === undefined) return;

        tracker.registerJournalLinkResolver((ref) => resolveImportedJournal(ref, importedJournalsOfType));

        const sync = new EventTrackerSync(api, tracker);
        await sync.migrateLegacyDay(game.settings?.get('kanka-foundry', 'currentDay'));
        if (await sync.pull()) registerPushListeners(sync);
    } catch (err) {
        logError('EventTrackerSync: failed to start', err);
    }
}
