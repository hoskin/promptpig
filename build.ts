import { dts } from 'bun-dts';

Bun.build({
  target: 'node',
  entrypoints: ['./index.ts'],
  outdir: './dist',
  format: 'esm',
  naming: '[dir]/[name].js',
  plugins: [dts()],
});
