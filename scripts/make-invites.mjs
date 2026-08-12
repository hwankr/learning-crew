/* 멤버별 초대 링크 생성.
   사용법: AUTH_SECRET=<서명키> APP_URL=https://learning-crew.<계정>.workers.dev node scripts/make-invites.mjs
   Worker의 AUTH_SECRET과 반드시 같은 값이어야 한다. */
import { createHmac } from 'node:crypto';

const MEMBERS = { sh: '승환', wg: '웅', th: '태현', jj: '진주' };

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error('AUTH_SECRET 환경변수가 필요합니다. 예: AUTH_SECRET=$(openssl rand -hex 32)');
  process.exit(1);
}
const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

for (const [id, name] of Object.entries(MEMBERS)) {
  const sig = createHmac('sha256', secret).update(id).digest('base64url');
  const token = `${Buffer.from(id).toString('base64url')}.${sig}`;
  console.log(`${name}\t${appUrl}/?invite=${token}`);
}
