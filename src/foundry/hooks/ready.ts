import api from '../../api';
import AccessToken from '../../api/AccessToken';
import ConflictResolverApplication from '../../apps/ConflictResolver/ConflictResolverApplication';
import executeMigrations from '../../executeMigrations';
import localization from '../../state/localization';
import { logError } from '../../util/logger';
import { reconcileCampaignDescriptionJournal } from '../campaignJournal';
import { revalidateConflicts } from '../conflicts/resolveConflicts';
import { startEventTrackerSync } from '../eventTrackerSync';
import { showError } from '../notifications';
import { reconcileAllActors } from '../syncBack';

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

        if (game.user?.isGM === true) {
            await executeMigrations();

            // Sync the wh40k-rpg Event Tracker with Kanka in the background: the
            // pull is one request per NPC and must not hold up actor reconciliation.
            // It logs its own failures and never rejects.
            void startEventTrackerSync();

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
