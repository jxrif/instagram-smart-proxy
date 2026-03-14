const corsAnywhere = require('cors-anywhere');
const zlib = require('zlib');

const injectScript = `...`; // keep your existing script

function injectIntoHtml(body, encoding, callback) { /* keep your function */ }

const server = corsAnywhere.createServer({
    originWhitelist: [],
    requireHeader: [],
    removeHeaders: [
        'x-frame-options',
        'content-security-policy',
        'x-xss-protection'
    ],
    setHeaders: {
        'Access-Control-Allow-Origin': '*',
        'X-Frame-Options': 'ALLOWALL'  // override any remaining
    },
    handleResponse: (req, res, proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || '';
        // Clone and sanitize headers for every response
        const headers = { ...proxyRes.headers };
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        delete headers['x-xss-protection'];
        delete headers['content-length']; // will be set automatically
        headers['Access-Control-Allow-Origin'] = '*';
        headers['X-Frame-Options'] = 'ALLOWALL';

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
server.listen(PORT, () => console.log(`Proxy running`));
