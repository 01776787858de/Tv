/**
 * MBTV HLS relay proof of concept — LOCAL TEST ONLY.
 * Run: node scripts/relay-proof.js
 * No external IPTV credentials, real streams, or paid services are used.
 * Demonstrates single-flight segment fetching for 10 concurrent viewers.
 */
"use strict";
const http = require("node:http");
const assert = require("node:assert/strict");

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {server, base: "http://127.0.0.1:" + server.address().port};
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

async function main() {
  let originSegmentRequests = 0;
  const segment = Buffer.from("MBTV-LOCAL-TEST-SEGMENT");
  const origin = await listen((req, res) => {
    if (req.url === "/segment.ts") {
      originSegmentRequests++;
      setTimeout(() => {
        res.writeHead(200, {"Content-Type": "video/mp2t", "Cache-Control": "no-store"});
        res.end(segment);
      }, 120);
    } else if (req.url === "/playlist.m3u8") {
      res.writeHead(200, {"Content-Type": "application/vnd.apple.mpegurl"});
      res.end("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n");
    } else { res.writeHead(404); res.end(); }
  });
  const inflight = new Map();
  const cache = new Map();
  const relay = await listen(async (req, res) => {
    if (req.url !== "/segment.ts" && req.url !== "/playlist.m3u8") {
      res.writeHead(404); return res.end();
    }
    const key = req.url;
    try {
      if (!cache.has(key)) {
        if (!inflight.has(key)) {
          const task = fetch(origin.base + key).then(async response => {
            if (!response.ok) throw new Error("Origin returned " + response.status);
            const bytes = Buffer.from(await response.arrayBuffer());
            cache.set(key, bytes);
            return bytes;
          }).finally(() => inflight.delete(key));
          inflight.set(key, task);
        }
        await inflight.get(key);
      }
      res.writeHead(200, {"Content-Type": key.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"});
      res.end(cache.get(key));
    } catch (err) {
      res.writeHead(502); res.end("Local origin error");
    }
  });
  try {
    const playlist = await fetch(relay.base + "/playlist.m3u8");
    assert.equal(playlist.status, 200);
    assert.match(await playlist.text(), /segment\.ts/);
    const responses = await Promise.all(Array.from({length: 10}, () => fetch(relay.base + "/segment.ts")));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), segment);
    }
    assert.equal(originSegmentRequests, 1);
    console.log("PASS: 10 concurrent local viewers received the same test segment.");
    console.log("PASS: local origin was fetched exactly once for that segment.");
    console.log("NOTE: This is NOT a 50-viewer bandwidth benchmark or a production IPTV relay.");
  } finally {
    await close(relay.server);
    await close(origin.server);
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
