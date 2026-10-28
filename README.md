# Lyricrizzz

Lyricrizzz is a Windows floating lyrics widget. The current project milestone is the transparent, always-on-top widget shell; song detection and lyric loading are planned for later phases.

## Run locally

1. Install Node.js LTS.
2. Clone the repository and run `npm install`.
3. Run `npm start`.

## Widget controls

- Drag the lyrics card or the title area to move the widget.
- Hover over the widget to show its controls.
- Use the size buttons to resize and the slider to change opacity.
- Click the target icon or press `Ctrl+Shift+L` to toggle click-through. Press the shortcut again to turn click-through off.
- Use the minimize and close buttons in the hover toolbar.

## Project folders

- `src/` — Electron main process, preload bridge, and widget UI.
- `LocalLyrics/` — Reserved for local lyric files in a later phase.
- `themes/` — Reserved for themes.
- `assets/` — Reserved for app assets.
