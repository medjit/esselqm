const express = require('express');
const serveIndex = require("serve-index");
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3333;
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB

let logBuffer = Buffer.alloc(0);

// Middleware to log requests
app.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const logEntry = `${new Date().toISOString()} - ${ip} - ${req.method} - ${req.url}${os.EOL}`;
    
    const logEntryBuffer = Buffer.from(logEntry);
    logBuffer = Buffer.concat([logBuffer, logEntryBuffer]);

    // Trim the log buffer if it exceeds the maximum size
    if (logBuffer.length > MAX_LOG_SIZE) {
        logBuffer = logBuffer.slice(logBuffer.length - MAX_LOG_SIZE);
    }

    next();
});

// Serve static files from the "public_data" directory
app.use('/data', express.static(path.join(__dirname, 'public_data')));
app.use('/data', serveIndex(path.join(__dirname, 'public_data'), { 'icons': true }));

// Serve frontend web pages from the "frontend" directory
app.use('/', express.static(path.join(__dirname, 'frontend')));

// Endpoint to get the log buffer
app.get('/get_log', (req, res) => {
    res.type('text/plain');
    res.send(logBuffer.toString());
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

//======================================== esselqm special functionality ========================================

//---------------------------------------- esselqm special functionality ----------------------------------------