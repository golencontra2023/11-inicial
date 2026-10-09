/* =====================================================================
   LÓGICA DEL TABLERO – Gol en Contra
   La configuración (equipos, fixture, clave, Firebase) está en config.js.

   Índice
     1. Utilidades
     2. Estado (datos del tablero)
     3. Esquemas tácticos
     4. Guardado (navegador + Firebase)
     5. Dibujo de la pantalla
     6. Partidos y próximo rival
     7. Arrastrar y soltar jugadores
     8. Edición de jugadores
     9. Fixture y tabla de posiciones
    10. Botones y arranque
   ===================================================================== */


/* ---------- 1. Utilidades ---------- */

const $  = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

const CLAVE_LOCAL = "gec"; // nombre usado en localStorage / sessionStorage

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


/* ---------- 2. Estado ----------
   Estructura (los nombres cortos se mantienen porque ya están guardados
   en Firebase; cambiarlos borraría lo cargado):
     fmt → esquema actual, ej. "4-3-3"
     P   → jugadores { id: { n: número, name: nombre } }
     S   → titulares en cancha [ { p: idJugador, x: %, y: % } ]  (S[0] = arquero)
     B   → suplentes [ idJugador, ... ]
     R   → resultados { "fecha:local-visitante": [golesLocal, golesVisitante] }
     ts  → momento del último guardado
*/

let estado;
let esTecnico   = sessionStorage.getItem(CLAVE_LOCAL) === CONFIG.PIN;
let arrastrando = false; // mientras se arrastra no se aceptan cambios remotos

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

// Completa campos que podrían faltar en datos viejos.
// Los resultados escritos en config.js SIEMPRE se aplican encima de lo guardado:
// así, al hacer push a GitHub, todos ven los resultados nuevos aunque tengan
// una versión vieja guardada en el navegador.
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

const urlTablero = () => CONFIG.DB_URL.replace(/\/$/, "") + "/tablero.json";

function cargarLocal() {
  try {
    estado = completar(JSON.parse(localStorage.getItem(CLAVE_LOCAL)));
  } catch (e) { /* no había nada guardado */ }
  if (!estado) estado = estadoInicial();
}

// Trae la versión de Firebase si es más nueva que la local
async function traerDelServidor() {
  // No se pisa la pantalla mientras se arrastra o se escribe un resultado
  const escribiendo = document.activeElement && document.activeElement.matches("#tp input");
  if (!CONFIG.DB_URL || arrastrando || escribiendo) return;
  try {
    const remoto = await (await fetch(urlTablero())).json();
    if (remoto && remoto.ts > estado.ts) {
      estado = completar(remoto);
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado));
      dibujar();
    } else if (!remoto && esTecnico) {
      guardar(); // base vacía: el técnico sube la versión local
    }
  } catch (e) {
    mostrarMensaje("Sin conexión: mostrando la última versión guardada.");
  }
}

async function guardar() {
  estado.ts = Date.now();
  localStorage.setItem(CLAVE_LOCAL, JSON.stringify(estado));
  dibujar();
  if (!CONFIG.DB_URL) return;
  try {
    await fetch(urlTablero(), { method: "PUT", body: JSON.stringify(estado) });
    mostrarMensaje("");
  } catch (e) {
    mostrarMensaje("No se pudo guardar en línea. Revisá la conexión.");
  }
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
  if (!$("#tp").hidden) dibujarFixture();
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

function dibujarProximoPartido() {
  const proximo = listaPartidos().find(p => p.zona === 0 && juegaMiEquipo(p) && !estado.R[p.clave]);
  $("#prox").innerHTML = proximo
    ? `Próximo partido · Fecha ${proximo.fecha}<br><b>${nombre(proximo.local)} vs ${nombre(proximo.visitante)}</b>`
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

function calcularTabla(zona) {
  // Equipos de la zona: A = 1..8, B = 9..16
  const filas = {};
  for (let t = 1 + 8 * zona; t <= 8 + 8 * zona; t++) {
    filas[t] = { equipo: t, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
  }

  listaPartidos()
    .filter(m => m.zona === zona && estado.R[m.clave])
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
    <tr class="${x.equipo === CONFIG.MI_EQUIPO ? "me" : ""}">
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
    <div class="card tabla"><h2>Posiciones · Zona A</h2>${htmlTabla(0)}</div>
    ${htmlPublicar()}
    <p>Al terminar las 7 fechas, los mejores de cada zona juegan la Copa.</p>
    <div class="fx">${fechas}</div>`;

  // Carga de resultados (solo técnico)
  $("#tp").querySelectorAll("input[data-k]").forEach(campo => campo.onchange = () => {
    const clave = campo.dataset.k;
    const [gl, gv] = [...$("#tp").querySelectorAll(`[data-k="${clave}"]`)].map(x => x.value.trim());
    const goles = v => Math.max(0, parseInt(v, 10) || 0);

    if (gl !== "" && gv !== "") {
      estado.R[clave] = [goles(gl), goles(gv)];   // los dos marcadores: se guarda
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


/* ---------- 10. Botones y arranque ---------- */

$("#addb").onclick = agregarSuplente;

// Botones de esquema rápido (se crean en dibujarEsquemas)
$("#esquemas").onclick = e => {
  const boton = e.target.closest("[data-f]");
  if (boton && aplicarEsquema(estado, boton.dataset.f)) guardar();
};

// Esquema manual
$("#fgo").onclick = () => {
  if (aplicarEsquema(estado, $("#fin").value.trim())) guardar();
  else alert("Los números deben sumar 10 jugadores de campo. Ejemplo: 4-4-2");
};

// Entrar / salir del modo técnico
$("#login").onclick = () => {
  if (esTecnico) {
    esTecnico = false;
    sessionStorage.removeItem(CLAVE_LOCAL);
  } else {
    const clave = prompt("Clave del técnico:");
    if (clave === CONFIG.PIN) {
      esTecnico = true;
      sessionStorage.setItem(CLAVE_LOCAL, CONFIG.PIN);
    } else if (clave !== null) {
      alert("Clave incorrecta");
    }
  }
  dibujar();
};

// Pestañas
$$("nav button").forEach(boton => boton.onclick = () => {
  $$("nav button").forEach(x => x.classList.toggle("on", x === boton));
  $("#tf").hidden = boton.dataset.t !== "f";
  $("#tp").hidden = boton.dataset.t !== "p";
  if (boton.dataset.t === "p") dibujarFixture();
});

cargarLocal();
dibujar();
traerDelServidor();
setInterval(traerDelServidor, CONFIG.REFRESCO_MS);