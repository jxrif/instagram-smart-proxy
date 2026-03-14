const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

// ========== INJECTED SCRIPTS ==========
const frameBuster = `
<script>
(function(){
  try {
    // Make Instagram think it's not in an iframe
    Object.defineProperty(window, 'top', { get: () => window });
    Object.defineProperty(window, 'parent', { get: () => window });
    Object.defineProperty(window, 'frameElement', { get: () => null });
    window.self = window;

    // Override window.open to stay inside the iframe
    const originalOpen = window.open;
    window.open = function(url, ...args) {
      if (url && !url.startsWith('#')) {
        // Redirect inside the iframe instead of opening a new tab
        location.href = url;
      }
      return null;
    };

    console.log('[Proxy] Framebusting bypass active');
  } catch(e) {}
})();
</script>
`;

const cookieClicker = `
<script>
(function(){
  const phrases = [
    'Allow all cookies',
    'Accept All',
    'Allow essential and optional cookies',
    'Consent',
    'Got it',
    'Aceptar todo',
    'Tout accepter',
    'Alle akzeptieren'
  ];

  function tryClick() {
    const buttons = document.querySelectorAll('button, div[role="button"], a');
    for (const btn of buttons) {
      const text = (btn.innerText || '').trim();
      if (phrases.some(p => text.includes(p))) {
        btn.click();
        console.log('[Proxy] Cookie button clicked');
        return true;
      }
    }
    return false;
  }

  // Try multiple times
  let attempts = 0;
  const interval = setInterval(() => {
    if (tryClick() || attempts++ > 20) clearInterval(interval);
  }, 1000);
})();
</script>
`;

// ========== HELPER FUNCTIONS ==========
function decompress(buffer, encoding) {
  if (encoding === 'gzip') return zlib.gunzipSync(buffer).toString();
  if (encoding === 'deflate') return zlib.inflateSync(buffer).toString();
  if (encoding === 'br') return zlib.brotliDecompressSync(buffer).toString();
  return buffer.toString();
}

function compress(text, encoding) {
  const buf = Buffer.from(text);
  if (encoding === 'gzip') return zlib.gzipSync(buf);
  if (encoding === 'deflate') return zlib.deflateSync(buf);
  if (encoding === 'br') return zlib.brotliCompressSync(buf);
  return buf;
}

function rewriteHtml(html, baseUrl) {
  // Inject scripts
  html = html.replace('<head>', '<head>' + frameBuster);
  if (!html.includes(frameBuster)) {
    html = frameBuster + html;
  }
  html = html.replace('</body>', cookieClicker + '</body>');

  // Rewrite relative URLs in HTML attributes
  const urlRegex = /(href|src|action|data)=["']([^"']*)["']/gi;
  html = html.replace(urlRegex, (match, attr, url) => {
    if (url.startsWith('http') || url.startsWith('//') || url.startsWith('#')) {
      return match; // absolute or protocol-relative or anchor
    }
    if (url.startsWith('/')) {
      // Root-relative
      const absolute = new URL(url, baseUrl).href;
      return `${attr}="${absolute}"`;
    }
    // Relative to current path
    const absolute = new URL(url, baseUrl).href;
    return `${attr}="${absolute}"`;
  });

  // Also rewrite in inline styles (background-image etc.) – simplified
  html = html.replace(/url\(['"]?([^'"\)]*)['"]?\)/gi, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('//')) return match;
    const absolute = new URL(url, baseUrl).href;
    return `url('${absolute}')`;
  });

  return html;
}

function rewriteCss(css, baseUrl) {
  return css.replace(/url\(['"]?([^'"\)]*)['"]?\)/gi, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('//')) return match;
    const absolute = new URL(url, baseUrl).href;
    return `url('${absolute}')`;
  });
}

function rewriteJs(js, baseUrl) {
  // This is tricky – we can attempt to rewrite strings that look like relative URLs in fetch/XHR,
  // but it's easy to break things. Instead, we'll inject a patch at the top of JS responses.
  const patch = `
  (function(){
    // Patch fetch and XHR to use absolute URLs via proxy
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
      if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
        url = new URL(url, location.origin).href;
      }
      return originalFetch.call(this, url, options);
    };
    const XHR = XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    XHR.prototype.open = function(method, url, ...args) {
      if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
        url = new URL(url, location.origin).href;
      }
      return originalOpen.call(this, method, url, ...args);
    };
  })();
  `;
  return patch + '\n' + js;
}

// ========== PROXY SERVER ==========
const server = http.createServer((req, res) => {
  const targetUrl = req.url.slice(1); // remove leading '/'
  if (!targetUrl.startsWith('http')) {
    res.writeHead(400);
    res.end('Please provide a full URL, e.g. /https://www.instagram.com');
    return;
  }

  const parsed = new URL(targetUrl);
  const client = parsed.protocol === 'https:' ? https : http;

  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search + parsed.hash,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.host,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Encoding': 'gzip, deflate, br', // let origin decide encoding
    },
  };
  // Remove headers that could cause issues
  delete options.headers['x-forwarded-for'];
  delete options.headers['x-forwarded-proto'];
  delete options.headers['x-forwarded-host'];

  const proxyReq = client.request(options, (proxyRes) => {
    // Read response body
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks);
      const contentType = proxyRes.headers['content-type'] || '';
      const contentEncoding = proxyRes.headers['content-encoding'];

      // Decompress if needed
      let decodedBody;
      try {
        decodedBody = decompress(body, contentEncoding);
      } catch (e) {
        decodedBody = body.toString(); // fallback
      }

      // Rewrite based on content type
      if (contentType.includes('text/html')) {
        decodedBody = rewriteHtml(decodedBody, targetUrl);
      } else if (contentType.includes('text/css')) {
        decodedBody = rewriteCss(decodedBody, targetUrl);
      } else if (contentType.includes('javascript')) {
        decodedBody = rewriteJs(decodedBody, targetUrl);
      }

      // Recompress if original was compressed
      let finalBody;
      let finalEncoding = contentEncoding;
      if (contentEncoding && contentEncoding !== 'identity') {
        finalBody = compress(decodedBody, contentEncoding);
      } else {
        finalBody = Buffer.from(decodedBody);
        finalEncoding = undefined;
      }

      // Build response headers (strip blocking ones)
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['x-xss-protection'];
      delete headers['x-content-type-options'];
      delete headers['content-length'];
      headers['access-control-allow-origin'] = '*';
      headers['x-frame-options'] = 'ALLOWALL';
      if (finalEncoding) headers['content-encoding'] = finalEncoding;
      headers['content-length'] = finalBody.length;

      res.writeHead(proxyRes.statusCode, headers);
      res.end(finalBody);
    });
  });

  proxyReq.on('error', (err) => {
    res.writeHead(500);
    res.end('Proxy error: ' + err.message);
  });

  // Pipe request body if any (e.g., POST)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

server.listen(PORT, () => {
  console.log(`Ultimate Instagram proxy running on port ${PORT}`);
});
