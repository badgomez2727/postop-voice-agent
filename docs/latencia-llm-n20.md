# Medición de latencia — camino `llm`, N=20

Fecha: 2026-08-08. Corrida contra el servidor real, `LLM_PROVIDER=ollama`,
Llama 3.2 3B, con `tools/medir-latencia.js`. Reemplaza la medición N=7 de
`docs/DECISIONS.md`, decisión 6d — ver decisión 6e para el análisis.

```
Midiendo contra http://localhost:3020 -- 10 llamadas simuladas.

  [llamada 1] scripted-routed         34 ms  "El dolor está en un 3 de 10, en la zona de la inci"
  [llamada 1] scripted-routed         32 ms  "No he tenido fiebre."
  [llamada 1] llm                 155207 ms  "¿Es normal que la herida me duela más en la noche "
  [llamada 1] scripted-routed         14 ms  "Me cuesta un poco moverme, pero puedo levantarme s"
  [llamada 1] scripted-routed          9 ms  "La herida está seca, sin enrojecimiento."
  [llamada 1] scripted-routed          9 ms  "El apetito ha estado bajo estos días."
  [llamada 1] scripted-routed          4 ms  "He dormido bien, sin interrupciones."
  [llamada 1] llm                  74698 ms  "¿Puedo bañarme normalmente con la herida así?"
  [llamada 2] scripted-routed          7 ms  "El dolor ha bajado, ahora es un 2 de 10."
  [llamada 2] scripted-routed         16 ms  "No he sentido calentura ni escalofríos estos días."
  [llamada 2] llm                  84739 ms  "¿Cuánto tiempo es normal sentir hinchazón en la pi"
  [llamada 2] scripted-routed         13 ms  "Puedo caminar despacio, con ayuda del andador."
  [llamada 2] scripted-routed          5 ms  "La herida se ve bien, sin secreción."
  [llamada 2] scripted-routed          4 ms  "He comido bien, sin náuseas."
  [llamada 2] scripted-routed          6 ms  "He dormido más o menos, con algunas interrupciones"
  [llamada 2] llm                  95283 ms  "¿Es peligroso si se me olvida una dosis del antico"
  [llamada 3] scripted-routed          6 ms  "Sigo con dolor, como un 4, pero se soporta."
  [llamada 3] scripted-routed          6 ms  "No he tenido fiebre ni escalofríos."
  [llamada 3] llm                  77741 ms  "¿Qué señales de infección debo vigilar en la herid"
  [llamada 3] scripted-routed          6 ms  "No he tenido problemas para moverme."
  [llamada 3] scripted-routed          7 ms  "La herida sigue igual, sin cambios raros."
  [llamada 3] scripted-routed          6 ms  "El apetito ha estado bien, casi normal."
  [llamada 3] scripted-routed          7 ms  "He dormido bastante mal por el dolor."
  [llamada 3] llm                  73906 ms  "¿Es normal no tener nada de apetito todavía?"
  [llamada 4] scripted-routed          2 ms  "El dolor está en un 3 de 10, en la zona de la inci"
  [llamada 4] scripted-routed          3 ms  "No he tenido fiebre."
  [llamada 4] llm                  56931 ms  "¿Puedo tomar ibuprofeno además de lo que me receta"
  [llamada 4] scripted-routed          8 ms  "Me cuesta un poco moverme, pero puedo levantarme s"
  [llamada 4] scripted-routed          5 ms  "La herida está seca, sin enrojecimiento."
  [llamada 4] scripted-routed          6 ms  "El apetito ha estado bajo estos días."
  [llamada 4] scripted-routed          7 ms  "He dormido bien, sin interrupciones."
  [llamada 4] scripted-fallback   155609 ms  "¿Es normal despertarme varias veces en la noche po"
  [llamada 5] scripted-routed         48 ms  "El dolor ha bajado, ahora es un 2 de 10."
  [llamada 5] scripted-routed          7 ms  "No he sentido calentura ni escalofríos estos días."
  [llamada 5] llm                  81893 ms  "¿Cuándo puedo volver a manejar después de esta cir"
  [llamada 5] scripted-routed          9 ms  "Puedo caminar despacio, con ayuda del andador."
  [llamada 5] scripted-routed          6 ms  "La herida se ve bien, sin secreción."
  [llamada 5] scripted-routed          5 ms  "He comido bien, sin náuseas."
  [llamada 5] scripted-routed          4 ms  "He dormido más o menos, con algunas interrupciones"
  [llamada 5] llm                  48031 ms  "¿Es normal sentir hormigueo cerca de la herida?"
  [llamada 6] scripted-routed          3 ms  "Sigo con dolor, como un 4, pero se soporta."
  [llamada 6] scripted-routed          3 ms  "No he tenido fiebre ni escalofríos."
  [llamada 6] llm                  54704 ms  "¿Es normal que la herida me duela más en la noche "
  [llamada 6] scripted-routed          6 ms  "No he tenido problemas para moverme."
  [llamada 6] scripted-routed          6 ms  "La herida sigue igual, sin cambios raros."
  [llamada 6] scripted-routed          8 ms  "El apetito ha estado bien, casi normal."
  [llamada 6] scripted-routed          6 ms  "He dormido bastante mal por el dolor."
  [llamada 6] llm                  47257 ms  "¿Puedo bañarme normalmente con la herida así?"
  [llamada 7] scripted-routed          6 ms  "El dolor está en un 3 de 10, en la zona de la inci"
  [llamada 7] scripted-routed          4 ms  "No he tenido fiebre."
  [llamada 7] llm                  82871 ms  "¿Cuánto tiempo es normal sentir hinchazón en la pi"
  [llamada 7] scripted-routed         12 ms  "Me cuesta un poco moverme, pero puedo levantarme s"
  [llamada 7] scripted-routed          5 ms  "La herida está seca, sin enrojecimiento."
  [llamada 7] scripted-routed          5 ms  "El apetito ha estado bajo estos días."
  [llamada 7] scripted-routed          4 ms  "He dormido bien, sin interrupciones."
  [llamada 7] llm                  42696 ms  "¿Es peligroso si se me olvida una dosis del antico"
  [llamada 8] scripted-routed         13 ms  "El dolor ha bajado, ahora es un 2 de 10."
  [llamada 8] scripted-routed          5 ms  "No he sentido calentura ni escalofríos estos días."
  [llamada 8] llm                  71119 ms  "¿Qué señales de infección debo vigilar en la herid"
  [llamada 8] scripted-routed         12 ms  "Puedo caminar despacio, con ayuda del andador."
  [llamada 8] scripted-routed          5 ms  "La herida se ve bien, sin secreción."
  [llamada 8] scripted-routed          5 ms  "He comido bien, sin náuseas."
  [llamada 8] scripted-routed          5 ms  "He dormido más o menos, con algunas interrupciones"
  [llamada 8] llm                  60836 ms  "¿Es normal no tener nada de apetito todavía?"
  [llamada 9] scripted-routed          8 ms  "Sigo con dolor, como un 4, pero se soporta."
  [llamada 9] scripted-routed          5 ms  "No he tenido fiebre ni escalofríos."
  [llamada 9] llm                  40799 ms  "¿Puedo tomar ibuprofeno además de lo que me receta"
  [llamada 9] scripted-routed          4 ms  "No he tenido problemas para moverme."
  [llamada 9] scripted-routed          4 ms  "La herida sigue igual, sin cambios raros."
  [llamada 9] scripted-routed          3 ms  "El apetito ha estado bien, casi normal."
  [llamada 9] scripted-routed          3 ms  "He dormido bastante mal por el dolor."
  [llamada 9] llm                  41522 ms  "¿Es normal despertarme varias veces en la noche po"
  [llamada 10] scripted-routed          9 ms  "El dolor está en un 3 de 10, en la zona de la inci"
  [llamada 10] scripted-routed          5 ms  "No he tenido fiebre."
  [llamada 10] llm                  84720 ms  "¿Cuándo puedo volver a manejar después de esta cir"
  [llamada 10] scripted-routed         48 ms  "Me cuesta un poco moverme, pero puedo levantarme s"
  [llamada 10] scripted-routed          8 ms  "La herida está seca, sin enrojecimiento."
  [llamada 10] scripted-routed          6 ms  "El apetito ha estado bajo estos días."
  [llamada 10] scripted-routed          5 ms  "He dormido bien, sin interrupciones."
  [llamada 10] llm                  50836 ms  "¿Es normal sentir hormigueo cerca de la herida?"

=== Resultado ===

Arranque en frío (1er turno con engine 'llm' de la corrida, reportado aparte):
  155207 ms -- "¿Es normal que la herida me duela más en la noche que en el día?"

Invocaciones al modelo excluyendo el arranque en frío: N=18
  P50: 60836 ms
  P95: 95283 ms
  min: 40799 ms  max: 95283 ms

Turnos por llamada que invocaron al modelo (naturalidad conversacional):
  llamada 1: 2/8 turnos (25%)
  llamada 2: 2/8 turnos (25%)
  llamada 3: 2/8 turnos (25%)
  llamada 4: 1/8 turnos (13%)
  llamada 5: 2/8 turnos (25%)
  llamada 6: 2/8 turnos (25%)
  llamada 7: 2/8 turnos (25%)
  llamada 8: 2/8 turnos (25%)
  llamada 9: 2/8 turnos (25%)
  llamada 10: 2/8 turnos (25%)
  promedio: 23.8% de los turnos por llamada

{
  "arranqueFrioMs": 155207,
  "n": 18,
  "p50": 60836,
  "p95": 95283,
  "min": 40799,
  "max": 95283,
  "latencias": [
    74698,
    84739,
    95283,
    77741,
    73906,
    56931,
    81893,
    48031,
    54704,
    47257,
    82871,
    42696,
    71119,
    60836,
    40799,
    41522,
    84720,
    50836
  ],
  "porLlamada": [
    {
      "llamada": 1,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 2,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 3,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 4,
      "turnos": 8,
      "conModelo": 1,
      "fraccion": 0.125
    },
    {
      "llamada": 5,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 6,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 7,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 8,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 9,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    },
    {
      "llamada": 10,
      "turnos": 8,
      "conModelo": 2,
      "fraccion": 0.25
    }
  ],
  "fraccionPromedio": 0.2375
}
```
