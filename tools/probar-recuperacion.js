// tools/probar-recuperacion.js
//
// Arnés de prueba para src/rag.js. Corre la recuperación directamente sobre
// el índice (sin levantar el servidor) con un set fijo de preguntas clínicas
// reales, una por carpeta del corpus más una que toca el corpus sintético
// original. Pensado para comparar antes/después de un cambio en rag.js:
// mismo set de preguntas, misma forma de imprimir, así el diff se lee a
// simple vista. Ver docs/recuperacion-baseline.md para la captura de
// referencia.
//
// Uso: node tools/probar-recuperacion.js

import { rebuildIndex, retrieve } from '../src/rag.js';

const PREGUNTAS = [
  {
    tema: 'cholecystitis',
    pregunta: '¿Cuáles son los signos de infección de la herida después de una colecistectomía?'
  },
  {
    tema: 'total joint replacement',
    pregunta: '¿Cuánto dolor es normal sentir después de un reemplazo total de rodilla y cuándo debo preocuparme?'
  },
  {
    tema: 'colorectal cancer',
    pregunta: '¿Con qué frecuencia debo hacerme controles después de una cirugía por cáncer colorrectal?'
  },
  {
    tema: 'appendicitis',
    pregunta: '¿Qué cuidados debo tener en casa después de una apendicectomía?'
  },
  {
    tema: 'breast_cancer (corpus real: cáncer de cuello uterino, no de mama)',
    pregunta: '¿Qué signos de alarma debo vigilar después de una cirugía por cáncer de cuello uterino?'
  },
  {
    tema: 'corpus sintético original',
    pregunta: '¿Cuándo debo llamar de inmediato si tengo fiebre después de la cirugía?'
  }
];

function linea(char = '-', n = 78) {
  console.log(char.repeat(n));
}

function previsualizar(texto, max = 160) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

async function main() {
  const { documents, totalChunks } = await rebuildIndex();
  console.log(`Índice: ${documents.length} documentos, ${totalChunks} fragmentos.\n`);

  for (const { tema, pregunta } of PREGUNTAS) {
    linea('=');
    console.log(`[${tema}]`);
    console.log(`Pregunta: ${pregunta}`);
    linea();

    const resultados = retrieve(pregunta, { k: 3 });

    if (resultados.length === 0) {
      console.log('  (sin evidencia devuelta)');
    } else {
      resultados.forEach((r, i) => {
        // Se imprime cualquier campo presente en el resultado tal cual lo
        // devuelva rag.js, para que el mismo script sirva antes y después de
        // cambiar la forma de retrieve() (p. ej. score crudo vs. normalizado).
        const campos = Object.entries(r)
          .filter(([clave]) => clave !== 'text')
          .map(([clave, valor]) => `${clave}=${valor}`)
          .join('  ');
        console.log(`  ${i + 1}. ${campos}`);
        console.log(`     "${previsualizar(r.text)}"`);
      });
    }
    console.log('');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
