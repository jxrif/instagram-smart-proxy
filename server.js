const corsAnywhere = require('cors-anywhere');
const zlib = require('zlib');

// The script that will be injected into every HTML page
const injectScript = `
<script>
  (function autoAcceptCookies() {
    // Wait for the page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
    function run() {
      // Look for the "Allow all cookies" button – Instagram's button often has these texts
      const possibleButtons = [
        'Allow all cookies',
        'Accept All',
        'Allow essential and optional cookies',
        'Aceptar todo',        // Spanish
        'Tout accepter',       // French
        'Alle akzeptieren'     // German
      ];
      
      // Try to find and click the button every second for 10 seconds
      let attempts = 0;
      const interval = setInterval(() => {
        const buttons = document.querySelectorAll('button, div[role="button"], a');
        for (let btn of buttons) {
          const text = btn.innerText?.trim() || '';
          if (possibleButtons.some(phrase => text.includes(phrase))) {
            btn.click();
            console.log('Cookie button clicked!');
            clearInterval(interval);
            return;
          }
        }
        attempts++;
        if (attempts > 10) clearInterval(interval); // stop after 10 seconds
      }, 1000);
    }
  })();
</script>
`;

// Helper to inject script into HTML responses
function injectIntoHtml(body, encoding, callback) {
  let content = body;
  if (encoding === 'gzip') {
    content = zlib.gunzipSync(body).toString();
  } else if (encoding === 'deflate') {
    content = zlib.inflateSync(body).toString();
  } else {
    content = body.toString();
  }

  // Inject the script right before </head> or </body>
  let modified = content.replace('</head>', injectScript + '</head>');
  if (modified === content) { // if no </head>, try </body>
    modified = content.replace('</body>', injectScript + '</body>');
  }

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
  originWhitelist: [], // Allow all origins
  requireHeader: [],   // No required headers
  removeHeaders: ['x-frame-options', 'content-security-policy', 'x-xss-protection'],
  // Modify response if it's HTML
  handleResponse: (req, res, proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const originalBody = [];
      const contentEncoding = proxyRes.headers['content-encoding'];

      proxyRes.on('data', chunk => originalBody.push(chunk));
      proxyRes.on('end', () => {
        const bodyBuffer = Buffer.concat(originalBody);
        injectIntoHtml(bodyBuffer, contentEncoding, (err, newBody, newEncoding) => {
          if (err) {
            // Fallback: send original response
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(bodyBuffer);
            return;
          }
          // Update content-length
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          if (newEncoding) headers['content-encoding'] = newEncoding;
          res.writeHead(proxyRes.statusCode, headers);
          res.end(newBody);
        });
      });
    } else {
      // Not HTML – pass through
      proxyRes.pipe(res);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Instagram proxy running on port ${PORT}`);
});
