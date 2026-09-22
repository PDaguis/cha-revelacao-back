/* Chá Revelação — servidor dos palpites.
   Node puro, sem dependência nenhuma. Sobe com: node server.js */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PORTA = process.env.PORT || 3000;
const ARQUIVO = resolve(process.env.DATA_FILE || './dados/votos.json');
const ORIGEM = process.env.CORS_ORIGIN || '*';      // em produção, o endereço do site
const SENHA = process.env.ADMIN_TOKEN || '';        // sem senha, o apagar fica desligado
const LIMITE_DE_VOTOS = 2000;                       // só para o arquivo não crescer sem fim
const ESCOLHAS = ['menino', 'menina'];

let votos = carregar();

/* ---------- os palpites ficam num arquivo JSON ---------- */
function carregar() {
  try {
    const lido = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
    return Array.isArray(lido) ? lido : [];
  } catch {
    return []; // primeira vez: ainda não existe arquivo
  }
}

function salvar() {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(votos, null, 2));
}

/* ---------- respostas ---------- */
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

/* ---------- regras do palpite ---------- */
function conferir(dados) {
  const nome = String(dados?.nome ?? '').trim().replace(/\s+/g, ' ');
  const escolha = String(dados?.escolha ?? '').trim().toLowerCase();

  if (nome.length < 2) return { erro: 'diga o seu nome' };
  if (nome.length > 60) return { erro: 'nome comprido demais' };
  if (!ESCOLHAS.includes(escolha)) return { erro: 'a escolha deve ser menino ou menina' };

  // a hora quem manda é o servidor, não o aparelho do convidado
  return { voto: { nome, escolha, em: new Date().toISOString() } };
}

function resumo() {
  const menino = votos.filter((v) => v.escolha === 'menino').length;
  const menina = votos.filter((v) => v.escolha === 'menina').length;
  return { total: menino + menina, menino, menina };
}

/* ---------- rotas ---------- */
const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rota = `${req.method} ${url.pathname.replace(/\/$/, '') || '/'}`;

  try {
    if (req.method === 'OPTIONS') return responder(res, 204, {});

    if (rota === 'GET /') return responder(res, 200, { ok: true, ...resumo() });

    if (rota === 'GET /votos') return responder(res, 200, votos);

    if (rota === 'POST /votos') {
      const { voto, erro } = conferir(await lerCorpo(req));
      if (erro) return responder(res, 400, { erro });

      // mesmo nome votando de novo: troca o palpite anterior
      const anteriores = votos.filter((v) => v.nome.toLowerCase() !== voto.nome.toLowerCase());
      if (anteriores.length >= LIMITE_DE_VOTOS) {
        return responder(res, 507, { erro: 'chegamos no limite de palpites' });
      }

      votos = [...anteriores, voto];
      salvar();
      console.log(`palpite: ${voto.nome} → ${voto.escolha} (${resumo().total} no total)`);
      return responder(res, 201, votos); // devolve a lista já atualizada
    }

    if (rota === 'DELETE /votos') {
      if (!SENHA || url.searchParams.get('senha') !== SENHA) {
        return responder(res, 403, { erro: 'senha inválida' });
      }
      const apagados = votos.length;
      votos = [];
      salvar();
      return responder(res, 200, { ok: true, apagados });
    }

    responder(res, 404, { erro: 'essa rota não existe' });
  } catch (falha) {
    console.error(falha);
    responder(res, 400, { erro: 'não entendi o que veio no pedido' });
  }
});

servidor.listen(PORTA, () => {
  console.log(`chá revelação no ar em http://localhost:${PORTA}`);
  console.log(`palpites guardados em ${ARQUIVO} (${votos.length} até agora)`);
});
