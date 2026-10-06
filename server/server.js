/**
 * Continuous Calendar Server (خادم التقويم المستمر المتكامل)
 * Multi-user Authentication, Admission Queue, Browser Tokens,
 * Notes Permissions, Recurring Events, and Delta Sync.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const needs = require('./needs');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve(process.env.CALENDAR_DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'));
const bootstrapPassword = process.env.CALENDAR_ADMIN_PASSWORD || '';
if (!fs.existsSync(DATA_FILE) && bootstrapPassword.length < 12) {
    console.error('First start requires CALENDAR_ADMIN_PASSWORD with at least 12 characters.');
    process.exit(1);
}
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true, mode: 0o700 });

// Default initial state
const defaultState = {
    settings: {
        openDoor: {
            enabled: false,
            expiresAt: 0 // timestamp ms, or -1 for infinite
        }
    },
    users: [
        {
            id: 'user_admin',
            username: 'admin',
            name: 'admin',
            color: '#38bdf8',
            avatar: '',
            password: bootstrapPassword,
            status: 'approved', // 'approved', 'pending', 'rejected'
            role: 'admin',
            tokens: [],
            createdAt: Date.now(),
            settings: {}
        }
    ],
    notes: {}, // parentId (e.g. '7_28_2026') -> array of note objects
    recurringEvents: [], // array of recurring event objects
    indicators: [
        { id: 'builtin-ramadan', nameAr: 'شهر رمضان المبارك', nameEn: 'Holy Month of Ramadan', icon: '🌙', color: '#16a34a', type: 'hijri', hijriMonth: 9, hijriStartDay: 1, hijriEndDay: 30, builtin: true, enabled: true },
        { id: 'builtin-eid-fitr', nameAr: 'عيد الفطر المبارك', nameEn: 'Eid al-Fitr', icon: '🎉', color: '#d97706', type: 'hijri', hijriMonth: 10, hijriStartDay: 1, hijriEndDay: 3, builtin: true, enabled: true },
        { id: 'builtin-eid-adha', nameAr: 'عيد الأضحى ويوم عرفة', nameEn: 'Eid al-Adha & Arafah', icon: '🐑', color: '#9333ea', type: 'hijri', hijriMonth: 12, hijriStartDay: 9, hijriEndDay: 13, builtin: true, enabled: true },
        { id: 'builtin-saudi-national', nameAr: 'اليوم الوطني السعودي', nameEn: 'Saudi National Day', icon: '🇸🇦', color: '#059669', type: 'gregorian', gregMonth: 9, gregStartDay: 23, gregEndDay: 23, builtin: true, enabled: true },
        { id: 'builtin-saudi-founding', nameAr: 'يوم التأسيس السعودي', nameEn: 'Saudi Founding Day', icon: '🇸🇦', color: '#047857', type: 'gregorian', gregMonth: 2, gregStartDay: 22, gregEndDay: 22, builtin: true, enabled: true }
    ],
    lastUpdated: Date.now()
};

let db = null;
let dbSaveTimeout = null;
db = loadDB();
needs.initializeNeeds(db);

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(raw);
            const merged = Object.assign({}, defaultState, data);
            if (!Array.isArray(merged.indicators) || !merged.indicators.length) {
                merged.indicators = defaultState.indicators;
            }
            return merged;
        }
    } catch (err) {
        throw new Error('Unable to read Calendar database; refusing to replace it.', { cause: err });
    }
    saveDB(defaultState, true);
    return defaultState;
}

function saveDB(data, immediate) {
    db = data || db;
    db.lastUpdated = Date.now();
    if (dbSaveTimeout) { clearTimeout(dbSaveTimeout); dbSaveTimeout = null; }
    const temporary = DATA_FILE + '.tmp';
    const write = () => {
        fs.writeFileSync(temporary, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, DATA_FILE);
    };
    if (immediate) return write();
    dbSaveTimeout = setTimeout(() => {
        dbSaveTimeout = null;
        try { write(); } catch (error) { console.error('Error saving calendar database:', error); }
    }, 50);
}

function isOpenDoorActive() {
    if (!db.settings || !db.settings.openDoor) return false;
    const od = db.settings.openDoor;
    if (!od.enabled) return false;
    if (od.expiresAt === -1) return true;
    if (Date.now() < od.expiresAt) return true;
    // Expired
    od.enabled = false;
    saveDB();
    return false;
}

function generateToken() {
    return 'tok_' + crypto.randomBytes(32).toString('hex');
}

function findUserByToken(token) {
    if (!token || !Array.isArray(db.users)) return null;
    return db.users.find(u => u && Array.isArray(u.tokens) && u.tokens.includes(token)) || null;
}

function findUserByUsername(uname) {
    if (typeof uname !== 'string' || !uname.trim() || !Array.isArray(db.users)) return null;
    const clean = uname.trim().toLowerCase();
    return db.users.find(u => u && typeof u.username === 'string' && u.username.toLowerCase() === clean) || null;
}

function revokeTokenFromAllUsers(tok) {
    if (!tok) return;
    if (!Array.isArray(db.users)) return;
    db.users.forEach(u => {
        if (!u || typeof u !== 'object') return;
        if (Array.isArray(u.tokens) && u.tokens.includes(tok)) {
            u.tokens = u.tokens.filter(t => t !== tok);
        }
    });
}

// Auto-cleanup of unpinned notes older than 30 days (1 month)
function cleanExpiredNotes() {
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    if (!db || !db.notes) return;

    Object.keys(db.notes).forEach(parentId => {
        const list = db.notes[parentId];
        if (Array.isArray(list)) {
            const parts = parentId.split('_');
            let dayTime = 0;
            if (parts.length === 3) {
                dayTime = new Date(parseInt(parts[2], 10), parseInt(parts[0], 10), parseInt(parts[1], 10)).getTime();
            }
            const filtered = list.filter(n => {
                if (n.pinned === true) return true; // Pinned notes NEVER expire!
                const noteTime = n.createdAt || dayTime || now;
                return (now - noteTime) < ONE_MONTH_MS;
            });
            if (filtered.length !== list.length) {
                changed = true;
                if (filtered.length === 0) {
                    delete db.notes[parentId];
                } else {
                    db.notes[parentId] = filtered;
                }
            }
        }
    });

    if (changed) saveDB();
}

// Request Helper
function sendJSON(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token, X-User-Name'
    });
    res.end(JSON.stringify(payload));
}

function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve({});
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Token, X-User-Name'
        });
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const rawPathname = parsedUrl.pathname || '/';
    const pathname = rawPathname.replace(/\/+$/, '') || '/';
    const token = req.headers['x-device-token'] || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    const authUser = findUserByToken(token);

    // Static Frontend Serving & PWA Offline Engine
    if (pathname === '/' || pathname === '/index.html' || pathname === '/calendar') {
        const htmlPath = path.join(__dirname, '..', 'client', 'index.html');
        if (fs.existsSync(htmlPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            return fs.createReadStream(htmlPath).pipe(res);
        }
    }

    if (pathname === '/sw.js') {
        const swPath = path.join(__dirname, '..', 'client', 'sw.js');
        if (fs.existsSync(swPath)) {
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Service-Worker-Allowed': '/',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            return fs.createReadStream(swPath).pipe(res);
        }
    }

    if (pathname === '/manifest.json') {
        const manifestPath = path.join(__dirname, '..', 'client', 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            res.writeHead(200, {
                'Content-Type': 'application/manifest+json; charset=utf-8',
                'Cache-Control': 'public, max-age=86400'
            });
            return fs.createReadStream(manifestPath).pipe(res);
        }
    }

    // API Routes
    try {
        // 1. Auth Status / Validate Token
        if (pathname === '/api/auth/status' && req.method === 'GET') {
            const approvedUsers = db.users.filter(u => u.status === 'approved').map(u => ({
                id: u.id,
                username: u.username,
                name: u.name,
                color: u.color,
                avatar: u.avatar || '',
                role: u.role
            }));

            if (!authUser) {
                return sendJSON(res, 200, {
                    authenticated: false,
                    users: approvedUsers,
                    openDoor: isOpenDoorActive(),
                    lastUpdated: db.lastUpdated
                });
            }
            return sendJSON(res, 200, {
                authenticated: true,
                user: {
                    id: authUser.id,
                    username: authUser.username,
                    name: authUser.name,
                    color: authUser.color,
                    avatar: authUser.avatar || '',
                    status: authUser.status,
                    role: authUser.role,
                    hasPassword: !!authUser.password,
                    settings: authUser.settings || {}
                },
                users: approvedUsers,
                openDoor: isOpenDoorActive(),
                lastUpdated: db.lastUpdated
            });
        }

        // 2. Auth Login (Existing Registered User with Password/PIN Verification)
        if (pathname === '/api/auth/login' && req.method === 'POST') {
            const body = await parseBody(req);
            const username = typeof body.username === 'string' ? body.username.trim() : '';
            const password = body.password !== undefined && body.password !== null ? String(body.password).trim() : '';

            if (!username) return sendJSON(res, 400, { error: 'Username is required' });

            let user = findUserByUsername(username);
            if (!user) {
                return sendJSON(res, 404, { error: 'اسم المستخدم غير مسجل في النظام. يرجى إنشاء حساب جديد من تبويب "مستخدم جديد".' });
            }

            // Password / PIN Verification
            if (user.password) {
                if (!password || user.password !== password) {
                    return sendJSON(res, 401, { error: 'رمز الدخول / كلمة المرور غير صحيحة لهذا المستخدم.' });
                }
            } else if (password) {
                // If user didn't have password set, save this as their new password
                user.password = password;
            }

            if (user.status === 'pending') {
                if (isOpenDoorActive()) {
                    user.status = 'approved';
                } else {
                    return sendJSON(res, 200, {
                        status: 'pending',
                        message: 'User is awaiting admin approval',
                        user: { username: user.username, name: user.name, color: user.color, avatar: user.avatar || '' }
                    });
                }
            }

            if (user.status === 'rejected') {
                return sendJSON(res, 403, { error: 'تم رفض طلب الدخول لهذا الحساب من قبل المسؤول.' });
            }

            // Revoke old token from previous user on this device if any
            if (token) {
                revokeTokenFromAllUsers(token);
            }

            // Issue new token
            const newToken = generateToken();
            if (!Array.isArray(user.tokens)) user.tokens = [];
            user.tokens.push(newToken);
            try {
                saveDB(db, true);
            } catch (error) {
                user.tokens = user.tokens.filter(existingToken => existingToken !== newToken);
                throw error;
            }

            return sendJSON(res, 200, {
                status: 'approved',
                token: newToken,
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    color: user.color,
                    avatar: user.avatar || '',
                    role: user.role,
                    status: user.status,
                    hasPassword: !!user.password,
                    settings: user.settings || {}
                },
                lastUpdated: db.lastUpdated
            });
        }

        // 3. Auth Register (New User Creation with PIN/Password and Avatar)
        if (pathname === '/api/auth/register' && req.method === 'POST') {
            const body = await parseBody(req);
            const username = (body.username || '').trim();
            const color = body.color || '#38bdf8';
            const password = body.password !== undefined ? String(body.password).trim() : '';
            const avatar = body.avatar || '';

            if (!username) return sendJSON(res, 400, { error: 'Username is required' });

            let existing = findUserByUsername(username);
            if (existing) {
                return sendJSON(res, 409, { error: 'اسم المستخدم مسجل مسبقاً. يرجى التوجه لتبويب "تسجيل الدخول".' });
            }

            const openDoor = isOpenDoorActive() || (username.toLowerCase() === 'admin');
            const initialStatus = openDoor ? 'approved' : 'pending';

            // Revoke old token from previous user on this device if any
            if (token) {
                revokeTokenFromAllUsers(token);
            }

            const newToken = generateToken();

            const newUser = {
                id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                username: username,
                name: username,
                color: color,
                avatar: avatar,
                password: password,
                status: initialStatus,
                role: (username.toLowerCase() === 'admin') ? 'admin' : 'user',
                tokens: [newToken],
                createdAt: Date.now(),
                settings: body.settings || {}
            };

            db.users.push(newUser);
            saveDB();

            return sendJSON(res, 201, {
                status: initialStatus,
                token: newToken,
                user: {
                    id: newUser.id,
                    username: newUser.username,
                    name: newUser.name,
                    color: newUser.color,
                    avatar: newUser.avatar,
                    role: newUser.role,
                    status: newUser.status,
                    hasPassword: !!newUser.password,
                    settings: newUser.settings
                },
                lastUpdated: db.lastUpdated
            });
        }

        // 3.5. Update User Profile (In-place rename, password change & avatar persistence)
        if (pathname === '/api/auth/profile' && req.method === 'POST') {
            const body = await parseBody(req);
            const newName = (body.name || body.username || '').trim();
            const newColor = body.color || '#38bdf8';

            if (!authUser) {
                return sendJSON(res, 401, { error: 'Authentication required' });
            }

            if (!newName) {
                return sendJSON(res, 400, { error: 'Name cannot be empty' });
            }

            const oldName = authUser.name || authUser.username;

            // If name changed, ensure no other user has taken this name
            if (oldName.toLowerCase() !== newName.toLowerCase()) {
                if (authUser.role === 'admin' || authUser.id === 'user_admin' || authUser.username.toLowerCase() === 'admin') {
                    return sendJSON(res, 400, { error: 'لا يمكن تغيير اسم المستخدم لحساب المسؤول الرئيسي (admin).' });
                }
                const existing = db.users.find(u => u.id !== authUser.id && (
                    (u.username && u.username.toLowerCase() === newName.toLowerCase()) ||
                    (u.name && u.name.toLowerCase() === newName.toLowerCase())
                ));
                if (existing) {
                    return sendJSON(res, 409, { error: 'اسم المستخدم "' + newName + '" مستخدم بالفعل من قبل شخص آخر. يرجى اختيار اسم آخر.' });
                }
            }

            // Update user in DB
            if (authUser.role !== 'admin' && authUser.id !== 'user_admin' && authUser.username.toLowerCase() !== 'admin') {
                authUser.username = newName;
                authUser.name = newName;
            }
            authUser.color = newColor;
            if (body.avatar !== undefined) authUser.avatar = body.avatar;
            if (body.password !== undefined && String(body.password).trim() !== '') {
                authUser.password = String(body.password).trim();
            }
            if (body.settings) authUser.settings = Object.assign({}, authUser.settings || {}, body.settings);

            // Cascade author updates in notes
            if (oldName !== newName && authUser.username === newName) {
                Object.keys(db.notes).forEach(parentId => {
                    const list = db.notes[parentId];
                    if (Array.isArray(list)) {
                        list.forEach(n => {
                            if (n.author && n.author.toLowerCase() === oldName.toLowerCase()) {
                                n.author = newName;
                                n.color = newColor;
                                if (authUser.avatar) n.avatar = authUser.avatar;
                            }
                        });
                    }
                });

                // Cascade author updates in recurring events
                if (Array.isArray(db.recurringEvents)) {
                    db.recurringEvents.forEach(ev => {
                        if (ev.author && ev.author.toLowerCase() === oldName.toLowerCase()) {
                            ev.author = newName;
                            ev.color = newColor;
                            if (authUser.avatar) ev.avatar = authUser.avatar;
                        }
                    });
                }
            } else if (body.avatar !== undefined) {
                // Update avatar in author's notes and recurring events
                Object.keys(db.notes).forEach(parentId => {
                    const list = db.notes[parentId];
                    if (Array.isArray(list)) {
                        list.forEach(n => {
                            if (n.author && n.author.toLowerCase() === authUser.username.toLowerCase()) {
                                n.avatar = authUser.avatar;
                            }
                        });
                    }
                });
                if (Array.isArray(db.recurringEvents)) {
                    db.recurringEvents.forEach(ev => {
                        if (ev.author && ev.author.toLowerCase() === authUser.username.toLowerCase()) {
                            ev.avatar = authUser.avatar;
                        }
                    });
                }
            }

            saveDB();

            return sendJSON(res, 200, {
                success: true,
                user: {
                    id: authUser.id,
                    username: authUser.username,
                    name: authUser.name,
                    color: authUser.color,
                    avatar: authUser.avatar || '',
                    role: authUser.role,
                    status: authUser.status,
                    hasPassword: !!authUser.password,
                    settings: authUser.settings || {}
                },
                lastUpdated: db.lastUpdated
            });
        }

        // 3.6. Auth Logout (Revoke current device token)
        if (pathname === '/api/auth/logout' && req.method === 'POST') {
            if (authUser && token) {
                authUser.tokens = (authUser.tokens || []).filter(t => t !== token);
                saveDB();
            }
            return sendJSON(res, 200, { success: true });
        }

        // 4. Admin Routes
        if (pathname.startsWith('/api/admin/')) {
            const isAdmin = authUser && authUser.role === 'admin';

            if (!isAdmin) {
                return sendJSON(res, 403, { error: 'Admin authorization required' });
            }

            // List Users & Queue
            if (pathname === '/api/admin/users' && req.method === 'GET') {
                return sendJSON(res, 200, {
                    users: db.users.map(u => ({
                        id: u.id,
                        username: u.username,
                        name: u.name,
                        color: u.color,
                        avatar: u.avatar || '',
                        status: u.status,
                        role: u.role,
                        hasPassword: !!u.password,
                        createdAt: u.createdAt,
                        tokenCount: (u.tokens || []).length
                    })),
                    openDoor: db.settings.openDoor
                });
            }

            // Approve / Reject / Delete / Revoke User Tokens
            if (pathname === '/api/admin/approve' && req.method === 'POST') {
                const body = await parseBody(req);
                const { userId, action } = body; // action: 'approve', 'reject', 'delete', 'revoke-tokens'
                const target = db.users.find(u => u.id === userId || u.username.toLowerCase() === (userId || '').toLowerCase());
                if (!target) return sendJSON(res, 404, { error: 'User not found' });

                if (target.role === 'admin' || target.id === 'user_admin' || target.username.toLowerCase() === 'admin') {
                    if (action === 'delete' || action === 'reject') {
                        return sendJSON(res, 400, { error: 'لا يمكن حذف أو رفض حساب المسؤول الرئيسي (admin).' });
                    }
                }

                if (action === 'approve') {
                    target.status = 'approved';
                } else if (action === 'reject') {
                    target.status = 'rejected';
                    target.tokens = [];
                } else if (action === 'revoke-tokens') {
                    target.tokens = [];
                } else if (action === 'delete') {
                    target.tokens = [];
                    db.users = db.users.filter(u => u.id !== target.id);

                    const targetName = (target.username || target.name || '').toLowerCase();
                    db.deletedNotes = db.deletedNotes || {};
                    // Purge notes authored by deleted user & record tombstones for immediate multi-device sync
                    Object.keys(db.notes).forEach(parentId => {
                        db.notes[parentId] = (db.notes[parentId] || []).filter(n => {
                            if ((n.author || '').toLowerCase() === targetName) {
                                db.deletedNotes[n.id] = Date.now();
                                return false;
                            }
                            return true;
                        });
                        if (db.notes[parentId].length === 0) {
                            delete db.notes[parentId];
                        }
                    });

                    // Purge recurring events authored by deleted user
                    if (Array.isArray(db.recurringEvents)) {
                        db.recurringEvents = db.recurringEvents.filter(ev => {
                            return (ev.author || '').toLowerCase() !== targetName;
                        });
                    }
                }
                saveDB();
                return sendJSON(res, 200, { success: true, user: target, users: db.users, deletedNotes: Object.keys(db.deletedNotes || {}) });
            }

            // Edit / Rename / Reassign User (Admin Superpowers)
            if (pathname === '/api/admin/user/update' && req.method === 'POST') {
                const body = await parseBody(req);
                const { userId, newUsername, newColor, newRole, revokeTokens } = body;
                const target = db.users.find(u => u.id === userId || u.username.toLowerCase() === (userId || '').toLowerCase());
                if (!target) return sendJSON(res, 404, { error: 'User not found' });

                const oldName = target.username;
                const updatedName = (newUsername || '').trim();

                // If renaming, ensure uniqueness
                if (updatedName && updatedName.toLowerCase() !== oldName.toLowerCase()) {
                    const existing = db.users.find(u => u.id !== target.id && u.username.toLowerCase() === updatedName.toLowerCase());
                    if (existing) {
                        return sendJSON(res, 409, { error: 'Username already in use by another user' });
                    }
                    target.username = updatedName;
                    target.name = updatedName;

                    // Cascade rename in notes
                    Object.keys(db.notes).forEach(parentId => {
                        const list = db.notes[parentId];
                        if (Array.isArray(list)) {
                            list.forEach(n => {
                                if (n.author && n.author.toLowerCase() === oldName.toLowerCase()) {
                                    n.author = updatedName;
                                    if (newColor) n.color = newColor;
                                }
                            });
                        }
                    });

                    // Cascade rename in recurring events
                    if (Array.isArray(db.recurringEvents)) {
                        db.recurringEvents.forEach(ev => {
                            if (ev.author && ev.author.toLowerCase() === oldName.toLowerCase()) {
                                ev.author = updatedName;
                                if (newColor) ev.color = newColor;
                            }
                        });
                    }
                }

                if (newColor) target.color = newColor;
                if (newRole && (newRole === 'admin' || newRole === 'user')) target.role = newRole;
                if (revokeTokens) target.tokens = [];

                saveDB();
                return sendJSON(res, 200, { success: true, user: target, users: db.users });
            }

            // Open Door Toggle (with time constraints: 1h, 4h, 12h, 1d, 2d, 4d, -1)
            if (pathname === '/api/admin/open-door' && req.method === 'POST') {
                const body = await parseBody(req);
                const { enabled, durationHours, extend } = body;
                if (!enabled) {
                    db.settings.openDoor = { enabled: false, expiresAt: 0, durationHours: 0 };
                } else {
                    let expiresAt = -1;
                    if (durationHours && durationHours > 0) {
                        const baseTime = (extend && db.settings.openDoor && db.settings.openDoor.enabled && db.settings.openDoor.expiresAt > Date.now()) 
                            ? db.settings.openDoor.expiresAt 
                            : Date.now();
                        expiresAt = baseTime + (durationHours * 3600 * 1000);
                    }
                    db.settings.openDoor = {
                        enabled: true,
                        expiresAt: expiresAt,
                        durationHours: durationHours || -1,
                        startedAt: Date.now()
                    };

                    // Auto-approve existing pending users immediately when door is opened!
                    db.users.forEach(u => {
                        if (u.status === 'pending') u.status = 'approved';
                    });
                }
                saveDB();
                return sendJSON(res, 200, { success: true, openDoor: db.settings.openDoor });
            }
            // Manage Special Days / Indicators (Admin)
            if (pathname === '/api/admin/indicators' && req.method === 'POST') {
                const body = await parseBody(req);
                if (Array.isArray(body.indicators)) {
                    db.indicators = body.indicators;
                    db.lastUpdated = Date.now();
                    saveDB();
                }
                return sendJSON(res, 200, {
                    success: true,
                    indicators: db.indicators || [],
                    lastUpdated: db.lastUpdated
                });
            }
        }

        // Public Indicators endpoint
        if (pathname === '/api/indicators') {
            if (req.method === 'GET') {
                return sendJSON(res, 200, {
                    indicators: db.indicators || [],
                    lastUpdated: db.lastUpdated
                });
            }
            if (req.method === 'POST') {
                const isAdmin = authUser && authUser.role === 'admin';
                if (!isAdmin) return sendJSON(res, 403, { error: 'Admin authorization required' });
                const body = await parseBody(req);
                if (Array.isArray(body.indicators)) {
                    db.indicators = body.indicators;
                    db.lastUpdated = Date.now();
                    saveDB();
                }
                return sendJSON(res, 200, {
                    success: true,
                    indicators: db.indicators || [],
                    lastUpdated: db.lastUpdated
                });
            }
        }

        // Helper: Filter notes so private notes are ONLY visible to their author (never to other users or admins)
        function getFilteredNotesForUser(userObj, fallbackUserHeader) {
            cleanExpiredNotes();
            const currentUserName = (userObj ? userObj.username : (fallbackUserHeader || '')).trim().toLowerCase();
            const result = {};
            Object.keys(db.notes || {}).forEach(parentId => {
                const list = db.notes[parentId] || [];
                const visible = list.filter(n => {
                    if (!n) return false;
                    if (n.isPrivate === false) return true;
                    const noteAuthor = (n.author || '').trim().toLowerCase();
                    return noteAuthor && noteAuthor === currentUserName;
                });
                if (visible.length > 0) {
                    result[parentId] = visible;
                }
            });
            return result;
        }

        function getFilteredRecurringEventsForUser(userObj, fallbackUserHeader) {
            const currentUserName = (userObj ? userObj.username : (fallbackUserHeader || '')).trim().toLowerCase();
            return (db.recurringEvents || []).filter(e => {
                if (!e) return false;
                if (e.isPrivate === false) return true;
                const evAuthor = (e.author || '').trim().toLowerCase();
                return evAuthor && evAuthor === currentUserName;
            });
        }

        // 5. Notes Sync & CRUD
        if (pathname === '/api/notes' && req.method === 'GET') {
            return sendJSON(res, 200, {
                notes: getFilteredNotesForUser(authUser, req.headers['x-user-name']),
                deletedNotes: Object.keys(db.deletedNotes || {}),
                lastUpdated: db.lastUpdated
            });
        }

        // 5.1 Dedicated Note Deletion Endpoint (Registers Tombstone to prevent resurrection across devices)
        if ((pathname === '/api/notes/delete' && (req.method === 'POST' || req.method === 'DELETE')) ||
            (pathname.startsWith('/api/notes/delete/') && (req.method === 'POST' || req.method === 'DELETE')) ||
            (pathname === '/api/notes' && req.method === 'DELETE') ||
            (pathname.startsWith('/api/notes/') && pathname !== '/api/notes' && req.method === 'DELETE')) {

            const body = await parseBody(req);
            let noteId = body.noteId || parsedUrl.query.noteId || parsedUrl.query.id;
            let parentId = body.parentId || parsedUrl.query.parentId;

            if (!noteId) {
                const segments = pathname.split('/').filter(Boolean);
                const lastSegment = segments[segments.length - 1];
                if (lastSegment && lastSegment !== 'notes' && lastSegment !== 'delete') {
                    noteId = lastSegment;
                }
            }

            if (!noteId) return sendJSON(res, 400, { error: 'noteId is required' });

            db.deletedNotes = db.deletedNotes || {};
            db.deletedNotes[noteId] = Date.now();

            if (parentId && db.notes[parentId]) {
                db.notes[parentId] = db.notes[parentId].filter(n => n.id !== noteId);
                if (db.notes[parentId].length === 0) {
                    delete db.notes[parentId];
                }
            }
            // Also clean from any parentId in case parentId was omitted or mismatch
            Object.keys(db.notes).forEach(pid => {
                db.notes[pid] = (db.notes[pid] || []).filter(n => n.id !== noteId);
                if (db.notes[pid].length === 0) delete db.notes[pid];
            });

            saveDB();
            return sendJSON(res, 200, {
                success: true,
                deletedNoteId: noteId,
                deletedNotes: Object.keys(db.deletedNotes || {}),
                lastUpdated: db.lastUpdated
            });
        }

        if (pathname === '/api/notes' && req.method === 'POST') {
            const body = await parseBody(req);
            const { parentId, notes } = body;
            if (!parentId) return sendJSON(res, 400, { error: 'parentId is required' });

            db.deletedNotes = db.deletedNotes || {};
            const currentList = db.notes[parentId] || [];
            const incomingList = Array.isArray(notes) ? notes : [];
            const authorName = (authUser ? authUser.username : (body.author || req.headers['x-user-name'] || '')).trim().toLowerCase();
            const isAdmin = authUser && (authUser.role === 'admin' || authUser.username.toLowerCase() === 'admin');

            // Discard any incoming notes that have been registered as deleted
            const cleanIncoming = incomingList.filter(n => n && n.id && !db.deletedNotes[n.id]);

            // Merge & enforce permissions:
            // If admin or owner, update. Other users' notes are preserved unless edited by admin.
            let merged = [];
            if (isAdmin) {
                // If admin sent a modified list for this day, any previous note that was removed is registered as deleted tombstone
                currentList.forEach(oldNote => {
                    if (!cleanIncoming.some(newNote => newNote.id === oldNote.id)) {
                        db.deletedNotes[oldNote.id] = Date.now();
                    }
                });
                merged = cleanIncoming;
            } else {
                // For regular user: if user omitted their own previously saved note, register tombstone
                currentList.forEach(oldNote => {
                    const oldAuthor = (oldNote.author || '').trim().toLowerCase();
                    if (oldAuthor === authorName && !cleanIncoming.some(newNote => newNote.id === oldNote.id)) {
                        db.deletedNotes[oldNote.id] = Date.now();
                    }
                });

                const otherUsersNotes = currentList.filter(n => {
                    if (db.deletedNotes[n.id]) return false;
                    const noteAuthor = (n.author || '').trim().toLowerCase();
                    return noteAuthor && noteAuthor !== authorName;
                });

                const myNewNotes = cleanIncoming.filter(n => {
                    const noteAuthor = (n.author || '').trim().toLowerCase();
                    return !noteAuthor || noteAuthor === authorName;
                });

                merged = otherUsersNotes.concat(myNewNotes);
            }

            if (merged.length > 0) {
                db.notes[parentId] = merged;
            } else {
                delete db.notes[parentId];
            }
            saveDB();

            return sendJSON(res, 200, {
                success: true,
                parentId: parentId,
                notes: db.notes[parentId] || [],
                deletedNotes: Object.keys(db.deletedNotes || {}),
                lastUpdated: db.lastUpdated
            });
        }

        // 6. Recurring Events CRUD
        if (pathname === '/api/recurring-events' && req.method === 'GET') {
            return sendJSON(res, 200, {
                events: getFilteredRecurringEventsForUser(authUser, req.headers['x-user-name']),
                lastUpdated: db.lastUpdated
            });
        }

        if (pathname === '/api/recurring-events' && req.method === 'POST') {
            const body = await parseBody(req);
            const event = body.event;
            if (!event || !event.id) return sendJSON(res, 400, { error: 'Valid event with id is required' });

            const authorName = (authUser ? authUser.username : (event.author || '')).trim().toLowerCase();
            const existingIdx = db.recurringEvents.findIndex(e => e.id === event.id);

            if (existingIdx !== -1) {
                const existingAuthor = (db.recurringEvents[existingIdx].author || '').trim().toLowerCase();
                if (existingAuthor && existingAuthor !== authorName && (!authUser || authUser.role !== 'admin')) {
                    return sendJSON(res, 403, { error: 'You cannot edit another user recurring event' });
                }
                db.recurringEvents[existingIdx] = Object.assign({}, db.recurringEvents[existingIdx], event);
            } else {
                db.recurringEvents.push(event);
            }
            saveDB();

            return sendJSON(res, 200, {
                success: true,
                events: getFilteredRecurringEventsForUser(authUser, req.headers['x-user-name']),
                lastUpdated: db.lastUpdated
            });
        }

        if (pathname.startsWith('/api/recurring-events/') && req.method === 'DELETE') {
            const eventId = pathname.split('/').pop();
            const authorName = (authUser ? authUser.username : (req.headers['x-user-name'] || '')).trim().toLowerCase();

            const existing = db.recurringEvents.find(e => e.id === eventId);
            if (!existing) return sendJSON(res, 404, { error: 'Event not found' });

            const existingAuthor = (existing.author || '').trim().toLowerCase();
            if (existingAuthor && existingAuthor !== authorName && (!authUser || authUser.role !== 'admin')) {
                return sendJSON(res, 403, { error: 'You cannot delete another user recurring event' });
            }

            db.recurringEvents = db.recurringEvents.filter(e => e.id !== eventId);
            saveDB();

            return sendJSON(res, 200, {
                success: true,
                events: getFilteredRecurringEventsForUser(authUser, req.headers['x-user-name']),
                lastUpdated: db.lastUpdated
            });
        }

        if (await needs.handleNeeds(req, res, pathname, db, authUser, parseBody, sendJSON, saveDB)) return;

        // 7. Full Delta Sync
        if (pathname === '/api/sync') {
            if (req.method === 'POST') {
                const body = await parseBody(req);
                if (Array.isArray(body.recurringEvents)) {
                    const authorName = (authUser ? authUser.username : (body.author || req.headers['x-user-name'] || '')).trim().toLowerCase();
                    const isAdmin = authUser && (authUser.role === 'admin' || authUser.username.toLowerCase() === 'admin');

                    if (isAdmin) {
                        db.recurringEvents = body.recurringEvents;
                    } else {
                        const otherUsersEvents = (db.recurringEvents || []).filter(e => {
                            const evAuthor = (e.author || '').trim().toLowerCase();
                            return evAuthor && evAuthor !== authorName;
                        });
                        const myEvents = body.recurringEvents.filter(e => {
                            const evAuthor = (e.author || '').trim().toLowerCase();
                            return !evAuthor || evAuthor === authorName;
                        });
                        db.recurringEvents = otherUsersEvents.concat(myEvents);
                    }
                    saveDB();
                }
            }
            const clientLastUpdated = parseInt(parsedUrl.query.since || '0', 10);
            return sendJSON(res, 200, {
                notes: getFilteredNotesForUser(authUser, req.headers['x-user-name']),
                deletedNotes: Object.keys(db.deletedNotes || {}),
                recurringEvents: getFilteredRecurringEventsForUser(authUser, req.headers['x-user-name']),
                indicators: db.indicators || [],
                needs: needs.snapshot(db, authUser),
                authenticated: !!authUser,
                user: authUser ? { id: authUser.id, username: authUser.username, name: authUser.name, role: authUser.role, color: authUser.color, avatar: authUser.avatar || '' } : null,
                openDoor: isOpenDoorActive(),
                serverTime: Date.now(),
                lastUpdated: db.lastUpdated,
                upToDate: clientLastUpdated >= db.lastUpdated
            });
        }

        // 404
        return sendJSON(res, 404, { error: 'Route not found' });

    } catch (err) {
        console.error('Server error:', req.method, pathname, err);
        return sendJSON(res, 500, { error: 'Internal Server Error' });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Continuous Calendar Server is running on http://127.0.0.1:${server.address().port}`);
});
