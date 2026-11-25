// TioHentai — plugin de Kino para tiohentai.com
// author: Hotaru Yume · creator: hotaruyume
// v1.1.0 — kino-resolver + YourUpload local + browser.capture

var BASE = 'https://tiohentai.com';
var BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// Prioridad: YourUpload (MP4 rápido) > Voe > Mega al final
var PRIO = ['yourupload', 'voe', 'mega'];
var RESOLVER_REPO = 'xuper-plugin/kino-plugin-kino-resolver';
var HLS_MIME = 'application/x-mpegURL';

// ---------- utilidades ----------

function abs(u) {
  if (!u) return u;
  u = String(u).trim();
  if (u.indexOf('http:') === 0) u = 'https:' + u.slice(5);
  if (u.indexOf('https:') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return BASE + u;
  return BASE + '/' + u;
}

function stripTags(s) {
  s = String(s || '').replace(/<[^>]*>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, code) {
      if (code.charAt(0) === '#') {
        var n;
        if (code.charAt(1) === 'x' || code.charAt(1) === 'X') n = parseInt(code.slice(2), 16);
        else n = parseInt(code.slice(1), 10);
        return n > 0 && n < 65536 ? String.fromCharCode(n) : m;
      }
      var named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3',
        uacute: '\u00fa', ntilde: '\u00f1', Ntilde: '\u00d1', uuml: '\u00fc'
      };
      return named.hasOwnProperty(code) ? named[code] : m;
    });
}

function safeId(s) {
  return String(s || '').replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 100);
}

function imgFromBlock(block) {
  var m = String(block).match(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i);
  return m ? abs(m[1]) : undefined;
}

function titleFromBlock(block) {
  var m = String(block).match(/<h3[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
  if (m) return stripTags(m[1]);
  m = String(block).match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (m) return stripTags(m[1]);
  m = String(block).match(/alt=["']([^"']+)["']/i);
  if (m) return stripTags(m[1]);
  return '';
}

async function fetchText(url, opts) {
  var o = opts || {};
  o.timeoutMs = o.timeoutMs || 14000;
  var h = {
    'User-Agent': BROWSER_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.5',
    'Referer': BASE + '/'
  };
  if (o.headers) for (var k in o.headers) h[k] = o.headers[k];
  var r = await kino.fetch(url, {
    method: o.method || 'GET',
    headers: h,
    timeoutMs: o.timeoutMs,
    body: o.body
  });
  if (!r.ok) {
    throw kino.error('unavailable', 'HTTP ' + r.status + ' en ' + url);
  }
  return await r.text();
}

// ---------- parsers (robustos) ----------

function parseEpisodeCards(html) {
  var out = [];
  var seen = {};
  // 1) bloques <article class="episode">…</article>
  var reArt = /<article[^>]*class=["'][^"']*episode[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = reArt.exec(html))) {
    var block = m[1];
    var hm = block.match(/href=["']\/ver\/([^"'?#]+)["']/i);
    if (!hm) continue;
    var slug = hm[1];
    if (seen[slug]) continue;
    var title = titleFromBlock(block);
    if (!title || title.length < 2) title = slug.replace(/-/g, ' ');
    seen[slug] = 1;
    out.push({
      id: ('e~' + safeId(slug)).slice(0, 128),
      ref: 'E|' + slug,
      kind: 'movie',
      title: title.slice(0, 200),
      poster: imgFromBlock(block),
      lang: 'es',
      adult: true
    });
  }
  // 2) cualquier <a href="/ver/...">…</a>
  if (!out.length) {
    var reA = /<a\s+href=["']\/ver\/([^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reA.exec(html))) {
      var slug2 = m[1];
      if (seen[slug2]) continue;
      var block2 = m[2];
      var title2 = titleFromBlock(block2) || stripTags(block2).slice(0, 120);
      if (!title2 || title2.length < 2) title2 = slug2.replace(/-/g, ' ');
      seen[slug2] = 1;
      out.push({
        id: ('e~' + safeId(slug2)).slice(0, 128),
        ref: 'E|' + slug2,
        kind: 'movie',
        title: title2.slice(0, 200),
        poster: imgFromBlock(block2),
        lang: 'es',
        adult: true
      });
    }
  }
  // 3) solo hrefs /ver/ (último recurso)
  if (!out.length) {
    var reH = /href=["']\/ver\/([^"'?#]+)["']/gi;
    while ((m = reH.exec(html))) {
      var slug3 = m[1];
      if (seen[slug3]) continue;
      seen[slug3] = 1;
      out.push({
        id: ('e~' + safeId(slug3)).slice(0, 128),
        ref: 'E|' + slug3,
        kind: 'movie',
        title: slug3.replace(/-/g, ' ').slice(0, 200),
        lang: 'es',
        adult: true
      });
    }
  }
  return out;
}

function parseSeriesCards(html) {
  var out = [];
  var seen = {};
  // 1) <article class="anime">…</article>
  var reArt = /<article[^>]*class=["'][^"']*anime[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = reArt.exec(html))) {
    var block = m[1];
    var hm = block.match(/href=["']\/hentai\/([^"'?#]+)["']/i);
    if (!hm) continue;
    var slug = hm[1];
    if (seen[slug]) continue;
    var title = titleFromBlock(block);
    if (!title || title.length < 2) title = slug.replace(/-/g, ' ');
    seen[slug] = 1;
    out.push({
      id: ('s~' + safeId(slug)).slice(0, 128),
      ref: 'S|' + slug,
      kind: 'series',
      title: title.slice(0, 200),
      poster: imgFromBlock(block),
      lang: 'es',
      adult: true
    });
  }
  // 2) cualquier <a href="/hentai/...">…</a>
  if (!out.length) {
    var reA = /<a\s+href=["']\/hentai\/([^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reA.exec(html))) {
      var slug2 = m[1];
      if (seen[slug2]) continue;
      var block2 = m[2];
      var title2 = titleFromBlock(block2) || stripTags(block2).slice(0, 120);
      if (!title2 || title2.length < 2) title2 = slug2.replace(/-/g, ' ');
      seen[slug2] = 1;
      out.push({
        id: ('s~' + safeId(slug2)).slice(0, 128),
        ref: 'S|' + slug2,
        kind: 'series',
        title: title2.slice(0, 200),
        poster: imgFromBlock(block2),
        lang: 'es',
        adult: true
      });
    }
  }
  // 3) solo hrefs
  if (!out.length) {
    var reH = /href=["']\/hentai\/([^"'?#]+)["']/gi;
    while ((m = reH.exec(html))) {
      var slug3 = m[1];
      if (seen[slug3]) continue;
      seen[slug3] = 1;
      out.push({
        id: ('s~' + safeId(slug3)).slice(0, 128),
        ref: 'S|' + slug3,
        kind: 'series',
        title: slug3.replace(/-/g, ' ').slice(0, 200),
        lang: 'es',
        adult: true
      });
    }
  }
  return out;
}

// ---------- resolve helpers ----------

function extractVideosArray(html) {
  var m = String(html).match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try {
    var raw = m[1].replace(/'/g, '"').replace(/,\s*]/g, ']');
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(function (row) {
      if (!Array.isArray(row) || row.length < 2) return null;
      return { name: String(row[0] || '').trim(), url: String(row[1] || '').trim() };
    }).filter(Boolean);
  } catch (e) {
    var out = [], re = /\["([^"]+)","(https?:\/\/[^"]+)"/g, mm;
    while ((mm = re.exec(m[1]))) out.push({ name: mm[1], url: mm[2] });
    return out;
  }
}

async function followVidcache(url) {
  // YourUpload sirve en vidcache.net:8161 → 302 a sNNN.vidcache.net:8166
  try {
    var r = await kino.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': BROWSER_UA,
        'Referer': 'https://www.yourupload.com/',
        'Accept': '*/*'
      },
      timeoutMs: 10000
    });
    if (r.status >= 300 && r.status < 400) {
      var loc = (r.headers && (r.headers.location || r.headers.Location)) || '';
      if (loc) {
        if (loc.indexOf('//') === 0) loc = 'https:' + loc;
        if (loc.indexOf('http') === 0) return loc;
      }
    }
  } catch (e) {}
  return url;
}

async function resolveYourUpload(embedUrl) {
  var html = await fetchText(embedUrl, { timeoutMs: 12000 });
  var mp4 = null;
  var m = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  if (m) mp4 = m[1];
  if (!mp4) {
    m = html.match(/["'](https?:\/\/[^"']*vidcache\.net[^"']*\.mp4[^"']*)["']/i);
    if (m) mp4 = m[1];
  }
  if (!mp4) {
    m = html.match(/sources?\s*:\s*\[\s*\{[^}]*file\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (m && /\.mp4/i.test(m[1])) mp4 = m[1];
  }
  if (!mp4) return null;
  // Seguir 302 al nodo sNNN.vidcache.net:8166 (reproducible con Range)
  if (/vidcache\.net/i.test(mp4)) {
    mp4 = await followVidcache(mp4);
  }
  return {
    url: mp4,
    mime: 'video/mp4',
    label: 'YourUpload',
    headers: {
      'User-Agent': BROWSER_UA,
      'Referer': 'https://www.yourupload.com/'
    }
  };
}

async function resolveVoe(embedUrl) {
  try {
    var html = await fetchText(embedUrl, { timeoutMs: 12000 });
    var redir = html.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
    if (redir) html = await fetchText(redir[1], { timeoutMs: 10000 });
    var m = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (m) return { url: m[1], mime: 'application/x-mpegURL', label: 'Voe' };
    m = html.match(/sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (m) {
      return {
        url: m[1],
        mime: m[1].indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4',
        label: 'Voe'
      };
    }
    m = html.match(/prompt\s*\(\s*["'](https?:\/\/[^"']+)["']/i);
    if (m) return { url: m[1], mime: 'application/x-mpegURL', label: 'Voe' };
    m = html.match(/atob\s*\(\s*["']([A-Za-z0-9+/=]{20,})["']\s*\)/);
    if (m) {
      try {
        var dec = atob(m[1]);
        var um = dec.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
        if (um) return { url: um[0], mime: 'application/x-mpegURL', label: 'Voe' };
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function serverKey(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('yourupload') >= 0 || n.indexOf('your upload') >= 0) return 'yourupload';
  if (n.indexOf('voe') >= 0) return 'voe';
  if (n.indexOf('mega') >= 0) return 'mega';
  return n;
}

// ---------- exports ----------

export async function home() {
  var rows = [];
  try {
    var html = await fetchText(BASE + '/');

    var epItems = parseEpisodeCards(html).slice(0, 48);
    if (epItems.length) {
      rows.push({
        id: 'r~ultimos-ep',
        title: 'Últimos Episodios',
        items: epItems,
        ref: 'B|ultimos-ep'
      });
    }

    var seriesItems = parseSeriesCards(html).slice(0, 48);
    if (seriesItems.length) {
      rows.push({
        id: 'r~ultimos-hentai',
        title: 'Últimos Hentai',
        items: seriesItems,
        ref: 'B|directorio'
      });
    }
  } catch (e) {
    // si falla la home, no devolver filas vacías silenciosas con error raro
  }

  try {
    var scHtml = await fetchText(BASE + '/directorio?censura=no');
    var scItems = parseSeriesCards(scHtml).slice(0, 48);
    if (scItems.length) {
      rows.push({
        id: 'r~sin-censura',
        title: 'Hentai Sin Censura',
        items: scItems,
        ref: 'B|censura=no'
      });
    }
  } catch (e) {}

  // último recurso: directorio si home no dio nada
  if (!rows.length) {
    try {
      var dHtml = await fetchText(BASE + '/directorio');
      var dItems = parseSeriesCards(dHtml).slice(0, 48);
      if (dItems.length) {
        rows.push({
          id: 'r~directorio',
          title: 'Directorio',
          items: dItems,
          ref: 'B|directorio'
        });
      }
    } catch (e) {}
  }

  return rows;
}

export async function search(query) {
  var q = (query && query.q) ? String(query.q).trim() : '';
  if (!q) return { items: [] };
  var page = 1;
  if (query.cursor) {
    var cm = String(query.cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }
  var url = BASE + '/directorio?q=' + encodeURIComponent(q);
  if (page > 1) url += '&p=' + page;
  var html = await fetchText(url);
  var items = parseSeriesCards(html);
  var eps = parseEpisodeCards(html);
  // dedupe por ref
  var seen = {}, all = [];
  items.concat(eps).forEach(function (it) {
    if (seen[it.ref]) return;
    seen[it.ref] = 1;
    all.push(it);
  });
  var next = null;
  if (all.length >= 12) next = 'p=' + (page + 1);
  return { items: all.slice(0, 60), next: next };
}

export async function browse(ref, cursor) {
  var page = 1;
  if (cursor) {
    var cm = String(cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }
  var path = 'directorio';
  var r = String(ref || '');
  if (r.indexOf('B|') === 0) r = r.slice(2);
  if (r === 'ultimos-ep') {
    var h = await fetchText(BASE + '/');
    return { items: parseEpisodeCards(h).slice(0, 60) };
  }
  if (r === 'censura=no' || r.indexOf('censura') >= 0) {
    path = 'directorio?censura=no';
  } else if (r === 'directorio' || r === 'ultimos-hentai') {
    path = 'directorio';
  } else if (r.charAt(0) === '/') {
    path = r.replace(/^\//, '');
  }
  var url = BASE + '/' + path;
  if (page > 1) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'p=' + page;
  var html = await fetchText(url);
  var items = parseSeriesCards(html);
  if (!items.length) items = parseEpisodeCards(html);
  var next = null;
  if (items.length >= 12) next = 'p=' + (page + 1);
  return { items: items.slice(0, 60), next: next };
}

export async function episodes(ref) {
  var r = String(ref || '');
  if (r.indexOf('S|') === 0) r = r.slice(2);
  else if (r.indexOf('E|') === 0) return { episodes: [] };
  var slug = r.replace(/^\/?hentai\//, '').replace(/\/$/, '');
  var html = await fetchText(BASE + '/hentai/' + encodeURIComponent(slug));
  var title = '';
  var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) title = stripTags(tm[1]);
  var poster;
  var pm = html.match(/uploads\/portadas\/[^"'\s]+/i);
  if (pm) poster = abs('/' + pm[0]);
  var overview = '';
  var om = html.match(/<p[^>]*class=["'][^"']*sinopsis[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<div[^>]*class=["'][^"']*(?:sinopsis|description|overview)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (om) overview = stripTags(om[1]).slice(0, 600);

  var eps = [];
  var seen = {};
  var re = /href=["']\/ver\/([^"'?#]+)["']/gi;
  var m;
  while ((m = re.exec(html))) {
    var eslug = m[1];
    if (seen[eslug]) continue;
    var nm = eslug.match(/-(\d+)$/);
    var num = nm ? parseInt(nm[1], 10) : 0;
    if (!(num > 0)) continue;
    seen[eslug] = 1;
    eps.push({
      season: 1,
      number: num,
      ref: 'E|' + eslug,
      title: (title ? title + ' ' : '') + 'Ep. ' + num
    });
  }
  eps.sort(function (a, b) { return a.number - b.number; });

  return {
    series: {
      title: title || slug,
      poster: poster,
      overview: overview || undefined
    },
    episodes: eps
  };
}


async function resolveViaDoor(embedUrl, referer) {
  if (!kino.plugins || typeof kino.plugins.call !== 'function') return null;
  try {
    var res = await kino.plugins.call('resolver', 'resolve', {
      url: embedUrl,
      referer: referer || (BASE + '/')
    });
    if (!res || res.error === 'dead') return null;
    var list = Array.isArray(res.streams) ? res.streams : [];
    var s = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].url) { s = list[i]; break; }
    }
    if (!s) return null;
    var headers = {};
    if (s.referer) headers.Referer = s.referer;
    if (Array.isArray(s.headers)) {
      for (var hi = 0; hi < s.headers.length; hi++) {
        var h = s.headers[hi];
        if (h && h.name) headers[h.name] = String(h.value);
      }
    }
    if (!headers.Referer) headers.Referer = referer || embedUrl;
    if (!headers['User-Agent']) headers['User-Agent'] = BROWSER_UA;
    var mime = s.kind === 'hls' ? HLS_MIME
      : (/\.mp4(\?|$)/i.test(s.url) ? 'video/mp4' : HLS_MIME);
    return {
      url: s.url,
      mime: mime,
      label: s.server || s.quality || 'Resolver',
      headers: headers
    };
  } catch (e) {
    return null;
  }
}

async function resolveViaBrowser(embedUrl, referer) {
  try {
    if (!kino.browser || typeof kino.browser.capture !== 'function') return null;
    var page = await kino.browser.capture(embedUrl, {
      timeoutMs: 18000,
      match: '\\.m3u8|\\.mp4',
      headers: { Referer: referer || (BASE + '/') }
    });
    var media = (page && page.media) || [];
    if (!media.length) return null;
    var best = null;
    for (var i = 0; i < media.length; i++) {
      if (media[i] && media[i].url && /\.m3u8/i.test(media[i].url)) { best = media[i]; break; }
    }
    if (!best) best = media[0];
    if (!best || !best.url) return null;
    return {
      url: best.url,
      mime: best.mime || (/\.mp4/i.test(best.url) ? 'video/mp4' : HLS_MIME),
      label: 'Browser',
      headers: best.headers || { Referer: embedUrl, 'User-Agent': BROWSER_UA }
    };
  } catch (e) {
    return null;
  }
}

export async function resolve(ref) {
  var r = String(ref || '');
  if (r.indexOf('E|') === 0) r = r.slice(2);
  else if (r.indexOf('S|') === 0) {
    throw kino.error('resolve', 'Este ítem es una serie; abre un episodio.');
  }
  var slug = r.replace(/^\/?ver\//, '').replace(/\/$/, '');
  var pageUrl = BASE + '/ver/' + encodeURIComponent(slug);
  var html = await fetchText(pageUrl);

  var servers = extractVideosArray(html);
  if (!servers.length) {
    var megaM = html.match(/https?:\/\/mega\.nz\/(?:embed\/|#!|file\/)[^\s"'<>]+/i);
    var yuM = html.match(/https?:\/\/(?:www\.)?yourupload\.com\/embed\/[A-Za-z0-9]+/i);
    var voeM = html.match(/https?:\/\/(?:[a-z0-9-]+\.)?voe\.sx\/e\/[A-Za-z0-9]+/i);
    if (yuM) servers.push({ name: 'YourUpload', url: yuM[0] });
    if (voeM) servers.push({ name: 'Voe', url: voeM[0] });
    if (megaM) servers.push({ name: 'MEGA', url: megaM[0] });
  }

  servers.sort(function (a, b) {
    var ka = PRIO.indexOf(serverKey(a.name));
    var kb = PRIO.indexOf(serverKey(b.name));
    if (ka < 0) ka = 99;
    if (kb < 0) kb = 99;
    return ka - kb;
  });

  var primary = null;
  var alternatives = [];
  var resolverMissing = false;

  for (var i = 0; i < servers.length; i++) {
    var s = servers[i];
    var key = serverKey(s.name);
    if (key === 'mega') continue;
    var stream = null;

    try {
      stream = await resolveViaDoor(s.url, pageUrl);
    } catch (e) {
      if (e && String(e.code || e.message || '').indexOf('provider') >= 0) resolverMissing = true;
    }

    if (!stream || !stream.url) {
      try {
        if (key === 'yourupload') stream = await resolveYourUpload(s.url);
        else if (key === 'voe') stream = await resolveVoe(s.url);
      } catch (e2) {}
    }

    if (!stream || !stream.url) {
      stream = await resolveViaBrowser(s.url, pageUrl);
    }

    if (!stream || !stream.url) continue;
    if (/malosas|stripchat|adsco|whitetrafsa|creative\./i.test(stream.url)) continue;
    if (!primary) primary = stream;
    else {
      alternatives.push({
        url: stream.url,
        mime: stream.mime,
        label: stream.label || s.name,
        headers: stream.headers
      });
    }
  }

  if (!primary) {
    var msg = resolverMissing
      ? 'Instala el motor de reproducción (Plugins ▸ Agregar ▸ xuper-plugin/kino-plugin-kino-resolver) y reintenta.'
      : 'No hay stream reproducible ahora (YourUpload/Voe). Reintenta más tarde.';
    throw kino.error('unavailable', 'no-stream', { userMessage: msg });
  }

  var out = {
    url: primary.url,
    mime: primary.mime || (primary.url.indexOf('.m3u8') >= 0 ? 'application/x-mpegURL' : 'video/mp4'),
    label: primary.label || 'YourUpload'
  };
  if (primary.headers) out.headers = primary.headers;
  else if (/vidcache\.net/i.test(out.url)) {
    out.headers = {
      'User-Agent': BROWSER_UA,
      'Referer': 'https://www.yourupload.com/'
    };
  }
  if (alternatives.length) out.alternatives = alternatives.slice(0, 6);
  return out;
}
