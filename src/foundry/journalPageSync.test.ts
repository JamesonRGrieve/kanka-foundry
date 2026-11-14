import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    applyJournalConflict,
    isJournalConflictValid,
    type PageData,
    type PageRebuilder,
    pageKey,
    pageSignature,
    planPageSync,
    signatureHash,
    toPageConflict,
} from './journalPageSync';

/** A post page as the import writes it. */
function post(name: string, content: string, extra: Partial<PageData> = {}): PageData {
    return { name, type: 'kanka-foundry.post', text: { content }, system: { version: '000001-a', snapshot: {} }, ...extra };
}

const GM_NOTES = post('GM Notes', '<p>The network meets here.</p>');

describe('planPageSync: a re-import compares before it overwrites (wh40k-rpg#739)', () => {
    it('creates a page the journal lacks, and leaves a matching page alone', () => {
        const plan = planPageSync([{ ...GM_NOTES, _id: 'p1' }], [GM_NOTES, post('Entry', '<p>The lodge.</p>')]);
        expect(plan.create.map((page) => page.name)).toEqual(['Entry']);
        expect(plan.conflicts).toEqual([]);
    });

    it("ignores a change of the page model's version alone (it moves with the entity, not the page)", () => {
        const plan = planPageSync([{ ...GM_NOTES, _id: 'p1' }], [{ ...GM_NOTES, system: { version: '000001-b', snapshot: {} } }]);
        expect(plan.conflicts).toEqual([]);
    });

    it('sends a page whose content differs to the resolver, with both sides', () => {
        const changed = post('GM Notes', '<p>The network moved.</p>');
        const plan = planPageSync([{ ...GM_NOTES, _id: 'p1' }], [changed]);
        expect(plan.conflicts).toHaveLength(1);
        expect(plan.conflicts[0]).toMatchObject({ name: 'GM Notes', incoming: changed, existing: { _id: 'p1' } });
    });

    it('asks again only when Kanka moves past the version the GM declined', () => {
        const changed = post('GM Notes', '<p>The network moved.</p>');
        const declined = { ...GM_NOTES, _id: 'p1', flags: { 'kanka-foundry': { declined: signatureHash(pageSignature(changed)) } } };
        expect(planPageSync([declined], [changed]).conflicts).toEqual([]);
        expect(planPageSync([declined], [post('GM Notes', '<p>Moved again.</p>')]).conflicts).toHaveLength(1);
    });

    it("asks before removing a page Kanka no longer has, and never touches a GM's own page", () => {
        const gmPage: PageData = { _id: 'g1', name: 'Session notes', type: 'text', text: { content: '<p>Mine.</p>' } };
        const plan = planPageSync([{ ...GM_NOTES, _id: 'p1' }, gmPage], []);
        expect(plan.conflicts.map((conflict) => [conflict.name, conflict.incoming])).toEqual([['GM Notes', null]]);
    });

    it('counts a legacy image page as the import’s only when Kanka still writes a page of that name', () => {
        const image: PageData = { _id: 'i1', name: 'Map of the hab', type: 'image', src: 'old.webp' };
        expect(planPageSync([image], []).conflicts).toEqual([]);
        expect(planPageSync([image], [{ name: 'Map of the hab', type: 'image', src: 'new.webp' }]).conflicts).toHaveLength(1);
    });
});

describe('the stored conflict', () => {
    it('keeps the page, its key and a hash of Kanka’s version, not the page itself', () => {
        const long = post('GM Notes', `<p>${'x'.repeat(5000)}</p>`);
        const conflict = toPageConflict('j1', 'Hab District 4', { key: pageKey(long), name: 'GM Notes', existing: { ...GM_NOTES, _id: 'p1' }, incoming: long });
        expect(conflict).toMatchObject({ id: 'journal:j1:kanka-foundry.post|GM Notes', kind: 'journalPage', entityType: 'journal', entityId: 'j1' });
        expect(JSON.parse(conflict.payload ?? '')).toEqual({
            existingId: 'p1',
            key: 'kanka-foundry.post|GM Notes',
            incoming: signatureHash(pageSignature(long)),
        });
        expect(conflict.kankaValue.length).toBeLessThanOrEqual(241);
    });
});

describe('resolving a page conflict', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const changed = post('GM Notes', '<p>The network moved.</p>');

    /** The writes a stub journal records. */
    interface JournalWrites {
        updatePage: ReturnType<typeof vi.fn>;
        updateEmbedded: ReturnType<typeof vi.fn>;
        deleteEmbedded: ReturnType<typeof vi.fn>;
    }

    /** A journal holding one page, recording the writes made to it. */
    function journal(page: PageData): JournalWrites {
        const writes: JournalWrites = { updatePage: vi.fn(), updateEmbedded: vi.fn(), deleteEmbedded: vi.fn() };
        const pageDoc = { toObject: () => page, update: writes.updatePage };
        const entry = {
            pages: { get: (id: string) => (id === page._id ? pageDoc : undefined) },
            updateEmbeddedDocuments: writes.updateEmbedded,
            deleteEmbeddedDocuments: writes.deleteEmbedded,
        };
        vi.stubGlobal('game', { journal: { get: (id: string) => (id === 'j1' ? entry : undefined) } });
        vi.stubGlobal('foundry', { data: {} });
        return writes;
    }

    const conflictFor = (incoming: PageData | null): ReturnType<typeof toPageConflict> =>
        toPageConflict('j1', 'Hab District 4', { key: pageKey(GM_NOTES), name: 'GM Notes', existing: { ...GM_NOTES, _id: 'p1' }, incoming });

    it("taking Kanka's side rebuilds the page and writes it in place", async () => {
        const writes = journal({ ...GM_NOTES, _id: 'p1' });
        const rebuild = vi.fn<PageRebuilder>().mockResolvedValue(changed);
        await expect(applyJournalConflict(conflictFor(changed), 'kanka', rebuild)).resolves.toBe(true);
        expect(rebuild).toHaveBeenCalledWith(expect.anything(), pageKey(GM_NOTES));
        expect(writes.updateEmbedded).toHaveBeenCalledWith('JournalEntryPage', [expect.objectContaining({ _id: 'p1', text: changed.text })]);
    });

    it("keeping Foundry's side marks that Kanka version declined, so the conflict no longer holds", async () => {
        const writes = journal({ ...GM_NOTES, _id: 'p1' });
        const conflict = conflictFor(changed);
        expect(isJournalConflictValid(conflict)).toBe(true);
        await expect(applyJournalConflict(conflict, 'foundry', vi.fn())).resolves.toBe(true);
        expect(writes.updatePage).toHaveBeenCalledWith({ flags: { 'kanka-foundry': { declined: signatureHash(pageSignature(changed)) } } });
        journal({ ...GM_NOTES, _id: 'p1', flags: { 'kanka-foundry': { declined: signatureHash(pageSignature(changed)) } } });
        expect(isJournalConflictValid(conflict)).toBe(false);
    });

    it("taking Kanka's side of a removal deletes the page", async () => {
        const writes = journal({ ...GM_NOTES, _id: 'p1' });
        await expect(applyJournalConflict(conflictFor(null), 'kanka', vi.fn())).resolves.toBe(true);
        expect(writes.deleteEmbedded).toHaveBeenCalledWith('JournalEntryPage', ['p1']);
    });
});
