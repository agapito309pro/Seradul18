/// <reference path="./kino.d.ts" />
/**
 * PornHD3x — Kino plugin v1.0.1
 * Author: Hotaru Yume / hotaruyume
 * Fuente: www9.pornhd3x.tv (y mirrors pornhd3x.tv)
 * - Full-length HD de estudios (Brazzers, NA, Vixen…)
 * - HLS prioritario (cdnamz) cuando el player lo expone
 * - Home por redes + recientes; browse y search con paginación máxima
 * - Evita anuncios / popunders; no gay/trans forzado
 */

const BASE = "https://www9.pornhd3x.tv";
const SALT = "98126avrbi6m49vd7shxkn985";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HOME_ROW = 12;
const PAGE_SIZE = 24;
const MAX_PAGES = 50;

const AD_RE =
  /trafficjunky|exoclick|juicyads|popunder|tsyndicate|doubleclick|googlesyndication|ad[-_]?server|banner[-_]?ad/i;
const AD_PLAYLIST_RE =
  /u8lmahqjne\.m3u8|underpetticoated\.m3u8|e6f4d9e9-dede-4eea-ae97-6e6c8d036eb4\.m3u8/i;
const GAY_TRANS_RE =
  /\b(gay|shemale|trans(?:sexual|gender)?|ladyboy|femboy|trap)\b/i;

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    Referer: BASE + "/",
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

function abs(u) {
  if (!u) return "";
  u = String(u).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function makeId(s) {
  return String(s || "x")
    .replace(/[^A-Za-z0-9._~-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function isBlocked(title, path) {
  var t = (title || "") + " " + (path || "");
  return GAY_TRANS_RE.test(t) || AD_RE.test(t);
}

async function fetchText(url, extra) {
  var r = await kino.fetch(url, {
    headers: hdr(extra),
    timeoutMs: 18000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return await r.text();
}

async function fetchJson(url, extra) {
  var r = await kino.fetch(url, {
    headers: hdr(
      Object.assign(
        {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
        extra || {}
      )
    ),
    timeoutMs: 16000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  var t = await r.text();
  try {
    return JSON.parse(t);
  } catch (e) {
    return { raw: t };
  }
}

function extractPoster(block) {
  if (!block) return "";
  var m =
    block.match(/data-original="([^"]+)"/i) ||
    block.match(/data-src="([^"]+)"/i) ||
    block.match(/src="([^"]+\.(?:jpg|jpeg|webp|png)[^"]*)"/i);
  if (m) {
    var p = abs(m[1]);
    if (p && !AD_RE.test(p) && p.indexOf("data:") !== 0) return p;
  }
  return "";
}

function parseMovieCards(html) {
  var byId = {};
  var order = [];

  function ensure(id, slug) {
    var key = id || slug;
    if (!byId[key]) {
      byId[key] = { id: key, slug: slug || "", title: "", poster: "" };
      order.push(key);
    }
    return byId[key];
  }

  // Primary: div.ml-item.item with data-movie-id
  var reItem =
    /<div[^>]*data-movie-id="(\d+)"[^>]*class="[^"]*ml-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*data-movie-id=|<\/div>\s*<\/div>\s*(?:<\/div>|<div class="clearfix))/gi;
  var m;
  while ((m = reItem.exec(html))) {
    var mid = m[1];
    var block = m[2];
    if (AD_RE.test(block)) continue;

    var hrefM =
      block.match(/href="(\/movies\/([^"]+))"/i) ||
      block.match(/href="(https?:\/\/[^"]*\/movies\/([^"/]+))"/i);
    if (!hrefM) continue;
    var slug = hrefM[2] || hrefM[1].replace(/^.*\/movies\//, "").replace(/\/$/, "");
    var rec = ensure(mid, slug);

    var titleM =
      block.match(/title="([^"]{4,})"/i) ||
      block.match(/alt="([^"]{4,})"/i) ||
      block.match(/class="[^"]*mli-info[^"]*"[^>]*>[\s\S]*?<h2[^>]*>([^<]+)/i);
    if (titleM) {
      var title = strip(titleM[1]);
      if (title.length >= 4) rec.title = title;
    }

    var poster = extractPoster(block);
    if (poster) rec.poster = poster;
  }

  // Fallback: any /movies/ links with nearby img
  if (order.length < 4) {
    var reLink =
      /<a[^>]+href="(\/movies\/([^"]+))"[^>]*class="[^"]*ml-mask[^"]*"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reLink.exec(html))) {
      var slug2 = m[2];
      var title2 = strip(m[3]);
      var block2 = m[4];
      if (!slug2 || AD_RE.test(block2)) continue;
      var rec2 = ensure(slug2, slug2);
      if (title2 && title2.length >= 4) rec2.title = title2;
      if (!rec2.poster) {
        var p2 = extractPoster(block2);
        if (p2) rec2.poster = p2;
      }
    }
  }

  var items = [];
  for (var i = 0; i < order.length; i++) {
    var r = byId[order[i]];
    if (!r.title || r.title.length < 3) continue;
    if (isBlocked(r.title, r.slug)) continue;
    var poster = r.poster || undefined;
    if (poster && AD_RE.test(poster)) poster = undefined;

    var refSlug = r.slug || r.id;
    items.push({
      id: makeId(refSlug),
      ref: "movie:" + refSlug,
      title: r.title.slice(0, 200),
      kind: "movie",
      poster: poster,
      adult: true,
      quality: "HD",
    });
  }
  return items;
}

function preferredQuality() {
  try {
    var q =
      (kino.config && kino.config.get && kino.config.get("quality")) || "auto";
    return String(q || "auto").toLowerCase();
  } catch (e) {
    return "auto";
  }
}

function pickBestUrl(urls, want) {
  if (!urls || !urls.length) return null;
  var scored = urls.map(function (u) {
    var s = String(u);
    var h = 0;
    var m = s.match(/(\d{3,4})p/i);
    if (m) h = parseInt(m[1], 10);
    else if (/1080|fhd/i.test(s)) h = 1080;
    else if (/720|hd/i.test(s)) h = 720;
    else if (/480|sd/i.test(s)) h = 480;
    else if (/360|240/i.test(s)) h = 360;
    else h = 720;
    return { url: s, h: h };
  });
  scored.sort(function (a, b) {
    return b.h - a.h;
  });
  if (want === "auto" || !want) return scored[0].url;
  var target = parseInt(want, 10) || 720;
  for (var i = 0; i < scored.length; i++) {
    if (scored[i].h <= target) return scored[i].url;
  }
  return scored[scored.length - 1].url;
}

async function md5Hex(str) {
  if (kino.crypto && kino.crypto.md5) {
    try {
      var out = await kino.crypto.md5(str);
      if (typeof out === "string") return out.toLowerCase();
      if (out && out.hex) return String(out.hex).toLowerCase();
    } catch (e) {}
  }
  // fallback pure JS MD5 (minimal)
  return simpleMd5(str);
}

function simpleMd5(s) {
  // compact MD5 for token hashing when kino.crypto unavailable
  function cmn(q, a, b, x, s, t) {
    a = (a + q + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function toUtf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return out;
  }
  var msg = toUtf8(s);
  var origLen = msg.length;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var bitLen = origLen * 8;
  for (var j = 0; j < 8; j++) msg.push((bitLen >>> (j * 8)) & 0xff);

  var a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (var i = 0; i < msg.length; i += 64) {
    var x = [];
    for (var k = 0; k < 16; k++) {
      var o = i + k * 4;
      x[k] =
        msg[o] | (msg[o + 1] << 8) | (msg[o + 2] << 16) | (msg[o + 3] << 24);
    }
    var a = a0,
      b = b0,
      c = c0,
      d = d0;
    a = ff(a, b, c, d, x[0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[2], 17, 0x242070db);
    b = ff(b, c, d, a, x[3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[15], 22, 0x49b40821);
    a = gg(a, b, c, d, x[1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[10], 9, 0x02441453);
    c = gg(c, d, a, b, x[15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[12], 20, 0x8d2a4c8a);
    a = hh(a, b, c, d, x[5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[2], 23, 0xc4ac5665);
    a = ii(a, b, c, d, x[0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[9], 21, 0xeb86d391);
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  function hex(n) {
    var s = "";
    for (var i = 0; i < 4; i++) s += ("0" + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
    return s;
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

function extractSourcesFromPayload(data) {
  var urls = [];
  if (!data) return urls;

  function walk(o, depth) {
    if (depth > 6 || !o) return;
    if (typeof o === "string") {
      if (/\.m3u8(\?|$)/i.test(o) || /\.mp4(\?|$)/i.test(o)) {
        if (!AD_RE.test(o) && o.indexOf("http") === 0) urls.push(o);
      }
      return;
    }
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }
    if (typeof o === "object") {
      var keys = ["file", "src", "url", "link", "source", "playlist", "sources", "videoUrl", "file_url"];
      for (var k = 0; k < keys.length; k++) {
        if (o[keys[k]]) walk(o[keys[k]], depth + 1);
      }
      for (var p in o) {
        if (Object.prototype.hasOwnProperty.call(o, p) && keys.indexOf(p) < 0) {
          walk(o[p], depth + 1);
        }
      }
    }
  }
  walk(data, 0);

  // also scan raw text
  if (data.raw && typeof data.raw === "string") {
    var m3 = data.raw.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
    var mp = data.raw.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi) || [];
    for (var i = 0; i < m3.length; i++) if (!AD_RE.test(m3[i])) urls.push(m3[i]);
    for (var j = 0; j < mp.length; j++) if (!AD_RE.test(mp[j])) urls.push(mp[j]);
  }

  // dedupe
  var seen = {};
  var out = [];
  for (var n = 0; n < urls.length; n++) {
    var u = urls[n].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!seen[u]) {
      seen[u] = true;
      out.push(u);
    }
  }
  return out;
}

export async function search(query) {
  var q = (query && query.q) || "";
  if (!q || !String(q).trim()) return [];

  var page = 1;
  if (query.cursor) {
    var cm = String(query.cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }

  var term = String(q)
    .trim()
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ");
  var path = "/search/" + encodeURIComponent(term).replace(/%20/g, "+");
  if (page > 1) path += "/page-" + page;

  var html;
  try {
    html = await fetchText(BASE + path);
  } catch (e) {
    // fallback query-string style
    html = await fetchText(
      BASE + "/search?keyword=" + encodeURIComponent(term) + (page > 1 ? "&page=" + page : "")
    );
  }

  var items = parseMovieCards(html);
  var next = null;
  if (items.length >= 12 && page < MAX_PAGES) next = "p=" + (page + 1);
  if (next) return { items: items, next: next };
  return items;
}

export async function home() {
  var rows = [];

  async function row(id, title, path) {
    try {
      var html = await fetchText(BASE + path);
      var items = parseMovieCards(html);
      if (items.length) {
        rows.push({
          id: id,
          title: title,
          items: items.slice(0, HOME_ROW),
          ref: "list:" + id + ":" + path,
        });
      }
    } catch (e) {
      if (kino.log) kino.log("home " + id + ": " + (e && e.message));
    }
  }

  await row("latest", "Recientes", "/premium-porn-hd/page-1");
  await row("home", "Destacados", "/");
  await row("brazzers", "Brazzers", "/studio/brazzers");
  await row("naughtyamerica", "Naughty America", "/studio/naughtyamerica");
  await row("realitykings", "Reality Kings", "/studio/realitykings");
  await row("blacked", "Blacked", "/studio/blacked");
  await row("cat-brazzers", "Categoría Brazzers", "/category/brazzers");

  return rows;
}

export async function browse(ref, cursor) {
  var page = 1;
  if (cursor) {
    var cm = String(cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }

  var path = "/premium-porn-hd/page-" + page;
  if (ref && String(ref).indexOf("list:") === 0) {
    var parts = String(ref).split(":");
    // list:id:/path
    if (parts.length >= 3) {
      path = parts.slice(2).join(":");
      // if path already has page-N, replace; else append
      if (/page-\d+/.test(path)) {
        path = path.replace(/page-\d+/, "page-" + page);
      } else if (page > 1) {
        path = path.replace(/\/?$/, "") + "/page-" + page;
      }
    }
  } else if (ref && String(ref).indexOf("cat:") === 0) {
    path = "/" + String(ref).slice(4);
    if (page > 1) path += "/page-" + page;
  }

  var html = await fetchText(BASE + path);
  var items = parseMovieCards(html);
  var next = null;
  if (items.length >= 12 && page < MAX_PAGES) next = "p=" + (page + 1);
  return { items: items, next: next };
}

export async function resolve(ref) {
  var slug = String(ref || "").replace(/^movie:/, "");
  if (!slug) throw kino.error("not_found", "Sin referencia de vídeo");

  var pageUrl = BASE + "/movies/" + slug;
  var html = await fetchText(pageUrl, { Referer: BASE + "/" });

  // token from page
  var token = "";
  var tm =
    html.match(/id="uuid"[^>]*value="([^"]+)"/i) ||
    html.match(/value="([A-Z0-9]{10,})"[^>]*class="[a-f0-9-]{36}"/i) ||
    html.match(/var\s+movie\s*=\s*\{[\s\S]*?id:\s*"([^"]+)"/i) ||
    html.match(/episode-id="([A-Z0-9]{10,})"/i);
  if (tm) token = tm[1];

  var want = preferredQuality();
  var urls = [];
  var labels = [];

  // 1) Hash real: md5(token + nonce + salt) + cookie del sitio
  if (token) {
    function randomNonce() {
      var alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      var s = "";
      for (var n = 0; n < 6; n++)
        s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      return s;
    }
    var nonce = randomNonce();
    var hash = "";
    try {
      hash = await md5Hex(token + nonce + SALT);
    } catch (e) {}
    var cookieName =
      "826avrbi6m49vd7shxkn985m" + token + "k06twz87wwxtp3dqiicks2df";
    var cookieHeader = cookieName + "=" + nonce;

    for (var count = 1; count <= 5 && hash; count++) {
      try {
        var srcUrl =
          BASE +
          "/ajax/get_sources/" +
          encodeURIComponent(token) +
          "/" +
          hash +
          "?count=" +
          count +
          "&mobile=true";
        var data = await fetchJson(srcUrl, {
          Referer: pageUrl,
          Cookie: cookieHeader,
        });
        var found = extractSourcesFromPayload(data);
        for (var f = 0; f < found.length; f++) {
          // Saltar playlists de anuncios conocidas
          if (
            typeof AD_PLAYLIST_RE !== "undefined" &&
            AD_PLAYLIST_RE.test(found[f])
          )
            continue;
          if (/u8lmahqjne|underpetticoated|e6f4d9e9-dede/i.test(found[f]))
            continue;
          if (urls.indexOf(found[f]) < 0) {
            urls.push(found[f]);
            labels.push("Direct HLS");
          }
        }
        if (urls.length) break;
      } catch (e) {}
    }
  }

  // 2) Scan page HTML / scripts for m3u8 or mp4
  if (!urls.length) {
    var m3 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi) || [];
    var mp = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi) || [];
    for (var a = 0; a < m3.length; a++) {
      if (!AD_RE.test(m3[a]) && urls.indexOf(m3[a]) < 0) {
        urls.push(m3[a]);
        labels.push("Page HLS");
      }
    }
    for (var b = 0; b < mp.length; b++) {
      if (!AD_RE.test(mp[b]) && urls.indexOf(mp[b]) < 0) {
        urls.push(mp[b]);
        labels.push("Page MP4");
      }
    }
  }

  // 3) iframe embeds (dood / lulu / streamtape / voe) — secondary
  var embeds = [];
  var ifr = html.match(/<iframe[^>]+src=["']([^"']+)["']/gi) || [];
  for (var e = 0; e < ifr.length; e++) {
    var sm = ifr[e].match(/src=["']([^"']+)["']/i);
    if (!sm) continue;
    var emb = abs(sm[1]);
    if (
      /dood|lulu|streamtape|voe\.sx|mixdrop|mp4upload|vidhide|streamsb/i.test(emb) &&
      !AD_RE.test(emb)
    ) {
      embeds.push(emb);
    }
  }

    // Filtrar anuncios residuales
  urls = urls.filter(function (u) {
    return (
      u &&
      !/u8lmahqjne|underpetticoated|e6f4d9e9-dede|tsyndicate/i.test(u)
    );
  });
  if (!urls.length) {
    throw kino.error(
      "no_stream",
      "El sitio solo devolvió streams de anuncios. No hay vídeo real para este título."
    );
  }

  // Prefer direct HLS/MP4
  if (urls.length) {
    var best = pickBestUrl(urls, want);
    var isHls = /\.m3u8(\?|$)/i.test(best);
    var stream = {
      url: best,
      mime: isHls ? "application/x-mpegURL" : "video/mp4",
      headers: {
        "User-Agent": UA,
        Referer: BASE + "/",
        Origin: BASE,
      },
      label: "HD",
    };
    // alternatives
    var alts = [];
    for (var u = 0; u < urls.length; u++) {
      if (urls[u] !== best) {
        alts.push({
          url: urls[u],
          mime: /\.m3u8/i.test(urls[u]) ? "application/x-mpegURL" : "video/mp4",
          headers: stream.headers,
          label: labels[u] || "Alt",
        });
      }
    }
    // embed refs as lazy alternatives
    for (var embI = 0; embI < Math.min(embeds.length, 3); embI++) {
      alts.push({
        ref: "embed:" + embeds[embI],
        label: "Embed " + (embI + 1),
      });
    }
    if (alts.length) stream.alternatives = alts;
    return stream;
  }

  // Only embeds left
  if (embeds.length) {
    return {
      url: embeds[0],
      headers: { "User-Agent": UA, Referer: pageUrl },
      label: "Embed",
      alternatives: embeds.slice(1, 4).map(function (u, idx) {
        return { url: u, label: "Embed " + (idx + 2) };
      }),
    };
  }

  throw kino.error(
    "no_stream",
    "No se encontró un stream reproducible (el servidor puede requerir token fresco)."
  );
}
