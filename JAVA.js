// =============================================================
//  JAVA.js — Lógica de la página i24h
//  Aquí se controla todo lo que hace la página:
//  modo oscuro, estrellas, comentarios y login
// =============================================================


// =============================================================
//  MODO OSCURO
//  Cambia entre tema claro y oscuro al presionar el botón
// =============================================================

const botonTema = document.getElementById('toggle-btn');
const iconoTema = document.getElementById('tico');
const textoTema = document.getElementById('tlbl');

function activarModoOscuro(activar) {
  document.body.classList.toggle('dark', activar);
  iconoTema.className   = activar ? 'ti ti-sun' : 'ti ti-moon';
  textoTema.textContent = activar ? 'Modo claro' : 'Modo oscuro';
  localStorage.setItem('dark', activar ? '1' : '0'); // Recuerda la preferencia aunque cierres el navegador
}

// Al cargar la página, revisa si el usuario ya tenía el modo oscuro activado
activarModoOscuro(localStorage.getItem('dark') === '1');

botonTema.addEventListener('click', () => {
  activarModoOscuro(!document.body.classList.contains('dark'));
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
    <p class="comment-text">"${c.texto}"</p>
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
['modal-elegir', 'modal-cliente'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === e.currentTarget) cerrarModal(id);
  });
});

// Botones de cerrar (X)
document.getElementById('cerrar-modal-elegir').addEventListener('click',  () => cerrarModal('modal-elegir'));
document.getElementById('cerrar-modal-cliente').addEventListener('click', () => cerrarModal('modal-cliente'));

// "← Regresar" en el modal de cliente vuelve al selector
document.getElementById('regresar-modal-cliente').addEventListener('click', () => {
  cerrarModal('modal-cliente');
  abrirModal('modal-elegir');
});

// Botón "Soy cliente" → va al modal de registro
document.getElementById('btn-ir-cliente').addEventListener('click', () => {
  cerrarModal('modal-elegir');
  abrirModal('modal-cliente');
});


// =============================================================
//  BOTONES DEL HERO (parte superior de la página)
// =============================================================

// Botón "Crear cuenta" → abre el modal selector
document.getElementById('crear-cuenta').addEventListener('click', () => {
  abrirModal('modal-elegir');
});

// Botón "Iniciar sesión" — hace scroll hasta el formulario de login
document.getElementById('iniciar-sesion').addEventListener('click', () => {
  document.querySelector('.access-grid').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => document.querySelector('.login-box .inp').focus(), 400);
});


// =============================================================
//  LOGIN
//  Envía correo y contraseña al servidor para verificar
// =============================================================

document.getElementById('login-btn').addEventListener('click', async () => {
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
    alert('¡Bienvenido, ' + datos.correo + '!');
  } catch {
    alert('No se pudo conectar al servidor.');
  }
});
