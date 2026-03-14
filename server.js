const corsAnywhere = require('cors-anywhere');
const zlib = require('zlib');

// The script that will be injected into every HTML page to auto‑click the cookie button
const injectScript = `
<script>
  (function autoAcceptCookies() {
    function run() {
      // Common button texts used by Instagram's cookie consent
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
      
      // Try to find and click the button every second for 15 seconds
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

// Helper to inject the script into HTML responses (handles gzip/deflate)
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

  // Re‑compress if needed
  if (encoding === 'gzip') {
    callback(null, zlib.gzipSync(modified), 'gzip');
  } else if (encoding === 'deflate') {
    callback(null, zlib.deflateSync(modified), 'deflate');
  } else {
    callback(null, modified, null);
  }
}

// Create the proxy server
const server = corsAnywhere.createServer({
  originWhitelist: [],            // Allow any site to embed
  requireHeader: [],              // No special headers needed
  removeHeaders: [
    'x-frame-options',
    'content-security-policy',
    'x-xss-protection'
  ],
  // Intercept HTML responses to inject our script
  handleResponse: (req, res, proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const chunks = [];
      const contentEncoding = proxyRes.headers['content-encoding'];

      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        injectIntoHtml(bodyBuffer, contentEncoding, (err, newBody, newEncoding) => {
          if (err) {
            // Fallback: send original response
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(bodyBuffer);
            return;
          }
          // Update headers (remove content-length, set new encoding)
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          if (newEncoding) headers['content-encoding'] = newEncoding;
          res.writeHead(proxyRes.statusCode, headers);
          res.end(newBody);
        });
      });
    } else {
      // Not HTML – pass through unchanged
      proxyRes.pipe(res);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Instagram proxy running on port ${PORT}`);
});