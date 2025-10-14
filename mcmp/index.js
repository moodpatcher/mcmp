const https = require('https');
const express = require('express');
const app = express();
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const crypto = require('crypto');

app.set('view engine', 'ejs');
app.use(express.static('public'));

let sidebarOptions = {
    "🔒 Log In": "login",
    "🏡 Home": "home",
};

let sidebarOptionsLoggedIn = {
    "🛜 Virtual Networks": "networks",
    "💽 Volumes": "volumes",
    "💻 Containers": "containers",
    "🔋 Power Saving": "power_saving",
    "📍 Change Regions": "regions",
    "📊 Region Stats": "region_stats",
};

let pages = {
    "404": { login: false },
    "home": { login: false },
    "login": { login: false },
    "networks": { login: true },
    "volumes": { login: true },
    "containers": { login: true },
    "power_saving": { login: true },
    "regions": { login: true },
    "region_stats": { login: true },
    "templates": { login: true },
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// multer memory storage: keep uploaded file in RAM (no disk writes)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Use a persistent session secret
const secretPath = path.join(__dirname, 'config', 'session-secret.txt');
let secret;

if (fs.existsSync(secretPath)) {
    secret = fs.readFileSync(secretPath, 'utf8').trim();
} else {
    secret = crypto.randomBytes(32).toString('hex');
    // Ensure config directory exists
    const configDir = path.dirname(secretPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(secretPath, secret);
}

app.use(session({
    secret: secret,
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({
        checkPeriod: 3600 * 60 * 60
    })
}));

app.get('/', (req, res) => {
    if (!req.query.page) {
        res.redirect('/?page=home');
        return;
    }

    if (!fs.existsSync("views/" + req.query.page + ".ejs") && !systemPages.includes(req.query.page)) {
        res.redirect('/?page=404');
        return;
    }

    let currentSidebarOptions = JSON.parse(JSON.stringify(sidebarOptions));
    if (req.session.loggedIn) {
        console.log(req.session.userData.region)
        if (req.session.userData.region == "none" && req.query.page != "regions") {
            res.redirect('/?page=regions');
            return;
        }

        currentSidebarOptions = {...currentSidebarOptions, ...sidebarOptionsLoggedIn};

        delete currentSidebarOptions["🔒 Log In"];

        if (req.session.userData.adminLevel > 0) {
            currentSidebarOptions = {...currentSidebarOptions, ...sidebarOptionsAdmin};
        }

        currentSidebarOptions["👋 Log Out"] = "logout";
    }

    res.render("main.ejs", {
        site: req.query.page,
        sidebarOptions: currentSidebarOptions,
        loggedIn: req.session.loggedIn,
        userData: req.session.userData,
    });
});

let systemPages = [
];

for (let page in pages) {
    app.get("/" + page, (req, res) => {
        if (!req.get("Referer")) { res.redirect('/?page=home'); return;}
        if (pages[page].login && !req.session.loggedIn) { res.render('404.ejs'); return; }
        res.render(page + ".ejs", {});
    });
}

app.get("/logout", (req, res) => {
    if (!req.get("Referer")) { res.redirect('/?page=news'); return; }

    delete req.session.loggedIn;
    delete req.session.userData;

    res.render("logout.ejs");
});

app.post("/loginmanager", (req, res) => {
    if (!req.get("Referer")) { res.redirect('/?page=news'); return;}

    if (req.body && req.body.file_base64) {
        try {
            const b = Buffer.from(req.body.file_base64, 'base64');

            if (b.length > 5000) {
                res.json({ status: 'error', message: "File size too large!" });
                return;
            }

            const mimetype = req.body.file_mime || '';

            let key = b; // keep as Buffer
            const username = req.body.login;
            //let key = b.toString('utf8');
            const storedPath = path.join(__dirname, 'config', 'users', username);

            if (!fs.existsSync(storedPath)) {
                res.json({ status: 'error', message: 'Key mismatch!' });
                return;
            }

            const stored = fs.readFileSync(storedPath);
            // Compare lengths first, then timing-safe compare
            const match = (stored.length === key.length) && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(key));

            if (match) {
                req.session.loggedIn = true;
                req.session.userData = { username, region: "none" };
                res.json({ status: 'login_success' });
                return;
            } else {
                res.json({ status: 'error', message: 'Key mismatch!' });
                return;
            }
        } catch (e) {
            res.json({ status: 'error', message: 'File error!' });
            return;
        }
    }

    res.json({ status: 'error', message: 'Key mismatch!' });
});

function dataParser(r_data) {
    let dataArray = r_data.split('\n');
    
    let data = [];
    for (let c_data of dataArray) {
        if (c_data.startsWith('#')) continue;
        
        data.push(c_data.split(' '));
    }

    return data;
}

// SSH helper
const { execCommand } = require('./utils/ssh');

let regions = {};
function getRegions() {
    const storedPath = path.join(__dirname, 'config', 'nodes');
    let cfg_regions = dataParser(fs.readFileSync(storedPath, "utf8"));

    let newRegions = {};

    setTimeout(() => {getRegions(); }, 30000);

    return (async () => {
        for (let region of cfg_regions) {
            let regionName = region[0];
            let hostIP = region[1];
            let user = region[4];
            let keyName = region[3];
            let cmd = "cat /etc/os-release";
            let options = {};

            newRegions[regionName] = { ip: hostIP, user: user, key: keyName, online: false }

            try {
                const res = await execCommand(hostIP, user, keyName, cmd, options);
                newRegions[regionName].online = true;
            } catch (e) {
                //region cant be reached
            }
        }

        regions = newRegions;
    })();

}
getRegions();

// Power Saving Schedule Checker - runs every minute
function checkPowerSavingSchedules() {
    try {
        const schedulesPath = path.join(__dirname, 'config', 'power-saving-schedules.json');
        if (!fs.existsSync(schedulesPath)) return;
        
        const data = fs.readFileSync(schedulesPath, 'utf8');
        const allSchedules = JSON.parse(data);
        
        const now = new Date();
        const currentMinute = now.getMinutes();
        const currentHour = now.getHours();
        const currentDay = now.getDate();
        const currentMonth = now.getMonth() + 1; // JavaScript months are 0-based
        const currentWeekday = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
        
        allSchedules.forEach(schedule => {
            if (!schedule.enabled) return;
            
            // Check if this schedule should run now
            if (shouldRunSchedule(schedule, currentMinute, currentHour, currentDay, currentMonth, currentWeekday)) {
                executeSchedule(schedule);
            }
        });
    } catch (e) {
        console.error('Error checking power saving schedules:', e);
    }
}

function shouldRunSchedule(schedule, minute, hour, day, month, weekday) {
    // Check minute
    if (schedule.minute !== minute) return false;
    
    // Check hour
    if (schedule.hour !== hour) return false;
    
    // Check day of month
    if (schedule.day !== '*' && schedule.day !== day.toString()) {
        // Handle intervals like "*/2" (every 2 days)
        if (schedule.day.startsWith('*/')) {
            const interval = parseInt(schedule.day.substring(2));
            if (day % interval !== 0) return false;
        } else {
            return false;
        }
    }
    
    // Check month
    if (schedule.month !== '*' && schedule.month !== month.toString()) {
        return false;
    }
    
    // Check weekday
    if (schedule.weekday !== '*') {
        if (schedule.weekday.includes(',')) {
            // Handle comma-separated values like "0,6" (Sunday and Saturday)
            const days = schedule.weekday.split(',').map(d => parseInt(d.trim()));
            if (!days.includes(weekday)) return false;
        } else if (schedule.weekday.includes('-')) {
            // Handle ranges like "1-5" (Monday to Friday)
            const [start, end] = schedule.weekday.split('-').map(d => parseInt(d.trim()));
            if (weekday < start || weekday > end) return false;
        } else {
            // Single day
            if (parseInt(schedule.weekday) !== weekday) return false;
        }
    }
    
    return true;
}

function executeSchedule(schedule) {
    console.log(`Executing power saving schedule: ${schedule.name}`);
    
    const region = schedule.region;
    if (!regions || !regions[region]) {
        console.error(`Region ${region} not found for schedule ${schedule.name}`);
        return;
    }
    
    // Execute the docker command for each container
    schedule.containers.forEach(containerName => {
        const command = `docker ${schedule.action} ${containerName}`;
        sshCommand(region, command, (result) => {
            console.log(`Executed ${command} for schedule ${schedule.name}: ${result}`);
        });
    });
}

// Start the schedule checker - runs every minute
setInterval(checkPowerSavingSchedules, 60000); // 60 seconds = 1 minute

function sshCommand(region, command, result) {
    console.log(`sshCommand: (${region}) | ${command}`);

    return (async () => {
        try {
            const res = await execCommand(regions[region].ip, regions[region].user, regions[region].key, command, {});

            result(res.stdout);
            
        } catch (e) {
            //region cant be reached
        }
    })();
}

// Regions API: return the current regions map and selected region (requires login)
app.get('/api/regions', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }

    res.json({ status: 'ok', regions: regions || {}, selected: (req.session.userData && req.session.userData.region) || null });
});

// Select a region and store it in the session (requires login)
app.post('/api/regions/select', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }

    const { region } = req.body || {};
    if (!region) { res.status(400).json({ status: 'error', message: 'missing region' }); return; }
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'unknown region' }); return; }

    req.session.userData.region = region;

    res.json({ status: 'ok', selected: region });
});

// Networks API: list Docker networks (requires login)
app.get('/api/networks', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, 'docker network ls --format "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}"', (result) => {
        try {
            const networks = result.trim().split('\n').filter(line => line.trim()).map(line => {
                const [id, name, driver, scope] = line.split('|');
                return { id, name, driver, scope };
            });
            res.json({ status: 'ok', networks });
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Failed to parse network data' });
        }
    });
});

// Networks API: create Docker network (requires login)
app.post('/api/networks/create', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name, driver = 'bridge', subnet, gateway } = req.body || {};
    if (!name) { res.status(400).json({ status: 'error', message: 'network name required' }); return; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) { res.status(400).json({ status: 'error', message: 'invalid network name' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // Build docker command with optional CIDR parameters
    let cmd = `docker network create --driver ${driver}`;
    if (subnet) cmd += ` --subnet ${subnet}`;
    if (gateway) cmd += ` --gateway ${gateway}`;
    cmd += ` ${name}`;

    sshCommand(region, cmd, (result) => {
        res.json({ status: 'ok', message: `Network '${name}' created successfully` });
    });
});

// Networks API: inspect network details (requires login)
app.get('/api/networks/:name', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    if (!name) { res.status(400).json({ status: 'error', message: 'network name required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker network inspect ${name}`, (result) => {
        try {
            const data = JSON.parse(result);
            if (Array.isArray(data) && data.length > 0) {
                const network = data[0];
                res.json({ status: 'ok', network });
            } else {
                res.status(404).json({ status: 'error', message: 'Network not found' });
            }
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Failed to parse network data' });
        }
    });
});

// Networks API: delete network (requires login)
app.delete('/api/networks/:name', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    if (!name) { res.status(400).json({ status: 'error', message: 'network name required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker network rm ${name}`, (result) => {
        res.json({ status: 'ok', message: `Network '${name}' deleted successfully` });
    });
});

// Networks API: edit network (recreate with new settings) (requires login)
app.put('/api/networks/:name', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    const { driver = 'bridge', subnet, gateway } = req.body || {};
    
    if (!name) { res.status(400).json({ status: 'error', message: 'network name required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // First delete the existing network, then create a new one
    sshCommand(region, `docker network rm ${name}`, (deleteResult) => {
        // Build docker command with optional CIDR parameters
        let cmd = `docker network create --driver ${driver}`;
        if (subnet) cmd += ` --subnet ${subnet}`;
        if (gateway) cmd += ` --gateway ${gateway}`;
        cmd += ` ${name}`;

        sshCommand(region, cmd, (createResult) => {
            res.json({ status: 'ok', message: `Network '${name}' updated successfully` });
        });
    });
});

// Containers API: list Docker containers (requires login)
app.get('/api/containers', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}"', (result) => {
        try {
            const containers = result.trim().split('\n').filter(line => line.trim()).map(line => {
                const [id, names, image, status, ports, createdAt] = line.split('|');
                return { id, names, image, status, ports, createdAt };
            });
            res.json({ status: 'ok', containers });
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Failed to parse container data' });
        }
    });
});

// Containers API: create Docker container (requires login)
app.post('/api/containers/create', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { 
        name, 
        image, 
        command = '', 
        ports = '', 
        env = '', 
        volumes = '', 
        networks = '', 
        devices = '',
        customCommand = '',
        privileged = false, 
        restart = 'no',
        detach = true 
    } = req.body || {};
    
    if (!name || !image) { res.status(400).json({ status: 'error', message: 'container name and image required' }); return; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) { res.status(400).json({ status: 'error', message: 'invalid container name' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // Build docker run command with all parameters
    let cmd = 'docker run';
    if (detach) cmd += ' -d';
    if (privileged) cmd += ' --privileged';
    if (restart !== 'no') cmd += ` --restart ${restart}`;
    if (name) cmd += ` --name ${name}`;
    
    // Handle multiple ports
    if (ports) {
        const portList = ports.split(',').map(p => p.trim()).filter(p => p);
        portList.forEach(port => {
            cmd += ` -p ${port}`;
        });
    }
    
    // Handle multiple environment variables
    if (env) {
        const envList = env.split(',').map(e => e.trim()).filter(e => e);
        envList.forEach(envVar => {
            cmd += ` -e ${envVar}`;
        });
    }
    
    // Handle multiple volumes
    if (volumes) {
        const volumeList = volumes.split(',').map(v => v.trim()).filter(v => v);
        volumeList.forEach(volume => {
            cmd += ` -v ${volume}`;
        });
    }
    
    // Handle multiple devices
    if (devices) {
        const deviceList = devices.split(',').map(d => d.trim()).filter(d => d);
        deviceList.forEach(device => {
            cmd += ` --device ${device}`;
        });
    }
    
    if (networks) cmd += ` --network ${networks}`;
    if (customCommand) cmd += ` ${customCommand}`;
    cmd += ` ${image}`;
    if (command) cmd += ` ${command}`;

    sshCommand(region, cmd, (result) => {
        res.json({ status: 'ok', message: `Container '${name}' created successfully` });
    });
});

// Containers API: start container (requires login)
app.post('/api/containers/:id/start', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    if (!id) { res.status(400).json({ status: 'error', message: 'container id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker start ${id}`, (result) => {
        res.json({ status: 'ok', message: `Container ${id} started successfully` });
    });
});

// Containers API: stop container (requires login)
app.post('/api/containers/:id/stop', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    if (!id) { res.status(400).json({ status: 'error', message: 'container id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker stop ${id}`, (result) => {
        res.json({ status: 'ok', message: `Container ${id} stopped successfully` });
    });
});

// Containers API: inspect container details (requires login)
app.get('/api/containers/:id', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    if (!id) { res.status(400).json({ status: 'error', message: 'container id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker inspect ${id}`, (result) => {
        try {
            const data = JSON.parse(result);
            if (Array.isArray(data) && data.length > 0) {
                const container = data[0];
                res.json({ status: 'ok', container });
            } else {
                res.status(404).json({ status: 'error', message: 'Container not found' });
            }
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Failed to parse container data' });
        }
    });
});

// Containers API: fetch container logs (requires login)
app.get('/api/containers/:id/logs', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    const tail = parseInt(req.query.tail, 10);
    const tailCount = Number.isFinite(tail) && tail > 0 ? tail : 200;
    if (!id) { res.status(400).json({ status: 'error', message: 'container id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    const cmd = `docker logs --tail ${tailCount} ${id}`;
    sshCommand(region, cmd, (result) => {
        res.json({ status: 'ok', logs: result });
    });
});

// Containers API: delete container (requires login)
app.delete('/api/containers/:id', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    if (!id) { res.status(400).json({ status: 'error', message: 'container id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker rm -f ${id}`, (result) => {
        res.json({ status: 'ok', message: `Container ${id} deleted successfully` });
    });
});

// Power Saving API: get power saving schedules (requires login)
app.get('/api/power-saving', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    try {
        const schedulesPath = path.join(__dirname, 'config', 'power-saving-schedules.json');
        let schedules = [];
        
        if (fs.existsSync(schedulesPath)) {
            const data = fs.readFileSync(schedulesPath, 'utf8');
            const allSchedules = JSON.parse(data);
            // Filter schedules for the current region
            schedules = allSchedules.filter(schedule => schedule.region === region);
        }
        
        res.json({ status: 'ok', schedules });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Failed to load schedule data' });
    }
});

// Power Saving API: create power saving schedule (requires login)
app.post('/api/power-saving', (req, res) => {
    console.log('Power saving create request - Session:', req.session ? 'exists' : 'missing', 'Logged in:', req.session?.loggedIn, 'Region:', req.session?.userData?.region);
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { 
        name, 
        minute, 
        hour, 
        day = '*', 
        month = '*', 
        weekday = '*', 
        containers = [], 
        action = 'stop' 
    } = req.body || {};
    
    if (!name || !minute || hour === undefined || !containers.length) { 
        res.status(400).json({ status: 'error', message: 'name, time, and containers are required' }); 
        return; 
    }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    try {
        const schedulesPath = path.join(__dirname, 'config', 'power-saving-schedules.json');
        let allSchedules = [];
        
        if (fs.existsSync(schedulesPath)) {
            const data = fs.readFileSync(schedulesPath, 'utf8');
            allSchedules = JSON.parse(data);
        }
        
        // Create new schedule
        const newSchedule = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            name,
            minute: parseInt(minute),
            hour: parseInt(hour),
            day,
            month,
            weekday,
            containers,
            action,
            region,
            enabled: true,
            createdAt: new Date().toISOString()
        };
        
        allSchedules.push(newSchedule);
        
        // Ensure config directory exists
        const configDir = path.dirname(schedulesPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(schedulesPath, JSON.stringify(allSchedules, null, 2));
        
        res.json({ status: 'ok', message: `Power saving schedule '${name}' created successfully` });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Failed to save schedule' });
    }
});

// Power Saving API: delete power saving schedule (requires login)
app.delete('/api/power-saving/:id', (req, res) => {
    console.log('Power saving delete request - Session:', req.session ? 'exists' : 'missing', 'Logged in:', req.session?.loggedIn, 'Region:', req.session?.userData?.region);
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { id } = req.params;
    if (!id) { res.status(400).json({ status: 'error', message: 'schedule id required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    try {
        const schedulesPath = path.join(__dirname, 'config', 'power-saving-schedules.json');
        let allSchedules = [];
        
        if (fs.existsSync(schedulesPath)) {
            const data = fs.readFileSync(schedulesPath, 'utf8');
            allSchedules = JSON.parse(data);
        }
        
        // Remove the schedule with the specified ID
        const initialLength = allSchedules.length;
        allSchedules = allSchedules.filter(schedule => schedule.id !== id);
        
        if (allSchedules.length === initialLength) {
            res.status(404).json({ status: 'error', message: 'Schedule not found' });
            return;
        }
        
        fs.writeFileSync(schedulesPath, JSON.stringify(allSchedules, null, 2));
        
        res.json({ status: 'ok', message: 'Power saving schedule deleted successfully' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: 'Failed to delete schedule' });
    }
});

// SSH Command Execution API: execute custom SSH commands (requires login)
app.post('/api/ssh-exec', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { command } = req.body || {};
    if (!command) { res.status(400).json({ status: 'error', message: 'command required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, command, (result) => {
        res.json({ status: 'ok', output: result });
    });
});

// System Control API: reboot region (requires login)
app.post('/api/region-reboot', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, 'sudo reboot', (result) => {
        res.json({ status: 'ok', message: 'Reboot command sent successfully' });
    });
});

// System Control API: shutdown region (requires login)
app.post('/api/region-shutdown', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, 'sudo shutdown -h now', (result) => {
        res.json({ status: 'ok', message: 'Shutdown command sent successfully' });
    });
});

// Region Stats API: get system stats (requires login)
app.get('/api/region-stats', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // Get memory usage
    sshCommand(region, 'free -h', (memoryResult) => {
        // Get CPU usage
        sshCommand(region, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | awk -F'%' '{print $1}'", (cpuResult) => {
            // Get system load
            sshCommand(region, 'uptime', (uptimeResult) => {
                // Get OS info
                sshCommand(region, 'cat /etc/os-release', (osResult) => {
                    // Get hostname
                    sshCommand(region, 'hostname', (hostnameResult) => {
                        // Get CPU architecture
                        sshCommand(region, 'uname -m', (archResult) => {
                            // Get disk usage
                            sshCommand(region, 'df -h', (diskResult) => {
                                try {
                                    // Parse memory info
                                    const memoryLines = memoryResult.trim().split('\n');
                                    const memInfo = memoryLines[1].split(/\s+/);
                                    const swapInfo = memoryLines[2].split(/\s+/);

                                    // Parse OS info
                                    const osLines = osResult.trim().split('\n');
                                    const osInfo = {};
                                    osLines.forEach(line => {
                                        const [key, value] = line.split('=');
                                        if (key && value) {
                                            osInfo[key] = value.replace(/"/g, '');
                                        }
                                    });

                                    // Parse disk info
                                    const diskLines = diskResult.trim().split('\n').slice(1);
                                    const diskUsage = diskLines.map(line => {
                                        const parts = line.split(/\s+/);
                                        return {
                                            filesystem: parts[0],
                                            size: parts[1],
                                            used: parts[2],
                                            available: parts[3],
                                            usePercent: parts[4],
                                            mounted: parts[5]
                                        };
                                    });

                                    const stats = {
                                        memory: {
                                            total: memInfo[1],
                                            used: memInfo[2],
                                            free: memInfo[3],
                                            available: memInfo[6],
                                            swapTotal: swapInfo[1],
                                            swapUsed: swapInfo[2],
                                            swapFree: swapInfo[3]
                                        },
                                        cpu: {
                                            usage: parseFloat(cpuResult.trim()) || 0
                                        },
                                        system: {
                                            uptime: uptimeResult.trim(),
                                            hostname: hostnameResult.trim(),
                                            architecture: archResult.trim(),
                                            os: {
                                                name: osInfo.NAME || 'Unknown',
                                                version: osInfo.VERSION || 'Unknown',
                                                id: osInfo.ID || 'Unknown',
                                                versionId: osInfo.VERSION_ID || 'Unknown'
                                            }
                                        },
                                        disk: diskUsage
                                    };

                                    res.json({ status: 'ok', stats });
                                } catch (e) {
                                    res.status(500).json({ status: 'error', message: 'Failed to parse system stats' });
                                }
                            });
                        });
                    });
                });
            });
        });
    });
});

// Volumes API: list Docker volumes (requires login)
app.get('/api/volumes', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, 'docker volume ls --format \'{{.Name}}\' | xargs -I{} sh -c \'echo -n "{}|"; du -sh "$(docker volume inspect {} --format "{{.Mountpoint}}")" 2>/dev/null | cut -f1\'', (result) => {
        try {
            const volumes = result.trim().split('\n').filter(line => line.trim()).map(line => {
                const [name, size] = line.split('|');
                return { name, size };
            });
            res.json({ status: 'ok', volumes });
        } catch (e) {
            res.status(500).json({ status: 'error', message: 'Failed to parse network data' });
        }
    });
});

// Volumes API: delete volume (requires login)
app.delete('/api/volumes/:name', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    if (!name) { res.status(400).json({ status: 'error', message: 'volume name required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    sshCommand(region, `docker volume rm -f ${name}`, (result) => {
        res.json({ status: 'ok', message: `Volume '${name}' deleted successfully` });
    });
});

// Volumes API: backup volume (requires login)
app.post('/api/volumes/:name/backup', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    if (!name) { res.status(400).json({ status: 'error', message: 'volume name required' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // Generate backup volume name like bkp-<name>-YYYYMMDD-HHmm
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const y = now.getFullYear();
    const mo = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const backupName = `bkp-${name}-${y}${mo}${d}-${hh}${mm}`;

    // Create destination volume
    sshCommand(region, `docker volume create ${backupName}`, (createOut) => {
        // Use a throwaway container to copy contents from source to destination
        // Use tar stream to preserve permissions and handle busybox/alpine reliably
        const copyCmd = `docker run --rm -v ${name}:/src:ro -v ${backupName}:/dest alpine sh -c "cd /src && tar cf - . | (cd /dest && tar xpf -)"`;
        sshCommand(region, copyCmd, (copyOut) => {
            res.json({ status: 'ok', message: `Backup created as '${backupName}'`, backup: backupName });
        });
    });
});

// Volumes API: rename volume (requires login)
app.post('/api/volumes/:name/rename', (req, res) => {
    if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
    if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

    const { name } = req.params;
    const { newName } = req.body || {};
    if (!name || !newName) { res.status(400).json({ status: 'error', message: 'volume name and newName required' }); return; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(newName)) { res.status(400).json({ status: 'error', message: 'invalid new volume name' }); return; }

    const region = req.session.userData.region;
    if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

    // Create destination volume with new name and copy contents
    sshCommand(region, `docker volume create ${newName}`, (createOut) => {
        const copyCmd = `docker run --rm -v ${name}:/src:ro -v ${newName}:/dest alpine sh -c "cd /src && tar cf - . | (cd /dest && tar xpf -)"; docker volume rm -f ${name}`;
        sshCommand(region, copyCmd, (copyOut) => {
            res.json({ status: 'ok', message: `Volume renamed to '${newName}'`, newName });
        });
    });
});

let templates = {};
function readTemplates(done) {
    const templatesPath = path.join(__dirname, 'config', 'templates');

    fs.readdir(templatesPath, (err, files) => {
        if (err) {
            console.error('Error reading templates directory:', err);
            return;
        }

        templates = {};

        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(templatesPath, file);

                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    let template = JSON.parse(content);
                    
                    if (!templates[template.folder]) templates[template.folder] = [];
                    templates[template.folder].push(template);
                } catch (e) {
                    console.error(`Error reading or parsing ${file}:`, e);
                }
            }
        }

        if (done != null) done();
    });

    //setTimeout(readTemplates, 30000);
}
//readTemplates();

// Templates API: list Container Templates (requires login)
app.get('/api/templates', (req, res) => {
    readTemplates(() => {
        if (!req.session || !req.session.loggedIn) { res.status(401).json({ status: 'error', message: 'unauthenticated' }); return; }
        if (!req.session.userData.region || req.session.userData.region === 'none') { res.status(400).json({ status: 'error', message: 'no region selected' }); return; }

        const region = req.session.userData.region;
        if (!regions || !regions[region]) { res.status(400).json({ status: 'error', message: 'invalid region' }); return; }

        res.json({ status: 'ok', templates });
    });
});

//404 - keep this last so API routes above are reachable
app.use((req, res, next) => {
    res.redirect('/?page=404');
});
 
app.listen(8080, () => {
});

