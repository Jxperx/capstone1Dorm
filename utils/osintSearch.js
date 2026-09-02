'use strict';
/**
 * utils/osintSearch.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Open-Source Intelligence (OSINT) engine for inquiry verification.
 *
 * Checks performed (all gracefully degrade if API keys are missing):
 *   1. Phone validation  â€” Numverify (carrier, line type, validity) w/ PH local fallback
 *   2. Email reputation  â€” EmailRep.io  (age, spam history, social profiles)
 *   3. Web name search   â€” Google Custom Search API ("Name" + Philippines)
 *   4. AI Trust Score    â€” Groq/Gemini synthesises all findings â†’ score 0-100
 *                          + recommendation: SAFE | VERIFY | AVOID
 *   5. ID document analysis â€” Groq vision reads School ID + Govt ID images
 *
 * Trust Score thresholds:
 *   â‰¥ 70  â†’ HIGH   (green)  â†’ Recommendation: SAFE
 *   40-69 â†’ MEDIUM (yellow) â†’ Recommendation: VERIFY
 *   < 40  â†’ LOW    (red)    â†’ Recommendation: AVOID â€” score < 30 auto-flags
 *
 * Returns: {
 *   trustScore: 0-100,
 *   trustLevel: 'HIGH'|'MEDIUM'|'LOW',
 *   recommendation: 'SAFE'|'VERIFY'|'AVOID',
 *   aiSummary: string,
 *   flags: string[],          // e.g. ['VOIP_PHONE', 'TEMP_EMAIL', 'NO_WEB_PRESENCE']
 *   phone: { valid, carrier, lineType, country, isVoip, isPH, rawResponse },
 *   email: { reputation, suspicious, blacklisted, profiles, isTempDomain, rawResponse },
 *   webResults: [{ title, snippet, url }],
 *   socialLinks: { facebook, google, linkedin, truecaller, twitter, instagram, tiktok,
 *                  googleImages, whatsapp, viber, messenger },
 *   checkedAt: ISO string
 * }
 */

const axios = require('axios');
const dns   = require('dns').promises;
const fs    = require('fs');
const path  = require('path');

// â”€â”€â”€ Known temporary/disposable email domains â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TEMP_EMAIL_DOMAINS = new Set([
    'mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com',
    'throwam.com','yopmail.com','sharklasers.com','guerrillamailblock.com',
    'grr.la','guerrillamail.info','guerrillamail.biz','guerrillamail.de',
    'guerrillamail.net','guerrillamail.org','spam4.me','trashmail.com',
    'trashmail.me','trashmail.net','trashmail.at','dispostable.com',
    'maildrop.cc','mailnull.com','spamgourmet.com','tempr.email',
    'discard.email','fakeinbox.com','mailnesia.com','mailnull.com'
]);

// â”€â”€â”€ Philippine carrier detection from prefix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function detectPHCarrier(phone) {
    const digits = phone.replace(/\D/g, '');
    // Strip country code if present (63)
    const local = digits.startsWith('63') ? '0' + digits.slice(2) : digits;

    const prefixMap = {
        // Globe / TM
        '0817': 'Globe', '0904': 'Globe', '0905': 'Globe', '0906': 'Globe',
        '0915': 'Globe', '0916': 'Globe', '0917': 'Globe', '0926': 'Globe',
        '0927': 'Globe', '0935': 'Globe', '0936': 'Globe', '0937': 'Globe',
        '0945': 'Globe', '0955': 'Globe', '0956': 'Globe', '0965': 'Globe',
        '0966': 'Globe', '0967': 'Globe', '0975': 'Globe', '0976': 'Globe',
        '0977': 'Globe', '0978': 'Globe', '0979': 'Globe',
        // Smart / TNT / Sun
        '0907': 'Smart', '0908': 'Smart', '0909': 'Smart', '0910': 'Smart',
        '0911': 'Smart', '0912': 'Smart', '0913': 'Smart', '0914': 'Smart',
        '0918': 'Smart', '0919': 'Smart', '0920': 'Smart', '0921': 'Smart',
        '0928': 'Smart', '0929': 'Smart', '0930': 'Smart', '0938': 'Smart',
        '0939': 'Smart', '0940': 'Smart', '0946': 'Smart', '0947': 'Smart',
        '0948': 'Smart', '0949': 'Smart', '0950': 'Smart', '0951': 'Smart',
        '0961': 'Smart', '0998': 'Smart', '0999': 'Smart',
        // DITO
        '0895': 'DITO', '0896': 'DITO', '0897': 'DITO', '0898': 'DITO',
        '0991': 'DITO', '0992': 'DITO', '0993': 'DITO', '0994': 'DITO',
        // Sun Cellular (under Smart now)
        '0922': 'Sun', '0923': 'Sun', '0924': 'Sun', '0925': 'Sun',
        '0931': 'Sun', '0932': 'Sun', '0933': 'Sun', '0934': 'Sun',
        '0942': 'Sun', '0943': 'Sun',
    };

    const prefix = local.slice(0, 4);
    return prefixMap[prefix] || null;
}

function isPHNumber(phone) {
    const digits = phone.replace(/\D/g, '');
    return digits.startsWith('63') || digits.startsWith('09');
}

// â”€â”€â”€ Phone Validation (Numverify â€” primary; local PH fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function validatePhone(phone) {
    const numverifyKey  = process.env.NUMVERIFY_API_KEY;
    const phCarrier     = detectPHCarrier(phone);
    const phNumber      = isPHNumber(phone);
    const normalized    = phone.replace(/[\s\-().]/g, '');

    // â”€â”€ Numverify (primary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (numverifyKey) {
        try {
            const res = await axios.get('http://apilayer.net/api/validate', {
                params: {
                    access_key:   numverifyKey,
                    number:       normalized,
                    country_code: 'PH',
                    format:       1
                },
                timeout: 8000
            });
            const d = res.data;
            if (d.error) throw new Error(d.error.info || 'Numverify error');

            const lineType = (d.line_type || '').toLowerCase();
            const isVoip   = lineType === 'voip';
            return {
                valid:        d.valid ?? null,
                carrier:      phCarrier || d.carrier     || 'Unknown',
                lineType:     d.line_type  || 'Unknown',
                country:      d.country_name || (phNumber ? 'Philippines' : 'Unknown'),
                countryCode:  d.country_code || 'PH',
                format:       d.international_format || normalized,
                location:     d.location || null,
                isVoip,
                isPH:         phNumber || d.country_code === 'PH',
                localCarrier: phCarrier,
                provider:     'numverify',
                rawResponse:  d,
                skipped:      false
            };
        } catch (err) {
            console.error('[OSINT] Numverify error:', err.message);
            // Fall through to local detection
        }
    }

    // â”€â”€ Local PH carrier detection only (no API key or Numverify failed) â”€â”€â”€â”€â”€â”€
    return {
        valid:        null,
        carrier:      phCarrier || 'N/A',
        lineType:     'N/A',
        country:      phNumber ? 'Philippines' : 'N/A',
        isVoip:       false,
        isPH:         phNumber,
        localCarrier: phCarrier,
        provider:     'local',
        rawResponse:  null,
        skipped:      !numverifyKey
    };
}

// â”€â”€â”€ Email Reputation (EmailRep.io) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function checkEmailRep(email) {
    const apiKey = process.env.EMAILREP_API_KEY;

    // Check temp domain locally â€” always works, no API needed
    const domain       = (email.split('@')[1] || '').toLowerCase();
    const isTempDomain = TEMP_EMAIL_DOMAINS.has(domain);

    const headers = { 'User-Agent': 'EliteStay-OSINT/1.0' };
    if (apiKey) headers['Key'] = apiKey;

    try {
        const res = await axios.get(`https://emailrep.io/${encodeURIComponent(email)}`, {
            headers,
            timeout: 8000,
            validateStatus: null // don't throw on any HTTP status â€” handle manually
        });

        // â”€â”€ Rate limited (free tier allows only 1 req/day without an API key) â”€â”€
        if (res.status === 429) {
            console.warn('[OSINT] EmailRep.io rate limit hit (429). Add EMAILREP_API_KEY to .env for higher limits.');
            return {
                reputation: 'unknown', suspicious: null, blacklisted: false,
                maliciousActivity: false, credentialLeaked: false,
                profiles: [], domainExists: null, domainAge: null,
                firstSeen: 'N/A', isTempDomain, domain,
                rawResponse: null, skipped: false,
                rateLimited: true,
                error: 'Rate limited â€” EmailRep.io free tier allows 1 request/day. Add EMAILREP_API_KEY to .env for unlimited access.'
            };
        }

        // â”€â”€ Other non-2xx errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`EmailRep.io returned HTTP ${res.status}`);
        }

        const d = res.data;
        return {
            reputation:         d.reputation   || 'none',
            suspicious:         d.suspicious   ?? null,
            blacklisted:        d.details?.blacklisted           ?? false,
            maliciousActivity:  d.details?.malicious_activity    ?? false,
            credentialLeaked:   d.details?.credentials_leaked    ?? false,
            profiles:           d.details?.profiles              || [],
            domainExists:       d.details?.domain_exists         ?? null,
            domainAge:          d.details?.domain_age_days       ?? null,
            firstSeen:          d.details?.first_seen            || 'N/A',
            isTempDomain,
            domain,
            rawResponse:  d,
            skipped:      false,
            rateLimited:  false
        };
    } catch (err) {
        console.error('[OSINT] Email reputation error:', err.message);
        return {
            reputation: 'unknown', suspicious: null, blacklisted: false,
            profiles: [], domainExists: null, domainAge: null,
            firstSeen: 'N/A', isTempDomain, domain,
            rawResponse: null, skipped: false, error: err.message
        };
    }
}

// â”€â”€â”€ Email Deliverability Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Checks DNS MX records (free, always runs) + AbstractAPI email validation (optional).
// Tells you whether the email address domain can actually receive mail.

async function verifyEmailDeliverability(email) {
    const domain = (email.split('@')[1] || '').toLowerCase();

    // â”€â”€ Step 1: DNS MX lookup (free, no API key needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let mxExists   = false;
    let mxRecords  = [];
    let dnsError   = null;

    try {
        mxRecords = await dns.resolveMx(domain);
        // Sort by priority (lower = higher priority)
        mxRecords.sort((a, b) => a.priority - b.priority);
        mxExists = mxRecords.length > 0;
    } catch (err) {
        dnsError = err.code || err.message;
        mxExists = false;
    }

    const isFormatValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    const isDisposable  = TEMP_EMAIL_DOMAINS.has(domain);

    // â”€â”€ Step 2: AbstractAPI Email Validation (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const apiKey = process.env.ABSTRACT_API_EMAIL_KEY;
    if (apiKey) {
        try {
            const res = await axios.get('https://emailvalidation.abstractapi.com/v1/', {
                params: { api_key: apiKey, email },
                timeout: 8000
            });
            const d = res.data;
            return {
                formatValid:    d.is_valid_format?.value    ?? isFormatValid,
                mxExists:       d.is_mx_found?.value        ?? mxExists,
                deliverable:    d.deliverability === 'DELIVERABLE',
                deliverability: d.deliverability            || (mxExists ? 'LIKELY' : 'UNDELIVERABLE'),
                isFree:         d.is_free_email?.value      ?? false,
                isDisposable:   d.is_disposable_email?.value ?? isDisposable,
                isRoleEmail:    d.is_role_email?.value      ?? false,
                qualityScore:   d.quality_score             ?? null,
                primaryMx:      mxRecords[0]?.exchange      || null,
                mxCount:        mxRecords.length,
                checkedVia:     'AbstractAPI + DNS'
            };
        } catch (err) {
            console.error('[OSINT] Email deliverability (AbstractAPI) error:', err.message);
        }
    }

    // â”€â”€ Fallback: DNS-only result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return {
        formatValid:    isFormatValid,
        mxExists,
        deliverable:    mxExists && !isDisposable,
        deliverability: isDisposable  ? 'DISPOSABLE'
                      : !mxExists     ? 'UNDELIVERABLE'
                      : dnsError      ? 'UNKNOWN'
                                      : 'LIKELY',
        isFree:         false,
        isDisposable,
        isRoleEmail:    false,
        qualityScore:   null,
        primaryMx:      mxRecords[0]?.exchange || null,
        mxCount:        mxRecords.length,
        checkedVia:     dnsError ? `DNS error (${dnsError})` : 'DNS MX lookup'
    };
}

// â”€â”€â”€ Google Web Search (Custom Search API) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function searchByName(firstName, lastName) {
    const apiKey   = process.env.GOOGLE_SEARCH_API_KEY;
    const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!apiKey || !engineId) {
        return { results: [], skipped: true };
    }

    const query = `"${firstName} ${lastName}" Philippines`;

    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key: apiKey, cx: engineId, q: query, num: 5 },
            timeout: 10000
        });

        const items = res.data.items || [];
        return {
            results: items.map(item => ({
                title:   item.title   || '',
                snippet: item.snippet || '',
                url:     item.link    || ''
            })),
            query,
            skipped: false
        };
    } catch (err) {
        console.error('[OSINT] Google search error:', err.message);
        return { results: [], query, skipped: false, error: err.message };
    }
}

// ─── Google Search by Phone Number (Phone OSINT Deep Search) ───────────────────

/**
 * Deep search the internet specifically for the phone number.
 * Checks if the number is posted online, used in classifieds/social posts, or flagged for scam/fraud.
 */
async function searchByPhone(phone, firstName, lastName) {
    const apiKey   = process.env.GOOGLE_SEARCH_API_KEY;
    const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

    const digits = (phone || '').replace(/\D/g, '');
    let localFormat = digits;
    if (localFormat.startsWith('63') && localFormat.length === 12) {
        localFormat = '0' + localFormat.slice(2);
    }
    let intlFormat = digits;
    if (intlFormat.startsWith('09') && intlFormat.length === 11) {
        intlFormat = '+63' + intlFormat.slice(1);
    } else if (!intlFormat.startsWith('+')) {
        intlFormat = '+' + intlFormat;
    }

    const query = `"${localFormat}" OR "${intlFormat}"`;

    const socialLinks = {
        googlePhone:   `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        facebookPhone: `https://www.facebook.com/search/top?q=${encodeURIComponent(localFormat)}`,
        whatsapp:      `https://wa.me/${intlFormat.replace(/\+/g, '')}`,
        viber:         `viber://chat?number=%2B${intlFormat.replace(/\+/g, '')}`,
        telegram:      `https://t.me/+${intlFormat.replace(/\+/g, '')}`
    };

    if (!apiKey || !engineId) {
        return { results: [], query, socialLinks, skipped: true, hasMatches: false, nameMentioned: false, scamFlagged: false };
    }

    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key: apiKey, cx: engineId, q: query, num: 5 },
            timeout: 10000
        });

        const items = res.data.items || [];
        const fn = (firstName || '').toLowerCase();
        const ln = (lastName || '').toLowerCase();

        let nameMentioned = false;
        let scamFlagged = false;

        const results = items.map(item => {
            const title   = item.title   || '';
            const snippet = item.snippet || '';
            const text    = (title + ' ' + snippet).toLowerCase();

            if ((fn && text.includes(fn)) || (ln && text.includes(ln))) {
                nameMentioned = true;
            }
            if (/scam|fraud|bogus|warning|fake|buyer beware|scammer/i.test(text)) {
                scamFlagged = true;
            }

            return {
                title,
                snippet,
                url: item.link || ''
            };
        });

        return {
            results,
            query,
            socialLinks,
            hasMatches: results.length > 0,
            nameMentioned,
            scamFlagged,
            skipped: false
        };
    } catch (err) {
        console.error('[OSINT] Phone deep search error:', err.message);
        return { results: [], query, socialLinks, skipped: false, error: err.message, hasMatches: false, nameMentioned: false, scamFlagged: false };
    }
}

// ─── Social Media Manual Search Links ────────────────────────────────────────

function buildSocialLinks(firstName, lastName, phone) {
    const fullName    = `${firstName} ${lastName}`;
    const encodedName = encodeURIComponent(fullName);
    const digits      = (phone || '').replace(/\D/g, '');
    let localPhone    = digits;
    if (localPhone.startsWith('63') && localPhone.length === 12) localPhone = '0' + localPhone.slice(2);
    
    let intlPhone = digits;
    if (intlPhone.startsWith('09') && intlPhone.length === 11) intlPhone = '63' + intlPhone.slice(1);

    return {
        facebook:      `https://www.facebook.com/search/top?q=${encodedName}`,
        facebookPhone: `https://www.facebook.com/search/top?q=${encodeURIComponent(localPhone)}`,
        google:        `https://www.google.com/search?q="${encodeURIComponent(fullName)}" Philippines`,
        googlePhone:   `https://www.google.com/search?q="${encodeURIComponent(localPhone)}"+OR+"+${intlPhone}"`,
        whatsapp:      `https://wa.me/${intlPhone}`,
        viber:         `viber://chat?number=%2B${intlPhone}`,
        telegram:      `https://t.me/+${intlPhone}`
    };
}

// â”€â”€â”€ Build AI Flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildFlags(phoneData, emailData, webData) {
    const flags = [];

    if (phoneData.isVoip)                                    flags.push('VOIP_PHONE');
    if (phoneData.valid === false)                           flags.push('INVALID_PHONE');
    if (phoneData.isPH === false && !phoneData.skipped)     flags.push('NON_PH_NUMBER');
    if (emailData.isTempDomain)                              flags.push('TEMP_EMAIL_DOMAIN');
    if (emailData.blacklisted)                               flags.push('BLACKLISTED_EMAIL');
    if (emailData.suspicious === true)                       flags.push('SUSPICIOUS_EMAIL');
    if (emailData.maliciousActivity)                         flags.push('EMAIL_MALICIOUS_HISTORY');
    if (emailData.credentialLeaked)                          flags.push('CREDENTIALS_LEAKED');
    if (!webData.skipped && webData.results?.length === 0)  flags.push('NO_WEB_PRESENCE');
    if (emailData.profiles?.length > 0)                     flags.push('HAS_SOCIAL_PROFILES');
    if (!phoneData.skipped && phoneData.localCarrier)       flags.push(`CARRIER_${phoneData.localCarrier.toUpperCase()}`);

    return flags;
}

// â”€â”€â”€ Gemini AI Trust Score â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function computeTrustScore({ firstName, lastName, email, phone, message, phoneData, emailData, webData, phoneWebData }) {
    const apiKey = process.env.GEMINI_API_KEY;
    const flags  = buildFlags(phoneData, emailData, webData);

    const context = `
You are an OSINT (Open-Source Intelligence) trust analyst for EliteStay, a premium boarding house in the Philippines.

Your job: analyse data about a person who submitted a RENTAL INQUIRY and output a structured trust assessment.

== PERSON'S SUBMITTED INFORMATION ==
Name:    ${firstName} ${lastName}
Email:   ${email}
Phone:   ${phone}
Message: "${message || '(no message)'}"

== PHONE VALIDATION RESULTS ==
${phoneData.skipped
    ? 'Phone validation skipped (no API key).'
    : phoneData.error
        ? `Error: ${phoneData.error}`
        : `Valid: ${phoneData.valid}, Carrier: ${phoneData.carrier}, Line Type: ${phoneData.lineType}, Country: ${phoneData.country}, VOIP: ${phoneData.isVoip}, PH Number: ${phoneData.isPH}, Local PH Carrier Detected: ${phoneData.localCarrier || 'Unknown'}, Formatted: ${phoneData.format || phone}`
}

== EMAIL REPUTATION RESULTS ==
${emailData.skipped
    ? 'Email reputation check skipped (no API key).'
    : emailData.error
        ? `Error: ${emailData.error}`
        : `Reputation: ${emailData.reputation}, Suspicious: ${emailData.suspicious}, Blacklisted: ${emailData.blacklisted}, Malicious Activity: ${emailData.maliciousActivity}, Credentials Leaked: ${emailData.credentialLeaked}, Temp/Disposable Domain: ${emailData.isTempDomain}, Known Social Profiles: ${(emailData.profiles||[]).join(', ') || 'None'}, First Seen: ${emailData.firstSeen}`
}

== WEB SEARCH RESULTS ("${firstName} ${lastName}" Philippines) ==
${webData.skipped
    ? 'Web search skipped (no API key).'
    : webData.error
        ? `Error: ${webData.error}`
        : webData.results.length === 0
            ? 'No web results found for this name.'
            : webData.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`).join('\n\n')
}

== PRE-DETECTED FLAGS ==
${flags.length > 0 ? flags.join(', ') : 'None'}

== SCORING CRITERIA ==
Consider all factors. KEY RED FLAGS that heavily reduce score:
- VOIP phone number (-25 points) â€” commonly used for fake inquiries
- Temporary/disposable email domain (-30 points)
- Blacklisted or suspicious email (-20 points)
- Invalid or non-Philippine phone number (-15 points)
- No web presence for common-sounding Filipino names (-5 points only)

KEY TRUST BOOSTERS that increase score:
- Valid Philippine mobile number from a major carrier (Globe/Smart/DITO) (+20)
- Email has known social profiles (+15)
- Good email reputation (high) (+15)
- Web results suggest real person (+15)

Give benefit of the doubt to Filipino names with no web results (very common).
Never go above 95 even for clean profiles (uncertainty remains).

== REQUIRED OUTPUT ==
Respond ONLY in this exact JSON format (no markdown, no extra text, no code fences):
{"trustScore":75,"trustLevel":"HIGH","recommendation":"SAFE","summary":"2-3 sentence human-readable explanation of your findings and reasoning.","flags":["FLAG1","FLAG2"]}

RULES:
- trustLevel must be exactly: "HIGH" (score â‰¥ 70), "MEDIUM" (40-69), or "LOW" (< 40)
- recommendation must be exactly: "SAFE" (HIGH trust), "VERIFY" (MEDIUM trust), or "AVOID" (LOW trust)
- flags array: include any of: VOIP_PHONE, INVALID_PHONE, NON_PH_NUMBER, TEMP_EMAIL_DOMAIN, BLACKLISTED_EMAIL, SUSPICIOUS_EMAIL, NO_WEB_PRESENCE, CLEAN_PROFILE, VERIFIED_CARRIER
- Keep summary concise and professional
`;

    if (apiKey) {
        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: context }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 400 }
                })
            });

            if (!response.ok) throw new Error(`Gemini API ${response.status}`);

            const data    = await response.json();
            const raw     = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            let cleaned   = raw.replace(/```json|```/g, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleaned = jsonMatch[0];
            const parsed  = JSON.parse(cleaned);

            const score  = Math.min(95, Math.max(0, parseInt(parsed.trustScore) || 50));
            const level  = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
            const rec    = level === 'HIGH' ? 'SAFE' : level === 'MEDIUM' ? 'VERIFY' : 'AVOID';

            return {
                trustScore:     score,
                trustLevel:     level,
                recommendation: parsed.recommendation || rec,
                aiSummary:      (parsed.summary || '').slice(0, 800),
                flags:          Array.isArray(parsed.flags) ? parsed.flags : flags
            };
        } catch (err) {
            console.error('[OSINT] Gemini trust score error:', err.message);
        }
    }

    // Fallback: heuristic score when Gemini unavailable
    let score = 50;
    if (phoneData.valid === true)                score += 20;
    if (phoneData.valid === false)               score -= 15;
    if (phoneData.isVoip)                        score -= 25;
    if (phoneData.localCarrier)                  score += 10;
    if (phoneWebData?.nameMentioned)             score += 15;
    if (phoneWebData?.scamFlagged)               score -= 35;
    if (emailData.suspicious === false)          score += 10;
    if (emailData.suspicious === true)           score -= 20;
    if (emailData.blacklisted === true)          score -= 25;
    if (emailData.isTempDomain)                  score -= 30;
    if ((emailData.profiles || []).length > 0)  score += 15;
    if ((webData.results || []).length > 0)     score += 10;

    score = Math.min(95, Math.max(0, score));
    const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const rec   = level === 'HIGH' ? 'SAFE' : level === 'MEDIUM' ? 'VERIFY' : 'AVOID';

    return {
        trustScore:     score,
        trustLevel:     level,
        recommendation: rec,
        aiSummary:      'Trust score calculated using heuristic rules (Gemini AI unavailable).',
        flags
    };
}

// ─── Master OSINT Function ───────────────────────────────────────────────────

/**
 * Run a full OSINT background check on an inquiry.
 * @param {object} inquiry - { first_name, last_name, email, phone, message }
 * @returns {Promise<object>} Full OSINT result object
 */
async function runOsintCheck(inquiry) {
    const { first_name: firstName, last_name: lastName, email, phone, message } = inquiry;

    console.log(`[OSINT] Running background check for: ${firstName} ${lastName} <${email}> (${phone})`);

    // Run all data-gathering steps in parallel for speed
    const [phoneData, emailData, webData, emailVerify, phoneWebData] = await Promise.all([
        validatePhone(phone),
        checkEmailRep(email),
        searchByName(firstName, lastName),
        verifyEmailDeliverability(email),
        searchByPhone(phone, firstName, lastName)
    ]);

    // Compute AI trust score using all gathered data
    const { trustScore, trustLevel, recommendation, aiSummary, flags } = await computeTrustScore({
        firstName, lastName, email, phone, message,
        phoneData, emailData, webData, phoneWebData
    });

    const result = {
        trustScore,
        trustLevel,
        recommendation,
        aiSummary,
        flags,
        phone:           phoneData,
        email:           emailData,
        emailVerify,
        webResults:      webData.results || [],
        webQuery:        webData.query   || null,
        phoneWebResults: phoneWebData?.results || [],
        phoneWebQuery:   phoneWebData?.query   || null,
        phoneWebStatus: {
            hasMatches:    phoneWebData?.hasMatches || false,
            nameMentioned: phoneWebData?.nameMentioned || false,
            scamFlagged:   phoneWebData?.scamFlagged || false
        },
        socialLinks:     phoneWebData?.socialLinks || buildSocialLinks(firstName, lastName, phone),
        checkedAt:       new Date().toISOString()
    };

    console.log(`[OSINT] Complete — Trust: ${trustScore}/100 (${trustLevel}) [${recommendation}] for ${firstName} ${lastName}`);

    return result;
}

// â”€â”€â”€ AI ID Document Analysis (Groq Vision) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Analyze School ID and Government ID images using Groq vision AI.
 * Extracts name, ID number, expiry, cross-checks against form data.
 *
 * @param {number} inquiryId  - DB inquiry ID (for logging)
 * @param {string} schoolPath - Absolute path to school ID image
 * @param {string} govtPath   - Absolute path to government ID image
 * @param {string} formName   - Full name submitted in the form
 * @returns {Promise<object>} Analysis result object
 */
async function analyzeIdDocuments(inquiryId, schoolPath, govtPath, formName) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
        console.warn(`[OSINT] GROQ_API_KEY not set â€” skipping ID analysis for inquiry #${inquiryId}`);
        return { skipped: true, reason: 'No GROQ_API_KEY configured' };
    }
    try {
        // Read both images and convert to base64 (supports local files and remote URLs)
        const readImage = async (filePath) => {
            if (!filePath) return null;
            if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
                try {
                    const response = await axios.get(filePath, { responseType: 'arraybuffer' });
                    const buf = Buffer.from(response.data);
                    const ext = path.extname(filePath.split('?')[0]).toLowerCase().replace('.', '');
                    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                    return { base64: buf.toString('base64'), mime };
                } catch (e) {
                    console.error('[OSINT] Failed to download remote ID image:', filePath, e.message);
                    return null;
                }
            }
            if (!fs.existsSync(filePath)) return null;
            const buf = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase().replace('.', '');
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
            return { base64: buf.toString('base64'), mime };
        };

        const schoolImg = await readImage(schoolPath);
        const govtImg   = await readImage(govtPath);

        if (!schoolImg && !govtImg) {
            return { skipped: true, reason: 'No image files found on disk or remote storage' };
        }

        const prompt = `You are an ID document verification system for a Philippine boarding house.
Analyze the provided ID images and return ONLY a JSON object (no markdown, no explanation).

Submitted name on the form: "${formName}"

Extract and verify the following. If a value is not visible, use null.

Required JSON format:
{
  "schoolId": {
    "nameOnId": "Full name exactly as printed",
    "studentNumber": "Student ID number if visible",
    "school": "School or university name",
    "expired": false,
    "readable": true
  },
  "govtId": {
    "nameOnId": "Full name exactly as printed",
    "idType": "PhilSys / UMID / Driver's License / Passport / Other",
    "idNumber": "ID number if visible",
    "expired": false,
    "readable": true
  },
  "nameMatchesForm": true,
  "idsMatchEachOther": true,
  "suspiciousEditing": false,
  "editingReason": null,
  "verdict": "PASS",
  "reason": "One sentence explanation",
  "confidence": 85
}

Rules for verdict:
- PASS: Names match form, IDs are readable, no signs of editing
- FLAG: Minor name mismatch (nickname vs full name), partially unreadable, or one ID missing
- FAIL: Names clearly don't match, signs of digital editing, expired IDs, completely unreadable`;

        // Build content array with available images
        const contentParts = [{ type: 'text', text: prompt }];
        if (schoolImg) {
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${schoolImg.mime};base64,${schoolImg.base64}` }
            });
        }
        if (govtImg) {
            contentParts.push({
                type: 'image_url',
                image_url: { url: `data:${govtImg.mime};base64,${govtImg.base64}` }
            });
        }

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model:      'llama-3.2-11b-vision-preview',
                messages:   [{ role: 'user', content: contentParts }],
                max_tokens: 1024,
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type':  'application/json'
                },
                timeout: 30000
            }
        );

        const raw     = response.data?.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed  = JSON.parse(cleaned);

        // Clamp confidence
        parsed.confidence = Math.min(100, Math.max(0, parseInt(parsed.confidence) || 50));

        // Ensure valid verdict
        if (!['PASS', 'FLAG', 'FAIL'].includes(parsed.verdict)) parsed.verdict = 'FLAG';

        console.log(`[OSINT] ID analysis for inquiry #${inquiryId}: ${parsed.verdict} (${parsed.confidence}% confidence)`);
        return { ...parsed, skipped: false, analyzedAt: new Date().toISOString() };

    } catch (err) {
        console.error(`[OSINT] ID analysis error for inquiry #${inquiryId}:`, err.message);
        return {
            skipped:  false,
            verdict:  'FLAG',
            reason:   'AI analysis failed â€” manual review required.',
            error:    err.message,
            analyzedAt: new Date().toISOString()
        };
    }
}

module.exports = { runOsintCheck, analyzeIdDocuments };
