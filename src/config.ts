import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR_NAME = 'gcalendar-webhook-cli';

const getConfigDir = (): string => {
  const xdg = process.env.XDG_CONFIG_HOME;
  const baseDir = xdg && xdg.trim().length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(baseDir, CONFIG_DIR_NAME);
};

export const paths = {
  configDir: getConfigDir(),
  tokensFile: path.join(getConfigDir(), 'tokens.json'),
  channelsFile: path.join(getConfigDir(), 'channels.json'),
};

export const ensureConfigDir = (): void => {
  if (!fs.existsSync(paths.configDir)) {
    fs.mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  }
};

export const writeJsonAtomically = (filePath: string, data: unknown): void => {
  ensureConfigDir();
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
};

export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};
