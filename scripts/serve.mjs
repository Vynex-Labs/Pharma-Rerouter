#!/usr/bin/env node
import { start } from '../src/api/server.mjs';
start().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
