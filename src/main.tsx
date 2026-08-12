import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoginScreen } from './components/LoginScreen';
import { loadConfig } from './lib/config';
import { CrewStore } from './local/store';
import { SyncClient } from './local/sync';
import './styles.css';

async function boot(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.needsLogin) {
    createRoot(document.getElementById('root')!).render(<LoginScreen />);
    return;
  }
  const store = new CrewStore();
  await store.init({ demo: cfg.demo, memberId: cfg.memberId });
  if (cfg.token) {
    new SyncClient(store, cfg.token, cfg.memberId).start();
  }
  createRoot(document.getElementById('root')!).render(<App cfg={cfg} store={store} />);
}

void boot();
