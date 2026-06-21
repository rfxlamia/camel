import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db/redis.js', () => ({
  getRedisClient: vi.fn(() => null),
}));

import { isLoginLockedOut, checkAndRecordLoginAttempt } from './auth.js';

describe('Auth Redis Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use in-memory limiter when Redis unavailable', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await checkAndRecordLoginAttempt('testuser');
      expect(result).toBe(false);
    }

    const result = await checkAndRecordLoginAttempt('testuser');
    expect(result).toBe(true);
  });

  it('should report locked out after exceeding limit', async () => {
    for (let i = 0; i < 6; i++) {
      await checkAndRecordLoginAttempt('testuser');
    }

    const result = await isLoginLockedOut('testuser');
    expect(result).toBe(true);
  });
});
