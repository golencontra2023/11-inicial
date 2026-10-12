import { createClient } from "@supabase/supabase-js";
const { SUPABASE_URL, SUPABASE_SECRET_KEY, FIREBASE_URL, EQUIPO_SLUG } = process.env;
const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const leer = async ruta => (await fetch(`${FIREBASE_URL.replace(/\/$/, "")}/${ruta}.json`)).json();

const tablero    = await leer("tablero");
const asistencia = (await leer("asistencia")) || {};

const { data: equipo, error: e1 } = await sb.from("equipos").select("id").eq("slug", EQUIPO_SLUG).single();
if (e1) throw e1;

const { error: e2 } = await sb.from("tableros").upsert({ equipo_id: equipo.id, datos: tablero, ts: tablero.ts });
if (e2) throw e2;

const filas = [];
for (const [kf, jugadores] of Object.entries(asistencia))
  for (const [jugador_id, valor] of Object.entries(jugadores))
    filas.push({ equipo_id: equipo.id, fecha: Number(kf.slice(1)), jugador_id, valor });
if (filas.length) { const { error } = await sb.from("asistencia").upsert(filas); if (error) throw error; }

console.log("Migrado:", Object.keys(tablero.P).length, "jugadores,", filas.length, "respuestas de asistencia");