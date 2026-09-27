/* A regra de CORS, uma só para as duas funções.

   CORS_ORIGIN aceita uma lista separada por vírgula, porque em geral a gente
   precisa do site publicado e de um endereço local ao mesmo tempo — sem ter
   que escolher entre desenvolver e não derrubar a festa.

   O navegador só aceita **um** valor nesse cabeçalho, nunca uma lista. Então
   a função devolve exatamente a origem que perguntou, quando ela está na
   lista. */

const ORIGENS = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))   // a origem que o navegador manda nunca tem barra no fim
  .filter(Boolean);

export function origemDe(evento) {
  if (ORIGENS.includes('*')) return '*';
  const pedida = (evento.headers?.origin || '').replace(/\/$/, '');
  // origem de fora da lista: devolvemos a primeira. O navegador recusa, que é
  // o certo, e o recado de erro dele diz exatamente qual valor veio e qual foi
  // pedido — é assim que se descobre que faltou uma origem na lista.
  return ORIGENS.includes(pedida) ? pedida : ORIGENS[0];
}

export function cabecalhos(evento, metodos) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origemDe(evento),
    'Access-Control-Allow-Methods': metodos,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    // a resposta muda conforme quem pergunta, então ninguém pode guardar uma
    // e servir para outra origem depois
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}
