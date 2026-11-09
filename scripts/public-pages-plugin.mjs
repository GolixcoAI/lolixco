import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {PUBLIC_PAGES,PUBLIC_ORIGIN} from '../src/config/publicPages.js';
import {renderPublicHtml,resolvePublicPage} from './public-pages.mjs';
export default function publicPages(){let output;const release=process.env.LOLIXCO_PUBLIC_RELEASE==='1';return{
 name:'lolixco-public-pages',enforce:'post',configResolved(config){output=resolve(config.root,config.build.outDir)},
 configureServer(server){server.middlewares.use((req,res,next)=>{if(!req.url?.startsWith('/api/'))res.setHeader('X-Robots-Tag','noindex, nofollow');next()})},
 transformIndexHtml:{order:'post',handler(html,ctx){return renderPublicHtml(html,ctx.originalUrl||ctx.path||'/',false)}},
 writeBundle(){const template=readFileSync(resolve(output,'index.html'),'utf8');for(const page of PUBLIC_PAGES){const dest=page.path==='/'?output:resolve(output,page.path.slice(1));mkdirSync(dest,{recursive:true});writeFileSync(resolve(dest,'index.html'),renderPublicHtml(template,page.path,release))}for(const path of ['private','404']){const dest=resolve(output,path);mkdirSync(dest,{recursive:true});writeFileSync(resolve(dest,'index.html'),renderPublicHtml(template,path==='private'?'/creator-studio?analysisJob=private':'/404',false))}
 writeFileSync(resolve(output,'robots.txt'),release?`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /404/\nDisallow: /__dna/\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n');
 writeFileSync(resolve(output,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PUBLIC_PAGES.map(p=>`<url><loc>${PUBLIC_ORIGIN}${p.path}</loc></url>`).join('')}</urlset>`);
 writeFileSync(resolve(output,'llms.txt'),`# Lolixco\n\n> Curated edit discovery and experimental editing feedback under the Golixco brand.\n\nAI assessments may be inaccurate, incomplete or overly generous. Public processing availability depends on the configured service. Uploads and reports are not public discovery content.\n\n## Public pages\n${PUBLIC_PAGES.map(p=>`- [${p.view}](${PUBLIC_ORIGIN}${p.path}): ${p.description}`).join('\n')}\n\nContact support@golixco.com for help, rights@golixco.com for rights enquiries and hello@golixco.com for general enquiries. Consult Help and the Rights policy for current contact status.\n`)
 }} }
