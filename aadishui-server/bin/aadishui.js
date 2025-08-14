#!/usr/bin/env node

const http = require('http');
const path = require('path');
const handler = require('serve-handler');
const open = require('open');

const buildDir = path.join(__dirname, '..', 'client', 'dist');
const port = 5000;

const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: buildDir,
    // Rewrite all requests to the root index.html file to support client-side routing.
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ]
  });
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`Serving Akatsuki Chat UI at ${url}`);
  console.log('If your browser does not open automatically, please navigate to this URL.');
  open(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${port} is already in use. Please free up the port or specify a different one.`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exit(1);
});
