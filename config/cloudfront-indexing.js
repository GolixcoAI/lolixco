/** Viewer response: a preview or private URL must never become indexable. */
function handler(event) {
 var request=event.request, response=event.response;
 var host=request.headers.host ? request.headers.host.value.toLowerCase() : '';
 var uri=request.uri, query=request.querystring||{};
 var privateUrl=/^\/(api|private|404|__dna)(\/|$)/.test(uri)
   || query.analysisJob || query.privacy || query.q || query.query || query.short || query.studioTools;
 var allowed=PUBLIC_INDEXING && host===PUBLIC_HOST && !privateUrl && response.statusCode<400;
 response.headers['x-robots-tag']={value:allowed?'index, follow':'noindex, nofollow'};
 return response;
}
