import { Game } from './core/Game';

const modeSelect = document.getElementById('mode-select') as HTMLDivElement;
const btnXr = document.getElementById('btn-xr') as HTMLButtonElement;
const btnWebcam = document.getElementById('btn-webcam') as HTMLButtonElement;
const xrHint = document.getElementById('xr-hint') as HTMLParagraphElement;

const game = new Game();

async function detectXrSupport(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const xrSupported = await detectXrSupport();
  if (!xrSupported) {
    btnXr.disabled = true;
    xrHint.textContent =
      'Immersive AR ist auf diesem Ger\u00e4t nicht verf\u00fcgbar. Nutze den Webcam-Modus oder \u00f6ffne die Seite auf einer AR-Brille / einem Headset.';
  }

  btnXr.addEventListener('click', async () => {
    modeSelect.style.display = 'none';
    await game.startImmersive();
  });

  btnWebcam.addEventListener('click', async () => {
    modeSelect.style.display = 'none';
    await game.startWebcam();
  });
}

boot();
