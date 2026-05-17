
(() => {
  'use strict';

  const S = {
    users: [],
    config: null,
    holidays: [],
    holidayMap: new Map(),
    schedule: {},
    date: new Date(),
    admin: false,
    lastReport: []
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayOfWeek = s => { const d = parseISO(s).getDay(); return d === 0 ? 7 : d; };
  const monthStart = (y, m) => { const f = new Date(y, m, 1); const offset = (f.getDay() + 6) % 7; return new Date(y, m, 1 - offset); };

  async function sha256(text) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function rangeDays(from, to) {
    const out = [];
    for (let d = parseISO(from); d <= parseISO(to); d.setDate(d.getDate() + 1)) out.push(iso(d));
    return out;
  }

  function isWorkday(day) { return S.config.rules.workdays.includes(dayOfWeek(day)); }
  function holidayType(day) { return S.holidayMap.get(day)?.type || 'standard'; }
  function coverage(day) { return S.config.rules.coverageByDayType[holidayType(day)] || S.config.rules.coverageByDayType.standard; }
  function isUnavailable(user, day) { return (user.timeOff || []).some(x => x.type === 'vacation' && day >= x.start && day <= x.end); }
  function userName(id) { return S.users.find(u => u.id === id)?.name || id; }
  function userRole(id) { return S.users.find(u => u.id === id)?.role || 'standard'; }
  function isUserUnavailable(id, day) { const u = S.users.find(x => x.id === id); return u ? isUnavailable(u, day) : false; }

  function vacationDays(user) {
    let total = 0;
    (user.timeOff || []).filter(x => x.type === 'vacation').forEach(period => {
      rangeDays(period.start, period.end).forEach(day => {
        if (isWorkday(day) && !S.holidayMap.has(day)) total++;
      });
    });
    return total;
  }

  function usersOnVacation(day) { return S.users.filter(u => isUnavailable(u, day)); }

  function downloadJson(fileName, object) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadText(fileName, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadJson(name) {
    const response = await fetch(`data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No carga data/${name}.json (${response.status})`);
    return response.json();
  }

  async function load() {
    const [users, config, shifts, holidays, schedule] = await Promise.all(['users', 'config', 'shifts', 'holidays', 'schedule'].map(loadJson));
    Object.assign(S, { users, config, holidays, schedule, holidayMap: new Map(holidays.map(h => [h.date, h])) });
  }

  function evaluateDay(day) {
    const issues = [];
    if (!isWorkday(day)) return { issues };

    const target = coverage(day);
    const daySchedule = S.schedule[day] || { morning: [], evening: [] };
    const type = holidayType(day);

    if (type === 'global_closed') {
      if ((daySchedule.morning || []).length || (daySchedule.evening || []).length) {
        issues.push({ date: day, message: 'Cierre global con turnos asignados' });
      }
      return { issues };
    }

    const morning = (daySchedule.morning || []).filter(id => !isUserUnavailable(id, day));
    const evening = (daySchedule.evening || []).filter(id => !isUserUnavailable(id, day));

    if (morning.length < target.morning) issues.push({ date: day, message: `Mañana sin cobertura: ${morning.length}/${target.morning}` });
    if (evening.length < target.evening) issues.push({ date: day, message: `Tarde sin cobertura: ${evening.length}/${target.evening}` });

    const duplicated = morning.filter(id => evening.includes(id));
    if (duplicated.length) issues.push({ date: day, message: `En ambos turnos: ${duplicated.map(userName).join(', ')}` });

    const seniorEvening = evening.filter(id => userRole(id) === 'senior').length;
    const standardEvening = evening.filter(id => userRole(id) !== 'senior').length;
    if (target.evening === 2 && evening.length > 0 && (seniorEvening !== 1 || standardEvening !== 1)) {
      issues.push({ date: day, message: 'Tarde debe tener 1 senior + 1 estándar' });
    }

    [...(daySchedule.morning || []), ...(daySchedule.evening || [])].forEach(id => {
      if (isUserUnavailable(id, day)) issues.push({ date: day, message: `${userName(id)} está de vacaciones y asignado` });
    });

    return { issues };
  }

  function evaluateMonth(y, m) {
    let issues = [];
    for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) {
      issues = issues.concat(evaluateDay(iso(d)).issues);
    }
    return { issues };
  }

  function buildReport(y, m) {
    const rows = S.users.map(u => ({ id: u.id, name: u.name, morningHours: 0, eveningHours: 0, holidayHours: 0, totalHours: 0 }));
    const map = new Map(rows.map(r => [r.id, r]));

    for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) {
      const day = iso(d);
      if (!isWorkday(day)) continue;
      const type = holidayType(day);
      const daySchedule = S.schedule[day] || { morning: [], evening: [] };

      for (const id of (daySchedule.morning || [])) {
        const row = map.get(id); if (!row) continue;
        row.morningHours += 9; row.totalHours += 9;
        if (type !== 'standard') row.holidayHours += 9;
      }

      for (const id of (daySchedule.evening || [])) {
        const row = map.get(id); if (!row) continue;
        row.eveningHours += 9; row.totalHours += 9;
        if (type !== 'standard') row.holidayHours += 9;
      }
    }
    return rows;
  }

  function generateMonth(y, m, overwrite) {
    const newSchedule = structuredClone(S.schedule || {});
    let lastPair = new Set();

    for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) {
      const day = iso(d);
      if (!isWorkday(day)) continue;
      if (!overwrite && newSchedule[day] && ((newSchedule[day].morning || []).length || (newSchedule[day].evening || []).length)) continue;

      const target = coverage(day);
      const type = holidayType(day);

      if (type === 'global_closed') {
        newSchedule[day] = { morning: [], evening: [] };
        continue;
      }

      const available = S.users.filter(u => !isUnavailable(u, day));
      const currentReport = buildReport(y, m);
      const score = (id, mode) => {
        const row = currentReport.find(x => x.id === id) || {};
        let s = 0;
        if (mode === 'holiday') s += (row.holidayHours || 0) * 10;
        if (mode === 'evening') s += (row.eveningHours || 0) * 5;
        if (lastPair.has(id)) s += 20;
        return s;
      };

      const seniors = available.filter(u => u.role === 'senior').sort((a, b) => score(a.id, 'evening') - score(b.id, 'evening'));
      const standard = available.filter(u => u.role !== 'senior').sort((a, b) => score(a.id, 'evening') - score(b.id, 'evening'));

      let evening = [];
      if (target.evening >= 2 && seniors.length && standard.length) evening = [seniors[0].id, standard[0].id];
      else evening = available.sort((a, b) => score(a.id, 'evening') - score(b.id, 'evening')).slice(0, target.evening).map(u => u.id);

      lastPair = new Set(evening);

      const rest = available.filter(u => !evening.includes(u.id));
      rest.sort((a, b) => score(a.id, type === 'standard' ? 'morning' : 'holiday') - score(b.id, type === 'standard' ? 'morning' : 'holiday'));

      newSchedule[day] = {
        morning: rest.slice(0, target.morning).map(u => u.id),
        evening
      };
    }

    S.schedule = newSchedule;
  }

  function render() {
    if (!S.config) return;

    $('#appName').textContent = S.config.appName;
    $('#modeBox').textContent = S.admin ? 'Modo administrador' : 'Modo lectura';
    $('#modeBox').className = `mode ${S.admin ? 'admin' : 'readonly'}`;
    $$('.adminOnly').forEach(x => x.classList.toggle('hidden', !S.admin));
    $('#btnUnlock').classList.toggle('hidden', S.admin);

    $('#teamList').innerHTML = S.users.map(u => `
      <div class="person">
        <span>${u.name}</span>
        <span class="pill">${Math.max(0, (u.vacation?.total || 0) - vacationDays(u))}d</span>
      </div>
    `).join('');

    const colors = S.config.colors;
    $('#legend').innerHTML = `
      <div class="legendItem"><span class="swatch" style="background:${colors.global_closed}"></span>Cierre global</div>
      <div class="legendItem"><span class="swatch" style="background:${colors.national}"></span>Festivo nacional</div>
      <div class="legendItem"><span class="swatch" style="background:${colors.regional}"></span>Festivo Comunidad Valenciana</div>
      <div class="legendItem"><span class="swatch" style="background:${colors.local}"></span>Festivo local Alicante</div>
      <div class="legendItem"><span class="swatch" style="background:${colors.vacation}"></span>Vacaciones registradas</div>
    `;

    const r = S.config.rules.coverageByDayType;
    $('#rulesList').innerHTML = `
      <li>Normal ${r.standard.morning}/${r.standard.evening}</li>
      <li>Nacional ${r.national.morning}/${r.national.evening}</li>
      <li>Autonómico/local ${r.regional.morning}/${r.regional.evening}</li>
      <li>Cierre global 0/0</li>
    `;

    renderCalendar();
    const evaluation = evaluateMonth(S.date.getFullYear(), S.date.getMonth());
    $('#qualityBox').textContent = evaluation.issues.length ? `${evaluation.issues.length} incidencias` : 'Sin incidencias';
    $('#alerts').innerHTML = evaluation.issues.slice(0, 10).map(i => `<div class="alert"><b>${i.date}</b> - ${i.message}</div>`).join('');
  }

  function renderCalendar() {
    const y = S.date.getFullYear();
    const m = S.date.getMonth();
    $('#monthTitle').textContent = new Date(y, m, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

    const calendar = $('#calendar');
    calendar.innerHTML = '';
    ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].forEach(d => calendar.insertAdjacentHTML('beforeend', `<div class="dow">${d}</div>`));

    const start = monthStart(y, m);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const day = iso(d);
      const daySchedule = S.schedule[day] || { morning: [], evening: [] };
      const holiday = S.holidayMap.get(day);
      const dayVacations = usersOnVacation(day);
      const evaluation = evaluateDay(day);

      const div = document.createElement('div');
      div.className = `day ${d.getMonth() !== m ? 'out ' : ''}${holidayType(day)} ${dayVacations.length ? 'hasVacation ' : ''}${evaluation.issues.length ? 'issue' : ''}`;
      div.innerHTML = `
        ${evaluation.issues.length ? '<span class="issueDot">!</span>' : ''}
        <div class="daynum">${d.getDate()}</div>
        ${holiday ? `<div class="holiday">${holiday.name}</div>` : ''}
        ${dayVacations.length ? `<div class="vacTag">Vacaciones: ${dayVacations.map(u => u.name).join(', ')}</div>` : ''}
        ${shiftLine('morning', daySchedule.morning)}
        ${shiftLine('evening', daySchedule.evening)}
      `;
      div.onclick = () => openDay(day);
      calendar.appendChild(div);
    }
  }

  function shiftLine(kind, ids = []) {
    return ids.length ? `<div class="shift ${kind === 'evening' ? 'evening' : ''}">${kind === 'morning' ? 'M' : 'T'} | ${ids.map(userName).join(', ')}</div>` : '';
  }

  function openDay(day) {
    $('#dayTitle').textContent = day;
    $('#dayMeta').textContent = `Cobertura objetivo: ${coverage(day).morning} mañana / ${coverage(day).evening} tarde`;
    $('#dayWarnings').innerHTML = evaluateDay(day).issues.map(i => `<div class="warn">${i.message}</div>`).join('');

    const daySchedule = S.schedule[day] || { morning: [], evening: [] };
    fillChecks('#morningChecks', daySchedule.morning);
    fillChecks('#eveningChecks', daySchedule.evening);

    $('#saveDay').onclick = e => {
      e.preventDefault();
      if (!S.admin) return;
      S.schedule[day] = { morning: selected('#morningChecks'), evening: selected('#eveningChecks') };
      $('#dayDialog').close();
      render();
    };

    $('#dayDialog').showModal();
  }

  function fillChecks(container, ids) {
    $(container).innerHTML = S.users.map(u => `
      <label class="check">
        <input type="checkbox" value="${u.id}" ${ids.includes(u.id) ? 'checked' : ''} ${!S.admin ? 'disabled' : ''}>
        ${u.name}
      </label>
    `).join('');
  }

  function selected(container) { return Array.from(document.querySelectorAll(`${container} input:checked`)).map(x => x.value); }

  function openVacations() {
    $('#vacUser').innerHTML = S.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    clearVacationForm();
    renderVacationList();
    $('#vacDialog').showModal();
  }

  function clearVacationForm() {
    $('#vacFrom').value = '';
    $('#vacTo').value = '';
    $('#vacNotes').value = '';
  }

  function renderVacationList() {
    $('#vacList').innerHTML = S.users.map(u => `
      <h4>${u.name}</h4>
      ${(u.timeOff || []).map((v, i) => `
        <div class="person">
          <span>${v.start} → ${v.end}${v.notes ? ' · ' + v.notes : ''}</span>
          <button type="button" data-u="${u.id}" data-i="${i}" class="delVac">Borrar</button>
        </div>
      `).join('') || '<p>Sin vacaciones</p>'}
    `).join('');

    $$('.delVac').forEach(button => {
      button.onclick = () => {
        const user = S.users.find(u => u.id === button.dataset.u);
        user.timeOff.splice(Number(button.dataset.i), 1);
        renderVacationList();
        render();
      };
    });
  }

  function bindEvents() {
    $('#prev').onclick = () => { S.date.setMonth(S.date.getMonth() - 1); render(); };
    $('#next').onclick = () => { S.date.setMonth(S.date.getMonth() + 1); render(); };
    $('#today').onclick = () => { S.date = new Date(); render(); };

    $('#btnUnlock').onclick = () => {
      $('#adminPassword').value = '';
      $('#adminDialog').showModal();
      setTimeout(() => $('#adminPassword').focus(), 0);
    };

    $('#btnLock').onclick = () => {
      S.admin = false;
      $('#adminPassword').value = '';
      render();
    };

    $('#doUnlock').onclick = async e => {
      e.preventDefault();
      const password = $('#adminPassword').value;
      $('#adminPassword').value = '';
      if (await sha256(password) === S.config.adminPasswordHash) {
        S.admin = true;
        $('#adminDialog').close();
        render();
      } else {
        alert('Contraseña incorrecta');
      }
    };

    $('#btnVacations').onclick = openVacations;

    $('#addVacation').onclick = e => {
      e.preventDefault();
      const user = S.users.find(x => x.id === $('#vacUser').value);
      const start = $('#vacFrom').value;
      const end = $('#vacTo').value;
      if (!user || !start || !end || end < start) return alert('Revisa el rango de vacaciones.');

      user.timeOff = user.timeOff || [];
      user.timeOff.push({ type: 'vacation', start, end, notes: $('#vacNotes').value || '' });
      clearVacationForm();
      renderVacationList();
      render();
    };

    $('#btnAuto').onclick = () => $('#autoDialog').showModal();
    $('#openVacFromAuto').onclick = e => { e.preventDefault(); $('#autoDialog').close(); openVacations(); };
    $('#runAuto').onclick = e => { e.preventDefault(); generateMonth(S.date.getFullYear(), S.date.getMonth(), $('#overwriteMonth').checked); $('#autoDialog').close(); render(); };

    $('#btnBulk').onclick = () => {
      $('#bulkUsers').innerHTML = S.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
      $('#bulkDialog').showModal();
    };

    $('#runBulk').onclick = e => {
      e.preventDefault();
      const ids = Array.from($('#bulkUsers').selectedOptions).map(o => o.value);
      const from = $('#bulkFrom').value;
      const to = $('#bulkTo').value;
      const shift = $('#bulkShift').value;
      if (!from || !to || !ids.length) return alert('Completa rango y personas.');
      rangeDays(from, to).forEach(day => {
        S.schedule[day] = S.schedule[day] || { morning: [], evening: [] };
        S.schedule[day][shift] = Array.from(new Set([...(S.schedule[day][shift] || []), ...ids]));
      });
      $('#bulkDialog').close();
      render();
    };

    $('#btnReport').onclick = () => {
      S.lastReport = buildReport(S.date.getFullYear(), S.date.getMonth());
      $('#reportContent').innerHTML = `
        <table class="table">
          <tr><th>Persona</th><th>Mañana</th><th>Tarde</th><th>Festivo</th><th>Total</th></tr>
          ${S.lastReport.map(r => `<tr><td>${r.name}</td><td>${r.morningHours}</td><td>${r.eveningHours}</td><td>${r.holidayHours}</td><td>${r.totalHours}</td></tr>`).join('')}
        </table>
      `;
      $('#reportDialog').showModal();
    };

    $('#downloadReport').onclick = e => {
      e.preventDefault();
      const csv = ['Persona;Mañana;Tarde;Festivo;Total', ...S.lastReport.map(r => `${r.name};${r.morningHours};${r.eveningHours};${r.holidayHours};${r.totalHours}`)].join('\n');
      downloadText('reporte-horas.csv', csv);
    };

    $('#btnExport').onclick = () => {
      downloadJson('schedule.json', S.schedule);
      downloadJson('users.json', S.users);
      downloadJson('holidays.json', S.holidays);
    };

    $('#btnGitHub').onclick = () => $('#githubDialog').showModal();

    $('#runGitHub').onclick = e => {
      e.preventDefault();
      alert('De momento usa Exportar JSON para guardar cambios. No se almacena ningún token en el código.');
    };

    $$('[data-close]').forEach(button => {
      button.onclick = () => {
        const dialog = document.getElementById(button.dataset.close);
        if (dialog?.id === 'adminDialog') $('#adminPassword').value = '';
        dialog?.close();
      };
    });
  }

  function fatal(error) {
    console.error(error);
    $('.main').innerHTML = `
      <div style="margin:24px;padding:16px;background:#fff1f2;border:2px solid #ef3340;border-radius:10px">
        <h2>Error cargando la app</h2>
        <p>${error.message || error}</p>
        <p>Comprueba que existen css, js y data en la raíz publicada.</p>
      </div>
    `;
  }

  load().then(() => { bindEvents(); render(); }).catch(fatal);
})();
