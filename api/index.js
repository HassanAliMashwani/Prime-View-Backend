/**
 * Vercel Serverless Shim for NestJS.
 * Delegates to the compiled NestJS handler in dist/serverless.js
 * (compiled from src/serverless.ts by nest build / vercel-build).
 */
const { default: handler } = require('../dist/serverless');
module.exports = handler;
