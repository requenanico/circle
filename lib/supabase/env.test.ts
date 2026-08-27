import { afterEach, describe, expect, it } from 'vitest';

import { getPublicSupabaseEnv } from './env';

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
   restoreEnv('NEXT_PUBLIC_SUPABASE_URL', originalUrl);
   restoreEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', originalPublishableKey);
});

describe('getPublicSupabaseEnv', () => {
   it('returns a valid public Supabase configuration', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';

      expect(getPublicSupabaseEnv()).toEqual({
         url: 'https://example.supabase.co',
         publishableKey: 'sb_publishable_test-key',
      });
   });

   it.each([
      ['NEXT_PUBLIC_SUPABASE_URL', undefined],
      ['NEXT_PUBLIC_SUPABASE_URL', 'not-a-url'],
      ['NEXT_PUBLIC_SUPABASE_URL', 'http://example.supabase.co'],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined],
      ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ''],
   ] as const)('throws a descriptive error for invalid %s', (name, value) => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
      restoreEnv(name, value);

      expect(() => getPublicSupabaseEnv()).toThrow(name);
   });
});

function restoreEnv(name: string, value: string | undefined) {
   if (value === undefined) {
      delete process.env[name];
      return;
   }

   process.env[name] = value;
}
