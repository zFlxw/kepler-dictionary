import { Action, Accessory, Command, Icon } from '@kepler-app/plugin-sdk';
import type { PluginContext, PluginListItem } from '@kepler-app/plugin-sdk';
import { Feature } from '.';

const enum Setting {
  DUDEN = 'dict-duden-toggle',
  DWDS = 'dict-dwds-toggle',
  WIKTIONARY = 'dict-wiktionary-toggle',
}

/**
 * How long a source stays skipped after it fails.
 *
 * Every enabled source is queried in parallel and the mode can only return
 * once they all settle, so a source whose host hangs holds the whole result
 * set for the runtime's ~10s fetch timeout — long enough that Kepler gives up
 * first and the user sees nothing at all. There are no timers in the runtime,
 * so a slow fetch cannot be raced against a deadline; remembering the failure
 * is what keeps one outage from costing more than a single slow query.
 */
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

type Source = {
  setting: Setting;
  name: string;
  query(word: string): Promise<PluginListItem[]>;
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + '…' : text;
}

function nowMs(ctx: PluginContext): number {
  const parsed = Date.parse(ctx.now);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function breakerKey(setting: Setting): string {
  return `breaker:${setting}`;
}

/** True while `setting`'s source is in cooldown after a recent failure. */
function isPaused(ctx: PluginContext, setting: Setting): boolean {
  const failedAt = ctx.storage.get<number>(breakerKey(setting));
  if (typeof failedAt !== 'number') return false;

  const elapsed = nowMs(ctx) - failedAt;
  // A backwards clock change would otherwise pause the source indefinitely.
  if (elapsed < 0 || elapsed >= BREAKER_COOLDOWN_MS) {
    ctx.storage.delete(breakerKey(setting));
    return false;
  }
  return true;
}

/**
 * Fetch a source document. Returns null for 404, which every source here uses
 * to mean "no such entry" — a miss, not a failure, so it must not trip the
 * breaker. Any other non-2xx is a genuine fault and throws.
 */
async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return await res.text();
}

const HTML_ACCEPT = { 'Accept': 'text/html,application/xhtml+xml' };

async function queryDuden(word: string): Promise<PluginListItem[]> {
  const searchUrl = `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(word)}`;
  const html = await fetchText(searchUrl, HTML_ACCEPT);
  if (html === null) return [];

  const results: PluginListItem[] = [];

  // Duden search uses <section class="vignette">, not <article>
  const sectionRegex = /<section[^>]*class="[^"]*vignette[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(html)) !== null && results.length < 3) {
    const sectionHtml = match[1];
    // Word is in <a class="vignette__label"> … <strong>Word</strong> … </a>
    const labelMatch = sectionHtml.match(/class="vignette__label"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/);
    const snippetMatch = sectionHtml.match(/class="vignette__snippet"[^>]*>([\s\S]*?)<\/p>/);
    const hrefMatch = sectionHtml.match(/href="(\/(?:rechtschreibung|bedeutung)\/[^"]+)"/);

    if (!labelMatch) continue;

    const title = stripHtml(labelMatch[1]);
    const subtitle = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    const href = hrefMatch
      ? `https://www.duden.de${hrefMatch[1]}`
      : searchUrl;

    results.push({
      id: `duden-${results.length}`,
      title,
      subtitle,
      icon: Icon.sfSymbol('book'),
      action: Action.url(href),
      accessory: Accessory.badge('Duden'),
    });
  }

  return results;
}

async function queryDWDS(word: string): Promise<PluginListItem[]> {
  // The DWDS JSON API is login-gated; scrape the word page directly instead
  const wordUrl = `https://www.dwds.de/wb/${encodeURIComponent(word)}`;
  const html = await fetchText(wordUrl, HTML_ACCEPT);
  if (html === null) return [];

  // dwdswb-stichwort holds the canonical headword
  const stichwortMatch = html.match(/class="dwdswb-stichwort"[^>]*>([\s\S]*?)<\/span>/);
  const lemmaMatch = html.match(/class="dwdswb-ft-lemmaansatz"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/);
  const lemma = stichwortMatch
    ? stripHtml(stichwortMatch[1])
    : lemmaMatch ? stripHtml(lemmaMatch[1]) : word;

  // dwdswb-definition spans are present on every word page regardless of article structure
  const defMatches = [...html.matchAll(/class="dwdswb-definition"[^>]*>([\s\S]*?)<\/span>/g)];

  return defMatches.slice(0, 3).map((m, i) => ({
    id: `dwds-${i}`,
    title: lemma,
    subtitle: truncate(stripHtml(m[1]), 120),
    icon: Icon.sfSymbol('book.fill'),
    action: Action.url(wordUrl),
    accessory: Accessory.badge('DWDS'),
  }));
}

type WiktionaryEntry = {
  partOfSpeech?: string;
  definitions?: Array<{ definition?: string }>;
};

async function queryWiktionary(word: string): Promise<PluginListItem[]> {
  const apiUrl = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  const body = await fetchText(apiUrl);
  if (body === null) return [];

  // Definitions are grouped by language code; this source covers English only.
  const byLanguage = JSON.parse(body) as Record<string, WiktionaryEntry[] | undefined>;
  const entries = byLanguage.en ?? [];

  const results: PluginListItem[] = [];
  for (const entry of entries) {
    for (const def of entry.definitions ?? []) {
      // Definitions arrive as HTML with wiki links threaded through them.
      const text = stripHtml(def.definition ?? '');
      if (!text) continue;

      results.push({
        id: `wiktionary-${results.length}`,
        title: word,
        subtitle: truncate(entry.partOfSpeech ? `[${entry.partOfSpeech}] ${text}` : text, 120),
        icon: Icon.sfSymbol('globe'),
        action: Action.url(`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`),
        accessory: Accessory.badge('EN'),
      });
      if (results.length >= 3) return results;
    }
  }
  return results;
}

const SOURCES: Source[] = [
  { setting: Setting.DUDEN, name: 'Duden', query: queryDuden },
  { setting: Setting.DWDS, name: 'DWDS', query: queryDWDS },
  { setting: Setting.WIKTIONARY, name: 'Wiktionary', query: queryWiktionary },
];

/** Runs one source, tripping or clearing its breaker. Never rejects. */
async function runSource(source: Source, word: string, ctx: PluginContext): Promise<PluginListItem[]> {
  try {
    const items = await source.query(word);
    ctx.storage.delete(breakerKey(source.setting));
    return items;
  } catch {
    ctx.storage.set(breakerKey(source.setting), nowMs(ctx));
    return [];
  }
}

export const dictionary: Feature = {
  settings: [
    {
      id: Setting.DUDEN,
      kind: 'toggle',
      title: 'Enable Duden',
      description: 'Search the Duden German dictionary',
      defaultValue: true,
    },
    {
      id: Setting.DWDS,
      kind: 'toggle',
      title: 'Enable DWDS',
      description: 'Search the DWDS German dictionary (dwds.de)',
      defaultValue: true,
    },
    {
      id: Setting.WIKTIONARY,
      kind: 'toggle',
      title: 'Enable Wiktionary (English)',
      description: 'Search English definitions from Wiktionary',
      defaultValue: true,
    },
  ],
  searchModes: [
    Command.search({
      id: 'dict-mode',
      title: 'Dictionary',
      icon: Icon.sfSymbol('books.vertical'),
      subtitle: 'Look up words across multiple dictionaries',
      keywords: ['dictionary', 'dict', 'define', 'wörterbuch', 'nachschlagen'],
      shortcutPrefix: 'dict',
      async run(query, ctx) {
        const enabled = SOURCES.filter(s => ctx.settings[s.setting]);
        const paused = enabled.filter(s => isPaused(ctx, s.setting));
        const active = enabled.filter(s => !paused.includes(s));
        const pausedNote = paused.length > 0
          ? ` — paused after errors: ${paused.map(s => s.name).join(', ')}`
          : '';

        if (!query.normalized) {
          const count = active.length;
          const names = active.map(s => s.name).join(', ');
          return [
            {
              id: 'dict-status',
              title: `${count} source${count !== 1 ? 's' : ''} loaded`,
              subtitle: count > 0
                ? `Active: ${names}${pausedNote}`
                : `No sources enabled — check plugin settings${pausedNote}`,
              icon: Icon.sfSymbol('books.vertical'),
            },
          ];
        }

        const settled = await Promise.allSettled(
          active.map(s => runSource(s, query.normalized, ctx)),
        );
        const all = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));

        if (all.length === 0) {
          return [
            {
              id: 'dict-no-results',
              title: 'No results found',
              subtitle: `No definitions found for "${query.raw}"${pausedNote}`,
              icon: Icon.sfSymbol('magnifyingglass'),
            },
          ];
        }

        return all;
      },
    }),
  ],
};
