import api from '../api';
import type { KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
function assertType<T>(_value: unknown): asserts _value is T {}

interface ProtoToken {
    texture?: { src?: string };
    ring?: { enabled?: boolean; subject?: { texture?: string | null } };
}

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
export async function syncTokenImage(actor: Actor, campaignId: KankaApiId, kankaEntityId: KankaApiEntityId, force = false): Promise<void> {
    const actorRaw: unknown = actor;
    const protoRaw: unknown = actorRaw !== null && typeof actorRaw === 'object' ? Reflect.get(actorRaw, 'prototypeToken') : undefined;
    let proto: ProtoToken | undefined;
    if (protoRaw !== null && typeof protoRaw === 'object') {
        assertType<ProtoToken>(protoRaw);
        proto = protoRaw;
    }

    const currentToken = proto?.texture?.src;
    const currentRingSubject = proto?.ring?.subject?.texture;
    const isDefault = !currentToken || currentToken === 'icons/svg/mystery-man.svg' || currentToken === '';
    const flagsRaw: unknown = actorRaw !== null && typeof actorRaw === 'object' ? Reflect.get(actorRaw, 'flags') : undefined;
    const kankaFlags: unknown = flagsRaw !== null && typeof flagsRaw === 'object' ? Reflect.get(flagsRaw, 'kanka-foundry') : undefined;
    const wasAutoSet: boolean | undefined =
        kankaFlags !== null && typeof kankaFlags === 'object' ? (Reflect.get(kankaFlags, 'tokenAutoSync') as boolean | undefined) : undefined;

    if (!force && !isDefault && !wasAutoSet) return;

    // Check Kanka entity assets for a "token" file. We only consult the API to
    // confirm the asset exists; the URL we write into Foundry is the canonical
    // redirect endpoint, NOT the per-upload /storage/<uuid>.<ext> URL. That way
    // when the asset is replaced on Kanka the stored URL keeps resolving
    // without any sync step.
    //
    // The pretty `/c/<campaign>/e/<entity>/<asset>.png` form is an Apache
    // rewrite to canonical.php — the `.png` is a fake extension that satisfies
    // Foundry V14's SchemaField validator (it rejects URLs without a known
    // image extension on the path). canonical.php still 302s to the real
    // /storage/<uuid>.<ext>, so the served file's content-type is correct
    // regardless of what we name the URL.
    let tokenUrl: string | null = null;
    try {
        const assets = await api.getEntityAssets(campaignId, kankaEntityId);
        const tokenAsset = assets.find((a) => a.name === 'token' && a._file);
        if (tokenAsset) {
            // canonical.php is served from the site root, not the /1.0/ API prefix
            // that api.baseUrl carries. Strip down to scheme + host so the URL
            // matches the Apache rewrite at /c/<c>/e/<e>/<a>.png.
            const u = new URL(api.baseUrl);
            tokenUrl = `${u.protocol}//${u.host}/c/${campaignId}/e/${kankaEntityId}/token.png`;
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

    const setFlagRaw: unknown = Reflect.get(actor, 'setFlag');
    if (typeof setFlagRaw === 'function') {
        assertType<(scope: string, key: string, value: unknown) => Promise<void>>(setFlagRaw);
        await setFlagRaw.call(actor, 'kanka-foundry', 'tokenAutoSync', true);
    }

    logInfo(`Token synced for ${actor.name}${tokenUrl ? ' (from Kanka asset)' : ' (from portrait)'}`);
}
