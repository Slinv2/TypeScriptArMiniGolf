import { Game, enterImmersiveDisplay } from './core/Game';
import { resetSettings, saveSettings, settings, type HandPoint, type Settings } from './config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modeSelect = $<HTMLDivElement>('mode-select');
const btnXr = $<HTMLButtonElement>('btn-xr');
const btnWebcam = $<HTMLButtonElement>('btn-webcam');
const btnMarker = $<HTMLButtonElement>('btn-marker');
const btnMarkerCardboard = $<HTMLButtonElement>('btn-marker-cardboard');
const xrHint = $<HTMLParagraphElement>('xr-hint');

const game = new Game();
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;

async function detectXrSupport(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return false;
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

function hideStart(): void {
  modeSelect.style.display = 'none';
}

// ---------- Einstellungen ----------

function bindSettings(): void {
  const panel = $<HTMLDivElement>('settings-panel');
  const marker = $<HTMLInputElement>('set-marker');
  const hand = $<HTMLSelectElement>('set-hand');
  const mirror = $<HTMLSelectElement>('set-mirror');
  const distortion = $<HTMLInputElement>('set-distortion');
  const offset = $<HTMLInputElement>('set-offset');
  const zoom = $<HTMLInputElement>('set-zoom');
  const debug = $<HTMLInputElement>('set-debug');
  const power = $<HTMLInputElement>('set-power');

  const render = () => {
    marker.value = String(settings.markerSizeCm);
    hand.value = settings.handPoint;
    mirror.value = settings.mirror;
    distortion.value = String(settings.lensDistortion);
    offset.value = String(settings.lensOffset);
    zoom.value = String(settings.cardboardZoom);
    debug.checked = settings.debug;
    power.value = String(settings.swingPower);
    $('out-power').textContent = `${settings.swingPower.toFixed(2)}\u00d7`;
    $('out-distortion').textContent = settings.lensDistortion.toFixed(2);
    $('out-offset').textContent = settings.lensOffset.toFixed(2);
    $('out-zoom').textContent = `${settings.cardboardZoom.toFixed(2)}×`;
  };
  const read = () => {
    const m = Number(marker.value);
    if (m >= 3 && m <= 40) settings.markerSizeCm = m;
    settings.handPoint = hand.value as HandPoint;
    settings.mirror = mirror.value as Settings['mirror'];
    settings.lensDistortion = Number(distortion.value);
    settings.lensOffset = Number(offset.value);
    settings.cardboardZoom = Number(zoom.value);
    settings.debug = debug.checked;
    settings.swingPower = Number(power.value);
    saveSettings();
    render();
  };
  for (const el of [marker, hand, mirror, distortion, offset, zoom, debug, power]) el.addEventListener('input', read);

  $('btn-settings').addEventListener('click', () => {
    render();
    panel.hidden = false;
  });
  $('settings-close').addEventListener('click', () => (panel.hidden = true));
  $('settings-reset').addEventListener('click', () => {
    resetSettings();
    render();
  });
  render();
}

// ---------- In-Game-Steuerung (Marker-Modus) ----------

function bindToolbar(): void {
  const btnCardboard = $<HTMLButtonElement>('btn-cardboard');
  btnCardboard.addEventListener('click', () => game.setCardboard(!game.isCardboard));
  $('btn-restart').addEventListener('click', () => game.restart());
  $('btn-exit-cardboard').addEventListener('click', (e) => {
    e.stopPropagation();
    game.setCardboard(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  });
  // Im Cardboard: Tippen (z. B. Cardboard-Taste) startet die Runde neu
  $('scene').addEventListener('click', () => {
    if (game.isCardboard) game.restart();
  });
}

async function boot(): Promise<void> {
  bindSettings();
  bindToolbar();

  const xrSupported = await detectXrSupport();
  if (!xrSupported) {
    btnXr.disabled = true;
    xrHint.textContent = 'Immersive AR is not available on this device – use Marker AR or Webcam AR.';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    for (const b of [btnWebcam, btnMarker, btnMarkerCardboard]) b.disabled = true;
    xrHint.textContent = 'No camera access: open the page via HTTPS (or localhost).';
  }

  btnXr.addEventListener('click', async () => {
    hideStart();
    await game.startImmersive();
  });
  btnWebcam.addEventListener('click', async () => {
    hideStart();
    await game.startWebcam();
  });
  btnMarker.addEventListener('click', async () => {
    hideStart();
    await game.startMarker(false);
  });
  btnMarkerCardboard.addEventListener('click', async () => {
    void enterImmersiveDisplay(); // Vollbild nur direkt im Klick erlaubt
    hideStart();
    await game.startMarker(true);
  });

  // Testhilfe: ?autostart=marker | cardboard | webcam
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto === 'marker' || auto === 'cardboard') {
    hideStart();
    await game.startMarker(auto === 'cardboard');
  } else if (auto === 'webcam') {
    hideStart();
    await game.startWebcam();
  }
}

boot();
