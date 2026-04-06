function isOutdatedPage(page: JournalEntryPage): boolean {
    if (page.type !== 'kanka-foundry.children' && page.type !== 'kanka-foundry.family-members') return false;

    return (page.system as unknown as Record<string, Record<string, unknown[]>>).snapshot.list?.every(e => typeof e === 'object');
}

// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const journals = Array.from(game.journal?.values() ?? []).filter(e => e.getFlag('kanka-foundry', 'id'));

    for (const entry of journals) {
        const pages = Array
            .from(entry.pages.values())
            .filter(isOutdatedPage);

        await entry.updateEmbeddedDocuments('JournalEntryPage', pages.map((page: JournalEntryPage) => {
            const sys = page.system as unknown as Record<string, Record<string, unknown[]>>;
            return {
                _id: page._id,
                system: {
                    snapshot: {
                        ...sys.snapshot,
                        list: (sys.snapshot.list as { id?: unknown; ref?: { id: unknown } }[]).map(({ id, ref }) => id ?? ref?.id),
                    },
                },
            };
        }) as JournalEntryPage.UpdateData[]);
    }
}
