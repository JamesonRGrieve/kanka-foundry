import api from '../api';
import type { KankaApiCampaign, KankaApiId } from '../types/kanka';
import { logError } from '../util/logger';
import { addConflicts } from './conflicts/conflictStore';
import { type ConflictChoice, type StoredConflict, conflictId } from './conflicts/types';
function assertType<T>(_value: unknown): asserts _value is T {}

const CAMPAIGN_FLAG_SCOPE = 'kanka-foundry';
const CAMPAIGN_PAGE_NAME = 'Campaign Description';
const CAMPAIGN_TIMER_PREFIX = 'campaign-description-';
const DEBOUNCE_MS = 5000;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function isCampaignDescriptionEntry(entry: JournalEntry): boolean {
    return Boolean(entry.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaignDescription'));
}

function findCampaignDescriptionEntry(campaignId: KankaApiId): JournalEntry | undefined {
    return (
        game.journal?.find((entry) =>
            Boolean(entry.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaignDescription') && entry.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaign') === campaignId),
        ) ?? undefined
    );
}

function buildCampaignPages(campaign: KankaApiCampaign): JournalEntryPage.CreateData[] {
    const pages: JournalEntryPage.CreateData[] = [];

    if (campaign.image_full) {
        pages.push({
            type: 'image',
            name: 'Campaign Image',
            title: { show: false, level: 1 },
            src: campaign.image_full,
            image: { caption: campaign.name },
        });
    }

    pages.push({
        type: 'text',
        name: CAMPAIGN_PAGE_NAME,
        title: { show: false, level: 1 },
        text: { content: campaign.entry ?? '' },
    });

    return pages;
}

interface PageText {
    content?: string;
}

function isPageText(value: unknown): value is PageText {
    return value !== null && typeof value === 'object';
}

function getCampaignContent(entry: JournalEntry): string {
    const textPage = Array.from(entry.pages.values()).find((page) => page.type === 'text');
    const rawText: unknown = textPage !== undefined ? Reflect.get(textPage, 'text') : undefined;
    const text = isPageText(rawText) ? rawText : undefined;
    return text?.content ?? '';
}

async function createCampaignDescriptionEntry(campaign: KankaApiCampaign): Promise<JournalEntry> {
    const created: unknown = await JournalEntry.create({
        name: campaign.name,
        pages: buildCampaignPages(campaign),
        flags: {
            [CAMPAIGN_FLAG_SCOPE]: {
                campaign: campaign.id,
                campaignDescription: true,
                campaignSnapshot: campaign,
            },
        },
    });
    assertType<JournalEntry>(created);
    return created;
}

async function updateCampaignDescriptionEntry(entry: JournalEntry, campaign: KankaApiCampaign, contentOverride?: string): Promise<void> {
    const updatedCampaign = contentOverride === undefined ? campaign : { ...campaign, entry: contentOverride };

    await entry.deleteEmbeddedDocuments('JournalEntryPage', [], { deleteAll: true });
    await entry.update({
        name: campaign.name,
        pages: buildCampaignPages(updatedCampaign),
        flags: {
            [CAMPAIGN_FLAG_SCOPE]: {
                campaign: campaign.id,
                campaignDescription: true,
                campaignSnapshot: campaign,
            },
        },
    });
}

export async function reconcileCampaignDescriptionJournal(campaignId?: KankaApiId): Promise<void> {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;

    const numericCampaignId = campaignId ?? Number(game.settings?.get('kanka-foundry', 'campaign'));
    if (!numericCampaignId) return;

    let campaign: KankaApiCampaign;
    try {
        campaign = await api.getCampaign(Number(numericCampaignId));
    } catch (error) {
        logError(`Failed to fetch campaign ${String(numericCampaignId)}`, error);
        return;
    }

    const entry = findCampaignDescriptionEntry(numericCampaignId);
    const kankaContent = campaign.entry ?? '';

    if (!entry) {
        if (!kankaContent && !campaign.image_full) return;
        await createCampaignDescriptionEntry(campaign);
        return;
    }

    const foundryContent = getCampaignContent(entry);

    if (!foundryContent && kankaContent) {
        await updateCampaignDescriptionEntry(entry, campaign);
        return;
    }

    if (foundryContent && !kankaContent) {
        try {
            await api.updateCampaign(Number(numericCampaignId), { entry: foundryContent });
            await updateCampaignDescriptionEntry(entry, { ...campaign, entry: foundryContent }, foundryContent);
        } catch (error) {
            logError(`Failed to push campaign description for ${campaign.name}`, error);
        }
        return;
    }

    if (foundryContent && kankaContent && foundryContent !== kankaContent) {
        console.warn(`[kanka-foundry] CONFLICT on campaign "${campaign.name}": Foundry and Kanka have different descriptions`);
        await addConflicts([
            {
                id: conflictId('campaign', String(numericCampaignId), 'entry'),
                kind: 'campaignDescription',
                entityType: 'campaign',
                entityId: String(numericCampaignId),
                entityName: campaign.name,
                label: CAMPAIGN_PAGE_NAME,
                kankaAttr: '',
                foundryPath: '',
                kankaValue: kankaContent,
                foundryValue: foundryContent,
            },
        ]);
        return;
    }

    if (entry.name !== campaign.name || Boolean(campaign.image_full) !== Array.from(entry.pages.values()).some((page) => page.type === 'image')) {
        await updateCampaignDescriptionEntry(entry, campaign, foundryContent || kankaContent);
    }
}

/**
 * Re-check whether a stored campaign-description conflict still holds. Returns
 * false once the two sides agree (or the entry/campaign is gone), so the
 * resolver can drop it.
 */
export async function isCampaignConflictValid(conflict: StoredConflict): Promise<boolean> {
    const campaignId = Number(conflict.entityId);
    if (!campaignId) return false;

    const entry = findCampaignDescriptionEntry(campaignId);
    if (!entry) return false;

    let campaign: KankaApiCampaign;
    try {
        campaign = await api.getCampaign(campaignId);
    } catch (error) {
        logError(`Failed to revalidate campaign ${String(campaignId)}`, error);
        return false;
    }

    const foundryContent = getCampaignContent(entry);
    const kankaContent = campaign.entry ?? '';
    return Boolean(foundryContent && kankaContent && foundryContent !== kankaContent);
}

/** Read the campaign snapshot stored on the description entry (present on every
 *  entry the module creates/updates), so a local resolution can rebuild the
 *  entry's pages without a fresh Kanka fetch. */
function getStoredCampaignSnapshot(entry: JournalEntry): KankaApiCampaign | undefined {
    // eslint-disable-next-line no-restricted-syntax -- boundary: opaque flag value fed into the guard below
    const raw: unknown = entry.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaignSnapshot');
    if (raw === null || typeof raw !== 'object' || !('id' in raw) || !('name' in raw)) return undefined;
    assertType<KankaApiCampaign>(raw);
    return raw;
}

/**
 * Apply a resolved campaign-description conflict. `foundry` pushes the Foundry
 * body to Kanka; `kanka` writes the Kanka body into the Foundry entry. Either
 * way both sides end up holding the chosen content.
 *
 * The `kanka` (Foundry-side) write must NOT depend on Kanka being reachable, so
 * the entry's stored campaign snapshot is used to rebuild its pages; only the
 * `foundry` push actually calls the Kanka API.
 */
export async function applyCampaignConflict(conflict: StoredConflict, choice: ConflictChoice): Promise<boolean> {
    const campaignId = Number(conflict.entityId);
    if (!campaignId) return false;

    const entry = findCampaignDescriptionEntry(campaignId);
    const content = choice === 'foundry' ? conflict.foundryValue : conflict.kankaValue;

    // Only the "keep Foundry" choice mutates Kanka; a failure there is fatal.
    if (choice === 'foundry') {
        try {
            await api.updateCampaign(campaignId, { entry: content });
        } catch (error) {
            logError(`Failed to push campaign description to Kanka for campaign ${String(campaignId)}`, error);
            return false;
        }
    }

    if (entry) {
        // Prefer a fresh fetch for accurate name/image, but fall back to the
        // stored snapshot so a local resolution succeeds even if Kanka is down.
        let campaign = getStoredCampaignSnapshot(entry);
        try {
            campaign = await api.getCampaign(campaignId);
        } catch (error) {
            logError(`Using stored snapshot; failed to refetch campaign ${String(campaignId)}`, error);
        }
        if (!campaign) return false;

        try {
            await updateCampaignDescriptionEntry(entry, { ...campaign, entry: content }, content);
        } catch (error) {
            logError(`Failed to update campaign description entry for campaign ${String(campaignId)}`, error);
            return false;
        }
    }
    return true;
}

function scheduleCampaignReconcile(campaignId: KankaApiId): void {
    const key = `${CAMPAIGN_TIMER_PREFIX}${String(campaignId)}`;
    const timer = pendingTimers.get(key);
    if (timer) clearTimeout(timer);

    pendingTimers.set(
        key,
        setTimeout(async () => {
            pendingTimers.delete(key);
            await reconcileCampaignDescriptionJournal(campaignId);
        }, DEBOUNCE_MS),
    );
}

export function registerCampaignDescriptionHooks(): void {
    Hooks.on('updateJournalEntry', (entry: JournalEntry) => {
        if (!isCampaignDescriptionEntry(entry)) return;

        const campaignId = entry.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaign') as KankaApiId | undefined;
        if (!campaignId) return;

        scheduleCampaignReconcile(campaignId);
    });

    Hooks.on('updateJournalEntryPage', (page: JournalEntryPage) => {
        const parent = page.parent;
        if (!(parent instanceof JournalEntry) || !isCampaignDescriptionEntry(parent)) return;

        const campaignId = parent.getFlag(CAMPAIGN_FLAG_SCOPE, 'campaign') as KankaApiId | undefined;
        if (!campaignId) return;

        scheduleCampaignReconcile(campaignId);
    });
}
