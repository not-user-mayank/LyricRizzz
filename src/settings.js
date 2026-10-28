const preview = document.getElementById('preview-canvas');
const themeList = document.getElementById('theme-list');
const saveButton = document.getElementById('save-settings');
const saveStatus = document.getElementById('save-status');
const backgroundName = document.getElementById('background-name');
const controls = {
  theme: document.getElementById('theme-list'),
  backgroundBlur: document.getElementById('background-blur'),
  backgroundDim: document.getElementById('background-dim'),
  currentColor: document.getElementById('current-color'),
  nextColor: document.getElementById('next-color'),
  gradientStart: document.getElementById('gradient-start'),
  gradientEnd: document.getElementById('gradient-end'),
  gradientAngle: document.getElementById('gradient-angle'),
  glow: document.getElementById('glow'),
  fontSize: document.getElementById('font-size'),
  widgetOpacity: document.getElementById('widget-opacity'),
};

let settings;
let themes = [];
let backgroundDataUrl = '';
let isDirty = false;

function selectedTheme() {
  return themes.find((theme) => theme.id === settings.theme) || themes[0];
}

function renderThemeCards() {
  themeList.replaceChildren();
  for (const theme of themes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `theme-card${settings.theme === theme.id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(settings.theme === theme.id));
    button.dataset.theme = theme.id;

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.background = theme.tokens.panelBackground;
    swatch.style.border = `1px solid ${theme.tokens.panelBorder}`;
    const name = document.createElement('strong');
    name.textContent = theme.name;
    const description = document.createElement('small');
    description.textContent = theme.description;
    button.append(swatch, name, description);
    button.addEventListener('click', () => {
      settings.theme = theme.id;
      markDirty();
      renderThemeCards();
      controls.currentColor.value = settings.currentColor || theme.tokens.currentColor;
      controls.nextColor.value = settings.nextColor || theme.tokens.nextColor;
      updatePreview();
      syncLabels();
    });
    themeList.append(button);
  }
}

function syncForm() {
  const theme = selectedTheme();
  controls.backgroundBlur.value = String(settings.backgroundBlur);
  controls.backgroundDim.value = String(settings.backgroundDim);
  controls.currentColor.value = settings.currentColor || theme.tokens.currentColor;
  controls.nextColor.value = settings.nextColor || theme.tokens.nextColor;
  controls.gradientStart.value = settings.gradientStart;
  controls.gradientEnd.value = settings.gradientEnd;
  controls.gradientAngle.value = String(settings.gradientAngle);
  controls.glow.checked = settings.glow;
  controls.fontSize.value = String(settings.fontSize);
  controls.widgetOpacity.value = String(Math.round(settings.widgetOpacity * 100));
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.mode === settings.lyricColorMode);
  });
  document.getElementById('solid-controls').hidden = settings.lyricColorMode !== 'solid';
  document.getElementById('gradient-controls').hidden = settings.lyricColorMode !== 'gradient';
  backgroundName.textContent = settings.backgroundImagePath
    ? settings.backgroundImagePath.split(/[\\/]/).pop()
    : 'No custom image';
  renderThemeCards();
  syncLabels();
}

function syncLabels() {
  document.getElementById('blur-value').textContent = `${settings.backgroundBlur}px`;
  document.getElementById('dim-value').textContent = `${settings.backgroundDim}%`;
  document.getElementById('angle-value').textContent = `${settings.gradientAngle}°`;
  document.getElementById('font-value').textContent = `${settings.fontSize}px`;
  document.getElementById('widget-opacity-value').textContent = `${Math.round(settings.widgetOpacity * 100)}%`;
}

function updatePreview() {
  window.LyricrizzzTheme.applyAppearance(preview, settings, themes, backgroundDataUrl);
  preview.style.opacity = String(settings.widgetOpacity);
}

function markDirty() {
  isDirty = true;
  saveStatus.textContent = 'Unsaved changes';
}

function bindControls() {
  for (const [key, element] of Object.entries(controls)) {
    if (key === 'theme') continue;
    element.addEventListener('input', () => {
      if (key === 'glow') settings.glow = element.checked;
      else if (['backgroundBlur', 'backgroundDim', 'gradientAngle', 'fontSize'].includes(key)) settings[key] = Number(element.value);
      else if (key === 'widgetOpacity') settings[key] = Number(element.value) / 100;
      else settings[key] = element.value;
      markDirty();
      syncLabels();
      updatePreview();
    });
  }

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      settings.lyricColorMode = button.dataset.mode;
      markDirty();
      syncForm();
      updatePreview();
    });
  });

  document.getElementById('choose-background').addEventListener('click', async () => {
    try {
      const result = await window.lyricrizzz.chooseBackground();
      if (result?.canceled) return;
      settings.backgroundImagePath = result.backgroundImagePath;
      backgroundDataUrl = result.backgroundDataUrl;
      backgroundName.textContent = result.fileName;
      markDirty();
      updatePreview();
    } catch (error) {
      saveStatus.textContent = `Could not load image: ${error.message}`;
    }
  });

  document.getElementById('clear-background').addEventListener('click', () => {
    settings.backgroundImagePath = '';
    backgroundDataUrl = '';
    backgroundName.textContent = 'No custom image';
    markDirty();
    updatePreview();
  });

  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('reset-settings').addEventListener('click', resetSettings);
  document.getElementById('close-settings').addEventListener('click', () => window.close());
}

async function saveSettings() {
  saveButton.disabled = true;
  saveStatus.textContent = 'Saving…';
  try {
    const snapshot = await window.lyricrizzz.saveSettings(settings);
    acceptSnapshot(snapshot);
    saveStatus.textContent = 'Settings saved';
  } catch (error) {
    saveStatus.textContent = `Could not save: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
}

async function resetSettings() {
  saveButton.disabled = true;
  saveStatus.textContent = 'Restoring defaults…';
  try {
    const snapshot = await window.lyricrizzz.resetSettings();
    acceptSnapshot(snapshot);
    saveStatus.textContent = 'Default settings restored';
  } catch (error) {
    saveStatus.textContent = `Could not reset: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
}

function acceptSnapshot(snapshot) {
  settings = { ...snapshot.settings };
  themes = snapshot.themes;
  backgroundDataUrl = snapshot.backgroundDataUrl || '';
  isDirty = false;
  syncForm();
  updatePreview();
}

window.lyricrizzz.onSettingsChanged((snapshot) => {
  if (!isDirty) acceptSnapshot(snapshot);
});
window.lyricrizzz.getSettings().then((snapshot) => {
  settings = { ...snapshot.settings };
  themes = snapshot.themes;
  backgroundDataUrl = snapshot.backgroundDataUrl || '';
  bindControls();
  syncForm();
  updatePreview();
  saveStatus.textContent = 'Changes are not saved yet.';
}).catch((error) => {
  saveStatus.textContent = `Could not load settings: ${error.message}`;
});
