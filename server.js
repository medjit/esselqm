const express = require('express');
const serveIndex = require("serve-index");
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const PORT = 3333;
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB

let logBuffer = Buffer.alloc(0);

// Middleware to log requests
app.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const logEntry = `${new Date().toISOString()} - ${ip} - ${req.method} - ${req.url}${os.EOL}`;
    console.log(logEntry);
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
// Function to scan folder and return JSON string
function scanFolder(folderPath) {
    const json = [];

    const items = fs.readdirSync(folderPath);

    items.forEach(item => {
        const itemPath = path.join(folderPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            json.push({
                type: 'folder',
                name: item,
                url: `/list-files?folder=${encodeURIComponent(path.join(folderPath, item))}`, // URL to fetch this folder
                filesCount: fs.readdirSync(itemPath).length,
                totalSize: getFolderSize(itemPath)
            });
        } else if (stats.isFile() && isAudioFile(item)) {
            const relativePath = path.relative(path.join(__dirname, 'public_data'), itemPath);
            json.push({
                type: 'file',
                size: stats.size,
                url: `/audioplayer.html?file=/data/${relativePath}`,
                author: item, // Placeholder, you might want to extract metadata
                theme: 'Unknown', // Placeholder, you might want to extract metadata
                duration: 0, // Placeholder, you might want to extract metadata
                thumbnailBase64: getThumbnailBase64('public_data/audio/test.png') // Placeholder, you might want to generate a thumbnail
            });
        }
    });

    return JSON.stringify(json, null, 2);
}

// Function to get the base64 representation of a PNG file
function getThumbnailBase64(filePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        return fileBuffer.toString('base64');
    } catch (error) {
        console.error(`Error reading file for thumbnail: ${error.message}`);
        return '';
    }
}

// Helper function to check if a file is an audio file
function isAudioFile(fileName) {
    const audioExtensions = ['.mp3'];
    return audioExtensions.includes(path.extname(fileName).toLowerCase());
}

// Helper function to get the total size of a folder
function getFolderSize(folderPath) {
    const items = fs.readdirSync(folderPath);
    let totalSize = 0;

    items.forEach(item => {
        const itemPath = path.join(folderPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            totalSize += getFolderSize(itemPath);
        } else {
            totalSize += stats.size;
        }
    });

    return totalSize;
}

// Endpoint to scan a folder and return JSON data
app.get('/get_folder', (req, res) => {
    let folderPath = decodeURIComponent(req.query.folder);
    folderPath = 'public_data/' + folderPath;

    if (!folderPath) {
        return res.status(400).send('Folder path is required');
    }

    if (!fs.existsSync(folderPath)) {
        return res.status(404).send('Folder not found');
    }

    try {
        const result = scanFolder(folderPath);
        res.type('application/json');
        res.send(result);
    } catch (error) {
        res.status(500).send(`Error scanning folder: ${error.message}`);
    }
});

function getRandomAudioFiles(number) {
    const audioFiles = [];

    function scanDirectory(directory) {
        const items = fs.readdirSync(directory);

        items.forEach(item => {
            const itemPath = path.join(directory, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                scanDirectory(itemPath);
            } else if (stats.isFile() && isAudioFile(item)) {
                const relativePath = path.relative(path.join(__dirname, 'public_data'), itemPath);
                audioFiles.push({
                    type: 'file',
                    size: stats.size,
                    url: `/audioplayer.html?file=/data/${relativePath}`,
                    author: item, // Placeholder, you might want to extract metadata
                    theme: 'Unknown', // Placeholder, you might want to extract metadata
                    duration: 0, // Placeholder, you might want to extract metadata
                    thumbnailBase64: getThumbnailBase64('public_data/audio/test.png') // Placeholder, you might want to generate a thumbnail
                });
            }
        });
    }

    scanDirectory(path.join(__dirname, 'public_data/audio'));

    // Shuffle the array and pick the first 'number' elements
    const shuffled = audioFiles.sort(() => 0.5 - Math.random());
    const selectedFiles = shuffled.slice(0, number);

    return JSON.stringify(selectedFiles, null, 2);
}

// Endpoint to scan a folder and return JSON data
app.get('/get_random', (req, res) => {
    let number = decodeURIComponent(req.query.number);

    if (!number) {
        number = 7;
    }

    try {
        const result = getRandomAudioFiles(number);
        res.type('application/json');
        res.send(result);
    } catch (error) {
        res.status(500).send(`Error scanning folder: ${error.message}`);
    }
});
//---------------------------------------- esselqm special functionality ----------------------------------------