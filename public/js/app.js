let patients = [];
let activeId = null, editingPatient = null;
let editingStudy = null;
let studiesLoading = false;
let studyLoadError = '';
let patientSearchTimer = null;
let patientListRequestId = 0;
let selectedPatient = null;
let patientListError = '';
let currentUserRoles = [];
const $ = s => document.querySelector(s);
const authScreen = $('#authScreen');
const appShell = $('#appShell');
const loginForm = $('#loginForm');
const loginError = $('#loginError');
const safe = value => String(value || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function showLogin(message = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  $('#authLoading').hidden = true;
  loginForm.hidden = false;
  loginError.textContent = message;
  loginError.hidden = !message;
  loginForm.elements.username.focus();
}

async function getCurrentUser() {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('AUTH_CHECK_FAILED');
  const result = await response.json();
  return result.user || null;
}

async function showApplication(user) {
  authScreen.hidden = true;
  appShell.hidden = false;
  $('#currentUser').textContent = user.displayName || user.username;
  currentUserRoles = Array.isArray(user.roles) ? user.roles : [];
  render();
  await loadPatients();
}

async function initializeAuthentication() {
  try {
    const user = await getCurrentUser();
    if (user) await showApplication(user);
    else showLogin();
  } catch {
    showLogin('No se pudo verificar la sesión. Compruebe que el servidor esté disponible e inténtelo nuevamente.');
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;

  const submitButton = $('#loginButton');
  const username = loginForm.elements.username.value.trim();
  const password = loginForm.elements.password.value;
  const requestBody = JSON.stringify({ username, password });
  loginForm.elements.password.value = '';
  loginError.textContent = '';
  loginError.hidden = true;
  submitButton.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: requestBody,
    });
    if (response.status === 401) {
      showLogin('Usuario o contraseña incorrectos.');
      return;
    }
    if (response.status === 429) {
      showLogin('Se alcanzó el límite temporal de intentos. Espere antes de volver a intentar.');
      return;
    }
    if (!response.ok) {
      showLogin('No se pudo iniciar sesión. Compruebe los datos e inténtelo nuevamente.');
      return;
    }

    const user = await getCurrentUser();
    if (!user) {
      showLogin('No se pudo confirmar la sesión. Inténtelo nuevamente.');
      return;
    }
    loginForm.reset();
    await showApplication(user);
  } catch {
    showLogin('No se pudo conectar con el servicio de autenticación. Inténtelo nuevamente.');
  } finally {
    submitButton.disabled = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  const button = $('#logoutButton');
  button.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 204) {
      loginForm.reset();
      showLogin();
    } else if (response.status === 503) {
      loginForm.reset();
      showLogin('La sesión local se cerró, pero el servidor no pudo confirmar la operación.');
    } else {
      window.alert('No se pudo cerrar la sesión. Inténtelo nuevamente.');
    }
  } catch {
    // Keep the authenticated view visible because the server may not have received the logout.
    window.alert('No se pudo conectar con el servidor para cerrar la sesión. Inténtelo nuevamente.');
  } finally {
    button.disabled = false;
  }
});

async function apiRequest(url, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error('API_REQUEST_FAILED');
    error.status = response.status;
    error.code = result?.error?.code || '';
    error.messageFromApi = result?.error?.message || '';
    throw error;
  }
  return result;
}

function patientApiMessage(error, action, data = null) {
  if (error.code === 'CONFLICT' && data?.dni) return 'Ya existe un paciente registrado con ese DNI.';
  if (error.code === 'VERSION_CONFLICT') return 'El paciente fue modificado por otra persona. Cierre y vuelva a abrir la ficha antes de guardar.';
  if (error.code === 'SERVICE_SCOPE_PENDING' || error.code === 'FORBIDDEN') return 'Su cuenta todavía no tiene habilitado el acceso al módulo de pacientes.';
  if (error.code === 'INVALID_PATIENT') return error.messageFromApi || 'Revise los datos ingresados.';
  if (error.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  return action;
}

function studyApiMessage(error, action) {
  if (error.code === 'VERSION_CONFLICT') return 'El estudio fue modificado por otra persona. Recargue el estudio antes de guardar.';
  if (error.code === 'GENERAL_SERVICE_NOT_CONFIGURED') return error.messageFromApi || 'El servicio general todavía no está configurado.';
  if (error.code === 'FORBIDDEN') return 'Su cuenta no tiene permiso para realizar esta operación con estudios.';
  if (error.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  return action;
}

async function loadPatients(search = '') {
  const requestId = ++patientListRequestId;
  patientListError = '';
  try {
    const pageSize = 100;
    const data = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const result = await apiRequest(`/api/pacientes?${params}`);
      if (!Array.isArray(result?.data)) throw new Error('INVALID_API_RESPONSE');
      data.push(...result.data.map(item => ({ ...item, id: String(item.id) })));
      if (result.data.length < pageSize) break;
      page += 1;
    }
    if (requestId !== patientListRequestId) return;
    patients = data;
  } catch (error) {
    if (requestId !== patientListRequestId) return;
    patients = [];
    patientListError = patientApiMessage(error, 'No se pudo cargar la lista de pacientes.');
  }
  renderPatients();
}

async function loadPatient(id) {
  const requestedId = String(id);
  activeId = requestedId;
  selectedPatient = null;
  render();
  try {
    const result = await apiRequest(`/api/pacientes/${encodeURIComponent(requestedId)}`);
    if (activeId !== requestedId) return;
    const data = result?.data;
    if (!data || String(data.id) !== requestedId) throw new Error('INVALID_API_RESPONSE');
    selectedPatient = {
      ...data,
      id: requestedId,
      studies: [],
    };
    await loadStudies(requestedId);
  } catch (error) {
    if (activeId !== requestedId) return;
    activeId = null;
    selectedPatient = null;
    window.alert(patientApiMessage(error, 'No se pudo consultar el paciente.'));
  }
  render();
}

async function loadStudies(patientId) {
  const requestedId = String(patientId);
  studiesLoading = true;
  studyLoadError = '';
  render();
  try {
    const result = await apiRequest(`/api/pacientes/${encodeURIComponent(requestedId)}/estudios`);
    if (!Array.isArray(result?.data)) throw new Error('INVALID_API_RESPONSE');
    if (activeId !== requestedId || String(selectedPatient?.id) !== requestedId) return;
    selectedPatient.studies = result.data.map(study => ({
      ...study,
      id: String(study.id),
      patientId: String(study.patientId),
      serviceId: String(study.serviceId),
    }));
  } catch (error) {
    if (activeId !== requestedId || String(selectedPatient?.id) !== requestedId) return;
    selectedPatient.studies = [];
    studyLoadError = studyApiMessage(error, 'No se pudieron cargar los estudios.');
  } finally {
    if (activeId === requestedId && String(selectedPatient?.id) === requestedId) {
      studiesLoading = false;
      render();
    }
  }
}

function patient() { return selectedPatient; }
function age(birthDate) { if (!birthDate) return ''; const d = new Date(birthDate), n = new Date(); let a=n.getFullYear()-d.getFullYear(); if (n < new Date(n.getFullYear(),d.getMonth(),d.getDate())) a--; return `${a} años`; }
function renderPatients() {
  const term = $('#patientSearch').value.trim().toLowerCase();
  const items = patients.filter(p => `${p.fullName} ${p.dni || ''}`.toLowerCase().includes(term));
  $('#patientCount').textContent = patients.length;
  $('#patientList').innerHTML = patientListError
    ? `<p class="empty-small">${safe(patientListError)}</p>`
    : items.length ? items.map(p => `<button class="patient-item ${String(p.id)===activeId?'selected':''}" data-id="${safe(p.id)}"><b>${safe(p.fullName)}</b><small>DNI ${safe(p.dni || 'sin registrar')}</small></button>`).join('')
      : '<p class="empty-small">Sin pacientes.</p>';
  document.querySelectorAll('.patient-item').forEach(button => button.onclick = () => loadPatient(button.dataset.id));
}
function render() {
  renderPatients(); const p = patient();
  $('#emptyState').hidden = !!p; $('#recordView').hidden = !p;
  if (!p) {
    $('#emptyState h2').textContent = activeId ? 'Cargando paciente…' : 'Seleccione un paciente';
    $('#emptyState p').textContent = activeId ? 'Consultando la ficha en el servidor.' : 'O cree una nueva ficha para registrar datos, estudios e imágenes.';
    return;
  }
  $('#patientName').textContent = p.fullName;
  $('#patientMeta').textContent = [p.dni && `DNI ${p.dni}`, age(p.birthDate), p.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto';
  $('#studyCount').textContent = p.studies.length;
  $('#summaryPanel').innerHTML = `<div class="summary-grid"><article class="card"><h3>Datos personales</h3><p><b>DNI:</b> ${safe(p.dni || '—')}\n<b>Fecha de nacimiento:</b> ${safe(p.birthDate || '—')}\n<b>Teléfono:</b> ${safe(p.phone || '—')}\n<b>Dirección:</b> ${safe(p.address || '—')}</p></article><article class="card"><h3>Antecedentes y observaciones</h3><p>${safe(p.notes || 'No se registraron observaciones.')}</p></article></div><article class="card" style="margin-top:16px"><h3>Actividad reciente</h3><p>${p.studies.length ? `Último estudio: <b>${safe(p.studies.slice().sort((a,b)=>b.date.localeCompare(a.date))[0].type)}</b>` : 'Todavía no hay estudios cargados.'}</p></article>`;
  $('#studyList').innerHTML = studiesLoading
    ? '<div class="empty-small">Consultando estudios en el servidor…</div>'
    : studyLoadError
      ? `<p class="empty-small">${safe(studyLoadError)}</p>`
      : p.studies.length
        ? p.studies.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(s => `<article class="study-card"><div class="study-top"><span class="badge">${safe(s.type)}</span><small>${safe(s.date)}</small></div><h4>${safe(s.diagnosis || s.procedure || 'Estudio sin título')}</h4><p><b>Profesional:</b> ${safe(s.professional || '—')}<br><b>Procedimiento:</b> ${safe(s.procedure || '—')}</p>${s.description ? `<p><b>Descripción:</b> ${safe(s.description)}</p>`:''}${s.conclusions ? `<p><b>Conclusiones:</b> ${safe(s.conclusions)}</p>`:''}<div class="study-actions"><button class="secondary mini" data-edit-study="${safe(s.id)}">Abrir / editar</button></div><section class="document-panel"><div class="document-heading"><b>Archivos</b>${currentUserRoles.includes('administrador') ? `<button type="button" class="secondary mini" data-upload-document="${safe(s.id)}">Cargar archivo</button><input hidden type="file" data-document-input="${safe(s.id)}" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.dcm,application/pdf,image/jpeg,image/png,image/gif,image/webp,application/dicom">` : ''}</div><div data-document-list="${safe(s.id)}" class="document-list">Cargando archivos…</div></section></article>`).join('')
        : '<div class="empty-small">No hay estudios registrados.</div>';
  bindDynamic();
}
function bindDynamic() {
  document.querySelectorAll('[data-edit-study]').forEach(button => {
    button.onclick = () => openStudyEditor(button.dataset.editStudy);
  });
  document.querySelectorAll('[data-document-list]').forEach(container => {
    loadDocuments(container.dataset.documentList, container);
  });
  document.querySelectorAll('[data-upload-document]').forEach(button => {
    button.onclick = () => document.querySelector('[data-document-input="' + CSS.escape(button.dataset.uploadDocument) + '"]')?.click();
  });
  document.querySelectorAll('[data-document-input]').forEach(input => {
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const button = input.parentElement.querySelector('[data-upload-document]');
      if (button) button.disabled = true;
      try {
        const created = await uploadStudyDocument(input.dataset.documentInput, file);
        const listed = await refreshDocuments(input.dataset.documentInput);
        if (!listed) {
          window.alert('El servidor aceptó la carga, pero no se pudo verificar el listado. Actualice la ficha y compruebe el archivo antes de volver a cargarlo.');
        } else if (!listed.some(document => String(document.id) === String(created.id))) {
          window.alert('El servidor respondió a la carga, pero el archivo no aparece en el listado. No vuelva a cargarlo hasta verificar el estado.');
        } else {
          window.alert('Archivo guardado y verificado: ' + file.name);
        }
      } catch (error) {
        window.alert(documentApiMessage(error, 'No se pudo guardar el archivo.'));
      } finally {
        input.value = '';
        if (button) button.disabled = false;
      }
    };
  });
  document.querySelectorAll('.gallery img').forEach(image => {
    image.onclick = () => {
      const modal = document.createElement('div');
      modal.className = 'image-modal';
      modal.innerHTML = '<img src="' + image.src + '" alt="Imagen clínica">';
      modal.onclick = () => modal.remove();
      document.body.append(modal);
    };
  });
}
async function uploadStudyDocument(studyId, file) {
  const body = new FormData();
  body.append('file', file, file.name);
  const result = await apiRequest('/api/estudios/' + encodeURIComponent(studyId) + '/documentos', { method: 'POST', body });
  if (!result?.data?.id) throw new Error('INVALID_API_RESPONSE');
  return result.data;
}
async function loadDocuments(studyId, container) {
  const requestId = String((Number(container.dataset.documentLoadRequest) || 0) + 1);
  container.dataset.documentLoadRequest = requestId;
  try {
    const result = await apiRequest('/api/estudios/' + encodeURIComponent(studyId) + '/documentos');
    const data = Array.isArray(result?.data) ? result.data : [];
    if (!container.isConnected || container.dataset.documentLoadRequest !== requestId) return null;
    const isAdmin = currentUserRoles.includes('administrador');
    container.innerHTML = data.length ? data.map(document => {
      const image = document.mimeType?.startsWith('image/');
      const id = safe(document.id);
      const preview = image
        ? '<a class="document-preview-link" href="/api/documentos/' + id + '/content" target="_blank" rel="noopener"><img class="document-preview" loading="lazy" src="/api/documentos/' + id + '/content" alt="Vista previa de ' + safe(document.originalName) + '"></a>'
        : '';
      const view = document.mimeType === 'application/pdf' || image
        ? '<a class="secondary mini" href="/api/documentos/' + id + '/content" target="_blank" rel="noopener">Ver</a>'
        : '';
      const replace = isAdmin
        ? '<button type="button" class="secondary mini" data-replace-document="' + id + '">Reemplazar</button><input hidden type="file" data-replace-input="' + id + '" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.dcm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/gif,image/webp,application/dicom"><button type="button" class="danger mini" data-delete-document="' + id + '">Eliminar</button>'
        : '';
      return '<article class="document-item">' + preview + '<span><b>' + safe(document.originalName) + '</b><small>' + safe(document.mimeType) + ' · ' + safe(document.sizeBytes) + ' bytes</small></span><span class="document-actions">' + view + '<a class="secondary mini" href="/api/documentos/' + id + '/download">Descargar</a>' + replace + '</span></article>';
    }).join('') : '<small class="empty-small">No hay archivos asociados.</small>';
    bindDocumentControls(container, studyId);
    return data;
  } catch (error) {
    if (container.isConnected && container.dataset.documentLoadRequest === requestId) container.textContent = documentApiMessage(error, 'No se pudieron consultar los archivos.');
    return null;
  }
}
function bindDocumentControls(container, studyId) {
  container.querySelectorAll('[data-replace-document]').forEach(button => {
    button.onclick = () => container.querySelector('[data-replace-input="' + CSS.escape(button.dataset.replaceDocument) + '"]')?.click();
  });
  container.querySelectorAll('[data-replace-input]').forEach(input => {
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!confirm('El archivo actual será reemplazado. ¿Desea continuar?')) {
        input.value = '';
        return;
      }
      const button = container.querySelector('[data-replace-document="' + CSS.escape(input.dataset.replaceInput) + '"]');
      if (button) button.disabled = true;
      const body = new FormData();
      body.append('file', file, file.name);
      try {
        await apiRequest('/api/documentos/' + encodeURIComponent(input.dataset.replaceInput), { method: 'PUT', body });
        const listed = await refreshDocuments(studyId);
        if (!listed) window.alert('El servidor respondió al reemplazo, pero no se pudo verificar el listado. Actualice la ficha antes de continuar.');
        else window.alert('Archivo reemplazado y listado verificado.');
      } catch (error) {
        window.alert(documentApiMessage(error, 'No se pudo reemplazar el archivo.'));
      } finally {
        input.value = '';
        if (button) button.disabled = false;
      }
    };
  });
  container.querySelectorAll('[data-delete-document]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('El archivo se eliminará físicamente y no podrá recuperarse desde la aplicación. ¿Desea continuar?')) return;
      button.disabled = true;
      try {
        await apiRequest('/api/documentos/' + encodeURIComponent(button.dataset.deleteDocument), { method: 'DELETE' });
        const listed = await refreshDocuments(studyId);
        if (listed === null) window.alert('El servidor eliminó el archivo, pero no se pudo verificar el listado. Actualice la ficha.');
      } catch (error) {
        window.alert(documentApiMessage(error, 'No se pudo eliminar el archivo.'));
      } finally {
        button.disabled = false;
      }
    };
  });
}
async function refreshDocuments(studyId) {
  const container = document.querySelector('[data-document-list="' + CSS.escape(String(studyId)) + '"]');
  if (!container) return null;
  return loadDocuments(studyId, container);
}
function documentApiMessage(error, fallback) {
  if (error.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  if (error.status === 403) return 'Su cuenta no tiene permiso para realizar esta operación.';
  if (error.code === 'FILE_UPLOAD_NOT_CONFIGURED') return 'El administrador técnico debe configurar el repositorio y el límite de tamaño.';
  if (error.messageFromApi) return error.messageFromApi;
  return fallback;
}function showPatient(edit=false){ const p=edit?patient():null; editingPatient=p?.id||null; $('#patientDialogTitle').textContent=edit?'Editar paciente':'Nuevo paciente'; const f=$('#patientForm'); ['fullName','dni','birthDate','phone','address','notes'].forEach(k=>f.elements[k].value=p?.[k]||''); $('#patientDialog').showModal(); }
function openNewStudy() {
  editingStudy = null;
  const form = $('#studyForm');
  form.reset();
  form.elements.date.disabled = false;
  $('#studyDialogTitle').textContent = 'Nuevo estudio';
  $('#studySaveButton').textContent = 'Guardar estudio';
  $('#studyDialog').showModal();
}
async function openStudyEditor(id) {
  const patientId = String(selectedPatient?.id || '');
  if (!patientId) return;
  try {
    const result = await apiRequest(`/api/estudios/${encodeURIComponent(id)}`);
    const study = result?.data;
    if (String(selectedPatient?.id) !== patientId || !study || String(study.patientId) !== patientId) {
      throw new Error('INVALID_API_RESPONSE');
    }
    editingStudy = { ...study, id: String(study.id), version: study.version };
    const form = $('#studyForm');
    form.reset();
    for (const field of ['type', 'date', 'professional', 'diagnosis', 'procedure', 'description', 'conclusions']) {
      form.elements[field].value = study[field] || '';
    }
    form.elements.date.disabled = true;
    $('#studyDialogTitle').textContent = 'Editar estudio';
    $('#studySaveButton').textContent = 'Guardar cambios';
    $('#studyDialog').showModal();
  } catch (error) {
    window.alert(studyApiMessage(error, 'No se pudo abrir el estudio.'));
  }
}
$('#newPatient').onclick=()=>showPatient(); $('#editPatient').onclick=()=>showPatient(true);
document.querySelectorAll('[data-dialog-cancel]').forEach(button=>button.addEventListener('click',()=>{
  const dialog=button.closest('dialog');
  if(!dialog)return;
  dialog.querySelector('form')?.reset();
  if(dialog.id==='patientDialog')editingPatient=null;
  if(dialog.id==='studyDialog')editingStudy=null;
  dialog.close();
}));
$('#patientForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  const editingId = editingPatient;
  const payload = editingId ? { ...values, version: selectedPatient.version } : values;
  const saveButton = form.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  try {
    const result = await apiRequest(editingId ? `/api/pacientes/${encodeURIComponent(editingId)}` : '/api/pacientes', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    const saved = result?.data;
    if (!saved || saved.id === undefined) throw new Error('INVALID_API_RESPONSE');
    const id = String(saved.id);
    selectedPatient = {
      ...saved,
      id,
      studies: [],
    };
    activeId = id;
    editingPatient = null;
    $('#patientDialog').close();
    await loadPatients($('#patientSearch').value.trim());
    await loadStudies(id);
    render();
  } catch (error) {
    window.alert(patientApiMessage(error, editingId ? 'No se pudo actualizar el paciente.' : 'No se pudo guardar el paciente.', values));
  } finally {
    saveButton.disabled = false;
  }
});
$('#newStudy').onclick=openNewStudy;
$('#studyForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !selectedPatient) return;

  const selectedImages = Array.from(form.elements.images.files || []);
  const payload = {
    patientId: String(selectedPatient.id),
    type: form.elements.type.value,
    date: form.elements.date.value,
    professional: form.elements.professional.value,
    diagnosis: form.elements.diagnosis.value,
    procedure: form.elements.procedure.value,
    description: form.elements.description.value,
    conclusions: form.elements.conclusions.value,
  };
  const editingId = editingStudy?.id;
  if (editingStudy) payload.version = editingStudy.version;

  const saveButton = $('#studySaveButton');
  saveButton.disabled = true;
  try {
    const result = await apiRequest(editingStudy
      ? '/api/estudios/' + encodeURIComponent(editingId)
      : '/api/estudios', {
      method: editingStudy ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    const saved = result?.data;
    if (!saved || saved.id === undefined || String(saved.patientId) !== String(selectedPatient.id)) {
      throw new Error('INVALID_API_RESPONSE');
    }
    const normalized = {
      ...saved,
      id: String(saved.id),
      patientId: String(saved.patientId),
      serviceId: String(saved.serviceId),
    };
    selectedPatient.studies = editingStudy
      ? selectedPatient.studies.map(study => study.id === String(editingId) ? normalized : study)
      : [normalized, ...selectedPatient.studies];
    const savedStudyId = String(saved.id);
    editingStudy = null;
    form.reset();
    $('#studyDialog').close();
    render();

    if (selectedImages.length) {
      const uploaded = [];
      const failures = [];
      for (const file of selectedImages) {
        try {
          uploaded.push({ file: file.name, document: await uploadStudyDocument(savedStudyId, file) });
        } catch (error) {
          failures.push({ file: file.name, message: documentApiMessage(error, 'No se pudo guardar el archivo.') });
        }
      }
      const listed = await refreshDocuments(savedStudyId);
      const missing = listed
        ? uploaded.filter(item => !listed.some(document => String(document.id) === String(item.document.id)))
        : uploaded;
      if (failures.length || missing.length) {
        const details = failures.map(item => item.file + ': ' + item.message)
          .concat(missing.map(item => item.file + ': la API respondió, pero no aparece en el listado.'));
        window.alert('El estudio se guardó. Se verificaron ' + (uploaded.length - missing.length) + ' de ' + selectedImages.length + ' imágenes. Revise estos casos y use “Cargar archivo” para reintentar únicamente los que falten:\n' + details.join('\n'));
      } else {
        window.alert('Estudio guardado. Se cargaron y verificaron ' + uploaded.length + ' imágenes.');
      }
    }
  } catch (error) {
    window.alert(studyApiMessage(error, editingId ? 'No se pudo actualizar el estudio.' : 'No se pudo guardar el estudio.'));
  } finally {
    saveButton.disabled = false;
  }
});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`#${b.dataset.tab}Panel`).classList.add('active')});
$('#patientSearch').addEventListener('input', () => {
  clearTimeout(patientSearchTimer);
  patientSearchTimer = setTimeout(() => loadPatients($('#patientSearch').value.trim()), 250);
});
initializeAuthentication();
