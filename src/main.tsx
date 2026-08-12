import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoginScreen } from './components/LoginScreen';
import { loadConfig } from './lib/config';
import { CrewStore } from './local/store';
import { SyncClient } from './local/sync';
import { registerSW } from './lib/push';
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
    registerSW(); // 푸시 핸들러(sw.js)를 최신으로 유지
  }
  createRoot(document.getElementById('root')!).render(<App cfg={cfg} store={store} />);
}

void boot();
