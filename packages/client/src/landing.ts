import type { CreateGameResponse } from '@bs/shared';

const form = document.querySelector<HTMLFormElement>('#menu')!;
const salvo = document.querySelector<HTMLInputElement>('#salvo')!;
const salvoLabel = document.querySelector<HTMLElement>('#salvo-state')!;
const status = document.querySelector<HTMLElement>('#status')!;

const syncSalvo = () => (salvoLabel.textContent = salvo.checked ? 'ON' : 'OFF');
salvo.addEventListener('change', syncSalvo);
syncSalvo();

async function start(mode: '1p' | '2p') {
  status.textContent = 'STARTING...';
  try {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, salvo: salvo.checked }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { url } = (await res.json()) as CreateGameResponse;
    location.href = url;
  } catch {
    status.textContent = 'COULD NOT REACH THE SERVER';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  void start(submitter?.value === '2p' ? '2p' : '1p');
});

// Keys as on the original menu: 1 and 2 pick the mode, S toggles salvo fire.
window.addEventListener('keydown', (e) => {
  if (e.key === '1') void start('1p');
  else if (e.key === '2') void start('2p');
  else if (e.key === 's' || e.key === 'S') {
    salvo.checked = !salvo.checked;
    syncSalvo();
  }
});
