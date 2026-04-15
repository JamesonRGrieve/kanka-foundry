import api from '../api';
import type { KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';

/**
 * Sync an actor's prototype token from a dedicated token image.
 *
 * Priority:
 *   1. Kanka entity asset named "token" (dedicated token image)
 *   2. Actor portrait (fallback)
 *
 * Downloads the token image locally to avoid CORS issues,
 * then sets it as the prototype token texture.
 */
export async function syncTokenImage(
    actor: Actor,
    campaignId: KankaApiId,
    kankaEntityId: KankaApiEntityId,
    force = false,
): Promise<void> {
    const proto = (actor as unknown as {
        prototypeToken?: { texture?: { src?: string } };
    }).prototypeToken;

    const currentToken = proto?.texture?.src;
    const isDefault = !currentToken
        || currentToken === 'icons/svg/mystery-man.svg'
        || currentToken === '';
    const wasAutoSet = (actor as unknown as { flags?: Record<string, Record<string, unknown>> }).flags?.['kanka-foundry']?.tokenAutoSync as boolean | undefined;

    if (!force && !isDefault && !wasAutoSet) return;

    // Check Kanka entity assets for a "token" file
    let tokenUrl: string | null = null;
    try {
        const assets = await api.getEntityAssets(campaignId, kankaEntityId);
        const tokenAsset = assets.find((a) => a.name === 'token' && a._file);
        if (tokenAsset?._url) {
            tokenUrl = tokenAsset._url;
        }
    } catch (error) {
        logError(`Failed to fetch entity assets for ${actor.name}`, error);
    }

    // Determine the image to use for the token
    // Kanka asset URL is the source of truth — use directly, no local download
    const tokenSource = tokenUrl || actor.img;
    if (!tokenSource || tokenSource === 'icons/svg/mystery-man.svg') return;

    // Skip if already set to this source
    if (currentToken === tokenSource) return;

    await actor.update({
        'prototypeToken.texture.src': tokenSource,
    } as Record<string, unknown>);

    await (actor as unknown as { setFlag(scope: string, key: string, value: unknown): Promise<void> }).setFlag('kanka-foundry', 'tokenAutoSync', true);

    logInfo(`Token synced for ${actor.name}${tokenUrl ? ' (from Kanka asset)' : ' (from portrait)'}`);
}
