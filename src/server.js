'use strict';
const path = require('path');
const express = require('express');
const store = require('./store');
const { api, labelRouter } = require('./api');
const { mcpHandler } = require('./mcp');

const PORT = +process.env.PORT || 8420;
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

store.seedIfEmpty();
if (process.env.SEED_DEMO === '1') require('./demo').seed();

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.all('/mcp', express.json({ limit: '4mb' }), mcpHandler());
app.use('/api', api);
app.use(labelRouter());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

app.listen(PORT, () => console.log(`Werkstattlager läuft auf Port ${PORT} · UI /  · MCP /mcp`));
