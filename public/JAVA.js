// =============================================================
//  JAVA.js — Lógica de la página i24h
//  Aquí se controla todo lo que hace la página:
//  modo oscuro, estrellas, comentarios y login
// =============================================================

// Escapa HTML antes de insertar texto de terceros en innerHTML — sin esto,
// cualquier visitante anónimo podía publicar un comentario con <script> y
// ejecutarlo en el navegador de todo el que cargara el home (XSS público,
// sin necesidad de sesión ni de login).
function escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// =============================================================
//  MENÚ HAMBURGUESA (móvil)
// =============================================================

(function () {
  var btn   = document.getElementById('nav-hamburger');
  var menu  = document.getElementById('nav-links');
  var ico   = document.getElementById('nav-hamburger-ico');
  if (!btn || !menu) return;

  function cerrarMenu() {
    menu.classList.remove('nav-abierto');
    btn.setAttribute('aria-expanded', 'false');
    ico.className = 'ti ti-menu-2';
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var abierto = menu.classList.toggle('nav-abierto');
    btn.setAttribute('aria-expanded', String(abierto));
    ico.className = abierto ? 'ti ti-x' : 'ti ti-menu-2';
  });

  // Cierra al hacer clic fuera del menú
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target) && e.target !== btn) cerrarMenu();
  });

  // Cierra al hacer clic en un link del menú
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', cerrarMenu);
  });
})();


// =============================================================
//  MODO OSCURO
//  Cambia entre tema claro y oscuro al presionar el botón
// =============================================================

const botonTema = document.getElementById('toggle-btn');
const iconoTema = document.getElementById('tico');
const textoTema = document.getElementById('tlbl');

function activarModoOscuro(activar) {
  document.body.classList.toggle('dark', activar);
  document.documentElement.classList.toggle('dark', activar);
  if (iconoTema) iconoTema.className   = activar ? 'ti ti-sun' : 'ti ti-moon';
  if (textoTema) textoTema.textContent = activar ? 'Modo claro' : 'Modo oscuro';
  localStorage.setItem('dark', activar ? '1' : '0');
}

activarModoOscuro(localStorage.getItem('dark') === '1');

botonTema?.addEventListener('click', () => {
  const oscuro = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
  activarModoOscuro(!oscuro);
});


// =============================================================
//  SISTEMA DE ESTRELLAS
//  Permite seleccionar de 1 a 5 estrellas antes de comentar
// =============================================================

let estrellasSeleccionadas = 0;
const botonesEstrellas = document.querySelectorAll('.star-btn');

// Pinta las estrellas activas según el número recibido
function pintarEstrellas(n) {
  botonesEstrellas.forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) <= n));
}

botonesEstrellas.forEach(boton => {
  boton.addEventListener('click',       () => { estrellasSeleccionadas = parseInt(boton.dataset.v); pintarEstrellas(estrellasSeleccionadas); });
  boton.addEventListener('mouseenter',  () => pintarEstrellas(parseInt(boton.dataset.v)));
  boton.addEventListener('mouseleave',  () => pintarEstrellas(estrellasSeleccionadas));
});


// =============================================================
//  COMENTARIOS
//  Carga los comentarios del servidor y permite publicar nuevos
// =============================================================

const listaComentarios = document.getElementById('comments-list');
const campoComentario  = document.getElementById('comment-input');
const botonPublicar    = document.getElementById('submit-comment-btn');
const mensajeEstado    = document.getElementById('msg');

// Convierte una fecha ISO en texto legible ("hace 2 días", etc.)
function tiempoRelativo(fechaISO) {
  const segundos = Math.floor((Date.now() - new Date(fechaISO)) / 1000);
  if (segundos < 60)    return 'ahora mismo';
  if (segundos < 3600)  return `hace ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `hace ${Math.floor(segundos / 3600)} h`;
  const dias = Math.floor(segundos / 86400);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}

// Crea la tarjeta visual de un comentario
function crearTarjetaComentario(c) {
  const estrellas = '★'.repeat(c.estrellas) + '☆'.repeat(5 - c.estrellas);
  const div = document.createElement('div');
  div.className = 'comment-card';
  div.innerHTML = `
    <div class="comment-author-row">
      <div class="avatar"><i class="ti ti-user" aria-hidden="true"></i></div>
      <div>
        <p class="comment-name">Anónimo</p>
        <div class="stars">${estrellas}</div>
      </div>
    </div>
    <p class="comment-text">"${escHtml(c.texto)}"</p>
    <p class="comment-time">${tiempoRelativo(c.fecha)}</p>
  `;
  return div;
}

// Pide los comentarios al servidor y los muestra en pantalla
async function cargarComentarios() {
  try {
    const respuesta = await fetch('/api/comentarios');
    const datos     = await respuesta.json();
    listaComentarios.innerHTML = '';
    datos.forEach(c => listaComentarios.appendChild(crearTarjetaComentario(c)));
  } catch {
    // Si el servidor no está corriendo, los comentarios del HTML se mantienen
  }
}

cargarComentarios(); // Se ejecuta al abrir la página

// Muestra un mensaje de éxito o error debajo del formulario
function mostrarMensaje(texto, tipo) {
  mensajeEstado.textContent   = texto;
  mensajeEstado.className     = 'error-msg ' + tipo;
  mensajeEstado.style.display = 'block';
  setTimeout(() => { mensajeEstado.style.display = 'none'; }, 3500);
}

// Publica un comentario nuevo al presionar el botón
botonPublicar.addEventListener('click', async () => {
  const texto = campoComentario.value.trim();
  if (!texto)                { mostrarMensaje('Escribe un comentario antes de publicar.', 'error'); return; }
  if (!estrellasSeleccionadas) { mostrarMensaje('Selecciona una calificación con estrellas.', 'error'); return; }

  try {
    const respuesta = await fetch('/api/comentarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, estrellas: estrellasSeleccionadas })
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) { mostrarMensaje(datos.error, 'error'); return; }

    listaComentarios.prepend(crearTarjetaComentario(datos)); // Agrega el comentario al inicio
    campoComentario.value     = '';
    estrellasSeleccionadas    = 0;
    pintarEstrellas(0);
    mostrarMensaje('¡Comentario publicado!', 'success');
  } catch {
    mostrarMensaje('No se pudo conectar al servidor.', 'error');
  }
});


// =============================================================
//  MODALES
// =============================================================

// Abre un modal por su id
function abrirModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

// Cierra un modal por su id
function cerrarModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

// Clic en el fondo oscuro cierra el modal
// Los modales solo existen en el DOM cuando no hay sesión (Handlebars los omite si logueado)
['modal-elegir', 'modal-cliente'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', e => {
    if (e.target === e.currentTarget) cerrarModal(id);
  });
});

document.getElementById('cerrar-modal-elegir')?.addEventListener('click',  () => cerrarModal('modal-elegir'));
document.getElementById('cerrar-modal-cliente')?.addEventListener('click', () => cerrarModal('modal-cliente'));

document.getElementById('regresar-modal-cliente')?.addEventListener('click', () => {
  cerrarModal('modal-cliente');
  abrirModal('modal-elegir');
});

document.getElementById('btn-ir-cliente')?.addEventListener('click', () => {
  cerrarModal('modal-elegir');
  abrirModal('modal-cliente');
});

// "Soy empleado" no es un registro — los empleados ya tienen cuenta, así
// que esto solo cierra el modal y lleva al formulario de login de abajo
// (antes apuntaba a /panel a secas, que sin sesión rebota al home sin
// ningún aviso — se sentía como que el botón no hacía nada).
document.getElementById('btn-ir-empleado')?.addEventListener('click', () => {
  cerrarModal('modal-elegir');
  document.querySelector('.access-grid')?.scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => document.querySelector('.login-box .inp')?.focus(), 400);
});


// =============================================================
//  REGISTRO DE CLIENTE
//  Crea la cuenta con el código de acceso y deja al usuario logueado
// =============================================================

document.getElementById('btn-registrar-cliente')?.addEventListener('click', async () => {
  const correo    = document.getElementById('reg-correo')?.value.trim();
  const password  = document.getElementById('reg-password')?.value;
  const password2 = document.getElementById('reg-password2')?.value;
  const codigo    = document.getElementById('reg-codigo')?.value.trim();
  const msgEl     = document.getElementById('reg-msg');
  const btn       = document.getElementById('btn-registrar-cliente');

  const mostrarRegMsg = (texto, tipo) => {
    if (!msgEl) return;
    msgEl.textContent   = texto;
    msgEl.className     = 'error-msg' + (tipo === 'ok' ? ' success' : '');
    msgEl.style.display = 'block';
  };

  if (!correo || !password || !password2 || !codigo) return mostrarRegMsg('Completa todos los campos.');
  if (password.length < 6)  return mostrarRegMsg('La contraseña debe tener al menos 6 caracteres.');
  if (password !== password2) return mostrarRegMsg('Las contraseñas no coinciden.');

  btn.disabled = true;
  try {
    const respuesta = await fetch('/api/registro', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ correo, password, codigo }),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) { mostrarRegMsg(datos.error || 'Error al crear la cuenta.'); btn.disabled = false; return; }

    mostrarRegMsg('¡Cuenta creada! Redirigiendo…', 'ok');
    localStorage.setItem('sesion', JSON.stringify(datos));
    setTimeout(() => { window.location.href = '/cliente'; }, 800);
  } catch (err) {
    console.error('Error en registro:', err);
    mostrarRegMsg('No se pudo conectar al servidor.');
    btn.disabled = false;
  }
});


// =============================================================
//  BOTONES DEL HERO (parte superior de la página)
//  Solo existen en el DOM cuando NO hay sesión activa
// =============================================================

document.getElementById('crear-cuenta')?.addEventListener('click', () => {
  abrirModal('modal-elegir');
});

document.getElementById('iniciar-sesion')?.addEventListener('click', () => {
  document.querySelector('.access-grid')?.scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => document.querySelector('.login-box .inp')?.focus(), 400);
});


// =============================================================
//  LOGIN
//  Envía correo y contraseña al servidor para verificar
// =============================================================

document.getElementById('login-btn')?.addEventListener('click', async () => {
  const correo   = document.querySelectorAll('.login-box .inp')[0].value.trim();
  const password = document.querySelectorAll('.login-box .inp')[1].value.trim();
  if (!correo || !password) { alert('Completa correo y contraseña.'); return; }

  try {
    const respuesta = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, password })
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) { alert(datos.error); return; }

    // Guarda la sesión — el nav se actualiza al recargar vía /api/sesion
    localStorage.setItem('sesion', JSON.stringify(datos));
    // Recarga para que el servidor renderice la vista con la sesión activa
    window.location.reload();
  } catch (err) {
    console.error('Error en login:', err);
    alert('No se pudo conectar al servidor.');
  }
});


// =============================================================
//  DROPDOWN DE USUARIO EN EL NAV
//  Muestra nombre y rol del usuario logueado.
//  Abre/cierra al hacer clic en el botón.
//  Cierra solo al hacer clic fuera.
// =============================================================

const elNavAuth    = document.getElementById('nav-auth');
const elNavUsuario = document.getElementById('nav-usuario');
const elNavBtn     = document.getElementById('nav-usuario-btn');
const elDropdown   = document.getElementById('nav-dropdown');

// Roles que tienen acceso al panel de administración
const ROLES_CON_PANEL = new Set(['admin', 'coordinador', 'lider', 'encargado']);

// Llena el dropdown con los datos del usuario y alterna los bloques del nav
function aplicarSesion(usuario) {
  if (!usuario) return;

  // Iniciales para el avatar (primera letra del nombre o del correo)
  const fuente  = usuario.nombre || usuario.correo || '?';
  const inicial = fuente.trim()[0].toUpperCase();

  // Llenar elementos del botón principal
  document.getElementById('nav-avatar').textContent  = inicial;
  document.getElementById('nav-nombre').textContent  = usuario.nombre || usuario.correo;
  document.getElementById('nav-rol').textContent     = usuario.cargo  || 'cliente';

  // Llenar encabezado del dropdown
  document.getElementById('dd-nombre').textContent  = usuario.nombre  || '—';
  document.getElementById('dd-correo').textContent  = usuario.correo  || '—';
  document.getElementById('dd-puntos').innerHTML    =
    `<i class="ti ti-star-filled" aria-hidden="true"></i> ${usuario.puntos ?? 0} puntos`;

  // Mostrar "Panel de administración" solo si el cargo lo permite
  document.querySelector('.item-panel').style.display =
    ROLES_CON_PANEL.has(usuario.cargo) ? '' : 'none';

  // Cambiar bloques del nav: ocultar auth, mostrar usuario
  elNavAuth.style.display    = 'none';
  elNavUsuario.style.display = '';
}

// Abre o cierra el dropdown al hacer clic en el botón del usuario
elNavBtn.addEventListener('click', () => {
  const abierto = elDropdown.classList.toggle('visible');
  elNavBtn.classList.toggle('abierto', abierto);
  elNavBtn.setAttribute('aria-expanded', abierto);
});

// Cierra el dropdown al hacer clic en cualquier parte fuera de él
document.addEventListener('click', (e) => {
  if (!elNavUsuario.contains(e.target)) {
    elDropdown.classList.remove('visible');
    elNavBtn.classList.remove('abierto');
    elNavBtn.setAttribute('aria-expanded', 'false');
  }
});

// Cierra el dropdown al presionar Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    elDropdown.classList.remove('visible');
    elNavBtn.classList.remove('abierto');
    elNavBtn.setAttribute('aria-expanded', 'false');
    elNavBtn.focus();
  }
});

// Cerrar sesión — destruye sesión en servidor y redirige al inicio
document.getElementById('btn-cerrar-sesion-nav')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  localStorage.removeItem('sesion');
  window.location.href = '/';
});

// Botones del nav sin sesión abren el modal o hacen scroll al login
document.getElementById('btn-login-nav')?.addEventListener('click', () => {
  document.querySelector('.access-grid').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => document.querySelector('.login-box .inp').focus(), 400);
});

document.getElementById('btn-registro-nav')?.addEventListener('click', () => {
  abrirModal('modal-elegir');
});


// =============================================================
//  PANEL DEL CLIENTE — Canje de recompensas
//  Solo aplica en /cliente, donde existen los elementos de canje
// =============================================================

let canjeActual = null; // Guarda la recompensa seleccionada antes de confirmar

// Abre el modal de confirmación al hacer clic en cualquier botón "Canjear"
document.querySelectorAll('.btn-canjear').forEach(btn => {
  btn.addEventListener('click', () => {
    canjeActual = {
      id:     btn.dataset.id,
      nombre: btn.dataset.nombre,
      puntos: parseInt(btn.dataset.puntos, 10),
    };
    document.getElementById('canje-nombre-reward').textContent = canjeActual.nombre;
    document.getElementById('canje-puntos-costo').textContent  = canjeActual.puntos;
    abrirModal('modal-canje');
  });
});

// Cierra el modal de canje sin hacer nada
document.getElementById('cerrar-modal-canje')?.addEventListener('click',   () => cerrarModal('modal-canje'));
document.getElementById('btn-cancelar-canje')?.addEventListener('click',   () => cerrarModal('modal-canje'));
document.getElementById('modal-canje')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) cerrarModal('modal-canje');
});

// Confirma el canje: llama al servidor y actualiza puntos en pantalla sin recargar
document.getElementById('btn-confirmar-canje')?.addEventListener('click', async () => {
  if (!canjeActual) return;

  const btn     = document.getElementById('btn-confirmar-canje');
  const msgEl   = document.getElementById('canje-msg');
  btn.disabled  = true;
  btn.textContent = 'Canjeando…';

  try {
    const respuesta = await fetch('/api/canjear', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ recompensaId: canjeActual.id }),
    });
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      msgEl.textContent   = datos.error;
      msgEl.style.display = 'block';
      btn.disabled        = false;
      btn.textContent     = 'Sí, canjear ↗';
      return;
    }

    // Actualiza los contadores de puntos en pantalla sin recargar la página
    const nuevoPuntaje = datos.puntosRestantes;
    document.getElementById('puntos-display')?.textContent      && (document.getElementById('puntos-display').textContent = nuevoPuntaje);
    document.getElementById('puntos-recompensas')?.textContent  && (document.getElementById('puntos-recompensas').textContent = nuevoPuntaje);
    document.getElementById('dd-puntos') && (document.getElementById('dd-puntos').innerHTML =
      `<i class="ti ti-star-filled" aria-hidden="true"></i> ${nuevoPuntaje} puntos`);

    // Bloquea las tarjetas de recompensas que ya no se pueden canjear
    document.querySelectorAll('.recompensa-card').forEach(card => {
      const costoPts = parseInt(card.querySelector('.recompensa-puntos')?.textContent, 10);
      if (costoPts > nuevoPuntaje) card.classList.add('recompensa-bloqueada');
    });

    cerrarModal('modal-canje');
    canjeActual = null;
    alert(`✓ ¡Canje exitoso! Recompensa: ${datos.recompensa}`);
  } catch {
    msgEl.textContent   = 'No se pudo conectar al servidor.';
    msgEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sí, canjear ↗';
  }
});

// Enviar calificación de empleado (usa el mismo endpoint de comentarios)
document.getElementById('btn-calificar-emp')?.addEventListener('click', async () => {
  const texto    = document.getElementById('emp-comment')?.value.trim();
  const msgEl    = document.getElementById('emp-msg');
  const estrellas = document.querySelectorAll('#star-row-emp .star-btn.active').length;

  if (!texto)     { msgEl.textContent = 'Escribe un comentario.'; msgEl.style.display = 'block'; return; }
  if (!estrellas) { msgEl.textContent = 'Selecciona una calificación.'; msgEl.style.display = 'block'; return; }

  try {
    const resp = await fetch('/api/comentarios', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ texto, estrellas }),
    });
    if (resp.ok) {
      document.getElementById('emp-comment').value = '';
      msgEl.textContent   = '¡Gracias por tu calificación!';
      msgEl.className     = 'error-msg success';
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
    }
  } catch { /* silent */ }
});

// Estrellas del formulario de empleado (reutiliza la lógica de pintarEstrellas si existe)
document.querySelectorAll('#star-row-emp .star-btn').forEach(btn => {
  let selEmp = 0;
  btn.addEventListener('click',      () => { selEmp = parseInt(btn.dataset.v); pintarEstrellasSel('#star-row-emp', selEmp); });
  btn.addEventListener('mouseenter', () => pintarEstrellasSel('#star-row-emp', parseInt(btn.dataset.v)));
  btn.addEventListener('mouseleave', () => pintarEstrellasSel('#star-row-emp', selEmp));
});

function pintarEstrellasSel(selector, n) {
  document.querySelectorAll(`${selector} .star-btn`).forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.v) <= n)
  );
}

// Buscador del catálogo de precios (panel de cliente) — filtro puramente
// visual en el cliente, sin llamadas al servidor.
function filtrarCatalogo(texto) {
  const q = texto.trim().toLowerCase();
  let algunResultado = false;

  document.querySelectorAll('[data-catalogo-cat]').forEach(bloqueCat => {
    let algunoEnCategoria = false;
    bloqueCat.querySelectorAll('[data-catalogo-fila]').forEach(fila => {
      const coincide = fila.dataset.nombre.toLowerCase().includes(q);
      fila.style.display = coincide ? '' : 'none';
      if (coincide) algunoEnCategoria = true;
    });
    bloqueCat.style.display = algunoEnCategoria ? '' : 'none';
    if (algunoEnCategoria) algunResultado = true;
  });

  const msgVacio = document.getElementById('catalogo-sin-resultados');
  if (msgVacio) msgVacio.style.display = algunResultado ? 'none' : 'block';
}
window.filtrarCatalogo = filtrarCatalogo;

// Al cargar la página consulta el servidor para saber si hay sesión activa.
// Si la hay, aplica el dropdown sin pedirle al usuario que vuelva a loguearse.
(async () => {
  try {
    const res  = await fetch('/api/sesion');
    const user = await res.json();
    if (user) {
      localStorage.setItem('sesion', JSON.stringify(user));
      aplicarSesion(user);
    } else {
      localStorage.removeItem('sesion');
    }
  } catch {
    // Sin servidor: intenta con lo que hay en localStorage como respaldo
    const guardado = localStorage.getItem('sesion');
    if (guardado) { try { aplicarSesion(JSON.parse(guardado)); } catch { localStorage.removeItem('sesion'); } }
  }
})();
