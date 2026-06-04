import { Action, Accessory, Command, Icon } from '@kepler-app/plugin-sdk';
import type { PluginListItem } from '@kepler-app/plugin-sdk';
import { Feature } from '.';

const enum Setting {
  DUDEN = 'dict-duden-toggle',
  DWDS = 'dict-dwds-toggle',
  OXFORD = 'dict-oxford-toggle',
}

const SOURCES = [
  { setting: Setting.DUDEN, name: 'Duden' },
  { setting: Setting.DWDS, name: 'DWDS' },
  { setting: Setting.OXFORD, name: 'Free Dictionary' },
] as const;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function queryDuden(word: string): Promise<PluginListItem[]> {
  try {
    const searchUrl = `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(word)}`;
    const res = await fetch(searchUrl, {
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return [];

    const html = await res.text();
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
  } catch {
    return [];
  }
}

async function queryDWDS(word: string): Promise<PluginListItem[]> {
  try {
    // The DWDS JSON API is login-gated; scrape the word page directly instead
    const wordUrl = `https://www.dwds.de/wb/${encodeURIComponent(word)}`;
    const res = await fetch(wordUrl, {
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return [];

    const html = await res.text();

    // dwdswb-stichwort holds the canonical headword
    const stichwortMatch = html.match(/class="dwdswb-stichwort"[^>]*>([\s\S]*?)<\/span>/);
    const lemmaMatch = html.match(/class="dwdswb-ft-lemmaansatz"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/);
    const lemma = stichwortMatch
      ? stripHtml(stichwortMatch[1])
      : lemmaMatch ? stripHtml(lemmaMatch[1]) : word;

    // dwdswb-definition spans are present on every word page regardless of article structure
    const defMatches = [...html.matchAll(/class="dwdswb-definition"[^>]*>([\s\S]*?)<\/span>/g)];
    if (defMatches.length === 0) return [];

    return defMatches.slice(0, 3).map((m, i) => {
      const def = stripHtml(m[1]);
      return {
        id: `dwds-${i}`,
        title: lemma,
        subtitle: def.length > 120 ? def.slice(0, 117) + '…' : def,
        icon: Icon.sfSymbol('book.fill'),
        action: Action.url(wordUrl),
        accessory: Accessory.badge('DWDS'),
      };
    });
  } catch {
    return [];
  }
}

async function queryFreeDictionary(word: string): Promise<PluginListItem[]> {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json<any[]>();
    if (!Array.isArray(data) || data.length === 0) return [];

    const results: PluginListItem[] = [];
    for (const entry of data.slice(0, 2)) {
      for (const meaning of (entry.meanings ?? []).slice(0, 2)) {
        const def = meaning.definitions?.[0];
        if (!def) continue;
        const phonetic = entry.phonetic ? ` ${entry.phonetic}` : '';
        results.push({
          id: `oxford-${results.length}`,
          title: `${entry.word}${phonetic}`,
          subtitle: `[${meaning.partOfSpeech}] ${def.definition}`,
          icon: Icon.sfSymbol('globe'),
          action: Action.url((entry.sourceUrls ?? [])[0] ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`),
          accessory: Accessory.badge('EN'),
        });
        if (results.length >= 3) break;
      }
      if (results.length >= 3) break;
    }
    return results;
  } catch {
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
      id: Setting.OXFORD,
      kind: 'toggle',
      title: 'Enable Free Dictionary (English)',
      description: 'Search the Free English Dictionary (dictionaryapi.dev)',
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
        const enabledSources = SOURCES.filter(s => ctx.settings[s.setting]);

        if (!query.normalized) {
          const count = enabledSources.length;
          const names = enabledSources.map(s => s.name).join(', ');
          return [
            {
              id: 'dict-status',
              title: `${count} source${count !== 1 ? 's' : ''} loaded`,
              subtitle: count > 0
                ? `Active: ${names}`
                : 'No sources enabled — check plugin settings',
              icon: Icon.sfSymbol('books.vertical'),
            },
          ];
        }

        const [dudenResults, dwdsResults, oxfordResults] = await Promise.all([
          ctx.settings[Setting.DUDEN] ? queryDuden(query.normalized) : Promise.resolve([]),
          ctx.settings[Setting.DWDS] ? queryDWDS(query.normalized) : Promise.resolve([]),
          ctx.settings[Setting.OXFORD] ? queryFreeDictionary(query.normalized) : Promise.resolve([]),
        ]);

        const all = [...dudenResults, ...dwdsResults, ...oxfordResults];

        if (all.length === 0) {
          return [
            {
              id: 'dict-no-results',
              title: 'No results found',
              subtitle: `No definitions found for "${query.raw}"`,
              icon: Icon.sfSymbol('magnifyingglass'),
            },
          ];
        }

        return all;
      },
    }),
  ],
};
