let pacientes = [];
let pacienteActivoId = null, pacienteEnEdicionId = null;
let editingStudy = null;
let cargandoEstudios = false;
let errorCargaEstudios = '';
let temporizadorBusquedaPacientes = null;
let idSolicitudListaPacientes = 0;
let selectedPatient = null;
let errorListaPacientes = '';
let rolesUsuarioActual = [];
let permisosUsuarioActual = new Set();
const $ = selector => document.querySelector(selector);
const pantallaAutenticacion = $('#authScreen');
const contenedorAplicacion = $('#appShell');
const formularioInicioSesion = $('#loginForm');
const errorInicioSesion = $('#loginError');
const escaparHtml = value => String(value || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function mostrarInicioSesion(mensaje = '') {
  gestionUsuarios.cerrar();
  permisosUsuarioActual.clear();
  contenedorAplicacion.hidden = true;
  pantallaAutenticacion.hidden = false;
  $('#authLoading').hidden = true;
  formularioInicioSesion.hidden = false;
  errorInicioSesion.textContent = mensaje;
  errorInicioSesion.hidden = !mensaje;
  formularioInicioSesion.elements.username.focus();
}

async function obtenerUsuarioActual() {
  const respuesta = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (respuesta.status === 401) return null;
  if (!respuesta.ok) throw new Error('AUTH_CHECK_FAILED');
  const resultado = await respuesta.json();
  return resultado.user || null;
}

async function mostrarAplicacion(usuario) {
  const acceso = await apiRequest('/api/auth/permisos');
  permisosUsuarioActual = new Set(acceso.permissions || []);
  gestionUsuarios.configurar({ usuario, permisos: [...permisosUsuarioActual], solicitar: apiRequest, finalizarSesion: mostrarInicioSesion });
  pantallaAutenticacion.hidden = true;
  contenedorAplicacion.hidden = false;
  $('#currentUser').textContent = usuario.displayName || usuario.username;
  rolesUsuarioActual = Array.isArray(usuario.roles) ? usuario.roles : [];
  $('#newPatient').hidden = !permisosUsuarioActual.has('patients.create');
  $('#editPatient').hidden = !permisosUsuarioActual.has('patients.update');
  $('#newStudy').hidden = !permisosUsuarioActual.has('studies.create');
  renderizar();
  if (permisosUsuarioActual.has('patients.read')) await cargarPacientes();
  else { pacientes = []; selectedPatient = null; pacienteActivoId = null; renderizar(); }
}

async function inicializarAutenticacion() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (usuario) await mostrarAplicacion(usuario);
    else mostrarInicioSesion();
  } catch {
    mostrarInicioSesion('No se pudo verificar la sesión. Compruebe que el servidor esté disponible e inténtelo nuevamente.');
  }
}

formularioInicioSesion.addEventListener('submit', async evento => {
  evento.preventDefault();
  if (!formularioInicioSesion.reportValidity()) return;

  const botonEnviar = $('#loginButton');
  const nombreUsuario = formularioInicioSesion.elements.username.value.trim();
  const contrasena = formularioInicioSesion.elements.password.value;
  const cuerpoSolicitud = JSON.stringify({ username: nombreUsuario, password: contrasena });
  formularioInicioSesion.elements.password.value = '';
  errorInicioSesion.textContent = '';
  errorInicioSesion.hidden = true;
  botonEnviar.disabled = true;

  try {
    const respuesta = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: cuerpoSolicitud,
    });
    if (respuesta.status === 401) {
      mostrarInicioSesion('Usuario o contraseña incorrectos.');
      return;
    }
    if (respuesta.status === 429) {
      mostrarInicioSesion('Se alcanzó el límite temporal de intentos. Espere antes de volver a intentar.');
      return;
    }
    if (!respuesta.ok) {
      mostrarInicioSesion('No se pudo iniciar sesión. Compruebe los datos e inténtelo nuevamente.');
      return;
    }

    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      mostrarInicioSesion('No se pudo confirmar la sesión. Inténtelo nuevamente.');
      return;
    }
    formularioInicioSesion.reset();
    await mostrarAplicacion(usuario);
  } catch {
    mostrarInicioSesion('No se pudo conectar con el servicio de autenticación. Inténtelo nuevamente.');
  } finally {
    botonEnviar.disabled = false;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  const botonCerrarSesion = $('#logoutButton');
  botonCerrarSesion.disabled = true;
  try {
    const respuesta = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (respuesta.status === 204) {
      formularioInicioSesion.reset();
      mostrarInicioSesion();
    } else if (respuesta.status === 503) {
      formularioInicioSesion.reset();
      mostrarInicioSesion('La sesión local se cerró, pero el servidor no pudo confirmar la operación.');
    } else {
      window.alert('No se pudo cerrar la sesión. Inténtelo nuevamente.');
    }
  } catch {
    // Keep the authenticated view visible because the server may not have received the logout.
    window.alert('No se pudo conectar con el servidor para cerrar la sesión. Inténtelo nuevamente.');
  } finally {
    botonCerrarSesion.disabled = false;
  }
});

async function apiRequest(ruta, opciones = {}) {
  const esFormularioMultipart = typeof FormData !== 'undefined' && opciones.body instanceof FormData;
  const respuesta = await fetch(ruta, {
    ...opciones,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opciones.body && !esFormularioMultipart ? { 'Content-Type': 'application/json' } : {}), ...opciones.headers },
  });
  let resultado = null;
  try { resultado = await respuesta.json(); } catch {}
  if (!respuesta.ok) {
    if (respuesta.status === 401) mostrarInicioSesion('La sesión venció. Inicie sesión nuevamente.');
    const errorApi = new Error('API_REQUEST_FAILED');
    errorApi.status = respuesta.status;
    errorApi.code = resultado?.error?.code || '';
    errorApi.messageFromApi = resultado?.error?.message || '';
    throw errorApi;
  }
  return resultado;
}

function mensajeApiPaciente(errorApi, accion, datosPaciente = null) {
  if (errorApi.code === 'CONFLICT' && datosPaciente?.dni) return 'Ya existe un paciente registrado con ese DNI.';
  if (errorApi.code === 'VERSION_CONFLICT') return 'El paciente fue modificado por otra persona. Cierre y vuelva a abrir la ficha antes de guardar.';
  if (errorApi.code === 'SERVICE_SCOPE_PENDING' || errorApi.code === 'FORBIDDEN') return 'Su cuenta todavía no tiene habilitado el acceso al módulo de pacientes.';
  if (errorApi.code === 'INVALID_PATIENT') return errorApi.messageFromApi || 'Revise los datos ingresados.';
  if (errorApi.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  return accion;
}

function mensajeApiEstudio(errorApi, accion) {
  if (errorApi.code === 'VERSION_CONFLICT') return 'El estudio fue modificado por otra persona. Recargue el estudio antes de guardar.';
  if (errorApi.code === 'GENERAL_SERVICE_NOT_CONFIGURED') return errorApi.messageFromApi || 'El servicio general todavía no está configurado.';
  if (errorApi.code === 'FORBIDDEN') return 'Su cuenta no tiene permiso para realizar esta operación con estudios.';
  if (errorApi.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  return accion;
}

async function cargarPacientes(busqueda = '') {
  const idSolicitud = ++idSolicitudListaPacientes;
  errorListaPacientes = '';
  try {
    const tamanoPagina = 100;
    const datos = [];
    let pagina = 1;
    while (true) {
      const params = new URLSearchParams({ page: String(pagina), pageSize: String(tamanoPagina) });
      if (busqueda) params.set('search', busqueda);
      const respuesta = await apiRequest(`/api/pacientes?${params}`);
      if (!Array.isArray(respuesta?.data)) throw new Error('INVALID_API_RESPONSE');
      datos.push(...respuesta.data.map(elemento => ({ ...elemento, id: String(elemento.id) })));
      if (respuesta.data.length < tamanoPagina) break;
      pagina += 1;
    }
    if (idSolicitud !== idSolicitudListaPacientes) return;
    pacientes = datos;
  } catch (error) {
    if (idSolicitud !== idSolicitudListaPacientes) return;
    pacientes = [];
    errorListaPacientes = mensajeApiPaciente(error, 'No se pudo cargar la lista de pacientes.');
  }
  renderizarPacientes();
}

async function cargarPaciente(idPaciente) {
  const requestedId = String(idPaciente);
  pacienteActivoId = requestedId;
  selectedPatient = null;
  renderizar();
  try {
    const respuesta = await apiRequest(`/api/pacientes/${encodeURIComponent(requestedId)}`);
    if (pacienteActivoId !== requestedId) return;
    const datosPaciente = respuesta?.data;
    if (!datosPaciente || String(datosPaciente.id) !== requestedId) throw new Error('INVALID_API_RESPONSE');
    selectedPatient = {
      ...datosPaciente,
      id: requestedId,
      studies: [],
    };
    await cargarEstudios(requestedId);
  } catch (error) {
    if (pacienteActivoId !== requestedId) return;
    pacienteActivoId = null;
    selectedPatient = null;
    window.alert(mensajeApiPaciente(error, 'No se pudo consultar el paciente.'));
  }
  renderizar();
}

async function cargarEstudios(idPaciente) {
  const requestedId = String(idPaciente);
  cargandoEstudios = true;
  errorCargaEstudios = '';
  renderizar();
  try {
    const respuesta = await apiRequest(`/api/pacientes/${encodeURIComponent(requestedId)}/estudios`);
    if (!Array.isArray(respuesta?.data)) throw new Error('INVALID_API_RESPONSE');
    if (pacienteActivoId !== requestedId || String(selectedPatient?.id) !== requestedId) return;
    selectedPatient.studies = respuesta.data.map(estudio => ({
      ...estudio,
      id: String(estudio.id),
      patientId: String(estudio.patientId),
      serviceId: String(estudio.serviceId),
    }));
  } catch (error) {
    if (pacienteActivoId !== requestedId || String(selectedPatient?.id) !== requestedId) return;
    selectedPatient.studies = [];
    errorCargaEstudios = mensajeApiEstudio(error, 'No se pudieron cargar los estudios.');
  } finally {
    if (pacienteActivoId === requestedId && String(selectedPatient?.id) === requestedId) {
      cargandoEstudios = false;
      renderizar();
    }
  }
}

function obtenerPacienteSeleccionado() { return selectedPatient; }
function age(birthDate) { if (!birthDate) return ''; const d = new Date(birthDate), n = new Date(); let a=n.getFullYear()-d.getFullYear(); if (n < new Date(n.getFullYear(),d.getMonth(),d.getDate())) a--; return `${a} años`; }
function renderizarPacientes() {
  const terminoBusqueda = $('#patientSearch').value.trim().toLowerCase();
  const pacientesFiltrados = pacientes.filter(paciente => `${paciente.fullName} ${paciente.dni || ''}`.toLowerCase().includes(terminoBusqueda));
  $('#patientCount').textContent = pacientes.length;
  $('#patientList').innerHTML = errorListaPacientes
    ? `<p class="empty-small">${escaparHtml(errorListaPacientes)}</p>`
    : pacientesFiltrados.length ? pacientesFiltrados.map(paciente => `<button class="patient-item ${String(paciente.id)===pacienteActivoId?'selected':''}" data-id="${escaparHtml(paciente.id)}"><b>${escaparHtml(paciente.fullName)}</b><small>DNI ${escaparHtml(paciente.dni || 'sin registrar')}</small></button>`).join('')
      : '<p class="empty-small">Sin pacientes.</p>';
  document.querySelectorAll('.patient-item').forEach(boton => boton.onclick = () => cargarPaciente(boton.dataset.id));
}
function renderizarResumenPaciente(paciente) {
  $('#summaryPanel').innerHTML = `<div class="summary-grid"><article class="card"><h3>Datos personales</h3><p><b>DNI:</b> ${escaparHtml(paciente.dni || '—')}\n<b>Fecha de nacimiento:</b> ${escaparHtml(paciente.birthDate || '—')}\n<b>Teléfono:</b> ${escaparHtml(paciente.phone || '—')}\n<b>Dirección:</b> ${escaparHtml(paciente.address || '—')}</p></article><article class="card"><h3>Antecedentes y observaciones</h3><p>${escaparHtml(paciente.notes || 'No se registraron observaciones.')}</p></article></div><article class="card" style="margin-top:16px"><h3>Actividad reciente</h3><p>${paciente.studies.length ? `Último estudio: <b>${escaparHtml(paciente.studies.slice().sort((estudioA, estudioB) => estudioB.date.localeCompare(estudioA.date))[0].type)}</b>` : 'Todavía no hay estudios cargados.'}</p></article>`;
}
function renderizarListaEstudios(paciente) {
  $('#studyList').innerHTML = cargandoEstudios
    ? '<div class="empty-small">Consultando estudios en el servidor…</div>'
    : errorCargaEstudios
      ? `<p class="empty-small">${escaparHtml(errorCargaEstudios)}</p>`
      : paciente.studies.length
        ? paciente.studies.slice().sort((estudioA, estudioB) => estudioB.date.localeCompare(estudioA.date)).map(estudio => `<article class="study-card"><div class="study-top"><span class="badge">${escaparHtml(estudio.type)}</span><small>${escaparHtml(estudio.date)}</small></div><h4>${escaparHtml(estudio.diagnosis || estudio.procedure || 'Estudio sin título')}</h4><p><b>Profesional:</b> ${escaparHtml(estudio.professional || '—')}<br><b>Procedimiento:</b> ${escaparHtml(estudio.procedure || '—')}</p>${estudio.description ? `<p><b>Descripción:</b> ${escaparHtml(estudio.description)}</p>`:''}${estudio.conclusions ? `<p><b>Conclusiones:</b> ${escaparHtml(estudio.conclusions)}</p>`:''}<div class="study-actions"><button class="secondary mini" data-edit-study="${escaparHtml(estudio.id)}">Abrir / editar</button></div><section class="document-panel"><div class="document-heading"><b>Archivos</b>${permisosUsuarioActual.has('documents.upload') ? `<button type="button" class="secondary mini" data-upload-document="${escaparHtml(estudio.id)}">Cargar archivo</button><input hidden type="file" data-document-input="${escaparHtml(estudio.id)}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.dcm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/gif,image/webp,application/dicom">` : ''}</div><div data-document-list="${escaparHtml(estudio.id)}" class="document-list">Cargando archivos…</div></section></article>`).join('')
        : '<div class="empty-small">No hay estudios registrados.</div>';
}
function renderizar() {
  renderizarPacientes(); const paciente = obtenerPacienteSeleccionado();
  $('#emptyState').hidden = !!paciente; $('#recordView').hidden = !paciente;
  if (!paciente) {
    $('#emptyState h2').textContent = pacienteActivoId ? 'Cargando paciente…' : 'Seleccione un paciente';
    $('#emptyState p').textContent = pacienteActivoId ? 'Consultando la ficha en el servidor.' : 'O cree una nueva ficha para registrar datos, estudios e imágenes.';
    return;
  }
  $('#patientName').textContent = paciente.fullName;
  $('#patientMeta').textContent = [paciente.dni && `DNI ${paciente.dni}`, age(paciente.birthDate), paciente.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto';
  $('#studyCount').textContent = paciente.studies.length;
  renderizarResumenPaciente(paciente);
  renderizarListaEstudios(paciente);
  conectarEventosDinamicos();
}
function conectarEventosDinamicos() {
  document.querySelectorAll('[data-edit-study]').forEach(button => {
    button.onclick = () => abrirEditorEstudio(button.dataset.editStudy);
  });
  document.querySelectorAll('[data-document-list]').forEach(container => {
    cargarDocumentos(container.dataset.documentList, container);
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
        window.alert(mensajeApiDocumento(error, 'No se pudo guardar el archivo.'));
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
async function uploadStudyDocument(idEstudio, archivo) {
  const formularioMultipart = new FormData();
  formularioMultipart.append('file', archivo, archivo.name);
  const respuesta = await apiRequest('/api/estudios/' + encodeURIComponent(idEstudio) + '/documentos', { method: 'POST', body: formularioMultipart });
  if (!respuesta?.data?.id) throw new Error('INVALID_API_RESPONSE');
  return respuesta.data;
}
async function cargarDocumentos(idEstudio, contenedor) {
  const idSolicitud = String((Number(contenedor.dataset.documentLoadRequest) || 0) + 1);
  contenedor.dataset.documentLoadRequest = idSolicitud;
  try {
    const respuesta = await apiRequest('/api/estudios/' + encodeURIComponent(idEstudio) + '/documentos');
    const documentos = Array.isArray(respuesta?.data) ? respuesta.data : [];
    if (!contenedor.isConnected || contenedor.dataset.documentLoadRequest !== idSolicitud) return null;
    contenedor.innerHTML = documentos.length ? documentos.map(documento => {
      const esImagen = documento.mimeType?.startsWith('image/');
      const id = escaparHtml(documento.id);
      const vistaPrevia = esImagen
        ? '<a class="document-preview-link" href="/api/documentos/' + id + '/content" target="_blank" rel="noopener"><img class="document-preview" loading="lazy" src="/api/documentos/' + id + '/content" alt="Vista previa de ' + escaparHtml(documento.originalName) + '"></a>'
        : '';
      const enlaceVisualizacion = documento.mimeType === 'application/pdf' || esImagen
        ? '<a class="secondary mini" href="/api/documentos/' + id + '/content" target="_blank" rel="noopener">Ver</a>'
        : '';
      const controlesAdministrativos = (permisosUsuarioActual.has('documents.replace')
        ? '<button type="button" class="secondary mini" data-replace-document="' + id + '">Reemplazar</button><input hidden type="file" data-replace-input="' + id + '" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.dcm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/gif,image/webp,application/dicom">' : '')
        + (permisosUsuarioActual.has('documents.delete') ? '<button type="button" class="danger mini" data-delete-document="' + id + '">Eliminar</button>' : '');
      return '<article class="document-item">' + vistaPrevia + '<span><b>' + escaparHtml(documento.originalName) + '</b><small>' + escaparHtml(documento.mimeType) + ' · ' + escaparHtml(documento.sizeBytes) + ' bytes</small></span><span class="document-actions">' + enlaceVisualizacion + '<a class="secondary mini" href="/api/documentos/' + id + '/download">Descargar</a>' + controlesAdministrativos + '</span></article>';
    }).join('') : '<small class="empty-small">No hay archivos asociados.</small>';
    conectarControlesDocumento(contenedor, idEstudio);
    return documentos;
  } catch (error) {
    if (contenedor.isConnected && contenedor.dataset.documentLoadRequest === idSolicitud) contenedor.textContent = mensajeApiDocumento(error, 'No se pudieron consultar los archivos.');
    return null;
  }
}
function conectarControlesDocumento(contenedor, idEstudio) {
  contenedor.querySelectorAll('[data-replace-document]').forEach(button => {
    button.onclick = () => contenedor.querySelector('[data-replace-input="' + CSS.escape(button.dataset.replaceDocument) + '"]')?.click();
  });
  contenedor.querySelectorAll('[data-replace-input]').forEach(input => {
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!confirm('El archivo actual será reemplazado. ¿Desea continuar?')) {
        input.value = '';
        return;
      }
      const button = contenedor.querySelector('[data-replace-document="' + CSS.escape(input.dataset.replaceInput) + '"]');
      if (button) button.disabled = true;
      const body = new FormData();
      body.append('file', file, file.name);
      try {
        await apiRequest('/api/documentos/' + encodeURIComponent(input.dataset.replaceInput), { method: 'PUT', body });
        const listed = await refreshDocuments(idEstudio);
        if (!listed) window.alert('El servidor respondió al reemplazo, pero no se pudo verificar el listado. Actualice la ficha antes de continuar.');
        else window.alert('Archivo reemplazado y listado verificado.');
      } catch (error) {
        window.alert(mensajeApiDocumento(error, 'No se pudo reemplazar el archivo.'));
      } finally {
        input.value = '';
        if (button) button.disabled = false;
      }
    };
  });
  contenedor.querySelectorAll('[data-delete-document]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('El archivo se eliminará físicamente y no podrá recuperarse desde la aplicación. ¿Desea continuar?')) return;
      button.disabled = true;
      try {
        await apiRequest('/api/documentos/' + encodeURIComponent(button.dataset.deleteDocument), { method: 'DELETE' });
        const listed = await refreshDocuments(idEstudio);
        if (listed === null) window.alert('El servidor eliminó el archivo, pero no se pudo verificar el listado. Actualice la ficha.');
      } catch (error) {
        window.alert(mensajeApiDocumento(error, 'No se pudo eliminar el archivo.'));
      } finally {
        button.disabled = false;
      }
    };
  });
}
async function refreshDocuments(idEstudio) {
  const contenedor = document.querySelector('[data-document-list="' + CSS.escape(String(idEstudio)) + '"]');
  if (!contenedor) return null;
  return cargarDocumentos(idEstudio, contenedor);
}
function mensajeApiDocumento(error, mensajeAlternativo) {
  if (error.status === 401) return 'La sesión venció. Inicie sesión nuevamente.';
  if (error.status === 403) return 'Su cuenta no tiene permiso para realizar esta operación.';
  if (error.code === 'FILE_UPLOAD_NOT_CONFIGURED') return 'El administrador técnico debe configurar el repositorio y el límite de tamaño.';
  if (error.messageFromApi) return error.messageFromApi;
  return mensajeAlternativo;
}function mostrarFormularioPaciente(esEdicion=false){ const paciente=esEdicion?obtenerPacienteSeleccionado():null; pacienteEnEdicionId=paciente?.id||null; $('#patientDialogTitle').textContent=esEdicion?'Editar paciente':'Nuevo paciente'; const formulario=$('#patientForm'); ['fullName','dni','birthDate','phone','address','notes'].forEach(nombreCampo=>formulario.elements[nombreCampo].value=paciente?.[nombreCampo]||''); $('#patientDialog').showModal(); }
function abrirNuevoEstudio() {
  editingStudy = null;
  const formulario = $('#studyForm');
  formulario.reset();
  for (const campo of formulario.querySelectorAll('input, select, textarea')) campo.disabled = false;
  formulario.elements.images.disabled = !permisosUsuarioActual.has('documents.upload');
  formulario.elements.images.closest('label').hidden = formulario.elements.images.disabled;
  $('#studySaveButton').hidden = !permisosUsuarioActual.has('studies.create');
  formulario.elements.date.disabled = false;
  $('#studyDialogTitle').textContent = 'Nuevo estudio';
  $('#studySaveButton').textContent = 'Guardar estudio';
  $('#studyDialog').showModal();
}
async function abrirEditorEstudio(idEstudio) {
  const idPaciente = String(selectedPatient?.id || '');
  if (!idPaciente) return;
  try {
    const respuesta = await apiRequest(`/api/estudios/${encodeURIComponent(idEstudio)}`);
    const estudio = respuesta?.data;
    if (String(selectedPatient?.id) !== idPaciente || !estudio || String(estudio.patientId) !== idPaciente) {
      throw new Error('INVALID_API_RESPONSE');
    }
    editingStudy = { ...estudio, id: String(estudio.id), version: estudio.version };
    const form = $('#studyForm');
    form.reset();
    const puedeEditar = permisosUsuarioActual.has('studies.update');
    for (const campo of form.querySelectorAll('input, select, textarea')) campo.disabled = !puedeEditar;
    form.elements.images.disabled = !puedeEditar || !permisosUsuarioActual.has('documents.upload');
    form.elements.images.closest('label').hidden = form.elements.images.disabled;
    $('#studySaveButton').hidden = !puedeEditar;
    for (const nombreCampo of ['type', 'date', 'professional', 'diagnosis', 'procedure', 'description', 'conclusions']) {
      form.elements[nombreCampo].value = estudio[nombreCampo] || '';
    }
    form.elements.date.disabled = true;
    $('#studyDialogTitle').textContent = puedeEditar ? 'Editar estudio' : 'Consultar estudio';
    $('#studySaveButton').textContent = 'Guardar cambios';
    $('#studyDialog').showModal();
  } catch (error) {
    window.alert(mensajeApiEstudio(error, 'No se pudo abrir el estudio.'));
  }
}
$('#newPatient').onclick=()=>mostrarFormularioPaciente(); $('#editPatient').onclick=()=>mostrarFormularioPaciente(true);
document.querySelectorAll('[data-dialog-cancel]').forEach(button=>button.addEventListener('click',()=>{
  const dialog=button.closest('dialog');
  if(!dialog)return;
  dialog.querySelector('form')?.reset();
  if(dialog.id==='patientDialog')pacienteEnEdicionId=null;
  if(dialog.id==='studyDialog')editingStudy=null;
  dialog.close();
}));
$('#patientForm').addEventListener('submit', async evento => {
  evento.preventDefault();
  const formulario = evento.currentTarget;
  if (!formulario.reportValidity()) return;
  const valoresFormulario = Object.fromEntries(new FormData(formulario));
  const editingId = pacienteEnEdicionId;
  const datosSolicitud = editingId ? { ...valoresFormulario, version: selectedPatient.version } : valoresFormulario;
  const botonGuardar = formulario.querySelector('button[type="submit"]');
  botonGuardar.disabled = true;
  try {
    const respuesta = await apiRequest(editingId ? `/api/pacientes/${encodeURIComponent(editingId)}` : '/api/pacientes', {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(datosSolicitud),
    });
    const pacienteGuardado = respuesta?.data;
    if (!pacienteGuardado || pacienteGuardado.id === undefined) throw new Error('INVALID_API_RESPONSE');
    const idPacienteGuardado = String(pacienteGuardado.id);
    selectedPatient = {
      ...pacienteGuardado,
      id: idPacienteGuardado,
      studies: [],
    };
    pacienteActivoId = idPacienteGuardado;
    pacienteEnEdicionId = null;
    $('#patientDialog').close();
    await cargarPacientes($('#patientSearch').value.trim());
    await cargarEstudios(idPacienteGuardado);
    renderizar();
  } catch (error) {
    window.alert(mensajeApiPaciente(error, editingId ? 'No se pudo actualizar el paciente.' : 'No se pudo guardar el paciente.', valoresFormulario));
  } finally {
    botonGuardar.disabled = false;
  }
});
$('#newStudy').onclick=abrirNuevoEstudio;
$('#studyForm').addEventListener('submit', async evento => {
  evento.preventDefault();
  const form = evento.currentTarget;
  if (!form.reportValidity() || !selectedPatient) return;

  const imagenesSeleccionadas = Array.from(form.elements.images.files || []);
  const datosEstudio = {
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
  if (editingStudy) datosEstudio.version = editingStudy.version;

  const botonGuardar = $('#studySaveButton');
  botonGuardar.disabled = true;
  try {
    const respuesta = await apiRequest(editingStudy
      ? '/api/estudios/' + encodeURIComponent(editingId)
      : '/api/estudios', {
      method: editingStudy ? 'PUT' : 'POST',
      body: JSON.stringify(datosEstudio),
    });
    const estudioGuardado = respuesta?.data;
    if (!estudioGuardado || estudioGuardado.id === undefined || String(estudioGuardado.patientId) !== String(selectedPatient.id)) {
      throw new Error('INVALID_API_RESPONSE');
    }
    const estudioNormalizado = {
      ...estudioGuardado,
      id: String(estudioGuardado.id),
      patientId: String(estudioGuardado.patientId),
      serviceId: String(estudioGuardado.serviceId),
    };
    selectedPatient.studies = editingStudy
      ? selectedPatient.studies.map(estudioExistente => estudioExistente.id === String(editingId) ? estudioNormalizado : estudioExistente)
      : [estudioNormalizado, ...selectedPatient.studies];
    const savedStudyId = String(estudioGuardado.id);
    editingStudy = null;
    form.reset();
    $('#studyDialog').close();
    renderizar();

    if (imagenesSeleccionadas.length) {
      const archivosSubidos = [];
      const erroresCarga = [];
      for (const file of imagenesSeleccionadas) {
        try {
          archivosSubidos.push({ archivo: file.name, documento: await uploadStudyDocument(savedStudyId, file) });
        } catch (error) {
          erroresCarga.push({ archivo: file.name, mensaje: mensajeApiDocumento(error, 'No se pudo guardar el archivo.') });
        }
      }
      const documentosListado = await refreshDocuments(savedStudyId);
      const archivosNoListados = documentosListado
        ? archivosSubidos.filter(archivoSubido => !documentosListado.some(documento => String(documento.id) === String(archivoSubido.documento.id)))
        : archivosSubidos;
      if (erroresCarga.length || archivosNoListados.length) {
        const detalleErrores = erroresCarga.map(errorCarga => errorCarga.archivo + ': ' + errorCarga.mensaje)
          .concat(archivosNoListados.map(archivoNoListado => archivoNoListado.archivo + ': la API respondió, pero no aparece en el listado.'));
        window.alert('El estudio se guardó. Se verificaron ' + (archivosSubidos.length - archivosNoListados.length) + ' de ' + imagenesSeleccionadas.length + ' imágenes. Revise estos casos y use “Cargar archivo” para reintentar únicamente los que falten:\n' + detalleErrores.join('\n'));
      } else {
        window.alert('Estudio guardado. Se cargaron y verificaron ' + archivosSubidos.length + ' imágenes.');
      }
    }
  } catch (error) {
    window.alert(mensajeApiEstudio(error, editingId ? 'No se pudo actualizar el estudio.' : 'No se pudo guardar el estudio.'));
  } finally {
    botonGuardar.disabled = false;
  }
});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`#${b.dataset.tab}Panel`).classList.add('active')});
$('#patientSearch').addEventListener('input', () => {
  clearTimeout(temporizadorBusquedaPacientes);
  temporizadorBusquedaPacientes = setTimeout(() => cargarPacientes($('#patientSearch').value.trim()), 250);
});
inicializarAutenticacion();
