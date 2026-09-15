/**
 * Vercel Serverless Shim for NestJS.
 *
 * This plain JS file is committed to the repo and auto-discovered by Vercel
 * as a serverless function. It delegates to the compiled NestJS app in dist/.
 *
 * dist/ is created at deploy-time by the "vercel-build" script in package.json:
 *   "vercel-build": "npx prisma generate && npx nest build"
 */
const { default: handler } = require('../dist/api/index');
module.exports = handler;
