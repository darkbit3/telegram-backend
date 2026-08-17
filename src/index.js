require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cashierRoutes = require('./routes/cashier');
const withdrawalRoutes = require('./routes/withdrawal');
const adminRoutes = require('./routes/admin');
const postsRoutes = require('./routes/posts');

const app = express();

const PORT = process.env.PORT || 3000;
const PORT_ALT = process.env.PORT_ALT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/cashiers', cashierRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posts', postsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start on PORT (3000)
app.listen(PORT, () => {
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error(`❌ Failed to start on port ${PORT}:`, err.message);
});

// Start on PORT_ALT (5000)
app.listen(PORT_ALT, () => {
  console.log(`✅ Backend server also running on http://localhost:${PORT_ALT}`);
}).on('error', (err) => {
  console.error(`❌ Failed to start on port ${PORT_ALT}:`, err.message);
});
