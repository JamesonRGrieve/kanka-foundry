/**
 * Rules for pushing a Foundry actor portrait up to Kanka.
 *
 * Kanka is the single image host, so a local Foundry portrait is uploaded to
 * become the entity image. Not every value of `actor.img` is a portrait
 * though: Foundry stamps a placeholder on every actor it creates, and its core
 * icon library is SVG — which Kanka's uploader rejects with a bare 422. These
 * helpers decide what may be uploaded and under what filename.
 */

/** The placeholder Foundry stamps on an actor with no portrait. */
export const DEFAULT_ACTOR_PORTRAIT = 'icons/svg/mystery-man.svg';

/** Raster formats Kanka's image uploader accepts. SVG is deliberately absent. */
const KANKA_IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

/** True when the path is a Foundry data path rather than an external URL. */
function isLocalImage(img: string): boolean {
    return !img.startsWith('http://') && !img.startsWith('https://');
}

/** The final path segment, percent-decoded (`actor.img` is URL-encoded by Foundry). */
export function portraitFilename(img: string): string {
    const path = img.split(/[?#]/, 1)[0] ?? img;
    const base = path.slice(path.lastIndexOf('/') + 1);
    try {
        return decodeURIComponent(base);
    } catch {
        // A malformed escape sequence is not worth failing an upload over.
        return base;
    }
}

function portraitExtension(img: string): string {
    const name = portraitFilename(img);
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Why this portrait must not be pushed to Kanka, or `null` when it may be.
 * The string is a GM-facing reason, logged in place of an opaque 422.
 */
export function portraitUploadBlocker(img: string): string | null {
    if (img === '') return 'no portrait set';
    if (!isLocalImage(img)) return 'portrait is already an external URL';
    if (img === DEFAULT_ACTOR_PORTRAIT) return 'portrait is the Foundry placeholder';

    const extension = portraitExtension(img);
    if (extension === '') return 'portrait has no file extension';
    if (!KANKA_IMAGE_EXTENSIONS.includes(extension)) {
        return `Kanka does not accept .${extension} images (accepts ${KANKA_IMAGE_EXTENSIONS.join(', ')})`;
    }

    return null;
}
