/**
 * public/js/room-quiz.js
 * Room Matching Quiz — multi-step wizard + compatibility algorithm
 */
(function () {
  'use strict';

  // ── Compatibility Algorithm ────────────────────────────────────────────────
  function scoreWakeTime(a, b) {
    const order = ['Before 6 AM','6–8 AM','8–10 AM','After 10 AM'];
    const diff = Math.abs(order.indexOf(a) - order.indexOf(b));
    return diff <= 1 ? 20 : diff === 2 ? 10 : 0;
  }
  function scoreSleepTime(a, b) {
    const order = ['Before 10 PM','10 PM–12 AM','12–2 AM','After 2 AM'];
    const diff = Math.abs(order.indexOf(a) - order.indexOf(b));
    return diff <= 1 ? 20 : diff === 2 ? 10 : 0;
  }
  function scoreSchedule(a, b) { return a === b ? 10 : 0; }
  function scoreStudyHours(a, b) {
    const order = ['Less than 1 hour','1–3 hours','3–5 hours','More than 5 hours'];
    return Math.abs(order.indexOf(a) - order.indexOf(b)) <= 1 ? 10 : 5;
  }
  function scoreCleanliness(a, b) { return Math.abs(a - b) <= 1 ? 10 : 5; }
  function scoreNoise(a, b) {
    const diff = Math.abs(a - b);
    if (diff === 0) return 10;
    if (diff <= 1) return 7;
    if (diff >= 3) return -10;
    return 3;
  }
  function scoreGuests(a, b) {
    const order = ['Never','Rarely','Sometimes','Often'];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return Math.abs(ai - bi) <= 1 ? 10 : 5;
  }
  function scorePersonality(a, b) { return a === b ? 10 : 5; }
  function scoreInteraction(a, b) {
    const order = ['Keep to myself','Casual interaction','Very social'];
    return Math.abs(order.indexOf(a) - order.indexOf(b)) <= 1 ? 10 : 5;
  }

  function computeCompatibilityScore(a, b) {
    let schedule = 0, lifestyle = 0, personality = 0, prefs = 0, bonus = 0;
    schedule += scoreWakeTime(a.wake_time, b.wake_time);
    schedule += scoreSchedule(a.class_schedule, b.class_schedule);
    schedule += scoreStudyHours(a.study_hours, b.study_hours);
    lifestyle += scoreCleanliness(a.cleanliness, b.cleanliness);
    lifestyle += scoreNoise(a.noise_tolerance, b.noise_tolerance);
    lifestyle += scoreGuests(a.guest_frequency, b.guest_frequency);
    personality += scorePersonality(a.personality, b.personality);
    personality += scoreInteraction(a.interaction_level, b.interaction_level);
    prefs += a.room_preference === b.room_preference ? 3 : 0;
    prefs += a.lights_sleep === b.lights_sleep ? 3 : 0;
    prefs += a.sharing_ok === b.sharing_ok ? 4 : 0;
    bonus += a.class_schedule === b.class_schedule ? 5 : 0;
    bonus += a.school_location && b.school_location &&
             a.school_location.toLowerCase() === b.school_location.toLowerCase() ? 5 : 0;
    const raw = (schedule * 0.4) + (lifestyle * 0.3) + (personality * 0.2) + (prefs * 0.1) + bonus;
    return Math.min(100, Math.max(0, Math.round(raw)));
  }

  // ── Quiz Questions Definition ──────────────────────────────────────────────
  const STEPS = [
    {
      id: 'schedule', title: 'Schedule', icon: '🕐',
      fields: [
        { key: 'wake_time', label: 'What time do you usually wake up?', type: 'radio',
          options: ['Before 6 AM','6–8 AM','8–10 AM','After 10 AM'] },
        { key: 'sleep_time', label: 'What time do you usually sleep?', type: 'radio',
          options: ['Before 10 PM','10 PM–12 AM','12–2 AM','After 2 AM'] },
        { key: 'class_schedule', label: 'When are most of your classes?', type: 'radio',
          options: ['Morning','Afternoon','Evening','Mixed schedule'] },
        { key: 'study_hours', label: 'How many hours do you study daily?', type: 'radio',
          options: ['Less than 1 hour','1–3 hours','3–5 hours','More than 5 hours'] },
        { key: 'study_in_room', label: 'Do you study in your room?', type: 'radio',
          options: ['Yes','No'] }
      ]
    },
    {
      id: 'lifestyle', title: 'Lifestyle', icon: '🏠',
      fields: [
        { key: 'cleanliness', label: 'Cleanliness level', type: 'slider', min: 1, max: 5,
          hint: '1 = messy · 5 = very clean' },
        { key: 'noise_tolerance', label: 'Noise tolerance', type: 'slider', min: 1, max: 5,
          hint: '1 = needs silence · 5 = okay with noise' },
        { key: 'plays_music', label: 'Do you play music often?', type: 'radio',
          options: ['Yes','No'] },
        { key: 'music_time', label: 'If yes, when?', type: 'radio',
          options: ['Morning','Afternoon','Night','Anytime'], conditional: 'plays_music:Yes' },
        { key: 'guest_frequency', label: 'How often do you invite friends over?', type: 'radio',
          options: ['Never','Rarely','Sometimes','Often'] },
        { key: 'guest_tolerance', label: 'Are you okay with roommates inviting guests?', type: 'radio',
          options: ['Yes','No'] }
      ]
    },
    {
      id: 'personality', title: 'Personality', icon: '🌟',
      fields: [
        { key: 'personality', label: 'Personality type', type: 'radio',
          options: ['Introvert','Ambivert','Extrovert'] },
        { key: 'interaction_level', label: 'Preferred interaction with roommates', type: 'radio',
          options: ['Keep to myself','Casual interaction','Very social'] }
      ]
    },
    {
      id: 'preferences', title: 'Preferences', icon: '⚙️',
      fields: [
        { key: 'room_preference', label: 'Do you prefer:', type: 'radio',
          options: ['Aircon','Fan','Either'] },
        { key: 'lights_sleep', label: 'Lights when sleeping', type: 'radio',
          options: ['Lights off','Dim light','Lights on'] },
        { key: 'sharing_ok', label: 'Are you okay sharing space/items?', type: 'radio',
          options: ['Yes','No'] },
        { key: 'course', label: 'Course / Program', type: 'text', placeholder: 'e.g. BSIT' },
        { key: 'school_location', label: 'School location', type: 'text', placeholder: 'e.g. Calamba' },
        { key: 'work_from_home', label: 'Do you work from home?', type: 'radio', options: ['Yes','No'] },
        { key: 'notes', label: 'Any special preferences or habits?', type: 'textarea',
          placeholder: 'e.g. Prefers quiet roommates…', optional: true }
      ]
    }
  ];

  let currentStep = 0;
  let answers = {};
  let quizVisible = false;

  // ── DOM Helpers ─────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function isDormUnit(selectEl) {
    if (!selectEl) return false;
    const opt = selectEl.options[selectEl.selectedIndex];
    if (!opt || !opt.value) return false;
    // Check data-type attribute (set by dynamic room loader)
    if (opt.dataset.type === 'dorm') return true;
    const txt = (opt.text || '').toLowerCase();
    const val = (opt.value || '').toLowerCase();
    return txt.includes('dorm') || val.includes('dorm') || val === 'bed_spacer';
  }

  // ── Render one step ─────────────────────────────────────────────────────────
  function renderStep() {
    const step = STEPS[currentStep];
    const container = el('rq-fields');
    if (!container) return;
    container.innerHTML = '';

    step.fields.forEach(f => {
      // conditional visibility check
      if (f.conditional) {
        const [ck, cv] = f.conditional.split(':');
        if (answers[ck] !== cv) return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'rq-field';

      const lbl = document.createElement('div');
      lbl.className = 'rq-label';
      lbl.textContent = f.label + (f.optional ? ' (Optional)' : '');
      wrap.appendChild(lbl);

      if (f.hint) {
        const hint = document.createElement('div');
        hint.className = 'rq-hint';
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }

      if (f.type === 'radio') {
        const opts = document.createElement('div');
        opts.className = 'rq-options';
        f.options.forEach(opt => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'rq-opt' + (answers[f.key] === opt ? ' selected' : '');
          btn.textContent = opt;
          btn.onclick = () => {
            answers[f.key] = opt;
            // re-render to handle conditionals
            renderStep();
          };
          opts.appendChild(btn);
        });
        wrap.appendChild(opts);
      } else if (f.type === 'slider') {
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'rq-slider-wrap';
        const val = answers[f.key] || f.min;
        sliderWrap.innerHTML = `
          <div class="rq-slider-labels"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
          <div class="rq-slider-track">
            ${[1,2,3,4,5].map(n => `
              <button type="button" class="rq-dot${val === n ? ' active' : ''}" data-v="${n}">${n}</button>
            `).join('')}
          </div>`;
        sliderWrap.querySelectorAll('.rq-dot').forEach(dot => {
          dot.onclick = () => {
            answers[f.key] = parseInt(dot.dataset.v);
            renderStep();
          };
        });
        wrap.appendChild(sliderWrap);
      } else if (f.type === 'text') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'rq-input';
        inp.placeholder = f.placeholder || '';
        inp.value = answers[f.key] || '';
        inp.oninput = () => { answers[f.key] = inp.value; };
        wrap.appendChild(inp);
      } else if (f.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'rq-input rq-textarea';
        ta.placeholder = f.placeholder || '';
        ta.rows = 3;
        ta.value = answers[f.key] || '';
        ta.oninput = () => { answers[f.key] = ta.value; };
        wrap.appendChild(ta);
      }

      container.appendChild(wrap);
    });

    // Progress
    const pct = Math.round(((currentStep + 1) / STEPS.length) * 100);
    const bar = el('rq-progress-bar');
    if (bar) bar.style.width = pct + '%';
    const pctEl = el('rq-progress-pct');
    if (pctEl) pctEl.textContent = pct + '%';

    // Step title
    const titleEl = el('rq-step-title');
    if (titleEl) titleEl.textContent = step.icon + ' ' + step.title;

    // Nav
    const prevBtn = el('rq-prev');
    const nextBtn = el('rq-next');
    if (prevBtn) prevBtn.style.display = currentStep > 0 ? '' : 'none';
    if (nextBtn) nextBtn.textContent = currentStep === STEPS.length - 1 ? 'See My Profile →' : 'Next →';

    // Step tabs
    document.querySelectorAll('.rq-tab').forEach((t, i) => {
      t.classList.toggle('active', i === currentStep);
      t.classList.toggle('done', i < currentStep);
    });
  }

  function validateStep() {
    const step = STEPS[currentStep];
    for (const f of step.fields) {
      if (f.optional) continue;
      if (f.conditional) {
        const [ck, cv] = f.conditional.split(':');
        if (answers[ck] !== cv) continue;
      }
      if (f.type === 'radio' && !answers[f.key]) {
        showQuizToast('Please answer: ' + f.label);
        return false;
      }
    }
    return true;
  }

  function showQuizToast(msg) {
    let t = el('rq-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rq-toast';
      t.className = 'rq-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), 3000);
  }

  // ── Dorm Room Profiles ─────────────────────────────────────────────────────
  // Characteristic lifestyle profile for each dorm room type.
  // Keys map to room_number patterns fetched from the API.
  // These represent the "typical environment" of that dorm.
  const DORM_PROFILES = {
    'A1': {
      label: 'Dorm A1',
      tagline: 'Quiet Study Haven · Air-Conditioned',
      emoji: '🌙',
      description: 'Best for focused students who prefer a quiet, orderly environment with air conditioning.',
      wake_time: '6–8 AM',
      sleep_time: '10 PM–12 AM',
      class_schedule: 'Morning',
      study_hours: '3–5 hours',
      study_in_room: true,
      cleanliness: 5,
      noise_tolerance: 2,
      plays_music: false,
      music_time: null,
      guest_frequency: 'Never',
      guest_tolerance: false,
      personality: 'Introvert',
      interaction_level: 'Keep to myself',
      room_preference: 'Aircon',
      lights_sleep: 'Lights off',
      sharing_ok: false,
      school_location: null,
      work_from_home: false
    },
    'A2': {
      label: 'Dorm A2',
      tagline: 'Social & Lively · Fan-Cooled',
      emoji: '☀️',
      description: 'Best for outgoing students who enjoy a social atmosphere and casual shared living.',
      wake_time: '8–10 AM',
      sleep_time: '12–2 AM',
      class_schedule: 'Afternoon',
      study_hours: '1–3 hours',
      study_in_room: false,
      cleanliness: 3,
      noise_tolerance: 4,
      plays_music: true,
      music_time: 'Anytime',
      guest_frequency: 'Sometimes',
      guest_tolerance: true,
      personality: 'Extrovert',
      interaction_level: 'Very social',
      room_preference: 'Fan',
      lights_sleep: 'Dim light',
      sharing_ok: true,
      school_location: null,
      work_from_home: false
    }
  };
  // Aliases for different DB naming conventions (DormA1, dorma1, etc.)
  DORM_PROFILES['DORMA1'] = DORM_PROFILES['A1'];
  DORM_PROFILES['DORMA2'] = DORM_PROFILES['A2'];

  // Fallback profile for any extra dorms not explicitly listed above
  function getFallbackProfile(roomNumber) {
    return {
      label: `Dorm ${roomNumber}`,
      tagline: 'Comfortable Shared Dorm',
      emoji: '🏠',
      description: 'A balanced dorm room suitable for most students.',
      wake_time: '6–8 AM', sleep_time: '10 PM–12 AM', class_schedule: 'Morning',
      study_hours: '1–3 hours', cleanliness: 3, noise_tolerance: 3,
      guest_frequency: 'Rarely', personality: 'Ambivert', interaction_level: 'Casual interaction',
      room_preference: 'Either', lights_sleep: 'Dim light', sharing_ok: true
    };
  }

  // ── Summary Card ──────────────────────────────────────────────────────────
  function getPersonalityEmoji(p) {
    if (p === 'Introvert') return '🌙';
    if (p === 'Extrovert') return '☀️';
    return '⚖️';
  }

  function getMatchLabel(score) {
    if (score >= 80) return { label: 'Excellent Match', color: '#27ae60' };
    if (score >= 60) return { label: 'Good Match',      color: '#c5a059' };
    if (score >= 40) return { label: 'Fair Match',      color: '#e67e22' };
    return               { label: 'Low Match',          color: '#e74c3c' };
  }

  async function renderSummary() {
    const a = answers;
    const pEmoji = getPersonalityEmoji(a.personality);
    const noiseLabel = a.noise_tolerance <= 2 ? 'Quiet' : a.noise_tolerance >= 4 ? 'Lively' : 'Balanced';
    const cleanLabel = a.cleanliness >= 4 ? 'Very Tidy' : a.cleanliness <= 2 ? 'Relaxed' : 'Moderate';
    const card = el('rq-summary');
    if (!card) return;

    const userProfile = normalizeAnswers(a);

    // ── 1. Fetch live dorm rooms from API ──────────────────────────────────
    let dormRooms = [];
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const all = await res.json();
        dormRooms = (all || []).filter(r => {
          const t = (r.room_type || '').toLowerCase();
          const n = (r.room_number || '').toLowerCase();
          return t.includes('dorm') || n.startsWith('a');
        });
      }
    } catch (_) { /* fall through to defaults */ }

    // If API returns nothing, use default profile keys as placeholders
    if (!dormRooms.length) {
      dormRooms = Object.keys(DORM_PROFILES).map((k, i) => ({ id: null, room_number: k, monthly_rate: 0 }));
    }

    // ── 2. Score each dorm against user profile ────────────────────────────
    const scored = dormRooms.map(room => {
      // Normalize key: "DormA1" → "A1", "dorm a2" → "A2", "A1" → "A1"
      const raw = room.room_number.toUpperCase().trim();
      const key = raw.replace(/^DORM\s*/i, '');          // strip leading "DORM"
      const profile = DORM_PROFILES[key] || DORM_PROFILES[raw] || getFallbackProfile(room.room_number);
      const score = computeCompatibilityScore(userProfile, profile);
      return { room, profile, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const rest = scored.slice(1);

    // ── 3. Write hidden fields ─────────────────────────────────────────────
    const hjson = el('rq-hidden-json');
    if (hjson) hjson.value = JSON.stringify({ ...userProfile, recommended_room: best?.room?.room_number || null });
    const hscore = el('rq-hidden-score');
    if (hscore) hscore.value = best?.score ?? 0;

    // ── 4. Render card ─────────────────────────────────────────────────────
    const matchInfo = getMatchLabel(best?.score ?? 0);
    const matchPct  = best?.score ?? 0;
    const circumference = 2 * Math.PI * 28; // radius 28
    const dashOffset = circumference - (matchPct / 100) * circumference;

    card.innerHTML = `
      <!-- Profile header -->
      <div class="rq-sum-header">
        <span class="rq-sum-emoji">${pEmoji}</span>
        <div>
          <div class="rq-sum-name">${a.personality || 'Student'} · ${noiseLabel} · ${cleanLabel}</div>
          <div class="rq-sum-sub">Your Roommate Profile</div>
        </div>
      </div>

      <!-- Attribute grid -->
      <div class="rq-sum-grid">
        <div class="rq-sum-item"><span>🕐 Wake</span><b>${a.wake_time||'–'}</b></div>
        <div class="rq-sum-item"><span>🌙 Sleep</span><b>${a.sleep_time||'–'}</b></div>
        <div class="rq-sum-item"><span>📚 Classes</span><b>${a.class_schedule||'–'}</b></div>
        <div class="rq-sum-item"><span>📖 Study</span><b>${a.study_hours||'–'}</b></div>
        <div class="rq-sum-item"><span>🎵 Music</span><b>${a.plays_music==='Yes' ? (a.music_time||'Yes') : 'No'}</b></div>
        <div class="rq-sum-item"><span>👥 Guests</span><b>${a.guest_frequency||'–'}</b></div>
        <div class="rq-sum-item"><span>❄️ Room</span><b>${a.room_preference||'–'}</b></div>
        <div class="rq-sum-item"><span>💡 Lights</span><b>${a.lights_sleep||'–'}</b></div>
      </div>
      ${a.course ? `<div class="rq-sum-course">🎓 ${a.course}${a.school_location ? ' · ' + a.school_location : ''}</div>` : ''}

      <!-- Recommendation divider -->
      <div class="rq-rec-divider">
        <span>✦ Room Recommendation</span>
      </div>

      <!-- Best match card -->
      ${best ? `
      <div class="rq-rec-card">
        <div class="rq-rec-left">
          <div class="rq-rec-emoji">${best.profile.emoji}</div>
          <div>
            <div class="rq-rec-label">${best.profile.label}</div>
            <div class="rq-rec-tagline">${best.profile.tagline}</div>
            <div class="rq-rec-desc">${best.profile.description}</div>
          </div>
        </div>
        <div class="rq-rec-right">
          <svg class="rq-rec-ring" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5"/>
            <circle cx="32" cy="32" r="28" fill="none" stroke="${matchInfo.color}"
              stroke-width="5" stroke-linecap="round"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${dashOffset.toFixed(1)}"
              transform="rotate(-90 32 32)"/>
            <text x="32" y="35" text-anchor="middle" fill="${matchInfo.color}"
              font-size="11" font-weight="700" font-family="Poppins,sans-serif">${matchPct}%</text>
          </svg>
          <div class="rq-rec-match-label" style="color:${matchInfo.color}">${matchInfo.label}</div>
        </div>
      </div>
      ${best.room.id ? `
      <a href="/unit.html?roomId=${best.room.id}" class="rq-rec-cta">
        View ${best.profile.label} <i class="fas fa-arrow-right" style="margin-left:6px"></i>
      </a>` : ''}

      <!-- Other options -->
      ${rest.length ? `
      <div class="rq-rec-others">
        <div class="rq-rec-others-label">Other options</div>
        ${rest.map(s => {
          const mi = getMatchLabel(s.score);
          return `<div class="rq-rec-other-item">
            <span>${s.profile.emoji} ${s.profile.label}</span>
            <span style="color:${mi.color};font-weight:600">${s.score}% — ${mi.label}</span>
          </div>`;
        }).join('')}
      </div>` : ''}
      ` : '<div class="rq-rec-desc" style="text-align:center;padding:16px">No dorm rooms available at the moment.</div>'}
    `;
    card.style.display = 'block';
  }

  function normalizeAnswers(a) {
    return {
      wake_time:         a.wake_time       || null,
      sleep_time:        a.sleep_time      || null,
      class_schedule:    a.class_schedule  || null,
      study_hours:       a.study_hours     || null,
      study_in_room:     a.study_in_room === 'Yes',
      cleanliness:       a.cleanliness     || null,
      noise_tolerance:   a.noise_tolerance || null,
      plays_music:       a.plays_music === 'Yes',
      music_time:        a.music_time      || null,
      guest_frequency:   a.guest_frequency || null,
      guest_tolerance:   a.guest_tolerance === 'Yes',
      personality:       a.personality     || null,
      interaction_level: a.interaction_level || null,
      room_preference:   a.room_preference || null,
      lights_sleep:      a.lights_sleep    || null,
      sharing_ok:        a.sharing_ok === 'Yes',
      course:            a.course          || null,
      school_location:   a.school_location || null,
      work_from_home:    a.work_from_home === 'Yes',
      notes:             a.notes           || null
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function showRoomMatchingQuiz() {
    const quiz = el('room-matching-quiz');
    if (!quiz || quizVisible) return;
    quizVisible = true;
    currentStep = 0;
    answers = {};
    quiz.style.maxHeight = '0';
    quiz.style.opacity   = '0';
    quiz.style.display   = 'block';
    quiz.style.overflow  = 'hidden';
    quiz.style.transition = 'max-height 0.5s ease, opacity 0.4s ease';
    requestAnimationFrame(() => {
      quiz.style.maxHeight = '3000px';
      quiz.style.opacity   = '1';
      // After animation, allow overflow so nothing is clipped
      setTimeout(() => { quiz.style.overflow = 'visible'; }, 520);
    });
    el('rq-summary').style.display = 'none';
    el('rq-nav').style.display = '';
    el('rq-fields').style.display = '';
    renderStep();
  }

  function hideRoomMatchingQuiz() {
    const quiz = el('room-matching-quiz');
    if (!quiz || !quizVisible) return;
    quizVisible = false;
    quiz.style.overflow  = 'hidden';
    quiz.style.maxHeight = '0';
    quiz.style.opacity   = '0';
    setTimeout(() => { quiz.style.display = 'none'; }, 500);
    // clear hidden fields
    const hjson = el('rq-hidden-json');
    if (hjson) hjson.value = '';
    const hscore = el('rq-hidden-score');
    if (hscore) hscore.value = '';
  }

  function nextStep() {
    if (currentStep < STEPS.length - 1) {
      if (!validateStep()) return;
      currentStep++;
      renderStep();
    } else {
      if (!validateStep()) return;
      // Show summary
      el('rq-fields').style.display = 'none';
      el('rq-nav').style.display = 'none';
      const pw = document.querySelector('.rq-progress-wrap');
      if (pw) pw.style.display = 'none';
      const tabs = document.querySelector('.rq-tabs');
      if (tabs) tabs.style.display = 'none';
      renderSummary();
    }
  }

  function prevStep() {
    if (el('rq-summary').style.display !== 'none') {
      el('rq-summary').style.display = 'none';
      el('rq-fields').style.display = '';
      el('rq-nav').style.display = '';
      const pw2 = document.querySelector('.rq-progress-wrap');
      if (pw2) pw2.style.display = '';
      const tabs2 = document.querySelector('.rq-tabs');
      if (tabs2) tabs2.style.display = '';
      renderStep();
      return;
    }
    if (currentStep > 0) {
      currentStep--;
      renderStep();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    const unitSel = el('unitPref');
    if (!unitSel) return;

    unitSel.addEventListener('change', () => {
      if (isDormUnit(unitSel)) showRoomMatchingQuiz();
      else hideRoomMatchingQuiz();
    });

    const prevBtn = el('rq-prev');
    const nextBtn = el('rq-next');
    if (prevBtn) prevBtn.addEventListener('click', prevStep);
    if (nextBtn) nextBtn.addEventListener('click', nextStep);
  }

  document.addEventListener('DOMContentLoaded', init);

  // Expose for external use
  window.RoomQuiz = { computeCompatibilityScore, showRoomMatchingQuiz, hideRoomMatchingQuiz };
})();
