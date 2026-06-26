// =============================================================
//  panel.js — Lógica del portal de empleados i24h
//  Controla: login, tabs, empleados, clientes y códigos
// =============================================================


// =============================================================
//  MODO OSCURO
//  Se aplica desde localStorage para que persista entre páginas
// =============================================================

const botonTema = document.getElementById('toggle-btn-panel');
const icoPanel  = document.getElementById('tico-panel');
const lblPanel  = document.getElementById('tlbl-panel');

function aplicarModoOscuro(activar) {
  document.body.classList.toggle('dark', activar);
  document.documentElement.classList.toggle('dark', activar);
  localStorage.setItem('dark', activar ? '1' : '0');
  if (icoPanel) icoPanel.className = activar ? 'ti ti-sun' : 'ti ti-moon';
  if (lblPanel) lblPanel.textContent = activar ? 'Modo claro' : 'Modo oscuro';
}

aplicarModoOscuro(localStorage.getItem('dark') === '1');

if (botonTema) {
  botonTema.addEventListener('click', () => {
    const oscuro = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
    aplicarModoOscuro(!oscuro);
  });
}


// =============================================================
//  SESIÓN DEL EMPLEADO
//  Se guarda en sessionStorage (se borra al cerrar la pestaña)
// =============================================================

// Cargos y qué cargos puede crear cada uno
const PERMISOS = {
  admin:       ['admin', 'coordinador', 'lider', 'encargado', 'colaborador'],
  coordinador: ['coordinador', 'lider', 'encargado', 'colaborador'],
  lider:       ['lider', 'encargado', 'colaborador'],
  encargado:   ['encargado', 'colaborador'],
  colaborador: [],
};

// Nombres de los cargos para mostrar en pantalla
const NOMBRE_CARGO = {
  admin:       'Admin',
  coordinador: 'Coordinador',
  lider:       'Líder',
  encargado:   'Encargado',
  colaborador: 'Colaborador',
  cliente:     'Cliente',
};

function obtenerSesion() {
  const datos = sessionStorage.getItem('empleado');
  return datos ? JSON.parse(datos) : null;
}

function guardarSesion(usuario) {
  sessionStorage.setItem('empleado', JSON.stringify(usuario));
}

function cerrarSesion() {
  sessionStorage.removeItem('empleado');
  mostrarPantalla('pantalla-login');
}


// =============================================================
//  PANTALLAS
//  Alterna entre la pantalla de login y el panel principal
// =============================================================

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach(p => p.classList.add('oculto'));
  document.getElementById(id).classList.remove('oculto');
}

// Al cargar la página verifica si ya hay sesión activa
const sesionActual = obtenerSesion();
if (sesionActual) {
  iniciarPanel(sesionActual);
} else {
  mostrarPantalla('pantalla-login');
}


// =============================================================
//  LOGIN DE EMPLEADO
// =============================================================

const btnLoginEmpleado = document.getElementById('btn-login-empleado');
const loginMsg         = document.getElementById('login-msg');

btnLoginEmpleado.addEventListener('click', async () => {
  const correo   = document.getElementById('emp-correo').value.trim();
  const password = document.getElementById('emp-password').value.trim();

  if (!correo || !password) { mostrarMensaje(loginMsg, 'Completa todos los campos.', 'error'); return; }

  try {
    const respuesta = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ correo, password }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok)              { mostrarMensaje(loginMsg, datos.error, 'error'); return; }
    if (datos.cargo === 'cliente')  { mostrarMensaje(loginMsg, 'Esta cuenta no tiene acceso al panel.', 'error'); return; }

    guardarSesion(datos);
    iniciarPanel(datos);
  } catch {
    mostrarMensaje(loginMsg, 'No se pudo conectar al servidor.', 'error');
  }
});

// Permite presionar Enter en el campo de contraseña para hacer login
document.getElementById('emp-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') btnLoginEmpleado.click();
});


// =============================================================
//  INICIAR PANEL — se llama después del login exitoso
// =============================================================

function iniciarPanel(usuario) {
  mostrarPantalla('pantalla-panel');

  // Muestra el nombre y cargo del empleado en la barra superior
  document.getElementById('emp-nombre-activo').textContent = usuario.nombre || usuario.correo;
  document.getElementById('emp-cargo-activo').textContent  = NOMBRE_CARGO[usuario.cargo] || usuario.cargo;

  // Oculta tabs según el cargo
  ajustarTabsVisibles(usuario.cargo);

  // Carga el resumen por defecto
  cargarResumen();
}

// Muestra u oculta tabs según lo que puede ver cada cargo
function ajustarTabsVisibles(cargo) {
  const reglas = {
    admin:       ['resumen', 'empleados', 'clientes', 'codigos'],
    coordinador: ['resumen', 'empleados', 'clientes', 'codigos'],
    lider:       ['resumen', 'empleados', 'clientes', 'codigos'],
    encargado:   ['resumen', 'clientes'],
    colaborador: ['resumen'],
  };
  const permitidos = reglas[cargo] || ['resumen'];

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    btn.style.display = permitidos.includes(tab) ? '' : 'none';
  });
}

// Botón cerrar sesión
document.getElementById('btn-cerrar-sesion').addEventListener('click', cerrarSesion);


// =============================================================
//  NAVEGACIÓN ENTRE TABS
// =============================================================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    // Marca el botón activo
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');

    // Muestra la sección correspondiente
    document.querySelectorAll('.tab-seccion').forEach(s => s.classList.remove('activo'));
    document.getElementById('tab-' + tab).classList.add('activo');

    // Carga los datos del tab seleccionado
    if (tab === 'resumen')   cargarResumen();
    if (tab === 'empleados') cargarEmpleados();
    if (tab === 'clientes')  cargarClientes();
    if (tab === 'codigos')   cargarCodigos();
  });
});


// =============================================================
//  TAB: RESUMEN — contadores generales
// =============================================================

async function cargarResumen() {
  try {
    const respuesta = await fetch('/api/resumen');
    const datos     = await respuesta.json();

    document.getElementById('total-empleados').textContent  = datos.empleados;
    document.getElementById('total-clientes').textContent   = datos.clientes;
    document.getElementById('total-codigos').textContent    = datos.codigos;
    document.getElementById('total-comentarios').textContent = datos.comentarios;
  } catch {
    console.error('No se pudo cargar el resumen');
  }
}


// =============================================================
//  TAB: EMPLEADOS — lista y creación de cuentas
// =============================================================

async function cargarEmpleados() {
  const cuerpo = document.getElementById('tabla-empleados-cuerpo');
  cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="6">Cargando...</td></tr>';

  try {
    const respuesta = await fetch('/api/empleados');
    const empleados = await respuesta.json();

    if (empleados.length === 0) {
      cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="6">No hay empleados registrados.</td></tr>';
      return;
    }

    cuerpo.innerHTML = empleados.map(emp => `
      <tr>
        <td>${emp.nombre || '—'}</td>
        <td>${emp.correo}</td>
        <td><span class="badge-cargo ${emp.cargo}">${NOMBRE_CARGO[emp.cargo]}</span></td>
        <td>${formatearFecha(emp.fecha)}</td>
        <td><span class="badge-estado ${emp.activo ? 'activo' : 'inactivo'}">${emp.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <button class="btn-o btn-chico" onclick="toggleEstado(${emp.id}, 'empleados')">
            ${emp.activo ? 'Dar de baja' : 'Reactivar'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch {
    cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="6">Error al cargar empleados.</td></tr>';
  }
}

// Mostrar / ocultar el formulario de nuevo empleado
document.getElementById('btn-abrir-form-empleado').addEventListener('click', () => {
  const form    = document.getElementById('form-nuevo-empleado');
  const visible = !form.classList.contains('oculto');
  form.classList.toggle('oculto', visible);

  // Filtra los cargos que puede asignar el empleado logueado
  if (!visible) {
    const usuario  = obtenerSesion();
    const select   = document.getElementById('nemp-cargo');
    const permitidos = PERMISOS[usuario?.cargo] || [];
    Array.from(select.options).forEach(opt => {
      opt.hidden = opt.value && !permitidos.includes(opt.value);
    });
  }
});

document.getElementById('btn-cancelar-form-empleado').addEventListener('click', () => {
  document.getElementById('form-nuevo-empleado').classList.add('oculto');
  limpiarFormEmpleado();
});

// Guardar nuevo empleado
document.getElementById('btn-guardar-empleado').addEventListener('click', async () => {
  const correo   = document.getElementById('nemp-correo').value.trim();
  const password = document.getElementById('nemp-password').value.trim();
  const nombre   = document.getElementById('nemp-nombre').value.trim();
  const cargo    = document.getElementById('nemp-cargo').value;
  const nempMsg  = document.getElementById('nemp-msg');

  if (!correo || !password || !cargo) { mostrarMensaje(nempMsg, 'Completa todos los campos obligatorios.', 'error'); return; }

  try {
    const respuesta = await fetch('/api/empleados', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ correo, password, nombre, cargo }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) { mostrarMensaje(nempMsg, datos.error, 'error'); return; }

    mostrarMensaje(nempMsg, '¡Cuenta creada correctamente!', 'success');
    limpiarFormEmpleado();
    setTimeout(() => {
      document.getElementById('form-nuevo-empleado').classList.add('oculto');
      cargarEmpleados();
    }, 1500);
  } catch {
    mostrarMensaje(nempMsg, 'No se pudo conectar al servidor.', 'error');
  }
});

function limpiarFormEmpleado() {
  ['nemp-correo', 'nemp-password', 'nemp-nombre'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('nemp-cargo').value = '';
  const msg = document.getElementById('nemp-msg');
  msg.style.display = 'none';
}


// =============================================================
//  TAB: CLIENTES — lista de clientes registrados
// =============================================================

async function cargarClientes() {
  const cuerpo = document.getElementById('tabla-clientes-cuerpo');
  cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">Cargando...</td></tr>';

  try {
    const respuesta = await fetch('/api/clientes');
    const clientes  = await respuesta.json();

    if (clientes.length === 0) {
      cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">No hay clientes registrados todavía.</td></tr>';
      return;
    }

    cuerpo.innerHTML = clientes.map(c => `
      <tr>
        <td>${c.correo}</td>
        <td>${c.puntos ?? 0} pts</td>
        <td>${formatearFecha(c.fecha)}</td>
        <td><span class="badge-estado ${c.activo ? 'activo' : 'inactivo'}">${c.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <button class="btn-o btn-chico" onclick="toggleEstado(${c.id}, 'clientes')">
            ${c.activo ? 'Dar de baja' : 'Reactivar'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch {
    cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">Error al cargar clientes.</td></tr>';
  }
}


// =============================================================
//  TAB: CÓDIGOS — generar y revocar códigos de acceso
// =============================================================

async function cargarCodigos() {
  const cuerpo = document.getElementById('tabla-codigos-cuerpo');
  cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">Cargando...</td></tr>';

  try {
    const respuesta = await fetch('/api/codigos');
    const codigos   = await respuesta.json();

    if (codigos.length === 0) {
      cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">No hay códigos generados todavía.</td></tr>';
      return;
    }

    cuerpo.innerHTML = codigos.map(c => `
      <tr>
        <td><span class="codigo-texto">${c.codigo}</span></td>
        <td>${c.creadoPor || '—'}</td>
        <td>${formatearFecha(c.fecha)}</td>
        <td>
          <span class="badge-estado ${c.usado ? 'inactivo' : 'activo'}">
            ${c.usado ? `Usado por ${c.usadoPor || '?'}` : 'Disponible'}
          </span>
        </td>
        <td>
          ${!c.usado
            ? `<button class="btn-o btn-chico" onclick="revocarCodigo(${c.id})">Revocar</button>`
            : '—'
          }
        </td>
      </tr>
    `).join('');
  } catch {
    cuerpo.innerHTML = '<tr class="tabla-vacia"><td colspan="5">Error al cargar códigos.</td></tr>';
  }
}

// Generar un código nuevo
document.getElementById('btn-generar-codigo').addEventListener('click', async () => {
  const usuario = obtenerSesion();

  try {
    const respuesta = await fetch('/api/codigos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ creadoPor: usuario?.correo || 'admin' }),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) { alert(datos.error); return; }

    cargarCodigos();
    cargarResumen();
  } catch {
    alert('No se pudo generar el código.');
  }
});

// Revocar (eliminar) un código disponible
async function revocarCodigo(id) {
  if (!confirm('¿Revocar este código? Ya no podrá usarse.')) return;

  try {
    const respuesta = await fetch(`/api/codigos/${id}`, { method: 'DELETE' });
    const datos     = await respuesta.json();
    if (!respuesta.ok) { alert(datos.error); return; }

    cargarCodigos();
    cargarResumen();
  } catch {
    alert('No se pudo revocar el código.');
  }
}


// =============================================================
//  ACTIVAR / DESACTIVAR CUENTA (empleados y clientes)
// =============================================================

async function toggleEstado(id, tipo) {
  const accion = confirm('¿Cambiar el estado de esta cuenta?');
  if (!accion) return;

  try {
    const respuesta = await fetch(`/api/usuarios/${id}/estado`, { method: 'PATCH' });
    const datos     = await respuesta.json();
    if (!respuesta.ok) { alert(datos.error); return; }

    // Recarga la tabla correspondiente
    if (tipo === 'empleados') cargarEmpleados();
    if (tipo === 'clientes')  cargarClientes();
  } catch {
    alert('No se pudo cambiar el estado.');
  }
}


// =============================================================
//  UTILIDADES
// =============================================================

// Muestra un mensaje de éxito o error en un elemento dado
function mostrarMensaje(elemento, texto, tipo) {
  elemento.textContent   = texto;
  elemento.className     = 'error-msg ' + tipo;
  elemento.style.display = 'block';
  setTimeout(() => { elemento.style.display = 'none'; }, 4000);
}

// Convierte una fecha ISO a formato legible (ej: "25 jun 2026")
function formatearFecha(fechaISO) {
  if (!fechaISO) return '—';
  return new Date(fechaISO).toLocaleDateString('es-MX', {
    day:   'numeric',
    month: 'short',
    year:  'numeric',
  });
}
