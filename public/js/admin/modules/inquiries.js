/**
 * public/js/admin/modules/inquiries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin Inquiry Management Dashboard Module
 * - Analytics summary cards
 * - Daily chart (Chart.js)
 * - Top IPs with block action
 * - Filterable / searchable paginated table with Trust Score column
 * - Detail drawer with full OSINT panel
 * - Approve / Flag / Delete actions
 * - Bulk OSINT scan (SSE streaming)
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
const InquiryDashboard = {
    currentPage: 1,
    limit: 20,
    filters: { status: 'ALL', search: '', dateFrom: '', dateTo: '', sort: 'newest' },
    drawerInquiryId: null,
    charts: {},
    bulkRunning: false
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleString('en-PH', {
        month: 'short', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
function escHtml(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadge(status) {
    const map = {
        approved:   ['approved',   '✓ Approved'],
        flagged:    ['flagged',    '⚑ Flagged'],
        duplicate:  ['duplicate',  '⧉ Duplicate'],
        suspicious: ['suspicious', '⚠ Suspicious']
    };
    const [cls, label] = map[status] || ['approved', status];
    return `<span class="inq-badge ${cls}">${label}</span>`;
}

function aiBadge(result, confidence) {
    if (!result) return '<span class="text-muted" style="font-size:0.75rem">—</span>';
    const cls = result === 'REAL' ? 'real' : 'spam';
    return `<span class="ai-badge ${cls}">${result} ${confidence != null ? `<span style="opacity:0.75">${confidence}%</span>` : ''}</span>`;
}

function trustBadge(trustScore, trustLevel, recommendation, hasOsint) {
    if (!hasOsint || trustScore == null) {
        return `<span class="trust-badge-none" title="No OSINT scan yet">—</span>`;
    }
    const score = parseInt(trustScore) || 0;
    const level = trustLevel || (score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW');
    const rec   = recommendation || (level === 'HIGH' ? 'SAFE' : level === 'MEDIUM' ? 'VERIFY' : 'AVOID');
    const cls   = level === 'HIGH' ? 'trust-badge-high' : level === 'MEDIUM' ? 'trust-badge-medium' : 'trust-badge-low';
    const icon  = level === 'HIGH' ? '🟢' : level === 'MEDIUM' ? '🟡' : '🔴';
    return `<span class="${cls}" title="${rec} — Trust Score: ${score}/100">${icon} ${score}</span>`;
}

// ─── Load Analytics ───────────────────────────────────────────────────────────
async function loadInquiryAnalytics() {
    try {
        const res  = await fetch('/api/admin/inquiries/analytics', { credentials: 'include' });
        if (!res.ok) throw new Error('Analytics fetch failed');
        const data = await res.json();
        const s    = data.summary || {};

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val ?? 0;
        };
        setText('inq-total',      s.total);
        setText('inq-approved',   s.approved);
        setText('inq-flagged',    s.flagged);
        setText('inq-duplicate',  s.duplicate);
        setText('inq-suspicious', s.suspicious);
        setText('inq-blocked',    data.blockedIps);

        renderDailyChart(data.daily || []);
        renderRatioChart(s.ai_real || 0, s.ai_spam || 0);
        renderTopIps(data.topIps || []);

    } catch (err) {
        console.error('[InquiryAdmin] Analytics error:', err);
    }
}

function renderDailyChart(daily) {
    const ctx = document.getElementById('inq-daily-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    if (InquiryDashboard.charts.daily) {
        InquiryDashboard.charts.daily.destroy();
    }

    const labels = daily.map(d => {
        const dt = new Date(d.day);
        return `${dt.getMonth()+1}/${dt.getDate()}`;
    });

    InquiryDashboard.charts.daily = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Total',
                    data: daily.map(d => d.total),
                    borderColor: '#c5a059',
                    backgroundColor: 'rgba(197,160,89,0.08)',
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#c5a059',
                    pointRadius: 4
                },
                {
                    label: 'Real',
                    data: daily.map(d => d.real_count),
                    borderColor: '#27ae60',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 3
                },
                {
                    label: 'Spam',
                    data: daily.map(d => d.spam_count),
                    borderColor: '#e74c3c',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 } } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 } } },
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Inter', size: 10 } } }
            }
        }
    });
}

function renderRatioChart(real, spam) {
    const ctx = document.getElementById('inq-ratio-chart');
    if (!ctx || typeof Chart === 'undefined') return;

    if (InquiryDashboard.charts.ratio) {
        InquiryDashboard.charts.ratio.destroy();
    }

    InquiryDashboard.charts.ratio = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Real', 'Spam'],
            datasets: [{
                data: [real || 0, spam || 0],
                backgroundColor: ['#27ae60', '#e74c3c'],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 } } }
            }
        }
    });
}

function renderTopIps(ips) {
    const tbody = document.getElementById('inq-top-ips-tbody');
    if (!tbody) return;

    if (!ips.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No IP data yet.</td></tr>';
        return;
    }

    tbody.innerHTML = ips.map(ip => `
        <tr>
            <td><code style="font-size:0.82rem">${escHtml(ip.ip_address)}</code></td>
            <td class="text-center"><strong>${ip.cnt}</strong></td>
            <td class="text-center">
                ${ip.bad_count > 0
                    ? `<span class="badge bg-danger">${ip.bad_count} bad</span>`
                    : '<span class="text-muted">—</span>'}
            </td>
            <td style="font-size:0.78rem;color:#888">${fmtDate(ip.last_seen)}</td>
            <td>
                <button class="btn btn-sm btn-outline-danger" style="font-size:0.74rem"
                    onclick="blockIpFromAdmin('${escHtml(ip.ip_address)}')">
                    <i class="fas fa-ban me-1"></i>Block
                </button>
            </td>
        </tr>
    `).join('');
}

// ─── Load Inquiries Table ─────────────────────────────────────────────────────
async function loadInquiries(page = 1) {
    InquiryDashboard.currentPage = page;

    const tbody = document.getElementById('inq-tbody');
    if (!tbody) return;

    tbody.innerHTML = Array(5).fill(0).map(() => `
        <tr style="opacity:0.5">
            ${Array(9).fill('<td><div style="height:12px;background:#f0e8d8;border-radius:4px;animation:pulse 1.2s infinite"></div></td>').join('')}
        </tr>`).join('');

    const f = InquiryDashboard.filters;
    const params = new URLSearchParams({
        page, limit: InquiryDashboard.limit,
        status: f.status, search: f.search,
        dateFrom: f.dateFrom, dateTo: f.dateTo,
        sort: f.sort
    });

    try {
        const res  = await fetch(`/api/admin/inquiries?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load inquiries');
        const json = await res.json();

        renderInquiryTable(json.data || []);
        renderInquiryPagination(json.total || 0, json.page, json.limit);
    } catch (err) {
        console.error('[InquiryAdmin] Table error:', err);
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">
            <i class="fas fa-exclamation-triangle me-2"></i>${err.message}</td></tr>`;
    }
}

function renderInquiryTable(rows) {
    const tbody = document.getElementById('inq-tbody');
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5" style="color:#888">
            <i class="fas fa-inbox fa-2x mb-3 d-block" style="color:#ddd"></i>
            No inquiries match your filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => `
        <tr onclick="openInquiryDetail(${r.id})" style="cursor:pointer">
            <td>
                <div style="font-weight:600;color:#1a1a1a">${escHtml(r.first_name)} ${escHtml(r.last_name)}</div>
                <div style="font-size:0.75rem;color:#888">${escHtml(r.email)}</div>
            </td>
            <td style="font-size:0.8rem">${escHtml(r.phone)}</td>
            <td style="font-size:0.8rem;color:#666">${escHtml(r.preferred_unit) || '<span class="text-muted">—</span>'}</td>
            <td><div class="inq-msg-preview" title="${escHtml(r.message)}">${escHtml(r.message) || '<em class="text-muted">No message</em>'}</div></td>
            <td>${statusBadge(r.status)}</td>
            <td>${aiBadge(r.ai_result, r.ai_confidence)}</td>
            <td>${trustBadge(r.trust_score, r.trust_level, r.recommendation, r.has_osint)}</td>
            <td style="font-size:0.75rem;color:#888;white-space:nowrap">${fmtDate(r.created_at)}</td>
            <td onclick="event.stopPropagation()">
                <div class="inq-actions d-flex gap-1 flex-wrap">
                    ${r.status !== 'approved'
                        ? `<button class="btn btn-sm btn-outline-success" onclick="updateInquiryStatus(${r.id},'approved')">
                               <i class="fas fa-check"></i>
                           </button>`
                        : ''}
                    ${r.status !== 'flagged'
                        ? `<button class="btn btn-sm btn-outline-danger" onclick="updateInquiryStatus(${r.id},'flagged')">
                               <i class="fas fa-flag"></i>
                           </button>`
                        : ''}
                    <button class="btn btn-sm btn-outline-secondary" onclick="deleteInquiry(${r.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderInquiryPagination(total, page, limit) {
    const container = document.getElementById('inq-pagination');
    if (!container) return;

    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button class="inq-page-btn" onclick="loadInquiries(${page-1})" ${page<=1?'disabled':''}>
                    <i class="fas fa-chevron-left"></i></button>`;
    for (let p = Math.max(1, page-2); p <= Math.min(totalPages, page+2); p++) {
        html += `<button class="inq-page-btn ${p===page?'active':''}" onclick="loadInquiries(${p})">${p}</button>`;
    }
    html += `<button class="inq-page-btn" onclick="loadInquiries(${page+1})" ${page>=totalPages?'disabled':''}>
                 <i class="fas fa-chevron-right"></i></button>
             <span style="color:#999;font-size:0.8rem;margin-left:8px">
                 Page ${page} of ${totalPages} (${total} inquiries)
             </span>`;
    container.innerHTML = html;
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function applyInquiryFilters() {
    InquiryDashboard.filters.status   = document.getElementById('inq-filter-status')?.value || 'ALL';
    InquiryDashboard.filters.search   = document.getElementById('inq-search')?.value || '';
    InquiryDashboard.filters.dateFrom = document.getElementById('inq-filter-from')?.value || '';
    InquiryDashboard.filters.dateTo   = document.getElementById('inq-filter-to')?.value || '';
    InquiryDashboard.filters.sort     = document.getElementById('inq-filter-sort')?.value || 'newest';
    loadInquiries(1);
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function updateInquiryStatus(id, status) {
    try {
        const res = await fetch(`/api/admin/inquiries/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            showInquiryToast(data.message, 'success');
            loadInquiries(InquiryDashboard.currentPage);
            loadInquiryAnalytics();
        } else {
            showInquiryToast(data.error || 'Failed to update', 'danger');
        }
    } catch (err) {
        showInquiryToast('Network error', 'danger');
    }
}

async function deleteInquiry(id) {
    if (!confirm(`Delete inquiry #${id}? This cannot be undone.`)) return;
    try {
        const res  = await fetch(`/api/admin/inquiries/${id}`, { method: 'DELETE', credentials: 'include' });
        const data = await res.json();
        if (res.ok) {
            showInquiryToast(data.message, 'success');
            closeInquiryDrawer();
            loadInquiries(InquiryDashboard.currentPage);
            loadInquiryAnalytics();
        } else {
            showInquiryToast(data.error || 'Delete failed', 'danger');
        }
    } catch (err) {
        showInquiryToast('Network error', 'danger');
    }
}

async function blockIpFromAdmin(ip) {
    if (!confirm(`Block IP address ${ip}? All future submissions from this IP will be silently rejected.`)) return;
    try {
        const res  = await fetch('/api/admin/inquiries/block-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip_address: ip, reason: 'Blocked by admin from dashboard' }),
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            showInquiryToast(data.message, 'success');
            loadInquiryAnalytics();
        } else {
            showInquiryToast(data.error || 'Failed to block', 'danger');
        }
    } catch (err) {
        showInquiryToast('Network error', 'danger');
    }
}

// ─── Bulk OSINT Scan ──────────────────────────────────────────────────────────

async function checkOsintMissing() {
    const label = document.getElementById('inq-missing-label');
    const btn   = document.getElementById('inq-bulk-btn');
    if (!label) return;

    try {
        const res  = await fetch('/api/admin/inquiries/osint-missing', { credentials: 'include' });
        const data = await res.json();
        const count = data.count || 0;

        if (count === 0) {
            label.innerHTML = '<i class="fas fa-check-circle me-1" style="color:#27ae60"></i>All inquiries have been scanned ✓';
            if (btn) btn.style.display = 'none';
        } else {
            label.innerHTML = `<strong style="color:#c5a059">${count}</strong> inquiries still need a background check`;
            if (btn) {
                btn.style.display = 'inline-flex';
                btn.textContent = '';
                btn.innerHTML = `<i class="fas fa-robot me-1"></i>Scan All ${count} Missing`;
            }
        }
    } catch (err) {
        label.textContent = 'Could not check OSINT status.';
    }
}

async function runBulkOsint() {
    if (InquiryDashboard.bulkRunning) return;
    InquiryDashboard.bulkRunning = true;

    const btn      = document.getElementById('inq-bulk-btn');
    const progress = document.getElementById('inq-bulk-progress');
    const counter  = document.getElementById('inq-bulk-counter');
    const fill     = document.getElementById('inq-bulk-fill');
    const log      = document.getElementById('inq-bulk-log');

    if (btn)      { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin me-1"></i>Scanning…'; }
    if (progress) progress.style.display = 'block';
    if (log)      log.innerHTML = '';

    const addLog = (html) => {
        if (!log) return;
        const el = document.createElement('div');
        el.className = 'inq-bulk-log-item';
        el.innerHTML = html;
        log.insertBefore(el, log.firstChild);
    };

    try {
        const response = await fetch('/api/admin/inquiries/osint-bulk', {
            method: 'POST', credentials: 'include'
        });

        // Handle SSE stream
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';
        let   total   = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // Keep incomplete chunk

            for (const line of lines) {
                const dataLine = line.replace(/^data: /, '').trim();
                if (!dataLine) continue;
                try {
                    const evt = JSON.parse(dataLine);

                    if (evt.type === 'start') {
                        total = evt.total;
                        if (counter) counter.textContent = `0 / ${total}`;
                    } else if (evt.type === 'progress') {
                        if (counter) counter.textContent = `${evt.current} / ${total}`;
                        if (fill)    fill.style.width = `${Math.round((evt.current / total) * 100)}%`;
                        addLog(`<span style="color:#888">🔍 Scanning <strong>${escHtml(evt.name)}</strong>…</span>`);
                    } else if (evt.type === 'done') {
                        const icon  = evt.trustLevel === 'HIGH' ? '🟢' : evt.trustLevel === 'MEDIUM' ? '🟡' : '🔴';
                        const badge = evt.recommendation || evt.trustLevel;
                        addLog(`<span>${icon} <strong>${escHtml(evt.name)}</strong> — Score: <strong>${evt.trustScore}</strong> / 100 · <em>${badge}</em>${evt.statusChanged ? ' <span style="color:#e74c3c;font-size:0.75rem">[Auto-flagged]</span>' : ''}</span>`);
                    } else if (evt.type === 'error') {
                        addLog(`<span style="color:#c0392b">⚠ Inquiry #${evt.id} failed: ${escHtml(evt.message)}</span>`);
                    } else if (evt.type === 'complete') {
                        if (fill)    fill.style.width = '100%';
                        if (counter) counter.textContent = `${evt.processed} / ${evt.total} complete`;
                        addLog(`<span style="color:#27ae60;font-weight:600">✅ Bulk scan complete — ${evt.processed} scanned, ${evt.failed} failed</span>`);

                        // Refresh table and missing count
                        loadInquiries(InquiryDashboard.currentPage);
                        checkOsintMissing();
                    }
                } catch (_) {}
            }
        }
    } catch (err) {
        addLog(`<span style="color:#c0392b">❌ Bulk scan error: ${escHtml(err.message)}</span>`);
        showInquiryToast('Bulk scan failed: ' + err.message, 'danger');
    } finally {
        InquiryDashboard.bulkRunning = false;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot me-1"></i>Scan All Missing'; }
    }
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────
async function openInquiryDetail(id) {
    InquiryDashboard.drawerInquiryId = id;
    const drawer  = document.getElementById('inq-drawer');
    const overlay = document.getElementById('inq-drawer-overlay');
    const body    = document.getElementById('inq-drawer-body');
    if (!drawer) return;

    drawer.classList.add('open');
    overlay.classList.add('show');
    body.innerHTML = `<div class="text-center py-5">
        <div class="spinner-border text-warning" style="width:2rem;height:2rem"></div>
        <p class="mt-3 text-muted" style="font-size:0.85rem">Loading details…</p>
    </div>`;

    try {
        const res = await fetch(`/api/admin/inquiries/${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.json().catch(()=>({})))?.error || 'Failed'}`);
        const record = await res.json();

        body.innerHTML = buildInquiryDrawerContent(record);

        // Auto OSINT: run immediately if no cached result exists
        if (!record.osint_result) {
            triggerOsintCheck(record.id);
        }
    } catch (err) {
        body.innerHTML = `<div class="alert alert-danger m-3">${err.message}</div>`;
    }
}


function closeInquiryDrawer() {
    document.getElementById('inq-drawer')?.classList.remove('open');
    document.getElementById('inq-drawer-overlay')?.classList.remove('show');
    InquiryDashboard.drawerInquiryId = null;
}

function buildInquiryDrawerContent(r) {
    const statusColors = {
        approved: '#27ae60', flagged: '#e74c3c',
        duplicate: '#3498db', suspicious: '#f39c12'
    };
    const color = statusColors[r.status] || '#888';

    return `
    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-user me-2"></i>Contact Information</div>
        ${dr('Name',  `${escHtml(r.first_name)} ${escHtml(r.last_name)}`)  }
        ${dr('Email', `<a href="mailto:${escHtml(r.email)}">${escHtml(r.email)}</a>`)}
        ${dr('Phone', escHtml(r.phone))}
        ${r.guardian_phone ? dr('Guardian Phone', escHtml(r.guardian_phone)) : ''}
        ${dr('Preferred Unit', escHtml(r.preferred_unit) || '—')}
    </div>

    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-comment me-2"></i>Message</div>
        <div style="background:#faf7f2;border-radius:8px;padding:14px;font-size:0.85rem;
                    color:#333;line-height:1.65;white-space:pre-wrap;word-break:break-word;">
            ${escHtml(r.message) || '<em style="color:#bbb">No message provided.</em>'}
        </div>
    </div>

    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-robot me-2"></i>AI Classification</div>
        ${dr('Status',     statusBadge(r.status))}
        ${dr('AI Result',  aiBadge(r.ai_result, r.ai_confidence))}
        ${dr('Confidence', `
            <div class="inq-confidence" style="min-width:120px">
                <div class="inq-confidence-bar">
                    <div class="inq-confidence-fill" style="width:${r.ai_confidence||0}%;
                         background:${r.ai_result==='SPAM'?'#e74c3c':'#27ae60'}"></div>
                </div>
                <span>${r.ai_confidence ?? '—'}%</span>
            </div>`)}
        ${dr('Reasoning', `<em style="font-size:0.8rem;color:#666">${escHtml(r.ai_reasoning) || '—'}</em>`)}
    </div>

    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-fingerprint me-2"></i>Device &amp; Network</div>
        ${dr('IP Address', `<code style="font-size:0.8rem">${escHtml(r.ip_address)}</code>`)}
        ${dr('Device ID',  r.device_id
            ? `<code style="font-size:0.72rem;word-break:break-all">${escHtml(r.device_id).slice(0,32)}…</code>`
            : '<span class="text-muted">—</span>')}
        ${dr('User Agent', `<div style="font-size:0.72rem;color:#888;word-break:break-all">${escHtml(r.user_agent)}</div>`)}
        ${dr('Submitted',  fmtDate(r.created_at))}
    </div>

    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-shield-alt me-2"></i>Fraud Hashes</div>
        <div style="font-size:0.7rem;color:#888;margin-bottom:6px">Message Hash (SHA-256)</div>
        <div class="inq-hash-box">${escHtml(r.message_hash) || '—'}</div>
        <div style="font-size:0.7rem;color:#888;margin:10px 0 6px">User Hash (email+phone)</div>
        <div class="inq-hash-box">${escHtml(r.user_hash) || '—'}</div>
    </div>

    ${r.admin_note ? `
    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title"><i class="fas fa-sticky-note me-2"></i>Admin Note</div>
        <div style="background:#fffbf3;border-radius:8px;padding:12px;font-size:0.83rem;color:#555">
            ${escHtml(r.admin_note)}
        </div>
    </div>` : ''}

    ${r.room_quiz ? buildRoommateProfileCard(r.room_quiz) : ''}

    ${buildIdDocSection(r)}

    ${buildOsintSection(r)}`;
}

function dr(label, value) {
    return `<div class="inq-drawer-row">
        <span class="label">${label}</span>
        <span class="value">${value}</span>
    </div>`;
}

// ─── ID Document Verification Panel ──────────────────────────────────────────

function buildIdDocSection(r) {
    let analysis = null;
    if (r.id_analysis) {
        try { analysis = typeof r.id_analysis === 'string' ? JSON.parse(r.id_analysis) : r.id_analysis; }
        catch (_) { analysis = null; }
    }

    const hasSchool = r.school_id_path || r.has_school_id;
    const hasGovt   = r.govt_id_path   || r.has_govt_id;

    if (!hasSchool && !hasGovt && !analysis) return '';

    const verdictConfig = {
        PASS:  { color: '#27ae60', bg: 'rgba(39,174,96,0.12)',  icon: '✓', label: 'PASS' },
        FLAG:  { color: '#f39c12', bg: 'rgba(243,156,18,0.12)', icon: '!', label: 'FLAG' },
        FAIL:  { color: '#e74c3c', bg: 'rgba(231,76,60,0.12)',  icon: '✗', label: 'FAIL' },
    };
    const idVerifyStatus = r.id_verify_status || (analysis ? analysis.verdict?.toLowerCase() : 'pending');
    const verdictKey = analysis?.verdict || 'FLAG';
    const vc = verdictConfig[verdictKey] || verdictConfig['FLAG'];
    const conf = analysis?.confidence ?? 0;

    return `
    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title">
            <i class="fas fa-id-card me-2"></i>ID Document Verification
            ${analysis && !analysis.skipped
                ? `<span style="margin-left:8px;padding:2px 10px;border-radius:20px;font-size:0.72rem;
                              font-weight:700;background:${vc.bg};color:${vc.color};border:1px solid ${vc.color}40">
                      ${vc.icon} ${vc.label}
                   </span>`
                : `<span style="margin-left:8px;padding:2px 10px;border-radius:20px;font-size:0.72rem;
                              font-weight:600;background:#f5f5f5;color:#999;border:1px solid #ddd">
                      ⏳ Pending
                   </span>`
            }
        </div>

        <!-- Document Thumbnails -->
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
            ${hasSchool ? `
            <div style="flex:1;min-width:120px">
                <div style="font-size:0.72rem;color:#888;margin-bottom:6px;font-weight:600">🎓 SCHOOL ID</div>
                <a href="/api/admin/inquiry-docs/${r.id}/school_id" target="_blank" rel="noopener"
                   style="display:block;border-radius:8px;overflow:hidden;border:2px solid rgba(197,160,89,0.3);
                          transition:border-color 0.2s" onmouseover="this.style.borderColor='#c5a059'"
                   onmouseout="this.style.borderColor='rgba(197,160,89,0.3)'">
                    <img src="/api/admin/inquiry-docs/${r.id}/school_id" alt="School ID"
                         style="width:100%;height:80px;object-fit:cover;display:block"
                         onerror="this.parentElement.innerHTML='<div style=\\'padding:16px;text-align:center;color:#aaa;font-size:0.75rem\\'>Image unavailable</div>'">
                </a>
                <div style="font-size:0.68rem;color:#27ae60;margin-top:4px;text-align:center">Click to view full size</div>
            </div>` : `
            <div style="flex:1;min-width:120px;border:2px dashed #ddd;border-radius:8px;
                        display:flex;align-items:center;justify-content:center;height:96px;color:#ccc;font-size:0.75rem">
                🎓 No School ID
            </div>`}

            ${hasGovt ? `
            <div style="flex:1;min-width:120px">
                <div style="font-size:0.72rem;color:#888;margin-bottom:6px;font-weight:600">🪪 GOVERNMENT ID</div>
                <a href="/api/admin/inquiry-docs/${r.id}/govt_id" target="_blank" rel="noopener"
                   style="display:block;border-radius:8px;overflow:hidden;border:2px solid rgba(197,160,89,0.3);
                          transition:border-color 0.2s" onmouseover="this.style.borderColor='#c5a059'"
                   onmouseout="this.style.borderColor='rgba(197,160,89,0.3)'">
                    <img src="/api/admin/inquiry-docs/${r.id}/govt_id" alt="Government ID"
                         style="width:100%;height:80px;object-fit:cover;display:block"
                         onerror="this.parentElement.innerHTML='<div style=\\'padding:16px;text-align:center;color:#aaa;font-size:0.75rem\\'>Image unavailable</div>'">
                </a>
                <div style="font-size:0.68rem;color:#27ae60;margin-top:4px;text-align:center">Click to view full size</div>
            </div>` : `
            <div style="flex:1;min-width:120px;border:2px dashed #ddd;border-radius:8px;
                        display:flex;align-items:center;justify-content:center;height:96px;color:#ccc;font-size:0.75rem">
                🪪 No Govt ID
            </div>`}
        </div>

        ${analysis && !analysis.skipped ? `
        <!-- AI Analysis Results -->
        ${analysis.schoolId?.nameOnId ? dr('Name on School ID', `<code style="font-size:0.82rem">${escHtml(analysis.schoolId.nameOnId)}</code>`) : ''}
        ${analysis.schoolId?.school   ? dr('School', escHtml(analysis.schoolId.school)) : ''}
        ${analysis.govtId?.nameOnId   ? dr('Name on Govt ID',   `<code style="font-size:0.82rem">${escHtml(analysis.govtId.nameOnId)}</code>`) : ''}
        ${analysis.govtId?.idType     ? dr('ID Type', escHtml(analysis.govtId.idType)) : ''}
        ${dr('Names Match Form',    analysis.nameMatchesForm   ? '<span style="color:#27ae60;font-weight:700">✓ Yes</span>' : '<span style="color:#e74c3c;font-weight:700">✗ No — mismatch!</span>')}
        ${dr('IDs Match Each Other', analysis.idsMatchEachOther ? '<span style="color:#27ae60;font-weight:700">✓ Yes</span>' : '<span style="color:#e74c3c;font-weight:700">✗ No — mismatch!</span>')}
        ${analysis.suspiciousEditing ? dr('Editing Detected', `<span style="color:#e74c3c;font-weight:700">⚠ YES — ${escHtml(analysis.editingReason||'possible tampering')}</span>`) : ''}
        ${dr('AI Confidence', `
            <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden">
                    <div style="width:${conf}%;height:100%;background:${conf>=70?'#27ae60':conf>=40?'#f39c12':'#e74c3c'};border-radius:3px"></div>
                </div>
                <span style="font-size:0.8rem;font-weight:700;color:#555">${conf}%</span>
            </div>`)}
        ${analysis.reason ? dr('Verdict Reason', `<em style="font-size:0.8rem;color:#666">${escHtml(analysis.reason)}</em>`) : ''}
        ` : analysis?.skipped ? `
        <div style="font-size:0.82rem;color:#999;padding:10px 0;font-style:italic">
            AI analysis not available — ${escHtml(analysis.reason || 'No API key configured')}.
        </div>` : `
        <div style="font-size:0.82rem;color:#999;padding:10px 0;font-style:italic">
            ⏳ AI analysis running in background…
        </div>`}
    </div>`;
}



function buildOsintSection(r) {
    let cached = null;
    if (r.osint_result) {
        try { cached = typeof r.osint_result === 'string' ? JSON.parse(r.osint_result) : r.osint_result; }
        catch (_) { cached = null; }
    }

    return `
    <div class="inq-drawer-section" id="osint-section-${r.id}">
        <div class="inq-drawer-section-title">
            <i class="fas fa-search-dollar me-2"></i>Background Check (OSINT)
            ${cached
                ? `<span class="osint-checked-badge">✓ Checked</span>
                   <button class="osint-rerun-btn" onclick="triggerOsintCheck(${r.id})" title="Re-run background check">
                       <i class="fas fa-redo-alt"></i>
                   </button>`
                : '<span class="osint-scanning-badge"><i class="fas fa-circle-notch fa-spin me-1"></i>Scanning…</span>'
            }
        </div>
        ${cached ? renderOsintPanel(cached) : `
            <div class="osint-loading">
                <div class="osint-loading-spinner"></div>
                <div class="osint-loading-text" id="osint-loading-text">🔍 Running background check…</div>
            </div>
        `}
    </div>`;
}

function renderOsintPanel(d) {
    const levelClass = d.trustLevel === 'HIGH' ? 'osint-trust-high'
                     : d.trustLevel === 'MEDIUM' ? 'osint-trust-medium' : 'osint-trust-low';
    const levelColor = d.trustLevel === 'HIGH' ? '#27ae60'
                     : d.trustLevel === 'MEDIUM' ? '#f39c12' : '#e74c3c';
    const levelIcon  = d.trustLevel === 'HIGH' ? '✓' : d.trustLevel === 'MEDIUM' ? '!' : '✗';

    // Trust score ring
    const radius = 28, circ = 2 * Math.PI * radius;
    const fill   = circ - (circ * (d.trustScore || 0) / 100);

    // ── Recommendation Banner ────────────────────────────────────────────────
    const rec = d.recommendation || (d.trustLevel === 'HIGH' ? 'SAFE' : d.trustLevel === 'MEDIUM' ? 'VERIFY' : 'AVOID');
    const recConfig = {
        SAFE:   { cls: 'osint-rec-safe',   icon: 'fas fa-check-circle',     label: 'Safe to Contact',  desc: 'This person appears to be legitimate. You may proceed.' },
        VERIFY: { cls: 'osint-rec-verify', icon: 'fas fa-exclamation-circle', label: 'Verify First',   desc: 'Some signals need verification before proceeding.' },
        AVOID:  { cls: 'osint-rec-avoid',  icon: 'fas fa-times-circle',      label: 'Do Not Contact', desc: 'Multiple red flags detected. Exercise extreme caution.' }
    };
    const rc = recConfig[rec] || recConfig['VERIFY'];
    const recBanner = `
    <div class="osint-rec-banner ${rc.cls}">
        <i class="${rc.icon} osint-rec-icon"></i>
        <div class="osint-rec-content">
            <div class="osint-rec-label">${rc.label}</div>
            <div class="osint-rec-desc">${rc.desc}</div>
        </div>
    </div>`;

    // ── AI Flags ─────────────────────────────────────────────────────────────
    const flags = d.flags || [];
    const flagColors = {
        VOIP_PHONE:          '#e74c3c', INVALID_PHONE:      '#e74c3c',
        NON_PH_NUMBER:       '#f39c12', TEMP_EMAIL_DOMAIN:  '#e74c3c',
        BLACKLISTED_EMAIL:   '#e74c3c', SUSPICIOUS_EMAIL:   '#f39c12',
        EMAIL_MALICIOUS_HISTORY: '#e74c3c', CREDENTIALS_LEAKED: '#e74c3c',
        NO_WEB_PRESENCE:     '#aaa',    HAS_SOCIAL_PROFILES:'#27ae60',
        CLEAN_PROFILE:       '#27ae60', VERIFIED_CARRIER:   '#27ae60'
    };
    const flagsHtml = flags.length > 0 ? `
    <div class="osint-flags">
        ${flags.map(f => {
            const col = flagColors[f] || '#888';
            const label = f.replace(/_/g, ' ');
            return `<span class="osint-flag-tag" style="background:${col}18;color:${col};border-color:${col}33">${label}</span>`;
        }).join('')}
    </div>` : '';

    // ── Phone section ────────────────────────────────────────────────────────
    const phone = d.phone || {};
    const phoneHtml = phone.skipped
        ? `<span class="osint-skipped">Skipped — no API key</span>`
        : phone.error
        ? `<span class="osint-error"><i class="fas fa-exclamation-triangle me-1"></i>${escHtml(phone.error)}</span>`
        : `<div class="osint-detail-row">
               <span class="osint-detail-label">Valid</span>
               <span class="osint-detail-val ${phone.valid ? 'osint-ok' : 'osint-bad'}">
                   ${phone.valid ? '✓ Yes' : phone.valid === false ? '✗ No' : '? Unknown'}
               </span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Carrier</span>
               <span class="osint-detail-val">${escHtml(phone.localCarrier || phone.carrier || '—')}${phone.localCarrier ? ' <span class="osint-carrier-tag">PH Detected</span>' : ''}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Line Type</span>
               <span class="osint-detail-val ${phone.isVoip ? 'osint-bad' : ''}">${escHtml(phone.lineType || '—')}${phone.isVoip ? ' ⚠ VOIP' : ''}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Country</span>
               <span class="osint-detail-val">${escHtml(phone.country || '—')}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">PH Number</span>
               <span class="osint-detail-val ${phone.isPH ? 'osint-ok' : 'osint-bad'}">${phone.isPH ? '✓ Yes' : '✗ No'}</span>
           </div>`;

    // ── Email section ────────────────────────────────────────────────────────
    const email = d.email || {};
    const emailHtml = email.skipped
        ? `<span class="osint-skipped">Skipped — no API key</span>`
        : email.rateLimited
        ? `<div class="osint-rate-limited">
               <i class="fas fa-clock me-2"></i>
               <div>
                   <strong>Rate limited by EmailRep.io</strong>
                   <div style="font-size:0.74rem;margin-top:3px;opacity:0.85">
                       Free tier allows 1 request/day. Add <code>EMAILREP_API_KEY</code> to your <code>.env</code> for unlimited access.
                       ${email.isTempDomain ? '<br><span style="color:#e74c3c">⚠ Temp/disposable domain detected locally.</span>' : ''}
                   </div>
               </div>
           </div>`
        : email.error
        ? `<span class="osint-error"><i class="fas fa-exclamation-triangle me-1"></i>${escHtml(email.error)}</span>`
        : `<div class="osint-detail-row">
               <span class="osint-detail-label">Reputation</span>
               <span class="osint-detail-val osint-rep-${escHtml((email.reputation||'none').toLowerCase())}">${escHtml(email.reputation || '—')}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Suspicious</span>
               <span class="osint-detail-val ${email.suspicious ? 'osint-bad' : 'osint-ok'}">${email.suspicious ? '✗ Yes' : '✓ No'}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Blacklisted</span>
               <span class="osint-detail-val ${email.blacklisted ? 'osint-bad' : 'osint-ok'}">${email.blacklisted ? '✗ Yes' : '✓ No'}</span>
           </div>
           <div class="osint-detail-row">
               <span class="osint-detail-label">Temp Domain</span>
               <span class="osint-detail-val ${email.isTempDomain ? 'osint-bad' : 'osint-ok'}">${email.isTempDomain ? '✗ Disposable' : '✓ No'}</span>
           </div>
           ${(email.profiles || []).length > 0 ? `
           <div class="osint-detail-row">
               <span class="osint-detail-label">Profiles</span>
               <span class="osint-detail-val">${email.profiles.map(p => escHtml(p)).join(', ')}</span>
           </div>` : ''}
           <div class="osint-detail-row">
               <span class="osint-detail-label">First Seen</span>
               <span class="osint-detail-val">${escHtml(email.firstSeen || '—')}</span>
           </div>`;


    // ── Web results ──────────────────────────────────────────────────────────
    const webResults = d.webResults || [];
    const webHtml = webResults.length === 0
        ? `<div class="osint-no-results"><i class="fas fa-search me-1"></i>No web results found for this name.</div>`
        : webResults.map(r => `
            <a class="osint-web-result" href="${escHtml(r.url)}" target="_blank" rel="noopener">
                <div class="osint-web-title">${escHtml(r.title)}</div>
                <div class="osint-web-snippet">${escHtml(r.snippet)}</div>
                <div class="osint-web-url">${escHtml(r.url)}</div>
            </a>`).join('');

    // ── Social links (expanded) ───────────────────────────────────────────────
    const sl = d.socialLinks || {};
    // ── Email Verification Panel (replaces Google search button) ─────────────
    const ev = d.emailVerify || {};
    const hasEmailVerify = ev.checkedVia != null; // only present on newly-scanned results

    let emailVerifyHtml;

    if (!hasEmailVerify) {
        // Old cached result — email verification wasn't run yet
        emailVerifyHtml = `
        <div class="osint-email-verify-panel" style="text-align:center;padding:14px">
            <div style="font-size:0.8rem;color:#aaa;margin-bottom:10px">
                <i class="fas fa-redo-alt me-1"></i>Email verification not available in this scan
            </div>
            <div style="font-size:0.75rem;color:#bbb;font-style:italic">Re-run the background check to see email verification results</div>
        </div>`;
    } else {
        const evDelivery  = (ev.deliverability || 'UNKNOWN').toUpperCase();
        const evIsGood    = ev.deliverable === true || evDelivery === 'LIKELY' || evDelivery === 'DELIVERABLE';
        const evIsBad     = evDelivery === 'UNDELIVERABLE' || evDelivery === 'DISPOSABLE';
        const evColor     = evIsGood ? '#27ae60' : evIsBad ? '#e74c3c' : '#f39c12';
        const evIcon      = evIsGood ? '✓' : evIsBad ? '✗' : '?';
        const deliveryLabels = {
            DELIVERABLE:   '✓ Deliverable',
            LIKELY:        '✓ Likely Deliverable',
            RISKY:         '⚠ Risky',
            UNKNOWN:       '? Unknown',
            UNDELIVERABLE: '✗ Undeliverable',
            DISPOSABLE:    '✗ Disposable Domain'
        };
        const qualityPct = ev.qualityScore != null ? Math.round(ev.qualityScore * 100) : null;

        emailVerifyHtml = `
        <div class="osint-email-verify-panel">
            <div class="osint-email-verify-status" style="color:${evColor}">
                <span class="osint-email-verify-icon">${evIcon}</span>
                <span class="osint-email-verify-label">${deliveryLabels[evDelivery] || evDelivery}</span>
            </div>
            <div class="osint-email-verify-rows">
                <div class="osint-detail-row">
                    <span class="osint-detail-label">Format Valid</span>
                    <span class="osint-detail-val ${ev.formatValid ? 'osint-ok' : 'osint-bad'}">${ev.formatValid ? '✓ Yes' : '✗ No'}</span>
                </div>
                <div class="osint-detail-row">
                    <span class="osint-detail-label">MX Records</span>
                    <span class="osint-detail-val ${ev.mxExists ? 'osint-ok' : 'osint-bad'}">${ev.mxExists ? `✓ Found (${ev.mxCount || 1})` : '✗ None'}</span>
                </div>
                ${ev.primaryMx ? `
                <div class="osint-detail-row">
                    <span class="osint-detail-label">Mail Server</span>
                    <span class="osint-detail-val" style="font-family:monospace;font-size:0.74rem">${escHtml(ev.primaryMx)}</span>
                </div>` : ''}
                ${ev.isFree != null && ev.isFree !== false ? `
                <div class="osint-detail-row">
                    <span class="osint-detail-label">Free Provider</span>
                    <span class="osint-detail-val">${ev.isFree ? 'Yes (Gmail/Yahoo/etc)' : 'No'}</span>
                </div>` : ''}
                ${ev.isDisposable ? `
                <div class="osint-detail-row">
                    <span class="osint-detail-label">Disposable</span>
                    <span class="osint-detail-val osint-bad">✗ Temp/Disposable</span>
                </div>` : ''}
                ${qualityPct != null ? `
                <div class="osint-detail-row">
                    <span class="osint-detail-label">Quality Score</span>
                    <span class="osint-detail-val" style="color:${qualityPct >= 70 ? '#27ae60' : qualityPct >= 40 ? '#f39c12' : '#e74c3c'}">${qualityPct}%</span>
                </div>` : ''}
                <div style="font-size:0.67rem;color:#bbb;margin-top:6px;font-style:italic">via ${escHtml(ev.checkedVia || 'DNS MX lookup')}</div>
            </div>
        </div>`;
    }



    const socialHtml = `
        <div class="osint-social-group">
            <div class="osint-social-group-label">📧 Email Verification</div>
            ${emailVerifyHtml}
        </div>
        <div class="osint-social-group">
            <div class="osint-social-group-label">📱 Social Platforms</div>
            <div class="osint-social-links">
                ${sl.facebook  ? `<a href="${sl.facebook}"  target="_blank" class="osint-social-btn osint-social-fb"><i class="fab fa-facebook me-1"></i>Facebook</a>` : ''}
            </div>
        </div>
        <div class="osint-social-group">
            <div class="osint-social-group-label">💬 Message</div>
            <div class="osint-social-links">
                ${sl.whatsapp  ? `<a href="${sl.whatsapp}"  target="_blank" class="osint-social-btn osint-social-wa"><i class="fab fa-whatsapp me-1"></i>WhatsApp</a>` : ''}
                ${sl.viber     ? `<a href="${sl.viber}"     target="_blank" class="osint-social-btn osint-social-vb"><i class="fab fa-viber me-1"></i>Viber</a>` : ''}
                ${sl.messenger ? `<a href="${sl.messenger}" target="_blank" class="osint-social-btn osint-social-ms"><i class="fab fa-facebook-messenger me-1"></i>Messenger</a>` : ''}
            </div>
        </div>`;




    const checkedAt = d.checkedAt ? new Date(d.checkedAt).toLocaleString('en-PH', { month:'short', day:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown';

    return `
    ${recBanner}

    <!-- Trust Score Ring -->
    <div class="osint-trust-header">
        <div class="osint-trust-ring-wrap">
            <svg class="osint-ring" width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="28" fill="none" stroke="#f0e8d8" stroke-width="7"/>
                <circle cx="36" cy="36" r="28" fill="none"
                    stroke="${levelColor}" stroke-width="7"
                    stroke-dasharray="${circ.toFixed(1)}"
                    stroke-dashoffset="${fill.toFixed(1)}"
                    stroke-linecap="round"
                    transform="rotate(-90 36 36)"
                    style="transition:stroke-dashoffset 0.8s ease"/>
                <text x="36" y="40" text-anchor="middle" font-size="15" font-weight="700"
                    fill="${levelColor}" font-family="Inter,sans-serif">${d.trustScore ?? '?'}</text>
            </svg>
        </div>
        <div class="osint-trust-info">
            <div class="osint-trust-level ${levelClass}">${levelIcon} ${d.trustLevel || 'UNKNOWN'} TRUST</div>
            <div class="osint-trust-score-label">Score: ${d.trustScore ?? '?'} / 100</div>
            <div class="osint-trust-time">Checked: ${checkedAt}</div>
        </div>
    </div>

    <!-- AI Flags -->
    ${flagsHtml}

    <!-- AI Summary -->
    ${d.aiSummary ? `
    <div class="osint-ai-summary">
        <div class="osint-ai-label"><i class="fas fa-robot me-1"></i>AI Analysis</div>
        <p class="osint-ai-text">${escHtml(d.aiSummary)}</p>
    </div>` : ''}

    <!-- Collapsible sections -->
    <div class="osint-accordion">
        <details class="osint-acc-item" open>
            <summary class="osint-acc-title"><i class="fas fa-phone me-2"></i>Phone Validation</summary>
            <div class="osint-acc-body">${phoneHtml}</div>
        </details>
        <details class="osint-acc-item">
            <summary class="osint-acc-title"><i class="fas fa-envelope me-2"></i>Email Reputation</summary>
            <div class="osint-acc-body">${emailHtml}</div>
        </details>
        <details class="osint-acc-item">
            <summary class="osint-acc-title"><i class="fas fa-globe me-2"></i>Web Search Results</summary>
            <div class="osint-acc-body osint-web-results">${webHtml}</div>
        </details>
    </div>

    <!-- Expanded Social & Contact Links -->
    <div style="margin-top:14px">
        <div style="font-size:0.7rem;color:#aaa;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Manual Search &amp; Contact Links</div>
        ${socialHtml}
    </div>`;
}

async function triggerOsintCheck(id) {
    const section = document.getElementById(`osint-section-${id}`);
    if (!section) return;

    const steps = [
        '🔍 Searching the web…',
        '📱 Validating phone number…',
        '📧 Checking email reputation…',
        '🤖 Consulting AI for trust score…',
        '🇵🇭 Detecting PH carrier…'
    ];
    let stepIdx = 0;
    const loadingEl = document.createElement('div');
    loadingEl.className = 'osint-loading';
    loadingEl.innerHTML = `
        <div class="osint-loading-spinner"></div>
        <div class="osint-loading-text" id="osint-loading-text">${steps[0]}</div>
    `;
    const prompt = section.querySelector('.osint-run-prompt');
    if (prompt) prompt.replaceWith(loadingEl);

    const stepTimer = setInterval(() => {
        stepIdx = (stepIdx + 1) % steps.length;
        const el = document.getElementById('osint-loading-text');
        if (el) el.textContent = steps[stepIdx];
    }, 2200);

    try {
        const res  = await fetch(`/api/admin/inquiries/${id}/osint`, {
            method: 'POST', credentials: 'include'
        });
        const data = await res.json();
        clearInterval(stepTimer);

        if (!res.ok) throw new Error(data.error || 'OSINT check failed');

        const panelEl = document.createElement('div');
        panelEl.innerHTML = renderOsintPanel(data.osintResult);
        loadingEl.replaceWith(panelEl.firstElementChild || panelEl);

        const title = section.querySelector('.inq-drawer-section-title');
        if (title && !title.querySelector('.osint-checked-badge')) {
            title.insertAdjacentHTML('beforeend', '<span class="osint-checked-badge">✓ Checked</span>');
        }

        if (data.statusChanged) {
            showInquiryToast(`⚠️ Trust score critically low (${data.osintResult.trustScore}/100) — auto-flagged as suspicious.`, 'danger');
            loadInquiries(InquiryDashboard.currentPage);
        } else {
            showInquiryToast('Background check complete ✓', 'success');
        }
        // Refresh missing count
        checkOsintMissing();
    } catch (err) {
        clearInterval(stepTimer);
        loadingEl.innerHTML = `<div class="osint-error"><i class="fas fa-exclamation-triangle me-1"></i>${err.message}</div>`;
        showInquiryToast(err.message, 'danger');
    }
}

// ─── Roommate Profile Card ─────────────────────────────────────────────────────
function buildRoommateProfileCard(quizJson) {
    let q;
    try { q = typeof quizJson === 'string' ? JSON.parse(quizJson) : quizJson; }
    catch (_) { return ''; }
    if (!q) return '';

    const pEmoji = q.personality === 'Introvert' ? '🌙' : q.personality === 'Extrovert' ? '☀️' : '⚖️';
    const noiseLabel = (q.noise_tolerance <= 2) ? 'Quiet' : (q.noise_tolerance >= 4) ? 'Lively' : 'Balanced';
    const cleanLabel = (q.cleanliness >= 4) ? 'Very Tidy' : (q.cleanliness <= 2) ? 'Relaxed' : 'Moderate';

    const row = (icon, label, val) => `
        <div style="display:flex;flex-direction:column;gap:3px;background:#faf7f2;border-radius:6px;padding:10px">
            <span style="font-size:10px;color:#aaa;letter-spacing:1px;text-transform:uppercase">${icon} ${label}</span>
            <b style="font-size:12px;color:#333">${escHtml(String(val ?? '—'))}</b>
        </div>`;

    return `
    <div class="inq-drawer-section">
        <div class="inq-drawer-section-title">
            <i class="fas fa-users me-2"></i>Roommate Profile
            <span style="margin-left:auto;font-size:11px;font-weight:400;color:#c5a059">${pEmoji} ${q.personality || ''} · ${noiseLabel} · ${cleanLabel}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
            ${row('🕐','Wake', q.wake_time)}
            ${row('🌙','Sleep', q.sleep_time)}
            ${row('📚','Classes', q.class_schedule)}
            ${row('📖','Study / day', q.study_hours)}
            ${row('🎵','Music', q.plays_music ? (q.music_time || 'Yes') : 'No')}
            ${row('👥','Guests', q.guest_frequency)}
            ${row('❄️','Room Pref.', q.room_preference)}
            ${row('💡','Lights', q.lights_sleep)}
        </div>
        ${q.recommended_room ? `<div style="font-size:11.5px;color:#27ae60;font-weight:600;padding:6px 0;border-top:1px solid #f0e8d8">💡 Preferred Choice: ${escHtml(q.recommended_room)}</div>` : ''}
        ${q.course ? `<div style="font-size:12px;color:#c5a059;padding:6px 0;border-top:1px solid #f0e8d8">🎓 ${escHtml(q.course)}${q.school_location ? ' · ' + escHtml(q.school_location) : ''}</div>` : ''}
        ${q.notes ? `<div style="font-size:12px;color:#888;font-style:italic;margin-top:8px">"${escHtml(q.notes)}"</div>` : ''}
    </div>`;
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
function showInquiryToast(message, type = 'success') {
    const colors = { success: '#27ae60', danger: '#e74c3c', info: '#3498db' };
    const container = document.getElementById('inq-toast-container') || (() => {
        const c = document.createElement('div');
        c.id = 'inq-toast-container';
        c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
        document.body.appendChild(c);
        return c;
    })();

    const toast = document.createElement('div');
    toast.style.cssText = `
        background:${colors[type]||'#333'};color:#fff;
        padding:12px 18px;border-radius:8px;
        font-size:0.85rem;font-family:'Inter',sans-serif;
        box-shadow:0 4px 16px rgba(0,0,0,0.2);
        animation:toastIn 0.3s ease;min-width:240px;
    `;
    toast.innerHTML = `<i class="fas fa-${type==='success'?'check':'exclamation'}-circle me-2"></i>${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initInquirySection() {
    loadInquiryAnalytics();
    loadInquiries(1);
    checkOsintMissing();
}
