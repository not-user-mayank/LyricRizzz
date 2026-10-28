const fs = require('node:fs/promises');
const path = require('node:path');

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const USER_AGENT = 'Lyricrizzz/1.0.0 (https://github.com/not-user-mayank/LyricRizzz)';
const REQUEST_TIMEOUT_MS = 8000;
const MIN_REQUEST_INTERVAL_MS = 300;
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
let rateLimitedUntil = 0;

function normalizeName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function safeFilePart(value) {
  const safe = String(value || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `_${safe}` : safe;
}

function parseLrc(content) {
  const lines = [];
  let offsetMs = 0;

  for (const rawLine of String(content).split(/\r?\n/)) {
    const offsetMatch = rawLine.match(/^\s*\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offsetMs = Number(offsetMatch[1]) || 0;
      continue;
    }

    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (!text) continue;

    for (const stamp of stamps) {
      const fraction = stamp[3] || '';
      const fractionMs = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
      const timeMs = Math.max(0, Number(stamp[1]) * 60_000 + Number(stamp[2]) * 1000 + fractionMs + offsetMs);
      lines.push({ timeMs, text });
    }
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function parseSrt(content) {
  const blocks = String(content).replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/);
  const lines = [];
  const timestamp = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/;

  for (const block of blocks) {
    const rows = block.split(/\r?\n/);
    const timeRow = rows.findIndex((row) => timestamp.test(row));
    if (timeRow < 0) continue;
    const match = rows[timeRow].match(timestamp);
    if (!match) continue;
    const fractionMs = (digits) => Number(String(digits).padEnd(3, '0').slice(0, 3));
    const timeMs = Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + fractionMs(match[4]);
    const text = rows.slice(timeRow + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    if (text) lines.push({ timeMs, text });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function parsePlainLyrics(content) {
  return String(content)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ timeMs: null, text }));
}

function resultFromContent(format, content, source) {
  const lines = format === 'lrc'
    ? parseLrc(content)
    : format === 'srt'
      ? parseSrt(content)
      : parsePlainLyrics(content);

  if (!lines.length) return null;
  return { source, format, synced: format !== 'txt', lines };
}

function localBaseName(artist, title) {
  return `${safeFilePart(artist)} - ${safeFilePart(title)}`.replace(/^[ -]+|[ -]+$/g, '');
}

function extractLrcMetadata(content) {
  const metadata = {};
  for (const line of String(content).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*\[(ar|ti):([^\]]*)\]/i);
    if (match) metadata[match[1].toLowerCase()] = match[2].trim();
  }
  return { artist: metadata.ar || '', title: metadata.ti || '' };
}

function sanitizeLocalBaseName(value) {
  return safeFilePart(value).replace(/^[ -]+|[ -]+$/g, '');
}

async function loadLocalLyrics(directory, artist, title) {
  const base = localBaseName(artist, title);
  if (!base || base === '-') return null;

  for (const extension of ['.lrc', '.srt', '.txt']) {
    const filePath = path.join(directory, `${base}${extension}`);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const result = resultFromContent(extension.slice(1), content, 'local');
      if (result) return result;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const pdfPath = path.join(directory, `${base}.pdf`);
  try {
    await fs.access(pdfPath);
    return { source: 'local', format: 'pdf', synced: false, lines: [], message: 'PDF lyrics are not supported yet. Convert the file to .lrc, .srt, or .txt.' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}

function lyricsRecordToResult(record, source) {
  if (!record || record.instrumental) return null;
  if (record.syncedLyrics) {
    const result = resultFromContent('lrc', record.syncedLyrics, source);
    if (result) return result;
  }
  if (record.plainLyrics) return resultFromContent('txt', record.plainLyrics, source);
  return null;
}

function matchesSearchRecord(record, artist, title) {
  const expectedTitle = normalizeName(title);
  const expectedArtist = normalizeName(artist);
  const resultTitle = normalizeName(record.trackName || record.name);
  const resultArtist = normalizeName(record.artistName);
  return resultTitle === expectedTitle && (!expectedArtist || resultArtist === expectedArtist || resultArtist.includes(expectedArtist));
}

async function performRequest(url) {
  if (Date.now() < rateLimitedUntil) {
    const seconds = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    const error = new Error(`LRCLIB asked Lyricrizzz to wait ${seconds} seconds before another request.`);
    error.code = 'RATE_LIMITED';
    throw error;
  }

  const waitMs = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const retrySeconds = retryAfter == null ? NaN : Number(retryAfter);
      const retryDate = retryAfter && !Number.isFinite(retrySeconds) ? Date.parse(retryAfter) : NaN;
      rateLimitedUntil = Number.isFinite(retrySeconds)
        ? Date.now() + Math.max(1, retrySeconds) * 1000
        : Number.isFinite(retryDate)
          ? retryDate
          : Date.now() + 60_000;
      const waitSeconds = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      const error = new Error(`LRCLIB is rate limiting requests. Try again in ${waitSeconds} seconds.`);
      error.code = 'RATE_LIMITED';
      throw error;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB request failed (${response.status}).`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function requestJson(url) {
  const request = requestQueue.then(() => performRequest(url));
  requestQueue = request.catch(() => {});
  return request;
}

async function fetchOnlineLyrics(track) {
  const artist = String(track.artist || '').trim();
  const title = String(track.title || '').trim();
  if (!title) return null;

  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (track.album) params.set('album_name', track.album);
  const durationSeconds = Math.round(Number(track.durationMs) / 1000);
  if (Number.isFinite(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 3600) params.set('duration', String(durationSeconds));

  if (artist && params.has('duration')) {
    const exact = await requestJson(`${LRCLIB_BASE_URL}/get?${params}`);
    if (exact) {
      const result = lyricsRecordToResult(exact, 'online');
      if (result) return { ...result, record: exact };
      return null;
    }
  }

  const query = new URLSearchParams({ q: [artist, title].filter(Boolean).join(' ') });
  const records = await requestJson(`${LRCLIB_BASE_URL}/search?${query}`);
  if (!Array.isArray(records)) return null;
  const match = records.find((record) => matchesSearchRecord(record, artist, title));
  const result = lyricsRecordToResult(match, 'online');
  return result ? { ...result, record: match } : null;
}

async function saveOnlineLyrics(directory, artist, title, result) {
  const extension = result.format === 'lrc' ? '.lrc' : '.txt';
  const base = localBaseName(artist, title);
  if (!base || base === '-') return;
  const filePath = path.join(directory, `${base}${extension}`);
  const content = result.format === 'lrc'
    ? result.lines.map((line) => {
      const totalHundredths = Math.max(0, Math.round(line.timeMs / 10));
      const minutes = Math.floor(totalHundredths / 6000);
      const seconds = Math.floor((totalHundredths % 6000) / 100);
      const hundredths = totalHundredths % 100;
      return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}] ${line.text}`;
    }).join('\n')
    : result.lines.map((line) => line.text).join('\n');
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(filePath, `${content}\n`, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

async function getLyrics(track, localDirectory) {
  try {
    await fs.mkdir(localDirectory, { recursive: true });
    const local = await loadLocalLyrics(localDirectory, track.artist, track.title);
    if (local) return local;
  } catch (error) {
    return { source: 'error', format: null, synced: false, lines: [], message: `Could not read local lyrics: ${error.message}` };
  }

  try {
    const online = await fetchOnlineLyrics(track);
    if (!online) return { source: 'none', format: null, synced: false, lines: [], message: 'No lyrics found for this song.' };
    let cacheMessage;
    try {
      const saved = await saveOnlineLyrics(localDirectory, track.artist, track.title, online);
      if (!saved) cacheMessage = 'An existing local file was kept.';
    } catch {
      cacheMessage = 'Lyrics found online, but the local copy could not be saved.';
    }
    const { record: _record, ...lyrics } = online;
    return cacheMessage ? { ...lyrics, cacheMessage } : lyrics;
  } catch (error) {
    return { source: 'error', format: null, synced: false, lines: [], message: error.message || 'Could not fetch lyrics.' };
  }
}

module.exports = {
  getLyrics,
  parseLrc,
  parseSrt,
  parsePlainLyrics,
  extractLrcMetadata,
  makeLocalBaseName: localBaseName,
  sanitizeLocalBaseName,
};
