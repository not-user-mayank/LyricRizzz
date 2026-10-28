# Lyricrizzz

Lyricrizzz is a Windows floating lyrics widget. It reads Windows media sessions and displays the current track, artist, player, and play/pause state. It loads local lyrics first, then checks LRCLIB and caches a match. The widget includes theme controls, lyric import, timing adjustment, and position lock.

## Run locally

1. Install Node.js LTS.
2. Clone the repository and run `npm install`.
3. Run `npm start`.

## Download the beta

The current beta targets 64-bit Windows 10 build 17763 or later. Download either `Lyricrizzz-0.1.0-beta.4-Setup.exe` to install the app or `Lyricrizzz-0.1.0-beta.4-Portable.exe` to run it without an installer from the repository's [Releases](https://github.com/not-user-mayank/LyricRizzz/releases) page. Windows may show a SmartScreen prompt because this beta is not code-signed.

To build both Windows packages locally, run `npm install` and then `npm run dist:win`. The output is written to `release/`. Pushing a `v*` version tag also builds the packages on Windows and publishes them as a GitHub prerelease.

## Widget controls

- Drag the lyrics card or the title area to move the widget.
- Hover over the widget to show its controls.
- Use the size buttons to resize and the slider to change opacity.
- Use `−0.5` and `+0.5` to adjust lyric timing in half-second steps; the setting is saved between launches.
- Use the lock icon to prevent the widget from being moved. Click it again to unlock.
- Click the target icon or press `Ctrl+Shift+L` to toggle click-through. Press the shortcut again to turn click-through off.
- Use the minimize button in the hover toolbar. Restore the minimized widget with `Ctrl+Shift+M`.
- Use the close button to exit the app.

## Song detection

The app reads Windows Global System Media Transport Controls (GSMTC) sessions. A player must publish a Windows media session for its track details to appear; coverage can vary by player and browser. Lyricrizzz does not identify songs by listening to audio.

Windows 10 build 17763 or later, 64-bit, is required for media-session detection.

## Lyrics

Lyricrizzz checks `Documents/FloatingLyrics/LocalLyrics/` first for a file named `Artist - Title.lrc`, `.srt`, or `.txt`. If no local match exists, it queries LRCLIB and saves a found lyric file there for next time. LRC and SRT files sync to Windows playback position; TXT files are shown as scrollable unsynced lyrics. A matching PDF displays a conversion message.

The app creates the local lyrics folder when it starts. Hover over the widget and use the `＋` button, or drop lyrics files onto the widget, to add files. A single imported file uses the current track's artist and title when available; LRC `[ar:]` and `[ti:]` tags are used otherwise. Existing files are kept unless you choose to replace them.

## Appearance and settings

Open Settings from the widget toolbar to choose Minimal White, Dark Glass, Neon, Retro Cassette, or Transparent Blur. Settings include a copied custom background image, blur and dim controls, solid or gradient lyric colors, glow, font size, widget opacity, and a live preview. Synced lyrics progressively fill word by word, and upcoming lines fade into view. Preferences, lyric offset, position lock, and the last widget position are saved locally with `electron-store`.

## Project folders

- `src/` — Electron main process, preload bridge, and widget UI.
- `LocalLyrics/` — Repository placeholder; runtime lyric files are stored in `Documents/FloatingLyrics/LocalLyrics/`.
- `themes/` — Reserved for themes.
- `assets/` — Reserved for app assets.

Windows session detection uses [`windows-media-sessions`](https://github.com/Gyom03/windows-media-sessions), which includes its own Windows backend.
