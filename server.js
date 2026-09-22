/* Chá Revelação — servidor dos palpites.
   Node puro, sem dependência nenhuma. Sobe com: node server.js

   As regras vivem em regras.js e os palpites num arquivo JSON, então este
   arquivo é só a parte de HTTP. No Lambda, quem faz esse papel é o
   lambda.mjs, com as mesmas regras e o DynamoDB no lugar do arquivo. */

import { createServer } from 'node:http';
import { conferir, resumo, JA_VOTOU } from './regras.js';
import * as armazem from './armazens/arquivo.js';

const PORTA = process.env.PORT || 3000;
const ORIGEM = process.env.CORS_ORIGIN || '*';   // em produção, o endereço do site
const SENHA = process.env.ADMIN_TOKEN || '';     // sem senha, o apagar fica desligado

function responder(res, status, corpo) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGEM,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  let bruto = '';
  for await (const pedaco of req) {
    bruto += pedaco;
    if (bruto.length > 10_000) throw new Error('corpo grande demais');
  }
  return JSON.parse(bruto || '{}');
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rota = `${req.method} ${url.pathname.replace(/\/$/, '') || '/'}`;

  try {
    if (req.method === 'OPTIONS') return responder(res, 204, {});

    if (rota === 'GET /') {
      return responder(res, 200, { ok: true, ...resumo(await armazem.listar()) });
    }

    if (rota === 'GET /votos') return responder(res, 200, await armazem.listar());

    if (rota === 'POST /votos') {
      const { voto, erro } = conferir(await lerCorpo(req));
      if (erro) return responder(res, 400, { erro });

      try {
        const votos = await armazem.guardar(voto);
        console.log(`palpite: ${voto.nome} → ${voto.escolha} (${votos.length} no total)`);
        return responder(res, 201, votos); // devolve a lista já atualizada
      } catch (falha) {
        if (falha.message === JA_VOTOU) {
          return responder(res, 409, { erro: 'esse nome já deu um palpite' });
        }
        if (falha.message === 'limite') {
          return responder(res, 507, { erro: 'chegamos no limite de palpites' });
        }
        throw falha;
      }
    }

    if (rota === 'DELETE /votos') {
      if (!SENHA || url.searchParams.get('senha') !== SENHA) {
        return responder(res, 403, { erro: 'senha inválida' });
      }
      return responder(res, 200, { ok: true, apagados: await armazem.apagarTudo() });
    }

    responder(res, 404, { erro: 'essa rota não existe' });
  } catch (falha) {
    console.error(falha);
    responder(res, 400, { erro: 'não entendi o que veio no pedido' });
  }
});

servidor.listen(PORTA, async () => {
  console.log(`chá revelação no ar em http://localhost:${PORTA}`);
  console.log(`palpites em ${armazem.onde} (${(await armazem.listar()).length} até agora)`);
});
