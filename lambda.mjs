/* A API dos palpites rodando no Lambda, atrás de uma Function URL.
 *
 * As regras vêm de regras.js e os palpites ficam no DynamoDB, então esta
 * função é só a tradução entre o formato de evento do Lambda e as mesmas
 * operações que o server.js usa.
 */

import { conferir, resumo, ESCOLHAS, chave as chaveDe, JA_VOTOU, NAO_EXISTE } from './regras.js';
import * as armazem from './armazens/dynamo.js';
import { cabecalhos } from './cors.js';

const SENHA = process.env.ADMIN_TOKEN || '';     // sem senha, o apagar fica desligado

function responder(evento, status, corpo) {
  return {
    statusCode: status,
    headers: cabecalhos(evento, 'GET, POST, PUT, DELETE, OPTIONS'),
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
    if (metodo === 'OPTIONS') return responder(evento, 204, {});

    if (metodo === 'GET' && caminho === '/') {
      return responder(evento, 200, { ok: true, ...resumo(await armazem.listar()) });
    }

    if (caminho !== '/votos') return responder(evento, 404, { erro: 'essa rota não existe' });

    if (metodo === 'GET') return responder(evento, 200, await armazem.listar());

    if (metodo === 'POST') {
      let corpo;
      try {
        corpo = lerCorpo(evento);
      } catch {
        return responder(evento, 400, { erro: 'não entendi o que veio no pedido' });
      }

      const { voto, erro } = conferir(corpo);
      if (erro) return responder(evento, 400, { erro });

      try {
        const votos = await armazem.guardar(voto);
        console.log(`palpite: ${voto.nome} → ${voto.escolha} (${votos.length} no total)`);
        return responder(evento, 201, votos); // devolve a lista já atualizada
      } catch (falha) {
        if (falha.message === JA_VOTOU) {
          return responder(evento, 409, { erro: 'esse nome já deu um palpite' });
        }
        throw falha;
      }
    }

    // PUT e DELETE são do casal, não do convidado: trocam ou tiram palpite
    // dos outros, então a senha é o que separa um do outro
    if (metodo === 'PUT' || metodo === 'DELETE') {
      const busca = new URLSearchParams(evento.rawQueryString ?? '');
      if (!SENHA || busca.get('senha') !== SENHA) {
        return responder(evento, 403, { erro: 'senha inválida' });
      }

      if (metodo === 'PUT') {
        let corpo;
        try {
          corpo = lerCorpo(evento);
        } catch {
          return responder(evento, 400, { erro: 'não entendi o que veio no pedido' });
        }

        const chave = String(corpo?.chave ?? '').trim();
        const escolha = String(corpo?.escolha ?? '').trim().toLowerCase();
        if (!chave) return responder(evento, 400, { erro: 'faltou dizer qual palpite' });
        if (!ESCOLHAS.includes(escolha)) {
          return responder(evento, 400, { erro: 'a escolha deve ser menino ou menina' });
        }

        try {
          const votos = await armazem.trocar(chave, escolha);
          console.log(`troca: ${chave} → ${escolha}`);
          return responder(evento, 200, votos);
        } catch (falha) {
          if (falha.message === NAO_EXISTE) {
            return responder(evento, 404, { erro: 'esse palpite não existe' });
          }
          throw falha;
        }
      }

      // DELETE sem chave apaga tudo, como sempre fez — é o que o zerar.sh usa
      const umaChave = (busca.get('chave') ?? '').trim();
      if (!umaChave) {
        return responder(evento, 200, { ok: true, apagados: await armazem.apagarTudo() });
      }

      try {
        const votos = await armazem.apagarUm(umaChave);
        console.log(`apagou: ${umaChave}`);
        return responder(evento, 200, votos);
      } catch (falha) {
        if (falha.message === NAO_EXISTE) {
          return responder(evento, 404, { erro: 'esse palpite não existe' });
        }
        throw falha;
      }
    }

    return responder(evento, 405, { erro: 'método não permitido' });
  } catch (falha) {
    console.error(falha);
    return responder(evento, 500, { erro: 'não consegui falar com o armazenamento' });
  }
};
