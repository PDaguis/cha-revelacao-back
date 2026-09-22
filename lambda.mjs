/* A API dos palpites rodando no Lambda, atrás de uma Function URL.
 *
 * As regras vêm de regras.js e os palpites ficam no DynamoDB, então esta
 * função é só a tradução entre o formato de evento do Lambda e as mesmas
 * operações que o server.js usa.
 */

import { conferir, resumo, JA_VOTOU } from './regras.js';
import * as armazem from './armazens/dynamo.js';

const ORIGEM = process.env.CORS_ORIGIN || '*';   // em produção, o endereço do site
const SENHA = process.env.ADMIN_TOKEN || '';     // sem senha, o apagar fica desligado

function responder(status, corpo) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ORIGEM,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(corpo),
  };
}

function lerCorpo(evento) {
  if (!evento.body) return {};
  const bruto = evento.isBase64Encoded
    ? Buffer.from(evento.body, 'base64').toString('utf8')
    : evento.body;
  return JSON.parse(bruto);
}

export const handler = async (evento) => {
  const metodo = evento.requestContext?.http?.method ?? 'GET';
  const caminho = (evento.rawPath ?? '/').replace(/\/$/, '') || '/';

  try {
    if (metodo === 'OPTIONS') return responder(204, {});

    if (metodo === 'GET' && caminho === '/') {
      return responder(200, { ok: true, ...resumo(await armazem.listar()) });
    }

    if (caminho !== '/votos') return responder(404, { erro: 'essa rota não existe' });

    if (metodo === 'GET') return responder(200, await armazem.listar());

    if (metodo === 'POST') {
      let corpo;
      try {
        corpo = lerCorpo(evento);
      } catch {
        return responder(400, { erro: 'não entendi o que veio no pedido' });
      }

      const { voto, erro } = conferir(corpo);
      if (erro) return responder(400, { erro });

      try {
        const votos = await armazem.guardar(voto);
        console.log(`palpite: ${voto.nome} → ${voto.escolha} (${votos.length} no total)`);
        return responder(201, votos); // devolve a lista já atualizada
      } catch (falha) {
        if (falha.message === JA_VOTOU) {
          return responder(409, { erro: 'esse nome já deu um palpite' });
        }
        throw falha;
      }
    }

    if (metodo === 'DELETE') {
      const senhaDada = new URLSearchParams(evento.rawQueryString ?? '').get('senha');
      if (!SENHA || senhaDada !== SENHA) {
        return responder(403, { erro: 'senha inválida' });
      }
      return responder(200, { ok: true, apagados: await armazem.apagarTudo() });
    }

    return responder(405, { erro: 'método não permitido' });
  } catch (falha) {
    console.error(falha);
    return responder(500, { erro: 'não consegui falar com o armazenamento' });
  }
};
