import { definePlugin, Icon, KeplerPluginMeta } from '@kepler-app/plugin-sdk';
import { registerFeatures } from './features';
import { dictionary } from './features/dictionary';
import config from '../plugin.config.json';

const features = [dictionary];
const { settings, ...registrations } = registerFeatures(features);

const metadata: KeplerPluginMeta = {
  id: config.id,
  name: config.name,
  version: config.version,
  author: config.author,
  icon: Icon.sfSymbol(config.icon),
  permissions: ['network'],
  networkUrls: ['www.duden.de', 'www.dwds.de', 'api.dictionaryapi.dev'],
  settings,
};

export default definePlugin({ metadata, ...registrations });
