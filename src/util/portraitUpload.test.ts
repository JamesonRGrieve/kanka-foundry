import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTOR_PORTRAIT, portraitFilename, portraitUploadBlocker } from './portraitUpload';

describe('portraitFilename', () => {
    it('takes the final path segment', () => {
        expect(portraitFilename('worlds/dark-heresy/portraits/Cyril Edric.png')).toBe('Cyril Edric.png');
    });

    it('percent-decodes the segment Foundry encodes', () => {
        expect(portraitFilename('worlds/dark-heresy/portraits/Cyril%20Edric.png')).toBe('Cyril Edric.png');
    });

    it('drops a query string and fragment', () => {
        expect(portraitFilename('portraits/Corra.jpeg?v=2')).toBe('Corra.jpeg');
        expect(portraitFilename('portraits/Corra.jpeg#frag')).toBe('Corra.jpeg');
    });

    it('returns a bare filename unchanged', () => {
        expect(portraitFilename('Corra.jpeg')).toBe('Corra.jpeg');
    });

    it('keeps a malformed escape sequence rather than throwing', () => {
        expect(portraitFilename('portraits/100%.png')).toBe('100%.png');
    });
});

describe('portraitUploadBlocker', () => {
    it('allows every raster format Kanka hosts', () => {
        for (const name of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp']) {
            expect(portraitUploadBlocker(`portraits/${name}`)).toBeNull();
        }
    });

    it('blocks the Foundry placeholder every new actor carries', () => {
        expect(portraitUploadBlocker(DEFAULT_ACTOR_PORTRAIT)).toBe('portrait is the Foundry placeholder');
    });

    it('blocks SVG, which Kanka rejects with a bare 422', () => {
        expect(portraitUploadBlocker('icons/svg/skull.svg')).toContain('does not accept .svg');
    });

    it('blocks an empty portrait', () => {
        expect(portraitUploadBlocker('')).toBe('no portrait set');
    });

    it('blocks an already-remote portrait, which needs no upload', () => {
        expect(portraitUploadBlocker('https://wiki.jamesonrgrieve.ca/storage/abc.png')).toBe('portrait is already an external URL');
        expect(portraitUploadBlocker('http://wiki.jamesonrgrieve.ca/storage/abc.png')).toBe('portrait is already an external URL');
    });

    it('allows a Foundry data path', () => {
        expect(portraitUploadBlocker('worlds/dark-heresy/portraits/Cyril%20Edric.png')).toBeNull();
    });

    it('blocks an extensionless path, which uploads as filename "blob"', () => {
        expect(portraitUploadBlocker('portraits/Cyril')).toBe('portrait has no file extension');
    });
});
