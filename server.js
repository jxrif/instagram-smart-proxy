const corsAnywhere = require('cors-anywhere');
const zlib = require('zlib');

// ===== INJECTED SCRIPT =====
// Automatically clicks the Instagram cookie consent button
const injectScript = `
<script>
  (function autoAcceptCookies() {
    function run() {
      const possibleTexts = [
        'Allow all cookies',
        'Accept All',
        'Allow essential and optional cookies',
        'Aceptar todo',
        'Tout accepter',
        'Alle akzeptieren',
        'Consent',
        'Got it'
      ];
      
      let attempts = 0;
      const interval = setInterval(() => {
        const buttons = document.querySelectorAll('button, div[role="button"], a, ._a9--, ._a9-z');
        for (let btn of buttons) {
          const text = btn.innerText?.trim() || '';
          if (possibleTexts.some(phrase => text.includes(phrase))) {
            btn.click();
            console.log('[Proxy] Cookie button clicked');
            clearInterval(interval);
            return;
          }
        }
        attempts++;
        if (attempts > 15) clearInterval(interval);
      }, 1000);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  })();
</script>
`;

// Helper to inject script into HTML (handles gzip/deflate)
function injectIntoHtml(body, encoding, callback) {
  let content;
  if (encoding === 'gzip') {
    content = zlib.gunzipSync(body).toString();
  } else if (encoding === 'deflate') {
    content = zlib.inflateSync(body).toString();
  } else {
    content = body.toString();
  }

  // Inject right before </head> (fallback to </body>)
  let modified = content.replace('</head>', injectScript + '</head>');
  if (modified === content) {
    modified = content.replace('</body>', injectScript + '</body>');
  }

  // Re-compress if needed
  if (encoding === 'gzip') {
    callback(null, zlib.gzipSync(modified), 'gzip');
  } else if (encoding === 'deflate') {
    callback(null, zlib.deflateSync(modified), 'deflate');
  } else {
    callback(null, modified, null);
  }
}

// Create the proxy server with aggressive header stripping
const server = corsAnywhere.createServer({
  originWhitelist: [],            // Allow any origin
  requireHeader: [],              // No special headers needed
  removeHeaders: [                // Remove blocking headers from the response
    'x-frame-options',
    'content-security-policy',
    'x-xss-protection',
    'x-content-type-options'
  ],
  setHeaders: {
    'Access-Control-Allow-Origin': '*',   // Allow any site to embed
    'X-Frame-Options': 'ALLOWALL'         // Override any remaining frame restrictions
  },
  // Handle every response to inject script and force headers
  handleResponse: (req, res, proxyRes) => {
    // Clone and sanitize headers for EVERY response (HTML or not)
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    delete headers['x-xss-protection'];
    delete headers['x-content-type-options'];
    delete headers['content-length'];          // will be set automatically later
    headers['Access-Control-Allow-Origin'] = '*';
    headers['X-Frame-Options'] = 'ALLOWALL';

    const contentType = proxyRes.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      // For HTML, inject the script
      const chunks = [];
      const contentEncoding = proxyRes.headers['content-encoding'];

      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        injectIntoHtml(bodyBuffer, contentEncoding, (err, newBody, newEncoding) => {
          if (err) {
            // Fallback: send original (but with stripped headers)
            res.writeHead(proxyRes.statusCode, headers);
            res.end(bodyBuffer);
            return;
          }
          if (newEncoding) headers['content-encoding'] = newEncoding;
          res.writeHead(proxyRes.statusCode, headers);
          res.end(newBody);
        });
      });
    } else {
      // Not HTML – just pass through with sanitized headers
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Aggressive proxy running on port ${PORT}`);
});
