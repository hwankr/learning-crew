import { describe, expect, it, vi } from 'vitest';
import { makeToken } from './auth';

const mocks = vi.hoisted(() => ({
  hasPhotoTombstone: vi.fn(async () => true),
  put: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => ({}) }));
vi.mock('drizzle-orm/neon-http', () => ({ drizzle: () => ({}) }));
vi.mock('./queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./queries')>()),
  hasPhotoTombstone: mocks.hasPhotoTombstone,
}));

import worker from './index';

describe('PUT /api/photos/:photoId', () => {
  it('톰스톤 뒤에 도착한 업로드를 R2에 쓰기 전 410으로 거부한다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f1111111-1111-4111-8111-111111111111';
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=full`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { put: mocks.put },
    };

    const response = await worker.fetch(request, env as never, {} as ExecutionContext);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'photo was removed' });
    expect(mocks.hasPhotoTombstone).toHaveBeenCalledWith({}, photoId);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
