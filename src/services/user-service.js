const database = require('../config/database');
const repositorio = require('../repositories/user-repository');
const { hashPassword } = require('../utils/passwords');
const { parseId } = require('../utils/validation');
const { ApplicationError } = require('../utils/application-error');

const PERFILES = ['administrador', 'medico', 'secretario', 'visualizador'];

function rechazar(codigo, mensaje, estado = 422) {
  throw new ApplicationError(estado, codigo, mensaje, { includeRequestId: true });
}

function validarObjeto(datos, campos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)
      || !Object.keys(datos).length || Object.keys(datos).some(campo => !campos.includes(campo))) {
    rechazar('INVALID_USER', 'Revise los campos de la solicitud.');
  }
}

function validarNombre(nombre) {
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 200) {
    rechazar('INVALID_USER', 'El nombre es obligatorio y admite hasta 200 caracteres.');
  }
  return nombre.trim();
}

function validarContrasena(datos) {
  if (typeof datos.password !== 'string' || Array.from(datos.password).length < 12 || datos.password.length > 1024) {
    rechazar('INVALID_PASSWORD', 'La contraseña debe tener al menos 12 caracteres y no superar el máximo de 1024.');
  }
  if (datos.password !== datos.passwordConfirmation) rechazar('PASSWORD_MISMATCH', 'Las contraseñas no coinciden.');
}

function validarId(id) {
  if (!parseId(id)) rechazar('INVALID_ID', 'El identificador de usuario no es válido.', 400);
}

function exigirPermiso(permisos, permiso) {
  if (!permisos.includes(permiso)) rechazar('FORBIDDEN', 'No tiene permiso para realizar esta operación.', 403);
}

async function resolverRol(conexion, codigo) {
  if (!PERFILES.includes(codigo)) rechazar('INVALID_ROLE', 'Seleccione uno de los perfiles generales disponibles.');
  const rol = await repositorio.obtenerRol(conexion, codigo);
  if (!rol) rechazar('ROLE_NOT_CONFIGURED', 'El perfil aún no está configurado. Consulte al responsable del sistema.', 409);
  return rol.id;
}

function serializar(usuario, roles) {
  return { id: String(usuario.id), username: usuario.username, displayName: usuario.display_name,
    isActive: Boolean(usuario.is_active), roles };
}

async function permisosActuales(idUsuario) {
  return { permissions: await repositorio.obtenerPermisos(database.getPool(), idUsuario) };
}

async function listar(consulta) {
  const pagina = consulta.page === undefined ? 1 : Number(consulta.page);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 1000000
      || (consulta.search !== undefined && (typeof consulta.search !== 'string' || consulta.search.length > 200))) {
    rechazar('INVALID_QUERY', 'La búsqueda o la página no es válida.', 400);
  }
  const filas = await repositorio.listar((consulta.search || '').trim(), 50, (pagina - 1) * 50);
  const usuarios = new Map();
  for (const fila of filas) {
    const id = String(fila.id);
    if (!usuarios.has(id)) usuarios.set(id, serializar(fila, []));
    if (fila.role_code) usuarios.get(id).roles.push(fila.role_code);
  }
  return { data: [...usuarios.values()], page: pagina, pageSize: 50 };
}

async function enTransaccion(contexto, operacion) {
  const conexion = await database.getPool().getConnection();
  try {
    await conexion.beginTransaction();
    if (!await repositorio.bloquearAdministracion(conexion)) {
      rechazar('ROLE_NOT_CONFIGURED', 'El perfil administrador no está configurado.', 409);
    }
    // Revalidar dentro del bloqueo evita que una solicitud ya autorizada conserve permisos revocados.
    const permisos = await repositorio.obtenerPermisos(conexion, contexto.userId);
    exigirPermiso(permisos, 'users.manage');
    const resultado = await operacion(conexion, permisos);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function crear(datos, contexto) {
  validarObjeto(datos, ['username', 'displayName', 'role', 'password', 'passwordConfirmation']);
  if (typeof datos.username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(datos.username.trim())) {
    rechazar('INVALID_USER', 'El usuario debe tener entre 3 y 100 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const nombre = validarNombre(datos.displayName);
  validarContrasena(datos);
  return enTransaccion(contexto, async (conexion, permisos) => {
    exigirPermiso(permisos, 'roles.manage');
    const idRol = await resolverRol(conexion, datos.role);
    const hash = await hashPassword(datos.password);
    const id = await repositorio.crear(conexion, { username: datos.username.trim(), displayName: nombre }, hash);
    await repositorio.asignarRol(conexion, id, idRol);
    await repositorio.auditar(conexion, contexto, 'users.create', id);
    return { data: serializar({ id, username: datos.username.trim(), display_name: nombre, is_active: true }, [datos.role]) };
  });
}

async function actualizar(id, datos, contexto) {
  validarId(id);
  validarObjeto(datos, ['displayName', 'isActive', 'role']);
  if (datos.displayName !== undefined) validarNombre(datos.displayName);
  if (datos.isActive !== undefined && typeof datos.isActive !== 'boolean') rechazar('INVALID_USER', 'El estado debe ser verdadero o falso.');
  return enTransaccion(contexto, async (conexion, permisos) => {
    const usuario = await repositorio.obtener(conexion, id);
    if (!usuario) rechazar('USER_NOT_FOUND', 'No se encontró el usuario.', 404);
    const roles = await repositorio.obtenerRoles(conexion, id);
    const activo = datos.isActive ?? Boolean(usuario.is_active);
    const nombre = datos.displayName === undefined ? usuario.display_name : validarNombre(datos.displayName);
    let idRol;
    if (datos.role !== undefined) {
      exigirPermiso(permisos, 'roles.manage');
      idRol = await resolverRol(conexion, datos.role);
      if (roles.length !== 1 || !PERFILES.includes(roles[0])) {
        rechazar('ROLE_ASSIGNMENT_UNSUPPORTED', 'Esta cuenta tiene una asignación técnica o múltiple. Sus roles deben conservarse.', 409);
      }
    }
    const cambiaRol = datos.role !== undefined && datos.role !== roles[0];
    const pierdeAdministracion = roles.includes('administrador') && (!activo || (cambiaRol && datos.role !== 'administrador'));
    if (String(contexto.userId) === id && (!activo || pierdeAdministracion)) {
      rechazar('SELF_ADMIN_PROTECTION', 'No puede desactivar su propia cuenta ni quitarse el perfil administrador.', 409);
    }
    if (usuario.is_active && pierdeAdministracion && await repositorio.contarAdministradoresActivos(conexion) <= 1) {
      rechazar('LAST_ADMIN_PROTECTION', 'Debe conservar al menos un administrador activo.', 409);
    }
    await repositorio.actualizar(conexion, id, nombre, activo);
    if (cambiaRol) await repositorio.reemplazarRol(conexion, id, idRol);
    if (!activo || cambiaRol) await repositorio.cerrarSesiones(conexion, id);
    await repositorio.auditar(conexion, contexto, 'users.update', id);
    return { data: serializar({ ...usuario, display_name: nombre, is_active: activo }, cambiaRol ? [datos.role] : roles) };
  });
}

async function cambiarContrasena(id, datos, contexto) {
  validarId(id);
  validarObjeto(datos, ['password', 'passwordConfirmation']);
  validarContrasena(datos);
  return enTransaccion(contexto, async conexion => {
    if (!await repositorio.obtener(conexion, id)) rechazar('USER_NOT_FOUND', 'No se encontró el usuario.', 404);
    const hash = await hashPassword(datos.password);
    const resultado = await repositorio.cambiarContrasena(conexion, id, hash);
    if (Number(resultado.affectedRows) !== 1) throw new Error('USER_PASSWORD_UPDATE_FAILED');
    await repositorio.cerrarSesiones(conexion, id);
    await repositorio.auditar(conexion, contexto, 'users.password_reset', id);
  });
}

module.exports = { listar, crear, actualizar, cambiarContrasena, permisosActuales };
