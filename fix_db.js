require('dotenv').config();
const sql = require('./db.js');
async function run() {
    await sql`UPDATE bots SET language = 'nodejs', code = '' WHERE id = 20`;
    console.log('Done');
    process.exit(0);
}
run();
