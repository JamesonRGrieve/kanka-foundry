import api from '../api';
import type { KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
function assertType<T>(_value: unknown): asserts _value is T {}

interface ProtoToken {
    texture?: { src?: string };
    ring?: { enabled?: boolean; subject?: { texture?: string | null } };
}

/** Dotted-path Foundry update payload — values are heterogeneous by design. */
// eslint-disable-next-line no-restricted-syntax -- boundary: Foundry Document#update accepts arbitrary dotted-path values
type TokenPatch = Record<string, unknown>;

/**
 * Prototype-token sync — two regimes (see buildTokenPatch):
 *
 *   wh40k-rpg: plain portrait as the token texture +
 *   `flags.wh40k-rpg.tokenFrame`; the system GPU-masks a circular bust at
 *   draw time. No pre-framed Kanka asset involved.
 *
 *   any other system: the pre-framed circular Kanka entity asset named
 *   "token" (canonical redirect URL), falling back to the actor portrait,
 *   mirrored into both texture.src and ring.subject.texture.
 */
function findPlayerRingDefaults(): TokenPatch | null {
    // eslint-disable-next-line no-restricted-syntax -- boundary: Foundry runtime global `game.actors`; narrowed by assertType below
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
        const patch: TokenPatch = {};
        // eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry ring data; narrowed below
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

/**
 * Pure patch builder — the unit-testable half of syncTokenImage.
 *
 * Two regimes:
 *  - `wh40k-rpg` system (runtime circular mask available): the token texture
 *    is the PLAIN PORTRAIT and `prototypeToken.flags.wh40k-rpg.tokenFrame`
 *    asks the system to GPU-mask a circular bust at draw time. No pre-framed
 *    Kanka `token.png` asset is involved, and the legacy
 *    `ring.subject.texture` mirror is CLEARED — Foundry V13+ renders that
 *    field instead of texture.src when set, which would bypass the runtime
 *    mask entirely. Mirrored `ring.subject.scale` defaults are dropped too:
 *    core applies that field only through the token animation path, so it
 *    never works on a fresh draw — band padding comes from the generated
 *    bust instead.
 *  - any other system (legacy): the pre-framed circular Kanka asset (or the
 *    portrait as fallback) goes into both texture slots, as before.
 */
/** Runtime circular-bust framing pushed from the vault (auto-framed or hand-tuned). */
export interface TokenFrameValue {
    cx: number;
    cy: number;
    zoom: number;
}

export function buildTokenPatch(input: {
    systemId: string | undefined;
    actorType: string | undefined;
    portrait: string | undefined | null;
    kankaTokenUrl: string | null;
    hasTokenFrame: boolean;
    tokenFrame?: TokenFrameValue | null;
    ringDefaults: TokenPatch;
}): TokenPatch | null {
    const npcNameplate = typeof input.actorType === 'string' && input.actorType.endsWith('-npc') ? { 'prototypeToken.displayName': 0 } : {};
    if (input.systemId === 'wh40k-rpg') {
        const portrait = input.portrait;
        if (portrait === undefined || portrait === null || portrait === '' || portrait === 'icons/svg/mystery-man.svg') return null;
        const ringDefaults = Object.fromEntries(Object.entries(input.ringDefaults).filter(([k]) => k !== 'prototypeToken.ring.subject.scale'));
        return {
            'prototypeToken.texture.src': portrait,
            'prototypeToken.sight.enabled': true,
            'prototypeToken.ring.enabled': true,
            'prototypeToken.ring.subject.texture': null,
            // Vault-provided frame wins (it overrides the generic default even when a
            // prior {} is already present); else keep an existing GM-tuned frame; else
            // stamp the bare default so the system still masks a circular bust.
            ...(input.tokenFrame
                ? { 'prototypeToken.flags.wh40k-rpg.tokenFrame': input.tokenFrame }
                : input.hasTokenFrame
                  ? {}
                  : { 'prototypeToken.flags.wh40k-rpg.tokenFrame': {} }),
            ...npcNameplate,
            ...ringDefaults,
        };
    }
    const tokenSource = input.kankaTokenUrl ?? input.portrait;
    if (tokenSource === undefined || tokenSource === null || tokenSource === '' || tokenSource === 'icons/svg/mystery-man.svg') return null;
    return {
        'prototypeToken.texture.src': tokenSource,
        'prototypeToken.sight.enabled': true,
        'prototypeToken.ring.enabled': true,
        // Mirror the same source into ring.subject.texture: with the dynamic
        // token ring enabled, Foundry V13+ renders ring.subject.texture instead
        // of texture.src. Without this, a stale local subject texture (e.g. a
        // leftover portrait file) keeps rendering even though texture.src is
        // correct.
        'prototypeToken.ring.subject.texture': tokenSource,
        ...npcNameplate,
        ...input.ringDefaults,
    };
}

function activeSystemId(): string | undefined {
    // eslint-disable-next-line no-restricted-syntax -- boundary: Foundry runtime global `game.system` has no shipped type here
    const systemRaw: unknown = Reflect.get(game, 'system');
    if (systemRaw === null || typeof systemRaw !== 'object') return undefined;
    // eslint-disable-next-line no-restricted-syntax -- boundary: narrowing the untyped Foundry global on the next line
    const id: unknown = Reflect.get(systemRaw, 'id');
    return typeof id === 'string' ? id : undefined;
}

/**
 * HEAD-probe the canonical pre-framed token asset for legacy systems. The
 * URL written into Foundry is the canonical redirect endpoint, NOT the
 * per-upload /storage/<uuid>.<ext> URL — it survives asset re-upload. The
 * pretty `/c/<campaign>/e/<entity>/<asset>.png` form is an Apache rewrite to
 * canonical.php; the `.png` satisfies Foundry V14's SchemaField validator
 * while the 302 target's content-type stays correct. Probed directly because
 * the /entity_assets listing 500s when any row has a stale type_id.
 */
async function probeKankaTokenAsset(campaignId: KankaApiId, kankaEntityId: KankaApiEntityId, actorName: string): Promise<string | null> {
    try {
        const u = new URL(api.baseUrl);
        const candidate = `${u.protocol}//${u.host}/c/${campaignId}/e/${kankaEntityId}/token.png`;
        const probe = await fetch(candidate, { method: 'HEAD' });
        if (probe.ok) return candidate;
    } catch (error) {
        logError(`Failed to probe token URL for ${actorName}`, error);
    }
    return null;
}

/** True when a previous sync stamped the kanka-foundry tokenAutoSync flag. */
function wasTokenAutoSet(actor: object): boolean {
    // eslint-disable-next-line no-restricted-syntax -- boundary: untyped Foundry flag bag; narrowed below
    const flagsRaw: unknown = Reflect.get(actor, 'flags');
    // eslint-disable-next-line no-restricted-syntax -- boundary: nested flag bag narrowed on the next line
    const kankaFlags: unknown = flagsRaw !== null && typeof flagsRaw === 'object' ? Reflect.get(flagsRaw, 'kanka-foundry') : undefined;
    return kankaFlags !== null && typeof kankaFlags === 'object' && Reflect.get(kankaFlags, 'tokenAutoSync') === true;
}

/** True when the prototype token already carries a wh40k-rpg tokenFrame flag
 * (GM-tuned centre coordinates must survive re-imports). */
function hasExistingTokenFrame(proto: ProtoToken | undefined): boolean {
    if (proto === undefined) return false;
    // eslint-disable-next-line no-restricted-syntax -- boundary: prototypeToken.flags has no shipped type; narrowed below
    const protoFlags: unknown = Reflect.get(proto, 'flags');
    // eslint-disable-next-line no-restricted-syntax -- boundary: nested flag bag narrowed on the next line
    const systemFlags: unknown = protoFlags !== null && typeof protoFlags === 'object' ? Reflect.get(protoFlags, 'wh40k-rpg') : undefined;
    return systemFlags !== null && typeof systemFlags === 'object' && Reflect.has(systemFlags, 'tokenFrame');
}

export async function syncTokenImage(
    actor: Actor,
    campaignId: KankaApiId,
    kankaEntityId: KankaApiEntityId,
    force = false,
    tokenFrame: TokenFrameValue | null = null,
): Promise<void> {
    const actorRaw: unknown = actor;
    const protoRaw: unknown = actorRaw !== null && typeof actorRaw === 'object' ? Reflect.get(actorRaw, 'prototypeToken') : undefined;
    let proto: ProtoToken | undefined;
    if (protoRaw !== null && typeof protoRaw === 'object') {
        assertType<ProtoToken>(protoRaw);
        proto = protoRaw;
    }

    const currentToken = proto?.texture?.src;
    const isDefault = currentToken === undefined || currentToken === '' || currentToken === 'icons/svg/mystery-man.svg';

    if (!force && !isDefault && !wasTokenAutoSet(actor)) return;

    const systemId = activeSystemId();

    // The wh40k-rpg path needs no pre-framed asset at all — the portrait is
    // the source and the system's runtime mask frames it at draw time.
    const tokenUrl = systemId === 'wh40k-rpg' ? null : await probeKankaTokenAsset(campaignId, kankaEntityId, actor.name);

    // eslint-disable-next-line no-restricted-syntax -- boundary: narrowing the untyped Foundry actor on the next line
    const actorTypeRaw: unknown = Reflect.get(actor, 'type');

    const patch = buildTokenPatch({
        systemId,
        actorType: typeof actorTypeRaw === 'string' ? actorTypeRaw : undefined,
        portrait: actor.img,
        kankaTokenUrl: tokenUrl,
        hasTokenFrame: hasExistingTokenFrame(proto),
        tokenFrame,
        // Mirror the ring style from an existing player-character actor so the
        // imported NPCs match whatever look the GM has set up for the party.
        ringDefaults: findPlayerRingDefaults() ?? {},
    });
    if (patch === null) return;
    await actor.update(patch);

    const setFlagRaw: unknown = Reflect.get(actor, 'setFlag');
    if (typeof setFlagRaw === 'function') {
        assertType<(scope: string, key: string, value: unknown) => Promise<void>>(setFlagRaw);
        await setFlagRaw.call(actor, 'kanka-foundry', 'tokenAutoSync', true);
    }

    logInfo(`Token synced for ${actor.name}${tokenUrl ? ' (from Kanka asset)' : ' (from portrait)'}`);
}
