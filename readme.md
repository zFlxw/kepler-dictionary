# Kepler Dictionary Plugin

A [Kepler](https://trykepler.app) plugin that lets you look up words across multiple dictionaries without leaving your keyboard.

## What it does

Type `/dict` in Kepler to open the dictionary search mode, then enter any word to query your enabled dictionary sources simultaneously.

**Supported sources:**

| Source                                       | Language | Data                                        |
| -------------------------------------------- | -------- | ------------------------------------------- |
| [Duden](https://www.duden.de)                | German   | Word, grammatical class, link to full entry |
| [DWDS](https://www.dwds.de)                  | German   | Headword + definitions from the article     |
| [Free Dictionary](https://dictionaryapi.dev) | English  | Definitions with part of speech             |

Each result shows the source as a badge and opens the full dictionary entry in your browser when selected.

When no query has been entered yet, the search mode shows how many sources are currently active.

## Installation

**Requirements:** [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io)

```bash
git clone https://github.com/zFlxw/kepler-dictionary.git
cd kepler-dictionary
pnpm install
pnpm build
```

The build step bundles the plugin and writes it to:

```
~/Library/Application Support/Kepler/Plugins/flxws-kepler-dictionary.keplugin/
```

Then in Kepler:

1. Open Settings → Plugins
2. Enable **Community Plugins** if not already active
3. The Dictionary plugin should appear in the list — enable it
4. Use `/dict` or type `dictionary` in the global search to open it

After any code change, run `pnpm build` again and reload the plugin in Kepler.

## Configuration

In the plugin settings you can toggle each source on or off individually:

- **Enable Duden** — on by default
- **Enable DWDS** — on by default
- **Enable Free Dictionary (English)** — on by default
