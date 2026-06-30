import api from '../../api';
import AccessToken from '../../api/AccessToken';
import ConflictResolverApplication from '../../apps/ConflictResolver/ConflictResolverApplication';
import type EventTrackerApplication from '../../apps/EventTracker/EventTrackerApplication';
import executeMigrations from '../../executeMigrations';
import localization from '../../state/localization';
import { logError } from '../../util/logger';
import { reconcileCampaignDescriptionJournal } from '../campaignJournal';
import { revalidateConflicts } from '../conflicts/resolveConflicts';
import { showError } from '../notifications';
import { reconcileAllActors } from '../syncBack';

function assertType<T>(_value: unknown): asserts _value is T {}

export default async function setup(): Promise<void> {
    try {
        await localization.initialize();
        await localization.setLanguage(game.settings?.get('kanka-foundry', 'importLanguage') ?? game.i18n?.lang ?? 'en');

        // accessToken is a client-scope setting; game.user isn't resolved during the
        // init hook, so the load in init.ts reads the default empty string. Re-read
        // here, where the user (and their localStorage settings) is fully available.
        if (!api.isReady) {
            const token = game.settings?.get('kanka-foundry', 'accessToken') ?? '';
            if (token) {
                try {
                    const accessToken = new AccessToken(token);
                    if (!accessToken.isExpired()) {
                        api.switchUser(accessToken);
                    }
                } catch (err) {
                    logError('Failed to load access token in ready hook', err);
                }
            }
        }

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

            // Surface any genuine two-sided conflicts for GM resolution. Drop
            // stale entries first so the popup only shows live divergences.
            const pendingConflicts = await revalidateConflicts();
            if (pendingConflicts.length > 0) {
                await new ConflictResolverApplication().render({ force: true });
            }
        }
    } catch (error) {
        logError(error);
        showError('general.initializationError');
    }
}
