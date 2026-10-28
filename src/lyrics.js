const clickThroughButton = document.getElementById('click-through');
const songLabel = document.getElementById('song-label');
const songTitle = document.getElementById('song-title');
const songArtist = document.getElementById('song-artist');

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

function updateMediaSession(session) {
  if (!session || (!session.title && !session.artist)) {
    songLabel.textContent = 'WAITING FOR PLAYER';
    songLabel.className = 'song-label';
    songTitle.textContent = '♪ Waiting for song...';
    songArtist.textContent = '';
    return;
  }

  const status = session.playbackStatus === 'playing' ? 'PLAYING' : 'PAUSED';
  songLabel.textContent = `${status} · ${session.appName}`;
  songLabel.className = `song-label song-status-${session.playbackStatus}`;
  songTitle.textContent = session.title && session.artist
    ? `${session.title} — ${session.artist}`
    : session.title || session.artist;
  songArtist.textContent = '';
}

function updateClickThrough(enabled) {
  clickThroughButton.setAttribute('aria-pressed', String(enabled));
  document.body.classList.toggle('click-through', enabled);
}
