import type EventTrackerApplication from '../../apps/EventTracker/EventTrackerApplication';
import executeMigrations from '../../executeMigrations';
import localization from '../../state/localization';
import { logError } from '../../util/logger';
import { reconcileCampaignDescriptionJournal } from '../campaignJournal';
import { showError } from '../notifications';
import { reconcileAllActors } from '../syncBack';

function assertType<T>(_value: unknown): asserts _value is T {}

export default async function setup(): Promise<void> {
    try {
        await localization.initialize();
        await localization.setLanguage(game.settings?.get('kanka-foundry', 'importLanguage') ?? game.i18n?.lang ?? 'en');

        if (game.user?.isGM) {
            await executeMigrations();

            // Prefetch event tracker data so it opens instantly
            const rawMod: unknown = game.modules?.get('kanka-foundry');
            const trackerRaw: unknown = rawMod !== null && typeof rawMod === 'object' ? Reflect.get(rawMod, 'eventTracker') : undefined;
            if (trackerRaw !== null && typeof trackerRaw === 'object') {
                assertType<EventTrackerApplication>(trackerRaw);
                trackerRaw.prefetch();
            }

            // Reconcile all Kanka-linked actors (bidirectional field sync)
            await reconcileAllActors();
            await reconcileCampaignDescriptionJournal();
        }
    } catch (error) {
        logError(error);
        showError('general.initializationError');
    }
}
