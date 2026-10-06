'use strict';
const crypto = require('crypto');

function initializeNeeds(db) {
    if (!Array.isArray(db.needsCategories)) db.needsCategories = [
        { id: 'essential', name: 'ضروري', nameEn: 'Essential', version: 1 },
        { id: 'groceries', name: 'بقالة', nameEn: 'Supermarket', version: 1 }
    ];
    if (!Array.isArray(db.needsItems)) db.needsItems = [];
    if (!Number.isInteger(db.needsRevision)) db.needsRevision = 0;
}
function snapshot(db, user) {
    initializeNeeds(db);
    return {
        categories: db.needsCategories,
        items: db.needsItems.filter(item => item && typeof item === 'object').map(item => {
            const users = Array.isArray(db.users) ? db.users : [];
            const author = users.find(u => u && u.id === item.createdBy);
            return Object.assign({}, item, { author: author ? author.name || author.username : item.author });
        }),
        viewer: user ? { id: user.id, role: user.role } : null,
        revision: db.needsRevision,
        serverTime: Date.now()
    };
}
function validDate(value) {
    if (value === '' || value === null) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '9999-12-31';
}
function shortText(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }

// Every mutation is authorized and version checked on the server, not just in the UI.
async function handleNeeds(req, res, pathname, db, user, parseBody, sendJSON, save) {
    if (pathname !== '/api/needs' && !pathname.startsWith('/api/needs/')) return false;
    initializeNeeds(db);
    const reply = (status, body) => { sendJSON(res, status, body); return true; };
    if (pathname === '/api/needs' && req.method === 'GET') return reply(200, { needs: snapshot(db, user) });
    if (!user || user.status !== 'approved') return reply(401, { error: 'سجّل الدخول لإدارة الاحتياجات. / Sign in to update needs.' });
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    const body = await parseBody(req);
    const admin = user.role === 'admin';
    // Work on copies, so persistence failure cannot leave an unacknowledged mutation in memory.
    let categories = db.needsCategories.filter(c => c && typeof c === 'object').map(c => Object.assign({}, c));
    let items = db.needsItems.filter(i => i && typeof i === 'object').map(i => Object.assign({}, i));
    const now = Date.now();
    if (pathname === '/api/needs/categories') {
        if (!admin) return reply(403, { error: 'إدارة الأقسام للمسؤول فقط. / Only admins manage categories.' });
        const existing = categories.find(c => c.id === body.id);
        if (body.action !== 'add' && !existing) return reply(404, { error: 'القسم غير موجود. / Category not found.' });
        if (existing && body.version !== existing.version) return reply(409, { error: 'تغيّر القسم على جهاز آخر. حدّث وحاول مجدداً. / Category changed; refresh and retry.' });
        if (body.action === 'delete') {
            if (items.some(i => i.categoryId === existing.id)) return reply(409, { error: 'انقل عناصر القسم أو احذفها أولاً، بما فيها المكتملة. / Move or remove all items, including completed ones, first.' });
            categories = categories.filter(c => c.id !== existing.id);
        } else if (body.action === 'add' || body.action === 'edit') {
            if (!shortText(body.name, 60) || (body.nameEn && !shortText(body.nameEn, 60))) return reply(400, { error: 'اسم القسم مطلوب (حتى ٦٠ حرفاً). / Category name required (up to 60 characters).' });
            if (categories.some(c => c.id !== body.id && c.name.toLowerCase() === body.name.trim().toLowerCase())) return reply(409, { error: 'اسم القسم موجود بالفعل. / Category name already exists.' });
            if (existing) Object.assign(existing, { name: body.name.trim(), nameEn: (body.nameEn || '').trim(), version: existing.version + 1 });
            else categories.push({ id: 'cat_' + crypto.randomBytes(12).toString('hex'), name: body.name.trim(), nameEn: (body.nameEn || '').trim(), version: 1 });
        } else return reply(400, { error: 'Invalid action' });
    } else if (pathname === '/api/needs/items') {
        const existing = items.find(i => i.id === body.id);
        if (body.action !== 'add' && !existing) return reply(404, { error: 'العنصر غير موجود. / Item not found.' });
        if (existing && body.version !== existing.version) return reply(409, { error: 'تغيّر العنصر على جهاز آخر. حدّث وحاول مجدداً. / Item changed on another device; refresh and retry.' });
        if (existing && body.action !== 'complete' && !admin && existing.createdBy !== user.id) return reply(403, { error: 'التعديل لصاحب العنصر أو المسؤول. / Only the author or admin can edit this item.' });
        if (body.action === 'delete') items = items.filter(i => i.id !== existing.id);
        else if (body.action === 'complete') {
            if (typeof body.completed !== 'boolean') return reply(400, { error: 'completed must be a boolean' });
            Object.assign(existing, { completedAt: body.completed ? now : null, completedBy: body.completed ? user.id : null, updatedAt: now, version: existing.version + 1 });
        } else if (body.action === 'add' || body.action === 'edit') {
            if (!shortText(body.title, 240)) return reply(400, { error: 'اكتب العنصر (حتى ٢٤٠ حرفاً). / Enter an item (up to 240 characters).' });
            if (!categories.some(c => c.id === body.categoryId)) return reply(400, { error: 'اختر قسماً موجوداً. / Choose an existing category.' });
            if (!validDate(body.deadline)) return reply(400, { error: 'موعد غير صالح. استخدم YYYY-MM-DD أو اتركه فارغاً. / Invalid deadline; use YYYY-MM-DD or leave blank.' });
            if (existing) Object.assign(existing, { title: body.title.trim(), categoryId: body.categoryId, deadline: body.deadline || null, updatedAt: now, version: existing.version + 1 });
            else items.push({ id: 'need_' + crypto.randomBytes(12).toString('hex'), title: body.title.trim(), categoryId: body.categoryId, deadline: body.deadline || null, createdBy: user.id, author: user.name || user.username, createdAt: now, updatedAt: now, completedAt: null, completedBy: null, version: 1 });
        } else return reply(400, { error: 'Invalid action' });
    } else return reply(404, { error: 'Route not found' });
    const previous = { categories: db.needsCategories, items: db.needsItems, revision: db.needsRevision };
    db.needsCategories = categories; db.needsItems = items; db.needsRevision++;
    try { save(db, true); }
    catch (error) { db.needsCategories = previous.categories; db.needsItems = previous.items; db.needsRevision = previous.revision; throw error; }
    return reply(200, { success: true, needs: snapshot(db, user) });
}
module.exports = { initializeNeeds, snapshot, handleNeeds };
