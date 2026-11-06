import path from 'node:path';
const list = (value, fallback) =>
  value
    ? value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : fallback;
export function loadConfig(env = process.env) {
  if (!env.YGO_DATA_DIR)
    throw new Error('请在 .env 中设置 YGO_DATA_DIR（项目外的数据目录），参考 .env.example');
  return {
    data: path.resolve(env.YGO_DATA_DIR),
    legacy: env.YGO_LEGACY_DATA_DIR && path.resolve(env.YGO_LEGACY_DATA_DIR),
    port: Number(env.YGO_PORT || 18081),
    host: env.YGO_HOST || '0.0.0.0',
    concurrency: Math.max(1, Math.min(12, Number(env.YGO_DOWNLOAD_CONCURRENCY) || 4)),
    interval: Math.max(1, Number(env.YGO_CHECK_INTERVAL_HOURS) || 6) * 3600000,
    autoUpdate: env.YGO_AUTO_UPDATE !== '0',
    origins: list(env.YGO_ALLOWED_ORIGINS, []),
    aiServer: env.YGO_AI_SERVER || 'wss://koishi.momobako.com:7211',
    aiVersion: Number(env.YGO_AI_VERSION || 4962),
    database: list(env.YGO_DATABASE_URLS, [
      'https://cdncf.moecube.com/ygopro-database/zh-CN/cards.cdb',
      'https://cdn02.moecube.com:444/ygopro-database/zh-CN/cards.cdb',
    ]),
    images: list(env.YGO_IMAGE_BASES, [
      'https://cdncf.moecube.com/images/ygopro-images-zh-CN',
      'https://cdn02.moecube.com:444/images/ygopro-images-zh-CN',
    ]),
    scriptsRef:
      env.YGO_SCRIPTS_VERSION_URL ||
      'https://api.github.com/repos/ProjectIgnis/CardScripts/commits/master',
    scriptsArchives: list(env.YGO_SCRIPTS_ARCHIVE_URLS, [
      'https://codeload.github.com/ProjectIgnis/CardScripts/zip/{sha}',
      'https://github.com/ProjectIgnis/CardScripts/archive/{sha}.zip',
    ]),
    scriptsArchive: (sha) => `https://codeload.github.com/ProjectIgnis/CardScripts/zip/${sha}`,
    strings: [
      'https://cdncf.moecube.com/ygopro-database/zh-CN/strings.conf',
      'https://cdn02.moecube.com:444/ygopro-database/zh-CN/strings.conf',
    ],
    banlist: [
      'https://cdncf.moecube.com/ygopro-database/zh-CN/lflist.conf',
      'https://cdn02.moecube.com:444/ygopro-database/zh-CN/lflist.conf',
    ],
  };
}
