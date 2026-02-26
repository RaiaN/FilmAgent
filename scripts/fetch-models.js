const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
// Using hardcoded default from config logic to ensure consistency across build/runtime
const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const API_ENDPOINT = process.env.MODELARK_BASE_URL 
    ? `${process.env.MODELARK_BASE_URL}/models` 
    : `${DEFAULT_BASE_URL}/models`;

const API_KEY = process.env.MODELARK_API_KEY || process.env.ARK_API_KEY;
const OUTPUT_FILE = path.join(__dirname, '../utils/models.json');

if (!API_KEY) {
    console.warn('⚠️  No API Key found (MODELARK_API_KEY or ARK_API_KEY). Skipping model fetch.');
    console.warn('   Using existing models.json if available.');
    process.exit(0);
}

console.log(`🔄 Fetching latest models from ${API_ENDPOINT}...`);

const requestOptions = {
    headers: {
        'Authorization': API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    }
};

https.get(API_ENDPOINT, requestOptions, (res) => {
    let data = '';

    if (res.statusCode !== 200) {
        console.error(`❌ API Request failed with status code: ${res.statusCode}`);
        res.resume(); // Consume response data to free up memory
        process.exit(1);
    }

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const parsedData = JSON.parse(data);
            
            // Basic validation
            if (!parsedData.data || !Array.isArray(parsedData.data)) {
                throw new Error('Invalid API response format: missing "data" array');
            }

            // Write to file
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parsedData, null, 2));
            console.log(`✅ Successfully updated models.json with ${parsedData.data.length} models.`);
        } catch (error) {
            console.error('❌ Error parsing or writing data:', error.message);
            process.exit(1);
        }
    });

}).on('error', (err) => {
    console.error('❌ Request error:', err.message);
    process.exit(1);
});
