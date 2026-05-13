import api from '../../api';
import NotAuthenticatedError from '../../api/NotAuthenticatedError';

function assertType<T>(_value: unknown): asserts _value is T {}

import { findEntryByEntityId, hasOutdatedEntryByEntity } from '../../foundry/journalEntries';
import { showError } from '../../foundry/notifications';
import type { KankaSettings } from '../../foundry/settings';
import { createEntities, createEntity, updateEntity } from '../../syncEntities';
import EntityType from '../../types/EntityType';
import type { KankaApiCampaign, KankaApiEntity } from '../../types/kanka';
import groupBy from '../../util/groupBy';
import { logError } from '../../util/logger';
import campaignTemplate from './templates/campaign.hbs';
import entitiesTemplate from './templates/entities.hbs';
import loadingTemplate from './templates/loading.hbs';
import entityGridPartial from './templates/partials/entity-grid.hbs';
import entityListPartial from './templates/partials/entity-list.hbs';
import searchTemplate from './templates/search.hbs';

import ApplicationV2 = foundry.applications.api.ApplicationV2;
import HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

import type { DeepPartial } from 'fvtt-types/utils';

const entityTypes: Partial<Record<EntityType, { icon: string }>> = {
    [EntityType.ability]: {
        icon: 'fa-fire',
    },
    [EntityType.character]: {
        icon: 'fa-user',
    },
    [EntityType.creature]: {
        icon: 'fa-deer',
    },
    [EntityType.event]: {
        icon: 'fa-bolt',
    },
    [EntityType.family]: {
        icon: 'fa-users',
    },
    [EntityType.item]: {
        icon: 'fa-crown',
    },
    [EntityType.journal]: {
        icon: 'fa-feather-alt',
    },
    [EntityType.location]: {
        icon: 'fa-chess-rook',
    },
    [EntityType.note]: {
        icon: 'fa-book-open',
    },
    [EntityType.organisation]: {
        icon: 'fa-theater-masks',
    },
    [EntityType.quest]: {
        icon: 'fa-map-signs',
    },
    [EntityType.race]: {
        icon: 'fa-dragon',
    },
};

type RenderContext = ApplicationV2.RenderContext &
    Partial<{
        isLoading: boolean;
        allCampaigns: Record<string, string>;
        campaign: KankaApiCampaign | null;
        entities: KankaApiEntity[] | null;
        showPrivate: KankaSettings['importPrivateEntities'];
        view: KankaSettings['browserView'];
        listPartial: string;
        gridPartial: string;
        type: string;
        icon: string;
        isOpen: boolean;
        count: number;
        countLinked: number;
    }>;

export default class KankaBrowserApplication extends HandlebarsApplicationMixin(ApplicationV2<RenderContext>) {
    #search = '';
    #entities: KankaApiEntity[] | null = null;
    #allCampaigns: KankaApiCampaign[] | null = null;
    #campaign: KankaApiCampaign | null = null;
    readonly #hooks: Partial<Record<Hooks.HookName, number>> = {};
    #isLoading = false;

    static override DEFAULT_OPTIONS: DeepPartial<ApplicationV2.Configuration> = {
        id: 'kanka-browser',
        classes: ['kanka-browser'],
        window: {
            title: 'KANKA.browser.title',
            resizable: true,
            contentClasses: ['knk:overflow-auto', 'knk:m-0'],
            controls: [
                {
                    icon: 'fa-solid fa-list',
                    label: 'KANKA.browser.action.viewList',
                    action: 'viewList',
                },
                {
                    icon: 'fa-solid fa-th-large',
                    label: 'KANKA.browser.action.viewGrid',
                    action: 'viewGrid',
                },
                {
                    icon: 'fa-solid fa-rotate-right',
                    label: 'KANKA.browser.action.reload',
                    action: 'reload',
                },
            ],
        },
        position: {
            height: 'auto',
            width: 720,
        },
        actions: {
            reload: KankaBrowserApplication.reload,
            viewGrid: KankaBrowserApplication.viewGrid,
            viewList: KankaBrowserApplication.viewList,
            openInKanka: KankaBrowserApplication.openInKanka,
            openInFoundry: KankaBrowserApplication.openInFoundry,
            updateSingle: KankaBrowserApplication.updateSingle,
            linkAll: KankaBrowserApplication.linkAll,
            updateOutdated: KankaBrowserApplication.updateOutdated,
        },
    };

    static override PARTS: Record<string, HandlebarsApplicationMixin.HandlebarsTemplatePart> = {
        loading: {
            template: loadingTemplate,
        },
        campaign: {
            template: campaignTemplate,
        },
        search: {
            template: searchTemplate,
        },
        ...Object.keys(entityTypes).reduce<Record<string, HandlebarsApplicationMixin.HandlebarsTemplatePart>>((acc, type) => {
            acc[type] = {
                template: entitiesTemplate,
                templates: [entitiesTemplate, entityListPartial, entityGridPartial],
            };
            return acc;
        }, {}),
    };

    static async reload(this: KankaBrowserApplication) {
        this.setupData();
        this.render();
    }

    static async viewGrid(this: KankaBrowserApplication) {
        await game.settings?.set('kanka-foundry', 'browserView', 'grid');
        this.render({ parts: Object.keys(entityTypes) });
    }

    static async viewList(this: KankaBrowserApplication) {
        await game.settings?.set('kanka-foundry', 'browserView', 'list');
        this.render({ parts: Object.keys(entityTypes) });
    }

    static async openInKanka(this: KankaBrowserApplication, _event: PointerEvent, target: HTMLElement) {
        try {
            if (!this.#campaign) return;

            const type = target.closest<HTMLElement>('[data-application-part]')?.dataset['applicationPart'];
            const rawId = target.closest<HTMLElement>('[data-entity-id]')?.dataset['entityId'];
            const id = rawId ? Number.parseInt(rawId, 10) : null;
            let url = this.#campaign.urls.view;

            if (id) {
                const entity = this.#entities?.find((e) => e.type === type && e.id === id);
                url = entity?.urls.view ?? url;
            } else if (type && type in entityTypes) {
                url = `${url}/${type.replace(/y$/, 'ie')}s`;
            }

            if (url) {
                window.open(url, '_blank');
            } else {
                logError('Could not find a matching Kanka URL', { type, url });
            }
        } catch (error) {
            logError(error);
            showError('browser.error.actionError');
        } finally {
            this.render();
        }
    }

    static async openInFoundry(this: KankaBrowserApplication, _event: PointerEvent, target: HTMLElement) {
        try {
            const rawId = target.closest<HTMLElement>('[data-entity-id]')?.dataset['entityId'];
            const id = rawId ? Number.parseInt(rawId, 10) : null;

            if (!id) return;

            const sheet = findEntryByEntityId(id)?.sheet;
            sheet?.render(true);
            sheet?.maximize();
        } catch (error) {
            logError(error);
            showError('browser.error.actionError');
        } finally {
            this.render();
        }
    }

    static async updateSingle(this: KankaBrowserApplication, _event: PointerEvent, target: HTMLElement) {
        try {
            if (!this.#campaign || !this.#entities) return;

            const rawId = target.closest<HTMLElement>('[data-entity-id]')?.dataset['entityId'];
            const id = rawId ? Number.parseInt(rawId, 10) : null;

            if (!id) return;

            const btn: unknown = target;
            assertType<HTMLButtonElement>(btn);
            this.setLoadingState(btn);

            const entry = findEntryByEntityId(id);
            if (entry) {
                await updateEntity(entry, this.#entities);
            } else {
                const entity = this.#entities?.find((e) => e.id === id);
                if (entity) {
                    await createEntity(this.#campaign.id, entity.module.code, entity.child_id, this.#entities);
                }
            }
        } catch (error) {
            logError(error);
            showError('browser.error.actionError');
        } finally {
            this.render();
        }
    }

    static async linkAll(this: KankaBrowserApplication, _event: PointerEvent, target: HTMLElement) {
        try {
            if (!this.#campaign || !this.#entities) return;

            const typeRaw = target.closest<HTMLElement>('[data-application-part]')?.dataset['applicationPart'];
            let type: EntityType | undefined;
            if (typeRaw !== undefined) {
                assertType<EntityType>(typeRaw);
                type = typeRaw;
            }
            if (!type || !(type in entityTypes)) type = undefined;

            const unlinkedEntities = this.getEntities(type).filter((entity) => !findEntryByEntityId(entity.id));
            const grouped = groupBy(unlinkedEntities, 'module.code');

            const btn: unknown = target;
            assertType<HTMLButtonElement>(btn);
            this.setLoadingState(btn);

            for (const [syncType, entities] of grouped) {
                try {
                    await createEntities(
                        this.#campaign.id,
                        syncType,
                        entities.map((e) => e.child_id),
                        this.#entities,
                    );
                } catch (error) {
                    logError(`Failed to sync entities of type ${syncType}`, error);
                    showError('browser.error.actionError');
                }
            }
        } catch (error) {
            logError(error);
            showError('browser.error.actionError');
        } finally {
            this.render();
        }
    }

    static async updateOutdated(this: KankaBrowserApplication, _event: PointerEvent, target: HTMLElement) {
        try {
            if (!this.#campaign || !this.#entities) return;

            const typeRaw = target.closest<HTMLElement>('[data-application-part]')?.dataset['applicationPart'];
            let type: EntityType | undefined;
            if (typeRaw !== undefined) {
                assertType<EntityType>(typeRaw);
                type = typeRaw;
            }
            if (!type || !(type in entityTypes)) type = undefined;

            const outdatedEntries = this.getEntities(type)
                .filter((entity) => hasOutdatedEntryByEntity(entity))
                .map((entity) => findEntryByEntityId(entity.id))
                .filter((entry): entry is JournalEntry => !!entry);

            const btn: unknown = target;
            assertType<HTMLButtonElement>(btn);
            this.setLoadingState(btn);
            await Promise.all(outdatedEntries.map(async (entry) => updateEntity(entry, this.#entities ?? [])));
        } catch (error) {
            logError(error);
            showError('browser.error.actionError');
        } finally {
            this.render();
        }
    }

    protected getEntities(type?: EntityType) {
        if (!this.#entities) return [];

        return this.#entities
            .filter((e) => e.name.toLowerCase().includes(this.#search.toLowerCase()) && (!type || e.module.code === type))
            .map((entity) => {
                const isOutdated = hasOutdatedEntryByEntity(entity);
                return {
                    ...entity,
                    state: {
                        isOutdated,
                        isPrivate: entity.is_private && !isOutdated,
                        isLinked: Boolean(findEntryByEntityId(entity.id)),
                    },
                };
            })
            .toSorted((a, b) => a.name.localeCompare(b.name));
    }

    protected setLoadingState(button: HTMLButtonElement): void {
        button.classList.add('-knk:loading-indicator');
        for (const el of this.element.querySelectorAll('.window-content [data-action]')) {
            el.setAttribute('disabled', 'true');
        }
    }

    protected async loadEntities(campaignId: number): Promise<KankaApiEntity[]> {
        const entities = await api.getAllEntities(campaignId, [
            'ability',
            'calendar',
            'character',
            'creature',
            'location',
            'race',
            'organisation',
            'family',
            'item',
            'journal',
            'note',
            'quest',
            'event',
        ]);

        return entities?.filter((entity) => {
            if (!game.settings?.get('kanka-foundry', 'importTemplateEntities') && entity.is_template) {
                return false;
            }

            if (!game.settings?.get('kanka-foundry', 'importPrivateEntities') && entity.is_private) {
                return false;
            }

            return true;
        });
    }

    protected async loadDataForCampaign(campaignId?: number) {
        if (!campaignId) return { campaign: null, entities: null };

        const [campaign, entities] = await Promise.all([api.getCampaign(campaignId), this.loadEntities(campaignId)]);

        return { campaign, entities };
    }

    protected setupData(this: KankaBrowserApplication): void {
        if (this.#isLoading) return;

        const rawId = game.settings?.get('kanka-foundry', 'campaign');
        const campaignId = rawId ? Number.parseInt(rawId, 10) : undefined;

        this.#allCampaigns = null;
        this.#campaign = null;
        this.#entities = null;
        this.#isLoading = true;

        Promise.all([api.getAllCampaigns(), this.loadDataForCampaign(campaignId)])
            .then(([allCampaigns, { campaign, entities }]) => {
                this.#allCampaigns = allCampaigns;
                this.#campaign = campaign;
                this.#entities = entities;
                this.#isLoading = false;
                this.render({ force: true });
            })
            .catch((error: unknown) => {
                this.#isLoading = false;
                logError(error);
                if (error instanceof NotAuthenticatedError) {
                    showError('settings.error.ErrorInvalidAccessToken');
                } else {
                    showError('browser.error.loadEntity');
                }
                this.close();
            });
    }

    override async _preFirstRender(
        this: KankaBrowserApplication,
        context: DeepPartial<ApplicationV2.RenderContext>,
        options: DeepPartial<ApplicationV2.RenderOptions>,
    ): Promise<void> {
        this.#hooks.deleteJournalEntry = Hooks.on('deleteJournalEntry', async (_entry: JournalEntry) => this.render());
        await super._preFirstRender(context, options);
        this.setupData();
    }

    override async _preClose() {
        for (const [hookRaw, id] of Object.entries(this.#hooks)) {
            if (id !== undefined) {
                assertType<Hooks.HookName>(hookRaw);
                Hooks.off(hookRaw, id);
            }
        }
    }

    override async _prepareContext() {
        return {
            isLoading: this.#isLoading,
            allCampaigns: (this.#allCampaigns ?? []).reduce<Record<string, string>>(
                (choices, { id, name }) => {
                    choices[String(id)] = name;
                    return choices;
                },
                {
                    0: '-- Please choose --',
                },
            ),
            campaign: this.#campaign,
            entities: [],
            showPrivate: game.settings?.get('kanka-foundry', 'importPrivateEntities') ?? false,
            view: game.settings?.get('kanka-foundry', 'browserView') ?? 'list',
            listPartial: entityListPartial,
            gridPartial: entityGridPartial,
        };
    }

    override async _preparePartContext(
        partId: string,
        context: foundry.applications.api.ApplicationV2.RenderContextOf<this>,
        _options: DeepPartial<foundry.applications.api.HandlebarsApplicationMixin.RenderOptions>,
    ): Promise<foundry.applications.api.ApplicationV2.RenderContextOf<this>> {
        if (partId in entityTypes) {
            assertType<EntityType>(partId);
            const entities = this.getEntities(partId);

            return {
                ...context,
                type: partId,
                icon: entityTypes[partId]?.icon,
                isOpen: !!this.#search || game.settings?.get('kanka-foundry', `collapseType_${partId}`),
                entities: entities,
                count: entities.length,
                countLinked: entities.filter((e) => !!findEntryByEntityId(e.id)).length,
            };
        }

        return context;
    }

    protected override _attachPartListeners(partId: string, htmlElement: HTMLElement) {
        if (partId === 'search') {
            const searchInput = htmlElement.querySelector<HTMLInputElement>('#knk-entity-search');
            searchInput?.addEventListener(
                'input',
                foundry.utils.debounce(() => {
                    this.#search = searchInput.value;
                    this.render({ parts: Object.keys(entityTypes) });
                }, 300),
            );
        }

        if (partId === 'campaign') {
            htmlElement.querySelector<HTMLSelectElement>('#knk-campaign-select')?.addEventListener('change', async (event) => {
                const targetRaw: unknown = event.currentTarget;
                if (targetRaw === null || typeof targetRaw !== 'object' || !('value' in targetRaw)) return;
                assertType<HTMLSelectElement>(targetRaw);
                const campaignId = targetRaw.value === '0' ? '' : targetRaw.value;
                await game.settings?.set('kanka-foundry', 'campaign', campaignId);
                this.setupData();
                this.render();
            });
        }

        if (partId in entityTypes) {
            assertType<EntityType>(partId);
            const detailsRaw: unknown = htmlElement;
            assertType<HTMLDetailsElement>(detailsRaw);
            detailsRaw.addEventListener('toggle', async (event) => {
                const targetRaw2: unknown = event.currentTarget;
                if (targetRaw2 === null || typeof targetRaw2 !== 'object' || !('dataset' in targetRaw2)) return;
                assertType<HTMLDetailsElement>(targetRaw2);
                const typeRaw2 = targetRaw2.dataset['applicationPart'];
                if (typeRaw2 === undefined) return;
                assertType<EntityType>(typeRaw2);
                const type: EntityType = typeRaw2;
                if (!(type in entityTypes) || this.#search) return;
                await game.settings?.set('kanka-foundry', `collapseType_${type}`, targetRaw2.open);
            });
        }
    }
}

if (import.meta.hot) {
    import.meta.hot.accept((newModuleRaw) => {
        const newModule: unknown = newModuleRaw;
        if (newModule === null || typeof newModule !== 'object') return;
        const defaultExport: unknown = Reflect.get(newModule, 'default');
        if (typeof defaultExport !== 'function') return;
        assertType<new () => { render(opts: { force: boolean }): void }>(defaultExport);
        const browserApplication = new defaultExport();
        browserApplication.render({ force: true });
    });

    import.meta.hot.dispose((data: Record<string, unknown>) => {
        const uiRaw: unknown = ui;
        if (uiRaw === null || typeof uiRaw !== 'object') return;
        const activeWindow: unknown = Reflect.get(uiRaw, 'activeWindow');
        if (activeWindow instanceof KankaBrowserApplication) {
            data['position'] = activeWindow.position;
            activeWindow.close();
        }
    });
}
