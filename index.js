require('dotenv').config();
// .env.local overrides .env (local secrets / per-machine config, gitignored)
require('dotenv').config({ path: '.env.local', override: true });
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { initDB } = require('./db/database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

module.exports = { broadcast };

initDB();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Local fallback for product photos when Cloudinary is unconfigured (see cloudinary.js).
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.use('/api/menu', require('./routes/menu'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/settings', require('./routes/settings'));

let shuttingDown = false;
function handleServerError(err) {
  if (err.code === 'EADDRINUSE') {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`\n❌ Port ${PORT} is already in use. Stop the existing process first:\n   lsof -ti:${PORT} | xargs kill\n`);
    process.exit(1);
  } else {
    throw err;
  }
}

server.on('error', handleServerError);
// ws re-emits the server's 'error' on the WebSocketServer instance, so it needs
// its own handler — otherwise EADDRINUSE crashes here before handleServerError runs.
wss.on('error', handleServerError);

server.listen(PORT, () => {
  console.log(`✅ GardenMarket backend running on port ${PORT}`);
});
