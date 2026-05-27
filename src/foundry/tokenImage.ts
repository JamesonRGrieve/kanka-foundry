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
function findPlayerRingDefaults(): Record<string, unknown> | null {
    const actorsRaw: unknown = Reflect.get(game, 'actors');
    if (actorsRaw === null || actorsRaw === undefined) return null;
    assertType<Actors>(actorsRaw);
    for (const a of actorsRaw) {
        if (a === null || typeof a !== 'object') continue;
        const type: unknown = Reflect.get(a, 'type');
        if (typeof type !== 'string' || !type.endsWith('-character')) continue;
        const proto: unknown = Reflect.get(a, 'prototypeToken');
        if (proto === null || typeof proto !== 'object') continue;
        const ring: unknown = Reflect.get(proto, 'ring');
        if (ring === null || typeof ring !== 'object') continue;
        const ringEnabled: unknown = Reflect.get(ring, 'enabled');
        if (ringEnabled !== true) continue;
        const patch: Record<string, unknown> = {};
        const colors: unknown = Reflect.get(ring, 'colors');
        if (colors !== null && typeof colors === 'object') {
            for (const key of ['ring', 'background'] as const) {
                const v: unknown = Reflect.get(colors, key);
                if (v !== undefined && v !== null) {
                    patch[`prototypeToken.ring.colors.${key}`] = v;
                }
            }
        }
        const effects: unknown = Reflect.get(ring, 'effects');
        if (typeof effects === 'number') {
            patch['prototypeToken.ring.effects'] = effects;
        }
        const subject: unknown = Reflect.get(ring, 'subject');
        if (subject !== null && typeof subject === 'object') {
            const scale: unknown = Reflect.get(subject, 'scale');
            if (typeof scale === 'number') {
                patch['prototypeToken.ring.subject.scale'] = scale;
            }
        }
        return patch;
    }
    return null;
}

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
    // HEAD-probe the canonical rewrite directly instead of listing assets via
    // /entity_assets. The listing endpoint 500s for the whole entity if any
    // single asset row has a stale type_id (Kanka backend enum bug), which
    // would otherwise crash this sync for every entity that has one bad row.
    // The canonical URL is the source of truth either way.
    try {
        const u = new URL(api.baseUrl);
        const candidate = `${u.protocol}//${u.host}/c/${campaignId}/e/${kankaEntityId}/token.png`;
        const probe = await fetch(candidate, { method: 'HEAD' });
        if (probe.ok) {
            tokenUrl = candidate;
        }
    } catch (error) {
        logError(`Failed to probe token URL for ${actor.name}`, error);
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
    const patch: Record<string, unknown> = {
        'prototypeToken.texture.src': tokenSource,
        'prototypeToken.sight.enabled': true,
        'prototypeToken.ring.enabled': true,
        'prototypeToken.ring.subject.texture': tokenSource,
    };
    // NPCs default to hidden nameplates (no free hover-ID for players);
    // PCs are left alone so the GM/players keep whatever they've set.
    const actorTypeRaw: unknown = Reflect.get(actor as object, 'type');
    if (typeof actorTypeRaw === 'string' && actorTypeRaw.endsWith('-npc')) {
        patch['prototypeToken.displayName'] = 0;
    }
    // Mirror the ring style from an existing player-character actor so the
    // imported NPCs match whatever look the GM has set up for the party.
    for (const [k, v] of Object.entries(findPlayerRingDefaults() ?? {})) {
        patch[k] = v;
    }
    await actor.update(patch as Record<string, unknown>);

    const setFlagRaw: unknown = Reflect.get(actor, 'setFlag');
    if (typeof setFlagRaw === 'function') {
        assertType<(scope: string, key: string, value: unknown) => Promise<void>>(setFlagRaw);
        await setFlagRaw.call(actor, 'kanka-foundry', 'tokenAutoSync', true);
    }

    logInfo(`Token synced for ${actor.name}${tokenUrl ? ' (from Kanka asset)' : ' (from portrait)'}`);
}
