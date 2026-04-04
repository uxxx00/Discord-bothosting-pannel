const postgres = require('postgres');

// Initialize the SQL connection using the environment variable
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ CRITICAL: DATABASE_URL is undefined.');
    console.error('💡 TIP: If you are on Hugging Face, go to Settings > Secrets and add DATABASE_URL.');
    // Return a proxy that throws descriptive errors on any query attempt
    module.exports = new Proxy({}, {
        get: () => { throw new Error('Postgres connection failed: DATABASE_URL is missing or invalid.'); }
    });
} else {
    // SUPABASE POOLER CONFIGURATION (STABILITY)
    const sql = postgres(connectionString, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 30,
        // Necessary for Supabase Pooler (Port 6543)
        prepare: false, 
        onnotice: () => {} // Silent notices to prevent shell crashes
    });
    module.exports = sql;
}
