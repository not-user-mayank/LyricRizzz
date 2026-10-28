# Lyricrizzz

Lyricrizzz is a Windows floating lyrics widget. It reads Windows media sessions and displays a playing track (or a paused track if nothing is playing), its artist, player, and play/pause state. It loads local lyrics first, then checks LRCLIB and caches a match. Theme controls and in-app lyric import are planned for later phases.

## Run locally

1. Install Node.js LTS.
2. Clone the repository and run `npm install`.
3. Run `npm start`.

## Widget controls

- Drag the lyrics card or the title area to move the widget.
- Hover over the widget to show its controls.
- Use the size buttons to resize and the slider to change opacity.
- Click the target icon or press `Ctrl+Shift+L` to toggle click-through. Press the shortcut again to turn click-through off.
- Use the minimize button in the hover toolbar. Restore the minimized widget with `Ctrl+Shift+M`.
- Use the close button to exit the app.

## Song detection

The app reads Windows Global System Media Transport Controls (GSMTC) sessions. A player must publish a Windows media session for its track details to appear; coverage can vary by player and browser. Lyricrizzz does not identify songs by listening to audio.

Windows 10 build 17763 or later, 64-bit, is required for media-session detection.

## Lyrics

Lyricrizzz checks `Documents/FloatingLyrics/LocalLyrics/` first for a file named `Artist - Title.lrc`, `.srt`, or `.txt`. If no local match exists, it queries LRCLIB and saves a found lyric file there for next time. LRC and SRT files sync to Windows playback position; TXT files are shown as scrollable unsynced lyrics. A matching PDF displays a conversion message.

## Project folders

- `src/` — Electron main process, preload bridge, and widget UI.
- `LocalLyrics/` — Repository placeholder; runtime lyric files are stored in `Documents/FloatingLyrics/LocalLyrics/`.
- `themes/` — Reserved for themes.
- `assets/` — Reserved for app assets.

Windows session detection uses [`windows-media-sessions`](https://github.com/Gyom03/windows-media-sessions), which includes its own Windows backend.
