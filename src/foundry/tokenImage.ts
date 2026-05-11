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
        prototypeToken?: {
            texture?: { src?: string };
            ring?: { enabled?: boolean; subject?: { texture?: string | null } };
        };
    }).prototypeToken;

    const currentToken = proto?.texture?.src;
    const currentRingSubject = proto?.ring?.subject?.texture;
    const isDefault = !currentToken
        || currentToken === 'icons/svg/mystery-man.svg'
        || currentToken === '';
    const wasAutoSet = (actor as unknown as { flags?: Record<string, Record<string, unknown>> }).flags?.['kanka-foundry']?.tokenAutoSync as boolean | undefined;

    if (!force && !isDefault && !wasAutoSet) return;

    // Check Kanka entity assets for a "token" file. We only consult the API to
    // confirm the asset exists; the URL we write into Foundry is the canonical
    // redirect endpoint, NOT the per-upload /storage/<uuid>.<ext> URL. That way
    // when the asset is replaced on Kanka the stored URL keeps resolving
    // without any sync step.
    let tokenUrl: string | null = null;
    try {
        const assets = await api.getEntityAssets(campaignId, kankaEntityId);
        const tokenAsset = assets.find((a) => a.name === 'token' && a._file);
        if (tokenAsset) {
            const base = api.baseUrl.replace(/\/+$/u, '');
            tokenUrl = `${base}/canonical.php?c=${campaignId}&e=${kankaEntityId}&a=token`;
        }
    } catch (error) {
        logError(`Failed to fetch entity assets for ${actor.name}`, error);
    }

    // Determine the image to use for the token
    // Kanka canonical URL is the source of truth — survives asset re-upload.
    const tokenSource = tokenUrl || actor.img;
    if (!tokenSource || tokenSource === 'icons/svg/mystery-man.svg') return;

    // Skip if both fields already match the desired source
    if (currentToken === tokenSource && currentRingSubject === tokenSource) return;

    // Always mirror the same source into ring.subject.texture: with the dynamic
    // token ring enabled, Foundry V13+ renders ring.subject.texture instead of
    // texture.src. If the ring is disabled this field is harmless. Without this,
    // a stale local subject texture (e.g. a leftover portrait file) keeps
    // rendering even though texture.src is correct.
    await actor.update({
        'prototypeToken.texture.src': tokenSource,
        'prototypeToken.ring.subject.texture': tokenSource,
    } as Record<string, unknown>);

    await (actor as unknown as { setFlag(scope: string, key: string, value: unknown): Promise<void> }).setFlag('kanka-foundry', 'tokenAutoSync', true);

    logInfo(`Token synced for ${actor.name}${tokenUrl ? ' (from Kanka asset)' : ' (from portrait)'}`);
}
