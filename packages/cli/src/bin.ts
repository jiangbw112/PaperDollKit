#!/usr/bin/env node
import { runCli } from './index.js';
import { startMcpStdioServer } from './mcp.js';

const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  startMcpStdioServer();
} else {
  const res = runCli(args);
  for (const line of res.stdout) console.log(line);
  for (const line of res.stderr) console.error(line);
  process.exit(res.exitCode);
}
