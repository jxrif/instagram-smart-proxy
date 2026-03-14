const corsAnywhere = require("cors-anywhere");
const zlib = require("zlib");

const frameBuster = `
<script>
(function(){
  try{
    Object.defineProperty(window,"top",{get:()=>window});
    Object.defineProperty(window,"parent",{get:()=>window});
    Object.defineProperty(window,"frameElement",{get:()=>null});
    window.self = window;
    console.log("[proxy] frame check bypass active");
  }catch(e){}
})();
</script>
`;

const cookieClicker = `
<script>
(function(){
  const phrases=[
    "Allow all cookies",
    "Accept All",
    "Allow essential and optional cookies",
    "Consent",
    "Got it",
    "Aceptar todo",
    "Tout accepter",
    "Alle akzeptieren"
  ];

  function run(){
    let tries=0;
    const t=setInterval(()=>{
      const btns=document.querySelectorAll("button,div[role=button],a");
      for(const b of btns){
        const txt=(b.innerText||"").trim();
        if(phrases.some(p=>txt.includes(p))){
          b.click();
          clearInterval(t);
          console.log("[proxy] cookie accepted");
          return;
        }
      }
      if(++tries>20) clearInterval(t);
    },1000);
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",run);
  }else{
    run();
  }
})();
</script>
`;

function decompress(buffer, enc) {
  if (enc === "gzip") return zlib.gunzipSync(buffer).toString();
  if (enc === "deflate") return zlib.inflateSync(buffer).toString();
  return buffer.toString();
}

function compress(data, enc) {
  if (enc === "gzip") return zlib.gzipSync(data);
  if (enc === "deflate") return zlib.deflateSync(data);
  return Buffer.from(data);
}

function inject(html) {

  if (html.includes("<head")) {
    html = html.replace(/<head[^>]*>/i, m => m + frameBuster);
  } else {
    html = frameBuster + html;
  }

  if (html.includes("</body>")) {
    html = html.replace("</body>", cookieClicker + "</body>");
  } else {
    html += cookieClicker;
  }

  return html;
}

const proxy = corsAnywhere.createServer({

  originWhitelist: [],
  requireHeader: [],

  removeHeaders: [
    "x-frame-options",
    "content-security-policy",
    "x-xss-protection",
    "x-content-type-options"
  ],

  setHeaders: {
    "Access-Control-Allow-Origin": "*",
    "X-Frame-Options": "ALLOWALL"
  },

  handleResponse: (req,res,proxyRes)=>{

    const headers={...proxyRes.headers};

    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["content-length"];

    headers["Access-Control-Allow-Origin"]="*";
    headers["X-Frame-Options"]="ALLOWALL";

    const type=headers["content-type"]||"";

    if(type.includes("text/html")){

      const chunks=[];
      const enc=headers["content-encoding"];

      proxyRes.on("data",c=>chunks.push(c));

      proxyRes.on("end",()=>{

        try{

          const body=Buffer.concat(chunks);
          let html=decompress(body,enc);

          html=inject(html);

          const out=compress(html,enc);

          headers["content-length"]=out.length;

          res.writeHead(proxyRes.statusCode,headers);
          res.end(out);

        }catch(e){

          res.writeHead(proxyRes.statusCode,headers);
          res.end(Buffer.concat(chunks));

        }

      });

    }else{

      res.writeHead(proxyRes.statusCode,headers);
      proxyRes.pipe(res);

    }

  }

});

const PORT=process.env.PORT||3000;

proxy.listen(PORT,()=>{
  console.log("proxy running on port "+PORT);
});
