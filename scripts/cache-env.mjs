import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
for (const [name, folder] of Object.entries({ TMPDIR: 'tmp', TMP: 'tmp', TEMP: 'tmp', XDG_CACHE_HOME: 'xdg', XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', npm_config_cache: 'npm' })) {
  process.env[name] = resolve('.cache', folder); mkdirSync(process.env[name], { recursive: true });
}
