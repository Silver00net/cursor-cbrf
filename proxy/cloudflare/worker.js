addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const requestUrl = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (requestUrl.pathname !== '/proxy') {
    return new Response('Not Found', { status: 404, headers: corsHeaders(request) });
  }

  const targetParam = requestUrl.searchParams.get('url');
  if (!targetParam) {
    return new Response('Missing "url" query parameter', { status: 400, headers: corsHeaders(request) });
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetParam);
  } catch {
    return new Response('Invalid target URL', { status: 400, headers: corsHeaders() });
  }

  // Security: allow only CBR host
  const allowedHosts = new Set(['www.cbr.ru']);
  if (!allowedHosts.has(targetUrl.hostname)) {
    return new Response('Forbidden host', { status: 403, headers: corsHeaders(request) });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const upstreamResponse = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseBuffer = await upstreamResponse.arrayBuffer();

    // Pass-through status; ensure content type and CORS
    const resp = new Response(responseBuffer, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: {
        ...corsHeaders(request),
        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/xml; charset=windows-1251',
        'Cache-Control': 'no-store'
      }
    });

    return resp;
  } catch (err) {
    const status = err && err.name === 'AbortError' ? 504 : 502;
    return new Response(`Proxy error: ${err && err.message ? err.message : 'unknown error'}`, {
      status,
      headers: corsHeaders(request)
    });
  }
}

function corsHeaders(request) {
  const requestHeaders = request ? request.headers.get('Access-Control-Request-Headers') : '';
  const allowHeadersBase = ['Content-Type', 'Cache-Control', 'Pragma', 'Accept'];
  const allowHeaders = requestHeaders
    ? Array.from(new Set(
        requestHeaders.split(',').map(h => h.trim()).filter(Boolean).concat(allowHeadersBase)
      )).join(', ')
    : allowHeadersBase.join(', ');

  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin, Access-Control-Request-Headers'
  };
}


