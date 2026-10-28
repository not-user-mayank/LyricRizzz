const clickThroughButton = document.getElementById('click-through');
const songLabel = document.getElementById('song-label');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const lyricsList = document.getElementById('lyrics-list');
const lyricsMessage = document.getElementById('lyrics-message');
const lyricsSource = document.getElementById('lyrics-source');
const toast = document.getElementById('toast');
const opacitySlider = document.getElementById('opacity');
const offsetLabel = document.getElementById('offset-value');
const lockButton = document.getElementById('lock-position');
let mediaTimeline = { positionMs: 0, durationMs: 0, observedAt: 0, playbackStatus: 'paused' };
let lyricLines = [];
let lyricElements = [];
let isSyncedLyrics = false;
let activeLyricIndex = -2;
let lyricOffsetMs = 0;
let karaokeRowIndex = -1;
let karaokeWordElements = [];
const wordSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null;

opacitySlider.addEventListener('input', (event) => {
  window.lyricrizzz.setOpacity(Number(event.target.value) / 100);
});
document.getElementById('settings').addEventListener('click', () => window.lyricrizzz.openSettings());
document.getElementById('offset-minus').addEventListener('click', () => adjustLyricsOffset(-500));
document.getElementById('offset-plus').addEventListener('click', () => adjustLyricsOffset(500));
lockButton.addEventListener('click', async () => {
  try {
    updatePositionLock(await window.lyricrizzz.setPositionLock(lockButton.getAttribute('aria-pressed') !== 'true'));
  } catch (error) {
    showToast(`Could not change position lock: ${error.message}`);
  }
});

document.getElementById('smaller').addEventListener('click', () => window.lyricrizzz.resize('smaller'));
document.getElementById('larger').addEventListener('click', () => window.lyricrizzz.resize('larger'));
document.getElementById('minimize').addEventListener('click', () => window.lyricrizzz.minimize());
document.getElementById('close').addEventListener('click', () => window.lyricrizzz.close());
document.getElementById('add-lyrics').addEventListener('click', async () => {
  try {
    const result = await window.lyricrizzz.chooseLyricsFile();
    if (result?.message && result.message !== 'Import cancelled.') showToast(result.message);
  } catch (error) {
    showToast(`Could not add lyrics: ${error.message}`);
  }
});

let dragDepth = 0;
let toastTimeout;
document.addEventListener('dragenter', (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('dragging-files');
});
document.addEventListener('dragover', (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging-files');
});
document.addEventListener('drop', async (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging-files');
  try {
    const paths = Array.from(event.dataTransfer.files || [])
      .map((file) => window.lyricrizzz.getDroppedFilePath(file))
      .filter(Boolean);
    if (paths.length === 0) {
      showToast('Could not read the dropped file path. Use the + button to browse instead.');
      return;
    }
    const result = await window.lyricrizzz.importDroppedFiles(paths);
    if (result?.message) showToast(result.message);
  } catch (error) {
    showToast(`Could not add lyrics: ${error.message}`);
  }
});

clickThroughButton.addEventListener('click', async () => {
  const enabled = await window.lyricrizzz.setClickThrough(clickThroughButton.getAttribute('aria-pressed') !== 'true');
  updateClickThrough(enabled);
});

window.lyricrizzz.onClickThroughChanged(updateClickThrough);
window.lyricrizzz.onMediaSessionChanged(updateMediaSession);
window.lyricrizzz.onLyricsChanged(updateLyrics);
window.lyricrizzz.onSettingsChanged(applyWidgetSettings);
window.lyricrizzz.getSettings().then(applyWidgetSettings).catch((error) => showToast(`Could not load settings: ${error.message}`));

function applyWidgetSettings(snapshot) {
  if (!snapshot?.settings || !snapshot?.themes) return;
  window.LyricrizzzTheme.applyAppearance(document.body, snapshot.settings, snapshot.themes, snapshot.backgroundDataUrl);
  opacitySlider.value = String(Math.round(snapshot.settings.widgetOpacity * 100));
  lyricOffsetMs = Number(snapshot.settings.offsetMs) || 0;
  updateOffsetLabel();
  updatePositionLock(Boolean(snapshot.settings.lockPosition));
}

function updateLyrics(payload) {
  const data = payload || { lines: [], message: 'No lyrics found for this song.' };
  resetKaraokeMarkup();
  lyricLines = Array.isArray(data.lines) ? data.lines : [];
  isSyncedLyrics = Boolean(data.synced);
  activeLyricIndex = -2;
  lyricsList.replaceChildren();
  lyricElements = lyricLines.map((line, index) => {
    const row = document.createElement('div');
    row.className = isSyncedLyrics ? 'lyric-row' : 'lyric-row unsynced';
    row.dataset.index = String(index);
    row.textContent = line.text;
    lyricsList.append(row);
    return row;
  });

  lyricsMessage.textContent = lyricLines.length ? '' : (data.message || 'No lyrics found for this song.');
  lyricsMessage.hidden = lyricLines.length > 0;
  lyricsSource.textContent = lyricLines.length
    ? `${data.source === 'online' ? 'LRCLIB' : 'LOCAL FILE'} · ${data.synced ? 'SYNCED' : 'UNSYNCED'}`
    : (data.format === 'pdf' ? 'PDF CONVERSION NEEDED' : 'LYRICS');
  lyricsSource.title = data.cacheMessage || '';
  if (data.cacheMessage) {
    lyricsSource.textContent += data.cacheMessage.includes('existing') ? ' · LOCAL COPY KEPT' : ' · COPY NOT SAVED';
  }
  if (isSyncedLyrics) updateActiveLyric();
}

function updateMediaSession(session) {
  if (!session || (!session.title && !session.artist)) {
    songLabel.textContent = 'WAITING FOR PLAYER';
    songLabel.className = 'song-label';
    songTitle.textContent = '♪ Waiting for song...';
    songArtist.textContent = '';
    mediaTimeline = { positionMs: 0, durationMs: 0, observedAt: performance.now(), playbackStatus: 'paused' };
    return;
  }

  const status = session.playbackStatus === 'playing' ? 'PLAYING' : 'PAUSED';
  songLabel.textContent = `${status} · ${session.appName}`;
  songLabel.className = `song-label song-status-${session.playbackStatus}`;
  songTitle.textContent = session.title || session.artist;
  songArtist.textContent = session.title && session.artist ? session.artist : '';
  mediaTimeline = {
    positionMs: Number(session.positionMs) || 0,
    durationMs: Number(session.durationMs) || 0,
    observedAt: performance.now(),
    playbackStatus: session.playbackStatus,
  };
  updateActiveLyric();
}

function getCurrentPositionMs() {
  const elapsed = mediaTimeline.playbackStatus === 'playing'
    ? performance.now() - mediaTimeline.observedAt
    : 0;
  const current = Math.max(0, mediaTimeline.positionMs + elapsed + lyricOffsetMs);
  return mediaTimeline.durationMs > 0 ? Math.min(current, mediaTimeline.durationMs) : current;
}

function updateActiveLyric() {
  if (!isSyncedLyrics || lyricLines.length === 0) return;
  const positionMs = getCurrentPositionMs();
  let low = 0;
  let high = lyricLines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lyricLines[middle].timeMs <= positionMs) {
      activeIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  updateKaraokeProgress(positionMs, activeIndex);
  if (activeIndex === activeLyricIndex) return;
  activeLyricIndex = activeIndex;

  lyricElements.forEach((row, index) => {
    row.classList.toggle('current', index === activeIndex);
    row.classList.toggle('previous', index === activeIndex - 1);
    row.classList.toggle('next', index === (activeIndex < 0 ? 0 : activeIndex + 1));
  });
  const target = lyricElements[activeIndex < 0 ? 0 : activeIndex];
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function getWordSegments(text) {
  if (wordSegmenter) {
    const segments = Array.from(wordSegmenter.segment(text));
    if (segments.some((item) => item.isWordLike)) return segments;
    return segments.map((item) => ({ segment: item.segment, isWordLike: true }));
  }
  return String(text).split(/(\s+)/u).map((segment) => ({ segment, isWordLike: !/^\s+$/u.test(segment) }));
}

function prepareKaraokeRow(index) {
  if (index < 0 || karaokeRowIndex === index) return;
  resetKaraokeMarkup();
  const row = lyricElements[index];
  if (!row) return;
  karaokeRowIndex = index;
  karaokeWordElements = [];
  for (const part of getWordSegments(lyricLines[index].text)) {
    if (!part.isWordLike) {
      row.append(document.createTextNode(part.segment));
      continue;
    }
    const word = document.createElement('span');
    word.className = 'karaoke-word';
    word.textContent = part.segment;
    row.append(word);
    karaokeWordElements.push(word);
  }
}

function resetKaraokeMarkup() {
  if (karaokeRowIndex >= 0 && lyricElements[karaokeRowIndex]) {
    lyricElements[karaokeRowIndex].textContent = lyricLines[karaokeRowIndex]?.text || '';
  }
  karaokeRowIndex = -1;
  karaokeWordElements = [];
}

function updateKaraokeProgress(positionMs, activeIndex) {
  if (activeIndex < 0) {
    resetKaraokeMarkup();
    return;
  }
  prepareKaraokeRow(activeIndex);
  if (karaokeWordElements.length === 0) return;

  const lineStart = lyricLines[activeIndex].timeMs;
  const nextLineStart = lyricLines[activeIndex + 1]?.timeMs;
  const end = nextLineStart > lineStart
    ? nextLineStart
    : mediaTimeline.durationMs > lineStart
      ? Math.min(mediaTimeline.durationMs, lineStart + 4000)
      : lineStart + 4000;
  const progress = Math.min(1, Math.max(0, (positionMs - lineStart) / Math.max(1, end - lineStart)));
  const wordProgress = progress * karaokeWordElements.length;
  const filledCount = Math.floor(wordProgress);
  const activeWordProgress = wordProgress - filledCount;

  karaokeWordElements.forEach((word, index) => {
    const filled = index < filledCount;
    word.classList.toggle('filled', filled);
    word.style.opacity = filled ? '' : index === filledCount ? String(0.38 + 0.62 * activeWordProgress) : '';
  });
}

async function adjustLyricsOffset(deltaMs) {
  try {
    lyricOffsetMs = await window.lyricrizzz.adjustOffset(deltaMs);
    updateOffsetLabel();
    updateActiveLyric();
  } catch (error) {
    showToast(`Could not adjust lyric timing: ${error.message}`);
  }
}

function updateOffsetLabel() {
  const seconds = lyricOffsetMs / 1000;
  offsetLabel.textContent = `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)}s`;
  offsetLabel.title = `Lyrics offset ${seconds.toFixed(1)} seconds`;
}

function updatePositionLock(locked) {
  lockButton.setAttribute('aria-pressed', String(locked));
  lockButton.textContent = locked ? '🔒' : '🔓';
  lockButton.title = locked ? 'Unlock widget position' : 'Lock widget position';
  lockButton.setAttribute('aria-label', lockButton.title);
}

function animateLyrics() {
  updateActiveLyric();
  requestAnimationFrame(animateLyrics);
}

requestAnimationFrame(animateLyrics);

function showToast(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function updateClickThrough(enabled) {
  clickThroughButton.setAttribute('aria-pressed', String(enabled));
  document.body.classList.toggle('click-through', enabled);
}
