(() => {
  function applyAppearance(root, settings, availableThemes, backgroundDataUrl) {
    const theme = availableThemes.find((item) => item.id === settings.theme) || availableThemes[0];
    if (theme) {
      root.dataset.theme = theme.id;
      for (const [key, value] of Object.entries(theme.tokens)) {
        const variable = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        root.style.setProperty(`--${variable}`, value);
      }
    }

    root.style.setProperty('--current-lyric-color', settings.currentColor);
    root.style.setProperty('--next-lyric-color', settings.nextColor);
    root.style.setProperty('--gradient-start', settings.gradientStart);
    root.style.setProperty('--gradient-end', settings.gradientEnd);
    root.style.setProperty('--gradient-angle', `${settings.gradientAngle}deg`);
    root.style.setProperty('--lyric-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--background-blur', `${settings.backgroundBlur}px`);
    root.style.setProperty('--background-opacity', String(1 - settings.backgroundDim / 100));
    root.classList.toggle('lyric-gradient', settings.lyricColorMode === 'gradient');
    root.classList.toggle('glow-enabled', Boolean(settings.glow));

    const image = root.querySelector('.widget-background');
    if (image) {
      if (backgroundDataUrl) {
        if (image.src !== backgroundDataUrl) image.src = backgroundDataUrl;
        image.hidden = false;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
      }
    }
  }

  window.LyricrizzzTheme = { applyAppearance };
})();
