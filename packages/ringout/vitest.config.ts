import { defineConfig } from 'vitest/config';

// Unit tests cover the pure-logic helpers only (no Phaser / DOM needed).
// Feel and rendering stay play-test / build verified.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
