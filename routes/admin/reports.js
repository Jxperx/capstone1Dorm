'use strict';
const express = require('express');
const router  = express.Router();
const { poolPromise, sql } = require('../../config/db');
const {
    buildMaintenanceReport, buildFinancialReport,
    buildComplaintsReport,  buildBookingReport,
    buildIncidentReport,    autoTag
} = require('../../utils/aiReportEngine');

// ─── Admin-only guard ─────────────────────────────────────────────────────────
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin')
        return res.status(401).json({ error: 'Not authorized' });
    next();
});

// ─── Helper: save report to DB ────────────────────────────────────────────────
async function saveReport(pool, report, adminId) {
    const tags = autoTag(report.report_type, {
        emergencyCount: report.keyInformation?.openIncidents || report.keyInformation?.emergencies || 0,
        latePayments:   report.keyInformation?.latePaymentsCount || 0,
        negativeCount:  report.keyInformation?.negative || 0,
        highRisk:       report.priorityRisk?.risk === 'High'
    });

    const result = await pool.request()
        .input('report_type',       sql.NVarChar(50),   report.report_type)
        .input('report_title',      sql.NVarChar(255),  report.title)
        .input('generated_by',      sql.Int,            adminId || null)
        .input('date_from',         sql.Date,           report.filters?.dateFrom || null)
        .input('date_to',           sql.Date,           report.filters?.dateTo   || null)
        .input('priority_level',    sql.NVarChar(20),   report.priorityRisk?.priority || null)
        .input('risk_level',        sql.NVarChar(20),   report.priorityRisk?.risk     || null)
        .input('confidence_score',  sql.Int,            report.priorityRisk?.confidence || null)
        .input('executive_summary', sql.NVarChar(sql.MAX), report.executiveSummary || '')
        .input('report_data',       sql.NVarChar(sql.MAX), JSON.stringify(report))
        .input('tags',              sql.NVarChar(500),  tags)
        .query(`
            INSERT INTO generated_reports
                (report_type, report_title, generated_by, date_from, date_to,
                 priority_level, risk_level, confidence_score, executive_summary, report_data, tags)
            OUTPUT INSERTED.id
            VALUES
                (@report_type, @report_title, @generated_by, @date_from, @date_to,
                 @priority_level, @risk_level, @confidence_score, @executive_summary, @report_data, @tags)
        `);
    return result.recordset[0]?.id;
}

// ─── Helper: parse date filters ───────────────────────────────────────────────
function parseFilters(query) {
    return {
        dateFrom: query.from || null,
        dateTo:   query.to   || null
    };
}

// Returns a safe WHERE fragment using named parameters (@dateFrom, @dateTo).
// Callers must also call bindDateParams(request, filters) before executing.
function dateClause(alias, filters) {
    if (!filters.dateFrom && !filters.dateTo) return '';
    const parts = [];
    if (filters.dateFrom) parts.push(`${alias} >= @dateFrom`);
    if (filters.dateTo)   parts.push(`${alias} < @dateTo`); // exclusive upper bound covers full day
    return 'AND ' + parts.join(' AND ');
}

// Bind date filter parameters onto an mssql Request object.
function bindDateParams(req, filters) {
    if (filters.dateFrom) {
        req.input('dateFrom', sql.Date, filters.dateFrom);
    }
    if (filters.dateTo) {
        // Add one day so the dateTo day is fully included
        const toDate = new Date(filters.dateTo);
        toDate.setDate(toDate.getDate() + 1);
        req.input('dateTo', sql.Date, toDate);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/admin/reports  — list saved reports
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        // FIX: parameterize report_type filter instead of interpolating it into SQL
        const request = pool.request();
        let typeClause = '';
        if (req.query.type) {
            typeClause = 'AND report_type = @reportType';
            request.input('reportType', sql.NVarChar(50), req.query.type);
        }
        const result = await request.query(`
            SELECT id, report_type, report_title, generated_at,
                   priority_level, risk_level, confidence_score,
                   executive_summary, tags
            FROM generated_reports
            WHERE 1=1 ${typeClause}
            ORDER BY generated_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('[Reports List Error]', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/admin/reports/:id — fetch a specific saved report
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id(\\d+)', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, parseInt(req.params.id))
            .query('SELECT * FROM generated_reports WHERE id = @id');
        if (!result.recordset.length) return res.status(404).json({ error: 'Report not found' });
        const row = result.recordset[0];
        res.json({ ...row, report_data: JSON.parse(row.report_data) });
    } catch (err) {
        console.error('[Report Fetch Error]', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/admin/reports/maintenance
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/maintenance', async (req, res) => {
    try {
        const pool    = await poolPromise;
        const filters = parseFilters(req.query);
        const dc      = dateClause('m.reported_at', filters);

        // Bind date params onto the request before executing
        const dataReq = pool.request();
        bindDateParams(dataReq, filters);
        const result = await dataReq.query(`
            SELECT m.*, u.full_name, r.room_number
            FROM maintenance_requests m
            JOIN tenants t    ON m.tenant_id = t.id
            JOIN users   u    ON t.user_id   = u.id
            LEFT JOIN rooms r ON t.room_id   = r.id
            WHERE 1=1 ${dc}
        `);

        const report = await buildMaintenanceReport(result.recordset, filters);
        report.savedId = await saveReport(pool, report, req.session.user?.id);
        res.json(report);
    } catch (err) {
        console.error('[Maintenance Report Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/admin/reports/financial
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/financial', async (req, res) => {
    try {
        const pool    = await poolPromise;
        const filters = parseFilters(req.query);
        const dc      = dateClause('p.created_at', filters);

        // Bind date params onto the request before executing
        const dataReq = pool.request();
        bindDateParams(dataReq, filters);
        const result = await dataReq.query(`
            SELECT p.*, u.full_name, r.room_number, t.id as tenant_id
            FROM payments p
            JOIN tenants t    ON p.tenant_id = t.id
            JOIN users   u    ON t.user_id   = u.id
            LEFT JOIN rooms r ON t.room_id   = r.id
            WHERE 1=1 ${dc}
            ORDER BY p.created_at DESC
        `);

        const report = await buildFinancialReport(result.recordset, filters);
        report.savedId = await saveReport(pool, report, req.session.user?.id);
        res.json(report);
    } catch (err) {
        console.error('[Financial Report Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/admin/reports/complaints
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/complaints', async (req, res) => {
    try {
        const pool    = await poolPromise;
        const filters = parseFilters(req.query);
        const dc      = dateClause('f.created_at', filters);

        // Bind date params onto the request before executing
        const dataReq = pool.request();
        bindDateParams(dataReq, filters);
        const result = await dataReq.query(`
            SELECT f.id, f.feedback_text, f.ai_sentiment, f.ai_sentiment_score,
                   f.ai_topics, f.ai_keywords, f.ai_summary, f.ai_needs_attention,
                   f.ai_confidence, f.created_at,
                   u.full_name as tenant_name, r.room_number
            FROM tenant_feedback f
            JOIN tenants t    ON f.tenant_id = t.id
            JOIN users   u    ON t.user_id   = u.id
            LEFT JOIN rooms r ON t.room_id   = r.id
            WHERE 1=1 ${dc}
            ORDER BY f.created_at DESC
        `);

        // Parse JSON fields stored as strings
        result.recordset.forEach(row => {
            row.ai_topics    = row.ai_topics    ? (typeof row.ai_topics    === 'string' ? JSON.parse(row.ai_topics)    : row.ai_topics)    : [];
            row.ai_keywords  = row.ai_keywords  ? (typeof row.ai_keywords  === 'string' ? JSON.parse(row.ai_keywords)  : row.ai_keywords)  : [];
        });

        const report = await buildComplaintsReport(result.recordset, filters);
        report.savedId = await saveReport(pool, report, req.session.user?.id);
        res.json(report);
    } catch (err) {
        console.error('[Complaints Report Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/admin/reports/booking
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/booking', async (req, res) => {
    try {
        const pool    = await poolPromise;
        const filters = parseFilters(req.query);
        const dc      = dateClause('i.created_at', filters);

        let inquiries = [];
        try {
            // Bind date params for the inquiries sub-query
            const inqReq = pool.request();
            bindDateParams(inqReq, filters);
            const inqRes = await inqReq.query(`SELECT * FROM inquiries WHERE 1=1 ${dc} ORDER BY created_at DESC`);
            inquiries = inqRes.recordset;
        } catch { /* inquiries table may not exist in all environments */ }

        const tenantRes = await pool.request().query(`
            SELECT t.*, u.full_name, r.room_number
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
        `);

        const report = await buildBookingReport(inquiries, tenantRes.recordset, filters);
        report.savedId = await saveReport(pool, report, req.session.user?.id);
        res.json(report);
    } catch (err) {
        console.error('[Booking Report Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/admin/reports/incident
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/incident', async (req, res) => {
    try {
        const pool    = await poolPromise;
        const filters = parseFilters(req.query);
        const dc      = dateClause('m.reported_at', filters);

        // Bind date params onto the request before executing
        const dataReq = pool.request();
        bindDateParams(dataReq, filters);
        const result = await dataReq.query(`
            SELECT m.*, u.full_name, r.room_number
            FROM maintenance_requests m
            JOIN tenants t    ON m.tenant_id = t.id
            JOIN users   u    ON t.user_id   = u.id
            LEFT JOIN rooms r ON t.room_id   = r.id
            WHERE (m.ai_is_emergency = 1 OR m.ai_priority = 'Emergency') ${dc}
            ORDER BY m.reported_at DESC
        `);

        const report = await buildIncidentReport(result.recordset, filters);
        report.savedId = await saveReport(pool, report, req.session.user?.id);
        res.json(report);
    } catch (err) {
        console.error('[Incident Report Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/admin/reports/:id — remove a saved report
// ═══════════════════════════════════════════════════════════════════════════════
router.delete('/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, parseInt(req.params.id))
            .query('DELETE FROM generated_reports WHERE id = @id');
        res.json({ message: 'Report deleted.' });
    } catch (err) {
        console.error('[Report Delete Error]', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
