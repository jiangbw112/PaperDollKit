#!/usr/bin/env node
import { runCli } from './index.js';

const res = runCli(process.argv.slice(2));
for (const line of res.stdout) console.log(line);
for (const line of res.stderr) console.error(line);
process.exit(res.exitCode);
