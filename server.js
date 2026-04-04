require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync, exec } = require('child_process');
const sql = require('./db.js');
const multer = require('multer');
const unzipper = require('unzipper');

// --- 🛡️ THE FINAL MASTER ARMOR ---
process.on('uncaughtException', (err) => console.error('🔥 SHIELD: Uncaught Error!', err.message));
process.on('unhandledRejection', (err) => console.error('🌊 SHIELD: Unhandled Promise!', err));

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.CALLBACK_BASE_URL || `http://localhost:${PORT}`;

const upload = multer({ dest: 'uploads/', limits: { fileSize: 25 * 1024 * 1024 } });

// Folder safety
['uploads', '__bots__'].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });

function safePath(botId, ...parts) {
    const base = path.resolve(__dirname, '__bots__', String(botId));
    const full = path.resolve(base, ...parts);
    if (!full.startsWith(base)) throw new Error('Forbidden path');
    return full;
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({ secret: 'bothost-secret-2024', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// ======================= DATABASE & ADMIN =======================
async function initDB() {
    try {
        console.log('⏳ Armor: Securing Tables...');
        await sql`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
            password TEXT, otp TEXT, is_verified INTEGER DEFAULT 0,
            auth_provider TEXT DEFAULT 'local', provider_id TEXT, role TEXT DEFAULT 'user',
            credits INTEGER DEFAULT 0, referral_code TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        await sql`CREATE TABLE IF NOT EXISTS bots (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL,
            name TEXT NOT NULL, language TEXT DEFAULT 'nodejs',
            token TEXT DEFAULT '', code TEXT DEFAULT '',
            status TEXT DEFAULT 'stopped',
            ram_limit INTEGER DEFAULT 280,
            cpu_limit INTEGER DEFAULT 10,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        await sql`CREATE TABLE IF NOT EXISTS promo_codes (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            credits INTEGER NOT NULL DEFAULT 100,
            max_uses INTEGER NOT NULL DEFAULT 1,
            uses INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        
        // --- EMERGENCY SCHEMA ARMOR ---
        try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0`; } catch(e){}
        try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`; } catch(e){}
        try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'stopped'`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS token TEXT DEFAULT ''`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'nodejs'`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS ram_limit INTEGER DEFAULT 280`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS cpu_limit INTEGER DEFAULT 10`; } catch(e){}
        try { await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; } catch(e){}
        // Migrate old promo schema columns if they exist
        try { await sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 100`; } catch(e){}
        try { await sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER DEFAULT 1`; } catch(e){}
        try { await sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS uses INTEGER DEFAULT 0`; } catch(e){}
        try { await sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`; } catch(e){}
        // Back-fill credits/max_uses from old columns if needed
        try { await sql`UPDATE promo_codes SET credits = reward_credits WHERE credits = 100 AND reward_credits IS NOT NULL`; } catch(e){}
        try { await sql`UPDATE promo_codes SET max_uses = uses_left WHERE max_uses = 1 AND uses_left IS NOT NULL`; } catch(e){}

        await sql`UPDATE bots SET status = 'stopped'`;
        const bossEmail = 'naimkrymadh11111i@gmail.com';
        await sql`UPDATE users SET role = 'admin' WHERE email = ${bossEmail}`;
        console.log('✅ Armor: Master Database Stable.');
    } catch (err) { 
        console.error('❌ Postgres Connection Failed:');
        console.error('   Error Info:', err.message);
        console.error('   Check if your DATABASE_URL is correct in Settings > Secrets.');
    }
}

// ======================= PASSPORT OAUTH =======================
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try { 
        if(!id) return done(null, null);
        const u = await sql`SELECT * FROM users WHERE id = ${id}`; 
        done(null, u[0]); 
    } catch (e) { done(e); }
});

const handleOAuth = async (profile, provider, done) => {
    const email = profile.emails?.[0]?.value;
    try {
        const existing = await sql`SELECT * FROM users WHERE email = ${email}`;
        if (existing.length) return done(null, existing[0]);
        const newUser = await sql`INSERT INTO users (name, email, is_verified, auth_provider, provider_id)
            VALUES (${profile.displayName}, ${email}, 1, ${provider}, ${profile.id}) RETURNING *`;
        done(null, newUser[0]);
    } catch (e) { done(e); }
};

if (process.env.GOOGLE_CLIENT_ID) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/google/callback`
    }, (at, rt, profile, done) => handleOAuth(profile, 'google', done)));
}

const oauthSuccess = (req, res) => {
    res.send(`<script>
        localStorage.setItem("currentUser", JSON.stringify({id:${req.user.id},name:"${req.user.name}",email:"${req.user.email}",role:"${req.user.role}"}));
        window.location.href="/dashboard.html";
    </script>`);
};

if (process.env.GOOGLE_CLIENT_ID) {
    app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
    app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?err=1' }), oauthSuccess);
}

// ======================= AUTH ENDPOINTS =======================
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const ref = Math.random().toString(36).substring(2, 10).toUpperCase();
        await sql`INSERT INTO users (name, email, password, otp, referral_code) VALUES (${name}, ${email}, ${hash}, ${otp}, ${ref})`;
        console.log(`[AUTH] Registered ${email} - OTP: ${otp}`);
        res.status(201).json({ message: 'Account created' });
    } catch (err) { res.status(400).json({ error: 'Email crash' }); }
});

app.post('/api/verify', async (req, res) => {
    const { email, otp } = req.body;
    try {
        if(!email || !otp) return res.status(400).json({ error: 'Missing data' });
        const u = await sql`SELECT id, otp FROM users WHERE email = ${email}`;
        if (!u.length || u[0].otp !== otp) return res.status(400).json({ error: 'OTP mismatch' });
        await sql`UPDATE users SET is_verified = 1, otp = NULL WHERE id = ${u[0].id}`;
        res.json({ message: 'Verified' });
    } catch (e) { res.status(500).json({ error: 'DB Crash' }); }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const u = await sql`SELECT * FROM users WHERE email = ${email}`;
        if (!u.length || !u[0].is_verified || !await bcrypt.compare(password, u[0].password)) {
            return res.status(401).json({ error: 'Invalid creds' });
        }
        res.json({ user: { id: u[0].id, name: u[0].name, email: u[0].email, role: u[0].role, credits: u[0].credits } });
    } catch (e) { res.status(500).json({ error: 'Login Crash' }); }
});

// ======================= BOT ENGINE =======================
function findPythonExe() {
    if (process.platform !== 'win32') return 'python3';
    
    // Add Winget default installation path for Python 3.11 along with others
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    
    const paths = [
        path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
        'C:\\Python311\\python.exe',
        'C:\\Python314\\python.exe'
    ];
    
    for (const p of paths) { 
        if (fs.existsSync(p)) return p; 
    }
    
    return 'python'; // Fallback to alias
}
const pythonExe = findPythonExe();
const activeBots = new Map();

// --- 🛡️ RESOURCE GUARDIAN ---
const TIERS = {
    lite:    { ram: 280,  cpu: 10, cost: 0 },
    starter: { ram: 524,  cpu: 25, cost: 50 },
    pro:     { ram: 1030, cpu: 50, cost: 100 },
    elite:   { ram: 12048, cpu: 1090, cost: 200 }
};

async function monitorResources() {
    for (const [botId, rt] of activeBots.entries()) {
        if (!rt.proc || rt.proc.killed) {
            rt.usage = { ram: 0, cpu: 0 };
            continue;
        }

        try {
            const pid = rt.proc.pid;
            let ramMB = 0;
            let cpuPct = 0;
            
            if (process.platform === 'win32') {
                // Get WorkingSet64 (RAM) and CPU via PowerShell
                const psCmd = `powershell -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){ Write-Output ($p.WorkingSet64 / 1MB).ToString('F0'); Write-Output [int]$p.CPU }"`;
                const output = execSync(psCmd, { encoding: 'utf8' }).trim().split('\n');
                if (output.length >= 2) {
                    ramMB = parseInt(output[0].trim()) || 0;
                    cpuPct = Math.min(100, parseInt(output[1].trim()) || 0);
                }
            } else {
                // ps -p <pid> -o rss=,%cpu=
                const output = execSync(`ps -p ${pid} -o rss=,%cpu=`, { encoding: 'utf8' }).trim().split(/\s+/);
                if (output.length >= 2) {
                    ramMB = Math.round(parseInt(output[0]) / 1024) || 0;
                    cpuPct = Math.round(parseFloat(output[1])) || 0;
                }
            }

            const bots = await sql`SELECT ram_limit FROM bots WHERE id = ${botId}`;
            const limit = bots[0]?.ram_limit || 280;
            
            rt.usage = { ram: ramMB, cpu: cpuPct };

            if (ramMB > limit) {
                addLog(botId, `[SYS] 🚨 CRITICAL: RAM Usage (${ramMB}MB) exceeded limit (${limit}MB). Auto-shutdown sequence initiated.`);
                if (process.platform === 'win32') exec(`taskkill /pid ${pid} /T /F`);
                else rt.proc.kill('SIGKILL');
            }
        } catch(e) { /* Process likely exited */ }
    }
}
setInterval(monitorResources, 10000); // Guard check every 10s

function getRuntime(botId) {
    if (!activeBots.has(String(botId))) activeBots.set(String(botId), { proc: null, installProc: null, terminalProc: null, logs: [], clients: new Set(), usage: { ram: 0, cpu: 0 } });
    return activeBots.get(String(botId));
}

function addLog(botId, line) {
    const rt = getRuntime(botId);
    const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
    rt.logs.push(stamped);
    if(rt.logs.length > 500) rt.logs.shift();
    rt.clients.forEach(c => { if(!c.writableEnded) c.write(`data: ${JSON.stringify({ log: stamped })}\n\n`); });
}

async function spawnBot(botId) {
    if(!botId) return;
    const bots = await sql`SELECT * FROM bots WHERE id = ${botId}`;
    if (!bots.length) return;
    const bot = bots[0];
    const rt = getRuntime(botId);
    if (rt.proc) { try { rt.proc.kill(); } catch(e){} }
    const botDir = path.resolve(__dirname, '__bots__', String(botId));
    if(!fs.existsSync(botDir)) fs.mkdirSync(botDir, { recursive: true });
    
    // --- 🤖 SMART ENTRY DETECTION ---
    let mainFile = bot.language === 'nodejs' ? 'bot.js' : (bot.language === 'python' ? 'bot.py' : (process.platform === 'win32' ? 'bot.bat' : 'bot.sh'));
    const pkgPath = path.join(botDir, 'package.json');
    
    if (bot.language === 'nodejs' && fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.main && fs.existsSync(path.join(botDir, pkg.main))) mainFile = pkg.main;
            else if (fs.existsSync(path.join(botDir, 'bot.js'))) mainFile = 'bot.js';
        } catch(e) { addLog(botId, `[SYS] Error reading package.json: ${e.message}`); }
    } else if (bot.language === 'nodejs') {
        // Fallback checks
        const candidates = ['bot.js', 'index.js', 'main.js'];
        for (const c of candidates) { if (fs.existsSync(path.join(botDir, c))) { mainFile = c; break; } }
    }
    
    const DISCORD_JS_TEMPLATE = `const { Client, GatewayIntentBits } = require('discord.js');
const { execSync } = require('child_process');

try { require.resolve('discord.js'); } catch (e) {
    console.log('[SYS] First-time setup: Installing discord.js. This may take a few seconds...');
    execSync('npm install discord.js', { stdio: 'inherit' });
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log('[SYS] 🟢 Logged in successfully to Discord API!');
    console.log('[SYS] Identity: ' + client.user.tag);
});

client.on('messageCreate', message => {
    if (message.author.bot) return;
    if (message.content === '!ping') message.reply('🏓 Pong! Powered by Royal Hosting');
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('[ERR] ❌ Missing DISCORD_TOKEN. Set it in the Environment block!');
    process.exit(1);
}

client.login(token).catch(err => console.error('[ERR] ❌ Login failed.', err.message));`;

    // Ensure entry file exists, sync from DB if empty
    const fullMainPath = path.join(botDir, mainFile);
    if (!fs.existsSync(fullMainPath)) {
        let defCode = '# Royal Hosting Instance';
        if (bot.language === 'nodejs') defCode = DISCORD_JS_TEMPLATE;
        if (bot.language === 'shell') defCode = process.platform === 'win32' ? '@echo off\necho [Custom Shell Active]\n...\nping google.com' : '#!/bin/bash\necho [Custom Shell Active]\nping google.com';
        fs.writeFileSync(fullMainPath, bot.code || defCode);
    }

    // --- PHASE 1: DEPENDENCIES ---
    if (bot.language === 'nodejs') {
        const pkgP = path.join(botDir, 'package.json');
        if (!fs.existsSync(pkgP)) {
            fs.writeFileSync(pkgP, JSON.stringify({ name: "royal-bot", version: "1.0.0", main: "bot.js", dependencies: { "discord.js": "^14.14.1" } }, null, 2));
        }
    } else {
        const reqP = path.join(botDir, 'requirements.txt');
        if (!fs.existsSync(reqP)) {
            fs.writeFileSync(reqP, "discord.py==2.3.2");
        }
    }

    const streamToLogs = (stream, prefix = '') => {
        let buffer = '';
        stream.on('data', d => {
            buffer += d.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line
            lines.forEach(l => {
                const clean = l.replace(/\r/g, '').trim();
                if (clean) addLog(botId, prefix + clean);
            });
        });
        stream.on('end', () => {
            if (buffer.trim()) addLog(botId, prefix + buffer.replace(/\r/g, '').trim());
        });
    };

    const runInstaller = () => new Promise(resolve => {
        if (bot.language === 'shell') return resolve(true);
        let pipFlags = '';
        if (process.platform !== 'win32') pipFlags = ' --break-system-packages';
        
        const installCmd = bot.language === 'nodejs' ? 'npm install' : `${pythonExe} -m pip install -r requirements.txt${pipFlags}`;
        addLog(botId, `[SYS] Phase 1: Resolving Dependencies... (${installCmd})`);
        
        // Inject Python Scripts dir so pip is globally available during install
        const injectedEnv = { ...process.env };
        if (pythonExe && process.platform === 'win32') {
            const pyDir = path.dirname(pythonExe);
            const scriptsDir = path.join(pyDir, 'Scripts');
            injectedEnv.Path = `${pyDir};${scriptsDir};${injectedEnv.Path || injectedEnv.PATH || ''}`;
        }

        const proc = spawn(installCmd, [], { cwd: botDir, shell: true, env: injectedEnv });
        rt.installProc = proc;
        
        streamToLogs(proc.stdout);
        streamToLogs(proc.stderr, '[SYS] ');
        
        proc.on('close', code => {
            if (rt.installProc === proc) rt.installProc = null;
            if (code !== 0 && code !== null) addLog(botId, `[ERR] Dependency installation failed with code ${code}.`);
            else addLog(botId, `[SYS] Dependencies resolved successfully.`);
            resolve(code === 0 || code === null);
        });
    });

    await sql`UPDATE bots SET status = 'running' WHERE id = ${botId}`;
    
    // Skip install if node_modules exists, otherwise force if Python (or simply always run since they're fast if cached)
    const needsInstall = bot.language === 'shell' ? false : (bot.language === 'nodejs' ? !fs.existsSync(path.join(botDir, 'node_modules')) : true);
    
    let success = true;
    if (needsInstall) {
        success = await runInstaller();
    }
    
    // Check if user killed it during phase 1
    if (rt.installProc !== null) {
        success = false;
    }

    if (!success) {
        rt.proc = null;
        sql`UPDATE bots SET status = 'stopped' WHERE id = ${botId}`.catch(()=>{});
        return;
    }

    // --- PHASE 2: IGNITION ---
    addLog(botId, `[SYS] Phase 2: Starting ${bot.name} via ${mainFile}...`);
    const isWin = process.platform === 'win32';
    
    let cmd, args, shellFlag;
    if (bot.language === 'nodejs') {
        cmd = 'node'; args = [mainFile]; shellFlag = false;
    } else if (bot.language === 'python') {
        cmd = pythonExe; args = [mainFile]; shellFlag = false;
    } else {
        cmd = isWin ? 'cmd.exe' : 'bash'; args = isWin ? ['/c', mainFile] : [mainFile]; shellFlag = true;
    }
    
    const mainProc = spawn(cmd, args, { 
        cwd: botDir, env: { ...process.env, DISCORD_TOKEN: bot.token || '' }, shell: shellFlag
    });
    
    rt.proc = mainProc;
    
    streamToLogs(mainProc.stdout);
    streamToLogs(mainProc.stderr, '[ERR] ');
    
    mainProc.on('error', (err) => {
        addLog(botId, `[SYS] FAILED TO START: ${err.message}`);
        sql`UPDATE bots SET status = 'stopped' WHERE id = ${botId}`.catch(()=>{});
    });

    mainProc.on('close', (code) => {
        rt.proc = null;
        sql`UPDATE bots SET status = 'stopped' WHERE id = ${botId}`.catch(()=>{});
        addLog(botId, `[SYS] Engine Stopped (Exit Code: ${code})`);
        if (code === 1) addLog(botId, `[SYS] TIP: Check if your bot token is valid.`);
    });
}

// ======================= API ROUTES =======================

// Profile Armor
app.get('/api/user', async (req, res) => {
    const uid = req.query.id;
    if(!uid || uid === 'undefined') return res.status(400).json({ error: 'Missing ID' });
    const u = await sql`SELECT id, name, email, role, credits FROM users WHERE id = ${uid}`;
    res.json(u[0] || { error: 'Not found' });
});

// Bot Control Armor
app.get('/api/bots', async (req, res) => {
    const uid = req.query.userId;
    if(!uid || uid === 'undefined') return res.json([]);
    const bots = await sql`SELECT * FROM bots WHERE user_id = ${uid} ORDER BY created_at DESC`;
    res.json(bots.map(b => {
        const rt = getRuntime(b.id);
        return { ...b, running: rt.proc != null, usage: rt.usage };
    }));
});

app.post('/api/bots', async (req, res) => {
    const { userId, name, language, tier = 'lite' } = req.body;
    if(!userId || !name) return res.status(400).json({ error: 'Missing data' });
    
    const selectedTier = TIERS[tier] || TIERS.lite;
    
    try {
        // 1. Check Credits
        const u = await sql`SELECT credits FROM users WHERE id = ${userId}`;
        if (!u.length) return res.status(404).json({ error: 'User not found' });
        if (u[0].credits < selectedTier.cost) return res.status(400).json({ error: 'Insufficient credits for this tier' });
        
        // 2. Check Free Tier Limit (Max 1 per user)
        if (tier === 'lite') {
            const freeBots = await sql`SELECT id FROM bots WHERE user_id = ${userId} AND ram_limit = 280`;
            if (freeBots.length >= 1) return res.status(400).json({ error: 'Free Tier Limit Reached: Max 1 Free Cluster per user.' });
        }
        
        // 3. Deduct Credits
        await sql`UPDATE users SET credits = credits - ${selectedTier.cost} WHERE id = ${userId}`;
        
        // 4. Create Bot
        const b = await sql`INSERT INTO bots (user_id, name, language, ram_limit, cpu_limit) 
            VALUES (${userId}, ${name}, ${language}, ${selectedTier.ram}, ${selectedTier.cpu}) RETURNING id`;
        res.json({ id: b[0].id });
    } catch(e) {
        res.status(500).json({ error: 'Deployment Failed: ' + e.message });
    }
});

app.get('/api/bots/:id', async (req, res) => {
    const bid = req.params.id;
    if(!bid || bid === 'undefined') return res.status(400).json({ error: 'Missing ID' });
    const b = await sql`SELECT * FROM bots WHERE id = ${bid}`;
    res.json({ ...b[0], running: getRuntime(bid).proc != null });
});

app.post('/api/bots/:id/save', async (req, res) => {
    const bid = req.params.id;
    const { name, code, token } = req.body;
    if(!bid || bid === 'undefined') return res.status(400).json({ error: 'Missing ID' });
    await sql`UPDATE bots SET name = ${name}, code = ${code}, token = ${token} WHERE id = ${bid}`;
    res.json({ success: true });
});

app.post('/api/bots/:id/start', async (req, res) => {
    spawnBot(req.params.id);
    res.json({ success: true });
});

app.post('/api/bots/:id/stop', async (req, res) => {
    const botId = req.params.id;
    const rt = getRuntime(botId);
    
    // Hard tree-kill any running processes (Ignition, Installer, Terminal)
    const killTree = (p) => {
        if (!p) return;
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${p.pid} /T /F`);
            } else {
                p.kill('SIGKILL');
            }
        } catch(e) {}
    };

    killTree(rt.proc);
    killTree(rt.installProc);
    killTree(rt.terminalProc);
    
    rt.proc = null;
    rt.installProc = null;
    rt.terminalProc = null;

    addLog(botId, `[SYS] Cluster forced offline by client.`);
    await sql`UPDATE bots SET status = 'stopped' WHERE id = ${botId}`;
    res.json({ success: true });
});

app.delete('/api/bots/:id', async (req, res) => {
    const bid = req.params.id;
    if(!bid || bid === 'undefined') return res.status(400).json({ error: 'Missing ID' });
    const rt = getRuntime(bid);
    if (rt.proc) rt.proc.kill();
    await sql`DELETE FROM bots WHERE id = ${bid}`;
    res.json({ success: true });
});

// Resources Armor (Multi-File Engine)
app.get('/api/bots/:id/files', (req, res) => {
    const bid = req.params.id;
    const subpath = req.query.path || '';
    if(!bid || bid === 'undefined') return res.json({ files: [] });
    try {
        const botDir = safePath(bid, subpath);
        if (!fs.existsSync(botDir)) return res.json({ files: [] });
        res.json({ 
            files: fs.readdirSync(botDir).map(f => ({ 
                name: f, 
                isDir: fs.statSync(path.join(botDir, f)).isDirectory() 
            })) 
        });
    } catch(e) { res.status(403).json({ error: 'Access Denied' }); }
});

app.get(/^\/api\/bots\/(\d+)\/files\/(.+)$/, (req, res) => {
    const id = req.params[0];
    const filename = req.params[1];
    try {
        const filePath = safePath(id, filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
        if (fs.statSync(filePath).isDirectory()) return res.status(400).json({ error: 'Cannot read directory' });
        res.send(fs.readFileSync(filePath, 'utf-8'));
    } catch(e) { res.status(403).json({ error: 'Access Denied' }); }
});

app.post('/api/bots/:id/files', (req, res) => {
    const { id } = req.params;
    const { filename, content } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });
    try {
        const filePath = safePath(id, filename);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content || '');
        res.json({ success: true });
    } catch(e) { res.status(403).json({ error: 'Access Denied' }); }
});

app.post('/api/bots/:id/folders', (req, res) => {
    const { id } = req.params;
    const { foldername } = req.body;
    if (!foldername) return res.status(400).json({ error: 'Folder name required' });
    try {
        const dirPath = safePath(id, foldername);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        res.json({ success: true });
    } catch(e) { res.status(403).json({ error: 'Access Denied' }); }
});

app.post('/api/bots/:id/upload', upload.array('files'), async (req, res) => {
    const { id } = req.params;
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    try {
        const botDir = safePath(id);
        for (const file of files) {
            const destPath = path.join(botDir, file.originalname);
            
            if (file.originalname.endsWith('.zip')) {
                // Handle ZIP extraction
                await fs.createReadStream(file.path)
                    .pipe(unzipper.Extract({ path: botDir }))
                    .promise();
            } else {
                // Move single file
                fs.copyFileSync(file.path, destPath);
            }
            // Cleanup temp file
            fs.unlinkSync(file.path);
        }
        res.json({ success: true });
    } catch(e) {
        console.error('Upload Error:', e);
        res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
});

app.delete(/^\/api\/bots\/(\d+)\/files\/(.+)$/, (req, res) => {
    const id = req.params[0];
    const filename = req.params[1];
    try {
        const filePath = safePath(id, filename);
        if (fs.existsSync(filePath)) {
            if (fs.statSync(filePath).isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(filePath);
            }
        }
        res.json({ success: true });
    } catch(e) { res.status(403).json({ error: 'Access Denied' }); }
});

// Console & Terminal Engine
app.get('/api/bots/:id/console', (req, res) => {
    const bid = req.params.id;
    if(!bid || bid === 'undefined') return res.end();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    const rt = getRuntime(bid);
    rt.logs.forEach(l => res.write(`data: ${JSON.stringify({ log: l })}\n\n`));
    rt.clients.add(res);
    req.on('close', () => rt.clients.delete(res));
});

app.post('/api/bots/exec', async (req, res) => {
    const { botId, command } = req.body;
    if(!botId || !command) return res.status(400).json({ error: 'Missing data' });
    
    const botDir = path.join(__dirname, '__bots__', String(botId));
    if(!fs.existsSync(botDir)) fs.mkdirSync(botDir, { recursive: true });
    
    addLog(botId, `> ${command}`);
    
    let finalCommand = command;
    // --- 🛡️ PEP 668 SHIELD ---
    if (process.platform !== 'win32' && command.includes('pip install') && !command.includes('--break-system-packages')) {
        finalCommand += ' --break-system-packages';
    }
    
    // Inject python paths into PATH if exists
    const injectedEnv = { ...process.env };
    if (pythonExe && process.platform === 'win32') {
        const pyDir = path.dirname(pythonExe);
        const scriptsDir = path.join(pyDir, 'Scripts');
        if (injectedEnv.Path) injectedEnv.Path = `${pyDir};${scriptsDir};${injectedEnv.Path}`;
        else if (injectedEnv.PATH) injectedEnv.PATH = `${pyDir};${scriptsDir};${injectedEnv.PATH}`;
    }

    // LIVE STREAMING ENGINE: Use spawn for real-time output
    const isWin = process.platform === 'win32';
    const proc = spawn(isWin ? 'cmd.exe' : 'bash', isWin ? ['/c', finalCommand] : ['-c', finalCommand], { 
        cwd: botDir, shell: false, env: injectedEnv 
    });

    const rt = getRuntime(botId);
    if (rt.terminalProc) { try { rt.terminalProc.kill(); } catch(e){} }
    rt.terminalProc = proc;

    const streamToLogs = (stream, prefix = '') => {
        let buffer = '';
        stream.on('data', d => {
            buffer += d.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line
            lines.forEach(l => {
                const clean = l.replace(/\r/g, '').trim();
                if (clean) addLog(botId, prefix + clean);
            });
        });
        stream.on('end', () => {
            if (buffer.trim()) addLog(botId, prefix + buffer.replace(/\r/g, '').trim());
        });
    };

    streamToLogs(proc.stdout);
    streamToLogs(proc.stderr, '[SYS] ');
    
    proc.on('close', (code) => {
        if (rt.terminalProc === proc) rt.terminalProc = null;
        addLog(botId, `[SYS] Command completed (Exit Code: ${code})`);
    });

    res.json({ success: true });
});

app.post('/api/bots/exec/stop', async (req, res) => {
    const { botId } = req.body;
    if (!botId) return res.status(400).json({ error: 'Missing data' });
    const rt = getRuntime(botId);
    if (rt.terminalProc) {
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${rt.terminalProc.pid} /T /F`);
            } else {
                rt.terminalProc.kill('SIGKILL');
            }
        } catch(e){}
        rt.terminalProc = null;
        addLog(botId, `[SYS] Command forcefully stopped by user.`);
    }
    res.json({ success: true });
});

// Admin System Armor
const ADMIN_GUARD = async (req, res, next) => {
    const adminId = req.headers['admin-id'] || req.body?.adminId;
    if (!adminId) return res.status(403).json({ error: 'No access' });
    try {
        const u = await sql`SELECT id, role, email FROM users WHERE id = ${adminId}`;
        if (!u[0]) return res.status(403).json({ error: 'No access' });
        const isBoss = u[0].email === 'naimkrymadh11111i@gmail.com';
        const isAdmin = u[0].role === 'admin';
        if (!isBoss && !isAdmin) return res.status(403).json({ error: 'No access' });
        req.adminUser = u[0];
        next();
    } catch(e) {
        res.status(403).json({ error: 'Auth check failed' });
    }
};

app.get('/api/admin/stats', ADMIN_GUARD, async (req, res) => {
    try {
        const users = await sql`SELECT id, name, email, role, credits FROM users ORDER BY id DESC`;
        const bots = await sql`SELECT id, user_id, name, language, status FROM bots ORDER BY id DESC`;
        const promos = await sql`SELECT * FROM promo_codes ORDER BY id DESC`;
        const ramMB = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
        const totalRamMB = Math.round(os.totalmem() / 1024 / 1024);
        const runningBots = Array.from(activeBots.values()).filter(b=>b.proc).length;

        // Attach bot count to each user
        const usersWithBots = users.map(u => ({
            ...u,
            botCount: bots.filter(b => b.user_id == u.id).length,
            activeBotCount: bots.filter(b => b.user_id == u.id && getRuntime(b.id).proc).length
        }));

        res.json({ 
            totalUsers: users.length,
            totalBots: bots.length,
            runningBots,
            ramMB,
            totalRamMB,
            users: usersWithBots,
            bots,
            promos
        });
    } catch(e) { 
        console.error('Admin API Fail:', e.message);
        res.status(500).json({ error: 'Dashboard breakdown: ' + e.message, totalUsers:0, totalBots:0, users:[], bots:[], promos:[] }); 
    }
});

// Admin: Get bots for a specific user
app.get('/api/admin/users/:id/bots', ADMIN_GUARD, async (req, res) => {
    const bots = await sql`SELECT * FROM bots WHERE user_id = ${req.params.id} ORDER BY created_at DESC`;
    res.json(bots.map(b => ({ ...b, running: getRuntime(b.id).proc != null })));
});

// Admin: Gift credits to user
app.post('/api/admin/users/:id/credits', ADMIN_GUARD, async (req, res) => {
    const { amount } = req.body;
    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });
    await sql`UPDATE users SET credits = credits + ${parseInt(amount)} WHERE id = ${req.params.id}`;
    const u = await sql`SELECT credits FROM users WHERE id = ${req.params.id}`;
    res.json({ success: true, newCredits: u[0]?.credits });
});

// Admin: Delete user
app.delete('/api/admin/users/:id', ADMIN_GUARD, async (req, res) => {
    const uid = req.params.id;
    // Kill all their bots first
    const bots = await sql`SELECT id FROM bots WHERE user_id = ${uid}`;
    for (const b of bots) {
        const rt = getRuntime(b.id);
        if (rt.proc) rt.proc.kill();
        await sql`DELETE FROM bots WHERE id = ${b.id}`;
    }
    await sql`DELETE FROM users WHERE id = ${uid}`;
    res.json({ success: true });
});

// Admin: Change user role
app.post('/api/admin/users/:id/role', ADMIN_GUARD, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await sql`UPDATE users SET role = ${role} WHERE id = ${req.params.id}`;
    res.json({ success: true });
});

// Admin: Kill a specific bot
app.post('/api/admin/bots/:id/kill', ADMIN_GUARD, async (req, res) => {
    const botId = req.params.id;
    const rt = getRuntime(botId);
    if (rt.proc) { try { exec(`taskkill /pid ${rt.proc.pid} /T /F`); } catch(e){} }
    rt.proc = null;
    addLog(botId, `[SYS] Cluster terminated by administrator.`);
    await sql`UPDATE bots SET status = 'stopped' WHERE id = ${botId}`;
    res.json({ success: true });
});

// Admin: Create promo code
app.post('/api/admin/promos', ADMIN_GUARD, async (req, res) => {
    const { code, credits, maxUses } = req.body;
    if (!code || !credits) return res.status(400).json({ error: 'Missing code or credits' });
    try {
        const cleanCode = code.trim().toUpperCase();
        const cr = parseInt(credits);
        const mu = parseInt(maxUses) || 1;
        await sql`INSERT INTO promo_codes (code, credits, max_uses, uses, created_by) VALUES (${cleanCode}, ${cr}, ${mu}, 0, ${req.headers['admin-id']})`;
        res.json({ success: true });
    } catch(e) {
        res.status(400).json({ error: 'Code already exists or DB error: ' + e.message });
    }
});

// Admin: Delete promo code
app.delete('/api/admin/promos/:id', ADMIN_GUARD, async (req, res) => {
    await sql`DELETE FROM promo_codes WHERE id = ${req.params.id}`;
    res.json({ success: true });
});

// Public: Claim promo code
app.post('/api/promos/claim', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: 'Missing data' });
    const cleanCode = code.trim().toUpperCase();
    const promo = await sql`SELECT * FROM promo_codes WHERE UPPER(code) = ${cleanCode}`;
    if (!promo[0]) return res.status(404).json({ error: 'Invalid promo code' });
    
    const cr = promo[0].credits || promo[0].reward_credits || 0;
    const maxUses = promo[0].max_uses || promo[0].uses_left || 1;
    const usedCount = promo[0].uses || 0;
    
    if (usedCount >= maxUses) return res.status(400).json({ error: 'This code has already been fully redeemed' });
    
    // Increment usage counter
    try { await sql`UPDATE promo_codes SET uses = uses + 1 WHERE id = ${promo[0].id}`; } catch(e) {
        // Fallback for old schema
        try { await sql`UPDATE promo_codes SET uses_left = uses_left - 1 WHERE id = ${promo[0].id}`; } catch(e2){}
    }
    await sql`UPDATE users SET credits = credits + ${cr} WHERE id = ${userId}`;
    const u = await sql`SELECT credits FROM users WHERE id = ${userId}`;
    res.json({ success: true, creditsAdded: cr, newCredits: u[0]?.credits });
});

// RAM Credit cost: 238 MB = 30 credits
const RAM_CREDIT_RATE = 30 / 238; // credits per MB
app.get('/api/credits/cost', (req, res) => {
    const { ram } = req.query; // RAM in MB
    const cost = Math.ceil((parseFloat(ram) || 238) * RAM_CREDIT_RATE);
    res.json({ ram: parseFloat(ram) || 238, credits: cost });
});

// --- SAFE ARMOR STARTUP ---
app.listen(PORT, async () => {
    console.log(`Royal Cluster Listening: http://localhost:${PORT}`);
    await initDB();
});

// Keep process alive forever
setInterval(() => { if (process.stdout.writable) {} }, 1000 * 60);
