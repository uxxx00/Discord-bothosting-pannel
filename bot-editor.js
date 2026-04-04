(() => {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) { window.location.href = '/'; return; }

    const botId = new URLSearchParams(window.location.search).get('id');
    if (!botId) { window.location.href = '/dashboard.html'; return; }

    let eventSource = null;
    let activeFile = 'bot.js';
    let currentPath = ''; // Track active directory
    const editor = document.getElementById('editor');
    const consoleOutput = document.getElementById('console-output');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const botNameInput = document.getElementById('bot-name');
    const botNameDisplay = document.getElementById('bot-name-display');
    const activeFileNameDisplay = document.getElementById('active-filename');
    const tokenInput = document.getElementById('bot-token');
    const discordIdentity = document.getElementById('discord-identity');
    const discordAvatar = document.getElementById('discord-avatar');
    const discordUsername = document.getElementById('discord-username');

    let validateTimeout;
    tokenInput.addEventListener('input', () => {
        clearTimeout(validateTimeout);
        validateTimeout = setTimeout(validateDiscordToken, 800);
    });

    async function validateDiscordToken() {
        const token = tokenInput.value.trim();
        if (!token) {
            if (discordIdentity) discordIdentity.style.display = 'none';
            return;
        }

        try {
            const res = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { 'Authorization': `Bot ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (discordIdentity) {
                    discordIdentity.style.display = 'flex';
                    discordAvatar.src = data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
                    discordUsername.textContent = data.discriminator && data.discriminator !== '0' ? `${data.username}#${data.discriminator}` : data.username;
                }
            } else {
                if (discordIdentity) discordIdentity.style.display = 'none';
            }
        } catch(e) {
            if (discordIdentity) discordIdentity.style.display = 'none';
        }
    }

    async function loadBot() {
        const res = await fetch(`/api/bots/${botId}`);
        const bot = await res.json();
        if (bot.error) return (window.location.href = '/dashboard.html');

        botNameInput.value = bot.name;
        botNameDisplay.textContent = `INSTANCE #${bot.id} — ${bot.name}`;
        tokenInput.value = bot.token || '';
        validateDiscordToken();
        
        activeFile = bot.language === 'nodejs' ? 'bot.js' : (bot.language === 'python' ? 'bot.py' : 'bot.bat');
        activeFileNameDisplay.textContent = activeFile.toUpperCase();
        editor.value = bot.code || '';
        
        setStatus(bot.running);
        loadFiles();
        connectConsole();
        startMetricPolling();
    }

    function startMetricPolling() {
        setInterval(async () => {
            try {
                const res = await fetch(`/api/bots/${botId}`);
                const bot = await res.json();
                if (bot.usage) {
                    const ram = document.getElementById('ram-usage');
                    const cpu = document.getElementById('cpu-usage');
                    if (ram) ram.textContent = `${bot.usage.ram} MB`;
                    if (cpu) cpu.textContent = `${bot.usage.cpu}%`;
                }
                if (bot.running !== undefined) {
                    const currentStatus = statusText.textContent;
                    if (currentStatus !== 'CONNECTING...') {
                        setStatus(bot.running);
                    }
                }
            } catch(e) {}
        }, 5000);
    }

    window.loadFiles = async function() {
        const res = await fetch(`/api/bots/${botId}/files?path=${currentPath}`);
        const data = await res.json();
        const list = document.getElementById('file-list');
        
        let html = '';
        
        // Add "Go Back" if in a subfolder
        if (currentPath) {
            html += `
                <div class="file-item" style="padding:8px 12px; border-radius:8px; cursor:pointer; color:var(--p); font-size:12px; display:flex; align-items:center; gap:8px;" 
                     onclick="goBack()">
                    <span style="font-size:10px; font-weight:800; opacity:0.5;">[UP]</span> 
                    <span style="flex:1;">.. / ${currentPath}</span>
                </div>
            `;
        }

        html += data.files.map(f => {
            const fullPath = currentPath ? `${currentPath}/${f.name}` : f.name;
            const isActive = fullPath.toUpperCase() === activeFile.toUpperCase();
            return `
                <div class="file-item" style="padding:8px 12px; border-radius:8px; cursor:pointer; background:${isActive ? 'rgba(255,255,255,0.05)' : 'transparent'}; color:${isActive ? 'var(--p)' : '#ccc'}; font-size:12px; display:flex; align-items:center; gap:8px; transition:0.2s;" 
                     onclick="${f.isDir ? `openFolder('${f.name}')` : `switchFile('${fullPath}')`}"
                     onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='${isActive ? 'rgba(255,255,255,0.05)' : 'transparent'}'">
                    <span style="font-size:10px; font-weight:800; opacity:0.5;">${f.isDir ? '[DIR]' : '[FILE]'}</span> 
                    <span style="flex:1; font-weight:${isActive ? 'bold' : 'normal'};">${f.name}</span>
                    ${!['bot.js', 'bot.py', 'bot.bat', 'bot.sh', 'package.json', 'requirements.txt'].includes(f.name) ? 
                        `<button style="background:transparent; border:none; color:#ff4444; font-size:10px; font-weight:800; cursor:pointer; padding:2px 6px; border: 1px solid rgba(255,68,68,0.3); border-radius:4px;" onclick="e=event; e.stopPropagation(); deleteFile('${fullPath}', ${f.isDir})" title="Delete">${f.isDir ? 'RMDIR' : 'DEL'}</button>` : 
                        `<span style="font-size:10px; font-weight:800; opacity:0.3; color:#fff; border: 1px solid rgba(255,255,255,0.3); padding:2px 6px; border-radius:4px;" title="Core configuration file (locked)">SYS</span>`}
                </div>
            `;
        }).join('');
        
        list.innerHTML = html;
    }

    window.toggleSidebar = function() {
        document.querySelector('.sidebar').classList.toggle('active');
    };

    window.closeSidebar = function() {
        document.querySelector('.sidebar').classList.remove('active');
    };

    window.toggleTerminal = function(force = null) {
        const tray = document.querySelector('.terminal-tray');
        if (force === true) tray.classList.add('active');
        else if (force === false) tray.classList.remove('active');
        else tray.classList.toggle('active');
    };

    window.openFolder = function(name) {
        currentPath = currentPath ? `${currentPath}/${name}` : name;
        loadFiles();
        if (window.innerWidth <= 900) closeSidebar();
    };

    window.goBack = function() {
        const parts = currentPath.split('/');
        parts.pop();
        currentPath = parts.join('/');
        loadFiles();
    };

    window.switchFile = async function(filename) {
        if (activeFile === filename) return;
        activeFile = filename;
        activeFileNameDisplay.textContent = filename.toUpperCase();
        if (window.innerWidth <= 900) closeSidebar();
        const res = await fetch(`/api/bots/${botId}/files/${encodeURIComponent(filename)}`);
        if (res.ok) {
            editor.value = await res.text();
        } else {
            editor.value = '// File not found or empty';
        }
        loadFiles();
    };

    window.newFile = async function() {
        const name = prompt('Filename (e.g. config.json):');
        if (!name) return;
        const fullPath = currentPath ? `${currentPath}/${name}` : name;
        await fetch(`/api/bots/${botId}/files`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: fullPath, content: '' })
        });
        loadFiles();
        switchFile(fullPath);
    };

    window.newFolder = async function() {
        const name = prompt('Folder Name (e.g. src):');
        if (!name) return;
        const fullPath = currentPath ? `${currentPath}/${name}` : name;
        await fetch(`/api/bots/${botId}/folders`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ foldername: fullPath })
        });
        loadFiles();
    };

    window.uploadFiles = async function(input) {
        if (!input.files || input.files.length === 0) return;
        
        const formData = new FormData();
        for (const file of input.files) {
            formData.append('files', file);
        }

        const line = document.createElement('div');
        line.innerHTML = `<span style="color:var(--p)">[SYS] Uploading ${input.files.length} file(s)...</span>`;
        consoleOutput.appendChild(line);

        try {
            const res = await fetch(`/api/bots/${botId}/upload`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                addLog(botId, `[SYS] Upload successful! Files processed.`);
                loadFiles();
            } else {
                addLog(botId, `[ERR] Upload failed.`);
            }
        } catch(e) {
            addLog(botId, `[ERR] Upload error: ${e.message}`);
        }
        input.value = ''; // Reset input
    };

    window.deleteFile = async function(name, isDir = false) {
        if (!confirm(`Delete ${isDir ? 'folder' : 'file'} ${name}?${isDir ? ' This will delete all contents!' : ''}`)) return;
        await fetch(`/api/bots/${botId}/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
        
        if (activeFile.startsWith(name)) {
            const mainFile = document.getElementById('bot-name').getAttribute('data-lang') === 'python' ? 'bot.py' : 'bot.js';
            switchFile(mainFile);
        } else {
            loadFiles();
        }
    };

    function setStatus(status) {
        // status can be true/false or 'CONNECTING'
        const isRunning = status === true;
        const isConnecting = status === 'CONNECTING';

        statusText.textContent = isConnecting ? 'CONNECTING...' : (isRunning ? 'RUNNING' : 'IDLE');
        statusDot.style.background = isConnecting ? '#f59e0b' : (isRunning ? '#00ff00' : '#555');
        statusDot.style.boxShadow = isConnecting ? '0 0 10px #f59e0b' : (isRunning ? '0 0 10px #00ff00' : 'none');

        document.getElementById('start-btn').disabled = isRunning || isConnecting;
        document.getElementById('stop-btn').disabled = !isRunning;
    }

    function connectConsole() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`/api/bots/${botId}/console`);
        eventSource.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.log) {
                const line = document.createElement('div');
                line.textContent = data.log;
                if (data.log.includes('[ERR]') || data.log.includes('[FAIL]')) line.style.color = '#ff4444';
                if (data.log.includes('[SYS]')) line.style.color = '#7289da';
                consoleOutput.appendChild(line);
                consoleOutput.scrollTop = consoleOutput.scrollHeight;
            }
        };
    }

    window.saveBot = async function() {
        // Save current active file content to the cluster folder FIRST
        await fetch(`/api/bots/${botId}/files`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: activeFile, content: editor.value })
        });

        // Also save core metadata to the database
        await fetch(`/api/bots/${botId}/save`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: botNameInput.value, 
                token: tokenInput.value,
                code: activeFile.includes('bot.') ? editor.value : '' // Only sync main code to DB
            })
        });

        const line = document.createElement('div');
        line.innerHTML = `<span style="color:var(--p)">[SYS] Syncing cluster: ${activeFile.toUpperCase()} saved.</span>`;
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
        loadFiles();
    };

    window.startBot = async function() {
        setStatus('CONNECTING');
        await window.saveBot();
        const res = await fetch(`/api/bots/${botId}/start`, { method: 'POST' });
        if(res.ok) {
            // Give it 1 second to warm up before checking state, or rely on console
            setTimeout(() => { if(statusText.textContent === 'CONNECTING...') setStatus(true); }, 1500);
        } else {
            setStatus(false);
        }
    };

    window.stopBot = async function() {
        const res = await fetch(`/api/bots/${botId}/stop`, { method: 'POST' });
        if(res.ok) setStatus(false);
    };

    window.execCommand = async function(e) {
        if (e.key !== 'Enter') return;
        await window.forceExec();
    };

    window.forceExec = async function() {
        const input = document.getElementById('terminal-input');
        const command = input.value.trim();
        if (!command) return;
        
        await fetch('/api/bots/exec', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botId, command })
        });
        input.value = '';
    };

    window.stopTerminalCmd = async function() {
        await fetch('/api/bots/exec/stop', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botId })
        });
    };

    window.loadFiles();
    loadBot();
})();
