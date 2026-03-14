const corsAnywhere = require('cors-anywhere');
const zlib = require('zlib');

// ===== INJECTED SCRIPTS =====
// 1. Framebusting buster – tricks Instagram into thinking it's not in an iframe
const framebustBuster = `
<script>
  // Override window.top and window.parent before Instagram checks them
  (function() {
    // Must run as early as possible – this will be inserted at the top of <head>
    Object.defineProperty(window, 'top', {
      get: function() { return window; }
    });
    Object.defineProperty(window, 'parent', {
      get: function() { return window; }
    });
    Object.defineProperty(window, 'frameElement', {
      get: function() { return null; }
    });
    // Also override self if needed
    window.self = window;
    console.log('[Proxy] Framebusting buster installed');
  })();
</script>
`;

// 2. Cookie auto‑clicker
const cookieClicker = `
<script>
  (function autoAcceptCookies() {
    function run() {
      const possibleTexts = [
        'Allow all cookies',
        'Accept All',
        'Allow essential and optional cookies',
        'Consent',
        'Got it',
        'Aceptar todo',
        'Tout accepter',
        'Alle akzeptieren'
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

// Helper to inject scripts into HTML (handles gzip/deflate)
function injectIntoHtml(body, encoding, callback) {
  let content;
  if (encoding === 'gzip') {
    content = zlib.gunzipSync(body).toString();
  } else if (encoding === 'deflate') {
    content = zlib.inflateSync(body).toString();
  } else {
    content = body.toString();
  }

  // Inject framebust buster at the very beginning of <head> (or create <head> if missing)
  // Then inject cookie clicker before </body>
  let modified = content.replace('<head>', '<head>' + framebustBuster);
  if (modified === content) {
    // If no <head> tag, add one at the start
    modified = framebustBuster + content;
  }
  
  // Inject cookie clicker before </body>
  modified = modified.replace('</body>', cookieClicker + '</body>');
  
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
  originWhitelist: [],
  requireHeader: [],
  removeHeaders: [
    'x-frame-options',
    'content-security-policy',
    'x-xss-protection',
    'x-content-type-options'
  ],
  setHeaders: {
    'Access-Control-Allow-Origin': '*',
    'X-Frame-Options': 'ALLOWALL'
  },
  handleResponse: (req, res, proxyRes) => {
    // Clone and sanitize headers
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    delete headers['x-xss-protection'];
    delete headers['x-content-type-options'];
    delete headers['content-length'];
    headers['Access-Control-Allow-Origin'] = '*';
    headers['X-Frame-Options'] = 'ALLOWALL';

    const contentType = proxyRes.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      const chunks = [];
      const contentEncoding = proxyRes.headers['content-encoding'];

      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        injectIntoHtml(bodyBuffer, contentEncoding, (err, newBody, newEncoding) => {
          if (err) {
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
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Proxy with framebust buster running on port ${PORT}`);
});
