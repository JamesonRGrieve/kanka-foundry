/**
 * Event Tracker — GM-only dashboard for campaign hook dependencies.
 *
 * Three tabs:
 *   - Timeline: events grouped by source (day plan / side quest), sorted chronologically
 *   - Location: events grouped by location, with scene integration
 *   - Relations: NPC dispositions (computed from hooks) + per-PC attitudes (editable, synced to Kanka)
 *
 * Day tracker: stores current campaign day in a world setting.
 * Resolved state synced bidirectionally with Kanka via element colour.
 */

import api from '../../api';
import type { KankaApiAttribute, KankaApiId, KankaApiQuestElement, KankaApiTimelineElement } from '../../types/kanka';
import { logError, logInfo } from '../../util/logger';

import ApplicationV2 = foundry.applications.api.ApplicationV2;
import type { DeepPartial } from 'fvtt-types/utils';

const RESOLVED_COLOUR = '#22cc66';

/**
 * A requirement node in the dependency tree.
 * - null: no dependencies (always satisfied)
 * - string: a single event ID (leaf)
 * - {any: RequirementNode[]}: at least one child must be resolved
 * - {all: RequirementNode[]}: every child must be resolved
 */
type RequirementNode = null | string | { any: RequirementNode[] } | { all: RequirementNode[] };

interface EventGraphNode {
    name: string;
    source: string;
    location?: string;
    /** Dependency tree. null = no dependencies. */
    requires?: RequirementNode;
    /** Legacy flat OR — normalised into requires on load. */
    requires_any?: string[] | null;
    excuse?: Record<string, string>;
    is_day_end?: boolean;
}

type EventGraph = Record<string, EventGraphNode>;

interface DispositionEntry {
    default?: boolean;
    trigger?: string;
    attitude: string;
    note: string;
}

interface NpcDisposition {
    entity_id: number | null;
    states: DispositionEntry[];
    /** Per-PC attitudes loaded from Kanka entity attributes. Key = PC name, value = free text. */
    pcAttitudes: Record<string, string>;
}

type DispositionMap = Record<string, NpcDisposition>;

interface ElementRef {
    type: 'quest' | 'timeline';
    parentId: KankaApiId;
    element: KankaApiQuestElement | KankaApiTimelineElement;
}

interface TrackerState {
    graph: EventGraph;
    dispositions: DispositionMap;
    elementsByEventId: Map<string, ElementRef>;
    resolvedIds: Set<string>;
    pcNames: string[];
}

type TabId = 'timeline' | 'location' | 'relations';

export default class EventTrackerApplication extends ApplicationV2 {
    #state: TrackerState | null = null;
    #campaignId: KankaApiId | null = null;
    #message: string | null = null;
    #activeTab: TabId = 'timeline';
    #attitudesLoaded = false;

    static DEFAULT_OPTIONS: DeepPartial<ApplicationV2.Configuration> = {
        id: 'kanka-event-tracker',
        window: {
            title: 'Event Tracker',
            resizable: true,
            controls: [
                {
                    icon: 'fa-solid fa-rotate-right',
                    label: 'Reload',
                    action: 'reload',
                },
            ],
        },
        position: {
            height: 750,
            width: 720,
        },
        actions: {
            reload: EventTrackerApplication.handleReload,
        },
    };

    async prefetch(): Promise<void> {
        try {
            await this.loadState();
            logInfo('EventTracker: prefetch complete');
        } catch (err) {
            logError('EventTracker: prefetch failed (will retry on open)', err);
        }
    }

    async open(): Promise<void> {
        if (this.#state) {
            this.#message = null;
            this.render(true);
            return;
        }

        this.#message = '<i class="fas fa-spinner fa-spin"></i> Loading event data from Kanka...';
        this.render(true);

        try {
            await this.loadState();
            this.#message = null;
        } catch (err) {
            this.#message = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
            logError('EventTracker: failed to load state', err);
        }

        this.render(true);
    }

    static async handleReload(this: EventTrackerApplication): Promise<void> {
        this.#state = null;
        this.#attitudesLoaded = false;
        this.open();
    }

    // ── Foundry render ──

    async _renderHTML(_context: unknown, _options: unknown): Promise<HTMLElement> {
        const wrapper = document.createElement('div');
        wrapper.classList.add('event-tracker');

        if (this.#message) {
            wrapper.innerHTML = `<p style="padding:12px;">${this.#message}</p>`;
            return wrapper;
        }

        if (!this.#state) {
            wrapper.innerHTML = '<p style="padding:12px;">No data loaded. Click the reload button.</p>';
            return wrapper;
        }

        wrapper.appendChild(this.buildStyleElement());
        wrapper.appendChild(this.buildDayBar());
        wrapper.appendChild(this.buildTabBar());

        if (this.#activeTab === 'timeline') {
            wrapper.appendChild(this.buildTimelineContent());
        } else if (this.#activeTab === 'location') {
            wrapper.appendChild(this.buildLocationContent());
        } else {
            if (!this.#attitudesLoaded && this.#campaignId) {
                this.#attitudesLoaded = true;
                wrapper.innerHTML += '<p style="padding:12px;"><i class="fas fa-spinner fa-spin"></i> Loading NPC attitudes...</p>';
                this.loadNpcAttitudes().then(() => this.render(true));
                return wrapper;
            }
            wrapper.appendChild(this.buildRelationsContent());
        }

        return wrapper;
    }

    _replaceHTML(result: HTMLElement, content: HTMLElement, _options: unknown): void {
        content.replaceChildren(result);
        this.activateListeners(result);
    }

    // ── Listeners ──

    private activateListeners(html: HTMLElement): void {
        for (const cb of html.querySelectorAll<HTMLInputElement>('input[data-event-id]')) {
            cb.addEventListener('change', async (ev) => {
                const t = ev.currentTarget as HTMLInputElement;
                await this.toggleResolved(t.dataset.eventId ?? '', t.checked);
            });
        }

        for (const btn of html.querySelectorAll<HTMLButtonElement>('.evt-tab-btn')) {
            btn.addEventListener('click', () => {
                this.#activeTab = (btn.dataset.tab as TabId) ?? 'timeline';
                this.render(true);
            });
        }

        html.querySelector('.evt-day-prev')?.addEventListener('click', () => this.changeDay(-1));
        html.querySelector('.evt-day-next')?.addEventListener('click', () => this.changeDay(1));

        for (const btn of html.querySelectorAll<HTMLButtonElement>('.evt-scene-btn')) {
            btn.addEventListener('click', async () => {
                const loc = btn.dataset.location ?? '';
                const action = btn.dataset.sceneAction ?? '';
                if (action === 'go') {
                    const scene = this.findScene(loc) as { view(): Promise<unknown> } | null;
                    if (scene) await scene.view();
                } else if (action === 'spawn') {
                    await this.spawnScene(loc);
                }
            });
        }

        // PC attitude fields — debounced save to Kanka
        for (const input of html.querySelectorAll<HTMLInputElement>('.evt-att-input')) {
            let timer: ReturnType<typeof setTimeout>;
            input.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const charName = input.dataset.char ?? '';
                    const key = input.dataset.attKey ?? '';
                    this.savePcAttitude(charName, key, input.value);
                }, 1500);
            });
        }

        // Cross-tab links
        for (const link of html.querySelectorAll<HTMLAnchorElement>('.evt-xlink')) {
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                const tab = (link.dataset.tab as TabId) ?? 'timeline';
                const group = link.dataset.group ?? '';
                this.#activeTab = tab;
                this.render(true);
                requestAnimationFrame(() => {
                    const target = html.closest('.event-tracker')
                        ?.querySelector(`[data-group-name="${CSS.escape(group)}"]`);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        target.classList.add('evt-flash');
                        setTimeout(() => target.classList.remove('evt-flash'), 1500);
                    }
                });
            });
        }
    }

    // ── Day tracker ──

    private getCurrentDay(): number {
        try {
            return (game.settings?.get('kanka-foundry', 'currentDay') as number) ?? 0;
        } catch {
            return 0;
        }
    }

    private async changeDay(delta: number): Promise<void> {
        const current = this.getCurrentDay();
        const next = Math.max(0, current + delta);
        try {
            await game.settings?.set('kanka-foundry', 'currentDay', next);
        } catch { /* ignore */ }
        this.render(true);
    }

    private static sourceDayNumber(source: string): number | null {
        const m = source.match(/^Day\s+(M?\d+)/);
        if (!m) return null;
        const d = m[1];
        return d.startsWith('M') ? 100 + Number.parseInt(d.slice(1), 10) : Number.parseInt(d, 10);
    }

    private static sourceSortKey(name: string): number {
        return EventTrackerApplication.sourceDayNumber(name) ?? 9999;
    }

    // ── Scene integration ──

    private findScene(locationName: string): unknown {
        const scenes = (game as Record<string, unknown>).scenes as Record<string, unknown> | undefined;
        return (scenes?.getName as ((n: string) => unknown) | undefined)?.(locationName) ?? null;
    }

    private getActiveSceneName(): string {
        const scenes = (game as Record<string, unknown>).scenes as Record<string, unknown> | undefined;
        const active = scenes?.active as Record<string, unknown> | undefined;
        return (active?.name as string) ?? '';
    }

    private async spawnScene(locationName: string): Promise<void> {
        try {
            await (Scene as unknown as { create(data: Record<string, unknown>): Promise<unknown> }).create({ name: locationName, width: 1000, height: 1000 });
            logInfo(`EventTracker: created scene "${locationName}"`);
            this.render(true);
        } catch (err) {
            logError(`EventTracker: failed to create scene "${locationName}"`, err);
        }
    }

    // ── PC names from Foundry actors ──

    private getPcNames(): string[] {
        const actors = (game as Record<string, unknown>).actors as Iterable<{ name: string; type: string }> | undefined;
        if (!actors) return [];
        const names: string[] = [];
        for (const actor of actors) {
            if (actor.type === 'character') {
                names.push(actor.name);
            }
        }
        return names.sort();
    }

    // ── Data loading ──

    private async loadState(): Promise<void> {
        if (!api.isReady) {
            throw new Error('Kanka API not connected. Configure your access token in module settings.');
        }

        const campaigns = await api.getAllCampaigns();
        if (campaigns.length === 0) {
            throw new Error('No campaigns found. Check your Kanka API token and base URL.');
        }
        const campaignId = Number(campaigns[0].id);
        this.#campaignId = campaignId;

        const elementsByEventId = new Map<string, ElementRef>();
        const resolvedIds = new Set<string>();

        // Quest elements — getAllQuests with ?related=1 includes elements inline
        const quests = await api.getAllQuests(campaignId);
        for (const quest of quests) {
            if (!quest.elements?.length) continue;
            for (const elem of quest.elements) {
                const eventId = elem.role;
                if (!eventId) continue;
                elementsByEventId.set(eventId, { type: 'quest', parentId: quest.id, element: elem });
                if (elem.colour === RESOLVED_COLOUR) resolvedIds.add(eventId);
            }
        }

        // Timeline elements — need separate fetch since getAllTimelines doesn't inline them
        let timelineEntityId: number | null = null;
        const timelines = await api.getAllTimelines(campaignId);
        const campaignTimeline = timelines.find((t) => t.name === 'Campaign Timeline');
        if (campaignTimeline) {
            timelineEntityId = Number(campaignTimeline.entity_id);
            let elements: KankaApiTimelineElement[];
            try { elements = await api.getTimelineElements(campaignId, campaignTimeline.id); }
            catch { elements = []; }
            for (const elem of elements) {
                const eventId = elem.date;
                if (!eventId) continue;
                elementsByEventId.set(eventId, { type: 'timeline', parentId: campaignTimeline.id, element: elem });
                if (elem.colour === RESOLVED_COLOUR) resolvedIds.add(eventId);
            }
        }

        let graph: EventGraph = {};
        const dispositions: DispositionMap = {};
        const graphEntityId = timelineEntityId
            ?? (quests.find((q) => q.name === 'Campaign Timeline')
                ? Number(quests.find((q) => q.name === 'Campaign Timeline')?.entity_id)
                : null);

        if (graphEntityId) {
            try {
                const attrs = await api.getEntityAttributes(campaignId, graphEntityId);
                const graphAttr = attrs.find((a: KankaApiAttribute) => a.name === 'event_graph');
                if (graphAttr?.value) {
                    const parsed = JSON.parse(graphAttr.value);
                    if (parsed.events) {
                        graph = parsed.events;
                        const rawDisps = parsed.dispositions ?? {};
                        for (const [name, val] of Object.entries(rawDisps)) {
                            if (Array.isArray(val)) {
                                dispositions[name] = { entity_id: null, states: val as DispositionEntry[], pcAttitudes: {} };
                            } else {
                                const d = val as { entity_id?: number; states?: DispositionEntry[] };
                                dispositions[name] = { entity_id: d.entity_id ?? null, states: d.states ?? [], pcAttitudes: {} };
                            }
                        }
                    } else {
                        graph = parsed;
                    }
                }
            } catch (err) {
                logError('EventTracker: failed to load event_graph attribute', err);
            }
        }

        // Per-PC attitudes are lazy-loaded when the Relations tab is opened
        const pcNames = this.getPcNames();

        this.#state = { graph, dispositions, elementsByEventId, resolvedIds, pcNames };
    }

    /** Lazy-load per-NPC attitudes from Kanka entity attributes. */
    private async loadNpcAttitudes(): Promise<void> {
        if (!this.#state || !this.#campaignId) return;
        for (const [, npc] of Object.entries(this.#state.dispositions)) {
            if (!npc.entity_id) continue;
            try {
                const attrs = await api.getEntityAttributes(this.#campaignId, npc.entity_id);
                for (const attr of attrs) {
                    if (attr.name.startsWith('attitude_')) {
                        npc.pcAttitudes[attr.name.slice('attitude_'.length)] = (attr.value as string) ?? '';
                    }
                }
            } catch { /* non-critical */ }
        }
    }

    // ── Kanka sync ──

    private async toggleResolved(eventId: string, resolved: boolean): Promise<void> {
        if (!this.#state || !this.#campaignId) return;
        const ref = this.#state.elementsByEventId.get(eventId);
        if (!ref) return;

        const newColour = resolved ? RESOLVED_COLOUR : null;
        try {
            if (ref.type === 'quest') {
                await api.patchQuestElement(this.#campaignId, ref.parentId, ref.element.id,
                    { colour: newColour, name: ref.element.name });
            } else {
                await api.patchTimelineElement(this.#campaignId, ref.parentId, ref.element.id,
                    { colour: newColour, name: ref.element.name });
            }
            ref.element.colour = newColour;
            if (resolved) { this.#state.resolvedIds.add(eventId); }
            else { this.#state.resolvedIds.delete(eventId); }
            logInfo(`EventTracker: ${eventId} → ${resolved ? 'resolved' : 'pending'}`);
        } catch (err) {
            logError(`EventTracker: failed to update ${eventId}`, err);
        }
        this.render(true);
    }

    private async savePcAttitude(charName: string, pcName: string, value: string): Promise<void> {
        if (!this.#state || !this.#campaignId) return;
        const npc = this.#state.dispositions[charName];
        if (!npc?.entity_id) return;

        const attrName = `attitude_${pcName}`;
        npc.pcAttitudes[pcName] = value;

        try {
            const attrs = await api.getEntityAttributes(this.#campaignId, npc.entity_id);
            const existing = attrs.find((a) => a.name === attrName);
            if (existing) {
                await api.updateEntityAttribute(this.#campaignId, npc.entity_id, existing.id, { value });
            } else {
                await api.createEntityAttribute(this.#campaignId, npc.entity_id, { name: attrName, value });
            }
            logInfo(`EventTracker: saved ${attrName} for ${charName}`);
        } catch (err) {
            logError(`EventTracker: failed to save ${attrName} for ${charName}`, err);
        }
    }

    // ── Graph logic (recursive requirement tree) ──

    /** Evaluate whether a requirement node is satisfied. */
    private evalNode(node: RequirementNode): boolean {
        if (node === null) return true;
        if (typeof node === 'string') {
            return this.#state?.resolvedIds.has(node) ?? false;
        }
        if ('all' in node) {
            return node.all.every((child) => this.evalNode(child));
        }
        if ('any' in node) {
            return node.any.some((child) => this.evalNode(child));
        }
        return false;
    }

    /** Normalise an event's requirements into a single node. Merges legacy requires_any. */
    private getRequirements(node: EventGraphNode): RequirementNode {
        // New format: requires is already a single node (null, string, {any}, {all})
        if (node.requires !== undefined && !Array.isArray(node.requires)) {
            if (node.requires_any?.length) {
                // Merge: requires AND (any of requires_any)
                return { all: [node.requires, { any: node.requires_any }] };
            }
            return node.requires;
        }

        // Legacy format: requires is a string[] (implicit all), requires_any is string[] (implicit any)
        const children: RequirementNode[] = [];
        if (Array.isArray(node.requires)) {
            for (const r of node.requires) {
                children.push(r as RequirementNode);
            }
        }
        if (node.requires_any?.length) {
            children.push({ any: node.requires_any });
        }

        if (children.length === 0) return null;
        if (children.length === 1) return children[0];
        return { all: children };
    }

    private isAvailable(eventId: string): boolean {
        const state = this.#state;
        if (!state) return false;
        const node = state.graph[eventId];
        if (!node) return false;
        return this.evalNode(this.getRequirements(node));
    }

    /** Format a single event ID as a human-readable link. */
    private formatDep(id: string): string {
        const state = this.#state;
        if (!state) return id;
        const dep = state.graph[id];
        if (!dep) return id;

        const locRaw = dep.location ? dep.location.replace(/\[\[|\]\]/g, '') : '';
        const sourceRaw = dep.source ?? '';

        let result = `<strong>${dep.name}</strong>`;
        if (locRaw) {
            result += ` at <a class="evt-xlink" data-tab="location" data-group="${locRaw}">${locRaw}</a>`;
        }
        if (sourceRaw) {
            const dayMatch = sourceRaw.match(/^Day\s+(M?\d+)/);
            if (dayMatch) {
                result += ` on <a class="evt-xlink" data-tab="timeline" data-group="${sourceRaw}">${sourceRaw.split('—')[0].trim()}</a> or later`;
            } else {
                result += ` via <a class="evt-xlink" data-tab="timeline" data-group="${sourceRaw}">${sourceRaw}</a>`;
            }
        }
        return result;
    }

    /** Recursively render requirements as an indented tree matching the AND/OR structure. */
    private renderUnmetReasons(node: RequirementNode, excuses: Record<string, string>, depth: number): string[] {
        if (node === null) return [];
        const ml = 24 + depth * 12;
        const indent = ` style="margin-left:${ml}px"`;
        const lines: string[] = [];

        if (typeof node === 'string') {
            const met = this.#state?.resolvedIds.has(node) ?? false;
            let line = this.formatDep(node);
            if (excuses[node]) line += ` — <span class="evt-excuse-inline">${excuses[node]}</span>`;
            const cls = met ? 'evt-block evt-block-met' : 'evt-block';
            lines.push(`<div class="${cls}"${indent}>${met ? '✓' : '○'} ${line}</div>`);
            return lines;
        }

        if ('all' in node) {
            lines.push(`<div class="evt-block evt-block-label"${indent}><strong>Requires all:</strong></div>`);
            for (const child of node.all) {
                lines.push(...this.renderUnmetReasons(child, excuses, depth + 1));
            }
            return lines;
        }

        if ('any' in node) {
            lines.push(`<div class="evt-block evt-block-label"${indent}><strong>Requires any:</strong></div>`);
            for (const child of node.any) {
                lines.push(...this.renderUnmetReasons(child, excuses, depth + 1));
            }
            return lines;
        }

        return lines;
    }

    private getBlockingReasonsHtml(eventId: string): string {
        const state = this.#state;
        if (!state) return '';
        const node = state.graph[eventId];
        if (!node) return '';

        const reqs = this.getRequirements(node);
        if (reqs === null) return '';

        const excuses = node.excuse ?? {};
        return this.renderUnmetReasons(reqs, excuses, 0).join('');
    }

    // ── UI building ──

    private buildDayBar(): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'evt-day-bar';
        const currentDay = this.getCurrentDay();
        const label = currentDay >= 100 ? `Day M${currentDay - 100}` : `Day ${currentDay}`;
        bar.innerHTML = `
            <button class="evt-day-prev" title="Previous day"><i class="fas fa-chevron-left"></i></button>
            <span class="evt-day-label">Campaign Day: <strong>${label}</strong></span>
            <button class="evt-day-next" title="Next day"><i class="fas fa-chevron-right"></i></button>
        `;
        return bar;
    }

    private buildTabBar(): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'evt-tab-bar';
        const tabs: { id: TabId; label: string; icon: string }[] = [
            { id: 'timeline', label: 'Timeline', icon: 'fa-clock' },
            { id: 'location', label: 'Location', icon: 'fa-map-marker-alt' },
            { id: 'relations', label: 'Relations', icon: 'fa-users' },
        ];
        for (const tab of tabs) {
            const btn = document.createElement('button');
            btn.className = `evt-tab-btn ${this.#activeTab === tab.id ? 'active' : ''}`;
            btn.dataset.tab = tab.id;
            btn.innerHTML = `<i class="fas ${tab.icon}"></i> ${tab.label}`;
            bar.appendChild(btn);
        }
        return bar;
    }

    private buildStats(): HTMLElement {
        const state = this.#state;
        if (!state) return document.createElement('div');
        const total = Object.keys(state.graph).length;
        const resolvedCount = state.resolvedIds.size;
        const availableCount = Object.keys(state.graph)
            .filter((id) => !state.resolvedIds.has(id) && this.isAvailable(id)).length;
        const stats = document.createElement('div');
        stats.className = 'evt-stats';
        stats.textContent = `${resolvedCount}/${total} resolved · ${availableCount} available now`;
        return stats;
    }

    private buildEventRow(eventId: string, node: EventGraphNode, showSource: boolean): HTMLElement {
        const state = this.#state;
        if (!state) return document.createElement('div');
        const isResolved = state.resolvedIds.has(eventId);
        const isAvail = this.isAvailable(eventId);

        const row = document.createElement('div');
        row.className = `evt-row ${isResolved ? 'resolved' : isAvail ? 'available' : 'locked'}`;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.eventId = eventId;
        cb.checked = isResolved;
        cb.disabled = !isResolved && !isAvail;
        row.appendChild(cb);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'evt-name';
        nameSpan.textContent = node.name;
        row.appendChild(nameSpan);

        if (showSource && node.source) {
            const srcSpan = document.createElement('span');
            srcSpan.className = 'evt-src';
            srcSpan.textContent = node.source;
            row.appendChild(srcSpan);
        } else if (!showSource && node.location) {
            const locSpan = document.createElement('span');
            locSpan.className = 'evt-loc';
            locSpan.textContent = node.location;
            row.appendChild(locSpan);
        }

        if (node.is_day_end) {
            const de = document.createElement('span');
            de.className = 'evt-day-end';
            de.textContent = '[DAY END]';
            row.appendChild(de);
        }

        const wrap = document.createElement('div');
        wrap.appendChild(row);

        if (!isResolved && !isAvail) {
            const reasonsHtml = this.getBlockingReasonsHtml(eventId);
            if (reasonsHtml) {
                const reasonsContainer = document.createElement('div');
                reasonsContainer.innerHTML = reasonsHtml;
                while (reasonsContainer.firstChild) {
                    wrap.appendChild(reasonsContainer.firstChild);
                }
            }
        }

        return wrap;
    }

    // ── Timeline tab ──

    private buildTimelineContent(): HTMLElement {
        const state = this.#state;
        if (!state) return document.createElement('div');
        const container = document.createElement('div');
        container.classList.add('evt-body');
        container.appendChild(this.buildStats());

        const currentDay = this.getCurrentDay();

        const groupMap = new Map<string, { eventId: string; node: EventGraphNode }[]>();
        for (const [eventId, node] of Object.entries(state.graph)) {
            const src = node.source || 'Unknown';
            if (!groupMap.has(src)) groupMap.set(src, []);
            groupMap.get(src)?.push({ eventId, node });
        }

        const sorted = [...groupMap.entries()].sort(([a], [b]) => {
            return EventTrackerApplication.sourceSortKey(a) - EventTrackerApplication.sourceSortKey(b)
                || a.localeCompare(b);
        });

        for (const [groupName, events] of sorted) {
            const dayNum = EventTrackerApplication.sourceDayNumber(groupName);
            const isCurrent = dayNum === currentDay;
            const isFuture = dayNum !== null && dayNum > currentDay;

            const groupEl = document.createElement('div');
            groupEl.className = `evt-group${isCurrent ? ' evt-current-day' : ''}${isFuture ? ' evt-future' : ''}`;
            groupEl.dataset.groupName = groupName;

            const header = document.createElement('h3');
            header.textContent = groupName;
            if (isCurrent) {
                const tag = document.createElement('span');
                tag.className = 'evt-today-tag';
                tag.textContent = ' ← TODAY';
                header.appendChild(tag);
            }

            const resolved = events.filter((e) => state.resolvedIds.has(e.eventId)).length;
            const badge = document.createElement('span');
            badge.className = 'evt-group-badge';
            badge.textContent = ` (${resolved}/${events.length})`;
            header.appendChild(badge);
            groupEl.appendChild(header);

            for (const { eventId, node } of events) {
                groupEl.appendChild(this.buildEventRow(eventId, node, false));
            }
            container.appendChild(groupEl);
        }

        return container;
    }

    // ── Location tab ──

    private buildLocationContent(): HTMLElement {
        const state = this.#state;
        if (!state) return document.createElement('div');
        const container = document.createElement('div');
        container.classList.add('evt-body');
        container.appendChild(this.buildStats());

        const activeScene = this.getActiveSceneName();

        const groupMap = new Map<string, { eventId: string; node: EventGraphNode }[]>();
        for (const [eventId, node] of Object.entries(state.graph)) {
            const loc = node.location || 'No Location';
            if (!groupMap.has(loc)) groupMap.set(loc, []);
            groupMap.get(loc)?.push({ eventId, node });
        }

        const hasAvailable = (events: { eventId: string }[]): boolean =>
            events.some((e) => !state.resolvedIds.has(e.eventId) && this.isAvailable(e.eventId));

        const sorted = [...groupMap.entries()].sort(([a, evtsA], [b, evtsB]) => {
            if (a === activeScene) return -1;
            if (b === activeScene) return 1;
            const aAvail = hasAvailable(evtsA);
            const bAvail = hasAvailable(evtsB);
            if (aAvail !== bAvail) return aAvail ? -1 : 1;
            return a.localeCompare(b);
        });

        for (const [locationName, events] of sorted) {
            const isActive = locationName === activeScene;

            const groupEl = document.createElement('div');
            groupEl.className = `evt-group${isActive ? ' evt-active-scene' : ''}`;
            groupEl.dataset.groupName = locationName;

            const header = document.createElement('div');
            header.className = 'evt-loc-header';

            const h3 = document.createElement('h3');
            h3.textContent = locationName;
            if (isActive) {
                const tag = document.createElement('span');
                tag.className = 'evt-scene-tag';
                tag.textContent = ' ← ACTIVE SCENE';
                h3.appendChild(tag);
            }
            const resolved = events.filter((e) => state.resolvedIds.has(e.eventId)).length;
            const badge = document.createElement('span');
            badge.className = 'evt-group-badge';
            badge.textContent = ` (${resolved}/${events.length})`;
            h3.appendChild(badge);
            header.appendChild(h3);

            if (locationName !== 'No Location') {
                const scene = this.findScene(locationName);
                const btn = document.createElement('button');
                btn.className = 'evt-scene-btn';
                btn.dataset.location = locationName;
                if (scene) {
                    btn.dataset.sceneAction = 'go';
                    btn.innerHTML = '<i class="fas fa-eye"></i> Go to Scene';
                } else {
                    btn.dataset.sceneAction = 'spawn';
                    btn.innerHTML = '<i class="fas fa-plus"></i> Spawn Scene';
                }
                header.appendChild(btn);
            }

            groupEl.appendChild(header);

            for (const { eventId, node } of events) {
                groupEl.appendChild(this.buildEventRow(eventId, node, true));
            }
            container.appendChild(groupEl);
        }

        return container;
    }

    // ── Relations tab ──

    private getActiveDisposition(npc: NpcDisposition): DispositionEntry {
        const state = this.#state;
        if (!state) return npc.states[0];

        let active = npc.states.find((e) => e.default);
        for (const entry of npc.states) {
            if (entry.trigger && state.resolvedIds.has(entry.trigger)) {
                active = entry;
            }
        }
        return active ?? npc.states[0];
    }

    private buildRelationsContent(): HTMLElement {
        const state = this.#state;
        if (!state) return document.createElement('div');
        const container = document.createElement('div');
        container.classList.add('evt-body');

        if (Object.keys(state.dispositions).length === 0) {
            container.innerHTML = '<p style="padding:8px;color:#888;">No NPC dispositions configured.</p>';
            return container;
        }

        const attitudeColors: Record<string, string> = {
            cooperative: '#2d6', warm: '#2d6', professional: '#6af', reserved: '#888',
            helpful: '#6af', grateful: '#2d6', trusting: '#2d6', observant: '#6af',
            candid: '#2d6', curious: '#c9f', open: '#c9f', missing: '#666', hidden: '#666',
            dismissed: '#888', anxious: '#c96', defensive: '#c66', evasive: '#c96',
            controlled: '#c66', disrupted: '#c9f', obstructive: '#c66', guarded: '#c96',
            distressed: '#c66', desperate: '#f66', cornered: '#f44', hostile: '#f22',
        };

        for (const [charName, npc] of Object.entries(state.dispositions)) {
            const active = this.getActiveDisposition(npc);
            const color = attitudeColors[active.attitude] ?? '#aaa';

            const card = document.createElement('div');
            card.className = 'evt-rel-card';

            // Header: name + computed party attitude
            const header = document.createElement('div');
            header.className = 'evt-rel-header';
            header.innerHTML = `<span class="evt-rel-name">${charName}</span>`
                + `<span class="evt-rel-attitude" style="color:${color}">${active.attitude.toUpperCase()}</span>`;
            card.appendChild(header);

            const note = document.createElement('div');
            note.className = 'evt-rel-note';
            note.textContent = active.note;
            card.appendChild(note);

            if (active.trigger) {
                const triggerNode = state.graph[active.trigger];
                const triggerDiv = document.createElement('div');
                triggerDiv.className = 'evt-rel-trigger';
                triggerDiv.textContent = `Triggered by: ${triggerNode?.name ?? active.trigger}`;
                card.appendChild(triggerDiv);
            }

            const currentIdx = npc.states.indexOf(active);
            const nextEntry = npc.states.slice(currentIdx + 1).find((e) => e.trigger && !state.resolvedIds.has(e.trigger));
            if (nextEntry?.trigger) {
                const nextNode = state.graph[nextEntry.trigger];
                const nextDiv = document.createElement('div');
                nextDiv.className = 'evt-rel-next';
                nextDiv.textContent = `Next shift: ${nextEntry.attitude} (if ${nextNode?.name ?? nextEntry.trigger})`;
                card.appendChild(nextDiv);
            }

            // Per-PC attitudes — auto-populated from world actors
            if (state.pcNames.length > 0) {
                const attSection = document.createElement('div');
                attSection.className = 'evt-rel-attitudes';

                for (const pcName of state.pcNames) {
                    const row = document.createElement('div');
                    row.className = 'evt-att-row';

                    const label = document.createElement('label');
                    label.className = 'evt-att-label';
                    label.textContent = `${pcName}:`;
                    row.appendChild(label);

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'evt-att-input';
                    input.value = npc.pcAttitudes[pcName] ?? 'Not Met';
                    input.placeholder = 'Not Met';
                    input.dataset.char = charName;
                    input.dataset.attKey = pcName;
                    row.appendChild(input);

                    attSection.appendChild(row);
                }

                card.appendChild(attSection);
            }

            container.appendChild(card);
        }

        return container;
    }

    // ── Styles ──

    private buildStyleElement(): HTMLStyleElement {
        const style = document.createElement('style');
        style.textContent = `
            .event-tracker {
                font-family: var(--font-primary); font-size: 13px;
                user-select: text; -webkit-user-select: text;
            }

            /* Day bar */
            .evt-day-bar {
                display: flex; align-items: center; justify-content: center; gap: 12px;
                padding: 6px 8px; border-bottom: 1px solid #444; background: rgba(0,0,0,0.15);
            }
            .evt-day-bar button {
                background: none; border: 1px solid #666; color: #ccc; border-radius: 3px;
                padding: 2px 8px; cursor: pointer; font-size: 12px;
            }
            .evt-day-bar button:hover { border-color: #aaa; color: #fff; }
            .evt-day-label { font-size: 13px; color: #ccc; }
            .evt-day-label strong { color: #fff; }

            /* Tab bar */
            .evt-tab-bar {
                display: flex; border-bottom: 2px solid #444; padding: 0 8px;
            }
            .evt-tab-btn {
                background: none; border: none; color: #888; padding: 6px 14px; cursor: pointer;
                font-size: 13px; border-bottom: 2px solid transparent; margin-bottom: -2px;
            }
            .evt-tab-btn:hover { color: #ccc; }
            .evt-tab-btn.active { color: #fff; border-bottom-color: #6af; }

            /* Content body */
            .evt-body { max-height: 65vh; overflow-y: auto; padding: 0 8px 8px; }
            .evt-stats { padding: 6px 0 10px; font-size: 12px; color: #aaa; border-bottom: 1px solid #444; margin-bottom: 8px; }

            /* Groups */
            .evt-group { margin-bottom: 14px; }
            .evt-group h3 { margin: 0 0 4px; font-size: 14px; border-bottom: 1px solid #555; padding-bottom: 3px; }
            .evt-group-badge { font-size: 11px; color: #888; font-weight: normal; }

            /* Current day / active scene highlights */
            .evt-current-day { background: rgba(100,170,255,0.06); border-radius: 4px; padding: 4px 6px; }
            .evt-current-day h3 { border-bottom-color: #6af; }
            .evt-today-tag { font-size: 11px; color: #6af; font-weight: normal; margin-left: 4px; }
            .evt-future { opacity: 0.4; }

            .evt-active-scene { background: rgba(100,255,170,0.06); border-radius: 4px; padding: 4px 6px; }
            .evt-active-scene h3 { border-bottom-color: #2d6; }
            .evt-scene-tag { font-size: 11px; color: #2d6; font-weight: normal; margin-left: 4px; }

            /* Location header with scene button */
            .evt-loc-header { display: flex; align-items: center; gap: 8px; }
            .evt-loc-header h3 { flex: 1; }
            .evt-scene-btn {
                background: none; border: 1px solid #666; color: #aaa; border-radius: 3px;
                padding: 2px 8px; cursor: pointer; font-size: 11px; white-space: nowrap;
            }
            .evt-scene-btn:hover { border-color: #aaa; color: #fff; }

            /* Event rows */
            .evt-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
            .evt-row.resolved { opacity: 0.45; text-decoration: line-through; }
            .evt-row.locked { color: #999; }
            .evt-row.available { color: #2d6; font-weight: bold; }
            .evt-name { flex: 1; }
            .evt-src { font-size: 11px; color: #68c; white-space: nowrap; }
            .evt-loc { font-size: 11px; color: #888; white-space: nowrap; }
            .evt-day-end { font-size: 10px; color: #68c; margin-left: 4px; white-space: nowrap; }
            .evt-block { font-size: 11px; color: #c66; padding: 1px 0; line-height: 1.5; }
            .evt-block strong { font-weight: 600; color: #daa; }
            .evt-block-met { color: #696; text-decoration: line-through; opacity: 0.6; }
            .evt-block-label { color: #aaa; font-style: italic; }
            .evt-excuse-inline { color: #c96; font-style: normal; }
            .evt-xlink { color: #6af; cursor: pointer; text-decoration: underline; text-decoration-style: dotted; }
            .evt-xlink:hover { color: #9cf; }
            .evt-flash { animation: evt-highlight 1.5s ease-out; }
            @keyframes evt-highlight { 0% { background: rgba(100,170,255,0.25); } 100% { background: transparent; } }
            .evt-row input[type="checkbox"] { margin: 0; }
            .evt-row input[type="checkbox"]:disabled { opacity: 0.3; }

            /* Relations tab */
            .evt-rel-card {
                border: 1px solid #444; border-radius: 4px; padding: 8px 10px;
                margin-bottom: 8px; background: rgba(0,0,0,0.1);
            }
            .evt-rel-header {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 4px;
            }
            .evt-rel-name { font-weight: bold; font-size: 14px; }
            .evt-rel-attitude { font-size: 12px; font-weight: bold; letter-spacing: 0.5px; }
            .evt-rel-note { font-size: 12px; color: #ccc; margin-bottom: 4px; }
            .evt-rel-trigger { font-size: 11px; color: #888; font-style: italic; }
            .evt-rel-next { font-size: 11px; color: #68c; margin-top: 2px; }
            .evt-rel-attitudes { margin-top: 6px; padding-top: 6px; border-top: 1px solid #333; }
            .evt-att-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
            .evt-att-label { font-size: 11px; color: #aaa; min-width: 80px; text-align: right; }
            .evt-att-input {
                flex: 1; background: rgba(0,0,0,0.2); border: 1px solid #444; color: #ccc;
                padding: 2px 6px; font-size: 12px; border-radius: 2px;
            }
            .evt-att-input:focus { border-color: #6af; outline: none; }
        `;
        return style;
    }
}
