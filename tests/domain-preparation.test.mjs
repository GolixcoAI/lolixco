import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderPublicHtml} from '../scripts/public-pages.mjs';

const source=readFileSync('config/cloudfront-indexing.js','utf8');
function response(host,uri='/',query={},enabled=true,status=200) {
 const code=source.replaceAll('PUBLIC_INDEXING',String(enabled)).replaceAll('PUBLIC_HOST',JSON.stringify('lol.golixco.com'));
 const context=vm.createContext({});vm.runInContext(code,context);
 return context.handler({request:{headers:{host:{value:host}},uri,querystring:query},response:{statusCode:status,headers:{}}});
}
test('indexing is gated by activation, hostname, public path and response status',()=>{
 assert.match(response('lol.golixco.com').headers['x-robots-tag'].value,/^index,/);
 for(const [host,path,query,enabled,status] of [
  ['d2w2cv3wlh68gg.cloudfront.net','/',{},true,200],
  ['lol.golixco.com','/',{},false,200],
  ['lol.golixco.com','/api/v8/health',{},true,200],
  ['lol.golixco.com','/private/index.html',{},true,200],
  ['lol.golixco.com','/creator-studio',{analysisJob:{value:'synthetic'}},true,200],
  ['lol.golixco.com','/missing',{},true,404],
 ])assert.match(response(host,path,query,enabled,status).headers['x-robots-tag'].value,/^noindex,/);
});
test('production public HTML can index while analysis references remain excluded',()=>{
 const template='<html><head></head><body><div id="root"></div></body></html>';
 assert.match(renderPublicHtml(template,'/',true),/<title>Lolixco \| Discover Edits<\/title>/);
 assert.match(renderPublicHtml(template,'/',true),/content="index,follow"/);
 assert.match(renderPublicHtml(template,'/creator-studio?analysisJob=synthetic',true),/content="noindex,follow"/);
});
