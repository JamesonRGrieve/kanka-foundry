import type EventTrackerApplication from '../../apps/EventTracker/EventTrackerApplication';
import executeMigrations from '../../executeMigrations';
import localization from '../../state/localization';
import { logError } from '../../util/logger';
import { showError } from '../notifications';
import { reconcileAllActors } from '../syncBack';

export default async function setup(): Promise<void> {
    try {
        await localization.initialize();
        await localization.setLanguage(game.settings?.get('kanka-foundry', 'importLanguage') ?? game.i18n?.lang ?? 'en');

        if (game.user?.isGM) {
            await executeMigrations();

            // Prefetch event tracker data so it opens instantly
            const mod = game.modules?.get('kanka-foundry') as unknown as Record<string, unknown> | undefined;
            const tracker = mod?.eventTracker as EventTrackerApplication | undefined;
            if (tracker) {
                tracker.prefetch();
            }

            // Reconcile all Kanka-linked actors (bidirectional field sync)
            await reconcileAllActors();
        }
    } catch (error) {
        logError(error);
        showError('general.initializationError');
    }
}
