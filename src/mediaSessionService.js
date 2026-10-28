const { onSessionsChanged, shutdown } = require('windows-media-sessions');
const fs = require('node:fs');
const path = require('node:path');

let unsubscribe;
let selectedSessionId;

function selectSession(sessions) {
  const playable = sessions.filter((session) =>
    ['playing', 'paused'].includes(session.playbackStatus) && (session.title || session.artist),
  );

  const playing = playable.filter((session) => session.playbackStatus === 'playing');
  const selectedPlaying = playing.find((session) => session.id === selectedSessionId);
  if (selectedPlaying) return selectedPlaying;
  if (playing.length > 0) return playing[0];

  const selectedPaused = playable.find((session) => session.id === selectedSessionId);
  return selectedPaused || playable[0] || null;
}

function startMediaSessionService(onUpdate, onError = () => {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    onError(new Error('Windows media detection currently requires 64-bit Windows.'));
    return () => {};
  }

  try {
    // Electron's ASAR virtual paths cannot be passed to child_process.spawn.
    // The backend is explicitly unpacked at build time, so point the package
    // at its real filesystem path in packaged builds.
    if (!process.env.WINDOWS_MEDIA_SESSIONS_BACKEND && process.resourcesPath) {
      const unpackedBackend = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'windows-media-sessions',
        'bin',
        'win-x64',
        'windows-media-sessions-backend.exe',
      );
      if (fs.existsSync(unpackedBackend)) {
        process.env.WINDOWS_MEDIA_SESSIONS_BACKEND = unpackedBackend;
      }
    }

    unsubscribe = onSessionsChanged((sessions) => {
      const session = selectSession(sessions);
      if (!session) {
        selectedSessionId = undefined;
        onUpdate(null);
        return;
      }

      selectedSessionId = session.id;
      onUpdate({
        id: session.id,
        title: session.title || '',
        artist: session.artist || '',
        album: session.albumTitle || '',
        appName: session.sourceAppDisplayName || session.sourceAppUserModelId || 'Media player',
        playbackStatus: session.playbackStatus,
        positionMs: session.timeline?.positionMs ?? 0,
        durationMs: session.timeline?.durationMs ?? 0,
      });
    });
  } catch (error) {
    onError(error);
  }

  return () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
}

async function stopMediaSessionService() {
  unsubscribe?.();
  unsubscribe = undefined;
  await shutdown();
}

module.exports = { startMediaSessionService, stopMediaSessionService };
