/* Integración con app.js: configurar recibe sesión, permisos y el cliente HTTP compartido. */
const gestionUsuarios = (() => {
  const elemento = selector => document.querySelector(selector);
  const dialogo = elemento('#usersDialog');
  const formulario = elemento('#userForm');
  const formularioContrasena = elemento('#userPasswordForm');
  const etiquetas = { administrador: 'Administrador', medico: 'Médico', secretario: 'Secretario', visualizador: 'Visualizador' };
  let sesion = null;
  let permisos = new Set();
  let solicitar;
  let finalizarSesion;
  let usuarios = [];
  let usuarioEnEdicion = null;
  let usuarioContrasena = null;
  let pagina = 1;
  let solicitud = 0;
  let temporizador;

  function configurar(opciones) {
    cerrar();
    sesion = opciones.usuario;
    permisos = new Set(opciones.permisos);
    solicitar = opciones.solicitar;
    finalizarSesion = opciones.finalizarSesion;
    elemento('#importData').hidden = !permisos.has('users.manage');
    elemento('#newUser').hidden = !permisos.has('roles.manage');
  }

  function cerrar() {
    solicitud++;
    clearTimeout(temporizador);
    for (const id of ['usersDialog', 'userDialog', 'userPasswordDialog']) elemento(`#${id}`).close();
    formulario.reset();
    formularioContrasena.reset();
    elemento('#usersSearch').value = '';
    elemento('#usersList').replaceChildren();
    elemento('#importData').hidden = true;
    usuarios = [];
    usuarioEnEdicion = usuarioContrasena = sesion = null;
    permisos.clear();
  }

  function mensajeError(error) {
    return error.status === 401 ? 'La sesión venció. Inicie sesión nuevamente.'
      : error.messageFromApi || 'No se pudo completar la operación. Inténtelo nuevamente.';
  }

  function mostrarError(selector, mensaje) {
    elemento(selector).textContent = mensaje;
    elemento(selector).hidden = !mensaje;
  }

  function boton(texto, accion) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'secondary mini';
    control.textContent = texto;
    control.addEventListener('click', accion);
    return control;
  }

  async function cargar() {
    const numeroSolicitud = ++solicitud;
    elemento('#usersMessage').textContent = 'Cargando usuarios…';
    elemento('#usersList').replaceChildren();
    elemento('#usersPrevious').disabled = elemento('#usersNext').disabled = true;
    try {
      const parametros = new URLSearchParams({ page: String(pagina), search: elemento('#usersSearch').value.trim() });
      const respuesta = await solicitar(`/api/usuarios?${parametros}`);
      if (numeroSolicitud !== solicitud || !dialogo.open) return;
      usuarios = respuesta.data;
      for (const usuario of usuarios) {
        const fila = document.createElement('tr');
        for (const texto of [usuario.username, usuario.displayName, usuario.roles.map(rol => etiquetas[rol] || rol).join(', ') || 'Sin rol', usuario.isActive ? 'Activo' : 'Inactivo']) {
          const celda = document.createElement('td');
          celda.textContent = texto;
          fila.append(celda);
        }
        const acciones = document.createElement('td');
        acciones.className = 'users-actions';
        acciones.append(boton('Editar', () => abrirFormulario(usuario)), boton('Contraseña', () => abrirContrasena(usuario)));
        const cambiarEstado = boton(usuario.isActive ? 'Desactivar' : 'Activar', () => alternarEstado(usuario, cambiarEstado));
        cambiarEstado.disabled = String(usuario.id) === String(sesion.id);
        acciones.append(cambiarEstado);
        fila.append(acciones);
        elemento('#usersList').append(fila);
      }
      elemento('#usersMessage').textContent = usuarios.length ? '' : 'No se encontraron usuarios.';
      elemento('#usersPage').textContent = `Página ${pagina}`;
      elemento('#usersPrevious').disabled = pagina === 1;
      elemento('#usersNext').disabled = usuarios.length < respuesta.pageSize;
    } catch (error) {
      if (numeroSolicitud === solicitud) elemento('#usersMessage').textContent = mensajeError(error);
    }
  }

  function abrirFormulario(usuario = null) {
    usuarioEnEdicion = usuario;
    formulario.reset();
    mostrarError('#userError', '');
    elemento('#userTitle').textContent = usuario ? 'Editar usuario' : 'Nuevo usuario';
    formulario.elements.username.value = usuario?.username || '';
    formulario.elements.username.disabled = Boolean(usuario);
    formulario.elements.displayName.value = usuario?.displayName || '';
    const perfilGeneral = !usuario || (usuario.roles.length === 1 && Object.hasOwn(etiquetas, usuario.roles[0]));
    formulario.elements.role.disabled = !permisos.has('roles.manage') || !perfilGeneral;
    formulario.elements.role.value = usuario ? (perfilGeneral ? usuario.roles[0] : '') : 'visualizador';
    elemento('#userRoleNote').hidden = perfilGeneral;
    for (const campo of ['password', 'passwordConfirmation']) {
      formulario.elements[campo].disabled = Boolean(usuario);
      formulario.elements[campo].closest('label').hidden = Boolean(usuario);
    }
    elemento('#userDialog').showModal();
  }

  function abrirContrasena(usuario) {
    usuarioContrasena = usuario;
    formularioContrasena.reset();
    mostrarError('#userPasswordError', '');
    elemento('#userPasswordTarget').textContent = `Cuenta: ${usuario.username}`;
    elemento('#userPasswordDialog').showModal();
  }

  function contrasenaValida(formularioActual) {
    const contrasena = formularioActual.elements.password.value;
    if (Array.from(contrasena).length < 12) throw new Error('MIN_PASSWORD');
    if (contrasena !== formularioActual.elements.passwordConfirmation.value) throw new Error('PASSWORD_MATCH');
  }

  function errorFormulario(error) {
    if (error.message === 'MIN_PASSWORD') return 'La contraseña debe tener al menos 12 caracteres.';
    if (error.message === 'PASSWORD_MATCH') return 'Las contraseñas no coinciden.';
    return mensajeError(error);
  }

  function bloquear(formularioActual, bloqueado) {
    formularioActual.dataset.saving = String(bloqueado);
    formularioActual.querySelectorAll('button').forEach(control => { control.disabled = bloqueado; });
  }

  formulario.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (formulario.dataset.saving === 'true' || !formulario.reportValidity()) return;
    mostrarError('#userError', '');
    const usuario = usuarioEnEdicion;
    const datos = { displayName: formulario.elements.displayName.value };
    if (!formulario.elements.role.disabled && (!usuario || formulario.elements.role.value !== usuario.roles[0])) datos.role = formulario.elements.role.value;
    try {
      if (!usuario) {
        contrasenaValida(formulario);
        datos.username = formulario.elements.username.value;
        datos.password = formulario.elements.password.value;
        datos.passwordConfirmation = formulario.elements.passwordConfirmation.value;
      } else if (datos.role && !confirm('¿Cambiar el perfil y cerrar las sesiones de esta cuenta?')) return;
      bloquear(formulario, true);
      await solicitar(usuario ? `/api/usuarios/${encodeURIComponent(usuario.id)}` : '/api/usuarios', {
        method: usuario ? 'PUT' : 'POST', body: JSON.stringify(datos),
      });
      elemento('#userDialog').close();
      await cargar();
    } catch (error) { mostrarError('#userError', errorFormulario(error)); }
    finally {
      formulario.elements.password.value = formulario.elements.passwordConfirmation.value = '';
      bloquear(formulario, false);
    }
  });

  formularioContrasena.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (formularioContrasena.dataset.saving === 'true' || !formularioContrasena.reportValidity()) return;
    mostrarError('#userPasswordError', '');
    const usuario = usuarioContrasena;
    const esCuentaPropia = String(usuario.id) === String(sesion.id);
    try {
      contrasenaValida(formularioContrasena);
      if (!confirm('¿Cambiar la contraseña y cerrar todas las sesiones de esta cuenta?')) return;
      bloquear(formularioContrasena, true);
      await solicitar(`/api/usuarios/${encodeURIComponent(usuario.id)}/password`, {
        method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(formularioContrasena))),
      });
      elemento('#userPasswordDialog').close();
      if (esCuentaPropia) finalizarSesion('Contraseña actualizada. Inicie sesión con la nueva contraseña.');
      else elemento('#usersMessage').textContent = 'Contraseña actualizada y sesiones cerradas.';
    } catch (error) { mostrarError('#userPasswordError', errorFormulario(error)); }
    finally { formularioContrasena.reset(); bloquear(formularioContrasena, false); }
  });

  async function alternarEstado(usuario, control) {
    const pregunta = usuario.isActive ? '¿Desactivar la cuenta y cerrar sus sesiones? Sus registros se conservarán.' : '¿Activar esta cuenta?';
    if (!confirm(pregunta)) return;
    control.disabled = true;
    try {
      await solicitar(`/api/usuarios/${encodeURIComponent(usuario.id)}`, { method: 'PUT', body: JSON.stringify({ isActive: !usuario.isActive }) });
      await cargar();
    } catch (error) { elemento('#usersMessage').textContent = mensajeError(error); }
    finally { control.disabled = false; }
  }

  document.querySelectorAll('[data-users-close]').forEach(control => control.addEventListener('click', () => control.closest('dialog').close()));
  for (const formularioActual of [formulario, formularioContrasena]) {
    const ventana = formularioActual.closest('dialog');
    ventana.addEventListener('cancel', evento => { if (formularioActual.dataset.saving === 'true') evento.preventDefault(); });
    ventana.addEventListener('close', () => formularioActual.reset());
  }
  dialogo.addEventListener('close', () => { solicitud++; clearTimeout(temporizador); });
  elemento('#importData').addEventListener('click', () => {
    if (!permisos.has('users.manage')) return;
    pagina = 1;
    dialogo.showModal();
    cargar();
  });
  elemento('#newUser').addEventListener('click', () => abrirFormulario());
  elemento('#usersSearch').addEventListener('input', () => {
    clearTimeout(temporizador);
    solicitud++;
    temporizador = setTimeout(() => { pagina = 1; cargar(); }, 250);
  });
  elemento('#usersPrevious').addEventListener('click', () => { pagina--; cargar(); });
  elemento('#usersNext').addEventListener('click', () => { pagina++; cargar(); });
  return { configurar, cerrar };
})();
