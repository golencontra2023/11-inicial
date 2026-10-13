/* =====================================================================
   LÓGICA DEL TABLERO – Gol en Contra
   La configuración (equipos, fixture, clave) está en config.js.

   Índice
     1. Utilidades
     2. Estado (datos del tablero)
     3. Esquemas tácticos
     4. Guardado
     5. Dibujo de la pantalla
     6. Partidos y próximo rival
     7. Arrastrar y soltar jugadores
     8. Edición de jugadores
     9. Fixture y tabla de posiciones (Zona A y Zona B)
    10. Convocatoria (voy / no voy)
    11. Copa de Oro y calculadora de clasificación
    12. Compartir la formación como imagen
    13. Modo oscuro / claro
    14. Botones y arranque
   ===================================================================== */


/* ---------- 1. Utilidades ---------- */

const $  = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

const CLAVE_LOCAL  = "gec";            // nombre usado en localStorage / sessionStorage (formación y resultados)
const CLAVE_ASIST  = "gec-asistencia"; // copia local de la convocatoria
const CLAVE_TEMA   = "gec-tema";       // modo claro / oscuro

// Valores opcionales: si no existen en config.js se usan estos
const LIBRE            = CONFIG.EQUIPO_LIBRE      ?? 16; // equipo "LIBRE" (no cuenta en la tabla)
const CLASIFICAN       = CONFIG.COPA_CLASIFICAN   ?? 4;  // cuántos por zona pasan a la Copa de Oro
const MINIMO_JUGADORES = CONFIG.JUGADORES_MINIMOS ?? 11; // para el aviso de "equipo completo"

function escaparHTML(texto) {
  const reemplazos = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(texto).replace(/[&<>"]/g, c => reemplazos[c]);
}

// Mantiene un porcentaje entre 3 y 97 para que la ficha no salga de la cancha
const limitar = valor => Math.min(97, Math.max(3, valor));

function mostrarMensaje(texto) {
  const caja = $("#msg");
  caja.textContent = texto;
  caja.style.display = texto ? "block" : "none";
}


/* ---------- 2. Estado & Conexión ----------
   Estructura:
     fmt → esquema actual, ej. "4-3-3"
     P   → jugadores { id: { n: número, name: nombre } }
     S   → titulares en cancha [ { p: idJugador, x: %, y: % } ]  (S[0] = arquero)
     B   → suplentes [ idJugador, ... ]
     R   → resultados { "fecha:local-visitante": [golesLocal, golesVisitante] }
     ts  → momento del último guardado
*/

const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
let equipoId = null, tecnicoId = null;
let esTecnico = false;
let estado;
let arrastrando = false; // mientras se arrastra no se aceptan cambios remotos

async function iniciar() {
  const { data: eq, error } = await db.from("equipos")
    .select("id, tecnico_id").eq("slug", CONFIG.EQUIPO_SLUG).single();
  if (error) return mostrarMensaje("No se pudo conectar con la base.");
  equipoId = eq.id; 
  tecnicoId = eq.tecnico_id;
  const { data: { session } } = await db.auth.getSession();
  esTecnico = !!session && session.user.id === tecnicoId;   
}

function estadoInicial() {
  const jugadores = {};
  for (let i = 0; i < 16; i++) {
    jugadores["p" + i] = { n: i + 1, name: "Jugador " + (i + 1) };
  }
  const nuevo = {
    fmt: CONFIG.ESQUEMA_INICIAL,
    P: jugadores,
    S: Array.from({ length: 11 }, (_, i) => ({ p: "p" + i, x: 50, y: 50 })),
    B: ["p11", "p12", "p13", "p14", "p15"],
    R: { ...CONFIG.RESULTADOS_INICIALES },
    ts: 1,
  };
  aplicarEsquema(nuevo, nuevo.fmt);
  return nuevo;
}

function completar(datos) {
  datos.B = datos.B || [];
  datos.R = { ...(datos.R || {}), ...CONFIG.RESULTADOS_INICIALES };
  return datos;
}


/* ---------- 3. Esquemas tácticos ---------- */

// Ubica a los 11 titulares según un esquema "4-3-3". Devuelve false si no es válido.
function aplicarEsquema(datos, esquema) {
  const lineas = esquema.split("-").map(Number);
  const jugadoresDeCampo = lineas.reduce((a, b) => a + b, 0);
  if (lineas.some(isNaN) || jugadoresDeCampo !== 10) return false;

  datos.fmt = esquema;

  // Arquero
  datos.S[0].x = 50;
  datos.S[0].y = 90;

  // Las líneas se reparten de abajo (defensa, y=72%) hacia arriba (ataque, y=14%)
  let k = 1;
  lineas.forEach((cantidad, i) => {
    const y = lineas.length === 1 ? 40 : 72 - i * 58 / (lineas.length - 1);
    for (let j = 0; j < cantidad; j++) {
      datos.S[k].x = cantidad === 1 ? 50 : 8 + j * 84 / (cantidad - 1);
      datos.S[k].y = y;
      k++;
    }
  });
  return true;
}

/* ---------- 4. Guardado ---------- */

function cargarLocal() {
  try {
    estado = completar(JSON.parse(localStorage.getItem(CLAVE_LOCAL)));
  } catch (e) { /* no había nada guardado */ }
  if (!estado) estado = estadoInicial();
}

async function traerDelServidor() {
  const escribiendo = document.activeElement && document.activeElement.matches("#tp input, #tc input, #tc select");
  if (!equipoId || arrastrando || escribiendo) return;
  const { data, error } = await db.from("tableros").select("datos, ts").eq("equipo_id", equipoId).maybeSingle();
  if (error) return mostrarMensaje("Sin conexión: mostrando la última versión guardada.");
  if (data && data.ts > estado.ts) {
    estado = completar(data.datos);
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado));
    dibujar();
  } else if (!data && esTecnico) {
      guardar();
  }
}

async function guardar() {
  estado.ts = Date.now();
  localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado));
  dibujar();
  if (!equipoId || !esTecnico) return;
  const { error } = await db.from("tableros").upsert({ equipo_id: equipoId, datos: estado, ts: estado.ts });
  mostrarMensaje(error ? "No se pudo guardar en línea. Revisá la conexión." : "");
}

/* ---------- 5. Dibujo de la pantalla ---------- */

function dibujar() {
  document.body.classList.toggle("ro", !esTecnico); // ro = solo lectura
  $("#login").textContent = esTecnico ? "Salir modo técnico" : "Entrar como técnico";
  $("#ctl").style.display  = esTecnico ? "flex" : "none";
  $("#addb").style.display = esTecnico ? "" : "none";

  dibujarCancha();
  dibujarSuplentes();
  dibujarEsquemas();
  dibujarProximoPartido();
  dibujarPestanaActiva();
}

// Redibuja solo la pestaña que se está viendo (si no es la de formación)
function dibujarPestanaActiva() {
  if (!$("#tv").hidden) dibujarConvocatoria();
  if (!$("#tp").hidden) dibujarFixture();
  if (!$("#tc").hidden) dibujarCopa();
}

function dibujarCancha() {
  const cancha = $("#pitch");
  cancha.querySelectorAll(".tk").forEach(ficha => ficha.remove());
  estado.S.forEach((titular, i) => {
    const jugador = estado.P[titular.p];
    cancha.insertAdjacentHTML("beforeend", `
      <div class="tk" data-s="${i}" style="left:${titular.x}%;top:${titular.y}%">
        <i>${escaparHTML(jugador.n)}</i><b>${escaparHTML(jugador.name)}</b>
      </div>`);
  });
}

function dibujarSuplentes() {
  $("#bench").innerHTML = estado.B.map((id, i) => `
    <div class="bn" data-b="${i}">
      <i>${escaparHTML(estado.P[id].n)}</i>${escaparHTML(estado.P[id].name)}
    </div>`).join("");
}

function dibujarEsquemas() {
  $("#esquemas").innerHTML = CONFIG.ESQUEMAS.map(esq =>
    `<button class="sec ${esq === estado.fmt ? "on" : ""}" data-f="${esq}">${esq}</button>`
  ).join("");
  $("#fin").value = estado.fmt;
}


/* ---------- 6. Partidos y próximo rival ---------- */

// Convierte el FIXTURE de config.js en una lista de partidos
function listaPartidos() {
  const partidos = [];
  CONFIG.FIXTURE.forEach((zonas, i) => {
    const fecha = i + 1;
    zonas.forEach((texto, zona) => {
      texto.split(" ").forEach(cruce => {
        const [local, visitante] = cruce.split("-").map(Number);
        partidos.push({ fecha, zona, local, visitante, clave: `${fecha}:${local}-${visitante}` });
      });
    });
  });
  return partidos;
}

const juegaMiEquipo = p => p.local === CONFIG.MI_EQUIPO || p.visitante === CONFIG.MI_EQUIPO;
const nombre = numero => CONFIG.EQUIPOS[numero];
const zonaMia = () => CONFIG.MI_EQUIPO <= 8 ? 0 : 1;


function dibujarProximoPartido() {
  const proximo = listaPartidos().find(p => p.zona === 0 && juegaMiEquipo(p) && !estado.R[p.clave]);
  $("#prox").innerHTML = proximo
    ? `Fecha ${proximo.fecha} - Domingo 11 de Octubre - 13:30Hs<br><b>${nombre(proximo.local)} vs ${nombre(proximo.visitante)}</b>`
    : `<b>Fase de grupos terminada</b><br>Copa con los mejores de ambas zonas`;
}


/* ---------- 7. Arrastrar y soltar (solo técnico) ---------- */

document.addEventListener("pointerdown", alPresionar);

function alPresionar(e) {
  if (!esTecnico) return;
  const ficha = e.target.closest(".tk, .bn");
  if (!ficha) return;
  e.preventDefault();
  arrastrando = true;

  const esTitular = ficha.classList.contains("tk");
  const indice    = Number(esTitular ? ficha.dataset.s : ficha.dataset.b);
  const cancha    = $("#pitch").getBoundingClientRect();
  const x0 = e.clientX, y0 = e.clientY;
  let movido = false;

  // El titular se mueve dentro de la cancha; el suplente usa una copia flotante
  let elemento = ficha;
  if (!esTitular) {
    elemento = ficha.cloneNode(true);
    elemento.classList.add("ghost");
  }

  const alMover = ev => {
    if (!movido && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
      movido = true;
      if (!esTitular) document.body.appendChild(elemento);
    }
    if (!movido) return;
    if (esTitular) {
      elemento.style.left = limitar((ev.clientX - cancha.left) / cancha.width  * 100) + "%";
      elemento.style.top  = limitar((ev.clientY - cancha.top)  / cancha.height * 100) + "%";
    } else {
      elemento.style.left = ev.clientX + "px";
      elemento.style.top  = ev.clientY + "px";
    }
  };

  const terminar = () => {
    removeEventListener("pointermove", alMover);
    removeEventListener("pointerup", alSoltar);
    removeEventListener("pointercancel", alCancelar);
    arrastrando = false;
    if (!esTitular) elemento.remove();
  };

  // En celulares el sistema puede cortar el gesto (llamada, scroll, etc.):
  // se descarta el arrastre y la ficha vuelve a su lugar.
  const alCancelar = () => {
    terminar();
    dibujar();
  };

  const alSoltar = ev => {
    terminar();

    if (!movido) {             // fue un toque, no un arrastre
      editarJugador(esTitular, indice);
      return;
    }
    soltarFicha(esTitular, indice, elemento, ev);
    guardar();
  };

  addEventListener("pointermove", alMover);
  addEventListener("pointerup", alSoltar);
  addEventListener("pointercancel", alCancelar);
}

// Decide qué pasa según dónde se soltó la ficha
function soltarFicha(esTitular, indice, elemento, ev) {
  const debajo = document.elementsFromPoint(ev.clientX, ev.clientY);
  const titularDestino = debajo.find(el =>
    el.dataset && el.dataset.s !== undefined && !(esTitular && +el.dataset.s === indice));
  const suplenteDestino = debajo.find(el =>
    el.dataset && el.dataset.b !== undefined && !(!esTitular && +el.dataset.b === indice));

  if (esTitular) {
    const titular = estado.S[indice];
    if (titularDestino) {
      // Titular sobre titular: intercambian posiciones
      const otro = estado.S[+titularDestino.dataset.s];
      [titular.p, otro.p] = [otro.p, titular.p];
    } else if (suplenteDestino) {
      // Titular sobre suplente: cambio
      const b = +suplenteDestino.dataset.b;
      [titular.p, estado.B[b]] = [estado.B[b], titular.p];
    } else {
      // Solo se movió de lugar
      titular.x = parseFloat(elemento.style.left);
      titular.y = parseFloat(elemento.style.top);
    }
  } else if (titularDestino) {
    // Suplente sobre titular: cambio
    const titular = estado.S[+titularDestino.dataset.s];
    [titular.p, estado.B[indice]] = [estado.B[indice], titular.p];
  }
}


/* ---------- 8. Edición de jugadores ---------- */

function editarJugador(esTitular, indice) {
  const id = esTitular ? estado.S[indice].p : estado.B[indice];
  const jugador = estado.P[id];

  const nuevoNombre = prompt("Nombre del jugador (vacío = quitar suplente):", jugador.name);
  if (nuevoNombre === null) return; // canceló

  if (nuevoNombre.trim() === "" && !esTitular) {
    estado.B.splice(indice, 1);
    guardar();
    return;
  }

  const nuevoNumero = prompt("Número de camiseta:", jugador.n);
  if (nuevoNombre.trim()) jugador.name = nuevoNombre.trim().slice(0, 18);
  if (nuevoNumero !== null && nuevoNumero.trim()) jugador.n = nuevoNumero.trim().slice(0, 3);
  guardar();
}

function agregarSuplente() {
  const id = "p" + Date.now();
  estado.P[id] = { n: estado.B.length + 12, name: "Suplente" };
  estado.B.push(id);
  guardar();
}


/* ---------- 9. Fixture y tabla de posiciones ---------- */

// Equipos reales de una zona (Zona A = 1..8, Zona B = 9..16). "LIBRE" no cuenta.
function equiposZona(zona) {
  const lista = [];
  for (let t = 1 + 8 * zona; t <= 8 + 8 * zona; t++) if (t !== LIBRE) lista.push(t);
  return lista;
}

// Partidos de una zona, sin los que tienen a "LIBRE"
function partidosZona(zona) {
  return listaPartidos().filter(m => m.zona === zona && m.local !== LIBRE && m.visitante !== LIBRE);
}

const zonaCompleta = zona => partidosZona(zona).every(m => estado.R[m.clave]);

function calcularTabla(zona) {
  const filas = {};
  equiposZona(zona).forEach(t => {
    filas[t] = { equipo: t, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
  });

  partidosZona(zona)
    .filter(m => estado.R[m.clave])
    .forEach(m => {
      const [gl, gv] = estado.R[m.clave];
      const L = filas[m.local], V = filas[m.visitante];
      L.pj++; V.pj++;
      L.gf += gl; L.gc += gv;
      V.gf += gv; V.gc += gl;
      if (gl > gv)      { L.g++; V.p++; L.pts += 3; }
      else if (gl < gv) { V.g++; L.p++; V.pts += 3; }
      else              { L.e++; V.e++; L.pts++; V.pts++; }
    });

  // Sanciones: puntos descontados desde config.js
  Object.entries(CONFIG.DESCUENTOS || {}).forEach(([equipo, puntos]) => {
    if (filas[equipo]) {
      filas[equipo].pts -= puntos;
      filas[equipo].desc = puntos;
    }
  });

  // Orden: puntos, diferencia de gol, goles a favor
  return Object.values(filas).sort((a, b) =>
    b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf);
}

function htmlTabla(zona) {
  const filas = calcularTabla(zona).map((x, i) => `
    <tr class="${x.equipo === CONFIG.MI_EQUIPO ? "me" : ""} ${i < CLASIFICAN ? "cl" : ""}">
      <td>${i + 1}</td><td class="n">${nombre(x.equipo)}</td>
      <td>${x.pj}</td><td>${x.g}</td><td>${x.e}</td><td>${x.p}</td>
      <td>${x.gf - x.gc}</td><td><b>${x.pts}</b></td>
    </tr>`).join("");
  return `<table>
    <tr><th>#</th><th class="n">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr>
    ${filas}
  </table>`;
}

function htmlPartido(m) {
  const r = estado.R[m.clave];
  const marcador = esTecnico
    ? `<input type="number" min="0" inputmode="numeric" data-k="${m.clave}" value="${r ? r[0] : ""}" aria-label="Goles ${nombre(m.local)}"> -
       <input type="number" min="0" inputmode="numeric" data-k="${m.clave}" value="${r ? r[1] : ""}" aria-label="Goles ${nombre(m.visitante)}">`
    : (r ? `${r[0]} - ${r[1]}` : "vs");
  return `<div class="m ${juegaMiEquipo(m) ? "me" : ""}">
    <span>${nombre(m.local)}</span><span class="sc">${marcador}</span><span>${nombre(m.visitante)}</span>
  </div>`;
}

const golesValidos = v => Math.max(0, parseInt(v, 10) || 0);

function dibujarFixture() {
  const partidos = listaPartidos();

  const fechas = CONFIG.FIXTURE.map((_, i) => {
    const zonas = [0, 1].map(z =>
      `<small><b>Zona ${"AB"[z]}</b></small>` +
      partidos.filter(m => m.fecha === i + 1 && m.zona === z).map(htmlPartido).join("")
    ).join("");
    return `<div class="card"><h2>Fecha ${i + 1}</h2>${zonas}</div>`;
  }).join("");

  $("#tp").innerHTML = `
    <div class="tablas">
      <div class="card tabla"><h2>Posiciones · Zona A</h2>${htmlTabla(0)}</div>
      <div class="card tabla"><h2>Posiciones · Zona B</h2>${htmlTabla(1)}</div>
    </div>
    <p class="ayuda">La marca dorada indica los ${CLASIFICAN} primeros de cada zona, que pasan a la Copa de Oro.</p>
    ${htmlPublicar()}
    <p>Al terminar las 7 fechas, los mejores de cada zona juegan la Copa.</p>
    <div class="fx">${fechas}</div>`;

  // Carga de resultados (solo técnico)
  $("#tp").querySelectorAll("input[data-k]").forEach(campo => campo.onchange = () => {
    const clave = campo.dataset.k;
    const [gl, gv] = [...$("#tp").querySelectorAll(`[data-k="${clave}"]`)].map(x => x.value.trim());

    if (gl !== "" && gv !== "") {
      estado.R[clave] = [golesValidos(gl), golesValidos(gv)];   // los dos marcadores: se guarda
    } else if (gl === "" && gv === "") {
      if (!estado.R[clave]) return;
      delete estado.R[clave];                      // los dos vacíos: se borra el resultado
    } else {
      // Falta uno de los dos: se espera SIN redibujar.
      // (Antes se redibujaba acá y se borraba el número recién escrito.)
      return;
    }
    guardar();
  });

  // Copiar resultados para pegarlos en config.js y subirlos a GitHub
  const copiar = $("#copiarRes");
  if (copiar) copiar.onclick = async () => {
    const texto = $("#codigoRes").value;
    try {
      await navigator.clipboard.writeText(texto);
      copiar.textContent = "¡Copiado!";
    } catch (e) {
      $("#codigoRes").select();   // sin permiso de portapapeles: queda seleccionado para copiar a mano
      copiar.textContent = "Copialo a mano (Ctrl+C)";
    }
    setTimeout(() => copiar.textContent = "Copiar", 2500);
  };
}

// Arma el bloque RESULTADOS_INICIALES listo para pegar en config.js
function codigoResultados() {
  const lineas = listaPartidos()
    .filter(m => estado.R[m.clave])
    .map(m => {
      const [gl, gv] = estado.R[m.clave];
      return `    "${m.clave}": [${gl}, ${gv}],`.padEnd(26) + `// ${nombre(m.local)} vs ${nombre(m.visitante)}`;
    });
  return `  RESULTADOS_INICIALES: {\n${lineas.join("\n")}\n  },`;
}

function htmlPublicar() {
  if (!esTecnico) return "";
  return `<details class="card publicar">
    <summary><b>Copiar y Pegar resultados en Repositorio</b></summary>
    <textarea id="codigoRes" readonly rows="8">${escaparHTML(codigoResultados())}</textarea>
    <button id="copiarRes">Copiar</button>
  </details>`;
}

/* ---------- 10. Convocatoria (voy / no voy) ---------- */

let asistencia = {};
let asistCambios = 0;
let asistPendientes = 0;
let fechaConv = null;

try { asistencia = JSON.parse(localStorage.getItem(CLAVE_ASIST)) || {}; } catch (e) { asistencia = {}; }

const guardarAsistLocal = () => localStorage.setItem(CLAVE_ASIST, JSON.stringify(asistencia));
const claveFecha = fecha => "f" + fecha;
const respuestaDe = (fecha, id) => (asistencia[claveFecha(fecha)] || {})[id] || null;

function proximaFecha() {
  const p = listaPartidos().find(p => juegaMiEquipo(p) && !estado.R[p.clave]);
  return p ? p.fecha : CONFIG.FIXTURE.length;
}

async function marcarAsistencia(fecha, id, valor) {
  const kf = claveFecha(fecha);
  const nuevo = respuestaDe(fecha, id) === valor ? null : valor;

  asistencia[kf] = asistencia[kf] || {};
  if (nuevo) asistencia[kf][id] = nuevo; else delete asistencia[kf][id];
  asistCambios++;
  guardarAsistLocal();
  dibujarConvocatoria();

  if (!equipoId) return;
  asistPendientes++;
  try {
    const { error } = nuevo  
      ? await db.from("asistencia").upsert({ equipo_id: equipoId, fecha, jugador_id: id, valor: nuevo })  
      : await db.from("asistencia").delete().match({ equipo_id: equipoId, fecha, jugador_id: id });
    
    if (error) throw error;
    mostrarMensaje("");
  } catch (e) {
    mostrarMensaje("No se pudo guardar la asistencia en línea. Revisá la conexión.");
  } finally {
    asistPendientes--;
  }
}

async function traerAsistencia() {
    if (!equipoId) return;
    const { data, error } = await db.from("asistencia").select("fecha, jugador_id, valor").eq("equipo_id", equipoId);
    if (error) return;
    
    const remoto = {};
    data.forEach(r => (remoto["f" + r.fecha] ??= {})[r.jugador_id] = r.valor);
    
    if (JSON.stringify(remoto) !== JSON.stringify(asistencia)) {
        asistencia = remoto;
        guardarAsistLocal();
        if (!$("#tv").hidden) dibujarConvocatoria();
    }
}

function dibujarConvocatoria() {
  const fecha = fechaConv ?? proximaFecha();
  const partido = listaPartidos().find(p => p.fecha === fecha && juegaMiEquipo(p));

  const titulares = new Set(estado.S.map(s => s.p));
  const ids = [...estado.S.map(s => s.p), ...estado.B]
    .filter((id, i, arr) => estado.P[id] && arr.indexOf(id) === i)
    .sort((a, b) => (parseInt(estado.P[a].n, 10) || 999) - (parseInt(estado.P[b].n, 10) || 999));

  const van = [], noVan = [], sinResp = [];
  ids.forEach(id => {
    const r = respuestaDe(fecha, id);
    (r === "v" ? van : r === "n" ? noVan : sinResp).push(estado.P[id].name);
  });

  const opciones = CONFIG.FIXTURE.map((_, i) =>
    `<option value="${i + 1}" ${i + 1 === fecha ? "selected" : ""}>Fecha ${i + 1}</option>`).join("");

  const aviso = van.length >= MINIMO_JUGADORES
    ? `✅ Equipo completo: ya confirmaron ${van.length}.`
    : `Faltan ${MINIMO_JUGADORES - van.length} confirmados para completar los ${MINIMO_JUGADORES}.`;

  const filas = ids.map(id => {
    const r = respuestaDe(fecha, id);
    const j = estado.P[id];
    return `<div class="jug">
      <i>${escaparHTML(j.n)}</i>
      <span class="nom">${escaparHTML(j.name)}<small>${titulares.has(id) ? "titular" : "suplente"}</small></span>
      <button class="sec si ${r === "v" ? "on" : ""}" data-as="v" data-id="${id}" data-f="${fecha}" aria-pressed="${r === "v"}">✅ Voy</button>
      <button class="sec no ${r === "n" ? "on" : ""}" data-as="n" data-id="${id}" data-f="${fecha}" aria-pressed="${r === "n"}">❌ No voy</button>
    </div>`;
  }).join("");

  $("#tv").innerHTML = `
    <div class="card">
      <h2>Convocatoria</h2>
      <div class="bar"><label for="selFecha">Fecha:</label><select id="selFecha">${opciones}</select></div>
      <div class="prox">${partido
        ? `Fecha ${fecha}<br><b>${nombre(partido.local)} vs${nombre(partido.visitante)}</b>`
        : `Fecha ${fecha}<br><b>Descansamos esta fecha</b>`}</div>
      <div class="res">
        <span class="chip ok">✅ Van: ${van.length}</span>
        <span class="chip no">❌ No van: ${noVan.length}</span>
        <span class="chip">⏳ Sin responder: ${sinResp.length}</span>
      </div>
      <p class="ayuda"><b>${aviso}</b></p>
      ${van.length ? `<p class="lista-conv"><b>Van:</b> ${van.map(escaparHTML).join(", ")}</p>` : ""}
      ${noVan.length ? `<p class="lista-conv"><b>No van:</b> ${noVan.map(escaparHTML).join(", ")}</p>` : ""}
      ${sinResp.length ? `<p class="lista-conv"><b>Sin responder:</b> ${sinResp.map(escaparHTML).join(", ")}</p>` : ""}
    </div>
    <div class="card">
      <h2>Jugadores</h2>
      <p class="ayuda" style="margin:0 0 6px">Tocá tu nombre: ✅ Voy o ❌ No voy. Si lo tocás de nuevo, se borra tu respuesta.</p>
      ${filas}
    </div>`;
}


/* ---------- 11. Copa de Oro y calculadora de clasificación ---------- */

// Cuadro de la Copa. {z, pos} = puesto de una zona · {g} = ganador de otra llave
const LLAVES = [
  { id: "C1", etapa: 0, titulo: "Llave 1 · Cuartos", a: { z: 0, pos: 1 }, b: { z: 1, pos: 4 } },
  { id: "C2", etapa: 0, titulo: "Llave 2 · Cuartos", a: { z: 0, pos: 2 }, b: { z: 1, pos: 3 } },
  { id: "C3", etapa: 0, titulo: "Llave 3 · Cuartos", a: { z: 1, pos: 1 }, b: { z: 0, pos: 4 } },
  { id: "C4", etapa: 0, titulo: "Llave 4 · Cuartos", a: { z: 1, pos: 2 }, b: { z: 0, pos: 3 } },
  { id: "S1", etapa: 1, titulo: "Semifinal 1",       a: { g: "C1" },        b: { g: "C4" } },
  { id: "S2", etapa: 1, titulo: "Semifinal 2",       a: { g: "C3" },        b: { g: "C2" } },
  { id: "F",  etapa: 2, titulo: "Final",             a: { g: "S1" },        b: { g: "S2" } },
];
const NOMBRE_LLAVE = { C1: "Llave 1", C2: "Llave 2", C3: "Llave 3", C4: "Llave 4", S1: "Semifinal 1", S2: "Semifinal 2" };

// Quién ocupa un lugar del cuadro: un puesto de zona (provisorio hasta que termine) o el ganador de una llave
function resolverLado(lado, ganadores) {
  if (lado.z !== undefined) {
    const fila = calcularTabla(lado.z)[lado.pos - 1];
    return {
      equipo: fila ? fila.equipo : null,
      prov: !zonaCompleta(lado.z),
      etiqueta: `${lado.pos}º Zona ${"AB"[lado.z]}`,
    };
  }
  return { equipo: ganadores[lado.g] || null, prov: false, etiqueta: `Ganador ${NOMBRE_LLAVE[lado.g]}` };
}

function calcularCuadro() {
  const ganadores = {};
  return LLAVES.map(ll => {
    const A = resolverLado(ll.a, ganadores);
    const B = resolverLado(ll.b, ganadores);
    const r = estado.R["copa:" + ll.id];          // [golesA, golesB] o [golesA, golesB, 1|2] si hubo penales
    let ganador = null;
    if (r && A.equipo && B.equipo) {
      if (r[0] > r[1]) ganador = A.equipo;
      else if (r[0] < r[1]) ganador = B.equipo;
      else if (r[2] === 1) ganador = A.equipo;
      else if (r[2] === 2) ganador = B.equipo;
    }
    if (ganador) ganadores[ll.id] = ganador;
    return { ll, A, B, r, ganador };
  });
}

function htmlLlave(x) {
  const { ll, A, B, r, ganador } = x;
  const lado = L => L.equipo
    ? `${escaparHTML(nombre(L.equipo))}${L.prov ? '<sup class="prov" title="Posición provisoria">*</sup>' : ""}`
    : `<em class="tbd">${escaparHTML(L.etiqueta)}</em>`;
  const listo = A.equipo && B.equipo;
  const empate = listo && r && r[0] === r[1];
  const juegaYo = A.equipo === CONFIG.MI_EQUIPO || B.equipo === CONFIG.MI_EQUIPO;

  const marcador = esTecnico && listo
    ? `<input type="number" min="0" inputmode="numeric" data-c="${ll.id}" value="${r ? r[0] : ""}" aria-label="Goles ${escaparHTML(nombre(A.equipo))}"> -
       <input type="number" min="0" inputmode="numeric" data-c="${ll.id}" value="${r ? r[1] : ""}" aria-label="Goles ${escaparHTML(nombre(B.equipo))}">`
    : (listo && r ? `${r[0]} - ${r[1]}` : "vs");

  let penales = "";
  if (empate && esTecnico) {
    penales = `<select data-c="${ll.id}" aria-label="Ganador por penales">
      <option value="">Empate: ¿quién ganó por penales?</option>
      <option value="1" ${r[2] === 1 ? "selected" : ""}>${escaparHTML(nombre(A.equipo))}</option>
      <option value="2" ${r[2] === 2 ? "selected" : ""}>${escaparHTML(nombre(B.equipo))}</option>
    </select>`;
  } else if (empate && ganador) {
    penales = `<div class="pen">Definió por penales: <b>${escaparHTML(nombre(ganador))}</b></div>`;
  }

  return `<div class="llave">
    <small>${ll.titulo}</small>
    <div class="m ${juegaYo ? "me" : ""}"><span>${lado(A)}</span><span class="sc">${marcador}</span><span>${lado(B)}</span></div>
    ${penales}
  </div>`;
}

function dibujarCopa() {
  const cuadro = calcularCuadro();
  const final = cuadro[cuadro.length - 1];
  const etapas = ["Cuartos de final", "Semifinales", "Final"];

  const bloques = etapas.map((titulo, e) => `
    <div class="etapa">${titulo}</div>
    <div class="llaves">${cuadro.filter(x => x.ll.etapa === e).map(htmlLlave).join("")}</div>`).join("");

  const hayProvisorios = cuadro.some(x => x.A.prov || x.B.prov);

  $("#tc").innerHTML = `
    <div class="card">
      <h2>Copa de Oro</h2>
      ${final.ganador ? `<div class="campeon">🏆 Campeón: ${escaparHTML(nombre(final.ganador))}</div>` : ""}
      <p class="ayuda">Clasifican los ${CLASIFICAN} primeros de cada zona. ${hayProvisorios ? '<span class="prov">*</span> Cruces provisorios, según la tabla actual.' : "Cruces definidos."}</p>
      ${bloques}
    </div>
    ${htmlCalculadora()}`;

  // Carga de resultados de la Copa (solo técnico)
  $("#tc").querySelectorAll("[data-c]").forEach(campo => campo.onchange = () => {
    const id = campo.dataset.c, clave = "copa:" + id;
    const [gl, gv] = [...$("#tc").querySelectorAll(`input[data-c="${id}"]`)].map(x => x.value.trim());

    if (gl !== "" && gv !== "") {
      const a = golesValidos(gl), b = golesValidos(gv);
      const sel = $(`#tc select[data-c="${id}"]`);
      const pen = a === b && sel ? Number(sel.value) : 0;
      estado.R[clave] = pen ? [a, b, pen] : [a, b];
    } else if (gl === "" && gv === "") {
      if (!estado.R[clave]) return;
      delete estado.R[clave];
    } else {
      return;   // falta un marcador: se espera sin redibujar
    }
    guardar();
  });
}


/* --- Calculadora: "¿qué necesitamos para clasificar?" ---
   1) Matemática exacta (conservadora): ya clasificado / ya eliminado.
   2) Estimación: simula miles de veces los partidos que faltan (con goles al azar
      según cómo viene jugando cada equipo) y cuenta cuántas veces entramos entre los primeros. */

function mulberry32(semilla) {          // generador al azar con semilla fija: el resultado no "baila" en cada dibujo
  return function () {
    semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0;
    let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function poisson(lambda, azar) {
  const limite = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= azar(); } while (p > limite);
  return k - 1;
}

// Arma los datos de la zona para simular
function prepararZona(zona) {
  const equipos = equiposZona(zona), idx = {};
  equipos.forEach((e, i) => idx[e] = i);

  const filas = {};
  calcularTabla(zona).forEach(f => filas[f.equipo] = f);
  const base = equipos.map(e => ({ pts: filas[e].pts, gf: filas[e].gf, gc: filas[e].gc, pj: filas[e].pj }));

  // Ataque y defensa de cada equipo (con un "prior" de 2 partidos promedio para no exagerar con pocos datos)
  const ataque  = i => (base[i].gf + 3) / (base[i].pj + 2);
  const defensa = i => (base[i].gc + 3) / (base[i].pj + 2);
  const lim = x => Math.min(4, Math.max(0.3, x));

  const pend = partidosZona(zona).filter(m => !estado.R[m.clave]).map(m => {
    const l = idx[m.local], v = idx[m.visitante];
    return { m, l, v, lamL: lim((ataque(l) + defensa(v)) / 2), lamV: lim((ataque(v) + defensa(l)) / 2) };
  });
  return { equipos, idx, base, pend };
}

// Simula una vez los partidos pendientes. forzados[i] = "L" | "E" | "V" fuerza el resultado del partido i.
// Devuelve los índices de equipos ordenados de 1º a último.
function simularUna(P, azar, forzados) {
  const pts = P.base.map(b => b.pts), gf = P.base.map(b => b.gf), gc = P.base.map(b => b.gc);

  P.pend.forEach((p, i) => {
    let gl = poisson(p.lamL, azar), gv = poisson(p.lamV, azar);
    const f = forzados ? forzados[i] : null;
    if (f) {
      const cumple = () => f === "L" ? gl > gv : f === "V" ? gl < gv : gl === gv;
      for (let intento = 0; intento < 40 && !cumple(); intento++) {
        gl = poisson(p.lamL, azar); gv = poisson(p.lamV, azar);
      }
      if (!cumple()) {                       // por las dudas, se fuerza el resultado
        if (f === "L") gl = gv + 1; else if (f === "V") gv = gl + 1; else gv = gl;
      }
    }
    gf[p.l] += gl; gc[p.l] += gv; gf[p.v] += gv; gc[p.v] += gl;
    if (gl > gv) pts[p.l] += 3; else if (gl < gv) pts[p.v] += 3; else { pts[p.l]++; pts[p.v]++; }
  });

  return [...pts.keys()].sort((a, b) =>
    pts[b] - pts[a] || (gf[b] - gc[b]) - (gf[a] - gc[a]) || gf[b] - gf[a] || a - b);
}

let cacheEscenarios = null;

function calcularEscenarios() {
  const zona = zonaMia(), k = CLASIFICAN;
  const clave = JSON.stringify([estado.R, CONFIG.DESCUENTOS, zona]);
  if (cacheEscenarios && cacheEscenarios.clave === clave) return cacheEscenarios.datos;

  const P = prepararZona(zona);
  const yo = P.idx[CONFIG.MI_EQUIPO];
  if (yo === undefined) return null;

  const n = P.equipos.length;
  const tabla = calcularTabla(zona);
  const pos = tabla.findIndex(f => f.equipo === CONFIG.MI_EQUIPO) + 1;
  const completa = zonaCompleta(zona);

  // 1) Matemática (conservadora: los empates de puntos se cuentan en contra)
  const restantes = P.equipos.map((_, i) => P.pend.filter(p => p.l === i || p.v === i).length);
  const maxPts = P.base.map((b, i) => b.pts + 3 * restantes[i]);
  const otros = [...Array(n).keys()].filter(i => i !== yo);
  const eliminado   = otros.filter(i => P.base[i].pts > maxPts[yo]).length >= k;
  const clasificado = otros.filter(i => maxPts[i] >= P.base[yo].pts).length <= k - 1;

  // 2) Estimación general: chances de cada equipo
  const azar = mulberry32(2026);
  const N = 5000;
  const cuenta = new Array(n).fill(0);
  for (let s = 0; s < N; s++) {
    const orden = simularUna(P, azar, null);
    for (let j = 0; j < Math.min(k, n); j++) cuenta[orden[j]]++;
  }
  const probs = P.equipos
    .map((e, i) => ({ equipo: e, prob: cuenta[i] / N }))
    .sort((a, b) => b.prob - a.prob);

  // 3) Escenarios: "si sumamos X puntos de los que quedan, ¿qué chances hay?"
  const mias = P.pend.map((p, i) => (p.l === yo || p.v === yo) ? i : -1).filter(i => i >= 0);
  const r = mias.length;
  const escenarios = [];
  if (r > 0 && r <= 8) {
    const grupos = {};                                   // combinaciones G/E/P agrupadas por puntos que suman
    for (let c = 0; c < 3 ** r; c++) {
      let x = c, g = 0, e = 0, pe = 0, pts = 0;
      const combo = [];
      for (let j = 0; j < r; j++) {
        const d = x % 3; x = Math.floor(x / 3); combo.push(d);
        if (d === 0) { g++; pts += 3; } else if (d === 1) { e++; pts++; } else pe++;
      }
      (grupos[pts] = grupos[pts] || []).push({ combo, g, e, pe });
    }
    Object.keys(grupos).map(Number).sort((a, b) => a - b).forEach(sumar => {
      const lista = grupos[sumar], M = 400;
      let ok = 0;
      for (let s = 0; s < M; s++) {
        const elegida = lista[Math.floor(azar() * lista.length)];
        const forzados = new Array(P.pend.length).fill(null);
        mias.forEach((pi, j) => {
          const d = elegida.combo[j], p = P.pend[pi];
          forzados[pi] = d === 1 ? "E" : ((d === 0) === (p.l === yo) ? "L" : "V");
        });
        if (simularUna(P, azar, forzados).indexOf(yo) < k) ok++;
      }
      const ej = lista.reduce((a, b) => b.g > a.g ? b : a);
      escenarios.push({ sumar, total: P.base[yo].pts + sumar, prob: ok / M, ejemplo: `${ej.g}G ${ej.e}E ${ej.pe}P` });
    });
  }

  const datos = {
    zona, k, pos, completa, eliminado, clasificado,
    pts: P.base[yo].pts,
    rem: r,
    max: maxPts[yo],
    probs,
    probYo: probs.find(x => x.equipo === CONFIG.MI_EQUIPO).prob,
    escenarios,
    misPartidos: mias.map(pi => P.pend[pi].m),
  };
  cacheEscenarios = { clave, datos };
  return datos;
}

const pct = p => (p > 0 && p < 0.01) ? "<1%" : (p < 1 && p > 0.99) ? ">99%" : Math.round(p * 100) + "%";
const barraProb = p => `<div class="barra"><span style="width:${(p * 100).toFixed(0)}%"></span></div>`;

function htmlCalculadora() {
  const E = calcularEscenarios();
  if (!E) return "";

  const estadoTxt = E.completa
    ? (E.pos <= E.k ? `✅ La zona terminó: quedaste ${E.pos}º y clasificás a la Copa de Oro.`
                    : `❌ La zona terminó: quedaste ${E.pos}º y no clasificás.`)
    : E.clasificado ? "✅ Matemáticamente clasificado a la Copa de Oro."
    : E.eliminado   ? "❌ Matemáticamente eliminado: ni ganando todo alcanza."
    : "⚔️ Todavía depende de los resultados.";

  const meta = E.escenarios.find(x => x.prob >= 0.9);
  const metaTxt = !E.completa && !E.clasificado && !E.eliminado && meta
    ? `<p class="estado">Con <b>${meta.total} puntos</b> (sumando ${meta.sumar} de los que quedan) clasificás en más de 9 de cada 10 casos.</p>`
    : "";

  const partidos = E.misPartidos.map(m => {
    const rival = m.local === CONFIG.MI_EQUIPO ? m.visitante : m.local;
    return `<li>Fecha ${m.fecha}: vs ${escaparHTML(nombre(rival))}</li>`;
  }).join("");

  const filasEsc = E.escenarios.map(x => `
    <div class="prob">
      <span>+${x.sumar} pts <small>(${x.ejemplo})</small></span>
      ${barraProb(x.prob)}
      <b>${pct(x.prob)}</b>
    </div>`).join("");

  const filasEq = E.probs.map(x => `
    <div class="prob ${x.equipo === CONFIG.MI_EQUIPO ? "me" : ""}">
      <span>${escaparHTML(nombre(x.equipo))}</span>${barraProb(x.prob)}<b>${pct(x.prob)}</b>
    </div>`).join("");

  return `<div class="card calc">
    <h2>¿Qué necesitamos para clasificar?</h2>
    <p class="ayuda" style="margin:0">Zona ${"AB"[E.zona]} · clasifican los ${E.k} primeros.</p>
    <p class="estado">${estadoTxt}</p>
    <div class="datos">
      <span>Hoy: <b>${E.pos}º</b> con <b>${E.pts} pts</b></span>
      <span>Partidos que faltan: <b>${E.rem}</b></span>
      <span>Máximo posible: <b>${E.max} pts</b></span>
      ${E.completa ? "" : `<span>Chances estimadas: <b>${pct(E.probYo)}</b></span>`}
    </div>
    ${metaTxt}
    ${partidos ? `<p class="lista-conv"><b>Nos quedan:</b></p><ul style="margin:4px 0 8px;padding-left:20px">${partidos}</ul>` : ""}
    ${filasEsc ? `<p class="lista-conv"><b>Si sumamos de acá al final… (G ganados, E empatados, P perdidos)</b></p>${filasEsc}` : ""}
    <details>
      <summary>Chances de todos los equipos de la zona</summary>
      ${filasEq}
    </details>
    <p class="ayuda">Es una estimación: se simulan miles de veces los partidos que faltan según cómo viene jugando cada equipo. No es una garantía.</p>
  </div>`;
}


/* ---------- 12. Compartir la formación como imagen ---------- */

function cargarImagen(src) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = mal;
    img.src = src;
  });
}

function rectRedondeado(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function generarImagenFormacion() {
  // Espera a que carguen las tipografías para que la imagen salga con la misma letra que la web
  try {
    await Promise.all([
      document.fonts.load("800 40px 'Barlow Condensed'"),
      document.fonts.load("600 30px Barlow"),
    ]);
  } catch (e) { /* si falla, se usa una letra del sistema */ }
  const logo = await cargarImagen("logo.png").catch(() => null);

  const AZUL = "#2453a3", OSCURO = "#142f66", DORADO = "#d1a52a", CREMA = "#f5e9c4", CARMESI = "#c23a56";
  const TIT  = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  const TXT  = "Barlow, system-ui, sans-serif";

  const W = 1080, PX = 130, PW = 820, PY = 330, PH = 960;   // PX/PY/PW/PH = cancha

  // Distribución de los suplentes en filas (se mide antes de crear el lienzo definitivo)
  const medidor = document.createElement("canvas").getContext("2d");
  medidor.font = `600 28px ${TXT}`;
  const chips = [];
  const filaAlto = 64;
  let cx = 60, cy = 0;
  estado.B.forEach(id => {
    const j = estado.P[id];
    const w = 64 + medidor.measureText(String(j.name)).width + 28;
    if (cx + w > W - 60) { cx = 60; cy += filaAlto; }
    chips.push({ j, x: cx, y: cy, w });
    cx += w + 14;
  });
  const filas = chips.length ? cy / filaAlto + 1 : 0;
  const yBanco = PY + PH + 40;
  const H = yBanco + (chips.length ? 70 + filas * filaAlto : 0) + 30;

  const lienzo = document.createElement("canvas");
  lienzo.width = W; lienzo.height = H;
  const g = lienzo.getContext("2d");

  // Fondo
  const fondo = g.createLinearGradient(0, 0, W, H);
  fondo.addColorStop(0, AZUL); fondo.addColorStop(1, OSCURO);
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);

  // Encabezado: escudo + título
  g.save();
  g.beginPath(); g.arc(125, 125, 85, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#fff"; g.fillRect(40, 40, 170, 170);
  if (logo) g.drawImage(logo, 40, 40, 170, 170);
  g.restore();
  g.beginPath(); g.arc(125, 125, 85, 0, Math.PI * 2);
  g.lineWidth = 6; g.strokeStyle = CREMA; g.stroke();

  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = CREMA; g.font = `800 92px ${TIT}`;
  g.fillText("FORMACIÓN TITULAR", 240, 135);
  g.fillStyle = DORADO; g.font = `600 32px ${TXT}`;
  g.fillText("Gol en Contra · Liga Universitaria B · Clausura 2026", 240, 185);
  g.fillStyle = DORADO; g.fillRect(0, 238, W, 6);

  // Próximo partido
  const prox = listaPartidos().find(p => p.zona === 0 && juegaMiEquipo(p) && !estado.R[p.clave]);
  if (prox) {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = CREMA; g.font = `800 44px ${TIT}`;
    g.fillText(`FECHA ${prox.fecha}: ${nombre(prox.local)} VS ${nombre(prox.visitante)}`, W / 2, 288);
  }

  // Cancha
  g.save();
  rectRedondeado(g, PX, PY, PW, PH, 18); g.clip();
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? "#339746" : "#2e8b3e";
    g.fillRect(PX, PY + i * PH / 10, PW, PH / 10 + 1);
  }
  g.restore();
  g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(PX, PY + PH / 2); g.lineTo(PX + PW, PY + PH / 2); g.stroke();                  // mitad de cancha
  g.beginPath(); g.arc(PX + PW / 2, PY + PH / 2, PW * 0.12, 0, Math.PI * 2); g.stroke();                  // círculo central
  g.strokeRect(PX + PW * 0.25, PY, PW * 0.5, PH * 0.14);                                                  // área de arriba
  g.strokeRect(PX + PW * 0.25, PY + PH - PH * 0.14, PW * 0.5, PH * 0.14);                                 // área de abajo
  rectRedondeado(g, PX, PY, PW, PH, 18); g.lineWidth = 6; g.strokeStyle = "#fff"; g.stroke();             // borde

  // Titulares
  g.textAlign = "center"; g.textBaseline = "middle";
  estado.S.forEach((t, i) => {
    const j = estado.P[t.p];
    const x = PX + t.x / 100 * PW, y = PY + t.y / 100 * PH;

    g.save();
    g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
    g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2);
    g.fillStyle = i === 0 ? CARMESI : AZUL; g.fill();
    g.restore();
    g.beginPath(); g.arc(x, y, 36, 0, Math.PI * 2);
    g.lineWidth = 5; g.strokeStyle = DORADO; g.stroke();

    g.fillStyle = CREMA; g.font = `800 38px ${TIT}`;
    g.fillText(String(j.n), x, y + 2);

    g.font = `600 24px ${TXT}`;
    const ancho = Math.min(g.measureText(String(j.name)).width + 22, 190);
    rectRedondeado(g, x - ancho / 2, y + 42, ancho, 34, 17);
    g.fillStyle = "#fff"; g.fill();
    g.fillStyle = OSCURO;
    g.fillText(String(j.name), x, y + 60, 180);
  });

  // Suplentes
  if (chips.length) {
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = DORADO; g.font = `800 48px ${TIT}`;
    g.fillText("SUPLENTES", 60, yBanco + 42);

    chips.forEach(c => {
      const x = c.x, y = yBanco + 70 + c.y;
      rectRedondeado(g, x, y, c.w, 52, 26);
      g.fillStyle = "rgba(255,255,255,.95)"; g.fill();
      g.lineWidth = 3; g.strokeStyle = DORADO; g.stroke();

      g.beginPath(); g.arc(x + 26, y + 26, 22, 0, Math.PI * 2);
      g.fillStyle = AZUL; g.fill();
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = CREMA; g.font = `800 26px ${TIT}`;
      g.fillText(String(c.j.n), x + 26, y + 28);

      g.textAlign = "left";
      g.fillStyle = OSCURO; g.font = `600 28px ${TXT}`;
      g.fillText(String(c.j.name), x + 60, y + 28);
    });
  }

  return new Promise((ok, mal) =>
    lienzo.toBlob(b => b ? ok(b) : mal(new Error("No se pudo crear la imagen")), "image/png"));
}

function descargarImagen(blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "formacion-gec.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function compartirFormacion() {
  const boton = $("#compartir");
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Generando imagen…";
  try {
    const blob = await generarImagenFormacion();
    const archivo = new File([blob], "formacion-gec.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo], title: "Formación Gol en Contra" });   // celular: abre WhatsApp, etc.
      } catch (e) {
        if (e.name !== "AbortError") descargarImagen(blob);                             // AbortError = el usuario canceló
      }
    } else {
      descargarImagen(blob);                                                            // PC: se descarga el PNG
    }
  } catch (e) {
    alert("No se pudo generar la imagen. Si abriste el archivo directo desde la carpeta, abrilo desde el servidor (Live Server o el sitio publicado).");
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}


/* ---------- 13. Modo oscuro / claro ---------- */

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  $("#tema").textContent = tema === "oscuro" ? "☀️" : "🌙";
  $("#tema").title = tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
}

$("#tema").onclick = () => {
  const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
  try { localStorage.setItem(CLAVE_TEMA, nuevo); } catch (e) { /* sin almacenamiento: solo dura esta visita */ }
  aplicarTema(nuevo);
};


/* ---------- 14. Botones y arranque ---------- */

$("#addb").onclick = agregarSuplente;
$("#compartir").onclick = compartirFormacion;

$("#esquemas").onclick = e => {
  const boton = e.target.closest("[data-f]");
  if (boton && aplicarEsquema(estado, boton.dataset.f)) guardar();
};

$("#fgo").onclick = () => {
  if (aplicarEsquema(estado, $("#fin").value.trim())) guardar();
  else alert("Los números deben sumar 10 jugadores de campo. Ejemplo: 4-4-2");
};

$("#login").onclick = async () => {
  if (esTecnico) {
    await db.auth.signOut(); 
    esTecnico = false;
  } else {
    const email = prompt("Email del técnico:"); 
    if (!email) return;
    
    const password = prompt("Contraseña:");     
    if (!password) return;
    
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return alert("Email o contraseña incorrectos");
    
    esTecnico = data.user.id === tecnicoId;
  }
  dibujar();
};

$("#tv").onclick = e => {
  const boton = e.target.closest("[data-as]");
  if (boton) marcarAsistencia(Number(boton.dataset.f), boton.dataset.id, boton.dataset.as);
};
$("#tv").onchange = e => {
  if (e.target.id === "selFecha") {
    fechaConv = Number(e.target.value);
    dibujarConvocatoria();
  }
};

const PESTANAS = { f: "#tf", v: "#tv", p: "#tp", c: "#tc" };
$$("nav button").forEach(boton => boton.onclick = () => { $$
("nav button").forEach(x => x.classList.toggle("on", x === boton));
  Object.entries(PESTANAS).forEach(([clave, selector]) => $(selector).hidden = clave !== boton.dataset.t);
  dibujarPestanaActiva();
});

aplicarTema(document.documentElement.dataset.tema || "claro");
cargarLocal();
dibujar();

// Arranque
(async () => {
  await iniciar();
  await traerDelServidor();
  await traerAsistencia();
  setInterval(() => { traerDelServidor(); traerAsistencia(); }, CONFIG.REFRESCO_MS);
})();