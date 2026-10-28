const clickThroughButton = document.getElementById('click-through');

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

function updateClickThrough(enabled) {
  clickThroughButton.setAttribute('aria-pressed', String(enabled));
  document.body.classList.toggle('click-through', enabled);
}
