const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Base122 decoder (ported from the game's s13.js)
function base122ToArrayBuffer(str) {
    const kShortMapping = [0, 10, 13, 34, 38, 92];
    const w = (1.75 * str.length) | 0;
    const a = new Uint8Array(w);
    let bits = 0, bitCount = 0, n = 0;

    function push7(val, out) {
        bits |= (val <<= 1) >>> bitCount;
        bitCount += 7;
        if (bitCount >= 8) {
            out[n++] = bits;
            bitCount -= 8;
            bits = (val << (7 - bitCount)) & 255;
        }
    }

    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code > 127) {
            const idx = (code >>> 8) & 7;
            if (idx !== 7) push7(kShortMapping[idx], a);
            push7(code & 127, a);
        } else {
            push7(code, a);
        }
    }
    return new Uint8Array(a.buffer, 0, n);
}

// Process s14.js - extract compressed string and decompress
function extractCompressedString(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Find the decompressString call and extract the base122 data
    const match = content.match(/decompressString\(\s*"([^"]+)"\s*,\s*(true|false)\s*\)/);
    if (!match) {
        console.error('Could not find decompressString call in', filePath);
        return null;
    }
    
    const encodedData = match[1];
    const isBase122 = match[2] === 'true';
    
    console.log(`Found compressed data in ${filePath}: ${encodedData.length} chars, base122=${isBase122}`);
    
    let compressed;
    if (isBase122) {
        compressed = base122ToArrayBuffer(encodedData);
    } else {
        // base64
        compressed = Buffer.from(encodedData, 'base64');
    }
    
    console.log(`Compressed size: ${compressed.length} bytes`);
    
    // Decompress using brotli
    try {
        const decompressed = zlib.brotliDecompressSync(Buffer.from(compressed));
        return decompressed.toString('utf-8');
    } catch (e) {
        console.error('Brotli decompression failed:', e.message);
        return null;
    }
}

// Process s15.js - may have multiple decompressString calls
function extractAllCompressed(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const results = [];
    
    const regex = /decompressString\(\s*"([^"]+)"\s*,\s*(true|false)\s*\)\.then\(\s*function\(\s*\w+\s*\)\s*\{\s*window\.jsons\[\s*"([^"]+)"\s*\]/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
        const encodedData = match[1];
        const isBase122 = match[2] === 'true';
        const jsonName = match[3];
        
        console.log(`\nProcessing: ${jsonName} (${encodedData.length} chars, base122=${isBase122})`);
        
        let compressed;
        if (isBase122) {
            compressed = base122ToArrayBuffer(encodedData);
        } else {
            compressed = Buffer.from(encodedData, 'base64');
        }
        
        try {
            const decompressed = zlib.brotliDecompressSync(Buffer.from(compressed));
            results.push({ name: jsonName, data: decompressed.toString('utf-8') });
            console.log(`  Decompressed: ${decompressed.length} bytes`);
        } catch (e) {
            console.error(`  Brotli decompression failed: ${e.message}`);
        }
    }
    
    return results;
}

// Main
const outputDir = path.join(__dirname, 'decompressed');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Decompress s14.js (main game runtime)
console.log('=== Decompressing s14.js (main game runtime) ===');
const s14Result = extractCompressedString(path.join(__dirname, 'scripts/s14.js'));
if (s14Result) {
    const outPath = path.join(outputDir, 's14_decompressed.js');
    fs.writeFileSync(outPath, s14Result);
    console.log(`Saved to: ${outPath} (${s14Result.length} chars)`);
}

// Decompress s15.js (scene/bundle data)
console.log('\n=== Decompressing s15.js (scene/bundle JSON data) ===');
const s15Results = extractAllCompressed(path.join(__dirname, 'scripts/s15.js'));
for (const result of s15Results) {
    const safeName = result.name.replace(/\//g, '_').replace(/\\/g, '_');
    const outPath = path.join(outputDir, `${safeName}`);
    fs.writeFileSync(outPath, result.data);
    console.log(`Saved: ${outPath}`);
}

console.log('\nDone!');
