import moduleConfig from '../../../public/module.json';
import api from '../../api';
import AccessToken from '../../api/AccessToken';
import ConflictResolverApplication from '../../apps/ConflictResolver/ConflictResolverApplication';
import DefaultPageSheet from '../../apps/KankaJournal/DefaultPageSheet';
import KankaJournalApplication from '../../apps/KankaJournal/KankaJournalApplication';
import PostPageSheet from '../../apps/KankaJournal/PostPageSheet';
import { KankaPageModel } from '../../apps/KankaJournal/models/KankaPageModel';
import registerHandlebarsHelpers from '../../handlebars/registerHandlebarsHelper';
import { logError } from '../../util/logger';
import { registerActorSheetButtons } from '../actorSheetButton';
import { registerCampaignDescriptionHooks } from '../campaignJournal';
import { bridgeKankaItem } from '../itemBridge';
import { showError, showWarning } from '../notifications';
import { registerSettings } from '../settings';
import { registerSyncBackHooks } from '../syncBack';
import { syncTokenImage } from '../tokenImage';

// eslint-disable-next-line no-restricted-syntax -- boundary: assertion-function parameter, the one sanctioned use of `unknown`
function assertType<T>(_value: unknown): asserts _value is T {}

function setToken(token: string): void {
    if (!token) {
        api.reset();
        return;
    }

    try {
        const accessToken = new AccessToken(token);

        if (accessToken.isExpired()) {
            api.reset();
            showError('settings.error.ErrorTokenExpired');
            return;
        }

        // Token is less than a week from expiration
        if (accessToken.isExpiredWithin(7 * 24 * 60 * 60)) {
            showWarning('settings.error.WarningTokenExpiration');
        }

        api.switchUser(accessToken);
    } catch (error) {
        logError('Error setting a token', error);
        showError('settings.error.ErrorInvalidAccessToken');
    }
}

function renderDebugElement(): void {
    const debugElement = $('<span class="knk:limit-debug">0 / 0 (0)</span>');
    $('body').append(debugElement);
    api.limiter.onChange((event) => {
        debugElement.text(`${event.usedSlots} / ${event.maxSlots} (${event.queue})`);
    });
}

export default function init(): void {
    try {
        const pageTypes = Object.keys(moduleConfig.documentTypes.JournalEntryPage).map((type) => `${moduleConfig.id}.${type}`);
        const dataModelTypes = pageTypes.filter((type) => ![`${moduleConfig.id}.post`].includes(type));

        Object.assign(
            CONFIG.JournalEntryPage.dataModels,
            dataModelTypes.reduce<Record<string, typeof KankaPageModel>>((config, type) => {
                config[type] = KankaPageModel;
                return config;
            }, {}),
        );

        const SheetConfig = foundry.applications.apps.DocumentSheetConfig;

        SheetConfig.registerSheet(JournalEntry, moduleConfig.name, KankaJournalApplication, { makeDefault: false });

        type PageSubType = Parameters<typeof SheetConfig.registerSheet<typeof JournalEntryPage>>[3] extends { types?: readonly (infer T)[] } ? T : never;

        const postTypes: string[] = [`${moduleConfig.id}.post`];
        assertType<PageSubType[]>(postTypes);
        SheetConfig.registerSheet(JournalEntryPage, moduleConfig.name, PostPageSheet, {
            types: postTypes,
            makeDefault: false,
        });

        const defaultTypes: string[] = pageTypes.filter((type) => ![`${moduleConfig.id}.post`].includes(type));
        assertType<PageSubType[]>(defaultTypes);
        SheetConfig.registerSheet(JournalEntryPage, moduleConfig.name, DefaultPageSheet, {
            types: defaultTypes,
            makeDefault: false,
        });

        registerHandlebarsHelpers();
        registerSettings();
        registerSyncBackHooks();
        registerCampaignDescriptionHooks();
        registerActorSheetButtons();

        // Debug output to show current rate limiting
        if (import.meta.env.DEV) {
            renderDebugElement();
        }

        api.switchBaseUrl(game.settings?.get('kanka-foundry', 'baseUrl') ?? '');
        setToken(game.settings?.get('kanka-foundry', 'accessToken') ?? '');

        // The Event Tracker belongs to the wh40k-rpg system now (scene control or
        // game.wh40k.EventTracker.open()); this module only syncs it with Kanka.
        const rawMod = game.modules?.get('kanka-foundry');
        if (rawMod !== undefined) {
            // Public API surface (macros + e2e): the item bridge, callable as
            // game.modules.get('kanka-foundry').api.bridgeKankaItem(entity, campaignId).
            // syncTokenImage is exposed for macros + the token-frame e2e.
            // ConflictResolverApplication is exposed so a GM macro (or the e2e) can
            // reopen the conflict dialog on demand:
            //   new game.modules.get('kanka-foundry').api.ConflictResolverApplication().render(true)
            Reflect.set(rawMod, 'api', { bridgeKankaItem, syncTokenImage, ConflictResolverApplication });
        }
    } catch (error) {
        logError(error);
        showError('general.initializationError');
    }
}
