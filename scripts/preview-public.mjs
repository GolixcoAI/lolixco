import http from 'node:http';import {readFileSync,existsSync,statSync} from 'node:fs';import {resolve,extname} from 'node:path';import {resolvePublicPage} from './public-pages.mjs';
const root=resolve(process.argv[2]||'dist-public'); const port=Number(process.argv[3]||5175);
const headers=JSON.parse(readFileSync('config/public-delivery.json'));delete headers.notice;delete headers['Strict-Transport-Security'];delete headers['Content-Security-Policy'];
// Loopback QA only. HTTPS-only CSP and HSTS are validated/configured at the approved HTTPS edge.
http.createServer((req,res)=>{let decodedPath;try{decodedPath=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400,{'Content-Type':'text/plain','X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'});res.end('Invalid URL');return;}const url=new URL(req.url,'http://127.0.0.1');const {page,privateUrl}=resolvePublicPage(req.url);let file;
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__dna')){res.writeHead(404,{'Content-Type':'application/json','X-Robots-Tag':'noindex, nofollow'});res.end('{"detail":"Analysis is unavailable in this static preview."}');return;}
 if(privateUrl)file=resolve(root,'private/index.html');else if(page)file=resolve(root,'.'+page.path,'index.html');else file=resolve(root,'.'+decodedPath);
 let status=200;if(!file.startsWith(root+'/')||!existsSync(file)||!statSync(file).isFile()){file=resolve(root,'404/index.html');status=404;}
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.woff':'font/woff'};
 res.writeHead(status,{...headers,'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':privateUrl||status!==200?'no-store':'public, max-age=60',...(privateUrl||status!==200?{'X-Robots-Tag':'noindex, nofollow'}:{})});res.end(readFileSync(file));
}).listen(port,'127.0.0.1',()=>console.log('Static QA listening on loopback port '+port));
