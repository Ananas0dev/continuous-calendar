const fs = require('fs');
const path = require('path');

const root = __dirname;
const source = path.join(root, 'index.html');
const output = path.join(root, 'continuous-calendar-local.html');
let html = fs.readFileSync(source, 'utf8');

// The standalone file keeps its calendar core local. Optional Excel/PDF import
// libraries and the server install manifest are specific to hosted installs.
html = html.replace(/\s*<link rel="manifest" href="\/manifest\.json">/, '');
html = html.replace(/\s*<!-- SheetJS \(xlsx\) for Excel\/ODS parsing -->[\s\S]*?(?=<!-- needs styles start -->)/, '\n    <!-- Local mode supports CSV, ICS, images, and pasted text without external libraries. -->\n');

const localStyles = `
<style id="local-calendar-mode-styles">
  #user-profile-pill, #side-admin-btn,
  #auth-onboarding-modal, #admin-panel-modal, #admin-edit-user-modal,
  #auth-pending-modal, #auth-user-edit-modal,
  #side-dock button[onclick="logoutCurrentUser()"] { display: none !important; }
  #sync-status-badge { cursor: default; }
</style>
<script>
  window.CALENDAR_STANDALONE = true;
  try { if (!localStorage.calendarLang) localStorage.calendarLang = 'en'; } catch (e) {}
</script>`;

const localRuntime = String.raw`
        (function () {
            var deviceUser = { id: 'local-device', username: 'this-device', name: 'This device', role: 'admin', color: '#38bdf8', avatar: '' };
            var initialCategories = [
                { id: 'essential', name: 'Essentials', nameEn: 'Essentials', version: 1 },
                { id: 'groceries', name: 'Groceries', nameEn: 'Groceries', version: 1 }
            ];
            function readJSON(key, fallback) {
                try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
                catch (e) { return fallback; }
            }
            function makeId(prefix) {
                var random = window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
                return prefix + '_' + random;
            }
            function getNeeds() {
                var saved = readJSON('calendarNeeds', null);
                return saved && Array.isArray(saved.categories) && Array.isArray(saved.items)
                    ? saved : { categories: initialCategories.map(function (c) { return Object.assign({}, c); }), items: [], revision: 0 };
            }
            function saveNeeds(needs) {
                try { localStorage.setItem('calendarNeeds', JSON.stringify({ categories: needs.categories, items: needs.items, revision: needs.revision || 0, viewer: null })); } catch (e) {}
                needs.viewer = { id: deviceUser.id, role: 'admin' };
                needs.serverTime = Date.now();
                return needs;
            }
            function readNotes() {
                var notes = {};
                for (var i = 0; i < localStorage.length; i++) {
                    var key = localStorage.key(i);
                    if (key && key.indexOf('notes_') === 0) {
                        var list = readJSON(key, []);
                        if (Array.isArray(list) && list.length) notes[key.slice(6)] = list;
                    }
                }
                return notes;
            }
            function localRequest(endpoint, options) {
                options = options || {};
                var method = (options.method || 'GET').toUpperCase();
                var path = endpoint.split('?')[0];
                var body = options.body || {};
                if (path === '/api/auth/status' || path === '/api/auth/profile') {
                    return Promise.resolve({ authenticated: true, user: deviceUser, users: [] });
                }
                if (path === '/api/auth/logout') return Promise.resolve({ success: true });
                if (path === '/api/sync') {
                    if (method === 'POST' && Array.isArray(body.recurringEvents)) {
                        try { localStorage.setItem('calendarRecurringEvents', JSON.stringify(body.recurringEvents)); } catch (e) {}
                    }
                    var payload = {
                        notes: readNotes(), recurringEvents: readJSON('calendarRecurringEvents', []),
                        needs: saveNeeds(getNeeds()), authenticated: true, user: deviceUser,
                        deletedNotes: [], lastUpdated: Date.now(), serverTime: Date.now()
                    };
                    var indicators = readJSON('calendarIndicators', null);
                    if (Array.isArray(indicators) && indicators.length) payload.indicators = indicators;
                    return Promise.resolve(payload);
                }
                if (path === '/api/notes' && method === 'POST') {
                    try { localStorage.setItem('notes_' + body.parentId, JSON.stringify(Array.isArray(body.notes) ? body.notes : [])); } catch (e) {}
                    return Promise.resolve({ success: true, parentId: body.parentId, notes: body.notes || [] });
                }
                if (path.indexOf('/api/notes/delete') === 0) {
                    var oldList = readJSON('notes_' + body.parentId, []);
                    oldList = oldList.filter(function (note) { return note.id !== body.noteId; });
                    try { if (oldList.length) localStorage.setItem('notes_' + body.parentId, JSON.stringify(oldList)); else localStorage.removeItem('notes_' + body.parentId); } catch (e) {}
                    return Promise.resolve({ success: true, deletedNoteId: body.noteId });
                }
                if (path === '/api/indicators' && method === 'GET') {
                    var localIndicators = readJSON('calendarIndicators', null);
                    return Promise.resolve(localIndicators ? { indicators: localIndicators } : {});
                }
                if (path === '/api/indicators' && method === 'POST') {
                    try { localStorage.setItem('calendarIndicators', JSON.stringify(body.indicators || [])); } catch (e) {}
                    return Promise.resolve({ success: true, indicators: body.indicators || [] });
                }
                if (path === '/api/needs' && method === 'GET') return Promise.resolve({ needs: saveNeeds(getNeeds()) });
                if (path === '/api/needs/categories' || path === '/api/needs/items') {
                    var needs = getNeeds();
                    if (path.endsWith('/categories')) {
                        var category = needs.categories.find(function (item) { return item.id === body.id; });
                        if (body.action === 'add') needs.categories.push({ id: makeId('category'), name: body.name, nameEn: body.nameEn || '', version: 1 });
                        else if (body.action === 'edit' && category) Object.assign(category, { name: body.name, nameEn: body.nameEn || '', version: category.version + 1 });
                        else if (body.action === 'delete' && category) needs.categories = needs.categories.filter(function (item) { return item.id !== category.id; });
                    } else {
                        var item = needs.items.find(function (entry) { return entry.id === body.id; });
                        if (body.action === 'add') needs.items.push({ id: makeId('need'), title: body.title, categoryId: body.categoryId, deadline: body.deadline || null, createdBy: deviceUser.id, author: deviceUser.name, createdAt: Date.now(), updatedAt: Date.now(), completedAt: null, completedBy: null, version: 1 });
                        else if (body.action === 'edit' && item) Object.assign(item, { title: body.title, categoryId: body.categoryId, deadline: body.deadline || null, updatedAt: Date.now(), version: item.version + 1 });
                        else if (body.action === 'complete' && item) Object.assign(item, { completedAt: body.completed ? Date.now() : null, completedBy: body.completed ? deviceUser.id : null, updatedAt: Date.now(), version: item.version + 1 });
                        else if (body.action === 'delete' && item) needs.items = needs.items.filter(function (entry) { return entry.id !== item.id; });
                    }
                    needs.revision = (needs.revision || 0) + 1;
                    return Promise.resolve({ success: true, needs: saveNeeds(needs) });
                }
                return Promise.resolve({});
            }

            CalendarAPI.getToken = function () { return 'local-device'; };
            CalendarAPI.setToken = function () {};
            CalendarAPI.clearToken = function () {};
            CalendarAPI.request = function (endpoint, options) { return localRequest(endpoint, options); };
            CalendarAPI.markOnline = function () { isServerOnline = true; updateSyncStatusPill(); };
            CalendarAPI.markOffline = function () { isServerOnline = false; updateSyncStatusPill(); };
            updateSyncStatusPill = function () {
                var pill = document.getElementById('sync-status-badge');
                var text = document.getElementById('sync-status-text');
                if (pill) { pill.className = 'sync-status-pill'; pill.title = currentLang === 'ar' ? 'تُحفظ البيانات في هذا المتصفح فقط' : 'Saved in this browser only'; }
                if (text) text.textContent = currentLang === 'ar' ? 'محفوظ على هذا الجهاز' : 'Saved on this device';
                var localBadge = document.getElementById('account-shortcut');
                if (localBadge) {
                    localBadge.removeAttribute('onclick');
                    localBadge.disabled = true;
                    localBadge.style.cursor = 'default';
                    localBadge.style.pointerEvents = 'none';
                    localBadge.title = currentLang === 'ar' ? 'تُحفظ البيانات في هذا المتصفح فقط' : 'Saved on this device only';
                    localBadge.textContent = currentLang === 'ar' ? '💾 على هذا الجهاز' : '💾 On this device';
                }
            };
            triggerManualSync = function () {
                if (window.__calendarLocalHydrated) { updateSyncStatusPill(); return Promise.resolve(); }
                window.__calendarLocalHydrated = true;
                return CalendarAPI.request('/api/sync').then(function (data) { applyServerSyncData(data); }).catch(function () { updateSyncStatusPill(); });
            };
            document.addEventListener('DOMContentLoaded', function () {
                if (window.Needs) {
                    var applyNeedsLanguage = Needs.applyLanguage;
                    Needs.applyLanguage = function () {
                        applyNeedsLanguage();
                        var english = currentLang === 'en';
                        var description = document.getElementById('needs-description');
                        if (description) description.textContent = english ? 'Saved on this device · Deadlines appear on the calendar' : 'محفوظ على هذا الجهاز · تظهر المواعيد في التقويم';
                        var save = document.getElementById('needs-save');
                        if (save) save.textContent = english ? 'Save on this device' : 'حفظ على هذا الجهاز';
                    };
                    Needs.receive(saveNeeds(getNeeds()));
                    Needs.applyLanguage();
                }
            });
        })();
`;

if (!html.includes('id="local-calendar-mode-styles"')) html = html.replace('</head>', `${localStyles}\n</head>`);
const bundleMarker = '<script type="application/x-calendar-space"';
const bundlePosition = html.indexOf(bundleMarker);
const closingScriptPosition = bundlePosition >= 0 ? html.lastIndexOf('</script>', bundlePosition) : -1;
if (closingScriptPosition < 0) throw new Error('Could not find the calendar runtime insertion point.');
html = html.slice(0, closingScriptPosition) + localRuntime + '\n    ' + html.slice(closingScriptPosition);
fs.writeFileSync(output, html, 'utf8');
console.log(`Built ${path.basename(output)} (${fs.statSync(output).size} bytes)`);
