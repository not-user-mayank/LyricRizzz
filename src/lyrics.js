const clickThroughButton = document.getElementById('click-through');
const songLabel = document.getElementById('song-label');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');
const lyricsList = document.getElementById('lyrics-list');
const lyricsMessage = document.getElementById('lyrics-message');
const lyricsSource = document.getElementById('lyrics-source');
let mediaTimeline = { positionMs: 0, durationMs: 0, observedAt: 0, playbackStatus: 'paused' };
let lyricLines = [];
let lyricElements = [];
let isSyncedLyrics = false;
let activeLyricIndex = -2;

document.getElementById('opacity').addEventListener('input', (event) => {
  window.lyricrizzz.setOpacity(Number(event.target.value) / 100);
});

document.getElementById('smaller').addEventListener('click', () => window.lyricrizzz.resize('smaller'));
document.getElementById('larger').addEventListener('click', () => window.lyricrizzz.resize('larger'));
document.getElementById('minimize').addEventListener('click', () => window.lyricrizzz.minimize());
document.getElementById('close').addEventListener('click', () => window.lyricrizzz.close());

clickThroughButton.addEventListener('click', async () => {
  const enabled = await window.lyricrizzz.setClickThrough(clickThroughButton.getAttribute('aria-pressed') !== 'true');
  updateClickThrough(enabled);
});

window.lyricrizzz.onClickThroughChanged(updateClickThrough);
window.lyricrizzz.onMediaSessionChanged(updateMediaSession);
window.lyricrizzz.onLyricsChanged(updateLyrics);

function updateLyrics(payload) {
  const data = payload || { lines: [], message: 'No lyrics found for this song.' };
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
  if (data.cacheMessage) lyricsSource.textContent += ' · COPY NOT SAVED';
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
  const current = mediaTimeline.positionMs + elapsed;
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

function animateLyrics() {
  updateActiveLyric();
  requestAnimationFrame(animateLyrics);
}

requestAnimationFrame(animateLyrics);

function updateClickThrough(enabled) {
  clickThroughButton.setAttribute('aria-pressed', String(enabled));
  document.body.classList.toggle('click-through', enabled);
}
