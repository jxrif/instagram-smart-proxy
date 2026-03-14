const corsAnywhere = require('cors-anywhere');

const server = corsAnywhere.createServer({
  originWhitelist: [],          // Allow any origin
  requireHeader: [],            // No special headers needed
  removeHeaders: [              // Strip headers that block embedding
    'x-frame-options',
    'content-security-policy'
  ]
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
