/** Viewer-request candidate. Do not attach to an existing distribution without approval. */
function handler(event) {
 var request=event.request, query=request.querystring||{}, uri=request.uri;
 if(uri.indexOf('/api/')===0)return request;
 var routes={'/':'/index.html','/shorts':'/shorts/index.html','/creator-studio':'/creator-studio/index.html','/explore':'/explore/index.html','/immersion':'/immersion/index.html','/help':'/help/index.html','/privacy':'/privacy/index.html','/rights':'/rights/index.html','/terms':'/terms/index.html','/beta':'/beta/index.html'};
 var aliases={home:'/',shorts:'/shorts',studio:'/creator-studio',explore:'/explore',help:'/help',immersion:'/immersion'};
 if(query.analysisJob || query.privacy || query.q || query.query || query.short || query.studioTools){request.uri='/private/index.html';return request;}
 uri=uri.length>1?uri.replace(/\/$/,'').toLowerCase():uri;
 if(uri==='/index.html')uri='/';
 if(aliases[uri.slice(1)])uri=aliases[uri.slice(1)];
 if(routes[uri]&&query.view){var view=query.view.value.toLowerCase();uri=aliases[view]||(routes['/'+view]?'/'+view:'/missing');}
 if(routes[uri]){request.uri=routes[uri];return request;}
 if(/^\/(assets|brand)\//.test(uri)||['/site.webmanifest','/robots.txt','/sitemap.xml','/llms.txt'].indexOf(uri)>=0)return request;
 return {statusCode:404,statusDescription:'Not Found',headers:{'content-type':{value:'text/html; charset=utf-8'},'x-robots-tag':{value:'noindex, nofollow'},'cache-control':{value:'no-store'}},body:'<!doctype html><html lang="en"><title>Page not found | Lolixco</title><meta name="robots" content="noindex"><h1>Page not found</h1><p>This link is unavailable.</p><a href="/">Discover edits</a></html>'};
}
