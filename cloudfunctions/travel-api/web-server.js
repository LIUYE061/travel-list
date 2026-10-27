"use strict";

const http = require("http");
const { main } = require("./index");

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", chunk => {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 256 * 1024) req.destroy();
  });
  req.on("end", async () => {
    const url = new URL(req.url, "http://localhost");
    const query = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const event = {
      httpMethod: req.method,
      path: url.pathname,
      headers: req.headers,
      queryStringParameters: query,
      body: Buffer.concat(chunks).toString("utf8"),
      isBase64Encoded: false
    };
    try {
      const result = await main(event);
      res.writeHead(result.statusCode || 200, result.headers || {});
      res.end(result.body || "");
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
  });
});

server.listen(Number(process.env.PORT) || 9000, "0.0.0.0");
