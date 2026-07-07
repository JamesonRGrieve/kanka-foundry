import type {
    KankaApiAbility,
    KankaApiAttribute,
    KankaApiCampaign,
    KankaApiCharacter,
    KankaApiCreature,
    KankaApiEntity,
    KankaApiEntityId,
    KankaApiEvent,
    KankaApiFamily,
    KankaApiId,
    KankaApiItem,
    KankaApiJournal,
    KankaApiListResult,
    KankaApiLocation,
    KankaApiMap,
    KankaApiMapMarker,
    KankaApiNote,
    KankaApiOrganisation,
    KankaApiQuest,
    KankaApiQuestElement,
    KankaApiRace,
    KankaApiResult,
    KankaApiTimeline,
    KankaApiTimelineElement,
} from '../types/kanka';
import type AccessToken from './AccessToken';
import KankaFetcher from './KankaFetcher';
import type RateLimiter from './RateLimiter';

export default class KankaApi {
    static defaultURL = 'https://api.kanka.io/1.0';

    readonly #fetcher: KankaFetcher;

    public constructor() {
        this.#fetcher = new KankaFetcher(KankaApi.defaultURL);
    }

    public get isReady(): boolean {
        return Boolean(this.#fetcher.hasToken);
    }

    public get limiter(): RateLimiter {
        return this.#fetcher.limiter;
    }

    public reset(): void {
        this.#fetcher.reset();
    }

    public switchUser(token: AccessToken): void {
        this.reset();
        this.#fetcher.token = token;
    }

    public getToken(): AccessToken | undefined {
        return this.#fetcher.token;
    }

    public switchBaseUrl(baseUrl: string): void {
        this.#fetcher.base = baseUrl || KankaApi.defaultURL;
    }

    public get baseUrl(): string {
        return this.#fetcher.base;
    }

    public async getAllCampaigns(): Promise<KankaApiCampaign[]> {
        return this.fetchFullList<KankaApiCampaign>('campaigns');
    }

    public async getCampaign(id: number): Promise<KankaApiCampaign> {
        type Result = KankaApiResult<KankaApiCampaign>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(id)}`);
        return result.data;
    }

    public async updateCampaign(id: number, data: Record<string, unknown>): Promise<KankaApiCampaign> {
        type Result = KankaApiResult<KankaApiCampaign>;
        const result = await this.#fetcher.patch<Result>(`campaigns/${String(id)}`, data);
        return result.data;
    }

    public async getCharacter(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiCharacter> {
        type Result = KankaApiResult<KankaApiCharacter>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/characters/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllCharacters(campaignId: KankaApiId): Promise<KankaApiCharacter[]> {
        return this.fetchFullList<KankaApiCharacter>(`campaigns/${Number(campaignId)}/characters?related=1`);
    }

    public async getCreature(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiCreature> {
        type Result = KankaApiResult<KankaApiCreature>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/creatures/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllCreatures(campaignId: KankaApiId): Promise<KankaApiCreature[]> {
        return this.fetchFullList<KankaApiCreature>(`campaigns/${Number(campaignId)}/creatures?related=1`);
    }

    public async getAbility(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiAbility> {
        type Result = KankaApiResult<KankaApiAbility>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/abilities/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllAbilities(campaignId: KankaApiId): Promise<KankaApiAbility[]> {
        return this.fetchFullList<KankaApiAbility>(`campaigns/${Number(campaignId)}/abilities?related=1`);
    }

    public async getFamily(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiFamily> {
        type Result = KankaApiResult<KankaApiFamily>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/families/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllFamilies(campaignId: KankaApiId): Promise<KankaApiFamily[]> {
        return this.fetchFullList<KankaApiFamily>(`campaigns/${Number(campaignId)}/families?related=1`);
    }

    public async getItem(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiItem> {
        type Result = KankaApiResult<KankaApiItem>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/items/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllItems(campaignId: KankaApiId): Promise<KankaApiItem[]> {
        return this.fetchFullList<KankaApiItem>(`campaigns/${Number(campaignId)}/items?related=1`);
    }

    public async getJournal(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiJournal> {
        type Result = KankaApiResult<KankaApiJournal>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/journals/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllJournals(campaignId: KankaApiId): Promise<KankaApiJournal[]> {
        return this.fetchFullList<KankaApiJournal>(`campaigns/${Number(campaignId)}/journals?related=1`);
    }

    public async getLocation(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiLocation> {
        type Result = KankaApiResult<KankaApiLocation>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/locations/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllLocations(campaignId: KankaApiId): Promise<KankaApiLocation[]> {
        return this.fetchFullList(`campaigns/${Number(campaignId)}/locations?related=1`);
    }

    public async getAllMaps(campaignId: KankaApiId): Promise<KankaApiMap[]> {
        return this.fetchFullList<KankaApiMap>(`campaigns/${Number(campaignId)}/maps?related=1`);
    }

    public async getMap(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiMap> {
        type Result = KankaApiResult<KankaApiMap>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/maps/${String(id)}?related=1`);
        return result.data;
    }

    public async getMapMarkers(campaignId: KankaApiId, mapId: KankaApiId): Promise<KankaApiMapMarker[]> {
        return this.fetchFullList<KankaApiMapMarker>(`campaigns/${String(campaignId)}/maps/${String(mapId)}/map_markers`);
    }

    public async getNote(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiNote> {
        type Result = KankaApiResult<KankaApiNote>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/notes/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllNotes(campaignId: KankaApiId): Promise<KankaApiNote[]> {
        return this.fetchFullList<KankaApiNote>(`campaigns/${Number(campaignId)}/notes?related=1`);
    }

    public async getOrganisation(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiOrganisation> {
        type Result = KankaApiResult<KankaApiOrganisation>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/organisations/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllOrganisations(campaignId: KankaApiId): Promise<KankaApiOrganisation[]> {
        return this.fetchFullList<KankaApiOrganisation>(`campaigns/${Number(campaignId)}/organisations?related=1`);
    }

    public async getQuest(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiQuest> {
        type Result = KankaApiResult<KankaApiQuest>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/quests/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllQuests(campaignId: KankaApiId): Promise<KankaApiQuest[]> {
        return this.fetchFullList<KankaApiQuest>(`campaigns/${Number(campaignId)}/quests?related=1`);
    }

    public async getRace(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiRace> {
        type Result = KankaApiResult<KankaApiRace>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/races/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllRaces(campaignId: KankaApiId): Promise<KankaApiRace[]> {
        return this.fetchFullList<KankaApiRace>(`campaigns/${Number(campaignId)}/races?related=1`);
    }

    public async getEvent(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiEvent> {
        type Result = KankaApiResult<KankaApiEvent>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/events/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllEvents(campaignId: KankaApiId): Promise<KankaApiEvent[]> {
        return this.fetchFullList<KankaApiEvent>(`campaigns/${Number(campaignId)}/events?related=1`);
    }

    public async getEntity(campaignId: KankaApiId, id: KankaApiEntityId): Promise<KankaApiEntity> {
        type Result = KankaApiResult<KankaApiEntity>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/entities/${String(id)}?image=1`);
        return result.data;
    }

    public async getAllEntities(campaignId: KankaApiId, types: KankaApiEntity['module']['code'][] = []): Promise<KankaApiEntity[]> {
        return this.fetchFullList<KankaApiEntity>(`campaigns/${Number(campaignId)}/entities?image=1&types=${types.join(',')}`);
    }

    // Write methods

    public async updateCharacter(campaignId: KankaApiId, id: KankaApiId, data: Record<string, unknown>): Promise<KankaApiCharacter> {
        type Result = KankaApiResult<KankaApiCharacter>;
        const result = await this.#fetcher.patch<Result>(`campaigns/${String(campaignId)}/characters/${String(id)}`, data);
        return result.data;
    }

    public async createCharacter(campaignId: KankaApiId, data: Record<string, unknown>): Promise<KankaApiCharacter> {
        type Result = KankaApiResult<KankaApiCharacter>;
        const result = await this.#fetcher.post<Result>(`campaigns/${String(campaignId)}/characters`, data);
        return result.data;
    }

    public async updateItem(campaignId: KankaApiId, id: KankaApiId, data: Record<string, unknown>): Promise<KankaApiItem> {
        type Result = KankaApiResult<KankaApiItem>;
        const result = await this.#fetcher.patch<Result>(`campaigns/${String(campaignId)}/items/${String(id)}`, data);
        return result.data;
    }

    public async updateQuest(campaignId: KankaApiId, id: KankaApiId, data: Record<string, unknown>): Promise<KankaApiQuest> {
        type Result = KankaApiResult<KankaApiQuest>;
        const result = await this.#fetcher.patch<Result>(`campaigns/${String(campaignId)}/quests/${String(id)}`, data);
        return result.data;
    }

    // Entity attribute methods

    public async getEntityAttributes(campaignId: KankaApiId, entityId: KankaApiEntityId): Promise<KankaApiAttribute[]> {
        type Result = KankaApiResult<KankaApiAttribute[]>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/entities/${String(entityId)}/attributes`);
        return result.data;
    }

    public async createEntityAttribute(
        campaignId: KankaApiId,
        entityId: KankaApiEntityId,
        data: { name: string; value: string; type_id?: number },
    ): Promise<KankaApiAttribute> {
        type Result = KankaApiResult<KankaApiAttribute>;
        const result = await this.#fetcher.post<Result>(`campaigns/${String(campaignId)}/entities/${String(entityId)}/attributes`, data);
        return result.data;
    }

    // Quest element methods

    public async getQuestElements(campaignId: KankaApiId, questId: KankaApiId): Promise<KankaApiQuestElement[]> {
        return this.fetchFullList<KankaApiQuestElement>(`campaigns/${String(campaignId)}/quests/${String(questId)}/quest_elements`);
    }

    public async patchQuestElement(
        campaignId: KankaApiId,
        questId: KankaApiId,
        elementId: KankaApiId,
        data: Partial<Pick<KankaApiQuestElement, 'colour' | 'name'>>,
    ): Promise<KankaApiQuestElement> {
        type Result = KankaApiResult<KankaApiQuestElement>;
        const result = await this.#fetcher.patch<Result>(`campaigns/${String(campaignId)}/quests/${String(questId)}/quest_elements/${String(elementId)}`, data);
        return result.data;
    }

    // Timeline methods

    public async getTimeline(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiTimeline> {
        type Result = KankaApiResult<KankaApiTimeline>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/timelines/${String(id)}?related=1`);
        return result.data;
    }

    public async getAllTimelines(campaignId: KankaApiId): Promise<KankaApiTimeline[]> {
        return this.fetchFullList<KankaApiTimeline>(`campaigns/${Number(campaignId)}/timelines?related=1`);
    }

    public async getTimelineElements(campaignId: KankaApiId, timelineId: KankaApiId): Promise<KankaApiTimelineElement[]> {
        return this.fetchFullList<KankaApiTimelineElement>(`campaigns/${String(campaignId)}/timelines/${String(timelineId)}/timeline_elements`);
    }

    public async patchTimelineElement(
        campaignId: KankaApiId,
        timelineId: KankaApiId,
        elementId: KankaApiId,
        data: Partial<Pick<KankaApiTimelineElement, 'colour' | 'name'>>,
    ): Promise<KankaApiTimelineElement> {
        type Result = KankaApiResult<KankaApiTimelineElement>;
        const result = await this.#fetcher.patch<Result>(
            `campaigns/${String(campaignId)}/timelines/${String(timelineId)}/timeline_elements/${String(elementId)}`,
            data,
        );
        return result.data;
    }

    public async updateEntityAttribute(
        campaignId: KankaApiId,
        entityId: KankaApiEntityId,
        attributeId: KankaApiId,
        data: { value: string },
    ): Promise<KankaApiAttribute> {
        type Result = KankaApiResult<KankaApiAttribute>;
        const result = await this.#fetcher.patch<Result>(
            `campaigns/${String(campaignId)}/entities/${String(entityId)}/attributes/${String(attributeId)}`,
            data,
        );
        return result.data;
    }

    public async uploadEntityImage(campaignId: KankaApiId, entityId: KankaApiEntityId, imageBlob: Blob): Promise<void> {
        type Result = KankaApiResult<unknown>;
        await this.#fetcher.uploadFile<Result>(`campaigns/${String(campaignId)}/entities/${String(entityId)}/image`, imageBlob, 'file');
    }

    public async getEntityAssets(
        campaignId: KankaApiId,
        entityId: KankaApiEntityId,
    ): Promise<Array<{ id: number; name: string; _url?: string; _file?: boolean; type_id?: number }>> {
        type Asset = { id: number; name: string; _url?: string; _file?: boolean; type_id?: number };
        type Result = KankaApiResult<Asset[]>;
        const result = await this.#fetcher.fetch<Result>(`campaigns/${String(campaignId)}/entities/${String(entityId)}/entity_assets`);
        return result.data;
    }

    private async fetchFullList<T>(path: string): Promise<T[]> {
        const data: T[] = [];
        let url: string | null = path;
        const query = new URL(`https://${path}`).searchParams;

        while (url) {
            const result: KankaApiListResult<T> = await this.#fetcher.fetch<KankaApiListResult<T>>(url);
            data.push(...result.data);
            if (!result.links.next) break;

            const nextPage: URL = new URL(result.links.next);
            for (const [key, value] of query.entries()) {
                nextPage.searchParams.append(key, value);
            }
            url = nextPage.href;
        }

        return data;
    }
}
