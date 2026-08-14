import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoginScreen } from './components/LoginScreen';
import { loadConfig } from './lib/config';
import { CrewStore } from './local/store';
import { SyncClient } from './local/sync';
import { registerSW } from './lib/push';
import { configurePhotoProvider } from './lib/usePhoto';
import './styles.css';

async function boot(): Promise<void> {
  const cfg = loadConfig();
  registerSW(); // 푸시 핸들러 + 오프라인 앱 셸(sw.js)을 최신으로 유지
  if (cfg.needsLogin) {
    createRoot(document.getElementById('root')!).render(<LoginScreen />);
    return;
  }
  const store = new CrewStore();
  await store.init({ demo: cfg.demo, memberId: cfg.memberId, token: cfg.token });
  configurePhotoProvider(store, { token: cfg.token, demo: cfg.demo });
  if (cfg.token) {
    new SyncClient(store, cfg.token, cfg.memberId).start();
  }
  createRoot(document.getElementById('root')!).render(<App cfg={cfg} store={store} />);
}

void boot();
